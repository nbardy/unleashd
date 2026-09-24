import crypto from 'node:crypto';
import type {
  BuddyContext,
  ClientMessage,
  ConversationKind,
  ModelId,
  Provider,
} from '@unleashd/shared';
import {
  PROTOCOL_INFO,
  buddyContextFromKind,
  buddyKindFromContext,
  conversationKindFromLegacy,
  safeParseClientMessage,
} from '@unleashd/shared';
import { WebSocket, type WebSocketServer } from 'ws';
import type {
  CompletionSuppression,
  ConversationRegistry,
  ExternalActivity,
  SessionTracking,
} from '../application/context';
import {
  type ConversationConfigService,
  ConversationTombstonedError,
} from '../conversations/config-service';
import { ConfigRevisionConflictError } from '../conversations/config-store';
import { createConversationService } from '../conversations/creation-service';
import type {
  ConversationBroadcast,
  ConversationOptions,
  ConversationRuntime,
} from '../conversations/runtime';
import { summarizeConversation } from '../conversations/serialization';
import {
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
  sessions: SessionTracking;
  externalActivity: ExternalActivity;
  completionSuppression: CompletionSuppression;
  initialLoadComplete: Promise<void>;
  isInitialLoadComplete(): boolean;
  beginCommand(command: ClientMessage): (() => void) | null;
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
  webSocketServer.on('connection', (socket) => {
    const logger = dependencies.logger ?? console;
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
        // A new UUID and durable config record cannot collide with historical
        // session hydration, so creation is safe as soon as durable services
        // and the WebSocket are available. Commands against existing history
        // still wait for that history to become authoritative.
        if (data.type !== 'create_conversation') {
          await dependencies.initialLoadComplete;
          if (socket.readyState !== WebSocket.OPEN) return;
        }
        if ('commandId' in data) {
          activeCommand = {
            commandId: data.commandId,
            ...('conversationId' in data ? { conversationId: data.conversationId } : {}),
          };
        }
        releaseCommand = dependencies.beginCommand(data);
        if (!releaseCommand) {
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
          return;
        }
        const target =
          'conversationId' in data ? dependencies.registry.get(data.conversationId) : undefined;
        if (
          target?.kind.kind === 'buddy' &&
          (await dependencies.isBuddyArchived?.(target.kind.buddyId))
        ) {
          throw new Error('Buddy is archived');
        }
        logCommand(data, logger);

        switch (data.type) {
          case 'create_conversation': {
            let buddyResolution: ResolvedBuddyConversation | null = null;
            try {
              buddyResolution = data.buddyContext
                ? await dependencies.resolveBuddyConversation(data.buddyContext)
                : null;
            } catch (error) {
              logger.error('Conversation creation failed', error);
              sendCommandRejected(socket, {
                commandId: data.commandId,
                conversationId: data.conversationId,
                error: { code: 'create_failed', message: replayFailureMessage(error) },
                authoritativeConversation: dependencies.registry.get(data.conversationId)?.toJSON(),
              });
              break;
            }

            const workingDirectory = dependencies.resolveWorkingDirectory(
              buddyResolution?.workingDirectory ?? data.workingDirectory
            );
            // Fork retention: if forking a conversation but client didn't send top-level kind/buddyContext,
            // retain the source's kind (canonical). buddyContext is derived from kind for compat.
            let effectiveKind: ConversationKind | undefined = data.kind;
            if (!effectiveKind && data.buddyContext) {
              effectiveKind = buddyKindFromContext(data.buddyContext);
            }
            let effectiveBuddyContext: BuddyContext | undefined = buddyResolution?.context;
            if (!effectiveBuddyContext && effectiveKind && effectiveKind.kind === 'buddy') {
              effectiveBuddyContext = buddyContextFromKind(
                effectiveKind as Extract<ConversationKind, { kind: 'buddy' }>
              );
            }
            if ((!effectiveBuddyContext || !effectiveKind) && data.resumedFromConversationId) {
              const sourceForBuddy = dependencies.registry.get(data.resumedFromConversationId);
              if (sourceForBuddy?.kind) {
                const srcKind = conversationKindFromLegacy({
                  kind: sourceForBuddy.kind,
                  buddyContext:
                    (sourceForBuddy as { buddyContext?: BuddyContext | null }).buddyContext ?? null,
                  purpose: (sourceForBuddy as { purpose?: string }).purpose ?? null,
                });
                if (!effectiveKind && srcKind.kind !== 'general') effectiveKind = srcKind;
                if (!effectiveBuddyContext && srcKind.kind === 'buddy') {
                  effectiveBuddyContext = buddyContextFromKind(srcKind);
                }
              }
              // Legacy fallback: direct buddyContext on source without kind
              if (
                !effectiveBuddyContext &&
                (sourceForBuddy as { buddyContext?: BuddyContext | null })?.buddyContext
              ) {
                effectiveBuddyContext =
                  (sourceForBuddy as { buddyContext?: BuddyContext | null }).buddyContext ??
                  undefined;
                if (!effectiveKind && effectiveBuddyContext)
                  effectiveKind = buddyKindFromContext(effectiveBuddyContext);
              }
            }
            if (
              effectiveBuddyContext &&
              (await dependencies.isBuddyArchived?.(effectiveBuddyContext.buddyId))
            ) {
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
                resumedFromConversationId: data.resumedFromConversationId,
                kind: effectiveKind,
                buddyContext: effectiveBuddyContext,
                buddyBriefing: buddyResolution?.briefing,
              });
              sendToClient(socket, {
                type: 'conversation_created',
                commandId: data.commandId,
                conversation: conversation.toJSON(),
              });
              dependencies.broadcastExcept(socket, {
                type: 'conversation_updated',
                reason: 'status',
                conversation: conversation.toJSON(),
              });
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

          case 'send_message': {
            logger.log(
              `[WS] send_message for ${data.conversationId}: "${data.content.substring(0, 50)}"`
            );
            const conversation = dependencies.registry.get(data.conversationId);
            if (conversation) {
              await createOrReuse.ensureReady(conversation);
              logger.log('[WS] Found conversation, calling sendMessage');
              conversation.sendMessage(data.content, {
                origin: 'owner_input',
                inputId: crypto.randomUUID(),
              });
            } else {
              logger.error(`[WS] Conversation not found: ${data.conversationId}`);
              logger.error(
                '[WS] Available conversations:',
                Array.from(dependencies.registry.keys())
              );
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
            if (conversation || deletedDurably) {
              dependencies.broadcast({
                type: 'conversation_deleted',
                conversationId: data.conversationId,
              });
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
            const record = await dependencies.configService.setDone(
              data.conversationId,
              data.done
            );
            if (!record) throw new Error(`Conversation ${data.conversationId} has no record`);
            conversation.done = record.done;
            dependencies.broadcast({
              type: 'conversation_updated',
              reason: 'done',
              conversation: conversation.toJSON(),
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
            const result = await dependencies.configService.update(
              {
                config: conversation.config,
                revision: conversation.configRevision,
                resolution: conversation.configResolution,
              },
              {
                isRunning: conversation.isRunning,
                queueDepth: conversation.queue.length,
                hasStartedSession: conversation.hasStartedSession(),
              },
              data
            );
            if (!result.ok) {
              sendCommandRejected(socket, {
                commandId: data.commandId,
                conversationId: data.conversationId,
                error: result.error,
                authoritativeConversation: conversation.toJSON(),
              });
              break;
            }
            conversation.applyConfigState(result.value.next);
            dependencies.broadcast({
              type: 'conversation_updated',
              commandId: data.commandId,
              reason: 'config',
              conversation: conversation.toJSON(),
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
            sendCommandAccepted(socket, {
              commandId: data.commandId,
              conversationId: data.conversationId,
            });
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
  sendToClient(socket, {
    type: 'init',
    archivedBuddyIds,
    summaries: true,
    loading: !dependencies.isInitialLoadComplete(),
    conversations: Array.from(dependencies.registry.values(), (conversation) => {
      const value = conversation.toJSON();
      if (
        dependencies.externalActivity.has(conversation.sessionId) ||
        dependencies.externalActivity.has(conversation.id)
      ) {
        value.isRunning = true;
      }
      return summarizeConversation(value);
    }),
    defaultCwd: dependencies.getDefaultWorkingDirectory(),
    protocol: PROTOCOL_INFO,
  });
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
