import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  EncodedRowsSchema,
  type Message,
  buddyKind,
  createDefaultConversationConfig,
  decodeRows,
} from '@unleashd/shared';
import { WebSocketServer } from 'ws';
import type { DiscoveredSession, SessionHistorySource } from '../src/adapters/disk-adapter';
import { createConversationApplicationContext } from '../src/application/context';
import { ConversationConfigService } from '../src/conversations/config-service';
import { ConversationConfigStore } from '../src/conversations/config-store';
import {
  type ConversationBroadcast,
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { createSessionLoader } from '../src/lifecycle/session-loader';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';
import { sameKeyAudience } from './fixtures/buddy-audience';
import { discoveredSession } from './fixtures/discovered-session';

const CONVERSATION_ID = 'dddddddd-0000-4000-8000-000000000004';
const ORIGINAL_SESSION = 'eeeeeeee-0000-4000-8000-000000000005';
const CURRENT_SESSION = 'ffffffff-0000-4000-8000-000000000006';
const ORIGINAL_DATE = '2026-09-09T04:45:02.313Z';
const CURRENT_DATE = '2026-09-12T08:33:59.789Z';
const CONFIG = createDefaultConversationConfig('codex');
const ORIGINAL_CONTENT = ['Original question', 'Original private review'];
const CURRENT_CONTENT = ['Follow-up question', 'Follow-up answer'];

function messages(contents: string[], timestamp: string): Message[] {
  return contents.map((content, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content,
    timestamp: new Date(Date.parse(timestamp) + index),
  }));
}

function contents(conversation: { messages: Message[] }): string[] {
  return conversation.messages.map((message) => message.content);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  assertion();
}

/** Real config files, application registry, runtime, and loader/poller; no live provider or data. */
async function fixture(
  t: TestContext,
  options: { provenance?: 'user' | 'external_discovered'; createdAt?: string } = {}
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'unleashd-conversation-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const initialStore = new ConversationConfigStore({
    appDataRoot: root,
    now: () => new Date(options.createdAt ?? ORIGINAL_DATE),
  });
  await initialStore.create({
    conversationId: CONVERSATION_ID,
    currentSession: { provider: 'codex', sessionId: ORIGINAL_SESSION },
    config: CONFIG,
    workingDirectory: root,
    provenance: options.provenance ?? 'user',
    kind: buddyKind({ buddyId: 'fixture-buddy', workspaceId: 'fixture-workspace' }),
  });

  function source(
    sessionId: string,
    transcript: Message[],
    createdAt: string,
    overrides: Partial<DiscoveredSession> = {}
  ): DiscoveredSession {
    return discoveredSession({
      sessionId,
      messages: transcript,
      createdAt: new Date(createdAt),
      workingDirectory: root,
      provider: 'codex',
      observedModel: sessionId === CURRENT_SESSION ? 'current-model' : 'original-model',
      ...overrides,
    });
  }

  function host(options: { finishTurn?: Promise<void>; startupLimit?: number } = {}) {
    // A new host opens new store/service/registry instances over the same durable files.
    const configStore = new ConversationConfigStore({ appDataRoot: root });
    const configService = new ConversationConfigService({
      store: configStore,
      resolver: { resolve: async (config) => resolveConfigAgainstProviderCatalog(config) },
    });
    const sockets = new WebSocketServer({ noServer: true });
    t.after(() => sockets.close());
    const app = createConversationApplicationContext<ConversationRuntime>({
      webSocketServer: sockets,
      completionSuppressionMs: 1000,
    });
    const broadcasts: ConversationBroadcast[] = [];
    const requests: Parameters<NonNullable<ConversationRuntimeDependencies['executeTurn']>>[0][] =
      [];
    const persistCurrentSession: ConversationRuntimeDependencies['persistCurrentSession'] = async (
      conversation,
      sessionId
    ) => {
      await configStore.setCurrentSession(conversation.id, {
        provider: conversation.provider,
        sessionId,
      });
    };
    const Conversation = createConversationRuntime({
      broadcast: (data) => broadcasts.push(data),
      registerSessionAlias: app.sessions.registerAlias,
      unregisterSessionAlias: app.sessions.unregisterAlias,
      clearExternalRunningStatus: app.externalActivity.clear,
      clearLocalCompletionSuppression: app.completionSuppression.clear,
      markLocalCompletionSuppression: app.completionSuppression.mark,
      persistCurrentSession,
      updateBuddyStatus: () => {},
      settleBuddyDelegation: () => {},
      getConversation: app.registry.get,
      readLatestOompaRuntime: async () => ({
        available: false,
        run: null,
        reason: 'isolated fixture',
      }),
      createSessionId: () => CURRENT_SESSION,
      readCurrentBuddyContext: () => ({
        briefing: 'Current permitted briefing',
        memoryGeneration: 'fixture-generation',
        audience: sameKeyAudience('current-authorized-audience'),
      }),
      executeTurn: ((
        request: Parameters<NonNullable<ConversationRuntimeDependencies['executeTurn']>>[0]
      ) => {
        requests.push(request);
        return {
          child: { exitCode: 0 },
          events: (async function* () {
            yield { type: 'session.started' as const, sessionId: CURRENT_SESSION };
            yield { type: 'turn.started' as const };
            yield { type: 'text.delta' as const, text: CURRENT_CONTENT[1] };
            await options.finishTurn;
            yield { type: 'turn.complete' as const, reason: 'success' as const };
          })(),
          completed: Promise.resolve({
            exitCode: 0,
            signal: null,
            sessionId: CURRENT_SESSION,
            reason: 'success' as const,
          }),
          stop: () => {},
        };
      }) as unknown as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
    });
    let discovered: SessionHistorySource[] = [];
    let pendingUpdates = new Map<string, DiscoveredSession>();
    let cycleStarted: (() => void) | undefined;
    const loader = createSessionLoader({
      options: {
        startupLimit: options.startupLimit ?? 10,
        startupConcurrency: 1,
        startupBatchSize: 1,
        startupInitialBatchSize: 1,
        startupLogEveryFiles: 1000,
        pollIntervalMs: 5,
        externalGraceMs: 1000,
        verbose: false,
      },
      ...app,
      configStore,
      configService,
      loadConversations: async (loadOptions) => {
        for (const [index, transcript] of discovered.entries()) {
          await loadOptions?.onProgress?.([structuredClone(transcript)], {
            loaded: index + 1,
            total: discovered.length,
          });
        }
        return { conversations: new Map(), mtimes: new Map() };
      },
      pollConversations: async () => {
        const updated = pendingUpdates;
        pendingUpdates = new Map();
        cycleStarted?.();
        return { updated, mtimes: new Map(), deferredDirtyPaths: new Set() };
      },
      createConversation: (conversationOptions) => new Conversation(conversationOptions),
      createId: () => {
        throw new Error('Bound native sessions must keep their application conversation ID');
      },
      resolveBuddyConversation: async (context) => ({ context, briefing: 'fixture briefing' }),
      dispatchInitialMessage: async () => {},
      persistCurrentSession,
      broadcast: (data) => broadcasts.push(data),
      logger: { log: () => {}, warn: () => {}, error: (...args) => assert.fail(args.join(' ')) },
    });

    return {
      ...app,
      configStore,
      broadcasts,
      requests,
      async load(sources: SessionHistorySource[]) {
        discovered = sources;
        await loader.loadExistingConversations();
      },
      async poll(sources: DiscoveredSession[]) {
        pendingUpdates = new Map(
          sources.map((transcript) => [transcript.sessionId, structuredClone(transcript)])
        );
        const completed = deferred<void>();
        let starts = 0;
        // The second cycle starts only after the first has applied and broadcast its updates.
        cycleStarted = () => {
          starts += 1;
          if (starts === 2) completed.resolve();
        };
        const timer = loader.startFilePolling();
        try {
          await completed.promise;
        } finally {
          clearInterval(timer);
          cycleStarted = undefined;
        }
      },
      conversation() {
        const conversation = app.registry.get(CONVERSATION_ID);
        assert.ok(conversation);
        assert.equal(app.registry.size, 1);
        return conversation;
      },
    };
  }
  return { host, source, initialStore };
}

test('privacy rotation retains display history and durable birth date through poll and reload', async (t) => {
  const f = await fixture(t);
  const original = f.source(
    ORIGINAL_SESSION,
    messages(ORIGINAL_CONTENT, ORIGINAL_DATE),
    ORIGINAL_DATE
  );
  const live = f.host();
  await live.load([original]);
  const conversation = live.conversation();
  conversation.sendMessage(CURRENT_CONTENT[0]);
  await eventually(() => assert.equal(conversation.hasActiveProcess(), false));
  assert.equal(live.requests.length, 1);
  assert.equal(
    live.requests[0].resumeSessionId,
    undefined,
    'unproven disclosure state starts fresh'
  );
  assert.equal(
    JSON.stringify(live.requests[0]).includes(ORIGINAL_CONTENT[1]),
    false,
    'restoring owner-visible history must never replay old private context into a fresh provider'
  );
  assert.deepEqual(contents(conversation), [...ORIGINAL_CONTENT, ...CURRENT_CONTENT]);
  const current = f.source(
    CURRENT_SESSION,
    conversation.messages.slice(-2).map((message) => ({
      ...message,
      // Provider events are stamped separately from runtime sends; latest-turn
      // reconciliation must not duplicate these messages merely due to clock differences.
      timestamp: new Date(message.timestamp.getTime() + 10),
    })),
    CURRENT_DATE
  );
  const broadcastsBeforePoll = live.broadcasts.length;
  await live.poll([current]);
  assert.deepEqual(contents(conversation), [...ORIGINAL_CONTENT, ...CURRENT_CONTENT]);
  assert.equal(conversation.createdAt.toISOString(), ORIGINAL_DATE);
  // The poller broadcasts rows; clients page in the tail when messageCount moves.
  const update = live.broadcasts
    .slice(broadcastsBeforePoll)
    .filter((event) => event.type === 'rows')
    .at(-1);
  assert.ok(update?.type === 'rows');
  const [row] = decodeRows(EncodedRowsSchema.parse(update));
  assert.equal(row.messageCount, ORIGINAL_CONTENT.length + CURRENT_CONTENT.length);
  assert.equal(new Date(row.createdAt).toISOString(), ORIGINAL_DATE);

  const restarted = f.host();
  await restarted.load([current, original]);
  const restored = restarted.conversation();
  assert.deepEqual(contents(restored), [...ORIGINAL_CONTENT, ...CURRENT_CONTENT]);
  assert.equal(restored.createdAt.toISOString(), ORIGINAL_DATE);
  assert.equal(restored.sessionId, CURRENT_SESSION);
  assert.equal(restored.observedModel, 'current-model');
  const durable = await restarted.configStore.getByConversationId(CONVERSATION_ID);
  assert.equal(durable?.createdAt, ORIGINAL_DATE);
  assert.equal(durable?.currentSession?.sessionId, CURRENT_SESSION);
  assert.ok(durable?.sessionBindings.some((binding) => binding.sessionId === ORIGINAL_SESSION));
});

test('inherited transcript prefixes are deduplicated while repeated messages retain multiplicity', async (t) => {
  const f = await fixture(t);
  await f.initialStore.setCurrentSession(CONVERSATION_ID, {
    provider: 'codex',
    sessionId: CURRENT_SESSION,
  });
  const repeated: Message = {
    role: 'assistant',
    content: 'Repeated tool observation',
    timestamp: new Date(Date.parse(ORIGINAL_DATE) + 2),
    toolCall: { name: 'read', input: 'file.txt' },
  };
  const prefix = [...messages(ORIGINAL_CONTENT, ORIGINAL_DATE), repeated, { ...repeated }];
  const suffix = messages(CURRENT_CONTENT, CURRENT_DATE);
  const original = f.source(ORIGINAL_SESSION, prefix, ORIGINAL_DATE);
  const inherited = f.source(CURRENT_SESSION, [...prefix, ...suffix], CURRENT_DATE);
  const live = f.host();
  await live.load([inherited, original]);
  assert.deepEqual(live.conversation().messages, [...prefix, ...suffix]);
  await live.poll([original]);
  assert.deepEqual(live.conversation().messages, [...prefix, ...suffix]);
  assert.equal(live.conversation().sessionId, CURRENT_SESSION);
});

test('late historical-session polling enriches display without rolling back current execution metadata', async (t) => {
  const f = await fixture(t);
  await f.initialStore.setCurrentSession(CONVERSATION_ID, {
    provider: 'codex',
    sessionId: CURRENT_SESSION,
  });
  const original = f.source(
    ORIGINAL_SESSION,
    messages(ORIGINAL_CONTENT, ORIGINAL_DATE),
    ORIGINAL_DATE
  );
  const current = f.source(CURRENT_SESSION, messages(CURRENT_CONTENT, CURRENT_DATE), CURRENT_DATE);
  const live = f.host();
  await live.load([current, original]);
  const lateMessage: Message = {
    role: 'assistant',
    content: 'Late original-session result',
    timestamp: new Date('2026-09-09T05:00:00Z'),
  };
  const historyUpdate = {
    ...original,
    messages: [...original.messages, lateMessage],
    // A transcript never changes the record's identity (T09).
    discoveredKind: { t: 'worker', swarmId: 'swarm', workerId: 'w0', role: 'work' } as const,
    observedModel: 'obsolete-model',
  };
  await live.poll([historyUpdate]);
  const conversation = live.conversation();
  assert.deepEqual(contents(conversation), [
    ...ORIGINAL_CONTENT,
    lateMessage.content,
    ...CURRENT_CONTENT,
  ]);
  assert.equal(conversation.sessionId, CURRENT_SESSION);
  assert.equal(conversation.observedModel, 'current-model');
  assert.equal(conversation.kind.t, 'buddy');
  assert.equal(conversation.createdAt.toISOString(), ORIGINAL_DATE);
  assert.equal(
    (await live.configStore.getByConversationId(CONVERSATION_ID))?.currentSession?.sessionId,
    CURRENT_SESSION
  );
});

test('a missing historical transcript preserves available history and durable creation time', async (t) => {
  const f = await fixture(t);
  await f.initialStore.setCurrentSession(CONVERSATION_ID, {
    provider: 'codex',
    sessionId: CURRENT_SESSION,
  });
  const current = f.source(CURRENT_SESSION, messages(CURRENT_CONTENT, CURRENT_DATE), CURRENT_DATE);
  const live = f.host();
  await live.load([current]);
  assert.deepEqual(contents(live.conversation()), CURRENT_CONTENT);
  assert.equal(live.conversation().createdAt.toISOString(), ORIGINAL_DATE);
  assert.equal(live.conversation().sessionId, CURRENT_SESSION);
});

test('a missing current transcript restores bound historical messages without resuming an obsolete session', async (t) => {
  const f = await fixture(t);
  await f.initialStore.setCurrentSession(CONVERSATION_ID, {
    provider: 'codex',
    sessionId: CURRENT_SESSION,
  });
  const original = f.source(
    ORIGINAL_SESSION,
    messages(ORIGINAL_CONTENT, ORIGINAL_DATE),
    ORIGINAL_DATE
  );
  const live = f.host();
  await live.load([original]);
  assert.deepEqual(contents(live.conversation()), ORIGINAL_CONTENT);
  assert.equal(live.conversation().createdAt.toISOString(), ORIGINAL_DATE);
  assert.equal(live.conversation().sessionId, CURRENT_SESSION);
  assert.equal(
    (await live.configStore.getByConversationId(CONVERSATION_ID))?.currentSession?.sessionId,
    CURRENT_SESSION
  );
});

test('one selected current transcript hydrates its attached bound history without extra conversation rows', async (t) => {
  const f = await fixture(t);
  await f.initialStore.setCurrentSession(CONVERSATION_ID, {
    provider: 'codex',
    sessionId: CURRENT_SESSION,
  });
  const original = f.source(
    ORIGINAL_SESSION,
    messages(ORIGINAL_CONTENT, ORIGINAL_DATE),
    ORIGINAL_DATE
  );
  const current = f.source(CURRENT_SESSION, messages(CURRENT_CONTENT, CURRENT_DATE), CURRENT_DATE);
  const live = f.host({ startupLimit: 1 });
  await live.load([{ ...current, boundSessionSources: [original] }]);
  assert.deepEqual(contents(live.conversation()), [...ORIGINAL_CONTENT, ...CURRENT_CONTENT]);
  assert.equal(live.conversation().createdAt.toISOString(), ORIGINAL_DATE);
  assert.equal(live.conversation().sessionId, CURRENT_SESSION);
  assert.equal(live.conversation().observedModel, 'current-model');
});

test('a discovered sidecar keeps the transcript birth date instead of its later import date', async (t) => {
  const f = await fixture(t, { provenance: 'external_discovered', createdAt: CURRENT_DATE });
  const original = f.source(
    ORIGINAL_SESSION,
    messages(ORIGINAL_CONTENT, ORIGINAL_DATE),
    ORIGINAL_DATE
  );
  const live = f.host();
  await live.load([original]);
  assert.equal(live.conversation().createdAt.toISOString(), ORIGINAL_DATE);
});

test('an application-created fork keeps its durable birth date when the inherited native source is older', async (t) => {
  const f = await fixture(t, { createdAt: CURRENT_DATE });
  const inherited = f.source(
    ORIGINAL_SESSION,
    messages(ORIGINAL_CONTENT, ORIGINAL_DATE),
    ORIGINAL_DATE
  );
  const live = f.host();
  await live.load([inherited]);
  assert.deepEqual(contents(live.conversation()), ORIGINAL_CONTENT);
  assert.equal(live.conversation().createdAt.toISOString(), CURRENT_DATE);
});

test('startup hydration and historical polling cannot replace an active runtime transcript or session', async (t) => {
  const f = await fixture(t);
  const completed = deferred<void>();
  const original = f.source(
    ORIGINAL_SESSION,
    messages(ORIGINAL_CONTENT, ORIGINAL_DATE),
    ORIGINAL_DATE
  );
  const live = f.host({ finishTurn: completed.promise });
  await live.load([original]);
  const conversation = live.conversation();
  conversation.sendMessage(CURRENT_CONTENT[0]);
  try {
    await eventually(() => assert.equal(conversation.sessionId, CURRENT_SESSION));
    await eventually(() => assert.ok(contents(conversation).includes(CURRENT_CONTENT[1])));
    assert.equal(conversation.hasActiveProcess(), true);
    const beforePoll = structuredClone(conversation.messages);
    await live.load([f.source(CURRENT_SESSION, [], CURRENT_DATE), original]);
    assert.equal(live.conversation(), conversation, 'the admitted runtime keeps ownership');
    assert.deepEqual(conversation.messages, beforePoll);
    await live.poll([
      {
        ...original,
        messages: messages(['Stale disk question', 'Stale disk answer'], ORIGINAL_DATE),
      },
      f.source(CURRENT_SESSION, [], CURRENT_DATE),
    ]);
    assert.deepEqual(conversation.messages, beforePoll);
    assert.equal(conversation.sessionId, CURRENT_SESSION);
    assert.equal(conversation.createdAt.toISOString(), ORIGINAL_DATE);
    assert.equal(conversation.hasActiveProcess(), true);
  } finally {
    completed.resolve();
    await eventually(() => assert.equal(conversation.hasActiveProcess(), false));
  }
});
