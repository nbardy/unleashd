import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import {
  type BuddyContext,
  PROTOCOL_INFO,
  createDefaultConversationConfig,
  parseClientMessage,
  parseServerMessage,
} from '@unleashd/shared';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddiesIntegration } from '../src/buddies/integration';
import { BuddyMemoryReviewer } from '../src/buddies/memory-review';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { BuddyRunExecutor } from '../src/buddies/run-executor';
import { createBuddyCreationService } from '../src/conversations/buddy-creation-service';
import { ConversationConfigService } from '../src/conversations/config-service';
import { ConversationConfigStore } from '../src/conversations/config-store';
import {
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { summarizeConversation } from '../src/conversations/serialization';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

async function until(check: () => boolean, tick: () => void) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    tick();
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('Coordination did not finish');
}

test('real creation boundary delivers two-worker aggregate and retries a failed return before admission', async () => {
  const configRoot = await mkdtemp(join(tmpdir(), 'buddy-coordination-config-'));
  const raw = new BuddiesStore(join(configRoot, 'mail.sqlite'));
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'Runtime chain', rootPath: '/tmp/buddy-runtime-chain' });
  const chief = raw.createBuddy({ project: w.id, name: 'Chief', role: 'Coordinate' });
  const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Deliver' });
  const w2 = raw.createWorkspace({ name: 'Engineering', rootPath: '/tmp/buddy-engineering' });
  raw.assignBuddyToProject({ buddy: lead.id, project: w2.id });
  const engineer = raw.createBuddy({ project: w2.id, name: 'Engineer', role: 'Build' });
  for (const b of [chief, lead])
    store.setCoordinationMembership(b.id, w.id, { background_enabled: true });
  const reviewer = raw.createBuddy({ project: w2.id, name: 'Reviewer', role: 'Review exports' });
  for (const b of [lead, engineer, reviewer])
    store.setCoordinationMembership(b.id, w2.id, { background_enabled: true });
  const conversations = new Map<string, ConversationRuntime>();
  const visits: string[] = [];
  const wireEvents: unknown[] = [];
  const integration = createBuddiesIntegration({
    store,
    getConversation: (id) => conversations.get(id),
  });
  const audienceKeys = new Map<string, string | undefined>();
  let memoryWrites = 0;
  const memoryReviewer = new BuddyMemoryReviewer({
    directory: join(configRoot, 'reviews'),
    getStore: async () => store,
    run: async ({ executeTool }) => {
      const head = executeTool('get_memory', { doc: 'working' }) as {
        content: string;
        revision: number;
      };
      executeTool('update_memory', {
        doc: 'working',
        baseVersion: head.revision,
        content: `${head.content}\nVerified lesson ${++memoryWrites}`,
        reasoning: 'Preserve thread learning',
      });
      executeTool('remember_note', {
        topic: 'Local mail evidence',
        body: `Reviewed turn ${memoryWrites}`,
      });
    },
  });
  await memoryReviewer.initialize();
  memoryReviewer.start();
  let input!: { context: BuddyContext; conversationId: string; token: string };
  let requestId = '';
  let implementationId = '';
  let reviewId = '';
  let revisionId = '';
  const config = createDefaultConversationConfig('codex');
  const Conversation = createConversationRuntime({
    broadcast: (event) => wireEvents.push(event),
    registerSessionAlias: () => {},
    unregisterSessionAlias: () => {},
    clearExternalRunningStatus: () => {},
    clearLocalCompletionSuppression: () => {},
    markLocalCompletionSuppression: () => {},
    persistCurrentSession: async () => {},
    updateBuddyStatus: () => {},
    settleBuddyDelegation: () => {},
    getConversation: (id) => conversations.get(id),
    readLatestOompaRuntime: () => ({ available: false, run: null, reason: 'fixture' }),
    createSessionId: () => `session-${visits.length}`,
    reviewCompletedBuddyTurn: (turn) => memoryReviewer.enqueue(turn),
    readCurrentBuddyContext: (context) => {
      const current = integration.readCurrentConversation(context);
      const key = JSON.stringify([context.buddyId, context.knowledgeScope]);
      if (audienceKeys.has(key))
        assert.equal(
          current.audienceKey,
          audienceKeys.get(key),
          'Learning retains same-audience provider continuity'
        );
      audienceKeys.set(key, current.audienceKey);
      return current;
    },
    beginBuddyChatRun: (context, conversationId, maxRuntimeMs) => {
      const run = store.beginBuddyChatRun({
        buddyId: context.buddyId,
        workspaceId: context.workspaceId,
        conversationId,
        allowedOperations: MESSAGE_BUDDY_OPERATIONS,
        maxRuntimeSeconds: maxRuntimeMs / 1000,
      });
      return { id: run.id, claim_token: run.claim_token!, deadline: run.deadline! };
    },
    finishBuddyChatRun: (id, token, status, detail) => {
      store.finishBuddyRun(id, { claimToken: token, status, outcome: detail });
    },
    issueBuddyControlCapability: (context, conversationId, token) => {
      input = { context, conversationId, token: token! };
      return {};
    },
    executeTurn: (() => {
      const current = input;
      const run = store.getBuddyRun(current.context.coordinationRunId!)!;
      const operations = new BuddyOperationsService(
        store,
        {
          ...current.context,
          conversationId: current.conversationId,
          allowedOperations: current.context.allowedBuddyOperations,
        },
        { automationClaimToken: current.token }
      );
      async function* events() {
        yield { type: 'turn.started' as const };
        visits.push(current.context.buddyId);
        assert.equal(run.status, 'running');
        if (!run.policy.foreground)
          assert.throws(
            () =>
              operations.execute('buddy.update_soul', {
                content: 'Escalate',
                baseVersion: 0,
                reasoning: 'message',
                key: 'unauthorized-soul',
              }),
            /allow|permi|outside|available|owner/
          );
        if (current.context.buddyId === lead.id && run.input_kind === 'message_request') {
          implementationId = store.withBuddyRunAuthority(run.id, current.token, 'buddy.send', () =>
            store.sendCoordinatedMessage(
              {
                fromBuddy: lead.id,
                to: engineer.id,
                workspace: w2.id,
                key: 'engineer',
                parentConversationId: current.conversationId,
                purpose: 'build',
                body: 'Implement export',
              },
              { runId: run.id, policy: run.policy, sourceWorkspaceId: current.context.workspaceId }
            )
          ).id;
          reviewId = store.withBuddyRunAuthority(run.id, current.token, 'buddy.send', () =>
            store.sendCoordinatedMessage(
              {
                fromBuddy: lead.id,
                to: reviewer.id,
                workspace: w2.id,
                key: 'review',
                parentConversationId: current.conversationId,
                purpose: 'review',
                body: 'Review export behavior',
              },
              { runId: run.id, policy: run.policy, sourceWorkspaceId: current.context.workspaceId }
            )
          ).id;
        } else if (current.context.buddyId === engineer.id) {
          operations.execute('buddy.reply', {
            messageId: run.input_id,
            outcome: 'done',
            body: 'Implemented',
            evidence: ['fixture:engineer'],
          });
        } else if (current.context.buddyId === reviewer.id) {
          operations.execute('buddy.reply', {
            messageId: run.input_id,
            outcome: 'changes requested',
            body: 'Cover the empty export',
            evidence: ['fixture:review'],
          });
        } else if (current.context.buddyId === lead.id) {
          if (
            store.getMessage(reviewId)?.status === 'replied' &&
            store.getMessage(implementationId)?.status === 'replied' &&
            !revisionId
          ) {
            revisionId = store.withBuddyRunAuthority(run.id, current.token, 'buddy.send', () =>
              store.sendCoordinatedMessage(
                {
                  fromBuddy: lead.id,
                  to: engineer.id,
                  workspace: w2.id,
                  key: 'revision',
                  parentConversationId: current.conversationId,
                  continueFrom: implementationId,
                  purpose: 'revise',
                  body: 'Cover the empty export',
                },
                {
                  runId: run.id,
                  policy: run.policy,
                  sourceWorkspaceId: current.context.workspaceId,
                }
              )
            ).id;
          }
          if (revisionId && store.getMessage(revisionId)?.status === 'replied')
            operations.execute('buddy.reply', {
              messageId: requestId,
              outcome: 'done',
              body: 'Reviewed implementation',
              evidence: ['fixture:lead'],
            });
        }
        if (current.context.buddyId === chief.id && run.input_kind === 'message_reply')
          conversations.get('chief')!.enqueueMessage('Owner follow-up');
        yield { type: 'text.delta' as const, text: 'Verified result' };
        yield { type: 'turn.complete' as const, reason: 'success' as const };
      }
      return {
        child: { exitCode: 0 },
        events: events(),
        completed: Promise.resolve({
          exitCode: 0,
          signal: null,
          reason: 'success',
          sessionId: `provider-${visits.length}`,
        }),
        stop: () => {},
      };
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  const create = (id: string, context: BuddyContext) => {
    const c = new Conversation({
      id,
      workingDirectory: '/tmp',
      configState: { config, revision: 0, resolution: resolveConfigAgainstProviderCatalog(config) },
      buddyContext: context,
    });
    conversations.set(id, c);
    return c;
  };

  const creation = createBuddyCreationService({
    getConversation: (id) => conversations.get(id),
    configService: new ConversationConfigService({
      store: new ConversationConfigStore({ appDataRoot: configRoot }),
      resolver: { resolve: async (value) => resolveConfigAgainstProviderCatalog(value) },
    }),
    resolveBuddyConversation: async (context) => ({
      context,
      briefing: 'Fixture team context',
      workingDirectory: '/tmp',
      provider: 'codex',
      model: 'gpt-5.6-sol',
    }),
    resolveWorkingDirectory: (directory) => directory,
    isProviderAvailable: () => true,
    createId: () => assert.fail('Executor must supply a stable conversation ID'),
    createConversation: (options) => new Conversation(options),
    registerConversation: (conversation) => conversations.set(conversation.id, conversation),
    createConversationLink: integration.createLink,
    updateConversationStatus: () => {},
    broadcast: (event) => wireEvents.push(event),
  });
  await creation.createServerBuddyConversation({
    context: { buddyId: chief.id, workspaceId: w.id },
    conversationId: 'chief',
    commandId: 'chief-fixture',
    placement: 'background',
    deferInitialMessage: true,
  });
  // Reopen the readiness cache as happens after process/session hydration.
  const originalLink = raw.listConversationLinks(chief.id)[0];
  raw.updateConversationLink('chief', { providerSessionId: 'existing-chief-session' });
  await integration.createLink(conversations.get('chief')!);
  assert.equal(raw.listConversationLinks(chief.id)[0].id, originalLink.id);
  let failedReturn = false;
  let readinessBecameBusy = false;
  let busyTurnPreserved = false;
  const executor = new BuddyRunExecutor({
    store,
    getConversation: (id) => conversations.get(id),
    createConversation: creation.createServerBuddyConversation,
    ensureConversationReady: async (conversation) => {
      if (conversation.id === 'chief' && visits.length && !failedReturn) {
        failedReturn = true;
        throw new Error('Fixture transient link storage error');
      }
      if (conversation.id === 'chief' && failedReturn && !readinessBecameBusy) {
        readinessBecameBusy = true;
        conversation.isRunning = true;
        setTimeout(() => {
          busyTurnPreserved = conversation.isRunning;
          conversation.isRunning = false;
        }, 25);
      }
      return creation.ensureConversationReady(conversation);
    },
  });
  try {
    requestId = store.sendCoordinatedMessage(
      {
        fromBuddy: chief.id,
        to: lead.id,
        workspace: w.id,
        parentConversationId: 'chief',
        purpose: 'ship',
        body: 'Ship export',
        key: 'chief',
      },
      { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
    ).id;
    await until(
      () =>
        visits.length === 9 &&
        executor.activeRunIds.length === 0 &&
        store
          .listBuddyRuns({ limit: 100 })
          .every((r) => r.status === 'complete' || r.error_code === 'delivery_pre_admission'),
      () => executor.poll()
    );
    await until(
      () => memoryWrites === visits.length && memoryReviewer.activeCount() === 0,
      () => {}
    );
    assert.equal(visits.filter((id) => id === lead.id).length, 4);
    assert.equal(visits.filter((id) => id === engineer.id).length, 2);
    assert.equal(visits.filter((id) => id === reviewer.id).length, 1);
    assert.equal(
      store.getMessage(revisionId)?.child_conversation_id,
      store.getMessage(implementationId)?.child_conversation_id
    );
    assert.equal(store.getMessage(requestId)?.status, 'replied');
    assert.ok(
      store
        .listBuddyRuns({ limit: 100 })
        .every((r) => r.status === 'complete' || r.error_code === 'delivery_pre_admission')
    );
    assert.equal(
      store
        .listBuddyRuns({ buddyId: chief.id })
        .filter((r) => r.input_kind === 'message_reply' && r.status === 'complete').length,
      1
    );
    assert.equal(
      store
        .listBuddyRuns({ buddyId: chief.id })
        .filter((r) => r.error_code === 'delivery_pre_admission').length,
      2
    );
    assert.equal(busyTurnPreserved, true, 'readiness race never stops the new owner turn');
    assert.equal(conversations.size, 4, 'return deliveries reuse their source threads');
    // Exercise the browser's actual decoder with executor-created IDs. A UUID-only
    // wire schema used to discard the entire init and every team stream event.
    const snapshots = Array.from(conversations.values(), (c) => summarizeConversation(c.toJSON()));
    assert.ok(snapshots.some((c) => c.id.startsWith('buddy-run-buddy_run_')));
    const init = parseServerMessage(
      JSON.parse(
        JSON.stringify({
          type: 'init',
          conversations: snapshots,
          summaries: true,
          defaultCwd: '/tmp',
          protocol: PROTOCOL_INFO,
        })
      )
    );
    assert.equal(init.type, 'init');
    if (init.type === 'init') assert.equal(init.conversations.length, conversations.size);
    for (const event of wireEvents) parseServerMessage(JSON.parse(JSON.stringify(event)));
    for (const conversation of snapshots) {
      for (const type of [
        'send_message',
        'queue_message',
        'interrupt_and_send',
        'stop_conversation',
        'delete_conversation',
        'clear_queue',
        'cancel_queued_message',
        'set_conversation_config',
      ]) {
        const command = {
          type,
          conversationId: conversation.id,
          commandId: 'owner-command',
          content: 'Continue this thread',
          messageId: 'queued-message',
          expectedRevision: conversation.configRevision,
          patch: { kind: 'set_model', model: { mode: 'default' } },
        };
        assert.equal(parseClientMessage(command).conversationId, conversation.id);
        assert.throws(() => parseClientMessage({ ...command, conversationId: '' }));
      }
    }
    const reopened = new BuddiesStore(join(configRoot, 'mail.sqlite'));
    try {
      assert.equal(reopened.getMessage(requestId)?.status, 'replied');
      assert.equal(
        reopened.getMessage(revisionId)?.child_conversation_id,
        reopened.getMessage(implementationId)?.child_conversation_id
      );
      assert.equal(
        reopened.listMessages({ buddy: lead.id }).length,
        raw.listMessages({ buddy: lead.id }).length
      );
    } finally {
      reopened.close();
    }

    assert.equal(
      conversations.get('chief')!.buddyContext?.allowedBuddyOperations,
      undefined,
      'restricted input never replaces the owner conversation policy'
    );
    assert.throws(
      () =>
        store.withBuddyRunAuthority(
          input.context.coordinationRunId!,
          input.token,
          'buddy.send',
          () => {}
        ),
      /authority/
    );
  } finally {
    executor.stop();
    memoryReviewer.stop();
    raw.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('thread schedules coalesce missed ticks and hold missing destinations without creating a replacement', () => {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'Schedule', rootPath: '/tmp/buddy-schedule-queue' });
  const b = raw.createBuddy({ project: w.id, name: 'Chief', role: 'Check progress' });
  let creations = 0;
  const executor = new BuddyRunExecutor({
    store,
    getConversation: () => undefined,
    createConversation: async () => {
      creations++;
      throw new Error('Unexpected creation');
    },
  });
  try {
    const definition = raw.createAutomation({
      buddy: b.id,
      workspace: w.id,
      name: 'Check completed work',
      scheduleKind: 'interval',
      scheduleExpression: '300',
      timezone: 'UTC',
      jobKind: 'prompt',
      jobPayload: {
        prompt: 'Read inbox and steer unfinished work',
        conversationId: 'deleted-thread',
      } as never,
      enabled: true,
      nextRunAt: '2026-01-01T00:00:00.000Z',
    });
    executor.enqueueSchedule(definition, '2026-01-01T00:05:00.000Z');
    executor.enqueueSchedule(raw.getAutomation(definition.id)!, '2026-01-01T00:10:00.000Z');
    assert.equal(
      store.listBuddyRuns({ buddyId: b.id }).length,
      1,
      'outstanding wakeup coalesces missed ticks'
    );
    assert.equal(raw.getAutomation(definition.id)!.next_run_at, '2026-01-01T00:10:00.000Z');
    store.setCoordinationMembership(b.id, w.id, { background_enabled: true });
    executor.poll();
    const run = store.listBuddyRuns({ buddyId: b.id })[0];
    assert.equal(run.status, 'queued');
    assert.match(run.error!, /missing/);
    assert.equal(raw.getAutomation(definition.id)!.enabled, false);
    assert.equal(creations, 0);
    const other = raw.createBuddy({ project: w.id, name: 'Other', role: 'Unrelated' });
    raw.linkConversation({
      buddy: other.id,
      workspace: w.id,
      provider: 'codex',
      unleashdConversationId: 'other-thread',
    });
    assert.throws(
      () => store.repairBuddyRun(run.id, { key: 'wrong', conversationId: 'other-thread' }),
      /match Buddy/
    );
    raw.linkConversation({
      buddy: b.id,
      workspace: w.id,
      provider: 'codex',
      unleashdConversationId: 'new-thread',
    });
    assert.equal(
      store.repairBuddyRun(run.id, { key: 'repair', conversationId: 'new-thread' }).conversation_id,
      'new-thread'
    );
  } finally {
    executor.stop();
    raw.close();
  }
});

test('private capability commits durable sends once and rejects payload conflicts and revoked turns', async () => {
  const { BuddyControlServer, BUDDY_CONTROL_TOKEN_ENV, BUDDY_CONTROL_URL_ENV } = await import(
    '../src/buddies/control-server'
  );
  const { createBuddyDispatchService } = await import('../src/buddies/dispatch-service');
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({
    name: 'Private boundary',
    rootPath: '/tmp/buddy-private-boundary',
  });
  const a = raw.createBuddy({ project: w.id, name: 'Chief', role: 'Coordinate' });
  const b = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Deliver' });
  const run = store.beginBuddyChatRun({
    buddyId: a.id,
    workspaceId: w.id,
    conversationId: 'owner-thread',
    allowedOperations: MESSAGE_BUDDY_OPERATIONS,
  });
  let creations = 0;
  const dispatch = createBuddyDispatchService({
    getStore: async () => store,
    createConversation: async () => {
      creations++;
      throw new Error('Queue producer cannot start a provider');
    },
    dispatchInitialMessage: async () => {},
    abandonConversation: () => {},
    createId: () => 'unused',
  });
  const control = new BuddyControlServer({
    getStore: async () => store,
    isConversationActive: () => true,
    dispatchMessage: dispatch.send,
    dispatchDelegation: dispatch.delegation,
    dispatchReview: dispatch.review,
  });
  await control.start();
  const env = control.issue(
    {
      buddyId: a.id,
      workspaceId: w.id,
      coordinationRunId: run.id,
      allowedBuddyOperations: MESSAGE_BUDDY_OPERATIONS,
    },
    'owner-thread',
    run.claim_token!
  );
  const send = (body: unknown) =>
    fetch(`${env[BUDDY_CONTROL_URL_ENV]}/v1/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env[BUDDY_CONTROL_TOKEN_ENV]}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  try {
    const input = { to: b.id, purpose: 'deliver', body: 'Ship export', key: 'stable' };
    const first = await send(input);
    const second = await send(input);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const one = (await first.json()) as { data: { message: { id: string } } };
    const two = (await second.json()) as { data: { message: { id: string } } };
    assert.equal(one.data.message.id, two.data.message.id);
    assert.equal(store.listBuddyRuns({ buddyId: b.id }).length, 1);
    assert.equal(creations, 0);
    assert.equal((await send({ ...input, body: 'Different work' })).status, 500);
    control.revoke('owner-thread');
    assert.notEqual((await send({ ...input, key: 'revoked' })).status, 200);
    assert.equal(raw.listMessages().length, 1);
    const result = new BuddyOperationsService(store, { buddyId: a.id, workspaceId: w.id }).execute(
      'buddy.get_runs',
      {}
    );
    assert.doesNotMatch(JSON.stringify(result), new RegExp(run.claim_token!));
    assert.doesNotMatch(JSON.stringify(result), /claim_token|claim_expires_at/);
  } finally {
    await control.close();
    raw.close();
  }
});

test('packaged owner chats retain tool authority past ten minutes and honor their configured deadline', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  try {
    const workspace = raw.createWorkspace({
      name: 'Foreground budget',
      rootPath: '/tmp/foreground-budget',
    });
    const buddy = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Build' });
    const run = store.beginBuddyChatRun({
      buddyId: buddy.id,
      workspaceId: workspace.id,
      conversationId: 'foreground-budget',
      allowedOperations: ['buddy.get_current_work'],
    });
    assert.equal(Date.parse(run.deadline!) - Date.parse(run.started_at!), 24 * 60 * 60_000);
    t.mock.timers.tick(11 * 60_000);
    assert.equal(
      store.withBuddyRunAuthority(
        run.id,
        run.claim_token!,
        'buddy.get_current_work',
        () => 'authorized'
      ),
      'authorized'
    );
    store.cancelBuddyRun(run.id);
    assert.throws(
      () =>
        store.withBuddyRunAuthority(run.id, run.claim_token!, 'buddy.get_current_work', () => {}),
      /revoked/
    );
    store.finishBuddyRun(run.id, { claimToken: run.claim_token, status: 'cancelled' });
    const configured = store.beginBuddyChatRun({
      buddyId: buddy.id,
      workspaceId: workspace.id,
      conversationId: 'foreground-budget',
      allowedOperations: ['buddy.get_current_work'],
      maxRuntimeSeconds: 1800,
    });
    assert.equal(Date.parse(configured.deadline!) - Date.parse(configured.started_at!), 1_800_000);
    t.mock.timers.tick(1_800_000);
    assert.throws(
      () =>
        store.withBuddyRunAuthority(
          configured.id,
          configured.claim_token!,
          'buddy.get_current_work',
          () => {}
        ),
      /expired/
    );
    store.finishBuddyRun(configured.id, {
      claimToken: configured.claim_token,
      status: 'failed',
      error: 'Deadline',
    });
    store.setCoordinationMembership(buddy.id, workspace.id, { background_enabled: true });
    const background = store.enqueueBuddyRun({
      inputKey: 'background-budget',
      inputKind: 'message_request',
      inputId: 'background-budget',
      buddyId: buddy.id,
      workspaceId: workspace.id,
      conversationId: 'background',
      policy: { allowed_operations: [] },
    });
    assert.throws(
      () =>
        store.claimBuddyRun(background.id, {
          claimToken: 'background-token',
          maxRuntimeSeconds: 86400,
        }),
      /runtime limit/
    );
    const claimed = store.claimBuddyRun(background.id, { claimToken: 'background-token' })!;
    assert.equal(Date.parse(claimed.deadline!) - Date.parse(claimed.started_at!), 600_000);
  } finally {
    raw.close();
  }
});

test('executor recovery poll pages live runs only, never the full run history', () => {
  // Regression guard (2026-09-19): the per-second recovery scan paginated the
  // whole buddy_runs table and hydrated every historical row — 2,252ms at
  // 1,318 rows against the live store — pinning the event loop so every WS
  // ack and HTTP response waited seconds. Behavior stays correct throughout,
  // so only a scan-shape assertion catches a reintroduction: any
  // listBuddyRuns call on this path without a status filter is the bug.
  const raw = new BuddiesStore(':memory:');
  try {
    const store = coordinationStore(raw as unknown as BuddiesStorePort);
    const workspace = raw.createWorkspace({
      name: 'History',
      rootPath: '/tmp/buddy-poll-history',
    });
    const buddy = raw.createBuddy({ project: workspace.id, name: 'Chief', role: 'Coordinate' });
    const seed = (key: string) =>
      store.enqueueBuddyRun({
        inputKey: key,
        inputKind: 'schedule',
        inputId: key,
        buddyId: buddy.id,
        workspaceId: workspace.id,
        conversationId: `thread-${key}`,
        policy: { allowed_operations: [], foreground: true },
      });
    // Terminal history: present in the table, must never be hydrated by the tick.
    const done = seed('history-done');
    store.claimBuddyRun(done.id, { claimToken: 'history' });
    store.startBuddyRun(done.id, 'history');
    store.finishBuddyRun(done.id, { claimToken: 'history', status: 'complete', outcome: 'ok' });
    const cancelled = seed('history-cancelled');
    store.cancelBuddyRun(cancelled.id);
    // Live rows: the only ones the tick may touch.
    seed('live-queued');
    const live = seed('live-claimed');
    store.claimBuddyRun(live.id, { claimToken: 'live' });

    const filters: Array<Record<string, unknown> | undefined> = [];
    const listBuddyRuns = store.listBuddyRuns.bind(store);
    store.listBuddyRuns = ((filter?: Record<string, unknown>) => {
      filters.push(filter);
      return listBuddyRuns(filter);
    }) as typeof store.listBuddyRuns;

    const executor = new BuddyRunExecutor({
      store,
      getConversation: () => undefined,
      createConversation: async () => {
        throw new Error('Unexpected creation during a recovery poll');
      },
    });
    executor.poll();

    assert.ok(filters.length > 0, 'recovery poll must consult the run index');
    for (const filter of filters) {
      assert.ok(
        filter && typeof filter.status === 'string' && filter.status.length > 0,
        `recovery poll must status-filter every run page, got ${JSON.stringify(filter)}`
      );
    }
  } finally {
    raw.close();
  }
});
