import type {
  BuddyContext,
  ConversationBranch,
  ConversationConfig,
  ConversationPlacement,
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

import { createConversationService, creationFingerprint } from './creation-service';
export { creationFingerprint } from './creation-service';
export type { CreationFingerprintInput } from './creation-service';
import type { CreationFingerprintInput } from './creation-service';

export interface CreateServerBuddyConversationInput {
  config?: ConversationConfig;
  context: BuddyContext;
  initialMessage?: string;
  commandId: string;
  conversationId?: string;
  /** Register/link the transcript but leave its first provider turn dormant. */
  deferInitialMessage?: boolean;
  placement?: ConversationPlacement;
  branch?: ConversationBranch;
  ownerInput?: Readonly<{ origin: 'owner_input'; inputId: string }>;
}

export interface InitialMessageDispatchOptions {
  ownerInput?: Readonly<{ origin: 'owner_input'; inputId: string }>;
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
  getConversation(id: string): ConversationRuntime | undefined;
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
  ensureConversationReady(conversation: ConversationRuntime): Promise<ConversationRuntime>;
  creationFingerprint(input: CreationFingerprintInput): string;
  persistCurrentSession(
    conversation: ConversationRuntimeView,
    sessionId: string,
    buddyAudienceKey?: string
  ): Promise<void>;
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

export function createBuddyCreationService(ports: BuddyCreationServicePorts): BuddyCreationService {
  const logger = ports.logger ?? console;
  const createOrReuse = createConversationService(ports);
  const dispatchRetryTimers = new Map<string, NodeJS.Timeout>();
  const dispatchOptions = new Map<string, InitialMessageDispatchOptions>();

  class InitialMessageAuthorityRejectedError extends Error {}

  async function persistCurrentSession(
    conversation: ConversationRuntimeView,
    sessionId: string,
    buddyAudienceKey?: string
  ): Promise<void> {
    try {
      await ports.configService.setCurrentSession(conversation.id, {
        provider: conversation.config.provider,
        sessionId,
        ...(buddyAudienceKey ? { buddyAudienceKey } : {}),
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
        const currentOptions = dispatchOptions.get(conversation.id);
        const enqueue = () =>
          conversation.enqueueMessage(initialMessage, currentOptions?.ownerInput);
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
    placement?: ConversationPlacement;
    branch?: ConversationBranch;
  }): Promise<ConversationRuntime> {
    const conversation = await createOrReuse({
      conversationId: input.conversationId,
      workingDirectory: input.workingDirectory,
      config: input.config,
      commandId: input.commandId,
      initialMessage: input.initialMessage,
      branch: input.branch,
      buddyContext: input.resolved.context,
      placement:
        input.placement ??
        (input.resolved.context.coordinationRunId ||
        input.resolved.context.automationRunId ||
        input.resolved.context.delegatedByBuddyId
          ? 'background'
          : 'default'),
      buddyBriefing: input.resolved.briefing,
      automationClaimToken: input.automationClaimToken,
    });
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
      allowedBuddyOperations: [...run.policy.allowed_operations],
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
      config: input.config ?? resolveConfig(resolved),
      commandId: input.commandId,
      initialMessage: input.initialMessage,
      branch: input.branch,
      placement: input.placement,
    });
    if (!input.deferInitialMessage)
      await dispatchInitialMessageIfPending(
        conversation,
        input.ownerInput ? { ownerInput: input.ownerInput } : undefined
      );
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
      model: 'gpt-6-astra',
      reasoningEffort: 'low',
    });
    const conversation = await createOrReuse({
      conversationId,
      workingDirectory,
      config,
      purpose,
      commandId: input.commandId,
    });
    ports.broadcast({
      type: 'conversations_updated',
      conversations: [conversation.toJSON()],
    });
    return conversation;
  }

  return {
    ensureConversationReady: createOrReuse.ensureReady,
    creationFingerprint,
    persistCurrentSession,
    dispatchInitialMessageIfPending,
    createAutomationConversation,
    createServerBuddyConversation,
    createBuddyBuilderConversation,
  };
}
