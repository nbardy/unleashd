import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type BuddyContext,
  type ConversationKind,
  EncodedRowsSchema,
  type RowKind,
  buddyKind,
  decodeRows,
  rowKind,
} from '@unleashd/shared';
import type { DiscoveredSession } from '../src/adapters/disk-adapter';
import { buildFirstTurnCliContent } from '../src/buddies/turn-policy';
import type { ConversationConfigService } from '../src/conversations/config-service';
import type { ConversationConfigStore } from '../src/conversations/config-store';
import type {
  ConversationBroadcast,
  ConversationOptions,
  ConversationRuntime,
} from '../src/conversations/runtime';
import {
  type SessionLoaderDependencies,
  createSessionLoader,
} from '../src/lifecycle/session-loader';
import { discoveredSession } from './fixtures/discovered-session';

const BUDDY: BuddyContext = {
  buddyId: 'buddy_d3f11f11',
  workspaceId: 'project_26fce156',
};

/**
 * A transcript as discovery reports it with no marker of its owner: the shape
 * every Chat "Fork" of a Buddy thread has (its first message is the pasted
 * fork draft).
 */
function discoveredWithoutMarker(sessionId: string): DiscoveredSession {
  return discoveredSession({
    sessionId,
    workingDirectory: '/tmp/unleashd-test',
    provider: 'claude',
  });
}

/**
 * Drives `loadExistingConversations()` over exactly one discovered session and
 * returns the options the loader handed to the Conversation constructor.
 * `createConversation` is a real injected boundary of the loader, so capturing
 * it asserts the loader's actual output contract — the resolved canonical kind.
 */
async function hydrateOne(input: {
  source: DiscoveredSession;
  kind: ConversationKind;
  creation?: Record<string, unknown>;
}): Promise<ConversationOptions> {
  const conversationId = 'bb79c16e-4579-4523-9720-d90f9d72076b';
  const record = {
    conversationId,
    workingDirectory: input.source.workingDirectory,
    currentSession: { provider: input.source.provider, sessionId: input.source.sessionId },
    sessionBindings: [],
    status: 'active',
    kind: input.kind,
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
      onProgress(
        batch: DiscoveredSession[],
        progress: { loaded: number; total: number }
      ): Promise<void>;
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
        toRow: () => ({ id: conversationOptions.id, run: 'idle' }),
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

// Regression: forks of Buddy threads silently de-buddied on every server restart
// (the transcript's "general" beat the record's creation.buddyContext), and
// polling once demoted a Buddy thread whose provider stored metadata before the
// marker (incident 2026-08-22). Since T09 the record's `kind` is the only
// identity; these guard that the transcript can no longer move it.
test('hydration takes identity from the record, never from the transcript', async () => {
  const kind = buddyKind(BUDDY);
  const options = await hydrateOne({
    source: discoveredWithoutMarker('d682b842-fcba-48fe-9634-c7b9d4f7a52c'),
    kind,
    creation: { resumedFromConversationId: '2429d826-0cd4-4f1f-ae4f-cc968edb5f5f' },
  });
  assert.deepEqual(options.kind, kind);

  const chat = await hydrateOne({
    source: {
      ...discoveredWithoutMarker('11111111-2222-3333-4444-555555555555'),
      discoveredKind: { t: 'worker', swarmId: 'swarm', workerId: 'w0', role: 'work' },
    },
    kind: { t: 'chat' },
  });
  assert.deepEqual(chat.kind, { t: 'chat' });
});

test('hydration retains the memory snapshot embedded at application-conversation creation', async () => {
  const firstPrompt = buildFirstTurnCliContent({
    content: 'Original user message',
    messageCount: 0,
    hasStartedSession: false,
    kind: buddyKind(BUDDY),
    buddyBriefing: 'Memory from generation seven',
    buddyMemoryGeneration: 'generation-7',
    swarmDebugPrefix: null,
  });
  const options = await hydrateOne({
    source: {
      ...discoveredWithoutMarker('d682b842-fcba-48fe-9634-c7b9d4f7a52b'),
      messages: [
        {
          role: 'user',
          content: firstPrompt,
          timestamp: new Date(),
        },
      ],
    },
    kind: buddyKind(BUDDY),
  });

  assert.equal(options.buddyMemoryGeneration, 'generation-7');
  assert.equal(options.buddyBriefing, 'Memory from generation seven');
});

/**
 * Drives the durable-record recovery pass (no transcripts on disk) with a
 * `hydrate` that fails for one specific conversation. Returns the ids that were
 * actually recovered, plus whether the whole load rejected.
 */
async function recoverAll(input: {
  recoverable: Array<{
    conversationId: string;
    workingDirectory: string | null;
    provenance?: string;
    createdAt?: string;
    creation?: { initialMessage?: string; initialMessageDispatchedAt?: string };
  }>;
  failFor: string;
}): Promise<{
  recovered: string[];
  threw: boolean;
  createdAt: Map<string, Date>;
  broadcastIds: string[];
  dispatched: string[];
}> {
  const created: ConversationOptions[] = [];
  const broadcastIds: string[] = [];
  const dispatched: string[] = [];
  const creations = new Map(
    input.recoverable.map((entry) => [entry.conversationId, entry.creation])
  );
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
          record: {
            conversationId: request.conversationId,
            creation: creations.get(request.conversationId),
          },
          migrated: false,
          diagnostics: [],
        };
      },
      listRecoverable: async () =>
        input.recoverable.map((entry) => ({
          provenance: 'user',
          createdAt: '2026-01-01T00:00:00.000Z',
          ...entry,
          config: { provider: 'claude' },
          sessionBindings: [],
          currentSession: null,
          kind: { t: 'chat' },
          creation: undefined,
          lastResolvedConfig: undefined,
        })),
    } as unknown as ConversationConfigService,
    loadConversations: async (options: {
      onProgress(
        batch: DiscoveredSession[],
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
        toRow: () => ({ id: conversationOptions.id, run: 'idle' }),
      } as unknown as ConversationRuntime;
    },
    createId: () => 'unused-id',
    resolveBuddyConversation: async (context: BuddyContext) => ({ context, briefing: 'soul' }),
    dispatchInitialMessage: async (conversation: ConversationRuntime) => {
      dispatched.push(conversation.id);
    },
    persistCurrentSession: async () => {},
    broadcast: (data: ConversationBroadcast) => {
      if (data.type === 'rows') broadcastIds.push(...data.rows.map((row) => row.id));
    },
    logger: { error: () => {}, log: () => {}, warn: () => {} },
  } as unknown as SessionLoaderDependencies;

  let threw = false;
  try {
    await createSessionLoader(dependencies).loadExistingConversations();
  } catch {
    threw = true;
  }
  const createdAt = new Map<string, Date>();
  for (const [id, conversation] of registry) createdAt.set(id, conversation.createdAt);
  return {
    recovered: created.map((options) => options.id),
    threw,
    createdAt,
    broadcastIds,
    dispatched,
  };
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
 * Regression, incident 2026-09-06. Startup hydrates only the newest
 * `startupLimit` (500) transcripts, but the recovery pass ran over EVERY active
 * durable record — including the one `external_discovered` sidecar written per
 * session file ever seen. Every un-hydrated session therefore came back as a
 * message-less conversation stamped createdAt=now: 5,275 of 5,633 conversations
 * in the init payload, all titled "New conversation — 1m ago", all sorted into
 * the top of the sidebar's recent-folder groups. A config sidecar is evidence
 * that a transcript exists on disk, never evidence that a conversation exists.
 * Deleting this test lets the sidebar refill with thousands of empty rows.
 */
test('externally-discovered records are not recovered as empty conversations', async () => {
  const result = await recoverAll({
    recoverable: [
      {
        conversationId: 'aaaaaaaa-0000-4000-8000-000000000001',
        workingDirectory: '/tmp/a',
        provenance: 'external_discovered',
      },
      {
        conversationId: 'bbbbbbbb-0000-4000-8000-000000000002',
        workingDirectory: '/tmp/b',
        provenance: 'user',
      },
    ],
    failFor: 'none',
  });

  assert.deepEqual(result.recovered, ['bbbbbbbb-0000-4000-8000-000000000002']);
});

// Same incident, ordering half: a recovered conversation kept the runtime's
// `new Date()` default, so history with nothing on disk claimed it was created
// at boot and outranked genuinely recent threads in every time-sorted view.
test('a recovered conversation keeps the durable record createdAt', async () => {
  const result = await recoverAll({
    recoverable: [
      {
        conversationId: 'bbbbbbbb-0000-4000-8000-000000000002',
        workingDirectory: '/tmp/b',
        createdAt: '2026-03-04T05:06:07.000Z',
      },
    ],
    failFor: 'none',
  });

  assert.equal(
    result.createdAt.get('bbbbbbbb-0000-4000-8000-000000000002')?.toISOString(),
    '2026-03-04T05:06:07.000Z'
  );
});

// A client connected during startup learns of conversations only from
// broadcasts; `conversation_load_complete` prunes but never adds. Recovered
// conversations were registered without one, so an open app showed none of
// them until it reconnected (2026-09-25).
test('recovered conversations are broadcast to clients connected during startup', async () => {
  const result = await recoverAll({
    recoverable: [
      { conversationId: 'aaaaaaaa-0000-4000-8000-000000000001', workingDirectory: '/tmp/a' },
      { conversationId: 'bbbbbbbb-0000-4000-8000-000000000002', workingDirectory: '/tmp/b' },
    ],
    failFor: 'none',
  });

  assert.deepEqual(result.broadcastIds.sort(), result.recovered.sort());
  assert.equal(result.broadcastIds.length, 2);
});

// Recovery skips the dispatch claim when nothing can be pending (2026-09-25).
// The half that matters: a recovered conversation whose first message was
// never sent must still be dispatched, or it waits forever on "Starting…".
test('recovery dispatches only first messages that are still pending', async () => {
  const result = await recoverAll({
    recoverable: [
      {
        conversationId: 'aaaaaaaa-0000-4000-8000-000000000001',
        workingDirectory: '/tmp/a',
        creation: { initialMessage: 'hello' },
      },
      {
        conversationId: 'bbbbbbbb-0000-4000-8000-000000000002',
        workingDirectory: '/tmp/b',
        creation: { initialMessage: 'hi', initialMessageDispatchedAt: '2026-09-01T00:00:00.000Z' },
      },
      { conversationId: 'cccccccc-0000-4000-8000-000000000003', workingDirectory: '/tmp/c' },
    ],
    failFor: 'none',
  });

  assert.deepEqual(result.dispatched, ['aaaaaaaa-0000-4000-8000-000000000001']);
  assert.equal(result.recovered.length, 3);
});

/**
 * Exercises kind reconciliation through the real polling boundary. The timer is
 * returned by SessionLoader solely so callers that own its lifecycle can stop it;
 * production startup intentionally leaves it running for the process lifetime.
 */
async function pollExistingKind(input: {
  existingKind: ConversationKind;
  source: DiscoveredSession;
}): Promise<{ runtimeKind: ConversationKind; broadcastKind: RowKind }> {
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
    parentConversationId: null,
    resumedFromConversationId: null,
    observedModel: null,
    kind: input.existingKind,
    hasActiveProcess: () => false,
    refreshConfigResolution: () => {},
    toRow: () => ({
      id: conversationId,
      kind: rowKind(runtimeState.kind),
      parent: null,
      resumedFrom: null,
      provider: runtimeState.provider,
      cwd: runtimeState.workingDirectory,
      label: 'fixture',
      createdAt: 0,
      activityAt: 0,
      messageCount: 0,
      run: 'idle' as const,
      done: false,
    }),
  };
  const runtime = runtimeState as unknown as ConversationRuntime;
  const registry = new Map<string, ConversationRuntime>([[conversationId, runtime]]);
  const aliases = new Map<string, string>();
  const externalActivity = new Map<string, number>();

  let resolveUpdated!: () => void;
  const updated = new Promise<void>((resolve) => {
    resolveUpdated = resolve;
  });
  let broadcastKind: RowKind | undefined;

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
    configStore: { findBySession: async () => null } as unknown as ConversationConfigStore,
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
      if (data.type !== 'rows') return;
      broadcastKind = decodeRows(EncodedRowsSchema.parse(data))[0]?.kind;
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

// Regression, incident 2026-08-22: polling overwrote a durable Buddy kind with the
// provider's "general", moving the thread out of the Buddy sidebar and removing
// its Buddy MCP tools. Polling never touches kind now; this keeps it that way.
test('polling never changes a durable kind', async () => {
  const kind = buddyKind(BUDDY);
  const source = {
    ...discoveredWithoutMarker('eeeeeeee-0000-4000-8000-000000000005'),
    provider: 'codex',
  } as DiscoveredSession;

  const result = await pollExistingKind({ existingKind: kind, source });

  assert.deepEqual(result.runtimeKind, kind);
  assert.deepEqual(result.broadcastKind, rowKind(kind));
});
