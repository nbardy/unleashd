import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import {
  type ExecuteCommandRequest,
  type UnifiedAgentEvent,
  executeCommand,
} from '@nbardy/agent-cli';
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
import { formatToolUse, isCompletionOnlyToolUse } from '../adapters/tool-format';
import {
  BuddyBuilderTurnPolicy,
  type BuddyPolicyHost,
  BuddyTurnPolicy,
  type BuddyTurnPolicyDependencies,
  type MemoryGenerationInput,
  createMemorySnapshot,
} from '../buddies/turn-policy';
import {
  SWARM_POLL_INTERVAL_MS,
  SWARM_POLL_THROTTLE_MS,
  TURN_BRIDGE_TIMEOUT_MS,
  TURN_MAX_RUNTIME_MS,
  TURN_PROVIDER_IDLE_TIMEOUT_MS,
  TURN_TIMEOUT_KILL_GRACE_MS,
} from '../constants/timeouts';
import type {
  RuntimeTurnAttemptObserver,
  TurnActivitySource,
  TurnAttemptActivity,
  TurnTerminalCause,
} from '../observability';
import { resolveConfigAgainstProviderCatalog } from '../providers/catalog-service';
import { SwarmObservers, watchSwarmRuns } from '../swarm/observer';
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
import {
  type SubAgentFold,
  type SubAgentHost,
  failRunningSubAgents,
  subAgentFoldFor,
} from '../turns/subagents';
import {
  type TurnTimeoutKind,
  TurnWatchdog,
  describeTurnTimeout,
  turnAttemptActivityFromEvent,
} from '../turns/watchdog';

interface ChunkData {
  type: 'chunk';
  conversationId: string;
  text: string;
}
interface MessageCompleteData {
  type: 'message_complete';
  conversationId: string;
  reason?: 'success' | 'error' | 'out_of_tokens' | 'killed';
}
interface MessageData {
  type: 'message';
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}
type ToolUseEvent = Extract<UnifiedAgentEvent, { type: 'tool.use' }>;
type CompletionReason = Extract<UnifiedAgentEvent, { type: 'turn.complete' }>['reason'];

export type { SeatTurnInput, SessionRelativePrompt } from '../turns/input';

export type ConversationBroadcast = ServerMessage | ChunkData | MessageCompleteData | MessageData;

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
 * The host server's ports. The turn core uses the first group; the Buddy
 * policies (buddies/turn-policy.ts) use `BuddyTurnPolicyDependencies`.
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

const VERBOSE = process.env.VERBOSE === '1' || process.argv.includes('--verbose');
const AGENT_CLI_DEBUG_EVENTS = process.env.AGENT_CLI_DEBUG_EVENTS === '1';
const LOG_CONTENT_PREVIEW_CHARS = 140;
const ATTEMPT_ACTIVITY_INTERVAL_MS = 5_000;

function formatLogPreview(content: string, maxChars = LOG_CONTENT_PREVIEW_CHARS): string {
  return content.replace(/\s+/g, ' ').slice(0, maxChars);
}
function stripAnsi(value: string): string {
  const ansiEscapeSequence = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  return value.replace(ansiEscapeSequence, '');
}
function stderrSnippet(value: string, maxLength = 400): string {
  const cleaned = stripAnsi(value).replace(/\r/g, '\n').trim();
  if (!cleaned) return '';
  const tail = cleaned.slice(-1200).replace(/\s+/g, ' ').trim();
  if (!tail) return '';
  return tail.length > maxLength ? `${tail.slice(0, maxLength - 3)}...` : tail;
}
const OUT_OF_TOKENS_PATTERN =
  /out of tokens|token limit|usage limit|insufficient (?:credits|balance)|exceeded(?: your)?(?: current)? quota|credit balance|rate limit exceeded/i;
function normalizeProviderErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'Unknown provider error';
  if (!OUT_OF_TOKENS_PATTERN.test(trimmed)) return trimmed;
  if (/^out of tokens:/i.test(trimmed)) return trimmed;
  return `Out of tokens: ${trimmed}`;
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
    onDrained?: (
      status: 'complete' | 'failed',
      detail: string,
      terminalCause?: TurnTerminalCause
    ) => void,
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
    clearExternalRunningStatus,
    clearLocalCompletionSuppression,
    markLocalCompletionSuppression,
    persistCurrentSession: persistCurrentConversationSession,
    getConversation,
    readLatestOompaRuntime,
    createSessionId,
    executeTurn = executeCommand,
    turnAttempts = NOOP_TURN_ATTEMPT_OBSERVER,
  } = dependencies;
  // One async swarm poller per working directory, shared by all turns there.
  const swarmObservers = new SwarmObservers(readLatestOompaRuntime, {
    intervalMs: SWARM_POLL_INTERVAL_MS,
    throttleMs: SWARM_POLL_THROTTLE_MS,
  });

  return class Conversation extends EventEmitter {
    id: string; // UI conversation ID (persists across resets)
    sessionId: string; // Provider CLI session ID (can be reset for fresh context)
    messages: Message[];
    process: ChildProcess | null;
    isRunning: boolean;
    // Server-authoritative: assistant is actively producing content.
    // INVARIANT: !isRunning → !isStreaming (enforced in message_complete/close handlers).
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
        this.kind = buddyKindFromContext(value, this._buddyBriefing ?? undefined);
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
    private get _buddyBriefing(): string | null {
      return this._policy.memorySnapshot()?.briefing ?? null;
    }
    // Server-private automation ownership. Never serialized or placed in BuddyContext.
    private _automationClaimToken: string | null = null;
    private _sendingFromQueue = false;
    // Provider-counted usage for the latest request on the CURRENT session.
    // Written from `usage` events during the turn and flushed to the session
    // binding when the turn ends, so a reload does not have to re-parse the
    // transcript. Cleared on session reset: a new session is a new context.
    providerUsage: ProviderTurnUsage | null;
    // Set when `providerUsage` changed during the active turn and has not yet
    // been persisted. Avoids a CAS write per streamed usage event.
    private _providerUsageDirty = false;
    // Sub-agent tracking
    subAgents: SubAgent[];
    // Server-owned message queue — persists across client navigation/refresh.
    // Client mirrors this state via queue_updated broadcasts.
    private readonly turnQueue = new TurnQueue();
    get queue(): QueuedMessage[] {
      return this.turnQueue.items;
    }
    // Chosen once per turn from the harness capability table (turns/subagents.ts).
    private _subAgentFold: SubAgentFold = subAgentFoldFor('claude');
    // Track if we've started a CLI session (for --resume vs --session-id)
    private _hasStartedSession: boolean;
    // Buffer stderr for this process run so silent failures can be surfaced to UI.
    private _stderrBuffer: string;
    // Tracks whether assistant text or a tool event reached the unified stream.
    private _sawMeaningfulProviderOutputThisRun: boolean;
    // Start time of the current CLI process run (for duration tracking).
    private _processStartTime = 0;
    // Bridge / provider-idle / max-runtime clocks. The max budget is passed
    // explicitly: foreground Buddy turns must never inherit a shorter claim
    // default (incident 2026-09-10, see turns/watchdog.ts).
    private readonly _watchdog = new TurnWatchdog(
      {
        bridgeMs: TURN_BRIDGE_TIMEOUT_MS,
        providerIdleMs: TURN_PROVIDER_IDLE_TIMEOUT_MS,
        maxRuntimeMs: TURN_MAX_RUNTIME_MS,
      },
      (kind) => this._handleTurnTimeout(kind)
    );
    // This turn's subscription to its folder's swarm observer (swarm/observer.ts).
    private _stopSwarmWatch: (() => void) | null = null;
    // When true, message_complete already performed state cleanup (isStreaming/isRunning/broadcast).
    // The close handler checks this to skip redundant work on normal completion, while still
    // running full cleanup on crash/kill/error paths where message_complete never fired.
    private _turnCompletedCleanly = false;
    private _activeAttemptId: string | null = null;
    private _nextAttempt: { attemptId: string; queueMessageId?: string } | null = null;
    private _terminalCauseHint: TurnTerminalCause | null = null;
    private _stopCause: 'user_stop' | 'server_restart' | null = null;
    private _lastAttemptActivityAt = 0;
    private _lastAttemptActivitySource: TurnActivitySource | null = null;
    private _lastObservedTurnActivity: TurnAttemptActivity | null = null;
    private _runToken = 0;
    private _activeTurnStop: ((signal?: NodeJS.Signals) => void) | null = null;
    private _activeTurnDrain: Promise<void> | null = null;

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
      this._stderrBuffer = '';
      this._sawMeaningfulProviderOutputThisRun = false;
    }

    get memoryGeneration(): string | null {
      return this._policy.memorySnapshot()?.generation ?? null;
    }

    getMemorySnapshot(): MemorySnapshot | null {
      return this._policy.memorySnapshot();
    }

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
        buddy: (buddyKind) => new BuddyTurnPolicy(buddyKind, this.policyHost, dependencies, seed),
        buddy_builder: () => new BuddyBuilderTurnPolicy(this.policyHost, dependencies),
      });
    }

    private get policyHost(): BuddyPolicyHost {
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
          this._cancelQueuedAttempt(dropped);
          this.broadcastQueue();
        },
        processQueue: () => this.processQueue(),
        maxRuntimeReached: () => this._handleTurnTimeout('max'),
        refuseAutomationTranscript: (message) => this.refuseAutomationTranscript(message),
        send: (prompt, input) => this.sendMessageInternal(prompt, input),
        on: (event, listener) => this.on(event, listener),
        once: (event, listener) => this.once(event, listener),
        off: (event, listener) => this.off(event, listener),
        emit: (event, ...args) => this.emit(event, ...args),
      };
    }

    /**
     * Send a message via executeCommand (conversation mode).
     *
     * HYBRID SYNC STRATEGY:
     * 1. Event stream (live): drives UI text streaming in real time.
     * 2. Disk poller (persistence): rehydrates sessions/history across restarts.
     *
     * First turn omits resumeSessionId; subsequent turns resume with the captured session ID.
     */
    private _prepareTurnAttempt(queueMessageId?: string): string {
      const prepared = this._nextAttempt;
      this._nextAttempt = null;
      if (prepared) {
        this._activeAttemptId = prepared.attemptId;
        return prepared.attemptId;
      }
      const attemptId = crypto.randomUUID();
      turnAttempts.queued({
        attemptId,
        conversationId: this.id,
        ...(queueMessageId ? { queueMessageId } : {}),
        providerSessionId: this.sessionId,
      });
      this._activeAttemptId = attemptId;
      return attemptId;
    }

    private _finishTurnAttempt(
      state: 'succeeded' | 'failed' | 'cancelled' | 'interrupted',
      terminalCause: TurnTerminalCause
    ): void {
      this._policy.attemptFinished(terminalCause);
      if (!this._activeAttemptId) return;
      turnAttempts.terminal({
        attemptId: this._activeAttemptId,
        state,
        terminalCause,
        providerSessionId: this.sessionId,
      });
      this.turnQueue.forgetAttempt(this._activeAttemptId);
      this._activeAttemptId = null;
      this._terminalCauseHint = null;
      this._stopCause = null;
    }

    private _cancelQueuedAttempt(entry: QueueEntry): void {
      if (!entry.attemptId) return;
      turnAttempts.terminal({
        attemptId: entry.attemptId,
        state: 'cancelled',
        terminalCause: 'user_stop',
        providerSessionId: this.sessionId,
      });
      entry.attemptId = null;
    }

    private spawnForMessage(
      content: string,
      executionConfig: ResolvedExecutionConfig,
      forkSourceSessionId: string | undefined,
      turnInput: TurnInput
    ): void {
      if (this.process || this.isRunning) {
        console.warn(`[${this.id}] Already processing a message, ignoring`);
        return;
      }
      const runToken = ++this._runToken;

      // This session is now being handled locally; clear any stale external flags.
      clearExternalRunningStatus(this.id, this.sessionId);
      clearLocalCompletionSuppression(this.id, this.sessionId);

      const forking = !!forkSourceSessionId;
      const shouldResume = this.resumesProviderSession(forkSourceSessionId);
      const executionMode = forking ? 'fork' : shouldResume ? 'resume' : 'fresh';
      console.log(
        `[${this.id}] Spawning ${this.provider} (mode=${executionMode}, provider-session=${this.sessionId.substring(0, 8)}...${forkSourceSessionId ? `, fork-source-session=${forkSourceSessionId.substring(0, 8)}...` : ''}${this.resumedFromConversationId ? `, parent-conversation=${this.resumedFromConversationId.substring(0, 8)}...` : ''})`
      );
      console.log(`[${this.id}] Message: "${content.substring(0, 50)}"`);

      // Reset per-run buffers
      this._stderrBuffer = '';
      this._sawMeaningfulProviderOutputThisRun = false;
      this._turnCompletedCleanly = false;
      this._terminalCauseHint = null;
      this._stopCause = null;
      this._processStartTime = Date.now();
      this._lastAttemptActivityAt = 0;
      this._lastAttemptActivitySource = null;
      this._lastObservedTurnActivity = null;
      this._subAgentFold = subAgentFoldFor(executionConfig.provider);
      if (this._activeAttemptId) {
        turnAttempts.starting(this._activeAttemptId);
        turnAttempts.activity(
          this._activeAttemptId,
          {
            source: 'runtime',
            providerEventType: `execution.${executionMode}`,
            providerEventSource: this.resumedFromConversationId
              ? `parent-conversation:${this.resumedFromConversationId}`
              : 'unleashd.runtime',
          },
          this.sessionId
        );
      }

      // One request shape for every harness. Effort is a pass-through string:
      // configuration validation rejects levels the provider does not accept, and
      // agent-cli maps it to a flag only for harnesses that take one
      // (execute.ts), so the cast covers only its `never` typing on the rest.
      // Replaces three identical per-provider branches (T08 S2). Guard:
      // `every harness receives its resolved effort in one request shape`.
      const baseRequest = {
        mode: 'conversation' as const,
        prompt: content,
        cwd: this.workingDirectory,
        model: executionConfig.modelId,
        resumeSessionId: shouldResume ? this.sessionId : undefined,
        forkSessionId: forking ? forkSourceSessionId : undefined,
        yolo: true,
        detached: true,
        debugRawEvents: AGENT_CLI_DEBUG_EVENTS,
      };
      let turn: ReturnType<typeof executeCommand>;
      try {
        const extras = this._policy.startTurn(turnInput, executionConfig);
        turn = executeTurn({
          ...baseRequest,
          harness: executionConfig.provider,
          reasoningEffort: executionConfig.reasoningEffort,
          ...extras,
        } as ExecuteCommandRequest);
      } catch (error) {
        this._policy.spawnFailed();
        this._finishTurnAttempt('failed', 'spawn_failed');
        const message = error instanceof Error ? error.message : String(error);
        // An automation subscribes to this event before calling sendMessage(). A
        // provider/configuration failure can happen synchronously, before there
        // is a child process whose completion could reject the run. Keep this
        // signal at the conversation boundary so every caller sees one terminal
        // result. See agent_notes/2026-08-24_automation-execution-ownership-design.md.
        this.emit('buddy-turn-failed', message);
        throw error;
      }

      const reviewAttemptId = this._activeAttemptId ?? crypto.randomUUID();
      this._policy.spawned(turnInput, {
        attemptId: reviewAttemptId,
        messageStart: Math.max(0, this.messages.length - 1),
      });
      this.process = turn.child;
      this._activeTurnStop = turn.stop;
      this.isRunning = true;
      if (this._activeAttemptId) {
        turnAttempts.running(this._activeAttemptId, this.sessionId);
      }
      this.emit('buddy-turn-started');
      this._hasStartedSession = true; // Mark session as started for next message
      this._startTurnWatchdogs();
      this.broadcastStatus();

      let automationCompletionError: string | null = null;
      const consumeEvents = async (): Promise<void> => {
        for await (const event of turn.events) {
          if (runToken !== this._runToken) return;
          // A timeout finalizes the user-visible turn before the child has
          // necessarily acknowledged SIGTERM. Ignore any buffered/late
          // provider events so they cannot resurrect or complete it twice.
          if (this._turnCompletedCleanly) continue;
          this._noteTurnActivity(event);
          switch (event.type) {
            case 'session.started': {
              if (event.sessionId !== this.sessionId) {
                console.log(`[${this.id}] Session captured: ${event.sessionId}`);
              }
              const oldSessionId = this.sessionId;
              this.sessionId = event.sessionId;
              if (oldSessionId !== event.sessionId) {
                unregisterSessionAlias(oldSessionId, { keepKnown: true });
              }
              registerSessionAlias(event.sessionId, this.id);
              await persistCurrentConversationSession(
                this,
                event.sessionId,
                this._policy.audienceKey()
              );
              if (this._activeAttemptId) {
                turnAttempts.bindProviderSession(this._activeAttemptId, event.sessionId);
              }
              broadcast({
                type: 'session_bound',
                conversationId: this.id,
                sessionId: this.sessionId,
              });
              break;
            }
            case 'session.title': {
              // Provider-generated label (Claude ai-title/custom-title).
              // Custom (user-set) always wins; auto titles never overwrite a
              // custom one. Hydrated titles count as custom-sticky: the file
              // backfill already resolved precedence, so live ai noise must
              // not clobber it — only a live custom event can.
              const next = event.title.trim();
              if (!next) break;
              if (event.source === 'custom' || this._titleSource !== 'custom') {
                if (this.title !== next) {
                  this.title = next;
                  this._titleSource = event.source;
                  broadcast({
                    type: 'conversations_updated',
                    conversations: [this.toJSON()],
                  });
                }
              }
              break;
            }
            case 'text.delta': {
              this._sawMeaningfulProviderOutputThisRun = true;
              this.appendText(event.text);
              break;
            }
            case 'tool.use': {
              this._sawMeaningfulProviderOutputThisRun = true;
              this.applyToolUse(event);
              break;
            }
            case 'tool.result': {
              if (event.isError) break;
              const content = this._policy.formatToolResult(event.output);
              if (content) this.appendText(`\n${content}\n`);
              break;
            }
            case 'turn.complete': {
              if (event.reason === 'error' || event.reason === 'out_of_tokens') {
                automationCompletionError = `Provider completed the turn with reason: ${event.reason}`;
              } else if (event.reason === 'killed') {
                automationCompletionError = 'Provider turn was interrupted';
              }
              this.completeMessage(event.reason);
              break;
            }
            case 'out_of_tokens': {
              this._terminalCauseHint = 'out_of_tokens';
              this.surfaceError(normalizeProviderErrorMessage(event.message));
              break;
            }
            case 'error': {
              this._terminalCauseHint = 'provider_error';
              this.surfaceError(normalizeProviderErrorMessage(event.message));
              break;
            }
            case 'stderr': {
              this._stderrBuffer = (this._stderrBuffer + event.text).slice(-4096);
              if (VERBOSE) console.error(`[${this.id}] stderr:`, event.text);
              break;
            }
            case 'progress': {
              // Always log provider warnings (network retries, etc.) — these are
              // operational signals, not debug noise. Other progress events
              // (heartbeats, non-assistant messages) only log with debug flag.
              if (event.source === 'gemini.warning') {
                console.warn(
                  `[${this.id}] provider warning:`,
                  event.data?.message ?? JSON.stringify(event)
                );
              } else if (AGENT_CLI_DEBUG_EVENTS) {
                console.error(`[${this.id}] progress:`, JSON.stringify(event));
              }
              break;
            }
            case 'turn.started': {
              this._ensureAssistantMessage();
              break;
            }
            case 'usage': {
              // Provider-counted truth for the request that just completed.
              // agent-cli already canonicalised the per-harness conventions and
              // excluded claude's turn-aggregate `result` usage and its subagent
              // measurements, so take this verbatim — re-deriving it here would
              // reintroduce exactly the double-counting those parsers avoid.
              //
              // Last write wins within a turn: a turn can issue several requests
              // (tool loops), and the latest is the live context size. It can go
              // DOWN when the provider compacts; that is the signal, not a bug.
              this.providerUsage = { ...event.usage, observedAt: new Date().toISOString() };
              this._providerUsageDirty = true;
              break;
            }
            default:
              break;
          }
        }
      };

      let eventConsumptionError: Error | null = null;
      const eventConsumption = consumeEvents().catch((err: unknown) => {
        if (runToken !== this._runToken) return;
        eventConsumptionError = err instanceof Error ? err : new Error(String(err));
        const message = eventConsumptionError.message;
        console.error(`[${this.id}] Event stream error: ${message}`);
        this._terminalCauseHint = 'provider_error';
        this.surfaceError(normalizeProviderErrorMessage(message));
      });

      const turnDrain = turn.completed
        .then(async ({ exitCode, signal, sessionId, reason }) => {
          if (runToken !== this._runToken) return;
          // `completed` describes child-process termination, not consumption of
          // the normalized event stream. In particular, session persistence is
          // asynchronous. Releasing ownership before that consumer drains can
          // start the next queued turn while text/session/turn.complete events
          // from this one are still being applied. One joined terminal path is
          // simpler than trying to make every event handler replay-safe. See
          // agent_notes/2026-08-24_automation-execution-ownership-design.md.
          await eventConsumption;
          if (runToken !== this._runToken) return;
          this._clearTurnWatchdogs();
          if (sessionId && sessionId !== this.sessionId) {
            const oldSessionId = this.sessionId;
            this.sessionId = sessionId;
            unregisterSessionAlias(oldSessionId, { keepKnown: true });
            registerSessionAlias(sessionId, this.id);
            await persistCurrentConversationSession(this, sessionId);
            if (this._activeAttemptId) {
              turnAttempts.bindProviderSession(this._activeAttemptId, sessionId);
            }
          }

          // Flush once per turn rather than per usage event: a tool loop emits
          // one per request, and each write is a CAS round-trip on the config
          // record. Persisted against the session id settled just above, so a
          // mid-turn session rotation files the usage under the session that
          // actually holds that context.
          if (this._providerUsageDirty && this.providerUsage) {
            this._providerUsageDirty = false;
            try {
              await dependencies.persistSessionUsage?.(this.id, this.sessionId, this.providerUsage);
            } catch (error) {
              // The meter is observability. Losing a usage write must never
              // fail a turn that otherwise succeeded; the session-file parser
              // still covers this session on the next read.
              console.warn(
                `[${this.id}] Failed to persist provider usage:`,
                error instanceof Error ? error.message : String(error)
              );
            }
          }

          const durationMs = Date.now() - this._processStartTime;
          console.log(
            `[${this.id}] Process closed with code ${exitCode} signal=${signal ?? 'none'} (reason=${reason}) after ${durationMs}ms`
          );

          // message_complete already handled state cleanup and broadcast.
          // Just null the process ref, dequeue, and continue.
          if (this._turnCompletedCleanly) {
            this._policy.revoke();
            this.process = null;
            this._activeTurnStop = null;
            clearExternalRunningStatus(this.id, this.sessionId);
            markLocalCompletionSuppression(this.id, this.sessionId);
            if (this.turnQueue.finishHead()) this.broadcastQueue();
            const completionFailure =
              eventConsumptionError?.message ??
              automationCompletionError ??
              (this._terminalCauseHint === 'out_of_tokens'
                ? 'Provider ran out of tokens'
                : this._terminalCauseHint === 'provider_error'
                  ? 'Provider reported an error'
                  : null);
            if (completionFailure) {
              if (this._stopCause) {
                this._finishTurnAttempt(
                  this._stopCause === 'server_restart' ? 'interrupted' : 'cancelled',
                  this._stopCause
                );
              } else if (this._terminalCauseHint === 'out_of_tokens') {
                this._finishTurnAttempt('failed', 'out_of_tokens');
              } else {
                this._finishTurnAttempt('failed', 'provider_error');
              }
              this.emit('buddy-turn-failed', completionFailure);
            } else {
              // Enqueue memory review before completion listeners or
              // processQueue can start another turn.
              if (reason === 'success' && exitCode === 0 && !this._stopCause) {
                this._policy.reviewCompleted(this.messages);
              }
              this._finishTurnAttempt('succeeded', 'provider_complete');
              const completedAssistant = [...this.messages]
                .reverse()
                .find((message) => message.role === 'assistant');
              this.emit('buddy-turn-complete', completedAssistant?.content ?? '');
            }
            this.processQueue();
            return;
          }

          if (reason === 'killed' && this._stopCause) {
            this._finishTurnAttempt(
              this._stopCause === 'server_restart' ? 'interrupted' : 'cancelled',
              this._stopCause
            );
          } else if (reason === 'out_of_tokens' || this._terminalCauseHint === 'out_of_tokens') {
            this._finishTurnAttempt('failed', 'out_of_tokens');
          } else if (this._terminalCauseHint === 'provider_error') {
            this._finishTurnAttempt('failed', 'provider_error');
          } else if (reason === 'killed') {
            this._finishTurnAttempt('failed', 'process_killed');
          } else {
            this._finishTurnAttempt('failed', 'process_exit');
          }

          const emitSystemMessage = (content: string): void => {
            this.messages.push({ role: 'system', content, timestamp: new Date() });
            broadcast({
              type: 'message',
              conversationId: this.id,
              role: 'system',
              content,
            });
          };

          const details = stderrSnippet(this._stderrBuffer);
          // Use executeCommand completion reason first; it carries protocol-level failures
          // that can otherwise look like successful exits.
          if (reason === 'killed') {
            const killedMsg = details
              ? `Process interrupted before completion: ${details}`
              : 'Process interrupted before completion';
            console.error(`[${this.id}] ${killedMsg}`);
            emitSystemMessage(killedMsg);
          } else if (reason === 'error') {
            const errorMsg =
              exitCode !== null && exitCode !== 0
                ? details
                  ? `Process exited with code ${exitCode}: ${details}`
                  : `Process exited with code ${exitCode}`
                : details
                  ? `Provider exited before completing the turn: ${details}`
                  : 'Provider exited before completing the turn';
            console.error(`[${this.id}] ${errorMsg}`);
            emitSystemMessage(errorMsg);
          } else if (exitCode === 0 && !this._sawMeaningfulProviderOutputThisRun) {
            // Silent zero-exit without any streamed output is treated as provider failure.
            const content = details
              ? `Provider reported an error without response output: ${details}`
              : 'Provider exited without response output';
            console.error(`[${this.id}] ${content}`);
            emitSystemMessage(content);
          } else if (reason !== 'out_of_tokens') {
            // Successful completion - add a system message with duration
            const durationSec = (durationMs / 1000).toFixed(1);
            const successMsg = `Process completed successfully in ${durationSec}s`;
            emitSystemMessage(successMsg);
          }

          // INVARIANT: dead process can't stream. Clear both atomically.
          // This is the safety net for crash/kill/OOM — all paths that skip message_complete.

          const lastMsg = this.messages[this.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.completedAt) {
            lastMsg.completedAt = new Date();
            lastMsg.completionReason = reason || (exitCode === 0 ? 'success' : 'error');
          }

          this.isStreaming = false;
          this.isRunning = false;
          this.process = null;
          this._activeTurnStop = null;
          // Suppress external-running detection for trailing disk writes from this
          // just-finished local run. Also clear any stale external flag immediately.
          clearExternalRunningStatus(this.id, this.sessionId);
          markLocalCompletionSuppression(this.id, this.sessionId);
          this.broadcastStatus();
          this._policy.ended(
            reason === 'killed'
              ? { t: 'cancelled', detail: reason }
              : { t: 'failed', detail: reason }
          );
          this.emit('buddy-turn-failed', reason);
          // Dequeue the "sending" message (completed or crashed) and process next.
          // This is the SINGLE code path for dequeue — not split between
          // message_complete and close. Handles both success and crash.
          if (this.turnQueue.finishHead()) this.broadcastQueue();
          // WS message ordering guarantees clients see status:false before the
          // next spawn's status:true. No delay needed.
          this.processQueue();
        })
        .catch((err: unknown) => {
          if (runToken !== this._runToken) return;
          this._clearTurnWatchdogs();
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[${this.id}] Process completion error: ${message}`);
          this._finishTurnAttempt('failed', 'process_exit');
          this.surfaceError(normalizeProviderErrorMessage(message));
          this.isStreaming = false;
          this.isRunning = false;
          this.process = null;
          this._activeTurnStop = null;
          this.broadcastStatus();
          this._policy.ended({ t: 'failed', detail: message });
          this.emit('buddy-turn-failed', message);
          if (this.turnQueue.length > 0) {
            const removed = this.turnQueue.length;
            for (const entry of this.turnQueue.clearAll()) this._cancelQueuedAttempt(entry);
            console.warn(
              `[${this.id}] Cleared ${removed} pending message(s) due to process error to prevent retry loops.`
            );
            this.broadcastQueue();
          }
        });
      this._activeTurnDrain = turnDrain;
      void turnDrain.finally(() => {
        if (this._activeTurnDrain === turnDrain) this._activeTurnDrain = null;
      });
    }

    private _ensureAssistantMessage(): void {
      const lastMsg = this.messages[this.messages.length - 1];
      if (!lastMsg || lastMsg.role !== 'assistant') {
        console.log(
          `[${this.id}] Creating NEW assistant message (msg #${this.messages.length + 1})`
        );
        const newMsg: Message = {
          role: 'assistant',
          content: '',
          timestamp: new Date(),
        };
        this.messages.push(newMsg);
        this.broadcastMessage({
          type: 'message',
          role: 'assistant',
          content: '',
          conversationId: this.id,
        });
        if (!this.isStreaming) {
          this.isStreaming = true;
          this.broadcastStatus();
        }
      }
    }

    // Turn events are typed once, by agent-cli (`UnifiedAgentEvent`). The
    // consumer in spawnForMessage calls these folds directly; the former
    // ProviderEvent re-typing layer and its second switch are gone (T08 S1).

    private get subAgentHost(): SubAgentHost {
      const conversation = this;
      return {
        conversationId: this.id,
        get agents() {
          return conversation.subAgents;
        },
        broadcast,
        newId: createSessionId,
      };
    }

    private appendText(text: string): void {
      this._ensureAssistantMessage();
      const currentMsg = this.messages[this.messages.length - 1];
      if (currentMsg.role === 'assistant') {
        currentMsg.content += text;
      }
      if (VERBOSE)
        console.log(
          `[${this.id}] chunk (${text.length} chars): "${text.substring(0, 30).replace(/\n/g, '\\n')}..."`
        );
      this.broadcastChunk({ type: 'chunk', conversationId: this.id, text });
    }

    private applyToolUse(event: ToolUseEvent): void {
      this._ensureAssistantMessage();
      if (this._subAgentFold.toolUse(this.subAgentHost, event) === 'hide') return;
      // Normalize tool line formatting across providers (Claude/Gemini/Codex).
      // Suppress Codex shell completion-only events to avoid duplicate lines.
      if (isCompletionOnlyToolUse(event.name, event.input, event.displayText)) return;
      const formattedTool = formatToolUse(event.name, event.input, event.displayText);
      if (!formattedTool) return;
      const currentMsg = this.messages[this.messages.length - 1];
      const isQuestion = formattedTool.startsWith('<!--ask_user_question:');
      const needsLeadingNewline =
        !isQuestion &&
        currentMsg?.role === 'assistant' &&
        currentMsg.content.length > 0 &&
        !currentMsg.content.endsWith('\n');
      const chunkText = isQuestion
        ? formattedTool
        : `${needsLeadingNewline ? '\n' : ''}${formattedTool}\n`;
      // Keep server-side message text aligned with streamed chunks.
      if (currentMsg?.role === 'assistant') currentMsg.content += chunkText;
      this.broadcastChunk({ type: 'chunk', conversationId: this.id, text: chunkText });
    }

    private completeMessage(reason: CompletionReason): void {
      // Clear watchdog timers immediately — the turn completed normally.
      // Without this they dangle until process close, risking a spurious timeout.
      this._clearTurnWatchdogs();
      // This closes the UI stream, not execution ownership. The attempt is
      // terminalized only after child exit and event EOF join above. See
      // invariant I8 and its alternatives in the ownership design note.
      const completedAt = new Date();
      const lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.completedAt) {
        lastMsg.completedAt = completedAt;
        lastMsg.completionReason = reason;
      }
      this._subAgentFold.parentCompleted(this.subAgentHost, completedAt);

      // Broadcast message_complete BEFORE status(isStreaming=false).
      // Client's message_complete handler calls flushChunkBuffer() — the last
      // buffered text must be flushed before isStreaming=false triggers a re-render
      // that hides typing dots. Preserves the documented broadcast sequence.
      this.broadcastChunk({ type: 'message_complete', conversationId: this.id, reason });

      // turn.complete means the assistant has finished this turn from the
      // user's perspective; clear busy state now instead of waiting for
      // child-process teardown.
      this.isStreaming = false;
      this.isRunning = false;
      clearExternalRunningStatus(this.id, this.sessionId);
      markLocalCompletionSuppression(this.id, this.sessionId);
      this.broadcastStatus();
      broadcast({ type: 'conversations_updated', conversations: [this.toJSON()] });

      // Signal to the close handler that cleanup already happened.
      // Close handler will skip redundant state changes and broadcasts.
      this._turnCompletedCleanly = true;
      this._policy.streamCompleted();
    }

    /** Surface provider errors (usage limits, auth failures, turn errors) as a system message. */
    private surfaceError(message: string): void {
      console.error(`[${this.id}] Provider error: ${message}`);
      this.messages.push({ role: 'system', content: message, timestamp: new Date() });
      broadcast({ type: 'message', conversationId: this.id, role: 'system', content: message });
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
      const content =
        message ??
        'This automation transcript is read-only. Start an ordinary Buddy conversation to continue working.';
      this.messages.push({ role: 'system', content, timestamp: new Date() });
      this.broadcastMessage({
        type: 'message',
        role: 'system',
        content,
        conversationId: this.id,
      });
      broadcast({
        type: 'conversations_updated',
        conversations: [this.toJSON()],
      });
    }

    // The one resume/fresh decision: spawnForMessage passes --resume on it and
    // sendMessageInternal words a SessionRelativePrompt by it, so they agree.
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

      // --- Chat Fork ---
      //
      // Chat "Fork" (soft handoff): resumedFromConversationId is UI lineage.
      // Context is supposed to live in the draft / first user message
      // (originally a pasted transcript). Changing provider before send is
      // intentional and must still work — do not require same-provider CLI
      // session inheritance for that path.
      //
      // The block below opportunistically upgrades a Chat Fork to session
      // inheritance when the source is the same provider AND that provider is
      // fork-capable. Anything else stays a soft handoff — it must never
      // reject the send. Keep this distinction in mind before extending it.
      let forkSourceSessionId: string | undefined;
      if (
        !this._hasStartedSession &&
        this.messages.length === 0 &&
        this.resumedFromConversationId
      ) {
        const source = getConversation(this.resumedFromConversationId);
        if (!source) {
          this.rejectFork(
            `Cannot fork: source conversation ${this.resumedFromConversationId} is not loaded`
          );
          return;
        }
        // Session inheritance needs BOTH the same provider AND a harness that
        // can fork (claude/opencode sessionForkFlags, codex/gemini
        // emulateFork). muse and cursor have neither.
        //
        // Bug (2026-08-20): muse -> muse Chat Fork died with `Harness "muse"
        // does not support fork.` while muse -> claude and claude -> muse
        // worked — only the same-provider branch reached prepareSession, so
        // the fork-incapable harness was never checked. Capability, not
        // provider equality, decides the path.
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
          // Soft handoff via string context (draft/first message), not provider
          // session inheritance. This is intentional — the whole goal of Fork
          // is to inject prior convo as string context across clients.
          const memoryDetail = memoryGenerationMatches
            ? ''
            : ', memory generation changed so native session inheritance is disabled';
          console.log(
            `[${this.id}] Soft fork ${source.provider} -> ${this.provider} (${source.provider === this.provider ? 'harness cannot fork sessions' : 'cross-provider'}${memoryDetail}), using string context handoff (no provider session fork)`
          );
        } else {
          if (!source.hasStartedSession()) {
            this.rejectFork('Cannot fork: the source conversation has no provider session yet');
            return;
          }
          forkSourceSessionId = source.sessionId;
        }
      }
      // Worded here, at admission (a queued Buddy turn may have waited for a
      // run slot), after the audience check above may have rotated the
      // provider session, and by the same decision spawnForMessage resumes on:
      // a fresh session always gets `fresh`.
      const content = this.resumesProviderSession(forkSourceSessionId)
        ? prompt.resumed
        : prompt.fresh;

      this._prepareTurnAttempt();
      const executionConfig = this.preflightExecution();
      if (!executionConfig) return;

      // UI/history retain clean user text. Buddy turns receive current bounded
      // context; the persisted first-turn snapshot is historical evidence only.
      // When provider-session inheritance ran above, skip first-turn briefing /
      // pasted-context prefixes — the CLI already has the source transcript.
      // Soft Chat Forks (no forkSourceSessionId) keep the policy's prompt.
      const cliContent =
        forkSourceSessionId && !refreshBriefing
          ? content
          : this._policy.providerPrompt({
              content,
              messageCount: this.messages.length,
              hasStartedSession: this._hasStartedSession,
              refreshBriefing,
            });

      // Add user message to history (clean content for UI)
      const userMessage: Message = {
        role: 'user',
        content: content,
        timestamp: new Date(),
      };
      this.messages.push(userMessage);

      // Broadcast user message to clients (clean content)
      this.broadcastMessage({
        type: 'message',
        role: 'user',
        content: content,
        conversationId: this.id,
      });

      this._policy.admitted(input, content);
      // Owner workflow guidance lives in the native MCP tool descriptions.
      // Appending it here pollutes every provider input and its saved transcript.
      // Spawn with input provenance supplied by the host producer, never transcript text.
      this.spawnForMessage(cliContent, executionConfig, forkSourceSessionId, input);
    }

    private rejectFork(message: string): void {
      console.error(`[${this.id}] ${message}`);
      this.messages.push({ role: 'system', content: message, timestamp: new Date() });
      this.broadcastMessage({
        type: 'message',
        role: 'system',
        content: message,
        conversationId: this.id,
      });
      broadcast({
        type: 'conversations_updated',
        conversations: [this.toJSON()],
      });
    }

    private preflightExecution(): ResolvedExecutionConfig | undefined {
      // Resolve immediately before any message or queue mutation.
      // Catalog changes may affect defaults without changing durable intent.
      const resolution = this.refreshConfigResolution();
      if (resolution.status === 'resolved') {
        try {
          // This is a configuration admission rule, not a provider process
          // failure. Checking it here keeps a queued message retryable and
          // prevents the synchronous throw in spawnForMessage from leaving the
          // queue's head permanently marked as "sending".
          this._policy.preflight(resolution.value.provider);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[${this.id}] ${errorMessage}`);
          this.messages.push({
            role: 'system',
            content: errorMessage,
            timestamp: new Date(),
            completionReason: 'error',
          });
          if (this.turnQueue.releaseHead()) this.broadcastQueue();
          broadcast({
            type: 'conversation_updated',
            reason: 'config',
            conversation: this.toJSON(),
          });
          this._finishTurnAttempt('failed', 'spawn_failed');
          this.emit('buddy-turn-failed', errorMessage);
          return undefined;
        }
        return resolution.value;
      }

      const errorMessage = `Configuration unavailable: ${resolution.error.message}`;
      console.error(`[${this.id}] ${errorMessage}`);
      this.messages.push({
        role: 'system',
        content: errorMessage,
        timestamp: new Date(),
        completionReason: 'error',
      });
      if (this.turnQueue.releaseHead()) this.broadcastQueue();
      broadcast({
        type: 'conversation_updated',
        reason: 'config',
        conversation: this.toJSON(),
      });
      // Preflight has no child process and therefore no later completion event.
      // Terminalise and notify here, at the single point that owns the error,
      // so an automation's runTurn promise cannot wait until its outer timeout.
      // See agent_notes/2026-08-24_automation-execution-ownership-design.md.
      this._finishTurnAttempt('failed', 'spawn_failed');
      this.emit('buddy-turn-failed', errorMessage);
      return undefined;
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
      this._clearTurnWatchdogs();
      if (!this.process) return;
      this._stopCause = reason;
      if (this._activeAttemptId) {
        turnAttempts.stopping(this._activeAttemptId);
        if (reason === 'server_restart') {
          this._finishTurnAttempt('interrupted', 'server_restart');
        }
      }

      const proc = this.process;
      const stopTurn = this._activeTurnStop;
      // CRITICAL: Don't set isRunning here. The 'close' handler does that.
      // This ensures atomicity: process exits → state updated → queue dequeued →
      // processQueue() spawns next. If we set state here, processQueue could fire
      // while the old process is still alive, and spawnForMessage's isRunning
      // guard would silently drop the queued message.
      stopTurn?.('SIGTERM');
      this._policy.ended({ t: 'cancelled' });

      const killTimer = setTimeout(() => {
        if (proc.exitCode === null) {
          console.warn(`[${this.id}] Process did not exit after SIGTERM, sending SIGKILL`);
          stopTurn?.('SIGKILL');
        }
      }, 3000);

      proc.once('close', () => clearTimeout(killTimer));
    }

    // Reset process for fresh context (used in loop with clearContext).
    // Generates new CLI session ID while keeping conversation ID for UI continuity.
    // The per-run token invalidates every late event/completion from the old handle.
    resetProcess(): void {
      this._clearTurnWatchdogs();
      if (this.process) {
        const oldProcess = this.process;
        const stopTurn = this._activeTurnStop;
        this._finishTurnAttempt('interrupted', 'process_killed');
        this._runToken += 1;
        stopTurn?.('SIGTERM');
        const killTimer = setTimeout(() => {
          if (oldProcess.exitCode === null) {
            console.warn(`[${this.id}] Reset process did not exit after SIGTERM, sending SIGKILL`);
            stopTurn?.('SIGKILL');
          }
        }, TURN_TIMEOUT_KILL_GRACE_MS);
        oldProcess.once('close', () => clearTimeout(killTimer));
        this.process = null;
        this._activeTurnStop = null;
        this.isStreaming = false;
        this.isRunning = false;
        this.broadcastStatus();
      }
      // Generate new session ID for fresh context
      const oldSessionId = this.sessionId;
      this.sessionId = createSessionId();
      this._policy.sessionReset();
      // A reset starts an empty provider context. Carrying the old session's
      // token count forward would show a full meter on a fresh thread.
      this.providerUsage = null;
      this._providerUsageDirty = false;
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

    private _startTurnWatchdogs(): void {
      this._watchdog.start();
      this._stopSwarmWatch?.();
      this._stopSwarmWatch = watchSwarmRuns(
        swarmObservers,
        this.workingDirectory,
        this.subAgentHost
      );
    }

    private _noteTurnActivity(event: UnifiedAgentEvent): void {
      if (!this.isRunning) return;
      const now = Date.now();
      const activity = turnAttemptActivityFromEvent(event);
      this._lastObservedTurnActivity = activity;
      if (
        this._activeAttemptId &&
        (now - this._lastAttemptActivityAt >= ATTEMPT_ACTIVITY_INTERVAL_MS ||
          this._lastAttemptActivitySource !== activity.source)
      ) {
        this._lastAttemptActivityAt = now;
        this._lastAttemptActivitySource = activity.source;
        turnAttempts.activity(this._activeAttemptId, activity, this.sessionId);
      }
      this._watchdog.note(event);
      swarmObservers.poke(this.workingDirectory);
    }

    private _clearTurnWatchdogs(): void {
      this._stopSwarmWatch?.();
      this._stopSwarmWatch = null;
      this._watchdog.clear();
    }

    expireCoordinationRun(): void {
      this._handleTurnTimeout('max');
    }

    private _handleTurnTimeout(kind: TurnTimeoutKind): void {
      if (!this.process || !this.isRunning) return;
      this._policy.revoke();
      const idle = this._watchdog.idle();
      const sawMeaningfulOutput = this._sawMeaningfulProviderOutputThisRun;
      const timeout = describeTurnTimeout(kind, { ...idle, sawMeaningfulOutput });
      const lastActivity = this._lastObservedTurnActivity;

      console.error(
        `[${this.id}] ${timeout.message} | timeoutKind=${kind} terminalCause=${timeout.terminalCause} sawMeaningfulOutput=${sawMeaningfulOutput} elapsed=${idle.elapsedSeconds}s bridgeIdle=${idle.bridgeIdleSeconds}s providerIdle=${idle.providerIdleSeconds}s lastActivitySource=${lastActivity?.source ?? 'none'} lastProviderEvent=${lastActivity?.providerEventType ?? 'none'} stderr=${this._stderrBuffer.length > 0 ? 'yes' : 'no'}`
      );
      this._clearTurnWatchdogs();
      this.surfaceError(timeout.message);
      this._finishTurnAttempt('failed', timeout.terminalCause);

      const completedAt = new Date();
      const lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg?.role === 'assistant' && !lastMsg.completedAt) {
        lastMsg.completedAt = completedAt;
        lastMsg.completionReason = 'error';
      }
      failRunningSubAgents(this.subAgents, completedAt);
      // Commit buffered text before status:false makes the client discard its
      // transient streaming buffer, then publish the authoritative transcript.
      this.broadcastChunk({
        type: 'message_complete',
        conversationId: this.id,
        reason: 'error',
      });
      this.isStreaming = false;
      this.isRunning = false;
      clearExternalRunningStatus(this.id, this.sessionId);
      markLocalCompletionSuppression(this.id, this.sessionId);
      this.broadcastStatus();
      broadcast({
        type: 'conversations_updated',
        conversations: [this.toJSON()],
      });
      // Mark turn as cleanly completed so the close handler (triggered by SIGTERM
      // below) takes the fast path and doesn't emit a duplicate system message.
      this._turnCompletedCleanly = true;
      this._policy.ended({ t: 'failed', detail: timeout.message });
      this.emit('buddy-turn-failed', timeout.message);

      const proc = this.process;
      const stopTurn = this._activeTurnStop;
      stopTurn?.('SIGTERM');
      const killTimer = setTimeout(() => {
        if (proc.exitCode === null) {
          console.warn(`[${this.id}] Timeout kill escalation: sending SIGKILL`);
          stopTurn?.('SIGKILL');
        }
      }, TURN_TIMEOUT_KILL_GRACE_MS);
      proc.once('close', () => clearTimeout(killTimer));
    }

    broadcastChunk(data: ChunkData | MessageCompleteData): void {
      broadcast(data);
    }

    broadcastMessage(data: MessageData): void {
      broadcast(data);
    }

    broadcastStatus(): void {
      broadcast({
        type: 'status',
        conversationId: this.id,
        isRunning: this.isRunning,
        isStreaming: this.isStreaming,
      });
    }

    broadcastQueue(): void {
      broadcast({
        type: 'queue_updated',
        conversationId: this.id,
        queue: this.queue,
      });
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
      const attemptId = crypto.randomUUID();
      turnAttempts.queued({
        attemptId,
        conversationId: this.id,
        queueMessageId: message.id,
        providerSessionId: this.sessionId,
      });
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
      this._cancelQueuedAttempt(removed);
      this.broadcastQueue();
    }

    /**
     * Clear all pending messages from the queue. Messages currently sending are kept.
     */
    clearQueue(): void {
      const removed = this.turnQueue.clearPending();
      for (const entry of removed) this._cancelQueuedAttempt(entry);
      if (this.turnQueue.length === 0) this._policy.queueEmptied();
      console.log(`[${this.id}] Cleared queue: removed ${removed.length} messages`);
      this.broadcastQueue();
    }

    /**
     * Process the next queued message if the conversation is idle.
     * Called from: close handler (after process exits), enqueueMessage (new message).
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

      if (!next.attemptId) {
        next.attemptId = crypto.randomUUID();
        turnAttempts.queued({
          attemptId: next.attemptId,
          conversationId: this.id,
          queueMessageId: next.message.id,
          providerSessionId: this.sessionId,
        });
      }
      this._nextAttempt = { attemptId: next.attemptId, queueMessageId: next.message.id };
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
      await this._activeTurnDrain;
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
      const lastResolved =
        this.configResolution.status === 'resolved'
          ? this.configResolution.value
          : this.configResolution.lastResolved;
      this.configResolution = resolveConfigAgainstProviderCatalog(this.config, lastResolved);
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
        // `buddyContext` is deliberately NOT serialized. On this object it is a
        // getter over `kind` (buddyContextFromKind), so the wire copy repeated
        // the same fields for every Buddy thread — 550 KB of a 2.4 MB `init`
        // with 937 of 1,123 conversations being Buddy threads (2026-09-25).
        // Every reader goes through shared `getBuddyContext()`, which derives
        // from `kind` whenever kind is 'buddy' and ignores the wire field, and
        // `kind` is required by ConversationSchema. The schema keeps
        // `buddyContext` nullish, so an older client and a not-yet-reloaded
        // older server (which still sends it) both keep parsing.
        kind: this.kind,
        purpose: this.purpose,
        placement: this.placement,
        providerUsage: this.providerUsage,
      };
    }
  };
}
