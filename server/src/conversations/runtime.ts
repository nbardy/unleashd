import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { executeCommand } from '@nbardy/agent-cli';
import type {
  BuddyContext,
  ConfigResolution,
  ConversationConfig,
  ConversationConfigState,
  Conversation as ConversationData,
  ConversationKind,
  ConversationPlacement,
  ConversationPurpose,
  Message,
  ModelId,
  OompaRuntimeSnapshot,
  Provider as ProviderName,
  ProviderTurnUsage,
  QueuedMessage,
  ResolvedExecutionConfig,
  ServerMessage,
  SubAgent,
} from '@unleashd/shared';
import {
  buddyContextFromKind,
  buddyKindFromContext,
  conversationKindFromLegacy,
  isBuddyKind,
  matchConversationKind,
  providerSupportsFork,
} from '@unleashd/shared';
import {
  BuddyBuilderTurnPolicy,
  type BuddyPolicyHost,
  BuddyTurnPolicy,
  type BuddyTurnPolicyDependencies,
  type MemoryGenerationInput,
  createMemorySnapshot,
} from '../buddies/turn-policy';
import { SWARM_POLL_INTERVAL_MS, SWARM_POLL_THROTTLE_MS } from '../constants/timeouts';
import type { RuntimeTurnAttemptObserver } from '../observability';
import { resolveConfigAgainstProviderCatalog } from '../providers/catalog-service';
import { SwarmObservers } from '../swarm/observer';
import {
  type OwnerInput,
  type SeatTurnInput,
  type SessionRelativePrompt,
  type TurnInput,
  sameEitherWay,
} from '../turns/input';
import {
  ChatTurnPolicy,
  type CoordinationDrained,
  type MemorySnapshot,
  type TurnPolicy,
} from '../turns/policy';
import { type QueueEntry, TurnQueue } from '../turns/queue';
import { type TurnBroadcast, TurnRunner } from '../turns/runner';

/**
 * The conversation: its record, its queue, its turn policy and the runner for
 * its current turn. Turn mechanics live in turns/ (queue, runner, watchdog,
 * sub-agent folds), kind-specific behavior in the policy chosen once by kind
 * (turns/policy.ts, buddies/turn-policy.ts), swarm observation in
 * swarm/observer.ts.
 */

export type { SeatTurnInput, SessionRelativePrompt } from '../turns/input';

export type ConversationBroadcast = ServerMessage | TurnBroadcast;

export interface ConversationRuntimeView {
  id: string;
  sessionId: string;
  config: ConversationConfig;
  readonly provider: ProviderName;
  buddyContext: BuddyContext | null;
  readonly memoryGeneration: string | null;
  kind: ConversationKind;
  getMemorySnapshot(): MemorySnapshot | null;
  isRunning: boolean;
  toJSON(): ConversationData;
}

/** Input with no recorded producer: no owner authority, workspace audience. */
function unknownInput(): TurnInput {
  return { origin: 'unknown', inputId: crypto.randomUUID() };
}

/**
 * The host server's ports. The turn core uses these; the Buddy policies
 * (buddies/turn-policy.ts) use `BuddyTurnPolicyDependencies`.
 */
export interface ConversationRuntimeDependencies extends BuddyTurnPolicyDependencies {
  broadcast(data: ConversationBroadcast): void;
  registerSessionAlias(sessionId: string | null | undefined, conversationId: string): void;
  unregisterSessionAlias(
    sessionId: string | null | undefined,
    options?: { keepKnown?: boolean }
  ): void;
  clearExternalRunningStatus(...ids: Array<string | null | undefined>): void;
  clearLocalCompletionSuppression(...ids: Array<string | null | undefined>): void;
  markLocalCompletionSuppression(...ids: Array<string | null | undefined>): void;
  persistCurrentSession(
    conversation: ConversationRuntimeView,
    sessionId: string,
    buddyAudienceKey?: string
  ): Promise<void>;
  getConversation(id: string):
    | {
        isRunning: boolean;
        provider: ProviderName;
        sessionId: string;
        hasStartedSession(): boolean;
        getMemorySnapshot?: () => MemorySnapshot | null;
      }
    | undefined;
  readLatestOompaRuntime(projectRoot: string): Promise<OompaRuntimeSnapshot>;
  createSessionId(): string;
  /**
   * Durably record provider-counted usage against a session. Optional because
   * the meter is observability: a host that omits it still runs turns, and the
   * session-file parser remains the fallback source.
   */
  persistSessionUsage?(
    conversationId: string,
    sessionId: string,
    usage: ProviderTurnUsage
  ): Promise<void>;
  /** Test seam for the real provider boundary; production uses agent-cli directly. */
  executeTurn?: typeof executeCommand;
  turnAttempts?: RuntimeTurnAttemptObserver;
}

const LOG_CONTENT_PREVIEW_CHARS = 140;

function formatLogPreview(content: string, maxChars = LOG_CONTENT_PREVIEW_CHARS): string {
  return content.replace(/\s+/g, ' ').slice(0, maxChars);
}

export interface ConversationOptions {
  id: string;
  workingDirectory?: string | null;
  configState: ConversationConfigState;
  /** From the durable record. Required so a load path cannot forget it and
   *  resurrect a hidden conversation; new conversations pass false. */
  done: boolean;
  existingSessionId?: string;
  /** Host-owned metadata from the matching durable provider-session binding. */
  existingSessionAudienceKey?: string;
  isWorker?: boolean;
  swarmId?: string | null;
  workerId?: string | null;
  workerRole?: 'work' | 'review' | 'fix' | null;
  parentConversationId?: string | null;
  resumedFromConversationId?: string | null;
  modelName?: string | null;
  /** Provider-generated label (Claude ai-title/custom-title) restored on hydration. */
  title?: string | null;
  swarmDebugPrefix?: string | null;
  buddyContext?: BuddyContext | null;
  buddyBriefing?: string | null;
  /** Native generation when the Buddy resolver provides one; otherwise derived from the briefing. */
  buddyMemoryGeneration?: MemoryGenerationInput | null;
  /** Server-private automation ownership. Never serialized or placed in BuddyContext. */
  automationClaimToken?: string | null;
  placement?: ConversationPlacement;
  purpose?: ConversationPurpose;
  kind?: ConversationKind | null;
  /** Usage restored from the persisted session binding on reload. */
  existingProviderUsage?: ProviderTurnUsage | null;
}

export interface ConversationRuntime extends EventEmitter, ConversationRuntimeView {
  placement: ConversationPlacement;
  messages: Message[];
  process: ChildProcess | null;
  isStreaming: boolean;
  createdAt: Date;
  workingDirectory: string;
  configRevision: number;
  configResolution: ConfigResolution;
  done: boolean;
  isWorker: boolean;
  swarmId: string | null;
  workerId: string | null;
  workerRole: 'work' | 'review' | 'fix' | null;
  parentConversationId: string | null;
  resumedFromConversationId: string | null;
  modelName: string | null;
  /** Provider-generated conversation label. Undefined until observed. */
  title: string | undefined;
  swarmDebugPrefix: string | null;
  providerUsage: ProviderTurnUsage | null;
  purpose: ConversationPurpose;
  subAgents: SubAgent[];
  readonly queue: QueuedMessage[];
  readonly provider: ProviderName;
  readonly memoryGeneration: string | null;
  readonly model: ModelId | undefined;
  readonly reasoningEffort: string | undefined;
  sendMessage(content: string, ownerInput?: OwnerInput): void;
  /** Seat input whose wording depends on whether the provider session resumes. */
  sendSessionRelativeMessage(prompt: SessionRelativePrompt, input: SeatTurnInput): void;
  sendAutomationMessage(content: string): void;
  runCoordinationMessage(
    content: string,
    context: BuddyContext,
    claimToken: string,
    onDrained?: CoordinationDrained,
    onAdmitted?: (config: ResolvedExecutionConfig) => void
  ): Promise<string>;
  stop(reason?: 'user_stop' | 'server_restart'): void;
  expireCoordinationRun(): void;
  stopAutomationTurn(): void;
  resetProcess(): void;
  enqueueMessage(content: string, ownerInput?: OwnerInput): void;
  interruptAndSend(content: string, ownerInput?: OwnerInput): void;
  cancelQueuedMessage(messageId: string): void;
  promoteQueuedMessage(messageId: string): void;
  clearQueue(): void;
  processQueue(): void;
  hasActiveProcess(): boolean;
  /** A Buddy chat turn is lined up behind its Buddy's run limit, not yet started. */
  waitingForRunSlot(): boolean;
  waitForTurnDrain(): Promise<void>;
  hasStartedSession(): boolean;
  applyConfigState(state: ConversationConfigState): void;
  refreshConfigResolution(): ConfigResolution;
  canChangeProvider(): boolean;
  getMemorySnapshot(): MemorySnapshot | null;
  toJSON(): ConversationData;
}

export type ConversationConstructor = new (options: ConversationOptions) => ConversationRuntime;

const NOOP_TURN_ATTEMPT_OBSERVER: RuntimeTurnAttemptObserver = {
  queued: () => undefined,
  starting: () => undefined,
  running: () => undefined,
  bindProviderSession: () => undefined,
  activity: () => undefined,
  stopping: () => undefined,
  terminal: () => undefined,
};

export function createConversationRuntime(
  dependencies: ConversationRuntimeDependencies
): ConversationConstructor {
  const {
    broadcast,
    registerSessionAlias,
    unregisterSessionAlias,
    persistCurrentSession,
    getConversation,
    createSessionId,
  } = dependencies;
  const runnerPorts = {
    broadcast,
    registerSessionAlias,
    unregisterSessionAlias,
    clearExternalRunningStatus: dependencies.clearExternalRunningStatus,
    clearLocalCompletionSuppression: dependencies.clearLocalCompletionSuppression,
    markLocalCompletionSuppression: dependencies.markLocalCompletionSuppression,
    persistSessionUsage: dependencies.persistSessionUsage,
    createSessionId,
    executeTurn: dependencies.executeTurn ?? executeCommand,
    turnAttempts: dependencies.turnAttempts ?? NOOP_TURN_ATTEMPT_OBSERVER,
    // One async swarm poller per working directory, shared by all turns there.
    swarmObservers: new SwarmObservers(dependencies.readLatestOompaRuntime, {
      intervalMs: SWARM_POLL_INTERVAL_MS,
      throttleMs: SWARM_POLL_THROTTLE_MS,
    }),
  };

  return class Conversation extends EventEmitter {
    id: string; // UI conversation ID (persists across resets)
    sessionId: string; // Provider CLI session ID (can be reset for fresh context)
    messages: Message[];
    process: ChildProcess | null;
    isRunning: boolean;
    // Server-authoritative: assistant is actively producing content.
    // INVARIANT: !isRunning → !isStreaming (enforced by the runner's completion paths).
    isStreaming: boolean;
    createdAt: Date;
    workingDirectory: string;
    config: ConversationConfig;
    configRevision: number;
    configResolution: ConfigResolution;
    // Mirror of record.done. Written only by the set_conversation_done
    // handler, after the record write succeeds.
    done: boolean;
    // Oompa worker detection — true if first user message started with "[oompa]".
    // Set during JSONL loading, preserved across restarts.
    isWorker: boolean;
    // Swarm grouping: shared across all workers in the same oompa run.
    swarmId: string | null;
    // Worker identity within a swarm (e.g., "w0", "claude-0").
    workerId: string | null;
    // Worker role within the swarm: "work" (task execution), "review" (code review), "fix" (fixing review feedback).
    workerRole: 'work' | 'review' | 'fix' | null;
    // Parent conversation id for provider-native spawned sub-agent threads.
    // For Codex this is resolved from thread_spawn.parent_thread_id.
    parentConversationId: string | null;
    // Chat "Fork" soft-handoff lineage (UI). Not a provider-session fork.
    // See the shared FORK_CAPABLE_PROVIDERS comment for when it upgrades to a session fork.
    resumedFromConversationId: string | null;
    // Full model name from CLI (e.g., "claude-sonnet-4-5-20250929") — more specific than provider.
    modelName: string | null;
    // Provider-generated conversation label (Claude ai-title/custom-title).
    // Undefined until observed; the sidebar falls back to first-message text.
    title: string | undefined;
    private _titleSource: 'ai' | 'custom' | null = null;
    // Debug prefix for swarm conversations — prepended to first CLI message.
    // Stays on the object (never cleared) so toJSON() includes it for client rendering.
    swarmDebugPrefix: string | null;
    placement: ConversationPlacement;
    // Provider-counted usage for the latest request on the CURRENT session.
    // Written from `usage` events during the turn and flushed to the session
    // binding when the turn ends, so a reload does not have to re-parse the
    // transcript. Cleared on session reset: a new session is a new context.
    providerUsage: ProviderTurnUsage | null;
    subAgents: SubAgent[];
    // Server-owned message queue — persists across client navigation/refresh.
    // Client mirrors this state via queue_updated broadcasts.
    readonly turnQueue = new TurnQueue();
    get queue(): QueuedMessage[] {
      return this.turnQueue.items;
    }
    // Track if we've started a CLI session (for --resume vs --session-id)
    private _hasStartedSession: boolean;
    // Server-private automation ownership. Never serialized or placed in BuddyContext.
    private _automationClaimToken: string | null = null;
    private _sendingFromQueue = false;
    private readonly runner: TurnRunner;

    // Canonical kind. Setting it re-selects the turn policy: the ONE place a
    // conversation's kind decides turn behavior (`policyFor`). Polling may
    // promote a general conversation to a specific kind (session-loader).
    private _kind: ConversationKind = { kind: 'general' };
    private _policy: TurnPolicy;
    get kind(): ConversationKind {
      return this._kind;
    }
    set kind(value: ConversationKind) {
      this._kind = value;
      this._policy = this.policyFor(value, {
        memorySnapshot: null,
        audienceKey: null,
        automationClaimToken: this._automationClaimToken,
      });
    }
    // Legacy compat: buddyContext/purpose are derived from kind. New code must use `kind` + `matchConversationKind`.
    // Kept as getters so old readers (buddies integration, client) keep working.
    get buddyContext(): BuddyContext | null {
      return isBuddyKind(this.kind) ? buddyContextFromKind(this.kind) : null;
    }
    set buddyContext(value: BuddyContext | null) {
      if (value) {
        this.kind = buddyKindFromContext(value, this._policy.memorySnapshot()?.briefing);
      } else if (isBuddyKind(this.kind)) {
        this.kind = { kind: 'general' };
      }
    }
    get purpose(): ConversationPurpose {
      return this.kind.kind === 'buddy_builder' ? 'buddy_builder' : 'general';
    }
    set purpose(value: ConversationPurpose) {
      if (value === 'buddy_builder' && this.kind.kind !== 'buddy_builder') {
        this.kind = { kind: 'buddy_builder' };
      } else if (value !== 'buddy_builder' && this.kind.kind === 'buddy_builder') {
        this.kind = { kind: 'general' };
      }
    }

    constructor(opts: ConversationOptions) {
      super();
      const {
        id,
        workingDirectory = null,
        configState,
        existingSessionId,
        isWorker = false,
        swarmId = null,
        workerId = null,
        workerRole = null,
        parentConversationId = null,
        resumedFromConversationId = null,
        modelName = null,
        title = null,
        swarmDebugPrefix = null,
        buddyContext = null,
        buddyBriefing = null,
        buddyMemoryGeneration = null,
        automationClaimToken = null,
        purpose = 'general',
        kind = null,
      } = opts;
      this.id = id;
      // sessionId defaults to id so JSONL filename matches Map key (no poller mismatch).
      // Only differs from id after resetProcess() rotates it for fresh CLI context.
      this.sessionId = existingSessionId ?? id;
      registerSessionAlias(this.sessionId, this.id);
      this.messages = [];
      this.process = null;
      this.isRunning = false;
      this.isStreaming = false;
      this.createdAt = new Date();
      // Resolve to absolute path: sessions are identified by absolute path in oompa
      this.workingDirectory = path.resolve(workingDirectory || process.cwd());
      this.config = configState.config;
      this.configRevision = configState.revision;
      this.configResolution = configState.resolution;
      this.done = opts.done;
      this._automationClaimToken = automationClaimToken;
      // Canonical kind — derive from legacy when absent (migration on load).
      this._kind =
        kind ??
        conversationKindFromLegacy({
          buddyContext: buddyContext ?? null,
          purpose: purpose ?? null,
          kind: null,
        });
      this.placement =
        opts.placement ??
        (this.buddyContext?.automationRunId ||
        buddyContext?.coordinationRunId ||
        this.buddyContext?.delegatedByBuddyId
          ? 'background'
          : 'default');
      const isBuddyConversation = isBuddyKind(this.kind);
      this.isWorker = isBuddyConversation ? false : isWorker;
      this.swarmId = isBuddyConversation ? null : swarmId;
      this.workerId = isBuddyConversation ? null : workerId;
      this.workerRole = isBuddyConversation ? null : workerRole;
      this.parentConversationId = parentConversationId;
      this.resumedFromConversationId = resumedFromConversationId;
      this.modelName = modelName;
      this.title = title ?? undefined;
      // A hydrated title already resolved custom-over-ai precedence in the
      // file backfill, so it is sticky: live ai noise must not overwrite it.
      this._titleSource = this.title !== undefined ? 'custom' : null;
      this.swarmDebugPrefix = isBuddyConversation ? null : swarmDebugPrefix;
      this._policy = this.policyFor(this._kind, {
        memorySnapshot: createMemorySnapshot(buddyBriefing, buddyMemoryGeneration),
        audienceKey: existingSessionId ? (opts.existingSessionAudienceKey ?? null) : null,
        automationClaimToken,
      });
      this.providerUsage = opts.existingProviderUsage ?? null;
      this.subAgents = [];
      // Mark session as started if loading existing (use --resume for next message)
      this._hasStartedSession = existingSessionId !== undefined;
      this.runner = new TurnRunner(this, runnerPorts);
    }

    get memoryGeneration(): string | null {
      return this._policy.memorySnapshot()?.generation ?? null;
    }

    getMemorySnapshot(): MemorySnapshot | null {
      return this._policy.memorySnapshot();
    }

    // Pattern: sum-types (docs/patterns.md#sum-types)
    /**
     * The turn policy for a kind — a thin dispatcher, one policy per kind. A
     * general chat gets the no-op ChatTurnPolicy; Buddy code lives only in
     * buddies/turn-policy.ts.
     */
    private policyFor(
      kind: ConversationKind,
      seed: {
        memorySnapshot: MemorySnapshot | null;
        audienceKey: string | null;
        automationClaimToken: string | null;
      }
    ): TurnPolicy {
      return matchConversationKind<TurnPolicy>(kind, {
        general: () => new ChatTurnPolicy(() => this.swarmDebugPrefix),
        buddy: (buddyKind) => new BuddyTurnPolicy(buddyKind, this.policyHost(), dependencies, seed),
        buddy_builder: () => new BuddyBuilderTurnPolicy(this.policyHost(), dependencies),
      });
    }

    private policyHost(): BuddyPolicyHost {
      return {
        id: this.id,
        view: this,
        placement: () => this.placement,
        provider: () => this.provider,
        hasProcess: () => this.process !== null,
        hasStartedSession: () => this._hasStartedSession,
        resetProcess: () => this.resetProcess(),
        releaseQueueHead: (announce) => {
          if (this.turnQueue.releaseHead() && announce) this.broadcastQueue();
        },
        dropPendingHead: () => {
          const dropped = this.turnQueue.dropPendingHead();
          if (!dropped) return;
          this.runner.cancelQueuedAttempt(dropped);
          this.broadcastQueue();
        },
        processQueue: () => this.processQueue(),
        maxRuntimeReached: () => this.runner.timeout('max'),
        refuseAutomationTranscript: (message) => this.refuseAutomationTranscript(message),
        send: (prompt, input) => this.sendMessageInternal(prompt, input),
        on: (event, listener) => this.on(event, listener),
        once: (event, listener) => this.once(event, listener),
        off: (event, listener) => this.off(event, listener),
        emit: (event, ...args) => this.emit(event, ...args),
      };
    }

    // --- TurnRunnerHost: the conversation as its runner sees it ---------------

    get policy(): TurnPolicy {
      return this._policy;
    }

    markSessionStarted(): void {
      this._hasStartedSession = true;
    }

    persistSession(sessionId: string, audienceKey: string | undefined): Promise<void> {
      return persistCurrentSession(this, sessionId, audienceKey);
    }

    // Provider-generated label (Claude ai-title/custom-title). Custom (user-set)
    // always wins; auto titles never overwrite a custom one. Hydrated titles
    // count as custom-sticky: the file backfill already resolved precedence, so
    // live ai noise must not clobber it — only a live custom event can.
    observeTitle(title: string, source: 'ai' | 'custom'): void {
      const next = title.trim();
      if (!next) return;
      if (source !== 'custom' && this._titleSource === 'custom') return;
      if (this.title === next) return;
      this.title = next;
      this._titleSource = source;
      broadcast({ type: 'conversations_updated', conversations: [this.toJSON()] });
    }

    runCoordinationMessage(
      content: string,
      context: BuddyContext,
      claimToken: string,
      onDrained?: CoordinationDrained,
      onAdmitted?: (config: ResolvedExecutionConfig) => void
    ): Promise<string> {
      if (this.placement !== 'background') {
        return Promise.reject(
          new Error('Automated Buddy inputs require a background conversation')
        );
      }
      if (this.process || this.isRunning || this.turnQueue.length) {
        return Promise.reject(new Error('Conversation is busy'));
      }
      return this._policy.runCoordination(content, context, claimToken, onDrained, onAdmitted);
    }

    sendMessage(content: string, ownerInput?: OwnerInput): void {
      if (!this._policy.acceptsUserInput) {
        this.refuseAutomationTranscript();
        return;
      }
      this.sendMessageInternal(sameEitherWay(content), ownerInput ?? unknownInput());
    }

    // The caller cannot pick the wording itself: whether this turn resumes is
    // decided at admission (sendAdmittedMessage), which for a Buddy turn can
    // follow a wait for a run slot, and where a changed Buddy audience rotates
    // the provider session. Asking first and sending one prompt after leaves a
    // window for that decision to flip, so the caller hands over both wordings.
    sendSessionRelativeMessage(prompt: SessionRelativePrompt, input: SeatTurnInput): void {
      if (!this._policy.acceptsUserInput) {
        this.refuseAutomationTranscript();
        return;
      }
      this.sendMessageInternal(prompt, input);
    }

    /** Coordinator-only admission for an owned automation occurrence (see BuddyTurnPolicy). */
    sendAutomationMessage(content: string): void {
      this._policy.sendAutomation(content);
    }

    private refuseAutomationTranscript(message?: string): void {
      this.addSystemMessage(
        message ??
          'This automation transcript is read-only. Start an ordinary Buddy conversation to continue working.'
      );
      broadcast({ type: 'conversations_updated', conversations: [this.toJSON()] });
    }

    private addSystemMessage(content: string): void {
      this.messages.push({ role: 'system', content, timestamp: new Date() });
      broadcast({ type: 'message', role: 'system', content, conversationId: this.id });
    }

    // The one resume/fresh decision: the runner passes --resume on it and
    // sendAdmittedMessage words a SessionRelativePrompt by it, so they agree.
    private resumesProviderSession(forkSourceSessionId: string | undefined): boolean {
      return !forkSourceSessionId && this._hasStartedSession;
    }

    private sendMessageInternal(prompt: SessionRelativePrompt, input: TurnInput): void {
      console.log(
        `[${this.id}] sendMessage called, isRunning=${this.isRunning}, hasProcess=${this.process !== null}, queueDepth=${this.turnQueue.length}, contentLen=${prompt.fresh.length}, preview="${formatLogPreview(prompt.fresh)}"`
      );

      if (this.process || this.isRunning) {
        console.warn(`[${this.id}] Already processing a message, ignoring`);
        return;
      }
      switch (this._policy.gate(input, this._sendingFromQueue)) {
        case 'send':
          this.sendAdmittedMessage(prompt, input);
          return;
        case 'enqueue':
          this.enqueuePrompt(prompt, input);
          return;
        case 'wait':
          return;
        case 'admitted':
          try {
            this.sendAdmittedMessage(prompt, input);
          } finally {
            this._policy.releaseUnspawned();
          }
          return;
      }
    }

    private sendAdmittedMessage(prompt: SessionRelativePrompt, input: TurnInput): void {
      const refreshBriefing = this._policy.prepare(input);
      const fork = this.chatForkSource();
      if (fork.t === 'rejected') {
        this.rejectFork(fork.message);
        return;
      }
      const forkSourceSessionId = fork.t === 'session' ? fork.sessionId : undefined;
      // Worded here, at admission (a queued Buddy turn may have waited for a
      // run slot), after the audience check above may have rotated the
      // provider session, and by the same decision the runner resumes on:
      // a fresh session always gets `fresh`.
      const resume = this.resumesProviderSession(forkSourceSessionId);
      const content = resume ? prompt.resumed : prompt.fresh;

      this.runner.beginAttempt();
      const executionConfig = this.preflightExecution();
      if (!executionConfig) return;

      // UI/history retain clean user text; the provider gets the policy's
      // prompt. When provider-session inheritance ran, skip first-turn briefing
      // / pasted-context prefixes — the CLI already has the source transcript.
      const cliContent =
        forkSourceSessionId && !refreshBriefing
          ? content
          : this._policy.providerPrompt({
              content,
              messageCount: this.messages.length,
              hasStartedSession: this._hasStartedSession,
              refreshBriefing,
            });

      this.messages.push({ role: 'user', content, timestamp: new Date() });
      broadcast({ type: 'message', role: 'user', content, conversationId: this.id });
      this._policy.admitted(input, content);
      // Owner workflow guidance lives in the native MCP tool descriptions.
      // Spawn with input provenance supplied by the host producer, never transcript text.
      this.runner.start({
        content: cliContent,
        config: executionConfig,
        forkSourceSessionId,
        resume,
        input,
      });
    }

    /**
     * Chat "Fork" (soft handoff): resumedFromConversationId is UI lineage.
     * Context lives in the draft / first user message, so changing provider
     * before send must still work. The first send opportunistically upgrades
     * to provider-session inheritance when the source has the same provider,
     * that harness can fork, and the memory generations match. Anything else
     * stays a soft handoff and must never reject the send.
     *
     * Bug (2026-08-20): muse -> muse Chat Fork died with `Harness "muse" does
     * not support fork.` because only the same-provider branch reached
     * prepareSession. Capability, not provider equality, decides the path.
     * Guard: `same-provider fork on a fork-incapable harness falls back to
     * string handoff`.
     */
    private chatForkSource():
      | { t: 'none' }
      | { t: 'session'; sessionId: string }
      | { t: 'rejected'; message: string } {
      if (this._hasStartedSession || this.messages.length > 0 || !this.resumedFromConversationId)
        return { t: 'none' };
      const source = getConversation(this.resumedFromConversationId);
      if (!source) {
        return {
          t: 'rejected',
          message: `Cannot fork: source conversation ${this.resumedFromConversationId} is not loaded`,
        };
      }
      const sourceMemorySnapshot = source.getMemorySnapshot?.() ?? null;
      const memorySnapshot = this._policy.memorySnapshot();
      const memoryGenerationMatches =
        sourceMemorySnapshot === null && memorySnapshot === null
          ? true
          : sourceMemorySnapshot !== null &&
            memorySnapshot !== null &&
            sourceMemorySnapshot.generation === memorySnapshot.generation;
      if (
        source.provider !== this.provider ||
        !providerSupportsFork(this.provider) ||
        !memoryGenerationMatches
      ) {
        const memoryDetail = memoryGenerationMatches
          ? ''
          : ', memory generation changed so native session inheritance is disabled';
        console.log(
          `[${this.id}] Soft fork ${source.provider} -> ${this.provider} (${source.provider === this.provider ? 'harness cannot fork sessions' : 'cross-provider'}${memoryDetail}), using string context handoff (no provider session fork)`
        );
        return { t: 'none' };
      }
      if (!source.hasStartedSession()) {
        return {
          t: 'rejected',
          message: 'Cannot fork: the source conversation has no provider session yet',
        };
      }
      return { t: 'session', sessionId: source.sessionId };
    }

    private rejectFork(message: string): void {
      console.error(`[${this.id}] ${message}`);
      this.addSystemMessage(message);
      broadcast({ type: 'conversations_updated', conversations: [this.toJSON()] });
    }

    private preflightExecution(): ResolvedExecutionConfig | undefined {
      // Resolve immediately before any message or queue mutation.
      // Catalog changes may affect defaults without changing durable intent.
      const resolution = this.refreshConfigResolution();
      if (resolution.status !== 'resolved') {
        this.refusePreflight(`Configuration unavailable: ${resolution.error.message}`);
        return undefined;
      }
      try {
        // A configuration admission rule, not a provider process failure.
        // Checking it here keeps a queued message retryable and prevents a
        // synchronous throw at spawn from leaving the queue head "sending".
        this._policy.preflight(resolution.value.provider);
      } catch (error) {
        this.refusePreflight(error instanceof Error ? error.message : String(error));
        return undefined;
      }
      return resolution.value;
    }

    // Preflight has no child process and therefore no later completion event.
    // Terminalise and notify here, at the single point that owns the error, so
    // an automation's runTurn promise cannot wait until its outer timeout. See
    // agent_notes/2026-08-24_automation-execution-ownership-design.md.
    private refusePreflight(errorMessage: string): void {
      console.error(`[${this.id}] ${errorMessage}`);
      this.messages.push({
        role: 'system',
        content: errorMessage,
        timestamp: new Date(),
        completionReason: 'error',
      });
      if (this.turnQueue.releaseHead()) this.broadcastQueue();
      broadcast({ type: 'conversation_updated', reason: 'config', conversation: this.toJSON() });
      this.runner.finishAttempt('failed', 'spawn_failed');
      this.emit('buddy-turn-failed', errorMessage);
    }

    stop(reason: 'user_stop' | 'server_restart' = 'user_stop'): void {
      if (this._policy.stop(reason)) this.stopOwnedTurn(reason);
    }

    /** Coordinator-only process stop (see BuddyTurnPolicy.stopAutomation). */
    stopAutomationTurn(): void {
      this._policy.stopAutomation();
      this.stopOwnedTurn('user_stop');
    }

    private stopOwnedTurn(reason: 'user_stop' | 'server_restart'): void {
      if (this._policy.dropWaitingTurn()) {
        this.emit('buddy-turn-failed', 'Stopped while waiting for a run slot');
      }
      this.runner.stop(reason);
    }

    // Reset process for fresh context (used in loop with clearContext).
    // Generates new CLI session ID while keeping conversation ID for UI continuity.
    resetProcess(): void {
      this.runner.reset();
      const oldSessionId = this.sessionId;
      this.sessionId = createSessionId();
      this._policy.sessionReset();
      // A reset starts an empty provider context. Carrying the old session's
      // token count forward would show a full meter on a fresh thread.
      this.providerUsage = null;
      unregisterSessionAlias(oldSessionId, { keepKnown: true });
      registerSessionAlias(this.sessionId, this.id);
      // This UUID is provisional until the provider confirms it. Persisting it
      // as current here would make restart treat a never-started session as
      // resumable.
      this._hasStartedSession = false;
      console.log(
        `[${this.id}] Reset session: ${oldSessionId.substring(0, 8)}... -> ${this.sessionId.substring(0, 8)}...`
      );
    }

    expireCoordinationRun(): void {
      this.runner.timeout('max');
    }

    broadcastQueue(): void {
      broadcast({ type: 'queue_updated', conversationId: this.id, queue: this.queue });
    }

    /**
     * Admit a message: register its turn attempt and build the queue entry.
     * Placement (append vs prepend) is the caller's decision.
     */
    private createQueueEntry(prompt: SessionRelativePrompt, input: TurnInput): QueueEntry {
      const message: QueuedMessage = {
        id: crypto.randomUUID(),
        content: prompt.fresh,
        queuedAt: new Date(),
        status: 'pending',
      };
      const attemptId = this.runner.createQueuedAttempt(message.id);
      return { message, input: Object.freeze({ ...input }), prompt, attemptId };
    }

    private retireInFlightHead(): void {
      const retired = this.turnQueue.retireInFlightHead();
      if (retired) {
        console.log(
          `[${this.id}] Retiring interrupted in-flight message id=${retired.message.id.substring(0, 8)}`
        );
      }
    }

    /**
     * Add a message to the queue. If the conversation is ready and idle,
     * process immediately. Otherwise it sits until the next status/ready change.
     */
    enqueueMessage(content: string, ownerInput?: OwnerInput): void {
      this.enqueuePrompt(sameEitherWay(content), ownerInput ?? unknownInput());
    }

    private enqueuePrompt(prompt: SessionRelativePrompt, input: TurnInput): void {
      if (!this._policy.acceptsUserInput) {
        this.refuseAutomationTranscript();
        return;
      }
      const queueDepthBefore = this.turnQueue.length;
      const entry = this.createQueueEntry(prompt, input);
      this.turnQueue.pushBack(entry);
      console.log(
        `[${this.id}] Queued message id=${entry.message.id.substring(0, 8)}, queueDepth=${queueDepthBefore}->${this.turnQueue.length}, contentLen=${entry.message.content.length}, preview="${formatLogPreview(entry.message.content)}"`
      );
      this.broadcastQueue();
      this.processQueue();
    }

    /**
     * Stop the active turn and send now, ahead of the queue. Pending queued
     * work is KEPT — interrupt stops the turn, not the queue (Clear drops the
     * queue). The killed turn's in-flight head is retired; everything else
     * stays in order behind the new message.
     */
    interruptAndSend(content: string, ownerInput?: OwnerInput): void {
      if (!this._policy.acceptsUserInput) {
        this.refuseAutomationTranscript();
        return;
      }
      this.retireInFlightHead();

      if (this.process) {
        this.stop();
      }

      const queueDepthBefore = this.turnQueue.length;
      const entry = this.createQueueEntry(sameEitherWay(content), ownerInput ?? unknownInput());
      this.turnQueue.pushFront(entry);
      console.log(
        `[${this.id}] interrupt_and_send id=${entry.message.id.substring(0, 8)}, queueDepth=${queueDepthBefore}->${this.turnQueue.length}, contentLen=${content.length}, preview="${formatLogPreview(content)}"`
      );
      this.broadcastQueue();
      this.processQueue();
    }

    /**
     * Move a pending queued message to the front so it runs next,
     * interrupting the active turn when there is one. Unknown or non-pending
     * ids are a no-op, like cancelQueuedMessage.
     */
    promoteQueuedMessage(messageId: string): void {
      if (!this._policy.acceptsUserInput) {
        this.refuseAutomationTranscript();
        return;
      }
      const promoted = this.turnQueue.promote(messageId);
      if (!promoted) return;
      console.log(
        `[${this.id}] Promoted queued message id=${promoted.message.id.substring(0, 8)} to front, queueDepth=${this.turnQueue.length}`
      );
      this.broadcastQueue();
      if (this.process) {
        this.stop();
      }
      this.processQueue();
    }

    /**
     * Cancel a pending queued message by ID. Cannot cancel messages already sending.
     */
    cancelQueuedMessage(messageId: string): void {
      const removed = this.turnQueue.removePending(messageId);
      if (!removed) return;
      console.log(`[${this.id}] Cancelled queued message: ${messageId.substring(0, 8)}`);
      this.runner.cancelQueuedAttempt(removed);
      this.broadcastQueue();
    }

    /**
     * Clear all pending messages from the queue. Messages currently sending are kept.
     */
    clearQueue(): void {
      const removed = this.turnQueue.clearPending();
      for (const entry of removed) this.runner.cancelQueuedAttempt(entry);
      if (this.turnQueue.length === 0) this._policy.queueEmptied();
      console.log(`[${this.id}] Cleared queue: removed ${removed.length} messages`);
      this.broadcastQueue();
    }

    /**
     * Process the next queued message if the conversation is idle.
     * Called from: the runner after a turn drains, enqueueMessage (new message).
     */
    processQueue(): void {
      if (!this._policy.acceptsUserInput) {
        // Old persisted queue state must not become an authority bypass after
        // restart. User admission is closed on every automation transcript.
        this.clearQueue();
        return;
      }
      if (this.process || this.isRunning) return;
      const next = this.turnQueue.startHead();
      if (!next) return; // empty, or the head is already in flight

      this.runner.prepareQueuedAttempt(next);
      console.log(
        `[${this.id}] processQueue sending id=${next.message.id.substring(0, 8)}, queueDepth=${this.turnQueue.length}, contentLen=${next.message.content.length}, preview="${formatLogPreview(next.message.content)}"`
      );
      this.broadcastQueue();
      try {
        this._sendingFromQueue = true;
        try {
          // Automation transcripts never reach here (cleared above), so this is
          // sendMessage without its refusal, carrying the item's own wording
          // and provenance (never serialized for restore).
          this.sendMessageInternal(next.prompt, next.input);
        } finally {
          this._sendingFromQueue = false;
        }
      } catch (error) {
        // Provider admission can still fail synchronously at a future seam.
        // Never strand the queue head in "sending" when no process exists.
        if (this.turnQueue.head() === next && this.turnQueue.releaseHead()) {
          this.broadcastQueue();
        }
        throw error;
      }
    }

    hasActiveProcess(): boolean {
      return this.process !== null;
    }

    waitingForRunSlot(): boolean {
      return this._policy.waitingForRunSlot();
    }

    async waitForTurnDrain(): Promise<void> {
      await this.runner.drain();
    }

    hasStartedSession(): boolean {
      return this._hasStartedSession;
    }

    get provider(): ProviderName {
      return this.config.provider;
    }

    private get effectiveConfig() {
      return this.configResolution.status === 'resolved'
        ? this.configResolution.value
        : this.configResolution.lastResolved;
    }

    get model(): ModelId | undefined {
      return this.effectiveConfig?.modelId;
    }

    get reasoningEffort(): string | undefined {
      return this.effectiveConfig?.reasoningEffort;
    }

    applyConfigState(state: ConversationConfigState): void {
      this.config = state.config;
      this.configRevision = state.revision;
      this.configResolution = state.resolution;
    }

    refreshConfigResolution(): ConfigResolution {
      this.configResolution = resolveConfigAgainstProviderCatalog(
        this.config,
        this.effectiveConfig
      );
      return this.configResolution;
    }

    // Harness/provider can only be changed before the first turn has started.
    // Once a session has started, provider-specific state (session files, resume
    // IDs, and message history) is no longer safely interchangeable.
    canChangeProvider(): boolean {
      return (
        !this._hasStartedSession &&
        this.messages.length === 0 &&
        this.turnQueue.length === 0 &&
        !this.isRunning &&
        !this.isStreaming
      );
    }

    toJSON(): ConversationData {
      return {
        id: this.id,
        sessionId: this.sessionId,
        messages: this.messages,
        messageCount: this.messages.length,
        isRunning: this.isRunning,
        done: this.done,
        isStreaming: this.isStreaming,
        confirmed: true,
        createdAt: this.createdAt,
        workingDirectory: this.workingDirectory,
        provider: this.provider,
        model: this.model,
        reasoningEffort: this.reasoningEffort,
        config: this.config,
        configRevision: this.configRevision,
        configResolution: this.configResolution,
        reportedModel: this.modelName,
        subAgents: this.subAgents,
        queue: this.queue,
        isWorker: this.isWorker,
        swarmId: this.swarmId,
        workerId: this.workerId,
        workerRole: this.workerRole,
        parentConversationId: this.parentConversationId,
        resumedFromConversationId: this.resumedFromConversationId,
        modelName: this.modelName,
        title: this.title,
        swarmDebugPrefix: this.swarmDebugPrefix,
        // `buddyContext` is deliberately NOT serialized: it is a getter over
        // `kind`, and repeating it cost 550 KB of a 2.4 MB `init` (2026-09-25).
        // Readers use shared `getBuddyContext()`, which derives from `kind`.
        kind: this.kind,
        purpose: this.purpose,
        placement: this.placement,
        providerUsage: this.providerUsage,
      };
    }
  };
}
