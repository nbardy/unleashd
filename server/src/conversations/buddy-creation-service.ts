import crypto from 'node:crypto';
import type {
  BuddyContext,
  ConversationConfig,
  ConversationPurpose,
  Provider,
} from '@unleashd/shared';
import { normalizeModelId } from '@unleashd/shared';
import type { BuddyAutomation, BuddyAutomationRun } from '../buddies/contract';
import type { ResolvedBuddyConversation } from '../buddies/integration';
import type { BuddyAutomationConversation } from '../buddies/scheduler';
import { configFromProviderPreferences } from './config-mapping';
import type { ConversationConfigService } from './config-service';
import { INITIAL_MESSAGE_DISPATCH_LEASE_MS } from './config-store';
import type {
  ConversationBroadcast,
  ConversationOptions,
  ConversationRuntime,
  ConversationRuntimeView,
} from './runtime';

export interface CreationFingerprintInput {
  workingDirectory: string;
  config: ConversationConfig;
  initialMessage?: string;
  swarmDebugPrefix?: string;
  resumedFromConversationId?: string;
  buddyContext?: BuddyContext;
  purpose?: ConversationPurpose;
}

export interface CreateServerBuddyConversationInput {
  context: BuddyContext;
  initialMessage: string;
  commandId: string;
  conversationId?: string;
  /** Register/link the transcript but leave its first provider turn dormant. */
  deferInitialMessage?: boolean;
}

export interface InitialMessageDispatchOptions {
  /**
   * Run the synchronous enqueue inside the caller's authority transaction.
   * Throwing leaves the child dormant and disables automatic retry.
   */
  enqueueAuthorized?(enqueue: () => void): void;
}

export interface CreateBuddyBuilderConversationInput {
  commandId: string;
  workingDirectory: string;
  conversationId?: string;
}

export interface BuddyCreationServicePorts {
  configService: Pick<
    ConversationConfigService,
    | 'claimInitialMessageDispatch'
    | 'completeInitialMessageDispatch'
    | 'createOrReplay'
    | 'getRecord'
    | 'setCurrentSession'
  >;
  resolveBuddyConversation(context: BuddyContext): Promise<ResolvedBuddyConversation>;
  resolveWorkingDirectory(input: string): string;
  isProviderAvailable(provider: Provider): boolean;
  createId(): string;
  createConversation(options: ConversationOptions): ConversationRuntime;
  registerConversation(conversation: ConversationRuntime): void;
  createConversationLink(conversation: ConversationRuntime): Promise<void>;
  updateConversationStatus(
    conversation: ConversationRuntime,
    status: 'active' | 'complete' | 'failed' | 'cancelled'
  ): void;
  broadcast(data: ConversationBroadcast): void;
  logger?: Pick<Console, 'warn'>;
}

export interface BuddyCreationService {
  creationFingerprint(input: CreationFingerprintInput): string;
  persistCurrentSession(conversation: ConversationRuntimeView, sessionId: string): Promise<void>;
  dispatchInitialMessageIfPending(
    conversation: ConversationRuntime,
    options?: InitialMessageDispatchOptions
  ): Promise<void>;
  createAutomationConversation(
    automation: BuddyAutomation,
    run: BuddyAutomationRun
  ): Promise<BuddyAutomationConversation>;
  createServerBuddyConversation(
    input: CreateServerBuddyConversationInput
  ): Promise<ConversationRuntime>;
  createBuddyBuilderConversation(
    input: CreateBuddyBuilderConversationInput
  ): Promise<ConversationRuntime>;
}

export function creationFingerprint(input: CreationFingerprintInput): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        workingDirectory: input.workingDirectory,
        config: input.config,
        initialMessage: input.initialMessage ?? null,
        swarmDebugPrefix: input.swarmDebugPrefix ?? null,
        resumedFromConversationId: input.resumedFromConversationId ?? null,
        buddyContext: input.buddyContext ?? null,
        ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
      })
    )
    .digest('hex');
}

export function createBuddyCreationService(ports: BuddyCreationServicePorts): BuddyCreationService {
  const logger = ports.logger ?? console;
  const dispatchRetryTimers = new Map<string, NodeJS.Timeout>();
  const dispatchOptions = new Map<string, InitialMessageDispatchOptions>();

  class InitialMessageAuthorityRejectedError extends Error {}

  async function persistCurrentSession(
    conversation: ConversationRuntimeView,
    sessionId: string
  ): Promise<void> {
    try {
      await ports.configService.setCurrentSession(conversation.id, {
        provider: conversation.config.provider,
        sessionId,
      });
    } catch (error) {
      logger.warn(
        `[conversation-config] Failed to bind session ${sessionId} to ${conversation.id}:`,
        error
      );
    }
  }

  async function dispatchInitialMessageIfPending(
    conversation: ConversationRuntime,
    options?: InitialMessageDispatchOptions
  ): Promise<void> {
    if (options) dispatchOptions.set(conversation.id, options);
    const claimed = await ports.configService.claimInitialMessageDispatch(conversation.id);
    if (!claimed) {
      const current = await ports.configService.getRecord(conversation.id);
      if (
        current?.creation?.initialMessage &&
        !current.creation.initialMessageDispatchedAt &&
        current.creation.initialMessageDispatchClaimedAt
      ) {
        scheduleInitialMessageRetry(conversation, current.creation.initialMessageDispatchClaimedAt);
      }
      return;
    }
    const initialMessage = claimed?.creation?.initialMessage;
    const claimToken = claimed?.creation?.initialMessageDispatchClaimToken;
    if (!initialMessage || !claimToken) return;
    try {
      const alreadyVisible = conversation.messages.some(
        (message) => message.role === 'user' && message.content === initialMessage
      );
      if (!alreadyVisible) {
        const enqueue = () => conversation.enqueueMessage(initialMessage);
        const currentOptions = dispatchOptions.get(conversation.id);
        if (currentOptions?.enqueueAuthorized) {
          try {
            // The authority check, any durable binding, and enqueue are one
            // synchronous critical section. There is no await where cancellation
            // can interleave. Ownership design I2/I7 (2026-08-24).
            currentOptions.enqueueAuthorized(enqueue);
          } catch (error) {
            dispatchOptions.delete(conversation.id);
            throw new InitialMessageAuthorityRejectedError(
              error instanceof Error ? error.message : String(error)
            );
          }
        } else {
          enqueue();
        }
      }
      dispatchOptions.delete(conversation.id);
      const completed = await ports.configService.completeInitialMessageDispatch(
        conversation.id,
        claimToken
      );
      if (!completed) {
        logger.warn(
          `[conversation-config] Initial message delivery acknowledgement lost for ${conversation.id}`
        );
      }
      const timer = dispatchRetryTimers.get(conversation.id);
      if (timer) clearTimeout(timer);
      dispatchRetryTimers.delete(conversation.id);
    } catch (error) {
      if (error instanceof InitialMessageAuthorityRejectedError) throw error;
      logger.warn(
        `[conversation-config] Initial message enqueue failed for ${conversation.id}; retrying after lease:`,
        error
      );
      scheduleInitialMessageRetry(conversation, claimed.creation?.initialMessageDispatchClaimedAt);
    }
  }

  function scheduleInitialMessageRetry(
    conversation: ConversationRuntime,
    claimedAt: string | undefined
  ): void {
    if (dispatchRetryTimers.has(conversation.id)) return;
    const claimedAtMs = claimedAt ? Date.parse(claimedAt) : Date.now();
    const delay = Math.max(0, claimedAtMs + INITIAL_MESSAGE_DISPATCH_LEASE_MS - Date.now()) + 25;
    const timer = setTimeout(() => {
      dispatchRetryTimers.delete(conversation.id);
      void dispatchInitialMessageIfPending(conversation).catch((error) => {
        logger.warn(
          `[conversation-config] Initial message retry failed for ${conversation.id}:`,
          error
        );
      });
    }, delay);
    timer.unref?.();
    dispatchRetryTimers.set(conversation.id, timer);
  }

  function resolveConfig(resolved: ResolvedBuddyConversation): ConversationConfig {
    if (!ports.isProviderAvailable(resolved.provider)) {
      throw new Error(`Buddy provider is unavailable: ${resolved.provider}`);
    }
    return configFromProviderPreferences({
      provider: resolved.provider,
      model: normalizeModelId(resolved.provider, resolved.model),
      reasoningEffort: resolved.reasoningEffort,
    });
  }

  async function createAndRegister(input: {
    conversationId: string;
    workingDirectory: string;
    resolved: ResolvedBuddyConversation;
    config: ConversationConfig;
    commandId: string;
    initialMessage?: string;
    automationClaimToken?: string;
  }): Promise<ConversationRuntime> {
    const fingerprint = creationFingerprint({
      workingDirectory: input.workingDirectory,
      config: input.config,
      initialMessage: input.initialMessage,
      buddyContext: input.resolved.context,
    });
    const creation = await ports.configService.createOrReplay({
      conversationId: input.conversationId,
      config: input.config,
      workingDirectory: input.workingDirectory,
      creation: {
        commandId: input.commandId,
        fingerprint,
        ...(input.initialMessage === undefined ? {} : { initialMessage: input.initialMessage }),
        buddyContext: input.resolved.context,
      },
    });
    const conversation = ports.createConversation({
      id: input.conversationId,
      workingDirectory: input.workingDirectory,
      configState: creation.state,
      buddyContext: input.resolved.context,
      buddyBriefing: input.resolved.briefing,
      automationClaimToken: input.automationClaimToken,
    });
    ports.registerConversation(conversation);
    await ports.createConversationLink(conversation);
    ports.broadcast({
      type: 'conversations_updated',
      conversations: [conversation.toJSON()],
    });
    return conversation;
  }

  async function createAutomationConversation(
    automation: BuddyAutomation,
    run: BuddyAutomationRun
  ): Promise<BuddyAutomationConversation> {
    if (!automation.workspace_id) {
      throw new Error('Automation must have one workspace scope before it can run');
    }
    const resolved = await ports.resolveBuddyConversation({
      buddyId: automation.buddy_id,
      workspaceId: automation.workspace_id,
      buddyProjectId: automation.buddy_project_id,
      automationRunId: run.id,
    });
    const config = resolveConfig(resolved);
    const conversationId = ports.createId();
    const workingDirectory = ports.resolveWorkingDirectory(resolved.workingDirectory);
    const conversation = await createAndRegister({
      conversationId,
      workingDirectory,
      resolved,
      config,
      commandId: `buddy-automation-${run.id}`,
      automationClaimToken: run.claim_token ?? undefined,
    });

    return {
      conversationId,
      runTurn(prompt: string) {
        return new Promise<string>((resolve, reject) => {
          const cleanup = () => {
            conversation.off('buddy-turn-complete', onComplete);
            conversation.off('buddy-turn-failed', onFailure);
          };
          const onComplete = (output: string) => {
            cleanup();
            resolve(output);
          };
          const onFailure = (reason: string) => {
            cleanup();
            reject(new Error(reason || 'Buddy automation turn failed'));
          };
          conversation.once('buddy-turn-complete', onComplete);
          conversation.once('buddy-turn-failed', onFailure);
          conversation.sendAutomationMessage(prompt);
        });
      },
      stop: () => conversation.stopAutomationTurn(),
      async stopAndDrain() {
        conversation.stopAutomationTurn();
        await conversation.waitForTurnDrain();
      },
      finish: (status) => ports.updateConversationStatus(conversation, status),
    };
  }

  async function createServerBuddyConversation(
    input: CreateServerBuddyConversationInput
  ): Promise<ConversationRuntime> {
    const resolved = await ports.resolveBuddyConversation(input.context);
    const conversation = await createAndRegister({
      conversationId: input.conversationId ?? ports.createId(),
      workingDirectory: ports.resolveWorkingDirectory(resolved.workingDirectory),
      resolved,
      config: resolveConfig(resolved),
      commandId: input.commandId,
      initialMessage: input.initialMessage,
    });
    if (!input.deferInitialMessage) await dispatchInitialMessageIfPending(conversation);
    return conversation;
  }

  async function createBuddyBuilderConversation(
    input: CreateBuddyBuilderConversationInput
  ): Promise<ConversationRuntime> {
    if (!ports.isProviderAvailable('codex')) {
      throw new Error('Buddy Builder requires the Codex provider');
    }
    const conversationId = input.conversationId ?? ports.createId();
    const workingDirectory = ports.resolveWorkingDirectory(input.workingDirectory);
    const purpose = 'buddy_builder' as const;
    const config = configFromProviderPreferences({
      provider: 'codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
    });
    const fingerprint = creationFingerprint({
      workingDirectory,
      config,
      purpose,
    });
    const creation = await ports.configService.createOrReplay({
      conversationId,
      config,
      workingDirectory,
      creation: {
        commandId: input.commandId,
        fingerprint,
        purpose,
      },
    });
    const conversation = ports.createConversation({
      id: conversationId,
      workingDirectory,
      configState: creation.state,
      purpose,
    });
    ports.registerConversation(conversation);
    ports.broadcast({
      type: 'conversations_updated',
      conversations: [conversation.toJSON()],
    });
    return conversation;
  }

  return {
    creationFingerprint,
    persistCurrentSession,
    dispatchInitialMessageIfPending,
    createAutomationConversation,
    createServerBuddyConversation,
    createBuddyBuilderConversation,
  };
}
