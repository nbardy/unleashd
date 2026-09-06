import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createDefaultConversationConfig } from '@unleashd/shared';
import type { BuddyContext } from '@unleashd/shared';
import { sessionToConversation } from '../src/adapters/disk-adapter';
import { buildFirstTurnCliContent, createConversationRuntime } from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';
import { registerConversationWebSocket } from '../src/transport/conversation-websocket';

const buddyContext: BuddyContext = {
  buddyId: 'buddy-1',
  workspaceId: 'workspace-1',
  buddyProjectId: null,
};

// Canonical BuddyContext absence invariant (shared/src/conversation-kind.ts):
// every `.nullish()` field round-trips as an explicit `null`, while the
// `.optional()` allowedBuddyOperations is omitted when absent. Anything that
// stores a BuddyContext goes through kind ⇄ context, so reads come back in this
// shape regardless of which subset of fields was supplied at construction.
const canonicalBuddyContext: BuddyContext = {
  buddyId: 'buddy-1',
  workspaceId: 'workspace-1',
  buddyProjectId: null,
  legacyWorkItemId: null,
  automationRunId: null,
  delegatedByBuddyId: null,
  parentBuddyConversationId: null,
};

function runtimeFixture() {
  const broadcasts: unknown[] = [];
  const config = createDefaultConversationConfig('codex');
  const Conversation = createConversationRuntime({
    broadcast: (message) => broadcasts.push(message),
    registerSessionAlias: () => undefined,
    unregisterSessionAlias: () => undefined,
    clearExternalRunningStatus: () => undefined,
    clearLocalCompletionSuppression: () => undefined,
    markLocalCompletionSuppression: () => undefined,
    persistCurrentSession: async () => undefined,
    updateBuddyStatus: () => undefined,
    settleBuddyDelegation: () => undefined,
    getConversation: () => undefined,
    readLatestOompaRuntime: () => ({
      available: false,
      run: null,
      reason: 'No Oompa runtime',
    }),
    createSessionId: () => 'rotated-session',
  });
  return {
    broadcasts,
    config,
    Conversation,
    configState: {
      config,
      revision: 0,
      resolution: resolveConfigAgainstProviderCatalog(config),
    },
  };
}

test('empty Buddy conversation construction is inert and suppresses incompatible Swarm state', () => {
  const fixture = runtimeFixture();
  const conversation = new fixture.Conversation({
    id: 'buddy-conversation',
    workingDirectory: '/tmp',
    configState: fixture.configState,
    buddyContext,
    buddyBriefing: 'Private Buddy briefing',
    // Malformed legacy input must not make a Buddy an Oompa worker.
    isWorker: true,
    swarmId: 'swarm-1',
    workerId: 'worker-1',
    workerRole: 'work',
    swarmDebugPrefix: 'SWARM DEBUG',
  });

  assert.equal(conversation.isRunning, false);
  assert.equal(conversation.process, null);
  assert.deepEqual(conversation.messages, []);
  assert.deepEqual(fixture.broadcasts, []);
  assert.deepEqual(conversation.buddyContext, canonicalBuddyContext);
  assert.equal(conversation.isWorker, false);
  assert.equal(conversation.swarmId, null);
  assert.equal(conversation.workerId, null);
  assert.equal(conversation.workerRole, null);
  assert.equal(conversation.swarmDebugPrefix, null);
});

test('empty Buddy WebSocket creation resolves and registers without sending a provider turn', async () => {
  const fixture = runtimeFixture();
  const conversations = new Map<string, InstanceType<typeof fixture.Conversation>>();
  const transportBroadcasts: unknown[] = [];
  let initialDispatches = 0;
  let runtimeCreations = 0;
  let conversationLinks = 0;
  let buddyCancellations = 0;
  let acceptsCommands = false;
  let finishInitialLoad!: () => void;
  const initialLoadComplete = new Promise<void>((resolve) => {
    finishInitialLoad = resolve;
  });
  class FakeSocket extends EventEmitter {
    readyState = 1;
    sent: string[] = [];
    send(payload: string): void {
      this.sent.push(payload);
    }
  }
  const webSocketServer = new EventEmitter();
  registerConversationWebSocket(
    webSocketServer as never,
    {
      registry: {
        get: (id: string) => conversations.get(id),
        set: (conversation: InstanceType<typeof fixture.Conversation>) => {
          conversations.set(conversation.id, conversation);
        },
        delete: (id: string) => conversations.delete(id),
        values: () => conversations.values(),
        keys: () => conversations.keys(),
      },
      sessions: {
        markDeleted: () => undefined,
        aliasEntries: () => [][Symbol.iterator](),
        unregisterConversationAliases: () => undefined,
      },
      externalActivity: { clear: () => undefined, has: () => false },
      completionSuppression: { clear: () => undefined },
      initialLoadComplete,
      isInitialLoadComplete: () => acceptsCommands,
      beginCommand: (command: { type: string }) =>
        command.type === 'create_conversation' || acceptsCommands ? () => undefined : null,
      configService: {
        getRecord: async () => null,
        delete: async () => true,
        createOrReplay: async (input: {
          conversationId: string;
          config: typeof fixture.config;
          workingDirectory: string;
        }) => ({
          record: { workingDirectory: input.workingDirectory },
          state: {
            config: input.config,
            revision: 0,
            resolution: resolveConfigAgainstProviderCatalog(input.config),
          },
        }),
      },
      getUIState: () => ({
        activeConversationId: null,
        lastWorkingDirectory: null,
        galleryExpandedProjects: [],
      }),
      getDefaultWorkingDirectory: () => '/tmp',
      resolveWorkingDirectory: (directory: string) => directory,
      resolveBuddyConversation: async () => ({
        context: buddyContext,
        briefing: 'PRIVATE BRIEFING',
        workingDirectory: '/tmp',
        provider: 'codex',
      }),
      createConversation: (options) => {
        runtimeCreations += 1;
        return new fixture.Conversation(options);
      },
      createConversationLink: async () => {
        conversationLinks += 1;
      },
      cancelBuddyConversation: () => {
        buddyCancellations += 1;
      },
      dispatchInitialMessage: async () => {
        initialDispatches += 1;
      },
      creationFingerprint: () => 'fingerprint',
      broadcast: (message) => transportBroadcasts.push(message),
      broadcastExcept: (_socket, message) => transportBroadcasts.push(message),
      logger: { log: () => undefined, error: () => undefined },
    } as never
  );

  const socket = new FakeSocket();
  webSocketServer.emit('connection', socket);
  assert.deepEqual(
    JSON.parse(socket.sent[0]) as { type?: string; summaries?: boolean; loading?: boolean },
    {
      type: 'init',
      summaries: true,
      loading: true,
      conversations: [],
      defaultCwd: '/tmp',
      uiState: {
        activeConversationId: null,
        lastWorkingDirectory: null,
        galleryExpandedProjects: [],
      },
      protocol: {
        version: 2,
        capabilities: ['conversation_config', 'conversation_updated', 'structured_command_errors'],
      },
    }
  );
  socket.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        type: 'create_conversation',
        commandId: 'create-empty-buddy',
        conversationId: '00000000-0000-4000-8000-000000000123',
        workingDirectory: '/tmp',
        config: fixture.config,
        buddyContext,
      })
    )
  );
  socket.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        type: 'create_conversation',
        commandId: 'create-empty-buddy',
        conversationId: '00000000-0000-4000-8000-000000000123',
        workingDirectory: '/tmp',
        config: fixture.config,
        buddyContext,
      })
    )
  );
  await new Promise((resolve) => setImmediate(resolve));

  const conversation = conversations.get('00000000-0000-4000-8000-000000000123');
  assert.ok(conversation);
  assert.equal(runtimeCreations, 1);
  assert.equal(conversationLinks, 1);
  assert.equal(initialDispatches, 1);
  assert.equal(conversation.isRunning, false);
  assert.equal(conversation.process, null);
  assert.deepEqual(conversation.messages, []);
  assert.equal(
    fixture.broadcasts.some((message) => (message as { type?: string }).type === 'message'),
    false
  );
  finishInitialLoad();
  acceptsCommands = true;
  socket.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        type: 'delete_conversation',
        conversationId: '00000000-0000-4000-8000-000000000123',
      })
    )
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(buddyCancellations, 1);
  assert.equal(conversations.has('00000000-0000-4000-8000-000000000123'), false);
});

test('replaying create_conversation reports the real failure, not a config mismatch', async () => {
  // Regression guard (2026-09-06). The replay path's catch answered every
  // failure with "Conversation ID already exists with different configuration".
  // dispatchInitialMessage rethrows Buddy-authority rejections, so an inactive
  // Buddy read to the user as a config mismatch — right after conversation_created.
  // Deleting this test lets that misattribution return silently: the happy-path
  // test above never makes dispatch throw.
  const fixture = runtimeFixture();
  const conversationId = '00000000-0000-4000-8000-000000000456';
  const existing = new fixture.Conversation({
    id: conversationId,
    workingDirectory: '/tmp',
    configState: fixture.configState,
    buddyContext,
  });
  const conversations = new Map([[conversationId, existing]]);
  const rejectionText = 'Buddy authority rejected the initial message: buddy is inactive';
  class FakeSocket extends EventEmitter {
    readyState = 1;
    sent: string[] = [];
    send(payload: string): void {
      this.sent.push(payload);
    }
  }
  const webSocketServer = new EventEmitter();
  registerConversationWebSocket(
    webSocketServer as never,
    {
      registry: {
        get: (id: string) => conversations.get(id),
        set: () => undefined,
        delete: (id: string) => conversations.delete(id),
        values: () => conversations.values(),
        keys: () => conversations.keys(),
      },
      sessions: {
        markDeleted: () => undefined,
        aliasEntries: () => [][Symbol.iterator](),
        unregisterConversationAliases: () => undefined,
      },
      externalActivity: { clear: () => undefined, has: () => false },
      completionSuppression: { clear: () => undefined },
      initialLoadComplete: Promise.resolve(),
      isInitialLoadComplete: () => true,
      beginCommand: () => () => undefined,
      configService: {
        getRecord: async () => null,
        delete: async () => true,
        // A matching replay: createOrReplay succeeds, so the only thing left
        // to throw inside that try is dispatchInitialMessage.
        createOrReplay: async () => ({ record: { workingDirectory: '/tmp' }, replayed: true }),
      },
      getUIState: () => ({
        activeConversationId: null,
        lastWorkingDirectory: null,
        galleryExpandedProjects: [],
      }),
      getDefaultWorkingDirectory: () => '/tmp',
      resolveWorkingDirectory: (directory: string) => directory,
      resolveBuddyConversation: async () => ({
        context: buddyContext,
        briefing: 'PRIVATE BRIEFING',
        workingDirectory: '/tmp',
        provider: 'codex',
      }),
      createConversation: () => existing,
      createConversationLink: async () => undefined,
      cancelBuddyConversation: () => undefined,
      dispatchInitialMessage: async () => {
        throw new Error(rejectionText);
      },
      creationFingerprint: () => 'fingerprint',
      broadcast: () => undefined,
      broadcastExcept: () => undefined,
      logger: { log: () => undefined, error: () => undefined },
    } as never
  );

  const socket = new FakeSocket();
  webSocketServer.emit('connection', socket);
  socket.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        type: 'create_conversation',
        commandId: 'replay-existing',
        conversationId,
        workingDirectory: '/tmp',
        config: fixture.config,
        buddyContext,
      })
    )
  );
  await new Promise((resolve) => setImmediate(resolve));

  const sent = socket.sent.map(
    (payload) => JSON.parse(payload) as { type: string; error?: { message: string } }
  );
  const rejected = sent.find((message) => message.type === 'command_rejected');
  assert.ok(rejected, 'a replay failure must surface as command_rejected');
  assert.equal(rejected.error?.message, rejectionText);
  assert.ok(
    sent.some((message) => message.type === 'conversation_created'),
    'the replay still acknowledges the existing conversation before dispatch runs'
  );
});

test('hidden Buddy briefing is injected exactly once and never on resumed turns', () => {
  const first = buildFirstTurnCliContent({
    content: 'Start the campaign.',
    messageCount: 0,
    hasStartedSession: false,
    buddyContext,
    buddyBriefing: 'PRIVATE BRIEFING',
    swarmDebugPrefix: 'SWARM DEBUG',
  });
  assert.match(first, /^<!-- unleashd:buddy-context-v2 /);
  assert.equal(first.match(/PRIVATE BRIEFING/g)?.length, 1);
  assert.equal(first.includes('unleashd:swarm-prefix'), false);
  assert.match(first, /\n\nStart the campaign\.$/);

  const nextTurn = buildFirstTurnCliContent({
    content: 'Continue.',
    messageCount: 2,
    hasStartedSession: true,
    buddyContext,
    buddyBriefing: 'PRIVATE BRIEFING',
    swarmDebugPrefix: null,
  });
  assert.equal(nextTurn, 'Continue.');

  const resumedWithoutLoadedMessages = buildFirstTurnCliContent({
    content: 'Resume.',
    messageCount: 0,
    hasStartedSession: true,
    buddyContext,
    buddyBriefing: 'PRIVATE BRIEFING',
    swarmDebugPrefix: null,
  });
  assert.equal(resumedWithoutLoadedMessages, 'Resume.');
});

test('disk hydration restores Buddy ownership, removes hidden briefing, and remains non-Swarm', () => {
  // Even a legacy-looking worker tag in the user's actual prompt cannot turn
  // typed Buddy ownership into an Oompa conversation.
  const visiblePrompt = '[oompa:legacy-swarm:worker-1] What should we ship next?';
  const hydrated = sessionToConversation({
    sessionId: 'provider-session',
    filePath: '/tmp/provider-session.jsonl',
    workingDirectory: '/tmp',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    modifiedAt: new Date('2026-01-01T00:01:00.000Z'),
    messages: [
      {
        role: 'user',
        content: `<!-- unleashd:buddy-context ${JSON.stringify(buddyContext)} -->\nPRIVATE BRIEFING\n<!-- /unleashd:buddy-context -->\n\n${visiblePrompt}`,
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
  });

  assert.ok(hydrated);
  assert.deepEqual(hydrated.buddyContext, buddyContext);
  assert.equal(hydrated.messages[0].content, visiblePrompt);
  assert.equal(hydrated.messages[0].content.includes('PRIVATE BRIEFING'), false);
  assert.equal(hydrated.isWorker, false);
  assert.equal(hydrated.swarmId, null);
  assert.equal(hydrated.workerId, null);
  assert.equal(hydrated.workerRole, null);
  assert.equal(hydrated.swarmDebugPrefix, null);
});
