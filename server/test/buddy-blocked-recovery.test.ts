import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddyContext } from '@unleashd/shared';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddyDispatchService } from '../src/buddies/dispatch-service';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';

test('MCP diagnoses project scope and recovers blocked-success work on the same Task with explicit fresh bounds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-blocked-recovery-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const workspace = raw.createWorkspace({ name: 'Team', rootPath: root });
  const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Review' });
  const worker = raw.createBuddy({ project: workspace.id, name: 'Engineer', role: 'Build' });
  raw.reparentBuddy(worker.id, { managerId: lead.id, key: 'manager' });
  for (const buddy of [lead, worker])
    store.setCoordinationMembership(buddy.id, workspace.id, { background_enabled: true });
  const parent = raw.newProject({
    buddy: lead.id,
    workspace: workspace.id,
    title: 'Parent',
    definitionOfDone: 'Accept repair',
  });
  const task = raw.newProject({
    buddy: worker.id,
    workspace: workspace.id,
    title: 'Existing repair',
    definitionOfDone: 'Verified saved artifact',
  });
  const clients: Client[] = [];
  const servers: ReturnType<typeof createBuddyMcpServer>[] = [];
  const connect = async (context: BuddyContext) => {
    const dispatch = createBuddyDispatchService({
      getStore: async () => store,
      createConversation: async () => {
        throw new Error('Preview and send must not execute a provider');
      },
      dispatchInitialMessage: async () => {},
      abandonConversation: () => {},
      prepareReturnConversation: async () => ({
        returnConversationId: 'manager-review',
        launch: { through_message_id: 'snapshot-sha256:fixture' },
      }),
    });
    const server = createBuddyMcpServer(raw as unknown as BuddiesStorePort, context, {
      dispatchMessage: (input) => dispatch.send(context, input),
    });
    const client = new Client({ name: 'blocked-recovery', version: '1' });
    clients.push(client);
    servers.push(server);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(a), server.connect(b)]);
    return client;
  };
  const call = async (client: Client, name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return (result.structuredContent as { data: any }).data;
  };
  try {
    const context = { buddyId: lead.id, workspaceId: workspace.id, conversationId: 'owner-thread' };
    const scoped = await connect({
      ...context,
      knowledgeScope: { kind: 'project', projectId: parent.id },
    });
    const authorized = await connect(context);
    const input = {
      key: 'original',
      to: worker.id,
      purpose: 'repair',
      body: 'Verify saved artifact',
      delivery: { kind: 'work', projectId: task.id, maxRuns: 3, maxDurationSeconds: 180 },
    };
    const denied = await scoped.callTool({ name: 'send', arguments: { ...input, preview: true } });
    assert.equal(denied.isError, true);
    assert.match(JSON.stringify(denied), /project_audience_mismatch/);
    assert.equal(store.listBuddyRuns().length, 0);
    await call(authorized, 'send', { ...input, preview: true });
    assert.equal(store.listBuddyRuns().length, 0);
    const first = (await call(authorized, 'send', input)).message;
    const firstRun = store.listBuddyRuns().find((run) => run.input_id === first.id)!;
    store.claimBuddyRun(firstRun.id, { claimToken: 'first', conversationId: 'first-worker' });
    store.startBuddyRun(firstRun.id, 'first');
    raw.updateCoordinatedProject(
      task.id,
      {
        baseRevision: task.revision,
        status: 'blocked',
        blockedReason: 'Access repair needed',
        evidence: ['file:partial.md@v1'],
      },
      { actor: worker.id, key: 'block' }
    );
    store.finishBuddyRun(firstRun.id, { claimToken: 'first', status: 'complete' });
    assert.equal(store.getBuddyRun(firstRun.id)?.status, 'complete');
    assert.equal(store.getMessage(first.id)?.outcome, 'blocked');
    const retry = await authorized.callTool({
      name: 'retry_run',
      arguments: { runId: firstRun.id, key: 'bad-retry', reason: 'Blocker repaired' },
    });
    assert.equal(retry.isError, true);
    assert.match(JSON.stringify(retry), /run_already_complete/);
    const badContinuation = await authorized.callTool({
      name: 'send',
      arguments: {
        ...input,
        key: 'bad-followup',
        delivery: { ...input.delivery, continueFrom: first.id },
      },
    });
    assert.equal(badContinuation.isError, true);
    assert.match(JSON.stringify(badContinuation), /previous project is done/);
    const repaired = raw.getBuddyProject(task.id)!;
    raw.updateCoordinatedProject(
      task.id,
      { baseRevision: repaired.revision, status: 'in_progress', blockedReason: null },
      { actor: worker.id, key: 'repair' }
    );
    const fresh = {
      ...input,
      key: 'fresh-after-repair',
      body: `Blocker repaired. Inspect original ${first.id} and file:partial.md@v1 before repeating effects.`,
      delivery: { ...input.delivery, maxRuns: 2, maxDurationSeconds: 120 },
    };
    await call(authorized, 'send', { ...fresh, preview: true });
    const next = (await call(authorized, 'send', fresh)).message;
    assert.equal((await call(authorized, 'send', fresh)).message.id, next.id);
    assert.notEqual(next.id, first.id);
    assert.equal(next.buddy_project_id, task.id);
    assert.equal(next.child_conversation_id, null);
    assert.equal(store.getMessage(first.id)?.outcome, 'blocked');
    assert.match(JSON.stringify(raw.getBuddyProject(task.id)), /partial.md/);
    const nextRun = store.listBuddyRuns().find((run) => run.input_id === next.id)!;
    assert.deepEqual(nextRun.policy.execution, {
      mode: 'until_done',
      maxRuns: 2,
      maxDurationSeconds: 120,
    });
    assert.deepEqual(store.getBuddyRun(firstRun.id)?.policy.execution, {
      mode: 'until_done',
      maxRuns: 3,
      maxDurationSeconds: 180,
    });
    store.claimBuddyRun(nextRun.id, { claimToken: 'next', conversationId: 'new-worker' });
    store.startBuddyRun(nextRun.id, 'next');
    raw.updateCoordinatedProject(
      task.id,
      {
        baseRevision: raw.getBuddyProject(task.id)!.revision,
        status: 'done',
        evidence: ['file:verified.md@v2'],
      },
      { actor: worker.id, key: 'finish' }
    );
    store.finishBuddyRun(nextRun.id, { claimToken: 'next', status: 'complete' });
    assert.equal(store.getMessage(next.id)?.outcome, 'done');
    assert.ok(
      store
        .listBuddyRuns()
        .some((run) => run.buddy_id === lead.id && run.conversation_id === 'manager-review'),
      'terminal outcome routes a background manager review'
    );
  } finally {
    for (const client of clients) await client.close();
    for (const server of servers) await server.close();
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
