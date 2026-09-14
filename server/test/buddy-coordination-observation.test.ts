import assert from 'node:assert/strict';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddyTeamObservationSchema } from '@unleashd/shared';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddyDispatchService } from '../src/buddies/dispatch-service';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';

test('native exact preview, descendant observation, historical checkpoint and branch recovery use one contract', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'Observation', rootPath: '/tmp/coordination-observation' });
  const chief = raw.createBuddy({ project: w.id, name: 'Chief', role: 'Direct' });
  const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
  const worker = raw.createBuddy({ project: w.id, name: 'Worker', role: 'Build' });
  for (const b of [chief, lead, worker])
    store.setCoordinationMembership(b.id, w.id, { background_enabled: true });
  const context = { buddyId: chief.id, workspaceId: w.id, conversationId: 'chief-owner' };
  const dispatch = createBuddyDispatchService({
    getStore: async () => store,
    createConversation: async () => {
      throw new Error('Preview cannot create a runtime');
    },
    dispatchInitialMessage: async () => {},
    abandonConversation: () => {},
    createId: () => assert.fail(),
  });
  const server = createBuddyMcpServer(store, context, {
    dispatchMessage: (input) => dispatch.send(context, input),
  });
  const client = new Client({ name: 'coordination-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return JSON.parse((result.content as Array<{ text: string }>)[0].text).data;
  };
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === 'get_team_state'));
    assert.ok(!tools.tools.some((t) => t.name === 'checkpoint'));
    assert.ok(tools.tools.some((t) => t.name === 'append_task_comment'));
    const payload = {
      key: 'root',
      to: lead.id,
      purpose: 'Coordinate',
      body: 'PRIVATE_ROOT_BODY',
      delivery: { kind: 'request' },
    };
    assert.equal((await call('send', { ...payload, preview: true })).preview, true);
    assert.equal(store.listBuddyRuns().length, 0);
    const sent = await call('send', payload);
    const root = sent.message;
    const parent = store.listBuddyRuns({ buddyId: lead.id })[0];
    store.claimBuddyRun(parent.id, { claimToken: 'lead', conversationId: 'lead' });
    store.startBuddyRun(parent.id, 'lead');
    const child = store.sendCoordinatedMessage(
      {
        fromBuddy: lead.id,
        to: worker.id,
        workspace: w.id,
        key: 'child',
        purpose: 'SECRET_CHILD_PURPOSE',
        body: 'SECRET_CHILD_BODY',
        parentConversationId: 'lead',
      },
      { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS }, runId: parent.id }
    );
    const run = store.listBuddyRuns({ buddyId: worker.id })[0];
    store.claimBuddyRun(run.id, {
      claimToken: 'worker',
      conversationId: 'worker',
      maxRuntimeSeconds: 90,
    });
    store.recordRunExecution(run.id, 'worker', {
      provider: 'codex',
      model: 'fixture-model',
      reasoningEffort: 'medium',
      turnCapSeconds: 90,
      deadline: store.getBuddyRun(run.id)!.deadline!,
      limitingSource: 'attempt_cap',
    });
    store.startBuddyRun(run.id, 'worker');
    const workerOps = new BuddyOperationsService(
      store,
      {
        buddyId: worker.id,
        workspaceId: w.id,
        conversationId: 'worker',
        coordinationRunId: run.id,
        allowedOperations: MESSAGE_BUDDY_OPERATIONS,
      },
      { automationClaimToken: 'worker' }
    );
    // Seed pre-retirement history in this isolated fixture; production writes are retired.
    const historicalCheckpoint = (input: {
      key: string;
      artifacts: Array<{ ref: string; version: string }>;
      effects: string[];
      resume: string;
      visibility?: string;
    }) => {
      raw.db
        .prepare(`INSERT INTO buddy_checkpoints
        (id,run_id,buddy_id,workspace_id,project_id,message_id,root_message_id,created_at,artifacts,effects,resume,visibility)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          input.key,
          run.id,
          worker.id,
          w.id,
          run.project_id,
          child.id,
          run.root_message_id,
          new Date().toISOString(),
          JSON.stringify(input.artifacts),
          JSON.stringify(input.effects),
          input.resume,
          input.visibility ?? 'participants'
        );
      return { id: input.key };
    };
    assert.throws(() => workerOps.execute('buddy.checkpoint', {}), /not allowed|retired/);
    historicalCheckpoint({
      key: 'private-checkpoint',
      artifacts: [{ ref: 'PRIVATE_ARTIFACT', version: 'v1' }],
      effects: [],
      resume: 'PRIVATE_RESUME',
    });
    const published = historicalCheckpoint({
      key: 'team-checkpoint',
      visibility: 'team',
      artifacts: [{ ref: 'artifact:shared', version: 'sha:abc' }],
      effects: ['Local result saved'],
      resume: 'Review the saved result',
    });
    const page = BuddyTeamObservationSchema.parse(
      await call('get_team_state', { targetBuddyId: worker.id, limit: 1 })
    );
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].rootMessageId, root.id);
    assert.equal(
      page.items[0].limits.turnCapSeconds,
      90,
      'admitted snapshot outranks policy-derived estimates'
    );
    assert.deepEqual(
      page.items[0].checkpoints.map((c) => c.id),
      [published.id]
    );
    assert.doesNotMatch(
      JSON.stringify(page),
      /SECRET_CHILD|PRIVATE_ARTIFACT|PRIVATE_RESUME|claim_token|worker-token/
    );
    assert.equal(
      page.items[0].conversationId,
      null,
      'causal oversight does not publish private transcript'
    );
    for (let i = 0; i < 4; i++)
      historicalCheckpoint({
        key: `page-${i}`,
        visibility: 'team',
        artifacts: [{ ref: `artifact:page-${i}`, version: 'v1' }],
        effects: [],
        resume: 'Review',
      });
    const checkpointPage = await call('get_team_state', { runId: run.id, checkpointLimit: 2 });
    assert.equal(
      checkpointPage.items[0].checkpointCount,
      5,
      'private checkpoint is excluded before counting'
    );
    assert.equal(checkpointPage.items[0].checkpointNextOffset, 2);
    const checkpointTail = await call('get_team_state', {
      runId: run.id,
      checkpointLimit: 2,
      checkpointOffset: 4,
    });
    assert.equal(checkpointTail.items[0].checkpoints.length, 1);
    assert.equal(checkpointTail.items[0].checkpointNextOffset, null);
    store.finishBuddyRun(run.id, {
      claimToken: 'worker',
      status: 'failed',
      error: 'Fixture provider error',
    });
    store.finishBuddyRun(parent.id, { claimToken: 'lead', status: 'complete' });
    const leadOps = new BuddyOperationsService(store, {
      buddyId: lead.id,
      workspaceId: w.id,
      conversationId: 'a-new-lead-owner-thread',
    });
    const retryArgs = {
      runId: run.id,
      key: 'recover-child',
      reason: 'Inspected local artifact',
      checkpointId: published.id,
    };
    const retried = leadOps.execute('buddy.retry_run', retryArgs).data as { id: string };
    assert.equal(
      (leadOps.execute('buddy.retry_run', retryArgs).data as { id: string }).id,
      retried.id
    );
    // The same identity in an unrelated team audience cannot use private causal roots.
    const alienProject = raw.newProject({
      buddy: chief.id,
      workspace: w.id,
      title: 'Unrelated',
      definitionOfDone: 'Other',
    });
    const scoped = new BuddyOperationsService(store, {
      ...context,
      buddyProjectId: alienProject.id,
      knowledgeScope: { kind: 'project', projectId: alienProject.id },
      delegatedByBuddyId: lead.id,
    });
    const denied = BuddyTeamObservationSchema.parse(
      scoped.execute('buddy.get_team_state', {}).data
    );
    assert.deepEqual(denied.items, []);
    assert.throws(
      () => scoped.execute('buddy.retry_run', { runId: run.id, key: 'wrong-scope', reason: 'No' }),
      /audience/
    );
    // A recipient can answer its known consultation from a later authorized owner conversation.
    const laterWorker = new BuddyOperationsService(store, {
      buddyId: worker.id,
      workspaceId: w.id,
      conversationId: 'later-owner-thread',
    });
    laterWorker.execute('buddy.reply', {
      messageId: child.id,
      outcome: 'reviewed',
      body: 'Review survives',
      evidence: ['artifact:shared'],
    });
    assert.equal(store.getMessage(child.id)?.status, 'replied');
    // A persisted reply and failed delivery remain distinct, with enough IDs
    // and ancestry to inspect/recover the exact return from the joined view.
    const delivery = store
      .listBuddyRuns({ buddyId: lead.id })
      .find((r) => r.input_kind === 'message_reply')!;
    store.claimBuddyRun(delivery.id, { claimToken: 'return-1', conversationId: 'lead' });
    store.finishBuddyRun(delivery.id, {
      claimToken: 'return-1',
      status: 'failed',
      errorCode: 'delivery_unavailable',
      error: 'PRIVATE_RETURN_DETAIL',
    });
    const retry = store.retryBuddyRun(delivery.id, {
      actor: lead.id,
      key: 'retry-return',
      reason: 'Before admission',
    });
    store.claimBuddyRun(retry.id, { claimToken: 'return-2', conversationId: 'lead' });
    store.startBuddyRun(retry.id, 'return-2');
    store.finishBuddyRun(retry.id, { claimToken: 'return-2', status: 'complete' });
    const deliveryView = await call('get_team_state', { runId: run.id, deliveryLimit: 1 });
    const returned = deliveryView.items[0].reply;
    assert.equal(returned.deliveryCount, 3, 'includes the earlier worker failure notice');
    assert.equal(returned.deliveryNextOffset, 1);
    assert.equal(returned.deliveries[0].runId, retry.id);
    assert.equal(returned.deliveries[0].retryOfRunId, delivery.id);
    assert.ok(returned.deliveries[0].acknowledgedAt);
    const older = await call('get_team_state', {
      runId: run.id,
      deliveryLimit: 1,
      deliveryOffset: 1,
    });
    assert.equal(older.items[0].reply.deliveryNextOffset, 2);
    assert.equal(older.items[0].reply.deliveries[0].state, 'failed');
    assert.equal(older.items[0].reply.deliveries[0].acknowledgedAt, null);
    assert.equal(
      older.items[0].reply.deliveries[0].error,
      null,
      'causal CEO sees metadata, not private errors'
    );
    const tail = await call('get_team_state', {
      runId: run.id,
      deliveryLimit: 1,
      deliveryOffset: 2,
    });
    assert.equal(tail.items[0].reply.deliveryNextOffset, null);
    assert.equal(tail.items[0].reply.deliveries[0].kind, 'failure_notice');
    const participant = leadOps.execute('buddy.get_team_state', { runId: run.id }).data as any;
    assert.ok(
      participant.items[0].reply.deliveries.some(
        (d: { error: string }) => d.error === 'PRIVATE_RETURN_DETAIL'
      )
    );
  } finally {
    await client.close();
    await server.close();
    raw.close();
  }
});

test('native retry of a legacy closed timeout creates one bounded successor and keeps the old failure', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'Closed timeout', rootPath: '/tmp/native-closed-timeout' });
  const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Manage' }),
    worker = raw.createBuddy({ project: w.id, name: 'Worker', role: 'Build' });
  raw.reparentBuddy(worker.id, { managerId: lead.id, key: 'manager' });
  for (const b of [lead, worker])
    raw.setCoordinationMembership(b.id, w.id, { background_enabled: true });
  const p = raw.createCoordinatedProject(
    {
      workspaceId: w.id,
      ownerId: worker.id,
      title: 'Verification',
      definitionOfDone: 'Saved evidence',
    },
    { actor: lead.id, key: 'project' }
  );
  const m = raw.sendCoordinatedMessage(
    {
      fromBuddy: lead.id,
      to: worker.id,
      workspace: w.id,
      project: p.id,
      key: 'old',
      purpose: 'Verify',
      body: 'Verify',
      parentConversationId: 'lead-original',
      execution: { mode: 'until_done', maxRuns: 4, maxDurationSeconds: 7200 },
    },
    { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS, max_runtime_seconds: 600 } }
  );
  const r = store.listBuddyRuns({ buddyId: worker.id })[0];
  store.claimBuddyRun(r.id, { claimToken: 'old', conversationId: 'worker' });
  store.startBuddyRun(r.id, 'old');
  store.finishBuddyRun(r.id, {
    claimToken: 'old',
    status: 'failed',
    errorCode: 'max_runtime_timeout',
    error: 'Legacy timeout',
  });
  // This is the prior runtime's real settlement method, not a fabricated receipt.
  (
    raw as unknown as {
      settleBackgroundReply(m: unknown, outcome: string, body: string, proof: string[]): void;
    }
  ).settleBackgroundReply(raw.getMessage(m.id), 'failed', 'Legacy timeout closed', [`run:${r.id}`]);
  const old = raw.getMessage(m.id);
  const deadline = raw.getBackgroundWork(m.id)!.deadline;
  const server = createBuddyMcpServer(store, {
    buddyId: lead.id,
    workspaceId: w.id,
    conversationId: 'lead-later',
  });
  const client = new Client({ name: 'closed-timeout-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return JSON.parse((result.content as Array<{ text: string }>)[0].text).data;
  };
  try {
    const view = await call('get_team_state', { targetBuddyId: worker.id });
    assert.equal(
      view.items.find((row: { runId: string }) => row.runId === r.id).recovery.mode,
      'successor_request'
    );
    const args = {
      runId: r.id,
      key: 'recover-once',
      reason: 'Reviewed the saved artifact and failed receipt',
    };
    const next = await call('retry_run', args);
    assert.notEqual(next.input_id, m.id);
    assert.equal(next.retry_of_run_id, r.id);
    assert.equal((await call('retry_run', args)).id, next.id);
    assert.deepEqual(raw.getMessage(m.id), old);
    assert.equal(raw.getBackgroundWork(next.input_id)!.deadline, deadline);
    const after = await call('get_team_state', { targetBuddyId: worker.id });
    assert.equal(
      after.items.find((row: { runId: string }) => row.runId === r.id).recovery.successorRunId,
      next.id
    );
    raw.stopBuddyMessageRoot(m.id);
    const denied = await client.callTool({
      name: 'retry_run',
      arguments: { runId: next.id, key: 'stopped', reason: 'No' },
    });
    assert.equal(denied.isError, true);
    assert.match(JSON.stringify(denied), /Stopped roots/);
  } finally {
    await client.close();
    await server.close();
    raw.close();
  }
});
