import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buddyKindFromContext,
  type BuddyContext,
  type Conversation as ConversationData,
  type ConversationKind,
  type DiscoveredConversation,
} from '@unleashd/shared';
import type { ConversationConfigService } from '../src/conversations/config-service';
import type { ConversationConfigStore } from '../src/conversations/config-store';
import type {
  ConversationBroadcast,
  ConversationOptions,
  ConversationRuntime,
} from '../src/conversations/runtime';
import {
  createSessionLoader,
  type SessionLoaderDependencies,
} from '../src/lifecycle/session-loader';

const BUDDY: BuddyContext = {
  buddyId: 'buddy_d3f11f11',
  workspaceId: 'project_26fce156',
};

/**
 * A conversation as the disk adapter reports it when the transcript carries no
 * buddy marker: `kind` is present but `general`. This is the shape every Chat
 * "Fork" of a Buddy thread has, because a fork's first message is the pasted
 * fork draft — the `<!-- unleashd:buddy-context-v2 -->` marker is never written.
 */
function discoveredWithoutMarker(sessionId: string): DiscoveredConversation {
  return {
    sessionId,
    messages: [],
    isRunning: false,
    isStreaming: false,
    confirmed: true,
    createdAt: new Date().toISOString(),
    workingDirectory: '/tmp/unleashd-test',
    provider: 'claude',
    subAgents: [],
    queue: [],
    isWorker: false,
    kind: { kind: 'general' },
    buddyContext: null,
  } as unknown as DiscoveredConversation;
}

/**
 * Drives `loadExistingConversations()` over exactly one discovered session and
 * returns the options the loader handed to the Conversation constructor.
 * `createConversation` is a real injected boundary of the loader, so capturing
 * it asserts the loader's actual output contract — the resolved canonical kind.
 */
async function hydrateOne(input: {
  source: DiscoveredConversation;
  creation: Record<string, unknown> | undefined;
}): Promise<ConversationOptions> {
  const conversationId = 'bb79c16e-4579-4523-9720-d90f9d72076b';
  const record = {
    conversationId,
    workingDirectory: input.source.workingDirectory,
    currentSession: { provider: input.source.provider, sessionId: input.source.sessionId },
    sessionBindings: [],
    status: 'active',
    creation: input.creation,
    config: {},
  };

  const created: ConversationOptions[] = [];
  const registry = new Map<string, ConversationRuntime>();

  const dependencies = {
    options: {
      startupLimit: 10,
      startupConcurrency: 1,
      startupBatchSize: 1,
      startupInitialBatchSize: 1,
      startupLogEveryFiles: 1000,
      pollIntervalMs: 1000,
      externalGraceMs: 1000,
      verbose: false,
    },
    registry: {
      get: (id: string) => registry.get(id),
      has: (id: string) => registry.has(id),
      set: (conversation: ConversationRuntime) => registry.set(conversation.id, conversation),
      values: () => registry.values(),
      entries: () => registry.entries(),
      get size() {
        return registry.size;
      },
    },
    sessions: {
      registerAlias: () => {},
      unregisterAlias: () => {},
      aliasFor: () => undefined,
    },
    externalActivity: { clear: () => {} },
    completionSuppression: { clear: () => {} },
    configStore: {
      findBySession: async () => record,
    } as unknown as ConversationConfigStore,
    configService: {
      hydrate: async () => ({
        state: { config: {}, revision: 0, resolution: { status: 'resolved', value: {} } },
        record,
        migrated: false,
        diagnostics: [],
      }),
      listRecoverable: async () => [],
    } as unknown as ConversationConfigService,
    loadConversations: async (options: {
      onProgress(batch: DiscoveredConversation[], progress: { loaded: number; total: number }): Promise<void>;
    }) => {
      await options.onProgress([input.source], { loaded: 1, total: 1 });
      return { mtimes: new Map<string, number>() };
    },
    pollConversations: async () => ({ mtimes: new Map<string, number>() }),
    createConversation: (conversationOptions: ConversationOptions) => {
      created.push(conversationOptions);
      return {
        id: conversationOptions.id,
        parentConversationId: null,
        messages: [],
        createdAt: new Date(),
        subAgents: [],
        toJSON: () => ({ id: conversationOptions.id, messages: [] }),
      } as unknown as ConversationRuntime;
    },
    createId: () => 'unused-id',
    resolveBuddyConversation: async (context: BuddyContext) => ({ context, briefing: 'soul' }),
    dispatchInitialMessage: async () => {},
    persistCurrentSession: async () => {},
    broadcast: () => {},
    logger: { error: () => {}, log: () => {}, warn: () => {} },
  } as unknown as SessionLoaderDependencies;

  await createSessionLoader(dependencies).loadExistingConversations();
  assert.equal(created.length, 1, 'expected exactly one conversation to be hydrated');
  return created[0];
}

// Regression: forks of Buddy threads silently de-buddied on every server restart.
// The disk adapter never returns a nullish kind — it defaults to `{kind:'general'}`
// when the transcript has no buddy marker — so the old `source.kind ?? record…`
// chain short-circuited and the durable `creation.buddyContext` was never read.
// Symptom: the Buddies page (durable link rows) showed N conversations while the
// sidebar's Buddies group (live runtime kind) showed N-1, and the fork lost its
// buddy MCP scoping. Deleting this test lets that silently return.
test('durable creation.buddyContext wins over a transcript-derived general kind', async () => {
  const options = await hydrateOne({
    source: discoveredWithoutMarker('d682b842-fcba-48fe-9634-c7b9d4f7a52c'),
    creation: {
      resumedFromConversationId: '2429d826-0cd4-4f1f-ae4f-cc968edb5f5f',
      buddyContext: BUDDY,
    },
  });

  // Assert the restored identity, not the full canonical projection — the
  // null-filled optional fields belong to `buddyContextFromKind`, not to this.
  assert.equal(options.kind?.kind, 'buddy');
  const restored = options.kind as { buddyId: string; workspaceId: string };
  assert.equal(restored.buddyId, BUDDY.buddyId);
  assert.equal(restored.workspaceId, BUDDY.workspaceId);
});

// Guards the other direction: preferring a specific kind must not invent buddy
// identity for ordinary conversations. A record with no creation buddy context
// stays general, so `kind` is left null for the runtime's legacy derivation.
test('a conversation with no durable buddy context stays general', async () => {
  const options = await hydrateOne({
    source: discoveredWithoutMarker('11111111-2222-3333-4444-555555555555'),
    creation: { resumedFromConversationId: '2429d826-0cd4-4f1f-ae4f-cc968edb5f5f' },
  });

  assert.equal(options.kind, null);
  assert.equal(options.buddyContext ?? null, null);
});

/**
 * Drives the durable-record recovery pass (no transcripts on disk) with a
 * `hydrate` that fails for one specific conversation. Returns the ids that were
 * actually recovered, plus whether the whole load rejected.
 */
async function recoverAll(input: {
  recoverable: Array<{ conversationId: string; workingDirectory: string | null }>;
  failFor: string;
}): Promise<{ recovered: string[]; threw: boolean }> {
  const created: ConversationOptions[] = [];
  const registry = new Map<string, ConversationRuntime>();

  const dependencies = {
    options: {
      startupLimit: 10,
      startupConcurrency: 1,
      startupBatchSize: 1,
      startupInitialBatchSize: 1,
      startupLogEveryFiles: 1000,
      pollIntervalMs: 1000,
      externalGraceMs: 1000,
      verbose: false,
    },
    registry: {
      get: (id: string) => registry.get(id),
      has: (id: string) => registry.has(id),
      set: (conversation: ConversationRuntime) => registry.set(conversation.id, conversation),
      values: () => registry.values(),
      entries: () => registry.entries(),
      get size() {
        return registry.size;
      },
    },
    sessions: { registerAlias: () => {}, unregisterAlias: () => {}, aliasFor: () => undefined },
    externalActivity: { clear: () => {} },
    completionSuppression: { clear: () => {} },
    configStore: { findBySession: async () => undefined } as unknown as ConversationConfigStore,
    configService: {
      hydrate: async (request: { conversationId: string }) => {
        if (request.conversationId === input.failFor) {
          throw new Error(`unreadable durable record ${request.conversationId}`);
        }
        return {
          state: { config: {}, revision: 0, resolution: { status: 'resolved', value: {} } },
          record: { conversationId: request.conversationId },
          migrated: false,
          diagnostics: [],
        };
      },
      listRecoverable: async () =>
        input.recoverable.map((entry) => ({
          ...entry,
          config: { provider: 'claude' },
          currentSession: null,
          creation: undefined,
          lastResolvedConfig: undefined,
        })),
    } as unknown as ConversationConfigService,
    loadConversations: async (options: {
      onProgress(
        batch: DiscoveredConversation[],
        progress: { loaded: number; total: number }
      ): Promise<void>;
    }) => {
      await options.onProgress([], { loaded: 0, total: 0 });
      return { mtimes: new Map<string, number>() };
    },
    pollConversations: async () => ({ mtimes: new Map<string, number>() }),
    createConversation: (conversationOptions: ConversationOptions) => {
      created.push(conversationOptions);
      return {
        id: conversationOptions.id,
        parentConversationId: null,
        messages: [],
        createdAt: new Date(),
        subAgents: [],
        toJSON: () => ({ id: conversationOptions.id, messages: [] }),
      } as unknown as ConversationRuntime;
    },
    createId: () => 'unused-id',
    resolveBuddyConversation: async (context: BuddyContext) => ({ context, briefing: 'soul' }),
    dispatchInitialMessage: async () => {},
    persistCurrentSession: async () => {},
    broadcast: () => {},
    logger: { error: () => {}, log: () => {}, warn: () => {} },
  } as unknown as SessionLoaderDependencies;

  let threw = false;
  try {
    await createSessionLoader(dependencies).loadExistingConversations();
  } catch {
    threw = true;
  }
  return { recovered: created.map((options) => options.id), threw };
}

/**
 * Regression, incident 2026-08-20. The recovery loop had no error handling, and
 * it runs inside the startup barrier: one unreadable or future-versioned durable
 * record threw all the way out of loadExistingConversations() into
 * handleStartupFailure(), which exits the process with code 1. A single bad
 * record therefore bricked every conversation on disk and the backend would not
 * boot. Deleting this test lets one corrupt file take down startup again.
 */
test('one unrecoverable record does not abort the whole startup hydration', async () => {
  const result = await recoverAll({
    recoverable: [
      { conversationId: 'aaaaaaaa-0000-4000-8000-000000000001', workingDirectory: '/tmp/a' },
      { conversationId: 'bbbbbbbb-0000-4000-8000-000000000002', workingDirectory: '/tmp/b' },
      { conversationId: 'cccccccc-0000-4000-8000-000000000003', workingDirectory: '/tmp/c' },
    ],
    failFor: 'bbbbbbbb-0000-4000-8000-000000000002',
  });

  assert.equal(result.threw, false, 'startup hydration must survive a bad record');
  assert.deepEqual(result.recovered, [
    'aaaaaaaa-0000-4000-8000-000000000001',
    'cccccccc-0000-4000-8000-000000000003',
  ]);
});

/**
 * Exercises kind reconciliation through the real polling boundary. The timer is
 * returned by SessionLoader solely so callers that own its lifecycle can stop it;
 * production startup intentionally leaves it running for the process lifetime.
 */
async function pollExistingKind(input: {
  existingKind: ConversationKind;
  source: DiscoveredConversation;
}): Promise<{ runtimeKind: ConversationKind; broadcastKind: ConversationKind }> {
  const conversationId = 'dddddddd-0000-4000-8000-000000000004';
  const sessionId = input.source.sessionId;
  const runtimeState = {
    id: conversationId,
    sessionId,
    provider: input.source.provider,
    workingDirectory: input.source.workingDirectory,
    messages: [],
    subAgents: [],
    createdAt: new Date(),
    isWorker: false,
    swarmId: null,
    workerId: null,
    workerRole: null,
    parentConversationId: null,
    resumedFromConversationId: null,
    modelName: null,
    kind: input.existingKind,
    hasActiveProcess: () => false,
    refreshConfigResolution: () => {},
    toJSON: () =>
      ({
        id: conversationId,
        sessionId: runtimeState.sessionId,
        messages: runtimeState.messages,
        kind: runtimeState.kind,
      }) as unknown as ConversationData,
  };
  const runtime = runtimeState as unknown as ConversationRuntime;
  const registry = new Map<string, ConversationRuntime>([[conversationId, runtime]]);
  const aliases = new Map<string, string>();
  const externalActivity = new Map<string, number>();

  let resolveUpdated!: () => void;
  const updated = new Promise<void>((resolve) => {
    resolveUpdated = resolve;
  });
  let broadcastKind: ConversationKind | undefined;

  const dependencies = {
    options: {
      startupLimit: 10,
      startupConcurrency: 1,
      startupBatchSize: 1,
      startupInitialBatchSize: 1,
      startupLogEveryFiles: 1000,
      pollIntervalMs: 5,
      externalGraceMs: 1000,
      verbose: false,
    },
    registry: {
      get: (id: string) => registry.get(id),
      has: (id: string) => registry.has(id),
      set: (conversation: ConversationRuntime) => registry.set(conversation.id, conversation),
      delete: (id: string) => registry.delete(id),
      values: () => registry.values(),
      entries: () => registry.entries(),
      keys: () => registry.keys(),
      get size() {
        return registry.size;
      },
    },
    sessions: {
      registerAlias: (id: string, ownerId: string) => aliases.set(id, ownerId),
      unregisterAlias: (id: string) => aliases.delete(id),
      unregisterConversationAliases: () => {},
      aliasFor: (id: string) => aliases.get(id),
      aliasEntries: () => aliases.entries(),
      hasAlias: (id: string) => aliases.has(id),
      isKnown: () => false,
      isDeleted: () => false,
      markDeleted: () => {},
      prune: () => {},
    },
    externalActivity: {
      entries: () => externalActivity.entries(),
      has: (id: string) => externalActivity.has(id),
      set: (id: string, timestamp: number) => externalActivity.set(id, timestamp),
      delete: (id: string) => externalActivity.delete(id),
      clear: (...ids: string[]) => ids.forEach((id) => externalActivity.delete(id)),
    },
    completionSuppression: {
      mark: () => {},
      clear: () => {},
      isSuppressed: () => false,
      prune: () => {},
    },
    configStore: {} as ConversationConfigStore,
    configService: {} as ConversationConfigService,
    loadConversations: async () => ({ mtimes: new Map<string, number>() }),
    pollConversations: async () => ({
      updated: new Map([[sessionId, input.source]]),
      mtimes: new Map<string, number>(),
    }),
    createConversation: () => {
      throw new Error('poll should update the existing runtime');
    },
    createId: () => 'unused-id',
    resolveBuddyConversation: async (context: BuddyContext) => ({ context, briefing: 'soul' }),
    dispatchInitialMessage: async () => {},
    persistCurrentSession: async () => {},
    broadcast: (data: ConversationBroadcast) => {
      if (data.type !== 'conversations_updated') return;
      broadcastKind = data.conversations[0]?.kind;
      resolveUpdated();
    },
    logger: { error: () => {}, log: () => {}, warn: () => {} },
  } as unknown as SessionLoaderDependencies;

  const interval = createSessionLoader(dependencies).startFilePolling();
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      updated,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('poll update was not broadcast')), 1000);
      }),
    ]);
  } finally {
    clearInterval(interval);
    if (timeout) clearTimeout(timeout);
  }

  assert.ok(broadcastKind, 'expected the poll update to include a canonical kind');
  return { runtimeKind: runtimeState.kind, broadcastKind };
}

// Regression, incident 2026-08-22. Codex can store host-injected user-role
// metadata before the real Buddy prompt. The adapter then reports general
// because the first user item has no Buddy marker. Polling used to overwrite the
// durable runtime kind, moving the thread out of the Buddy sidebar and removing
// Buddy MCP tools on the next turn.
test('polling cannot demote a durable Buddy kind when the provider reports general', async () => {
  const buddyKind = buddyKindFromContext(BUDDY);
  const source = {
    ...discoveredWithoutMarker('eeeeeeee-0000-4000-8000-000000000005'),
    provider: 'codex',
  } as DiscoveredConversation;

  const result = await pollExistingKind({ existingKind: buddyKind, source });

  assert.deepEqual(result.runtimeKind, buddyKind);
  assert.deepEqual(result.broadcastKind, buddyKind);
});

test('polling can still promote a general runtime when the provider reports a Buddy kind', async () => {
  const buddyKind = buddyKindFromContext(BUDDY);
  const source = {
    ...discoveredWithoutMarker('ffffffff-0000-4000-8000-000000000006'),
    provider: 'codex',
    kind: buddyKind,
    buddyContext: BUDDY,
  } as DiscoveredConversation;

  const result = await pollExistingKind({
    existingKind: { kind: 'general' },
    source,
  });

  assert.deepEqual(result.runtimeKind, buddyKind);
  assert.deepEqual(result.broadcastKind, buddyKind);
});
