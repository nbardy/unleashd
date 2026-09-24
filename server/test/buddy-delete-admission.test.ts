import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import type { WebSocketServer } from 'ws';
import { createConversationApplicationContext } from '../src/application/context';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddiesIntegration } from '../src/buddies/integration';
import { MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { BuddyRunExecutor } from '../src/buddies/run-executor';
import { createBuddyCreationService } from '../src/conversations/buddy-creation-service';
import { ConversationConfigService } from '../src/conversations/config-service';
import { ConversationConfigStore } from '../src/conversations/config-store';
import {
  createConversationRuntime,
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';
import { registerConversationWebSocket } from '../src/transport/conversation-websocket';

for (const mode of ['delete-during-link', 'remove-after-readiness', 'normal'] as const) {
  test(
    `real Buddy creation and WebSocket deletion fence admission: ${mode}`,
    { timeout: 5000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'buddy-delete-admission-'));
      const raw = new BuddiesStore(':memory:');
      const store = coordinationStore(raw as unknown as BuddiesStorePort);
      const workspace = raw.createWorkspace({ name: 'Delete fixture', rootPath: root });
      const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Coordinate' });
      const worker = raw.createBuddy({ project: workspace.id, name: 'Worker', role: 'Inspect' });
      store.setCoordinationMembership(worker.id, workspace.id, { background_enabled: true });
      class Socket extends EventEmitter {
        readyState = 1;
        send() {}
      }
      const socket = new Socket();
      const events = new EventEmitter();
      const wss = Object.assign(new EventEmitter(), {
        clients: new Set(),
      }) as unknown as WebSocketServer;
      const app = createConversationApplicationContext<ConversationRuntime>({
        webSocketServer: wss,
        completionSuppressionMs: 0,
      });
      const integration = createBuddiesIntegration({ store, getConversation: app.registry.get });
      const configStore = new ConversationConfigStore({ appDataRoot: root });
      const configService = new ConversationConfigService({
        store: configStore,
        resolver: { resolve: async (config) => resolveConfigAgainstProviderCatalog(config) },
      });
      let providerTurns = 0;
      const Conversation = createConversationRuntime({
        broadcast: () => {},
        registerSessionAlias: app.sessions.registerAlias,
        unregisterSessionAlias: app.sessions.unregisterAlias,
        clearExternalRunningStatus: app.externalActivity.clear,
        clearLocalCompletionSuppression: app.completionSuppression.clear,
        markLocalCompletionSuppression: app.completionSuppression.mark,
        persistCurrentSession: async () => {},
        updateBuddyStatus: integration.updateStatus,
        settleBuddyDelegation: integration.settleDelegation,
        getConversation: app.registry.get,
        readLatestOompaRuntime: () => ({ available: false, run: null, reason: 'fixture' }),
        createSessionId: () => 'fixture-session',
        executeTurn: (() => {
          providerTurns++;
          return {
            child: { exitCode: 0 },
            events: (async function* () {
              yield { type: 'turn.started' as const };
              yield { type: 'text.delta' as const, text: 'Inspected' };
              yield { type: 'turn.complete' as const, reason: 'success' as const };
            })(),
            completed: Promise.resolve({
              exitCode: 0,
              signal: null,
              reason: 'success',
              sessionId: 'fixture-session',
            }),
            stop: () => {},
          };
        }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
      });
      let linkCount = 0;
      const createLink = async (conversation: ConversationRuntime) => {
        linkCount++;
        await integration.createLink(conversation);
        if (mode === 'delete-during-link') {
          const deleted = once(events, 'deleted');
          socket.emit(
            'message',
            Buffer.from(
              JSON.stringify({ type: 'delete_conversation', conversationId: conversation.id })
            )
          );
          await deleted;
          assert.equal(app.registry.get(conversation.id), undefined);
          assert.equal(conversation.hasActiveProcess(), false);
        }
      };
      const creation = createBuddyCreationService({
        configService,
        getConversation: app.registry.get,
        resolveBuddyConversation: integration.resolveConversation,
        resolveWorkingDirectory: (path) => path,
        isProviderAvailable: () => true,
        createId: () => assert.fail('Stable run identity is required'),
        createConversation: (options) => new Conversation(options),
        registerConversation: app.registry.set,
        createConversationLink: createLink,
        updateConversationStatus: integration.updateStatus,
        broadcast: () => {},
      });
      registerConversationWebSocket(wss, {
        ...app,
        configService,
        initialLoadComplete: Promise.resolve(),
        isInitialLoadComplete: () => true,
        beginCommand: () => () => {},
        getDefaultWorkingDirectory: () => root,
        resolveWorkingDirectory: (path) => path,
        resolveBuddyConversation: integration.resolveConversation,
        createConversation: (options) => new Conversation(options),
        createConversationLink: integration.createLink,
        cancelBuddyConversation: (conversation) => {
          integration.updateStatus(conversation, 'cancelled');
          void integration.settleDelegation(conversation, 'cancelled');
        },
        dispatchInitialMessage: creation.dispatchInitialMessageIfPending,
        broadcast: (message) => {
          if (message.type === 'conversation_deleted') events.emit('deleted');
        },
        logger: { log: () => {}, error: (error) => assert.fail(String(error)) },
      });
      wss.emit('connection', socket);
      const executor = new BuddyRunExecutor({
        store,
        getConversation: app.registry.get,
        createConversation: async (input) => {
          const conversation = await creation.createServerBuddyConversation(input);
          if (mode === 'remove-after-readiness') app.registry.delete(conversation.id);
          return conversation;
        },
        ensureConversationReady: creation.ensureConversationReady,
      });
      try {
        store.sendCoordinatedMessage(
          {
            fromBuddy: lead.id,
            to: worker.id,
            workspace: workspace.id,
            key: 'inspect',
            purpose: 'Inspect',
            body: 'Read this fixture',
          },
          { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
        );
        executor.poll();
        for (let n = 0; n < 300 && executor.activeRunIds.length; n++)
          await new Promise((resolve) => setTimeout(resolve, 5));
        assert.equal(executor.activeRunIds.length, 0);
        const run = store.listBuddyRuns({ buddyId: worker.id })[0];
        assert.equal(linkCount, 1);
        const record = await configService.getRecord(run.conversation_id!);
        assert.equal(record?.creation?.commandId, `coordination-${run.id}`);
        assert.ok(run.deadline);
        assert.equal(providerTurns, mode === 'normal' ? 1 : 0);
        assert.equal(run.status, mode === 'normal' ? 'complete' : 'failed', run.error ?? undefined);
        if (mode === 'delete-during-link') assert.equal(record?.status, 'deleted');
        if (mode !== 'normal') {
          assert.equal(app.registry.size, 0);
          assert.match(run.error!, /deleted|registered|replaced/i);
        }
      } finally {
        executor.stop();
        await new Promise((resolve) => setImmediate(resolve));
        raw.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  );
}
