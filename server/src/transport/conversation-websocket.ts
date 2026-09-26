import crypto from 'node:crypto';
import type {
  BuddyContext,
  ClientMessage,
  ConversationKind,
  ConversationRow,
  CreateKind,
  ModelId,
  Provider,
} from '@unleashd/shared';
import {
  CHAT_KIND,
  PROTOCOL_MISMATCH_CLOSE_CODE,
  PROTOCOL_VERSION,
  buddyKind,
  encodeRows,
  kindBuddyContext,
  requestedProtocol,
  safeParseClientMessage,
} from '@unleashd/shared';
import { WebSocket, type WebSocketServer } from 'ws';
import type {
  CompletionSuppression,
  ConversationRegistry,
  ExternalActivity,
  SessionTracking,
} from '../application/context';
import { ConfigRevisionConflictError } from '../conversations/config-records';
import {
  type ConversationConfigService,
  ConversationTombstonedError,
} from '../conversations/config-service';
import { createConversationService } from '../conversations/creation-service';
import type {
  ConversationBroadcast,
  ConversationOptions,
  ConversationRuntime,
} from '../conversations/runtime';
import { updateRuntimeConfig } from '../conversations/runtime-config';
import { noteActivity } from '../observability/event-loop-stall';
import {
  sendAck,
  sendCommandAccepted,
  sendCommandRejected,
  sendProtocolError,
  sendToClient,
  validateWorkingDirectory,
} from './websocket';

export interface ResolvedBuddyConversation {
  context: BuddyContext;
  briefing: string;
  workingDirectory: string;
  provider: Provider;
  model?: ModelId;
  reasoningEffort?: string;
}

export interface ConversationWebSocketDependencies {
  registry: ConversationRegistry<ConversationRuntime>;
  /**
   * List rows of conversations the registry does not hold (the ingest list,
   * server/src/ingest/conversation-list.ts). `hello` sends registry rows plus these.
   */
  listedRows(): ConversationRow[];
  /**
   * The runtime of a listed conversation, built from its record on first use (T13b S2: most
   * listed conversations have none until opened or sent a command).
   */
  materialize(conversationId: string): Promise<unknown>;
  /** A deleted conversation leaves the ingest list too (its record is tombstoned). */
  forgetListed(conversationId: string): void;
  sessions: SessionTracking;
  externalActivity: ExternalActivity;
  completionSuppression: CompletionSuppression;
  initialLoadComplete: Promise<void>;
  isInitialLoadComplete(): boolean;
  /**
   * Admit one command as active work the shutdown coordinator counts, also
   * while `starting`; null once the backend is reloading or shutting down.
   */
  beginCommand(): (() => void) | null;
  configService: ConversationConfigService;
  getArchivedBuddyIds?(): Promise<string[]>;
  isBuddyArchived?(buddyId: string): Promise<boolean>;
  getDefaultWorkingDirectory(): string;
  resolveWorkingDirectory(input: string): string;
  resolveBuddyConversation(context: BuddyContext): Promise<ResolvedBuddyConversation>;
  createConversation(options: ConversationOptions): ConversationRuntime;
  createConversationLink(conversation: ConversationRuntime): Promise<void>;
  cancelBuddyConversation(conversation: ConversationRuntime): void;
  dispatchInitialMessage(
    conversation: ConversationRuntime,
    options?: { ownerInput: Readonly<{ origin: 'owner_input'; inputId: string }> }
  ): Promise<void>;
  broadcast(data: ConversationBroadcast): void;
  broadcastExcept(excludedClient: WebSocket, data: ConversationBroadcast): void;
  logger?: Pick<Console, 'error' | 'log'>;
}

export function registerConversationWebSocket(
  webSocketServer: WebSocketServer,
  dependencies: ConversationWebSocketDependencies
): void {
  const createOrReuse = createConversationService({
    configService: dependencies.configService,
    getConversation: (id) => dependencies.registry.get(id),
    createConversation: dependencies.createConversation,
    registerConversation: (conversation) => dependencies.registry.set(conversation),
    createConversationLink: dependencies.createConversationLink,
  });
  webSocketServer.on('connection', (socket, request) => {
    const logger = dependencies.logger ?? console;
    // A client of another protocol cannot read these frames. Closing with a
    // typed code makes the tab show it (a pre-v3 tab reads it as a lost
    // connection) instead of keeping a list that silently stops updating.
    if (requestedProtocol(request.url ?? '/') !== PROTOCOL_VERSION) {
      socket.close(PROTOCOL_MISMATCH_CLOSE_CODE, `protocol ${PROTOCOL_VERSION}`);
      return;
    }
    void sendInitialState(socket, dependencies).catch((error) =>
      logger.error('Initial state failed', error)
    );

    socket.on('message', async (message) => {
      let activeCommand: { commandId: string; conversationId?: string } | null = null;
      let releaseCommand: (() => void) | null = null;
      try {
        const parsed: unknown = JSON.parse(message.toString());
        const result = safeParseClientMessage(parsed);
        if (!result.success) {
          rejectInvalidMessage(socket, parsed, result.error.issues, logger);
          return;
        }

        const data = result.data;
        noteActivity(`ws ${data.type}`);
        if ('commandId' in data) {
          activeCommand = {
            commandId: data.commandId,
            ...('conversationId' in data ? { conversationId: data.conversationId } : {}),
          };
        }
        const rejectDraining = () => {
          const unavailable =
            'Backend reload is draining active turns; try again after reconnecting';
          if (activeCommand) {
            sendCommandRejected(socket, {
              ...activeCommand,
              error: { code: 'server_draining', message: unavailable },
            });
          } else {
            sendProtocolError(socket, unavailable);
          }
        };
        // Take the command slot BEFORE awaiting the startup barrier: the slot
        // is what the shutdown coordinator counts as active work. Until
        // 2026-09-25 the barrier was awaited first, so a command parked on it
        // was invisible. A dev reload requested while `starting` (handleReload
        // accepts it) then exited the backend the moment markReady ran
        // completeStartup, and the parked queue_message woke into `reloading`
        // and was rejected with server_draining: a message typed during boot
        // was lost to a file save. Holding the slot keeps the backend `idle`
        // until this command finishes; the queued reload happens after it.
        releaseCommand = dependencies.beginCommand();
        if (!releaseCommand) {
          rejectDraining();
          return;
        }
        // A new UUID and durable config record cannot collide with historical
        // session hydration, so creation is safe as soon as durable services
        // and the WebSocket are available. Commands against existing history
        // still wait for that history to become authoritative.
        if (data.type !== 'create_conversation') {
          await dependencies.initialLoadComplete;
          if (socket.readyState !== WebSocket.OPEN) return;
          // The barrier means "startup is over", not "startup succeeded": a
          // startup failure or SIGTERM during boot resolves it too. Only a
          // backend that reached `idle` may run commands on existing history.
          if (!dependencies.isInitialLoadComplete()) {
            rejectDraining();
            return;
          }
        }
        if ('conversationId' in data && data.type !== 'create_conversation') {
          await dependencies.materialize(data.conversationId);
        }
        const target =
          'conversationId' in data ? dependencies.registry.get(data.conversationId) : undefined;
        const targetBuddy = target ? kindBuddyContext(target.kind) : null;
        if (targetBuddy && (await dependencies.isBuddyArchived?.(targetBuddy.buddyId))) {
          throw new Error('Buddy is archived');
        }
        logCommand(data, logger);

        switch (data.type) {
          case 'create_conversation': {
            let buddyResolution: ResolvedBuddyConversation | null = null;
            try {
              buddyResolution =
                data.kind.t === 'buddy'
                  ? await dependencies.resolveBuddyConversation(data.kind.context)
                  : null;
            } catch (error) {
              logger.error('Conversation creation failed', error);
              sendCommandRejected(socket, {
                commandId: data.commandId,
                conversationId: data.conversationId,
                error: { code: 'create_failed', message: replayFailureMessage(error) },
              });
              break;
            }

            const workingDirectory = dependencies.resolveWorkingDirectory(
              buddyResolution?.workingDirectory ?? data.workingDirectory
            );
            const kind = createdKind(data.kind, buddyResolution, (id) =>
              dependencies.registry.get(id)
            );
            const buddy = kindBuddyContext(kind);
            if (buddy && (await dependencies.isBuddyArchived?.(buddy.buddyId))) {
              throw new Error('Buddy is archived');
            }
            try {
              const persisted = await dependencies.configService.getRecord(data.conversationId);
              if (!persisted) {
                const directoryError = validateWorkingDirectory(workingDirectory);
                if (directoryError) {
                  sendCommandRejected(socket, {
                    commandId: data.commandId,
                    conversationId: data.conversationId,
                    error: directoryError,
                  });
                  break;
                }
              }

              const conversation = await createOrReuse({
                conversationId: data.conversationId,
                commandId: data.commandId,
                workingDirectory,
                config: data.config,
                initialMessage: data.initialMessage,
                swarmDebugPrefix: data.swarmDebugPrefix,
                resumedFromConversationId: data.kind.t === 'fork' ? data.kind.from : undefined,
                kind,
                buddyBriefing: buddyResolution?.briefing,
              });
              const rows = encodeRows([conversation.toRow()]);
              sendAck(socket, data.commandId, { t: 'created', rows });
              dependencies.broadcastExcept(socket, { type: 'rows', ...rows });
              await dependencies.dispatchInitialMessage(conversation, {
                ownerInput: { origin: 'owner_input', inputId: data.commandId },
              });
            } catch (error) {
              logger.error('Conversation creation failed', error);
              sendCommandRejected(socket, {
                commandId: data.commandId,
                conversationId: data.conversationId,
                error: { code: 'create_failed', message: errorMessage(error) },
              });
            }
            break;
          }

          case 'stop_conversation':
            dependencies.registry.get(data.conversationId)?.stop();
            break;

          case 'delete_conversation': {
            const conversation = dependencies.registry.get(data.conversationId);
            const deletedDurably = await dependencies.configService.delete(data.conversationId);
            if (conversation) {
              conversation.stop();
              // stop() only closes Buddy ownership while a provider process is
              // running. Deleting an idle persistent Buddy thread must also
              // terminalize its durable link (and delegated/review work).
              dependencies.cancelBuddyConversation(conversation);
              dependencies.registry.delete(data.conversationId);
              dependencies.sessions.markDeleted(conversation.sessionId);
              for (const [sessionId, conversationId] of dependencies.sessions.aliasEntries()) {
                if (conversationId === conversation.id) {
                  dependencies.sessions.markDeleted(sessionId);
                }
              }
              dependencies.sessions.unregisterConversationAliases(conversation.id);
              dependencies.externalActivity.clear(conversation.sessionId, conversation.id);
              dependencies.completionSuppression.clear(conversation.sessionId, conversation.id);
            }
            dependencies.forgetListed(data.conversationId);
            if (conversation || deletedDurably) {
              dependencies.broadcast({ type: 'removed', ids: [data.conversationId] });
            }
            break;
          }

          case 'set_conversation_done': {
            const conversation = dependencies.registry.get(data.conversationId);
            if (!conversation) {
              sendProtocolError(
                socket,
                `Conversation ${data.conversationId} is not open on this server`
              );
              break;
            }
            const record = await dependencies.configService.setDone(data.conversationId, data.done);
            if (!record) throw new Error(`Conversation ${data.conversationId} has no record`);
            conversation.done = record.done;
            // Pattern: patches-not-snapshots (docs/patterns.md#patches-not-snapshots)
            // One field. v2 re-sent the whole conversation with every message:
            // 1.36 MB per socket for a 1,099-message chat (2026-09-25).
            // Guard: wire-v3.test.ts "a done toggle sends one small patch".
            dependencies.broadcast({
              type: 'patch',
              id: conversation.id,
              patch: { t: 'done', done: record.done },
            });
            break;
          }

          case 'set_conversation_config': {
            const conversation = dependencies.registry.get(data.conversationId);
            if (!conversation) {
              sendCommandRejected(socket, {
                commandId: data.commandId,
                conversationId: data.conversationId,
                error: { code: 'conversation_not_found', message: 'Conversation not found' },
              });
              break;
            }
            const result = await updateRuntimeConfig(
              dependencies.configService,
              conversation,
              data
            );
            if (!result.ok) {
              // The authoritative state goes first, to the requester only, so
              // its picker shows what the server holds before the error.
              sendToClient(socket, {
                type: 'patch',
                id: conversation.id,
                patch: { t: 'config', state: conversation.configState(), commandId: null },
              });
              sendCommandRejected(socket, {
                commandId: data.commandId,
                conversationId: data.conversationId,
                error: result.error,
              });
              break;
            }
            // The patch carrying this commandId is the requester's acknowledgement.
            dependencies.broadcast({
              type: 'patch',
              id: conversation.id,
              patch: { t: 'config', state: conversation.configState(), commandId: data.commandId },
            });
            break;
          }

          // Both owner sends share one admission. A missing runtime is a
          // REJECTION, never an acceptance: the composer empties on submit
          // (client optimistic send), so acknowledging a message the server
          // never admitted discards the user's text with no error anywhere.
          // The old `registry.get(id)?.enqueue(...)` + unconditional accept
          // was exactly that silent drop.
          case 'queue_message':
          case 'interrupt_and_send': {
            const conversation = dependencies.registry.get(data.conversationId);
            if (!conversation) {
              sendCommandRejected(socket, {
                commandId: data.commandId,
                conversationId: data.conversationId,
                error: {
                  code: 'conversation_not_found',
                  message: `Conversation ${data.conversationId} is not open on this server`,
                },
              });
              break;
            }
            await createOrReuse.ensureReady(conversation);
            const ownerInput = {
              origin: 'owner_input',
              inputId: crypto.randomUUID(),
            } as const;
            if (data.type === 'queue_message')
              conversation.enqueueMessage(data.content, ownerInput);
            else conversation.interruptAndSend(data.content, ownerInput);
            sendCommandAccepted(socket, { commandId: data.commandId });
            break;
          }
          case 'cancel_queued_message':
            dependencies.registry.get(data.conversationId)?.cancelQueuedMessage(data.messageId);
            break;
          case 'promote_queued_message':
            dependencies.registry.get(data.conversationId)?.promoteQueuedMessage(data.messageId);
            break;
          case 'clear_queue':
            dependencies.registry.get(data.conversationId)?.clearQueue();
            break;
        }
      } catch (error) {
        logger.error('Error handling WebSocket message:', error);
        if (activeCommand) {
          sendCommandRejected(socket, {
            ...activeCommand,
            error: { code: 'command_failed', message: errorMessage(error) },
          });
        } else {
          sendProtocolError(socket, `Failed to handle message: ${errorMessage(error)}`);
        }
      } finally {
        releaseCommand?.();
      }
    });
  });
}

async function sendInitialState(
  socket: WebSocket,
  dependencies: ConversationWebSocketDependencies
): Promise<void> {
  const archivedBuddyIds = dependencies.getArchivedBuddyIds
    ? await dependencies.getArchivedBuddyIds()
    : [];
  if (socket.readyState !== WebSocket.OPEN) return;
  // Rows only: no message bodies, config, queue or Buddy run data. v2's `init`
  // carried all of it (1.87 MB for 1,161 conversations on 2026-09-25).
  // Guard: wire-v3.test.ts "hello stays inside its per-row budget".
  sendToClient(socket, {
    type: 'hello',
    protocol: { version: PROTOCOL_VERSION },
    defaultCwd: dependencies.getDefaultWorkingDirectory(),
    loading: !dependencies.isInitialLoadComplete(),
    archivedBuddyIds,
    ...encodeRows([
      ...Array.from(dependencies.registry.values(), (conversation) =>
        externallyRunning(conversation.toRow(), conversation, dependencies.externalActivity)
      ),
      ...dependencies.listedRows(),
    ]),
  });
}

/** A transcript another process is writing shows as running. */
function externallyRunning(
  row: ConversationRow,
  conversation: { id: string; sessionId: string },
  externalActivity: ExternalActivity
): ConversationRow {
  return row.run === 'idle' &&
    (externalActivity.has(conversation.sessionId) || externalActivity.has(conversation.id))
    ? { ...row, run: 'running' }
    : row;
}

/**
 * The kind a create command gets: a thin dispatcher over what it asked for.
 * A fork inherits its source's kind (the client holds only the source's row);
 * a fork of a conversation this server no longer holds is a plain chat.
 */
function createdKind(
  requested: CreateKind,
  buddy: ResolvedBuddyConversation | null,
  getConversation: (id: string) => { kind: ConversationKind } | undefined
): ConversationKind {
  switch (requested.t) {
    case 'chat':
      return CHAT_KIND;
    case 'buddy':
      if (!buddy) throw new Error('Buddy conversation was not resolved');
      return buddyKind(buddy.context);
    case 'fork':
      return getConversation(requested.from)?.kind ?? CHAT_KIND;
  }
}

function rejectInvalidMessage(
  socket: WebSocket,
  parsed: unknown,
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
  logger: Pick<Console, 'error'>
): void {
  const issueSummary = issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  logger.error(`[WS] Invalid client message: ${issueSummary}`);
  const commandId =
    typeof parsed === 'object' &&
    parsed !== null &&
    'commandId' in parsed &&
    typeof parsed.commandId === 'string' &&
    parsed.commandId.length > 0
      ? parsed.commandId
      : null;
  if (commandId) {
    sendCommandRejected(socket, {
      commandId,
      error: { code: 'invalid_message', message: `Invalid message: ${issueSummary}` },
    });
  } else {
    sendProtocolError(socket, `Invalid message: ${issueSummary}`);
  }
}

function logCommand(data: ClientMessage, logger: Pick<Console, 'log'>): void {
  if (data.type === 'queue_message') {
    logger.log(
      `[WS] Received queue_message conversationId=${data.conversationId}, contentLen=${data.content.length}, preview="${formatLogPreview(data.content)}"`
    );
    return;
  }
  logger.log(`[WS] Received message type: ${data.type}`, JSON.stringify(data).substring(0, 200));
}

function formatLogPreview(content: string, maximumCharacters = 140): string {
  return content.replace(/\s+/g, ' ').slice(0, maximumCharacters);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Message for a create_conversation replay that threw. Three distinct failures
 * reach that catch: createOrReplay rejects a fingerprint mismatch with
 * ConfigRevisionConflictError and a deleted id with ConversationTombstonedError;
 * anything else came from dispatchInitialMessage (it rethrows Buddy-authority
 * rejections) or the config store. Until 2026-09-06 all three were reported as
 * "already exists with different configuration" — and the dispatch case landed
 * right after conversation_created, so the client showed a config mismatch for
 * a conversation it had just been told exists. The type is the only reliable
 * discriminator; the message is what the user reads.
 */
function replayFailureMessage(error: unknown): string {
  if (error instanceof ConfigRevisionConflictError) {
    return 'Conversation ID already exists with different configuration';
  }
  if (error instanceof ConversationTombstonedError) return error.message;
  return errorMessage(error);
}
