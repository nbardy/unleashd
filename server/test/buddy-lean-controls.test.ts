import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddiesIntegration } from '../src/buddies/integration';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'buddy-lean-controls-'));
  const raw = new BuddiesStore(':memory:');
  const store = raw as unknown as BuddiesStorePort;
  const workspace = raw.createWorkspace({ name: 'Lean controls', rootPath: root });
  const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Coordinate' });
  const worker = raw.createBuddy({ project: workspace.id, name: 'Worker', role: 'Build' });
  raw.setBuddyRelationship({ fromBuddy: lead.id, toBuddy: worker.id, kind: 'manager' });
  for (const buddy of [lead, worker])
    raw.setCoordinationMembership(buddy.id, workspace.id, { background_enabled: true });
  const context = { buddyId: lead.id, workspaceId: workspace.id, conversationId: 'owner' };
  const server = createBuddyMcpServer(store, context);
  const client = new Client({ name: 'lean-controls', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  return {
    raw,
    store,
    workspace,
    lead,
    worker,
    context,
    client,
    async call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      return (result.structuredContent as any).data;
    },
    async close() {
      await client.close();
      await server.close();
      raw.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('native readiness checks the actual background return route and retains legacy busy checks', async () => {
  const f = await fixture();
  try {
    const policy = { allowed_operations: MESSAGE_BUDDY_OPERATIONS };
    f.raw.beginBuddyChatRun({
      buddyId: f.lead.id,
      workspaceId: f.workspace.id,
      conversationId: 'owner',
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
      maxRuntimeSeconds: 60,
    });
    const request = (key: string, background: boolean) =>
      f.raw.sendCoordinatedMessage(
        {
          fromBuddy: f.lead.id,
          to: f.worker.id,
          workspace: f.workspace.id,
          parentConversationId: 'owner',
          key,
          purpose: 'Build',
          body: 'Save an artifact',
        },
        { policy, ...(background ? { returnConversationId: 'background-review' } : {}) }
      );
    const background = request('background', true);
    const legacy = request('legacy', false);
    const inspect = async (id: string) =>
      (await f.call('get_capabilities', { messageIds: [id] })).readiness;
    const ready = await inspect(background.id);
    assert.equal(ready.ready, true, JSON.stringify(ready.blockers));
    const legacyBusy = await inspect(legacy.id);
    assert.ok(
      legacyBusy.blockers.some(
        (b: any) => b.code === 'conversation_busy' && b.path === `messages.${legacy.id}.returnPath`
      )
    );
    const workerRun = f.raw.listBuddyRuns().find((r) => r.input_id === background.id)!;
    assert.ok(
      f.raw.claimBuddyRun(workerRun.id, {
        claimToken: 'worker',
        conversationId: 'worker',
        maxRuntimeSeconds: 60,
      })
    );
    f.raw.startBuddyRun(workerRun.id, 'worker');
    f.raw.finishBuddyRun(workerRun.id, {
      claimToken: 'worker',
      status: 'complete',
      outcome: 'Saved artifact',
    });
    f.raw.replyMessage(background.id, {
      buddy: f.worker.id,
      conversationId: 'worker',
      outcome: 'complete',
      body: 'Saved artifact',
      evidence: ['artifact.md'],
    });
    const reply = f.raw
      .listBuddyRuns()
      .find((r) => r.input_kind === 'message_reply' && r.input_id === background.id)!;
    assert.equal(
      reply.conversation_id,
      'background-review',
      'Readiness and delivery choose the same route'
    );
    const claim = f.raw.claimBuddyRun(reply.id, {
      claimToken: 'return',
      conversationId: 'background-review',
      maxRuntimeSeconds: 60,
    });
    assert.ok(claim, 'Busy owner chat does not block the background return');
    const backgroundBusy = await inspect(background.id);
    assert.ok(
      backgroundBusy.blockers.some(
        (b: any) =>
          b.code === 'conversation_busy' && b.path === `messages.${background.id}.returnPath`
      )
    );
  } finally {
    await f.close();
  }
});

test('native portable soul edit reaches the next owner briefing without changing scoped publications', async () => {
  const f = await fixture();
  try {
    const scope = {
      kind: 'project' as const,
      projectId: f.raw.createCoordinatedProject(
        {
          workspaceId: f.workspace.id,
          ownerId: f.lead.id,
          title: 'Shared work',
          definitionOfDone: 'Evidence',
        },
        { actor: f.lead.id, key: 'project' }
      ).id,
    };
    f.raw.replaceKnowledgeDocument(
      { kind: 'soul', targetBuddyId: f.lead.id, scope },
      {
        key: 'published',
        baseRevision: 0,
        content: 'PUBLISHED_ROLE_CANARY',
        reason: 'Fixture disclosure',
      },
      { actor: 'owner', workspaceId: f.workspace.id }
    );
    const integration = createBuddiesIntegration({
      store: f.store,
      getConversation: () => undefined,
    });
    const ownerContext = {
      ...f.context,
      knowledgeScope: { kind: 'owner_thread' as const, conversationId: 'owner' },
    };
    const before = await integration.resolveConversation(ownerContext);
    assert.match(before.briefing, /omit scope for the portable soul/);
    const doc = await f.call('get_document', { ref: { kind: 'soul', targetBuddyId: f.lead.id } });
    assert.equal(doc.ref.scope, undefined);
    const edit = {
      ref: doc.ref,
      revision: doc.revision,
      key: 'portable-edit',
      content: 'OWNER_IDENTITY_CANARY',
      reason: 'Owner requested identity correction',
    };
    await f.call('update_document', { ...edit, preview: true });
    assert.doesNotMatch(
      (await integration.resolveConversation(ownerContext)).briefing,
      /OWNER_IDENTITY_CANARY/
    );
    await f.call('update_document', { ...edit, preview: false });
    const after = await integration.resolveConversation(ownerContext);
    assert.match(after.briefing, /OWNER_IDENTITY_CANARY/);
    assert.doesNotMatch(after.briefing, /PUBLISHED_ROLE_CANARY/);
    const shared = await integration.resolveConversation({
      ...f.context,
      buddyProjectId: scope.projectId,
      knowledgeScope: scope,
      delegatedByBuddyId: f.worker.id,
    });
    assert.match(shared.briefing, /PUBLISHED_ROLE_CANARY/);
    assert.doesNotMatch(shared.briefing, /OWNER_IDENTITY_CANARY|omit scope for the portable soul/);
    const stale = await f.client.callTool({
      name: 'update_document',
      arguments: { ...edit, key: 'stale', preview: false },
    });
    assert.equal(stale.isError, true, 'Revision enforcement remains unchanged');
  } finally {
    await f.close();
  }
});

test('native run stop preserves siblings while root stop cancels the shared work chain', async () => {
  const f = await fixture();
  try {
    const parent = f.raw.beginBuddyChatRun({
      buddyId: f.lead.id,
      workspaceId: f.workspace.id,
      conversationId: 'owner',
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
      maxRuntimeSeconds: 60,
    });
    const messages = ['one', 'two'].map((key) =>
      f.raw.sendCoordinatedMessage(
        {
          fromBuddy: f.lead.id,
          to: f.worker.id,
          workspace: f.workspace.id,
          parentConversationId: 'owner',
          key,
          purpose: 'Build',
          body: key,
        },
        { runId: parent.id, policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
      )
    );
    const runs = messages.map((m) => f.raw.listBuddyRuns().find((r) => r.input_id === m.id)!);
    assert.equal(runs[0].root_message_id, runs[1].root_message_id);
    await f.call('stop', { runId: runs[0].id, key: 'stop-one', reason: 'Stop only this attempt' });
    assert.equal(f.raw.getBuddyRun(runs[0].id)!.status, 'cancelled');
    assert.equal(f.raw.getBuddyRun(runs[1].id)!.status, 'queued');
    await f.call('stop', {
      rootMessageId: messages[0].id,
      key: 'stop-chain',
      reason: 'Stop the whole chain',
    });
    assert.equal(f.raw.getBuddyRun(runs[1].id)!.status, 'cancelled');
    assert.equal(f.raw.getMessage(messages[1].id)!.status, 'cancelled');
    assert.equal(
      f.raw.claimBuddyRun(runs[1].id, { claimToken: 'late', maxRuntimeSeconds: 60 }),
      null
    );
  } finally {
    await f.close();
  }
});
