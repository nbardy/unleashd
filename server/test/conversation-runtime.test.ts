import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Provider } from '@unleashd/shared';
import {
  type ConversationConfig,
  createDefaultConversationConfig,
  mergeReviewDocPath,
} from '@unleashd/shared';
import { loadAllConversations } from '../src/adapters/loader';
import { getDiskAdapter } from '../src/adapters/registry';
import { NormalizedSessionCache } from '../src/adapters/session-cache';
import type { CompletedBuddyTurn } from '../src/buddies/memory-review';
import { TURN_MAX_RUNTIME_MS } from '../src/constants/timeouts';
import {
  type ConversationRuntimeDependencies,
  buildFirstTurnCliContent,
  createConversationRuntime,
  describeTurnTimeout,
  extractBuddyMemorySnapshot,
  isProviderProgressEvent,
  resolveAutomationMemoryWritePolicy,
  turnAttemptActivityFromEvent,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

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
    beginBuddyChatRun?: ConversationRuntimeDependencies['beginBuddyChatRun'];
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
    readLatestOompaRuntime: () => ({
      available: false,
      run: null,
      reason: 'No runs directory found',
    }),
    createSessionId: () => 'rotated-session',
    executeTurn: options.executeTurn,
    turnAttempts: options.turnAttempts,
    requestAutomationCancellation: options.requestAutomationCancellation,
    revokeBuddyControlCapability: options.revokeBuddyControlCapability,
    beginBuddyChatRun: options.beginBuddyChatRun,
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

test('merge context reaches the provider but stays out of live and cached imported user messages', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'merge-prompt-transcript-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const reviewUuid = '7620bfae-9c98-47b2-a592-2b3d5b35d89a';
  const reviewPath = path.join(directory, mergeReviewDocPath(reviewUuid));
  await fs.mkdir(path.dirname(reviewPath), { recursive: true });
  const review =
    'Review quotes delimiters:\n<!-- /unleashd:merge-prefix -->\n\n<!-- /unleashd:merge-prefix-v1 -->\n\nRemaining review 🐱';
  await fs.writeFile(reviewPath, review);
  let providerPrompt = '';
  const fixture = runtimeFixture({
    executeTurn: ((request) => {
      providerPrompt = request.prompt;
      return {
        child: { exitCode: 0 },
        events: (async function* () {
          yield { type: 'turn.complete' as const, reason: 'success' as const };
        })(),
        completed: Promise.resolve({ exitCode: 0, signal: null, reason: 'success' }),
        stop: () => undefined,
      };
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  const conversation = new fixture.Conversation({
    id: 'merge-parent',
    workingDirectory: directory,
    configState: fixture.configState,
    mergeParentMeta: {
      children: [
        {
          sourceConversationId: 'source',
          childConversationId: 'child',
          reviewUuid,
          childWorkingDirectory: directory,
        },
      ],
      prefixInjected: false,
    },
  });
  const authored =
    'Combine the reviews. Preserve this literal:\n<!-- /unleashd:merge-prefix-v1 -->\n\nAfter it.';
  conversation.sendMessage(authored);
  await eventually(() => assert.equal(conversation.hasActiveProcess(), false));
  assert.match(providerPrompt, /This is a merge thread/);
  assert.ok(providerPrompt.includes(review));
  assert.equal(conversation.messages[0].content, authored);

  const quoted = `Explain this recorded wrapper:\n${providerPrompt}`;
  const incomplete = '<!-- unleashd:merge-prefix -->\nAn incomplete literal example.';
  const timestamp = new Date().toISOString();
  const source = path.join(directory, 'session.jsonl');
  await fs.writeFile(
    source,
    [
      { timestamp, type: 'session_meta', payload: { id: 'merge-session', cwd: directory } },
      ...[providerPrompt, quoted, incomplete].map((message) => ({
        timestamp,
        type: 'event_msg',
        payload: { type: 'user_message', message },
      })),
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n')
  );
  const adapter = { ...getDiskAdapter('codex'), discoverFiles: async () => [source] };
  const cache = new NormalizedSessionCache(path.join(directory, 'cache'));
  for (let pass = 0; pass < 2; pass++) {
    const loaded = await loadAllConversations({ adapters: [adapter], cache });
    assert.deepEqual(
      loaded.conversations.get('merge-session')?.messages.map((m) => m.content),
      [authored, quoted, incomplete]
    );
  }
});

test('retained Buddy display history stays out of fresh provider context across audience resets', async () => {
  type Request = Parameters<NonNullable<ConversationRuntimeDependencies['executeTurn']>>[0];
  const requests: Request[] = [];
  let current = {
    briefing: 'CURRENT_OWNER_BRIEFING',
    memoryGeneration: '1',
    audienceKey: 'owner-audience',
  };
  const fixture = runtimeFixture({
    readCurrentBuddyContext: () => current,
    executeTurn: ((request) => {
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
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  const conversation = new fixture.Conversation({
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

  current = { briefing: 'NARROWED_BRIEFING', memoryGeneration: '3', audienceKey: 'narrowed' };
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
  let current = { briefing: 'BRIEFING_GEN_1', memoryGeneration: '1', audienceKey: 'owner' };
  const fixture = runtimeFixture({
    readCurrentBuddyContext: () => current,
    executeTurn: ((request) => {
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
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  const conversation = new fixture.Conversation({
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
    executeTurn: (() => ({
      child: { exitCode: 0 },
      events: events(),
      completed: completion.promise,
      stop: () => undefined,
    })) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
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
    executeTurn: (() => ({
      child: { exitCode: 0 },
      events: events(),
      completed: Promise.resolve({
        exitCode: 0,
        signal: null,
        sessionId: 'provider-session',
        reason: 'success',
      }),
      stop: () => undefined,
    })) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
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
    const completion = deferred<{ exitCode: number; signal: null; reason: 'success' | 'error' }>();
    const fixture = runtimeFixture({
      buddyContext:
        outcome === 'ordinary' ? undefined : { buddyId: 'buddy-1', workspaceId: 'workspace-1' },
      reviewCompletedBuddyTurn: (turn) => reviews.push(turn),
      executeTurn: (() => ({
        child,
        events: (async function* () {
          yield { type: 'turn.started' as const };
          yield { type: 'text.delta' as const, text: 'Completed answer' };
          yield { type: 'turn.complete' as const, reason: 'success' as const };
        })(),
        completed: completion.promise,
        stop: () => undefined,
      })) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
    });
    fixture.conversation.sendMessage('Remember our result');
    if (outcome === 'cancelled') fixture.conversation.stop();
    completion.resolve({
      exitCode: outcome === 'failed' ? 1 : 0,
      signal: null,
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
    executeTurn: (() => {
      throw new Error('provider startup rejected');
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
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

test('foreground Buddy capacity rejection fails once without hiding the owner message', () => {
  let admissions = 0;
  let providerStarts = 0;
  const fixture = runtimeFixture({
    buddyContext: {
      buddyId: 'busy-buddy',
      workspaceId: 'workspace-1',
    },
    beginBuddyChatRun: () => {
      admissions += 1;
      throw new Error('Conversation execution slot is unavailable');
    },
    executeTurn: (() => {
      providerStarts += 1;
      return {
        child: { exitCode: 0 },
        events: (async function* () {
          yield { type: 'turn.started' as const };
          yield { type: 'text.delta' as const, text: 'Must not start' };
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
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });

  assert.throws(
    () =>
      fixture.conversation.enqueueMessage('Preserve this owner message', {
        origin: 'owner_input',
        inputId: 'owner-message',
      }),
    /execution slot is unavailable/
  );

  assert.equal(admissions, 1);
  assert.equal(providerStarts, 0);
  assert.equal(fixture.conversation.queue.length, 0);
  assert.equal(fixture.conversation.messages.length, 1);
  assert.equal(fixture.conversation.messages[0]?.content, 'Preserve this owner message');
});

test('historical automation transcripts refuse every user turn-admission path', () => {
  let providerStarts = 0;
  const fixture = runtimeFixture({
    executeTurn: (() => {
      providerStarts += 1;
      throw new Error('must not start');
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  const conversation = new fixture.Conversation({
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
    id: 'source-conversation',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    existingSessionId: 'source-native-session',
  });
  conversations.set(source.id, source);

  const child = new fixture.Conversation({
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
    id: 'muse-source',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    existingSessionId: 'muse-native-session',
  });
  conversations.set(source.id, source);

  const child = new fixture.Conversation({
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

test('conversation runtime binds server capabilities without importing server orchestration', () => {
  const { aliases, broadcasts, conversation } = runtimeFixture();

  assert.deepEqual(aliases, [['conversation-id', 'conversation-id']]);
  assert.equal(broadcasts.length, 0);
  assert.equal(conversation.provider, 'codex');
  assert.equal(conversation.toJSON().id, 'conversation-id');

  conversation.resetProcess();
  assert.equal(conversation.sessionId, 'rotated-session');
  assert.deepEqual(aliases.at(-1), ['rotated-session', 'conversation-id']);
});

test('timer-only heartbeats cannot mask provider idleness, while native advancement can', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { broadcasts, conversation } = runtimeFixture();
  const runtime = conversation as unknown as {
    process: { exitCode: number | null; once(): void } | null;
    isRunning: boolean;
    isStreaming: boolean;
    _activeTurnStop: ((signal?: NodeJS.Signals) => void) | null;
    _startTurnWatchdogs(): void;
    _noteTurnActivity(event: {
      type: 'progress';
      source: string;
      data?: Record<string, unknown>;
    }): void;
    _clearTurnWatchdogs(): void;
  };
  runtime.process = { exitCode: null, once: () => undefined };
  runtime.isRunning = true;
  runtime.isStreaming = true;
  runtime._activeTurnStop = () => undefined;
  runtime._startTurnWatchdogs();

  // Keep the bridge healthy for 59 minutes. One native advancement near the
  // original provider deadline must extend only the provider-progress clock.
  for (let minute = 1; minute <= 59; minute += 1) {
    t.mock.timers.tick(60_000);
    runtime._noteTurnActivity({
      type: 'progress',
      source: 'agent-cli.heartbeat',
      data: {
        nativeSessionAdvanced: minute === 59,
        nativeSessionAvailable: true,
      },
    });
  }
  // Continue bridge-only heartbeats until the refreshed one-hour provider
  // deadline. The bridge never stalls, but provider idleness must terminate.
  for (let minute = 1; minute <= 59; minute += 1) {
    t.mock.timers.tick(60_000);
    runtime._noteTurnActivity({ type: 'progress', source: 'agent-cli.heartbeat' });
    assert.equal(runtime.isRunning, true, 'native advancement should extend provider deadline');
  }
  t.mock.timers.tick(60_000);

  assert.equal(runtime.isRunning, false);
  assert.ok(
    broadcasts.some(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'content' in message &&
        typeof message.content === 'string' &&
        message.content.includes('no provider event or native-session advancement')
    )
  );
  runtime._clearTurnWatchdogs();
});

test('bridge watchdog terminates when neither unified events nor heartbeats arrive', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { broadcasts, conversation } = runtimeFixture();
  const runtime = conversation as unknown as {
    process: { exitCode: number | null; once(): void } | null;
    isRunning: boolean;
    isStreaming: boolean;
    _activeTurnStop: ((signal?: NodeJS.Signals) => void) | null;
    _startTurnWatchdogs(): void;
    _clearTurnWatchdogs(): void;
  };
  runtime.process = { exitCode: null, once: () => undefined };
  runtime.isRunning = true;
  runtime.isStreaming = true;
  runtime._activeTurnStop = () => undefined;
  runtime._startTurnWatchdogs();

  t.mock.timers.tick(2 * 60_000);

  assert.equal(runtime.isRunning, false);
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
  runtime._clearTurnWatchdogs();
});

test('turn activity distinguishes bridge heartbeats from provider events', () => {
  const heartbeat = {
    type: 'progress' as const,
    source: 'agent-cli.heartbeat',
    data: {
      phase: 'startup',
      unifiedEventSilentSeconds: 30,
      rawStdoutSilentSeconds: 2,
      stdoutStreamEvent: 'resume',
      stdoutReadableFlowing: true,
      stdoutReadableLengthBytes: 0,
      nativeSessionSizeBytes: 12_345,
    },
  };
  assert.deepEqual(turnAttemptActivityFromEvent(heartbeat), {
    source: 'agent_cli_heartbeat',
    providerEventType: 'progress',
    providerEventSource: 'agent-cli.heartbeat',
    heartbeat: {
      phase: 'startup',
      unifiedEventSilentSeconds: 30,
      rawStdoutSilentSeconds: 2,
      stdoutStreamEvent: 'resume',
      stdoutReadableFlowing: true,
      stdoutReadableLengthBytes: 0,
      nativeSessionSizeBytes: 12_345,
    },
  });
  assert.equal(isProviderProgressEvent(heartbeat), false);
  const nativeAdvancement = {
    type: 'progress' as const,
    source: 'agent-cli.heartbeat',
    data: {
      phase: 'startup',
      nativeSessionAvailable: true,
      nativeSessionAdvanced: true,
      nativeSessionSilentSeconds: 0,
      nativeSessionSizeBytes: 98_765,
      stdoutStreamEvent: 'pause',
      stdoutReadableFlowing: null,
      stdoutReadableLengthBytes: 512,
    },
  };
  assert.equal(isProviderProgressEvent(nativeAdvancement), true);
  assert.deepEqual(turnAttemptActivityFromEvent(nativeAdvancement), {
    source: 'native_session',
    providerEventType: 'progress',
    providerEventSource: 'agent-cli.heartbeat',
    heartbeat: {
      phase: 'startup',
      nativeSessionAvailable: true,
      nativeSessionAdvanced: true,
      nativeSessionSilentSeconds: 0,
      nativeSessionSizeBytes: 98_765,
      stdoutStreamEvent: 'pause',
      stdoutReadableFlowing: null,
      stdoutReadableLengthBytes: 512,
    },
  });
  assert.deepEqual(
    turnAttemptActivityFromEvent({
      type: 'tool.use',
      name: 'exec',
      input: {},
    }),
    {
      source: 'provider_event',
      providerEventType: 'tool.use',
    }
  );
});

test('timeout diagnostics classify bridge, provider-idle, and hard-cap failures separately', () => {
  assert.deepEqual(
    describeTurnTimeout('bridge', {
      elapsedSeconds: 3_700,
      bridgeIdleSeconds: 120,
      providerIdleSeconds: 3_600,
      sawMeaningfulOutput: false,
    }),
    {
      terminalCause: 'bridge_timeout',
      message:
        'Turn event bridge stalled: no unified event or bridge heartbeat for 120s (no assistant text or tool output reached Unleashd)',
    }
  );
  assert.deepEqual(
    describeTurnTimeout('provider', {
      elapsedSeconds: 3_700,
      bridgeIdleSeconds: 5,
      providerIdleSeconds: 3_600,
      sawMeaningfulOutput: false,
    }),
    {
      terminalCause: 'provider_idle_timeout',
      message:
        'Turn stalled: no provider event or native-session advancement for 3600s (no assistant text or tool output reached Unleashd)',
    }
  );
  assert.deepEqual(
    describeTurnTimeout('max', {
      elapsedSeconds: 86_400,
      bridgeIdleSeconds: 5,
      providerIdleSeconds: 10,
      sawMeaningfulOutput: true,
    }),
    {
      terminalCause: 'max_runtime_timeout',
      message: 'Turn reached its maximum runtime after 86400s',
    }
  );
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
    beginBuddyChatRun: (_context, _id, maxRuntimeMs) => {
      requestedBudget = maxRuntimeMs;
      // A short owned deadline exercises the same callback without waiting a day.
      return {
        id: 'owned-run',
        claim_token: 'private-fixture-token',
        deadline: new Date(Date.now() + 1000).toISOString(),
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
    executeTurn: (() => ({
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
    })) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  const conversation = new fixture.Conversation({
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
    executeTurn: (() => ({
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
    })) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  const conversation = new fixture.Conversation({
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
    executeTurn: (() => {
      const stub = openTurnStub();
      opened.push(stub);
      return stub.turn;
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
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
