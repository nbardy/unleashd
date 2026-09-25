import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Provider } from '@unleashd/shared';
import { type ConversationConfig, createDefaultConversationConfig } from '@unleashd/shared';
import type { CompletedBuddyTurn } from '../src/buddies/memory-review';
import {
  buildFirstTurnCliContent,
  extractBuddyMemorySnapshot,
  resolveAutomationMemoryWritePolicy,
} from '../src/buddies/turn-policy';
import { TURN_MAX_RUNTIME_MS } from '../src/constants/timeouts';
import {
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';
import { type TurnTimeoutKind, TurnWatchdog } from '../src/turns/watchdog';
import { sameKeyAudience } from './fixtures/buddy-audience';
import { fakeExecuteTurn } from './fixtures/fake-turn';

function runtimeFixture(
  options: {
    provider?: Provider;
    config?: ConversationConfig;
    getConversation?: ConversationRuntimeDependencies['getConversation'];
    persistCurrentSession?: ConversationRuntimeDependencies['persistCurrentSession'];
    executeTurn?: ConversationRuntimeDependencies['executeTurn'];
    turnAttempts?: ConversationRuntimeDependencies['turnAttempts'];
    requestAutomationCancellation?: ConversationRuntimeDependencies['requestAutomationCancellation'];
    revokeBuddyControlCapability?: ConversationRuntimeDependencies['revokeBuddyControlCapability'];
    enqueueBuddyChatRun?: ConversationRuntimeDependencies['enqueueBuddyChatRun'];
    startBuddyChatRun?: ConversationRuntimeDependencies['startBuddyChatRun'];
    abandonBuddyChatRun?: ConversationRuntimeDependencies['abandonBuddyChatRun'];
    finishBuddyChatRun?: ConversationRuntimeDependencies['finishBuddyChatRun'];
    reviewCompletedBuddyTurn?: ConversationRuntimeDependencies['reviewCompletedBuddyTurn'];
    readCurrentBuddyContext?: ConversationRuntimeDependencies['readCurrentBuddyContext'];
    buddyContext?: CompletedBuddyTurn['context'];
  } = {}
) {
  const aliases: Array<[string, string]> = [];
  const broadcasts: unknown[] = [];
  const config = options.config ?? createDefaultConversationConfig(options.provider ?? 'codex');
  const Conversation = createConversationRuntime({
    broadcast: (message) => broadcasts.push(message),
    registerSessionAlias: (sessionId, conversationId) => {
      if (sessionId) aliases.push([sessionId, conversationId]);
    },
    unregisterSessionAlias: () => undefined,
    clearExternalRunningStatus: () => undefined,
    clearLocalCompletionSuppression: () => undefined,
    markLocalCompletionSuppression: () => undefined,
    persistCurrentSession: options.persistCurrentSession ?? (async () => undefined),
    updateBuddyStatus: () => undefined,
    settleBuddyDelegation: () => undefined,
    getConversation: options.getConversation ?? (() => undefined),
    readLatestOompaRuntime: async () => ({
      available: false,
      run: null,
      reason: 'No runs directory found',
    }),
    createSessionId: () => 'rotated-session',
    executeTurn: options.executeTurn,
    turnAttempts: options.turnAttempts,
    requestAutomationCancellation: options.requestAutomationCancellation,
    revokeBuddyControlCapability: options.revokeBuddyControlCapability,
    enqueueBuddyChatRun: options.enqueueBuddyChatRun,
    startBuddyChatRun: options.startBuddyChatRun,
    abandonBuddyChatRun: options.abandonBuddyChatRun,
    finishBuddyChatRun: options.finishBuddyChatRun,
    reviewCompletedBuddyTurn: options.reviewCompletedBuddyTurn,
    readCurrentBuddyContext: options.readCurrentBuddyContext,
  });
  const configState = {
    config,
    revision: 0,
    resolution: resolveConfigAgainstProviderCatalog(config),
  };
  const conversation = new Conversation({
    done: false,
    id: 'conversation-id',
    workingDirectory: '/tmp',
    configState,
    buddyContext: options.buddyContext,
  });
  return { aliases, broadcasts, configState, Conversation, conversation };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  assertion();
}

test('retained Buddy display history stays out of fresh provider context across audience resets', async () => {
  type Request = Parameters<NonNullable<ConversationRuntimeDependencies['executeTurn']>>[0];
  const requests: Request[] = [];
  let current = {
    briefing: 'CURRENT_OWNER_BRIEFING',
    memoryGeneration: '1',
    audience: sameKeyAudience('owner-audience'),
  };
  const fixture = runtimeFixture({
    readCurrentBuddyContext: () => current,
    executeTurn: fakeExecuteTurn((request) => {
      requests.push(request);
      const sessionId = request.resumeSessionId ?? `native-${requests.length}`;
      return {
        child: { exitCode: 0 },
        events: (async function* () {
          yield { type: 'session.started' as const, sessionId };
          yield { type: 'turn.started' as const };
          yield { type: 'text.delta' as const, text: `Response ${requests.length}` };
          yield { type: 'turn.complete' as const, reason: 'success' as const };
        })(),
        completed: Promise.resolve({ exitCode: 0, signal: null, sessionId, reason: 'success' }),
        stop: () => undefined,
      };
    }),
  });
  const conversation = new fixture.Conversation({
    done: false,
    id: 'restored-buddy',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    buddyContext: { buddyId: 'buddy', workspaceId: 'workspace' },
    existingSessionId: 'unverified-restored-session',
  });
  const originalDate = new Date('2026-09-09T04:45:02.313Z');
  conversation.createdAt = originalDate;
  conversation.messages = [
    { role: 'user', content: 'PRIOR_PRIVATE_TRANSCRIPT', timestamp: originalDate },
    { role: 'assistant', content: 'PRIOR_PRIVATE_ANSWER', timestamp: originalDate },
  ];
  const turn = async (content: string) => {
    conversation.sendMessage(content, { origin: 'owner_input', inputId: content });
    await eventually(() => assert.equal(conversation.hasActiveProcess(), false));
  };

  await turn('First followup');
  assert.equal(requests[0].resumeSessionId, undefined, 'restored audience is unverified');
  assert.match(requests[0].prompt, /CURRENT_OWNER_BRIEFING/);

  current = { ...current, briefing: 'UPDATED_OWNER_MEMORY', memoryGeneration: '2' };
  await turn('Second followup');
  assert.equal(requests[1].resumeSessionId, 'native-1', 'unchanged audience resumes');
  assert.match(requests[1].prompt, /UPDATED_OWNER_MEMORY/);

  current = {
    briefing: 'NARROWED_BRIEFING',
    memoryGeneration: '3',
    audience: sameKeyAudience('narrowed'),
  };
  await turn('Third followup');
  assert.equal(requests[2].resumeSessionId, undefined, 'changed audience starts fresh');
  assert.match(requests[2].prompt, /NARROWED_BRIEFING/);
  assert.doesNotMatch(requests[2].prompt, /CURRENT_OWNER_BRIEFING|UPDATED_OWNER_MEMORY/);
  for (const request of requests) {
    assert.doesNotMatch(request.prompt, /PRIOR_PRIVATE_TRANSCRIPT|PRIOR_PRIVATE_ANSWER/);
  }
  assert.deepEqual(
    conversation.messages.slice(0, 2).map((message) => message.content),
    ['PRIOR_PRIVATE_TRANSCRIPT', 'PRIOR_PRIVATE_ANSWER']
  );
  assert.equal(conversation.messages.length, 8);
  assert.equal(conversation.createdAt, originalDate);
});

test('resumed Buddy turns re-brief only when the memory generation changes', async () => {
  // Regression: from 5c0cec4 (2026-09-20) every Buddy turn re-sent the full
  // ~20k-char briefing, so a provider transcript carried one copy per turn
  // (44 in one session) and every later step re-read all of them.
  type Request = Parameters<NonNullable<ConversationRuntimeDependencies['executeTurn']>>[0];
  const requests: Request[] = [];
  let current = {
    briefing: 'BRIEFING_GEN_1',
    memoryGeneration: '1',
    audience: sameKeyAudience('owner'),
  };
  const fixture = runtimeFixture({
    readCurrentBuddyContext: () => current,
    executeTurn: fakeExecuteTurn((request) => {
      requests.push(request);
      const sessionId = request.resumeSessionId ?? 'native-session';
      return {
        child: { exitCode: 0 },
        events: (async function* () {
          yield { type: 'session.started' as const, sessionId };
          yield { type: 'turn.started' as const };
          yield { type: 'turn.complete' as const, reason: 'success' as const };
        })(),
        completed: Promise.resolve({ exitCode: 0, signal: null, sessionId, reason: 'success' }),
        stop: () => undefined,
      };
    }),
  });
  const conversation = new fixture.Conversation({
    done: false,
    id: 'steady-buddy',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    buddyContext: { buddyId: 'buddy', workspaceId: 'workspace' },
  });
  const turn = async (content: string) => {
    conversation.sendMessage(content, { origin: 'owner_input', inputId: content });
    await eventually(() => assert.equal(conversation.hasActiveProcess(), false));
  };

  await turn('one');
  await turn('two');
  current = { ...current, briefing: 'BRIEFING_GEN_2', memoryGeneration: '2' };
  await turn('three');
  await turn('four');

  assert.deepEqual(
    requests.map((request) => request.prompt.match(/BRIEFING_GEN_\d/)?.[0] ?? 'none'),
    ['BRIEFING_GEN_1', 'none', 'BRIEFING_GEN_2', 'none']
  );
  assert.deepEqual(
    requests.map((request) => request.resumeSessionId),
    [undefined, 'native-session', 'native-session', 'native-session']
  );
});

test('provider completion waits for the normalized event stream and session persistence', async () => {
  const persistence = deferred<void>();
  const completion = deferred<{
    exitCode: number;
    signal: null;
    sessionId: string;
    reason: 'success';
  }>();
  async function* events() {
    yield { type: 'session.started' as const, sessionId: 'provider-session' };
    yield { type: 'turn.started' as const };
    yield { type: 'text.delta' as const, text: 'durable output' };
    yield { type: 'turn.complete' as const, reason: 'success' as const };
  }
  const revoked: string[] = [];
  const reviews: CompletedBuddyTurn[] = [];
  const fixture = runtimeFixture({
    buddyContext: { buddyId: 'buddy-1', workspaceId: 'workspace-1' },
    reviewCompletedBuddyTurn: (turn) => reviews.push(turn),
    persistCurrentSession: () => persistence.promise,
    revokeBuddyControlCapability: (conversationId) => revoked.push(conversationId),
    executeTurn: fakeExecuteTurn(() => ({
      child: { exitCode: 0 },
      events: events(),
      completed: completion.promise,
      stop: () => undefined,
    })),
  });
  let automationOutput: string | null = null;
  fixture.conversation.once('buddy-turn-complete', (output) => {
    assert.equal(reviews.length, 1, 'snapshot precedes listeners admitting a new turn');
    automationOutput = output;
  });

  fixture.conversation.sendMessage('Run the turn');
  completion.resolve({
    exitCode: 0,
    signal: null,
    sessionId: 'provider-session',
    reason: 'success',
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fixture.conversation.hasActiveProcess(), true);
  assert.equal(
    automationOutput,
    null,
    'automation ownership must not release on turn.complete before process/event drain'
  );
  assert.equal(
    fixture.conversation.messages.some((message) => message.content.includes('durable output')),
    false,
    'completion must not release ownership while session persistence blocks event consumption'
  );
  assert.deepEqual(revoked, [], 'control authority remains until the joined turn drains');
  assert.equal(reviews.length, 0, 'memory review also waits for process exit and event drain');

  persistence.resolve();
  await eventually(() => assert.equal(fixture.conversation.hasActiveProcess(), false));
  assert.equal(
    fixture.conversation.messages.some((message) => message.content.includes('durable output')),
    true
  );
  assert.equal(automationOutput, 'durable output');
  assert.deepEqual(revoked, ['conversation-id']);
  assert.equal(reviews.length, 1);
  assert.ok(reviews[0].messages.some((message) => message.content === 'durable output'));
  assert.ok(reviews[0].attemptId);
});

test('event-stream failure after turn.complete fails automation after joined drain', async () => {
  const reviews: CompletedBuddyTurn[] = [];
  async function* events() {
    yield { type: 'turn.started' as const };
    yield { type: 'text.delta' as const, text: 'partial output' };
    yield { type: 'turn.complete' as const, reason: 'success' as const };
    throw new Error('event stream failed after completion marker');
  }
  const fixture = runtimeFixture({
    buddyContext: { buddyId: 'buddy-1', workspaceId: 'workspace-1' },
    reviewCompletedBuddyTurn: (turn) => reviews.push(turn),
    executeTurn: fakeExecuteTurn(() => ({
      child: { exitCode: 0 },
      events: events(),
      completed: Promise.resolve({
        exitCode: 0,
        signal: null,
        sessionId: 'provider-session',
        reason: 'success',
      }),
      stop: () => undefined,
    })),
  });
  let completed = false;
  let failure: string | null = null;
  fixture.conversation.once('buddy-turn-complete', () => {
    completed = true;
  });
  fixture.conversation.once('buddy-turn-failed', (reason) => {
    failure = reason;
  });

  fixture.conversation.sendMessage('Run the turn');
  await eventually(() => assert.equal(fixture.conversation.hasActiveProcess(), false));

  assert.equal(completed, false);
  assert.equal(failure, 'event stream failed after completion marker');
  assert.deepEqual(reviews, []);
});

test('only a successfully exited Buddy turn schedules memory review', async () => {
  for (const outcome of ['ordinary', 'failed', 'cancelled', 'success'] as const) {
    const reviews: CompletedBuddyTurn[] = [];
    const child = Object.assign(new EventEmitter(), { exitCode: 0 });
    const completion = deferred<{
      exitCode: number;
      signal: null;
      sessionId: string;
      reason: 'success' | 'error';
    }>();
    const fixture = runtimeFixture({
      buddyContext:
        outcome === 'ordinary' ? undefined : { buddyId: 'buddy-1', workspaceId: 'workspace-1' },
      reviewCompletedBuddyTurn: (turn) => reviews.push(turn),
      executeTurn: fakeExecuteTurn(() => ({
        child,
        events: (async function* () {
          yield { type: 'turn.started' as const };
          yield { type: 'text.delta' as const, text: 'Completed answer' };
          yield { type: 'turn.complete' as const, reason: 'success' as const };
        })(),
        completed: completion.promise,
        stop: () => undefined,
      })),
    });
    fixture.conversation.sendMessage('Remember our result');
    if (outcome === 'cancelled') fixture.conversation.stop();
    completion.resolve({
      exitCode: outcome === 'failed' ? 1 : 0,
      signal: null,
      sessionId: 'review-session',
      reason: outcome === 'failed' ? 'error' : 'success',
    });
    await eventually(() => assert.equal(fixture.conversation.hasActiveProcess(), false));
    assert.equal(reviews.length, outcome === 'success' ? 1 : 0, outcome);
  }
});

test('preflight failure immediately rejects an automation turn listener', () => {
  const config: ConversationConfig = {
    provider: 'codex',
    model: { mode: 'explicit', modelId: 'model-that-does-not-exist' },
    reasoning: { mode: 'default' },
  };
  const { conversation } = runtimeFixture({ config });
  let failure: string | undefined;
  conversation.once('buddy-turn-failed', (reason) => {
    failure = reason;
  });

  conversation.sendMessage('Run an automation');

  assert.equal(
    failure,
    'Configuration unavailable: Model is unavailable for codex: model-that-does-not-exist'
  );
  assert.equal(conversation.hasActiveProcess(), false);
});

test('synchronous provider startup failure notifies automation listeners', () => {
  const { conversation } = runtimeFixture({
    executeTurn: fakeExecuteTurn(() => {
      throw new Error('provider startup rejected');
    }),
  });
  let failure: string | undefined;
  conversation.once('buddy-turn-failed', (reason) => {
    failure = reason;
  });

  assert.throws(() => conversation.sendMessage('Run an automation'), /provider startup rejected/);
  assert.equal(failure, 'provider startup rejected');
  assert.equal(conversation.hasActiveProcess(), false);
});

test('unsupported Buddy provider leaves a queued message retryable', () => {
  const fixture = runtimeFixture({ provider: 'gemini' });
  const conversation = new fixture.Conversation({
    done: false,
    id: 'gemini-buddy',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    buddyContext: {
      buddyId: 'buddy-1',
      workspaceId: 'workspace-1',
      buddyProjectId: null,
      legacyWorkItemId: null,
      automationRunId: null,
      delegatedByBuddyId: null,
      parentBuddyConversationId: null,
      allowedBuddyOperations: ['read'],
    },
  });

  assert.equal(conversation.kind.kind, 'buddy');
  conversation.enqueueMessage('Hello Buddy');

  assert.equal(conversation.isRunning, false);
  assert.equal(conversation.hasActiveProcess(), false);
  assert.equal(conversation.queue[0]?.status, 'pending');
  assert.match(
    conversation.messages.at(-1)?.content ?? '',
    /cannot start Buddy conversations.*required Buddy state tools/
  );
});

// Owner decision 2026-09-25: a Buddy at its run limit delays a chat/channel turn
// instead of failing it. Before this, the turn threw "Conversation execution
// slot is unavailable" and the channel posted "Couldn't reply".
test('a foreground Buddy turn over capacity waits pending, then starts once admitted', async () => {
  let free = false;
  let providerStarts = 0;
  const abandoned: string[] = [];
  const settlements: unknown[][] = [];
  const executeTurn = fakeExecuteTurn(() => {
    providerStarts += 1;
    return {
      child: { exitCode: 0 },
      events: (async function* () {
        yield { type: 'turn.started' as const };
        yield { type: 'turn.complete' as const, reason: 'success' as const };
      })(),
      completed: Promise.resolve({
        exitCode: 0,
        signal: null,
        reason: 'success' as const,
        sessionId: 'provider-session',
      }),
      stop: () => undefined,
    };
  });
  const fixture = runtimeFixture({
    buddyContext: { buddyId: 'busy-buddy', workspaceId: 'workspace-1' },
    enqueueBuddyChatRun: () => ({ id: 'queued-turn' }),
    startBuddyChatRun: (runId) =>
      free
        ? {
            kind: 'admitted',
            run: {
              id: runId,
              claim_token: 'claim',
              deadline: new Date(Date.now() + 60_000).toISOString(),
            },
          }
        : { kind: 'waiting', reason: 'Waiting for a run slot: 5 of 5 active.' },
    abandonBuddyChatRun: (runId) => abandoned.push(runId),
    finishBuddyChatRun: (...args) => settlements.push(args),
    executeTurn,
  });
  const { conversation } = fixture;

  // A direct send (the channel responder's path) lines up in the queue too.
  conversation.sendMessage('Reply in the thread', { origin: 'owner_input', inputId: 'post-1' });
  assert.equal(providerStarts, 0);
  assert.equal(conversation.queue.length, 1);
  assert.equal(conversation.queue[0]?.status, 'pending');
  assert.equal(conversation.isRunning, false);

  free = true;
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(providerStarts, 1, 'the poller starts the turn once its Buddy has a slot');
  assert.deepEqual(abandoned, []);
});

test('stopping a turn that waits for a run slot drops it and releases its place', () => {
  const abandoned: string[] = [];
  const fixture = runtimeFixture({
    buddyContext: { buddyId: 'busy-buddy', workspaceId: 'workspace-1' },
    enqueueBuddyChatRun: () => ({ id: 'queued-turn' }),
    startBuddyChatRun: () => ({ kind: 'waiting', reason: 'full' }),
    abandonBuddyChatRun: (runId) => abandoned.push(runId),
  });
  fixture.conversation.enqueueMessage('Wait for me', { origin: 'owner_input', inputId: 'owner' });
  assert.equal(fixture.conversation.queue.length, 1);
  fixture.conversation.stop();
  assert.equal(fixture.conversation.queue.length, 0);
  assert.deepEqual(abandoned, ['queued-turn'], 'a waiting row left behind would pin the FIFO line');
});

test('waiting Buddy chats share one admission tick, which stops when the last one leaves', () => {
  // Regression guard for 03-app-core.md §5 #2: each waiting conversation used
  // to own a 1 s setInterval into sync SQLite, so N queued chats meant N timers.
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const ticks = new Set<unknown>();
  let cleared = 0;
  globalThis.setInterval = ((handler: () => void, ms?: number) => {
    const timer = realSetInterval(handler, ms);
    if (ms === 1000) ticks.add(timer);
    return timer;
  }) as typeof setInterval;
  globalThis.clearInterval = ((timer: Parameters<typeof clearInterval>[0]) => {
    if (ticks.has(timer)) cleared += 1;
    realClearInterval(timer);
  }) as typeof clearInterval;
  try {
    const waiting = ['a', 'b', 'c'].map((id) => {
      const fixture = runtimeFixture({
        buddyContext: { buddyId: 'busy-buddy', workspaceId: 'workspace-1' },
        enqueueBuddyChatRun: () => ({ id: `queued-${id}` }),
        startBuddyChatRun: () => ({ kind: 'waiting', reason: 'full' }),
        abandonBuddyChatRun: () => undefined,
      });
      fixture.conversation.enqueueMessage('Wait', { origin: 'owner_input', inputId: id });
      return fixture.conversation;
    });
    assert.equal(ticks.size, 1, 'three waiting chats must share one admission timer');
    waiting[0].stop();
    waiting[1].stop();
    assert.equal(cleared, 0, 'the tick must survive while a chat still waits');
    waiting[2].stop();
    assert.equal(cleared, 1, 'the tick must stop once nobody waits');
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

test('historical automation transcripts refuse every user turn-admission path', () => {
  let providerStarts = 0;
  const fixture = runtimeFixture({
    executeTurn: fakeExecuteTurn(() => {
      providerStarts += 1;
      throw new Error('must not start');
    }),
  });
  const conversation = new fixture.Conversation({
    done: false,
    id: 'automation-history',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    buddyContext: {
      buddyId: 'buddy-1',
      workspaceId: 'workspace-1',
      automationRunId: 'terminal-run',
    },
  });

  conversation.sendMessage('Continue this completed automation');
  conversation.enqueueMessage('Queue work on this completed automation');
  conversation.interruptAndSend('Interrupt this completed automation');

  assert.equal(providerStarts, 0);
  assert.equal(conversation.hasActiveProcess(), false);
  assert.deepEqual(conversation.queue, []);
  assert.match(conversation.messages.at(-1)?.content ?? '', /automation transcript is read-only/);
});

test('public stop delegates automation cancellation without killing provider authority directly', async () => {
  const cancellationRequests: string[] = [];
  const fixture = runtimeFixture({
    requestAutomationCancellation: async (runId) => {
      cancellationRequests.push(runId);
    },
  });
  const conversation = new fixture.Conversation({
    done: false,
    id: 'active-automation',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    automationClaimToken: 'private-claim-token',
    buddyContext: {
      buddyId: 'buddy-1',
      workspaceId: 'workspace-1',
      automationRunId: 'active-run',
    },
  });

  conversation.stop();
  await eventually(() => assert.deepEqual(cancellationRequests, ['active-run']));

  // Only the scheduler-owned path may enter the provider stop boundary after
  // durable cancel_requested has revoked tool authority.
  assert.doesNotThrow(() => conversation.stopAutomationTurn());
});

test('first message in a user fork inherits the native source session without copying history', () => {
  const conversations = new Map<
    string,
    ReturnType<ConversationRuntimeDependencies['getConversation']>
  >();
  const fixture = runtimeFixture({
    getConversation: (id) => conversations.get(id),
  });
  const source = new fixture.Conversation({
    done: false,
    id: 'source-conversation',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    existingSessionId: 'source-native-session',
  });
  conversations.set(source.id, source);

  const child = new fixture.Conversation({
    done: false,
    id: 'child-conversation',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    resumedFromConversationId: source.id,
  });
  let spawned: { content: string; forkSourceSessionId?: string } | undefined;
  (
    child as unknown as {
      spawnForMessage(
        content: string,
        executionConfig: unknown,
        forkSourceSessionId?: string
      ): void;
    }
  ).spawnForMessage = (content, _executionConfig, forkSourceSessionId) => {
    spawned = { content, forkSourceSessionId };
  };

  child.enqueueMessage('Continue the original objective from this fork.');

  assert.deepEqual(spawned, {
    content: 'Continue the original objective from this fork.',
    forkSourceSessionId: 'source-native-session',
  });
  assert.deepEqual(
    child.messages.map((message) => message.content),
    ['Continue the original objective from this fork.']
  );
});

test('first Buddy prompt carries a recoverable immutable memory snapshot', () => {
  const content = buildFirstTurnCliContent({
    content: 'Start the task',
    messageCount: 0,
    hasStartedSession: false,
    kind: {
      kind: 'buddy',
      buddyId: 'buddy-1',
      workspaceId: 'workspace-1',
      buddyProjectId: null,
      legacyWorkItemId: null,
      automationRunId: null,
      delegatedByBuddyId: null,
      parentBuddyConversationId: null,
    },
    buddyBriefing: 'Memory generation seven',
    buddyMemoryGeneration: 7,
    swarmDebugPrefix: null,
  });

  const snapshot = extractBuddyMemorySnapshot(content);
  assert.deepEqual(snapshot, {
    generation: '7',
    briefing: 'Memory generation seven',
  });
  assert.match(content, /Start the task$/);
});

test('native session fork falls back to a fresh handoff when memory generation changes', () => {
  const conversations = new Map<
    string,
    ReturnType<ConversationRuntimeDependencies['getConversation']>
  >();
  const fixture = runtimeFixture({
    getConversation: (id) => conversations.get(id),
  });
  const buddyContext = {
    buddyId: 'buddy-1',
    workspaceId: 'workspace-1',
    buddyProjectId: null,
    legacyWorkItemId: null,
    automationRunId: null,
    delegatedByBuddyId: null,
    parentBuddyConversationId: null,
  };
  const source = new fixture.Conversation({
    done: false,
    id: 'source-buddy-conversation',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    existingSessionId: 'source-native-session',
    buddyContext,
    buddyBriefing: 'Old memory',
    buddyMemoryGeneration: 'generation-6',
  });
  conversations.set(source.id, source);

  const child = new fixture.Conversation({
    done: false,
    id: 'child-buddy-conversation',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    resumedFromConversationId: source.id,
    buddyContext,
    buddyBriefing: 'New memory',
    buddyMemoryGeneration: 'generation-7',
  });
  let spawned: { content: string; forkSourceSessionId?: string } | undefined;
  (
    child as unknown as {
      spawnForMessage(
        content: string,
        executionConfig: unknown,
        forkSourceSessionId?: string
      ): void;
    }
  ).spawnForMessage = (content, _executionConfig, forkSourceSessionId) => {
    spawned = { content, forkSourceSessionId };
  };

  child.enqueueMessage('Continue with current memory.');

  assert.equal(spawned?.forkSourceSessionId, undefined);
  assert.match(spawned?.content ?? '', /New memory/);
  assert.doesNotMatch(spawned?.content ?? '', /Old memory/);
});

test('automation memory-write policy is explicit and provider-scoped', () => {
  assert.equal(
    resolveAutomationMemoryWritePolicy({
      isAutomation: false,
      provider: 'codex',
      hasClaimToken: false,
    }),
    'not_applicable'
  );
  assert.equal(
    resolveAutomationMemoryWritePolicy({
      isAutomation: true,
      provider: 'codex',
      hasClaimToken: true,
    }),
    'denied'
  );
  assert.equal(
    resolveAutomationMemoryWritePolicy({
      isAutomation: true,
      provider: 'muse',
      allowedOperations: ['buddy.update_memory'],
      hasClaimToken: true,
    }),
    'allowed'
  );
  assert.equal(
    resolveAutomationMemoryWritePolicy({
      isAutomation: true,
      provider: 'gemini',
      allowedOperations: ['buddy.update_memory'],
      hasClaimToken: true,
    }),
    'unsupported'
  );
  assert.equal(
    resolveAutomationMemoryWritePolicy({
      isAutomation: true,
      provider: 'codex',
      allowedOperations: ['buddy.update_memory'],
      hasClaimToken: true,
    }),
    'allowed'
  );
  assert.equal(
    resolveAutomationMemoryWritePolicy({
      isAutomation: true,
      provider: 'codex',
      allowedOperations: ['buddy.remember_note'],
      hasClaimToken: true,
    }),
    'allowed'
  );
});

// Regression: muse -> muse Chat Fork threw `Harness "muse" does not support
// fork.` because the same-provider branch handed the source session to the
// harness without checking fork capability. muse -> claude worked, which is
// what made it look provider-pair specific. Session inheritance is gated on
// capability; every other fork stays a soft string handoff.
test('same-provider fork on a fork-incapable harness falls back to string handoff', () => {
  const conversations = new Map<
    string,
    ReturnType<ConversationRuntimeDependencies['getConversation']>
  >();
  const fixture = runtimeFixture({
    provider: 'muse',
    getConversation: (id) => conversations.get(id),
  });
  const source = new fixture.Conversation({
    done: false,
    id: 'muse-source',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    existingSessionId: 'muse-native-session',
  });
  conversations.set(source.id, source);

  const child = new fixture.Conversation({
    done: false,
    id: 'muse-child',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    resumedFromConversationId: source.id,
  });
  let spawned: { content: string; forkSourceSessionId?: string } | undefined;
  (
    child as unknown as {
      spawnForMessage(
        content: string,
        executionConfig: unknown,
        forkSourceSessionId?: string
      ): void;
    }
  ).spawnForMessage = (content, _executionConfig, forkSourceSessionId) => {
    spawned = { content, forkSourceSessionId };
  };

  child.enqueueMessage('Continue the original objective from this fork.');

  assert.equal(spawned?.forkSourceSessionId, undefined);
  assert.ok(spawned?.content.includes('Continue the original objective from this fork.'));
  assert.deepEqual(
    child.messages.filter((message) => message.role === 'system').map((m) => m.content),
    []
  );
});

test('every harness receives its resolved effort in one request shape', () => {
  // Guards T08 S2: the request builder used to be three identical per-harness
  // branches plus a cast fallback. A regression here drops a claude/codex/muse
  // effort silently (the provider would run at its own default).
  type Request = Parameters<NonNullable<ConversationRuntimeDependencies['executeTurn']>>[0];
  const expected: Record<Provider, string | undefined> = {
    claude: 'high',
    codex: 'ultra',
    muse: 'high',
    gemini: undefined,
    opencode: undefined,
    cursor: undefined,
  };
  for (const provider of Object.keys(expected) as Provider[]) {
    const requests: Request[] = [];
    const stub = openTurnStub();
    const { conversation } = runtimeFixture({
      provider,
      executeTurn: fakeExecuteTurn((request) => {
        requests.push(request);
        return stub.turn;
      }),
    });
    conversation.sendMessage('effort probe');
    assert.equal(requests.length, 1, provider);
    const request = requests[0] as Request & { reasoningEffort?: string };
    assert.equal(request.harness, provider);
    assert.equal(request.reasoningEffort, expected[provider], provider);
    assert.equal(request.prompt, 'effort probe');
    conversation.resetProcess();
    stub.child.emit('close');
  }
});

test('a session reset rotates the provider session and re-registers its alias', () => {
  // A stale alias would route the old session's trailing disk writes to this
  // conversation's fresh context.
  const { aliases, conversation } = runtimeFixture();
  conversation.resetProcess();
  assert.equal(conversation.sessionId, 'rotated-session');
  assert.deepEqual(aliases.at(-1), ['rotated-session', 'conversation-id']);
});

test('timer-only heartbeats cannot mask provider idleness, while native advancement can', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const fired: TurnTimeoutKind[] = [];
  const watchdog = new TurnWatchdog(
    { bridgeMs: 2 * 60_000, providerIdleMs: 60 * 60_000, maxRuntimeMs: 24 * 60 * 60_000 },
    (kind) => fired.push(kind)
  );
  watchdog.start();

  // Keep the bridge healthy for 59 minutes. One native advancement near the
  // original provider deadline must extend only the provider-progress clock.
  for (let minute = 1; minute <= 59; minute += 1) {
    t.mock.timers.tick(60_000);
    watchdog.note({
      type: 'progress',
      source: 'agent-cli.heartbeat',
      data: { nativeSessionAdvanced: minute === 59, nativeSessionAvailable: true },
    });
  }
  // Continue bridge-only heartbeats until the refreshed one-hour provider
  // deadline. The bridge never stalls, but provider idleness must terminate.
  for (let minute = 1; minute <= 59; minute += 1) {
    t.mock.timers.tick(60_000);
    watchdog.note({ type: 'progress', source: 'agent-cli.heartbeat' });
    assert.deepEqual(fired, [], 'native advancement should extend provider deadline');
  }
  t.mock.timers.tick(60_000);
  assert.deepEqual(fired, ['provider']);
  assert.equal(watchdog.idle().providerIdleSeconds, 3_600);
  watchdog.clear();
});

test('bridge watchdog terminates a turn when neither unified events nor heartbeats arrive', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const stub = openTurnStub();
  const { broadcasts, conversation } = runtimeFixture({
    executeTurn: fakeExecuteTurn(() => stub.turn),
  });
  conversation.sendMessage('never answered');
  assert.equal(conversation.isRunning, true);

  t.mock.timers.tick(2 * 60_000);

  assert.equal(conversation.isRunning, false);
  assert.equal(stub.stops(), 1, 'the stalled provider is terminated');
  assert.ok(
    broadcasts.some(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'content' in message &&
        typeof message.content === 'string' &&
        message.content.includes('Turn event bridge stalled')
    )
  );
  stub.child.emit('close');
});

// First-turn prompt markers are kind-routed: only buddy_builder threads may
// carry the builder briefing. A buddy (or general) thread must never be
// misclassified into the builder prompt — see 2026-09-07 report where a
// Product Development Lead thread rendered the buddy-builder briefing.
test('first-turn markers are kind-exclusive: builder, buddy, general', () => {
  const base = {
    content: 'Lets make some updates',
    messageCount: 0,
    hasStartedSession: false,
    swarmDebugPrefix: null,
    buddyBriefing: null,
  } as const;

  const builder = buildFirstTurnCliContent({ ...base, kind: { kind: 'buddy_builder' } });
  assert.match(builder, /unleashd:buddy-builder-v1/);
  assert.doesNotMatch(builder, /unleashd:buddy-context-v2/);

  const buddy = buildFirstTurnCliContent({
    ...base,
    kind: {
      kind: 'buddy',
      buddyId: 'buddy-1',
      workspaceId: 'workspace-1',
      buddyProjectId: null,
      legacyWorkItemId: null,
      automationRunId: null,
      delegatedByBuddyId: null,
      parentBuddyConversationId: null,
    },
    buddyBriefing: 'Memory generation seven',
    buddyMemoryGeneration: 7,
  });
  assert.match(buddy, /unleashd:buddy-context-v2/);
  assert.doesNotMatch(buddy, /unleashd:buddy-builder-v1/);

  const general = buildFirstTurnCliContent({ ...base, kind: { kind: 'general' } });
  assert.doesNotMatch(general, /unleashd:buddy-builder-v1/);
  assert.doesNotMatch(general, /unleashd:buddy-context-v2/);
  assert.equal(general, 'Lets make some updates');
});

test('foreground Buddy deadline uses the conversation budget and reports timeout after joined drain', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
  const completed = deferred<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    sessionId: string;
    reason: 'killed';
  }>();
  const stopped = deferred<void>();
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
  const terminals: Parameters<
    NonNullable<ConversationRuntimeDependencies['turnAttempts']>['terminal']
  >[0][] = [];
  const settlements: Parameters<
    NonNullable<ConversationRuntimeDependencies['finishBuddyChatRun']>
  >[] = [];
  let requestedBudget: number | undefined;
  let release = false;
  const fixture = runtimeFixture({
    enqueueBuddyChatRun: () => ({ id: 'owned-run' }),
    startBuddyChatRun: (_runId, _id, maxRuntimeMs) => {
      requestedBudget = maxRuntimeMs;
      // A short owned deadline exercises the same callback without waiting a day.
      return {
        kind: 'admitted',
        run: {
          id: 'owned-run',
          claim_token: 'private-fixture-token',
          deadline: new Date(Date.now() + 1000).toISOString(),
        },
      };
    },
    finishBuddyChatRun: (...args) => settlements.push(args),
    turnAttempts: {
      queued: () => {},
      starting: () => {},
      running: () => {},
      stopping: () => {},
      activity: () => {},
      bindProviderSession: () => {},
      terminal: (result) => terminals.push(result),
    },
    executeTurn: fakeExecuteTurn(() => ({
      child,
      events: (async function* () {
        yield { type: 'turn.started' as const };
        yield { type: 'text.delta' as const, text: 'Still working' };
        await stopped.promise;
        yield { type: 'turn.complete' as const, reason: 'killed' as const };
      })(),
      completed: completed.promise,
      stop: () => {
        release = true;
      },
    })),
  });
  const conversation = new fixture.Conversation({
    done: false,
    id: 'foreground-timeout',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    buddyContext: { buddyId: 'buddy-fixture', workspaceId: 'workspace-fixture' },
  });
  conversation.sendMessage('Keep working');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requestedBudget, TURN_MAX_RUNTIME_MS);
  t.mock.timers.tick(1000);
  assert.equal(release, true);
  assert.equal(terminals.at(-1)?.terminalCause, 'max_runtime_timeout');
  assert.equal(terminals.at(-1)?.state, 'failed');
  assert.equal(conversation.hasActiveProcess(), true);
  assert.equal(settlements.length, 0, 'ownership must wait for process and event drain');
  child.exitCode = 0;
  child.emit('close');
  stopped.resolve();
  completed.resolve({
    exitCode: null,
    signal: 'SIGTERM',
    sessionId: 'provider-session',
    reason: 'killed',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(conversation.hasActiveProcess(), false);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0][2], 'failed');
  assert.match(settlements[0][3] ?? '', /maximum runtime/);
});

test('background deadline uses timeout classification and waits for provider drain', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
  const completed = deferred<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    sessionId: string;
    reason: 'killed';
  }>();
  const stopped = deferred<void>();
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
  const terminals: Parameters<
    NonNullable<ConversationRuntimeDependencies['turnAttempts']>['terminal']
  >[0][] = [];
  const settlements: Parameters<
    NonNullable<ConversationRuntimeDependencies['finishBuddyChatRun']>
  >[] = [];
  let release = false;
  let drainedCause: string | undefined;
  const fixture = runtimeFixture({
    turnAttempts: {
      queued: () => {},
      starting: () => {},
      running: () => {},
      stopping: () => {},
      activity: () => {},
      bindProviderSession: () => {},
      terminal: (result) => terminals.push(result),
    },
    executeTurn: fakeExecuteTurn(() => ({
      child,
      events: (async function* () {
        yield { type: 'turn.started' as const };
        yield { type: 'text.delta' as const, text: 'Still working' };
        await stopped.promise;
        yield { type: 'turn.complete' as const, reason: 'killed' as const };
      })(),
      completed: completed.promise,
      stop: () => {
        release = true;
      },
    })),
  });
  const conversation = new fixture.Conversation({
    done: false,
    id: 'foreground-timeout',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    buddyContext: { buddyId: 'buddy-fixture', workspaceId: 'workspace-fixture' },
  });
  conversation.placement = 'background';
  const execution = conversation.runCoordinationMessage(
    'Keep working',
    { buddyId: 'buddy-fixture', workspaceId: 'workspace-fixture', coordinationRunId: 'worker-run' },
    'worker-token',
    (status, detail, terminalCause) => {
      drainedCause = terminalCause;
      settlements.push(['worker-run', 'worker-token', status, detail]);
    }
  );
  const rejected = assert.rejects(execution, /maximum runtime/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  conversation.expireCoordinationRun();
  assert.equal(release, true);
  assert.equal(terminals.at(-1)?.terminalCause, 'max_runtime_timeout');
  assert.equal(terminals.at(-1)?.state, 'failed');
  assert.equal(conversation.hasActiveProcess(), true);
  assert.equal(settlements.length, 0, 'ownership must wait for process and event drain');
  child.exitCode = 0;
  child.emit('close');
  stopped.resolve();
  completed.resolve({
    exitCode: null,
    signal: 'SIGTERM',
    sessionId: 'provider-session',
    reason: 'killed',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(conversation.hasActiveProcess(), false);
  assert.equal(settlements.length, 1);
  await rejected;
  assert.equal(drainedCause, 'max_runtime_timeout');
  assert.equal(settlements[0][2], 'failed');
  assert.match(settlements[0][3] ?? '', /maximum runtime/);
});

function openTurnStub() {
  let stops = 0;
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
  const turn = {
    child,
    // No events on purpose: a post-stop turn.started would re-arm the bridge
    // watchdog on the dead turn and stall test exit for the full timeout.
    events: (async function* () {
      await new Promise<never>(() => {});
    })(),
    completed: new Promise<never>(() => {}),
    stop: () => {
      stops += 1;
    },
  };
  return { turn, child, stops: () => stops };
}

function runningFixture() {
  const opened: Array<ReturnType<typeof openTurnStub>> = [];
  const fixture = runtimeFixture({
    executeTurn: fakeExecuteTurn(() => {
      const stub = openTurnStub();
      opened.push(stub);
      return stub.turn;
    }),
  });
  return { ...fixture, opened };
}

test('interrupt keeps the pending queue and sends the new message first', () => {
  // Regression guard (2026-09-19): interrupt_and_send used to flush every
  // pending queued message, so interrupting silently discarded work the user
  // had queued. Interrupt stops the turn, not the queue — the in-flight head
  // is retired with the killed turn and the new message goes first.
  const { conversation, broadcasts, opened } = runningFixture();
  conversation.enqueueMessage('First');
  conversation.enqueueMessage('Second');
  assert.equal(conversation.queue.length, 2);
  assert.equal(conversation.queue[0]?.status, 'sending');
  assert.equal(conversation.queue[1]?.status, 'pending');

  conversation.interruptAndSend('Urgent');

  assert.equal(opened[0]?.stops(), 1);
  assert.deepEqual(
    conversation.queue.map((m) => [m.content, m.status]),
    [
      ['Urgent', 'pending'],
      ['Second', 'pending'],
    ]
  );
  const lastQueue = [...broadcasts]
    .reverse()
    .find((m) => (m as { type?: string }).type === 'queue_updated') as
    | { queue: Array<{ content: string }> }
    | undefined;
  assert.deepEqual(
    lastQueue?.queue.map((m) => m.content),
    ['Urgent', 'Second']
  );
  // Clear the SIGTERM kill timer the interrupt armed; the killed turn's
  // completion is intentionally never resolved in this test.
  opened[0]?.child.emit('close');
});

test('interrupt with no active turn sends ahead of the queue', () => {
  const fixture = runtimeFixture();
  fixture.conversation.isRunning = true;
  fixture.conversation.enqueueMessage('First');
  fixture.conversation.enqueueMessage('Second');

  fixture.conversation.interruptAndSend('Urgent');

  assert.deepEqual(
    fixture.conversation.queue.map((m) => [m.content, m.status]),
    [
      ['Urgent', 'pending'],
      ['First', 'pending'],
      ['Second', 'pending'],
    ]
  );
  fixture.conversation.clearQueue();
  fixture.conversation.isRunning = false;
});

test('promote moves a pending message first and interrupts the turn', () => {
  const { conversation, opened } = runningFixture();
  conversation.enqueueMessage('First');
  conversation.enqueueMessage('Second');
  conversation.enqueueMessage('Third');
  const thirdId = conversation.queue[2]?.id;
  assert.ok(thirdId);

  conversation.promoteQueuedMessage(thirdId);

  assert.equal(opened[0]?.stops(), 1);
  assert.deepEqual(
    conversation.queue.map((m) => [m.content, m.status]),
    [
      ['Third', 'pending'],
      ['Second', 'pending'],
    ]
  );

  // Unknown or non-pending ids are a no-op, like cancelQueuedMessage.
  conversation.promoteQueuedMessage('missing-id');
  assert.equal(conversation.queue.length, 2);
  opened[0]?.child.emit('close');
});

type ScriptedEvent = import('@nbardy/agent-cli').UnifiedAgentEvent;

/** Run one real turn whose provider stream is `events`, and wait for it to drain. */
async function runScriptedTurn(provider: Provider, events: ScriptedEvent[]) {
  const { conversation, broadcasts } = runtimeFixture({
    provider,
    executeTurn: fakeExecuteTurn(() => ({
      child: { exitCode: 0 },
      events: (async function* () {
        yield* events;
      })(),
      completed: Promise.resolve({
        exitCode: 0,
        signal: null,
        sessionId: 'scripted-session',
        reason: 'success',
      }),
      stop: () => undefined,
    })),
  });
  conversation.sendMessage('scripted');
  await conversation.waitForTurnDrain();
  return { conversation, broadcasts };
}

test('codex collab threads become native sub-agents that parent completion leaves alone', async () => {
  // Guards T08 S3: codex collab handling moved out of the turn fold into the
  // harness table (turns/subagents.ts). Shapes mirror agent-cli's codex parser
  // (collabToolInput). A regression either drops the native rows, infers a
  // still-pending child as "Done" when the parent turn ends, or double-counts.
  const collab = (tool: string, phase: 'started' | 'completed', extra: Record<string, unknown>) =>
    ({
      type: 'tool.use',
      name: tool,
      input: { _phase: phase, sender_thread_id: 'parent', ...extra },
    }) as const;
  const { conversation, broadcasts } = await runScriptedTurn('codex', [
    { type: 'turn.started' },
    collab('spawn_agent', 'started', { prompt: 'Write file_1.md' }),
    collab('spawn_agent', 'completed', {
      prompt: 'Write file_1.md',
      receiver_thread_ids: ['child-1'],
      agents_states: { 'child-1': { status: 'pending_init', message: null } },
    }),
    collab('wait', 'completed', {
      receiver_thread_ids: ['child-1'],
      agents_states: { 'child-1': { status: 'completed', message: 'test-confirmed' } },
    }),
    collab('spawn_agent', 'completed', {
      prompt: 'Second child',
      receiver_thread_ids: ['child-2'],
      agents_states: { 'child-2': { status: 'pending_init', message: null } },
    }),
    { type: 'text.delta', text: 'SUBAGENTS_OK' },
    { type: 'turn.complete', reason: 'success' },
  ]);
  const byId = new Map(conversation.subAgents.map((agent) => [agent.id, agent]));
  assert.deepEqual(
    [...byId.keys()],
    ['child-1', 'child-2'],
    'one row per collab child, no generic spawn row'
  );
  assert.equal(byId.get('child-1')?.description, '[Codex Agent] Write file_1.md');
  assert.equal(byId.get('child-1')?.status, 'completed');
  assert.equal(byId.get('child-1')?.statusSource, 'native');
  assert.equal(byId.get('child-1')?.toolUses, 1);
  assert.equal(byId.get('child-1')?.currentAction, 'Done');
  assert.equal(byId.get('child-2')?.status, 'pending', 'parent completion must not settle it');
  const completions = broadcasts.filter(
    (message) => (message as { type?: string }).type === 'subagent_complete'
  );
  assert.equal(completions.length, 1);
  const assistant = conversation.messages.find((message) => message.role === 'assistant');
  assert.match(assistant?.content ?? '', /SUBAGENTS_OK/);
});

test('a Task tool starts a generic sub-agent that parent completion settles', async () => {
  const { conversation } = await runScriptedTurn('claude', [
    { type: 'turn.started' },
    {
      type: 'tool.use',
      name: 'Task',
      input: { description: 'Explore', subagent_type: 'scout', _blockId: 'block-1' },
    },
    { type: 'tool.use', name: 'Read', input: { file_path: '/repo/src/a.ts' } },
    { type: 'turn.complete', reason: 'success' },
  ]);
  const [agent] = conversation.subAgents;
  assert.equal(conversation.subAgents.length, 1);
  assert.equal(agent.id, 'block-1');
  assert.equal(agent.description, '[scout] Explore');
  assert.equal(agent.toolUses, 1);
  assert.equal(agent.status, 'completed');
  assert.equal(agent.statusSource, 'inferred_parent_completion');
});
