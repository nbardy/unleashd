import type { AddressInfo } from 'node:net';
import express from 'express';
import { registerBuddyRoutes } from '../src/buddies/routes';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddiesIntegration } from '../src/buddies/integration';
import { BuddyMemoryReviewer } from '../src/buddies/memory-review';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { executeDocumentResource } from '../src/buddies/resources';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';

test('owner memory resolution preserves inherited context, discovers reviewer notes and retains audience continuity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'buddy-review-memory-'));
  const raw = new BuddiesStore(':memory:');
  const store = raw as unknown as BuddiesStorePort;
  let reviewer: BuddyMemoryReviewer | undefined;
  try {
    const w = raw.createWorkspace({ name: 'Review fixture', rootPath: root });
    const b = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
    const prior = raw.readBuddyMemory(b.id);
    raw.updateMemory(b.id, {
      documentKind: 'working',
      baseVersion: prior.workingRevision,
      content: 'PRIOR_OWNER_PREFERENCE',
      reasoning: 'Existing private owner knowledge',
    });
    const scope = { kind: 'owner_thread' as const, conversationId: 'owner-thread' };
    const context = { buddyId: b.id, workspaceId: w.id, knowledgeScope: scope };
    const integration = createBuddiesIntegration({ store, getConversation: () => undefined });
    const before = await integration.resolveConversation(context);
    assert.match(before.briefing, /PRIOR_OWNER_PREFERENCE/);
    let reviewerSaw = 'not called';
    reviewer = new BuddyMemoryReviewer({
      directory: join(root, 'reviews'),
      getStore: async () => store,
      run: async ({ executeTool }) => {
        const head = executeTool('get_memory', { doc: 'working' }) as {
          content: string;
          revision: number;
        };
        reviewerSaw = head.content;
        executeTool('update_memory', {
          doc: 'working',
          baseVersion: head.revision,
          content: `${head.content}\nNEW_THREAD_LESSON`,
          reasoning: 'Capture a newly confirmed lesson',
        });
        executeTool('remember_note', { topic: 'Reviewer evidence', body: 'REVIEWER_ONLY_NOTE' });
      },
    });
    await reviewer.initialize();
    reviewer.start();
    reviewer.enqueue({
      attemptId: 'completed',
      conversationId: 'owner-thread',
      context,
      completedAt: new Date().toISOString(),
      messages: [{ role: 'assistant', content: 'New thread lesson.' }],
    });
    for (let i = 0; i < 100 && reviewer.list(b.id)[0]?.status !== 'complete'; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(reviewer.list(b.id)[0].status, 'complete');
    const after = await integration.resolveConversation(context);
    const ops = new BuddyOperationsService(store, { ...context, conversationId: 'owner-thread' });
    const read = executeDocumentResource(
      'get_document',
      { ref: { targetBuddyId: b.id, kind: 'working' } },
      (name, input) => ops.execute(name, input)
    );
    const recall = ops.execute('buddy.recall', { pattern: 'REVIEWER_ONLY_NOTE' }) as {
      data: { matches: unknown[] };
    };
    assert.equal(reviewerSaw, 'PRIOR_OWNER_PREFERENCE');
    assert.match(after.briefing, /PRIOR_OWNER_PREFERENCE/);
    assert.match(after.briefing, /NEW_THREAD_LESSON/);
    assert.equal(read.data.content, 'PRIOR_OWNER_PREFERENCE\nNEW_THREAD_LESSON');
    assert.equal(recall.data.matches.length, 1);
    assert.equal(before.audienceKey, after.audienceKey);
  } finally {
    reviewer?.stop();
    raw.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('private messages stay private and work pagination uses the active audience', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = raw as unknown as BuddiesStorePort;
  let client: Client | undefined;
  let server: ReturnType<typeof createBuddyMcpServer> | undefined;
  try {
    const w = raw.createWorkspace({ name: 'Review fixture', rootPath: '/tmp' });
    const b = raw.createBuddy({ project: w.id, name: 'Worker', role: 'Inspect' });
    const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
    for (let i = 0; i < 5; i++)
      raw.createCoordinatedProject(
        { workspaceId: w.id, ownerId: b.id, title: `Project ${i}`, definitionOfDone: 'Evidence' },
        { actor: b.id, key: `project:${i}` }
      );
    const rows = raw.listBuddyOwnedProjects({ buddy: b.id, workspace: w.id });
    const selected = rows[rows.length - 1];
    const message = raw.sendCoordinatedMessage(
      {
        fromBuddy: b.id,
        to: 'owner',
        workspace: w.id,
        project: selected.id,
        purpose: 'Private owner discussion',
        body: 'PRIVATE_OWNER_MESSAGE',
        key: 'owner-only',
        visibility: 'participants',
        expectsReply: false,
      },
      { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
    );
    const ctx = {
      buddyId: b.id,
      workspaceId: w.id,
      buddyProjectId: selected.id,
      delegatedByBuddyId: lead.id,
      conversationId: 'unrelated-team-thread',
    };
    const ops = new BuddyOperationsService(store, ctx);
    assert.throws(
      () => ops.execute('buddy.get_message', { messageId: message.id }),
      /unavailable in this audience/
    );
    client = new Client({ name: 'review', version: '1' });
    server = createBuddyMcpServer(store, ctx);
    const [a, bTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(a), server.connect(bTransport)]);
    const page = await client.callTool({ name: 'get_current_work', arguments: { limit: 1 } });
    assert.ok(!page.isError, JSON.stringify(page));
    const data = page.structuredContent as {
      data: { items: unknown[]; nextCursor: string | null };
    };
    assert.equal((data.data.items[0] as { id: string }).id, selected.id);
    assert.equal(data.data.nextCursor, null);
    const explicit = await client.callTool({
      name: 'get_current_work',
      arguments: { projectId: selected.id, limit: 1 },
    });
    assert.ok(!explicit.isError, JSON.stringify(explicit));
    assert.equal(
      (explicit.structuredContent as { data: { items: unknown[] } }).data.items.length,
      1
    );
  } finally {
    await client?.close();
    await server?.close();
    raw.close();
  }
});

test('run history filters before paginating the active project audience', () => {
  const raw = new BuddiesStore(':memory:');
  try {
    const w = raw.createWorkspace({ name: 'Adjacent review', rootPath: '/tmp' });
    const worker = raw.createBuddy({ project: w.id, name: 'Worker', role: 'Inspect' });
    const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
    raw.setBuddyRelationship({ fromBuddy: lead.id, toBuddy: worker.id, kind: 'manager' });
    for (let i = 0; i < 4; i++) {
      const project = raw.createCoordinatedProject(
        {
          workspaceId: w.id,
          ownerId: worker.id,
          title: `Project ${i}`,
          definitionOfDone: 'Evidence',
        },
        { actor: worker.id, key: `project:${i}` }
      );
      raw.sendCoordinatedMessage(
        {
          fromBuddy: lead.id,
          to: worker.id,
          workspace: w.id,
          project: project.id,
          purpose: 'Inspect',
          body: 'Synthetic request',
          key: `request:${i}`,
        },
        { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
      );
    }
    const runs = raw.listBuddyRuns({ buddyId: worker.id });
    const selected = runs.at(-1)!;
    const ops = new BuddyOperationsService(raw as unknown as BuddiesStorePort, {
      buddyId: worker.id,
      workspaceId: w.id,
      buddyProjectId: selected.project_id,
      delegatedByBuddyId: lead.id,
      conversationId: 'unrelated-project-turn',
    });
    const first = ops.execute('buddy.get_runs', { limit: 1 }) as { data: unknown[] };
    const explicit = ops.execute('buddy.get_runs', {
      projectId: selected.project_id,
      limit: 1,
    }) as { data: Array<{ id: string }> };
    assert.equal((first.data[0] as { id: string }).id, selected.id);
    assert.equal(explicit.data[0]?.id, selected.id);
  } finally {
    raw.close();
  }
});

test('workspace run history omits private failures from every execution field', () => {
  const raw = new BuddiesStore(':memory:');
  try {
    const w = raw.createWorkspace({ name: 'Adjacent privacy review', rootPath: '/tmp' });
    const worker = raw.createBuddy({ project: w.id, name: 'Worker', role: 'Inspect' });
    const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
    raw.setCoordinationMembership(worker.id, w.id, { background_enabled: true });
    const message = raw.sendCoordinatedMessage(
      {
        fromBuddy: lead.id,
        to: worker.id,
        workspace: w.id,
        purpose: 'Private request',
        body: 'Synthetic private body',
        key: 'private',
        visibility: 'participants',
      },
      { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
    );
    const run = raw.listBuddyRuns({ buddyId: worker.id })[0];
    const claimed = raw.claimBuddyRun(run.id, {
      claimToken: 'isolated-fixture-token',
      conversationId: 'private-request-thread',
      maxRuntimeSeconds: 60,
    });
    assert.ok(claimed);
    raw.startBuddyRun(run.id, claimed.claim_token);
    raw.finishBuddyRun(run.id, {
      claimToken: claimed.claim_token,
      status: 'failed',
      error: 'PRIVATE_FAILURE_CANARY',
    });
    const ops = new BuddyOperationsService(raw as unknown as BuddiesStorePort, {
      buddyId: worker.id,
      workspaceId: w.id,
      delegatedByBuddyId: lead.id,
      conversationId: 'unrelated-workspace-turn',
    });
    assert.throws(
      () => ops.execute('buddy.get_message', { messageId: message.id }),
      /unavailable in this audience/
    );
    const history = ops.execute('buddy.get_runs', {}) as {
      data: Array<{ id: string; error: string | null; execution: { error: string | null } }>;
    };
    const exposed = history.data.find((item) => item.id === run.id)!;
    assert.equal(exposed.error, null);
    assert.equal(exposed.execution, null);
    assert.doesNotMatch(JSON.stringify(history), /PRIVATE_FAILURE_CANARY/);
  } finally {
    raw.close();
  }
});

test('Memory HTTP selects the same owner-thread head and notes as document tools, with scoped CAS', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = raw as unknown as BuddiesStorePort;
  const w = raw.createWorkspace({ name: 'Memory UI', rootPath: '/tmp' });
  const buddy = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
  const scope = { kind: 'owner_thread' as const, conversationId: 'owner-thread' };
  const ctx = { buddyId: buddy.id, workspaceId: w.id, conversationId: scope.conversationId };
  const ops = new BuddyOperationsService(store, ctx);
  const ref = { targetBuddyId: buddy.id, kind: 'working' as const };
  const read = () =>
    executeDocumentResource('get_document', { ref }, (name, input) => ops.execute(name, input));
  const before = read();
  assert.deepEqual(before.data.ref.scope, scope);
  executeDocumentResource(
    'update_document',
    {
      ref,
      revision: before.data.revision,
      key: 'seed',
      content: 'THREAD_FACT',
      reason: 'Owner learning',
      preview: false,
    },
    (name, input) => ops.execute(name, input)
  );
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store,
    getScheduler: () => null,
    sendError: (res, error, status) => {
      res.status(status).json({ error: String(error) });
    },
    getNextAutomationRunAt: () => '',
    createId: () => 'ui-command',
    isConversationDeleted: async () => false,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/buddies/${buddy.id}/memory`;
  const query = `workspaceId=${w.id}&knowledgeScope=${encodeURIComponent(JSON.stringify(scope))}`;
  const put = (baseVersion: number) =>
    fetch(`${base}/working`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: w.id,
        knowledgeScope: scope,
        baseVersion,
        content: 'UI_FACT',
        reasoning: 'Owner revision',
        key: `ui:${baseVersion}`,
      }),
    });
  try {
    const audiences = (await (await fetch(`${base}/scopes?workspaceId=${w.id}`)).json()) as Array<{
      scope: unknown;
    }>;
    assert.ok(audiences.some((a) => JSON.stringify(a.scope) === JSON.stringify(scope)));
    const memory = (await (await fetch(`${base}?${query}`)).json()) as {
      working: string;
      workingRevision: number;
    };
    assert.equal(memory.working, read().data.content);
    assert.equal((await put(memory.workingRevision)).status, 200);
    assert.equal(read().data.content, 'UI_FACT');
    assert.equal((await put(memory.workingRevision - 1)).status, 400);
    assert.equal(
      raw.readBuddyMemory(buddy.id).working,
      '',
      'Scoped editing does not change owner defaults'
    );
    const note = await fetch(`${base}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: w.id,
        knowledgeScope: scope,
        topic: 'UI evidence',
        body: 'UI_NOTE',
      }),
    });
    assert.equal(note.status, 201);
    const recall = ops.execute('buddy.recall', { pattern: 'UI_NOTE' }) as {
      data: { matches: unknown[] };
    };
    assert.equal(recall.data.matches.length, 1);
    const team = new BuddyOperationsService(store, {
      ...ctx,
      delegatedByBuddyId: 'lead',
      conversationId: 'team',
    });
    assert.equal(
      (team.execute('buddy.recall', { pattern: 'UI_NOTE' }).data as { matches: unknown[] }).matches
        .length,
      0
    );
    assert.throws(
      () =>
        executeDocumentResource(
          'get_document',
          { ref: { targetBuddyId: buddy.id, scope, kind: 'note' } },
          (name, input) => ops.execute(name, input)
        ),
      /name/
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    raw.close();
  }
});
