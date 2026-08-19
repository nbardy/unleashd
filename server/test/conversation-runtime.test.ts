import assert from 'node:assert/strict';
import test from 'node:test';
import type { Provider } from '@unleashd/shared';
import { createDefaultConversationConfig } from '@unleashd/shared';
import {
  type ConversationRuntimeDependencies,
  createConversationRuntime,
  describeTurnTimeout,
  isProviderProgressEvent,
  turnAttemptActivityFromEvent,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

function runtimeFixture(
  options: {
    provider?: Provider;
    getConversation?: ConversationRuntimeDependencies['getConversation'];
    turnAttempts?: ConversationRuntimeDependencies['turnAttempts'];
  } = {}
) {
  const aliases: Array<[string, string]> = [];
  const broadcasts: unknown[] = [];
  const config = createDefaultConversationConfig(options.provider ?? 'codex');
  const Conversation = createConversationRuntime({
    broadcast: (message) => broadcasts.push(message),
    registerSessionAlias: (sessionId, conversationId) => {
      if (sessionId) aliases.push([sessionId, conversationId]);
    },
    unregisterSessionAlias: () => undefined,
    clearExternalRunningStatus: () => undefined,
    clearLocalCompletionSuppression: () => undefined,
    markLocalCompletionSuppression: () => undefined,
    persistCurrentSession: async () => undefined,
    updateBuddyStatus: () => undefined,
    settleBuddyDelegation: () => undefined,
    getConversation: options.getConversation ?? (() => undefined),
    readLatestOompaRuntime: () => ({
      available: false,
      run: null,
      reason: 'No runs directory found',
    }),
    createSessionId: () => 'rotated-session',
    turnAttempts: options.turnAttempts,
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
  });
  return { aliases, broadcasts, configState, Conversation, conversation };
}

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
