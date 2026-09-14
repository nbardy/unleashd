import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { BuddyRunExecutor } from '../src/buddies/run-executor';
import type { ConversationRuntime } from '../src/conversations/runtime';

test('failure returns survive restart, wake once in background, and respect incoming-work and stop gates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-return-'));
  const database = join(root, 'buddies.sqlite');
  let raw = new BuddiesStore(database);
  let store = coordinationStore(raw as unknown as BuddiesStorePort);
  try {
    const workspace = raw.createWorkspace({ name: 'Returns', rootPath: root });
    const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Review' });
    const worker = raw.createBuddy({ project: workspace.id, name: 'Worker', role: 'Build' });
    store.setCoordinationMembership(lead.id, workspace.id, { background_enabled: true });
    store.setCoordinationMembership(worker.id, workspace.id, { background_enabled: true });
    raw.linkConversation({
      buddy: lead.id,
      workspace: workspace.id,
      provider: 'codex',
      unleashdConversationId: 'human',
    });
    const input = {
      fromBuddy: lead.id,
      to: worker.id,
      workspace: workspace.id,
      parentConversationId: 'human',
      key: 'assignment',
      purpose: 'Build export',
      body: 'Save the export artifact export.md',
      evidence: [],
    };
    const authority = {
      policy: {
        allowed_operations: ['buddy.get_inbox', 'buddy.get_current_work', 'buddy.send'],
      },
      returnConversationId: 'background-review',
    };
    store.previewCoordinatedMessage(input, authority);
    assert.equal(store.listBuddyRuns().length, 0, 'preview creates neither work nor a review');
    const message = store.sendCoordinatedMessage(input, authority);
    assert.equal(store.sendCoordinatedMessage(input, authority).id, message.id);
    const child = store.listBuddyRuns()[0];
    const claimed = store.claimBuddyRun(child.id, {
      conversationId: 'worker',
      claimToken: 'child-token',
      maxRuntimeSeconds: 1,
    })!;
    store.startBuddyRun(child.id, 'child-token');
    store.finishBuddyRun(child.id, {
      claimToken: claimed.claim_token,
      status: 'failed',
      error: 'Turn reached its maximum runtime after 1s',
      errorCode: 'execution_failed',
    });
    const notice = store.listBuddyRuns().find((run) => run.input_kind === 'failure_notice')!;
    assert.ok(notice);
    assert.equal(notice.conversation_id, 'background-review');
    assert.equal(store.getMessage(message.id)?.parent_conversation_id, 'human');
    store.sendCoordinatedMessage(
      {
        fromBuddy: worker.id,
        to: lead.id,
        workspace: workspace.id,
        key: 'progress-return',
        purpose: 'Saved progress',
        body: 'export.md is saved',
        expectsReply: false,
        inReplyTo: message.id,
      },
      { policy: authority.policy }
    );
    raw.close();
    raw = new BuddiesStore(database);
    store = coordinationStore(raw as unknown as BuddiesStorePort);
    const visits: string[] = [];
    const audience = { kind: 'owner_thread' as const, conversationId: 'human' };
    const branch = {
      sourceConversationId: 'human',
      throughMessageId: 'snapshot-sha256:test',
      audience,
      handoff: 'Frozen owner requirement: export must be UTF-8. Pending tool call has no result.',
    };

    let creations = 0;
    let reviewing = false;
    const conversations = new Map<string, ConversationRuntime>();
    // A busy human chat must not delay the independent background return.
    conversations.set('human', {
      isRunning: true,
      hasActiveProcess: () => true,
      queue: [{}],
      placement: 'default',
    } as unknown as ConversationRuntime);
    const executor = new BuddyRunExecutor({
      store,
      getConversation: (id) => conversations.get(id),
      getConversationRecord: async (id) =>
        id === 'background-review' ? ({ creation: { branch } } as never) : null,
      createConversation: async (input) => {
        creations++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.equal(input.placement, 'background');
        assert.equal(input.context.buddyId, lead.id);
        assert.equal(input.context.parentBuddyConversationId, 'human');
        const conversation = {
          id: input.conversationId,
          placement: input.placement,
          buddyContext: input.context,
          isRunning: false,
          hasActiveProcess: () => false,
          queue: [],
          messages: [],
          runCoordinationMessage: async (
            prompt: string,
            _context: unknown,
            _token: string,
            done: (status: string, detail: string) => void
          ) => {
            visits.push(input.conversationId);
            assert.deepEqual((_context as { knowledgeScope: unknown }).knowledgeScope, audience);
            assert.match(prompt, /Frozen owner requirement: export must be UTF-8/);
            assert.doesNotMatch(prompt, /child-token/);
            assert.equal(reviewing, false, 'returns to the same thread must serialize');
            reviewing = true;
            if (visits.length === 1) assert.match(prompt, /maximum runtime/);
            assert.match(prompt, /Save the export artifact/);
            assert.match(prompt, /export.md/);
            await new Promise((resolve) => setTimeout(resolve, 5));
            reviewing = false;
            done('complete', 'Reviewed the saved export; continuation needs a new assignment.');
          },
        } as unknown as ConversationRuntime;
        conversations.set(input.conversationId, conversation);
        return conversation;
      },
    });
    store.setCoordinationMembership(lead.id, workspace.id, { background_enabled: false });
    executor.poll();
    assert.equal(store.getBuddyRun(notice.id)?.status, 'queued');
    assert.deepEqual(visits, []);
    store.setCoordinationMembership(lead.id, workspace.id, {
      background_enabled: true,
      max_active_runs: 2,
    });
    for (let i = 0; i < 20; i++) {
      executor.poll();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual(visits, ['background-review', 'background-review']);
    assert.equal(creations, 1, 'later returns reuse the background thread');
    assert.ok(store.getBuddyRun(notice.id)?.acknowledged_at);
    assert.equal(store.getBuddyRun(notice.id)?.status, 'complete');
    const stopped = store.sendCoordinatedMessage({ ...input, key: 'stopped' }, authority);
    const stoppedRun = store
      .listBuddyRuns({ limit: 100 })
      .find((run) => run.input_id === stopped.id)!;
    store.stopBuddyMessageRoot(stopped.id);
    assert.equal(store.getBuddyRun(stoppedRun.id)?.status, 'cancelled');
    executor.poll();
    assert.deepEqual(visits, ['background-review', 'background-review']);
  } finally {
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('launch snapshots persist privately per request and reject another Buddy source', async () => {
  const { createReturnConversationPreparer } = await import('../src/buddies/dispatch-service');
  const { ConversationConfigStore } = await import('../src/conversations/config-store');
  const { createDefaultConversationConfig } = await import('@unleashd/shared');
  const root = mkdtempSync(join(tmpdir(), 'buddy-launch-'));
  const disk = new ConversationConfigStore({ appDataRoot: root });
  const context = { buddyId: 'lead', workspaceId: 'workspace' };
  const source = {
    id: 'human',
    placement: 'default',
    buddyContext: context,
    messages: [{ role: 'user', content: 'First constraint', timestamp: new Date() }],
  } as unknown as ConversationRuntime;
  const prepare = createReturnConversationPreparer({
    getConversation: (id) => (id === 'human' ? source : undefined),
    configService: {
      getRecord: (id) => disk.getByConversationId(id),
      appendBranchLaunch: (id, digest, handoff) => disk.appendBranchLaunch(id, digest, handoff),
    },
    createConversation: async (input) => {
      await disk.create({
        conversationId: input.conversationId!,
        provenance: 'user',
        config: createDefaultConversationConfig('codex'),
        creation: { buddyContext: input.context, branch: input.branch },
      });
      return { id: input.conversationId } as ConversationRuntime;
    },
  });
  try {
    assert.equal(await prepare({ ...context, buddyId: 'stranger' }, 'human'), undefined);
    const first = (await prepare(context, 'human'))!;
    source.messages.push({ role: 'user', content: 'Second constraint', timestamp: new Date() });
    const second = (await prepare(context, 'human'))!;
    source.messages.push({
      role: 'user',
      content: 'Later owner message must not leak',
      timestamp: new Date(),
    });
    const reopened = new ConversationConfigStore({ appDataRoot: root });
    const branch = (await reopened.getByConversationId(first.returnConversationId))!.creation!
      .branch!;
    assert.equal(first.returnConversationId, second.returnConversationId);
    assert.notEqual(first.launch.through_message_id, second.launch.through_message_id);
    assert.match(branch.handoff, /First constraint/);
    assert.doesNotMatch(branch.handoff, /Second constraint/);
    assert.match(branch.launches![second.launch.through_message_id], /Second constraint/);
    assert.doesNotMatch(JSON.stringify(branch), /Later owner message/);
    assert.deepEqual(branch.audience, { kind: 'owner_thread', conversationId: 'human' });
    assert.doesNotMatch(JSON.stringify(first), /First constraint/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native transcript resolver verifies parsed identity and exposes a readable file', async () => {
  const { getDiskAdapter, resolveSessionTranscript } = await import('../src/adapters/registry');
  const { writeFileSync, readFileSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'buddy-transcript-'));
  const nativeId = '12345678-1234-4234-8234-123456789abc';
  const matching = join(root, `rollout-2026-09-14T00-00-00-${nativeId}.jsonl`);
  const decoy = join(root, `rollout-2026-09-14T01-00-00-${nativeId}.jsonl`);
  const rows = (id: string) =>
    [
      { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id, cwd: root } },
      {
        timestamp: new Date().toISOString(),
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Saved worker artifact export.md' },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');
  try {
    writeFileSync(decoy, rows('different-session'));
    writeFileSync(matching, rows(nativeId));
    const adapter = { ...getDiskAdapter('codex'), discoverFiles: async () => [decoy, matching] };
    const reference = await resolveSessionTranscript('codex', nativeId, adapter);
    assert.equal(reference, matching);
    assert.match(readFileSync(reference!, 'utf8'), /Saved worker artifact/);
    assert.equal(await resolveSessionTranscript('codex', 'missing-session', adapter), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('timeout reporting branches the worker then delivers its report with the source failure', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  try {
    const w = raw.createWorkspace({ name: 'Reports', rootPath: '/tmp' });
    const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Review' });
    const worker = raw.createBuddy({ project: w.id, name: 'Worker', role: 'Build' });
    for (const buddy of [lead, worker])
      store.setCoordinationMembership(buddy.id, w.id, { background_enabled: true });
    raw.linkConversation({
      buddy: lead.id,
      workspace: w.id,
      provider: 'codex',
      unleashdConversationId: 'human',
    });
    const request = store.sendCoordinatedMessage(
      {
        fromBuddy: lead.id,
        to: worker.id,
        workspace: w.id,
        parentConversationId: 'human',
        key: 'timeout',
        purpose: 'Build',
        body: 'Save export.md',
      },
      {
        returnConversationId: 'review',
        policy: {
          allowed_operations: ['buddy.get_inbox', 'buddy.get_current_work', 'buddy.reply'],
        },
      }
    );
    const source = store.listBuddyRuns().find((run) => run.input_id === request.id)!;
    store.claimBuddyRun(source.id, {
      claimToken: 'source-token',
      conversationId: 'worker-source',
      maxRuntimeSeconds: 1,
    });
    store.startBuddyRun(source.id, 'source-token');
    store.finishBuddyRun(source.id, {
      claimToken: 'source-token',
      status: 'failed',
      error: 'Maximum runtime exceeded',
      errorCode: 'max_runtime_timeout',
    });
    const visits: string[] = [];
    const conversations = new Map<string, ConversationRuntime>();
    conversations.set('worker-source', {
      messages: [{ role: 'assistant', content: 'I saved export.md before interruption' }],
      hasActiveProcess: () => false,
      isRunning: false,
      queue: [],
    } as unknown as ConversationRuntime);
    const executor = new BuddyRunExecutor({
      store,
      getConversation: (id) => conversations.get(id),
      getTranscriptReference: async () => '/tmp/worker-transcript.jsonl',
      createConversation: async (input) => {
        const runtime = {
          id: input.conversationId,
          placement: 'background',
          buddyContext: input.context,
          messages: [],
          queue: [],
          isRunning: false,
          hasActiveProcess: () => false,
          stop: () => {},
          waitForTurnDrain: async () => {},
          runCoordinationMessage: async (
            prompt: string,
            _context: unknown,
            _token: string,
            done: (status: string, detail: string) => void
          ) => {
            visits.push(input.context.buddyId);
            if (input.context.buddyId === worker.id) {
              assert.match(prompt, /I saved export.md before interruption/);
              assert.match(prompt, /Do not resume implementation/);
              done('complete', 'Saved export.md; validation remains.');
            } else {
              assert.match(prompt, /Saved export.md; validation remains/);
              assert.match(prompt, /Maximum runtime exceeded/);
              assert.match(prompt, /\/tmp\/worker-transcript.jsonl/);
              assert.doesNotMatch(prompt, /source-token/);
              done('complete', 'Reviewed artifact; next work requires validation.');
            }
          },
        } as unknown as ConversationRuntime;
        conversations.set(input.conversationId, runtime);
        return runtime;
      },
    });
    for (let i = 0; i < 30; i++) {
      executor.poll();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual(visits, [worker.id, lead.id]);
    assert.equal(store.getBuddyRun(source.id)?.status, 'failed');
  } finally {
    raw.close();
  }
});

test('same-key send replay reuses persisted launch instead of capturing newer history', async () => {
  const { createBuddyDispatchService } = await import('../src/buddies/dispatch-service');
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  try {
    const w = raw.createWorkspace({ name: 'Replay', rootPath: '/tmp' });
    const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Review' });
    const worker = raw.createBuddy({ project: w.id, name: 'Worker', role: 'Build' });
    raw.linkConversation({
      buddy: lead.id,
      workspace: w.id,
      provider: 'codex',
      unleashdConversationId: 'human',
    });
    let captures = 0;
    const dispatch = createBuddyDispatchService({
      getStore: async () => store,
      prepareReturnConversation: async () => ({
        returnConversationId: 'review',
        launch: { through_message_id: `snapshot-${++captures}` },
      }),
      createConversation: async () => {
        throw new Error('Unexpected legacy dispatch');
      },
      dispatchInitialMessage: async () => {},
      abandonConversation: () => {},
      createId: () => 'unused',
    });
    const input = {
      key: 'same-request',
      to: worker.id,
      purpose: 'Build',
      body: 'Save export.md',
      parentConversationId: 'human',
      timeoutSeconds: 120,
      evidence: [],
    };
    const context = { buddyId: lead.id, workspaceId: w.id };
    await dispatch.send(context, input as never);
    await dispatch.send(context, input as never);
    assert.equal(captures, 1);
    const message = store.getCoordinatedMessageByKey!(lead.id, w.id, input.key) as unknown as {
      return_policy: string;
    };
    assert.equal(JSON.parse(message.return_policy).launch.through_message_id, 'snapshot-1');
  } finally {
    raw.close();
  }
});

test('normal reply identifies its own worker attempt even after unrelated work', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  try {
    const w = raw.createWorkspace({ name: 'Normal return', rootPath: '/tmp' });
    const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Review' });
    const worker = raw.createBuddy({ project: w.id, name: 'Worker', role: 'Build' });
    for (const buddy of [lead, worker])
      store.setCoordinationMembership(buddy.id, w.id, { background_enabled: true });
    raw.linkConversation({
      buddy: lead.id,
      workspace: w.id,
      provider: 'codex',
      unleashdConversationId: 'human',
    });
    const authority = {
      returnConversationId: 'normal-review',
      policy: { allowed_operations: ['buddy.get_inbox', 'buddy.get_current_work', 'buddy.reply'] },
    };
    const request = store.sendCoordinatedMessage(
      {
        fromBuddy: lead.id,
        to: worker.id,
        workspace: w.id,
        parentConversationId: 'human',
        key: 'normal',
        purpose: 'Build',
        body: 'Save export.md',
      },
      authority
    );
    const source = store.listBuddyRuns().find((run) => run.input_id === request.id)!;
    store.claimBuddyRun(source.id, {
      claimToken: 'normal-token',
      conversationId: 'normal-worker',
      maxRuntimeSeconds: 120,
    });
    store.startBuddyRun(source.id, 'normal-token');
    store.finishBuddyRun(source.id, {
      claimToken: 'normal-token',
      status: 'complete',
      outcome: 'Saved export.md',
    });
    store.replyMessage(request.id, {
      buddy: worker.id,
      conversationId: 'normal-worker',
      outcome: 'complete',
      body: 'Saved export.md for review',
      evidence: ['export.md'],
    });
    const other = store.sendCoordinatedMessage(
      {
        fromBuddy: lead.id,
        to: worker.id,
        workspace: w.id,
        key: 'unrelated',
        purpose: 'Other work',
        body: 'Different assignment',
      },
      { policy: authority.policy }
    );
    const otherRun = store.listBuddyRuns().find((run) => run.input_id === other.id)!;
    store.claimBuddyRun(otherRun.id, {
      claimToken: 'other-token',
      conversationId: 'other-worker',
      maxRuntimeSeconds: 120,
    });
    store.startBuddyRun(otherRun.id, 'other-token');
    store.finishBuddyRun(otherRun.id, {
      claimToken: 'other-token',
      status: 'complete',
      outcome: 'Unrelated output',
    });
    const conversations = new Map<string, ConversationRuntime>();
    let reviewed = '';
    const executor = new BuddyRunExecutor({
      store,
      getConversation: (id) => conversations.get(id),
      createConversation: async (input) => {
        const runtime = {
          id: input.conversationId,
          placement: 'background',
          buddyContext: input.context,
          messages: [],
          queue: [],
          isRunning: false,
          hasActiveProcess: () => false,
          runCoordinationMessage: async (
            prompt: string,
            _context: unknown,
            _token: string,
            done: (status: string, detail: string) => void
          ) => {
            reviewed = prompt;
            done('complete', 'Accepted export evidence');
          },
        } as unknown as ConversationRuntime;
        conversations.set(input.conversationId, runtime);
        return runtime;
      },
    });
    for (let i = 0; i < 20; i++) {
      executor.poll();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.match(reviewed, new RegExp(source.id));
    assert.match(reviewed, /"status":"complete"/);
    assert.doesNotMatch(reviewed, new RegExp(otherRun.id));
    assert.doesNotMatch(reviewed, /Exact source attempt unavailable/);
  } finally {
    raw.close();
  }
});
