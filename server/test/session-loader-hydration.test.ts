import assert from 'node:assert/strict';
import test from 'node:test';
import type { BuddyContext, DiscoveredConversation } from '@unleashd/shared';
import type { ConversationConfigService } from '../src/conversations/config-service';
import type { ConversationConfigStore } from '../src/conversations/config-store';
import type { ConversationOptions, ConversationRuntime } from '../src/conversations/runtime';
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
