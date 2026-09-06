import type {
  BuddyContext,
  ClientMessage,
  ConversationConfig,
  ConversationKind,
  ModelId,
  Provider,
  UIState,
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
  getUIState(): UIState;
  getDefaultWorkingDirectory(): string;
  resolveWorkingDirectory(input: string): string;
  resolveBuddyConversation(context: BuddyContext): Promise<ResolvedBuddyConversation>;
  createConversation(options: ConversationOptions): ConversationRuntime;
  createConversationLink(conversation: ConversationRuntime): Promise<void>;
  cancelBuddyConversation(conversation: ConversationRuntime): void;
  dispatchInitialMessage(conversation: ConversationRuntime): Promise<void>;
  creationFingerprint(input: {
    workingDirectory: string;
    config: ConversationConfig;
    initialMessage?: string;
    swarmDebugPrefix?: string;
    resumedFromConversationId?: string;
    buddyContext?: BuddyContext;
  }): string;
  broadcast(data: ConversationBroadcast): void;
  broadcastExcept(excludedClient: WebSocket, data: ConversationBroadcast): void;
  logger?: Pick<Console, 'error' | 'log'>;
}

export function registerConversationWebSocket(
  webSocketServer: WebSocketServer,
  dependencies: ConversationWebSocketDependencies
): void {
  webSocketServer.on('connection', (socket) => {
    const logger = dependencies.logger ?? console;
    sendInitialState(socket, dependencies);

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
        logCommand(data, logger);

        switch (data.type) {
          case 'create_conversation': {
            let buddyResolution: ResolvedBuddyConversation | null = null;
            try {
              buddyResolution = data.buddyContext
                ? await dependencies.resolveBuddyConversation(data.buddyContext)
                : null;
            } catch (error) {
              sendCommandRejected(socket, {
                commandId: data.commandId,
                conversationId: data.conversationId,
                error: { code: 'create_failed', message: errorMessage(error) },
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
            const fingerprint = dependencies.creationFingerprint({
              workingDirectory,
              config: data.config,
              initialMessage: data.initialMessage,
              swarmDebugPrefix: data.swarmDebugPrefix,
              resumedFromConversationId: data.resumedFromConversationId,
              buddyContext: effectiveBuddyContext,
            });
            const existingConversation = dependencies.registry.get(data.conversationId);
            if (existingConversation) {
              try {
                await dependencies.configService.createOrReplay({
                  conversationId: data.conversationId,
                  config: data.config,
                  workingDirectory,
                  creation: {
                    commandId: data.commandId,
                    fingerprint,
                    initialMessage: data.initialMessage,
                    swarmDebugPrefix: data.swarmDebugPrefix,
                    resumedFromConversationId: data.resumedFromConversationId,
                    buddyContext: effectiveBuddyContext,
                  },
                });
                sendToClient(socket, {
                  type: 'conversation_created',
                  commandId: data.commandId,
                  conversation: existingConversation.toJSON(),
                });
                await dependencies.dispatchInitialMessage(existingConversation);
              } catch (error) {
                sendCommandRejected(socket, {
                  commandId: data.commandId,
                  conversationId: data.conversationId,
                  error: { code: 'create_failed', message: replayFailureMessage(error) },
                  authoritativeConversation: existingConversation.toJSON(),
                });
              }
              break;
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

              const creation = await dependencies.configService.createOrReplay({
                conversationId: data.conversationId,
                config: data.config,
                workingDirectory,
                creation: {
                  commandId: data.commandId,
                  fingerprint,
                  initialMessage: data.initialMessage,
                  swarmDebugPrefix: data.swarmDebugPrefix,
                  resumedFromConversationId: data.resumedFromConversationId,
                  buddyContext: effectiveBuddyContext,
                },
              });
              // Matching create commands are deliberately at-least-once across
              // reconnects. Another socket may have materialized the runtime
              // while this command awaited durable config. Reuse that winner;
              // JavaScript runs the following check + set without an async gap.
              const replayWinner = dependencies.registry.get(data.conversationId);
              if (replayWinner) {
                sendToClient(socket, {
                  type: 'conversation_created',
                  commandId: data.commandId,
                  conversation: replayWinner.toJSON(),
                });
                break;
              }
              const createdKind =
                effectiveKind ??
                (buddyResolution?.context
                  ? buddyKindFromContext(buddyResolution.context)
                  : undefined) ??
                (effectiveBuddyContext
                  ? buddyKindFromContext(effectiveBuddyContext as BuddyContext)
                  : undefined);
              const conversation = dependencies.createConversation({
                id: data.conversationId,
                workingDirectory: creation.record.workingDirectory ?? workingDirectory,
                configState: creation.state,
                existingSessionId: creation.record.currentSession?.sessionId,
                swarmDebugPrefix: data.swarmDebugPrefix ?? null,
                resumedFromConversationId: data.resumedFromConversationId ?? null,
                kind: createdKind ?? null,
                buddyContext:
                  buddyResolution?.context ??
                  (effectiveBuddyContext as BuddyContext | null) ??
                  null,
                buddyBriefing: buddyResolution?.briefing ?? null,
              });
              dependencies.registry.set(conversation);
              await dependencies.createConversationLink(conversation);
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
              await dependencies.dispatchInitialMessage(conversation);
            } catch (error) {
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
              logger.log('[WS] Found conversation, calling sendMessage');
              conversation.sendMessage(data.content);
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

          case 'queue_message':
            dependencies.registry.get(data.conversationId)?.enqueueMessage(data.content);
            sendCommandAccepted(socket, {
              commandId: data.commandId,
              conversationId: data.conversationId,
            });
            break;
          case 'interrupt_and_send':
            dependencies.registry.get(data.conversationId)?.interruptAndSend(data.content);
            sendCommandAccepted(socket, {
              commandId: data.commandId,
              conversationId: data.conversationId,
            });
            break;
          case 'cancel_queued_message':
            dependencies.registry.get(data.conversationId)?.cancelQueuedMessage(data.messageId);
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

function sendInitialState(
  socket: WebSocket,
  dependencies: ConversationWebSocketDependencies
): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  sendToClient(socket, {
    type: 'init',
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
    uiState: dependencies.getUIState(),
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
