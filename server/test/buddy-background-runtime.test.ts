import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import { type BuddyContext, createDefaultConversationConfig } from '@unleashd/shared';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddyDispatchService } from '../src/buddies/dispatch-service';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { BuddyRunExecutor } from '../src/buddies/run-executor';
import { messageExecution } from '../src/buddies/team-access';
import {
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

test('restart recovery releases a drained foreground claim and wakes its conversation queue', () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-foreground-restart-'));
  const database = join(root, 'buddies.sqlite');
  let raw = new BuddiesStore(database);
  let store = coordinationStore(raw as unknown as BuddiesStorePort);
  try {
    const workspace = raw.createWorkspace({
      name: 'Restart recovery',
      rootPath: '/tmp/buddy-restart-recovery',
    });
    const buddy = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Deliver' });
    const stale = store.beginBuddyChatRun({
      buddyId: buddy.id,
      workspaceId: workspace.id,
      conversationId: 'owner-thread',
      allowedOperations: [],
      maxRuntimeSeconds: 24 * 60 * 60,
    });
    raw.close();
    raw = new BuddiesStore(database);
    store = coordinationStore(raw as unknown as BuddiesStorePort);
    let queueWakes = 0;
    const conversation = {
      isRunning: false,
      queue: [{ id: 'owner-input', content: 'continue', status: 'pending', queuedAt: new Date() }],
      hasActiveProcess: () => false,
      processQueue: () => {
        queueWakes += 1;
      },
      stop: () => undefined,
    } as unknown as ConversationRuntime;
    const executor = new BuddyRunExecutor({
      store,
      getConversation: (id) => (id === 'owner-thread' ? conversation : undefined),
      createConversation: async () => {
        throw new Error('must not create a replacement conversation');
      },
    });

    executor.poll();

    assert.equal(store.getBuddyRun(stale.id)?.status, 'failed');
    assert.equal(store.getBuddyRun(stale.id)?.error_code, 'interrupted');
    assert.equal(queueWakes, 1);
  } finally {
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});

async function backgroundWorkReturns(sourcePlacement: 'default' | 'background') {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({
    name: 'Background runtime',
    rootPath: '/tmp/buddy-background-runtime',
  });
  const buddy = raw.createBuddy({ project: w.id, name: 'Engineer', role: 'Deliver' });
  store.setCoordinationMembership(buddy.id, w.id, { background_enabled: true });
  const project = store.createCoordinatedProject(
    {
      workspaceId: w.id,
      buddyId: buddy.id,
      title: 'Export',
      definitionOfDone: 'Export empty and populated files',
      todos: [{ title: 'Implement export', definitionOfDone: 'Both cases pass' }],
    },
    { actor: buddy.id, key: 'project' }
  ) as { id: string };
  const conversations = new Map<string, ConversationRuntime>();
  const visits: string[] = [];
  let input!: { context: BuddyContext; conversationId: string; token: string };
  let workerTurns = 0;
  let returnTurns = 0;
  const config = createDefaultConversationConfig('codex');
  const Conversation = createConversationRuntime({
    broadcast: () => {},
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
    readCurrentBuddyContext: (context) => ({
      briefing: `Current profile for ${context.buddyId}; turn ${visits.length}`,
      memoryGeneration: `revision:${visits.length}`,
    }),
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
    executeTurn: ((request) => {
      const current = input;
      const run = store.getBuddyRun(current.context.coordinationRunId!)!;
      async function* events() {
        yield { type: 'turn.started' as const };
        visits.push(current.conversationId);
        if (run.input_kind === 'message_reply') {
          returnTurns++;
          assert.equal(current.conversationId, 'owner-thread');
          assert.equal(
            run.policy.execution,
            undefined,
            'return turn must not inherit the worker loop'
          );
        } else {
          workerTurns++;
          assert.notEqual(current.conversationId, 'owner-thread');
          assert.match(
            String(request.prompt),
            new RegExp(`Background work: project ${project.id}`)
          );
          assert.match(String(request.prompt), /Read get_current_work and get_inbox/);
          assert.match(String(request.prompt), /runtime continues unfinished work/);
          assert.doesNotMatch(
            String(request.prompt),
            /todoOperations|baseRevision|Write through update_project|Do not schedule self-successors|use reply with this message ID|Ending this turn leaves the request open/
          );
          const operations = new BuddyOperationsService(
            store,
            {
              ...current.context,
              conversationId: current.conversationId,
              allowedOperations: current.context.allowedBuddyOperations,
            },
            { automationClaimToken: current.token }
          );
          const work = raw.getBuddyProject(project.id)!;
          if (workerTurns === 1) {
            operations.execute('buddy.update_project', {
              projectId: project.id,
              baseRevision: work.revision,
              key: 'progress',
              status: 'in_progress',
              nextAction: 'Run the second fixture',
            });
            assert.throws(
              () =>
                operations.execute('buddy.reply', {
                  messageId: run.input_id,
                  outcome: 'done',
                  body: 'Premature completion',
                  evidence: ['not enough'],
                }),
              /complet|unfinished|criteria|evidence/i
            );
          } else {
            operations.execute('buddy.update_project', {
              projectId: project.id,
              baseRevision: work.revision,
              key: 'done',
              status: 'done',
              evidence: ['fixture: both exported files match expected bytes'],
              todoOperations: [
                {
                  operation: 'update',
                  todoId: work.todos[0].id,
                  status: 'done',
                  evidence: ['fixture: empty and populated export passed'],
                },
              ],
            });
          }
        }
        yield { type: 'text.delta' as const, text: 'Attempt drained' };
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
  const create = (id: string, context: BuddyContext, placement: 'default' | 'background') => {
    const c = new Conversation({
      id,
      workingDirectory: '/tmp',
      configState: { config, revision: 0, resolution: resolveConfigAgainstProviderCatalog(config) },
      buddyContext: context,
      placement,
    });
    conversations.set(id, c);
    return c;
  };
  const owner = create('owner-thread', { buddyId: buddy.id, workspaceId: w.id }, sourcePlacement);
  raw.linkConversation({
    buddy: buddy.id,
    workspace: w.id,
    provider: 'codex',
    unleashdConversationId: 'owner-thread',
  });
  const executor = new BuddyRunExecutor({
    store,
    getConversation: (id) => conversations.get(id),
    createConversation: async (input) =>
      create(input.conversationId, input.context, input.placement ?? 'default'),
  });
  const dispatch = createBuddyDispatchService({
    getStore: async () => store,
    createConversation: async () => {
      throw new Error('durable producer must not start provider');
    },
    dispatchInitialMessage: async () => {},
    abandonConversation: () => {},
    createId: () => 'unused',
  });
  try {
    const context = { buddyId: buddy.id, workspaceId: w.id, buddyProjectId: project.id };
    const operations = new BuddyOperationsService(store, {
      ...context,
      conversationId: 'owner-thread',
    });
    const prepared = operations.prepareMessage({
      to: buddy.id,
      projectId: project.id,
      key: 'background-start',
      purpose: 'deliver',
      body: 'Build export',
      execution: { mode: 'until_done', maxRuns: 3, maxDurationSeconds: 600 },
      expectsReply: true,
    });
    const first = (await dispatch.send(context, prepared)) as { data: { message: { id: string } } };
    const repeated = (await dispatch.send(context, prepared)) as {
      data: { message: { id: string } };
    };
    assert.equal(first.data.message.id, repeated.data.message.id);
    for (let i = 0; i < 200; i++) {
      executor.poll();
      if (
        workerTurns === 2 &&
        executor.activeRunIds.length === 0 &&
        store
          .listBuddyRuns({ limit: 100 })
          .some((run) => run.input_kind === 'message_reply' && run.status === 'complete')
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(workerTurns, 2);
    assert.equal(returnTurns, sourcePlacement === 'background' ? 1 : 0);
    const delivery = store
      .listBuddyRuns({ limit: 100 })
      .find((run) => run.input_kind === 'message_reply')!;
    if (sourcePlacement === 'default') {
      assert.equal(owner.messages.length, 0, 'mail must not append to a human transcript');
      assert.equal(owner.queue.length, 0);
      assert.equal(delivery.outcome, 'mailbox_only');
      assert.equal(delivery.acknowledged_at, null, 'mailbox storage is not provider admission');
      assert.equal(messageExecution(store, first.data.message.id).delivery?.[0].mailboxOnly, true);
      assert.equal(
        raw.getMessageExecution(first.data.message.id).delivery?.[0].acknowledgedAt,
        null
      );
      await assert.rejects(
        owner.runCoordinationMessage(
          'Injected mail',
          { ...context, coordinationRunId: delivery.id },
          delivery.claim_token!
        ),
        /background conversation/
      );
      assert.equal(owner.messages.length, 0);
    } else {
      assert.ok(delivery.acknowledged_at);
      assert.equal(messageExecution(store, first.data.message.id).delivery?.[0].mailboxOnly, false);
    }
    assert.equal(conversations.size, 2);
    assert.equal(new Set(visits.filter((id) => id !== 'owner-thread')).size, 1);
    const worker = conversations.get(visits.find((id) => id !== 'owner-thread')!)!;
    const requests = worker.messages.filter((message) => message.role === 'user');
    assert.equal(requests.length, 2, 'both attempts remain visible in the worker transcript');
    for (const request of requests) {
      assert.ok(request.content.includes('\nBuild export\n'), 'preserve the authored request body');
      assert.ok(request.content.includes(`Background work: project ${project.id}`));
      assert.doesNotMatch(
        request.content,
        /todoOperations|baseRevision|Write through update_project|Do not schedule self-successors|use reply with this message ID|Ending this turn leaves the request open/
      );
    }
    assert.equal(store.getMessage(first.data.message.id)?.status, 'replied');
    const execution = raw.getMessageExecution(first.data.message.id);
    assert.equal(execution.background?.disposition, 'done');
    assert.equal(execution.background?.runsUsed, 2);
    assert.equal(store.listBuddyRuns({ limit: 100 }).length, 3);
    assert.ok(store.listBuddyRuns({ limit: 100 }).every((run) => run.status === 'complete'));
    if (sourcePlacement === 'default') {
      const source = store.beginBuddyChatRun({
        buddyId: buddy.id,
        workspaceId: w.id,
        conversationId: owner.id,
        allowedOperations: MESSAGE_BUDDY_OPERATIONS,
        maxRuntimeSeconds: 1800,
      });
      const recipient = raw.createBuddy({ project: w.id, name: 'Recipient', role: 'Review' });
      store.setCoordinationMembership(recipient.id, w.id, { background_enabled: true });
      create('recipient-human', { buddyId: recipient.id, workspaceId: w.id }, 'default');
      raw.linkConversation({
        buddy: recipient.id,
        workspace: w.id,
        provider: 'codex',
        unleashdConversationId: 'recipient-human',
      });
      const sendToHumanThread = (expectsReply: boolean) =>
        store.sendCoordinatedMessage(
          {
            fromBuddy: buddy.id,
            to: expectsReply ? recipient.id : buddy.id,
            workspace: w.id,
            parentConversationId: owner.id,
            purpose: expectsReply ? 'follow-up work' : 'inform',
            body: expectsReply
              ? 'Work must use a background destination.'
              : 'A durable informational update.',
            key: expectsReply ? 'human-work-request' : 'human-inform',
            expectsReply,
          },
          { runId: source.id, policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
        );
      const inform = sendToHumanThread(false);
      const request = sendToHumanThread(true);
      const pending = store
        .listBuddyRuns({ limit: 100 })
        .find((run) => run.input_id === request.id)!;
      store.repairBuddyRun(pending.id, {
        key: 'legacy-human-destination',
        conversationId: 'recipient-human',
      });
      store.finishBuddyRun(source.id, { claimToken: source.claim_token, status: 'complete' });
      for (let i = 0; i < 200; i++) {
        executor.poll();
        if (
          executor.activeRunIds.length === 0 &&
          store.listBuddyRuns({ status: 'queued' }).length === 0
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const runs = store.listBuddyRuns({ limit: 100 });
      const infoRun = runs.find((run) => run.input_id === inform.id)!;
      assert.equal(infoRun.outcome, 'mailbox_only');
      assert.equal(infoRun.acknowledged_at, null);
      const rejected = runs.find((run) => run.input_id === request.id)!;
      assert.equal(
        rejected.status,
        'failed',
        'required work is not silently treated as completed mail'
      );
      assert.equal(rejected.error_code, 'delivery_scope_conflict');
      const notice = runs.find(
        (run) => run.input_kind === 'failure_notice' && run.input_id === rejected.id
      )!;
      assert.equal(notice.outcome, 'mailbox_only');
      assert.equal(notice.acknowledged_at, null);
      executor.poll();
      assert.equal(
        store.listBuddyRuns({ limit: 100 }).length,
        runs.length,
        'mailbox delivery does not retry'
      );
      assert.equal(owner.messages.length, 0);
      assert.equal(owner.queue.length, 0);
      assert.equal(returnTurns, 0);
      assert.equal(store.getMessage(inform.id)?.body, 'A durable informational update.');
      assert.equal(conversations.get('recipient-human')!.messages.length, 0);
      assert.equal(conversations.size, 3, 'mail does not create a replacement owner thread');
    }
  } finally {
    executor.stop();
    raw.close();
  }
}

for (const placement of ['default', 'background'] as const) {
  test(`background self work returns to the ${placement === 'default' ? 'mailbox for a human chat' : 'original background thread'}`, () =>
    backgroundWorkReturns(placement));
}
