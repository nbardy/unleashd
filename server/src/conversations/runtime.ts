import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {
  type ExecuteCommandRequest,
  type UnifiedAgentEvent,
  executeCommand,
  harnessSupportsMcp,
} from '@nbardy/agent-cli';
import type {
  BuddyContext,
  ConfigResolution,
  ConversationConfig,
  ConversationConfigState,
  Conversation as ConversationData,
  ConversationKind,
  ConversationPurpose,
  Message,
  ModelId,
  OompaRuntimeSnapshot,
  Provider as ProviderName,
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
  mergeReviewDocPath,
  providerSupportsFork,
} from '@unleashd/shared';
import { formatToolUse, isCompletionOnlyToolUse } from '../adapters/tool-format';
import { BUDDY_BUILDER_BRIEFING } from '../buddies/builder';
import { buddyBuilderMcpServers, buddyMcpServers } from '../buddies/mcp-config';
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
import type { ProviderEvent } from '../providers';
import { resolveConfigAgainstProviderCatalog } from '../providers/catalog-service';
import {
  extractCodexCollabToolInput,
  getCodexSubagentCurrentAction,
  getSubagentDescription,
  isCodexCollabToolName,
  isSubagentSpawnTool,
  isTerminalSubagentStatus,
  normalizeCodexSubagentStatus,
} from '../subagent-tools';

export type MergeParentMeta = {
  children: Array<{
    sourceConversationId: string;
    childConversationId: string;
    reviewUuid: string;
    childWorkingDirectory: string;
  }>;
  prefixInjected: boolean;
};

export type MergeChildMeta = {
  parentConversationId: string;
  reviewUuid: string;
};

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
export type ConversationBroadcast = ServerMessage | ChunkData | MessageCompleteData | MessageData;

export interface ConversationRuntimeView {
  id: string;
  sessionId: string;
  config: ConversationConfig;
  readonly provider: ProviderName;
  buddyContext: BuddyContext | null;
  kind: ConversationKind;
  isRunning: boolean;
  toJSON(): ConversationData;
}

export interface ConversationRuntimeDependencies {
  broadcast(data: ConversationBroadcast): void;
  registerSessionAlias(sessionId: string | null | undefined, conversationId: string): void;
  unregisterSessionAlias(
    sessionId: string | null | undefined,
    options?: { keepKnown?: boolean }
  ): void;
  clearExternalRunningStatus(...ids: Array<string | null | undefined>): void;
  clearLocalCompletionSuppression(...ids: Array<string | null | undefined>): void;
  markLocalCompletionSuppression(...ids: Array<string | null | undefined>): void;
  persistCurrentSession(conversation: ConversationRuntimeView, sessionId: string): Promise<void>;
  updateBuddyStatus(
    conversation: ConversationRuntimeView,
    status: 'active' | 'complete' | 'failed' | 'cancelled'
  ): void;
  settleBuddyDelegation(
    conversation: ConversationRuntimeView,
    status: 'complete' | 'failed' | 'cancelled',
    outcome?: string
  ): void;
  getConversation(id: string):
    | {
        isRunning: boolean;
        provider: ProviderName;
        sessionId: string;
        hasStartedSession(): boolean;
      }
    | undefined;
  readLatestOompaRuntime(projectRoot: string): OompaRuntimeSnapshot;
  createSessionId(): string;
  turnAttempts?: RuntimeTurnAttemptObserver;
}

const VERBOSE = process.env.VERBOSE === '1' || process.argv.includes('--verbose');
const AGENT_CLI_DEBUG_EVENTS = process.env.AGENT_CLI_DEBUG_EVENTS === '1';
const LOG_CONTENT_PREVIEW_CHARS = 140;
const ATTEMPT_ACTIVITY_INTERVAL_MS = 5_000;

export type TurnTimeoutKind = 'bridge' | 'provider' | 'max';

const AGENT_CLI_HEARTBEAT_SOURCE = 'agent-cli.heartbeat';
const AGENT_CLI_NATIVE_SESSION_SOURCE = 'agent-cli.native-session';

export function isProviderProgressEvent(event: UnifiedAgentEvent): boolean {
  if (
    event.type === 'progress' &&
    event.source === AGENT_CLI_HEARTBEAT_SOURCE &&
    event.data?.nativeSessionAdvanced === true
  ) {
    return true;
  }
  return !(event.type === 'progress' && event.source === AGENT_CLI_HEARTBEAT_SOURCE);
}

export function assertBuddyProviderSupportsMcp(provider: ProviderName): void {
  if (harnessSupportsMcp(provider)) return;
  throw new Error(
    `Provider "${provider}" cannot start Buddy conversations because its harness has no MCP support for required Buddy state tools.`
  );
}

export function turnAttemptActivityFromEvent(event: UnifiedAgentEvent): TurnAttemptActivity {
  if (event.type === 'progress' && event.source === AGENT_CLI_HEARTBEAT_SOURCE) {
    const unifiedEventSilentSeconds = nonnegativeFiniteNumber(
      event.data?.unifiedEventSilentSeconds
    );
    const rawStdoutSilentSeconds = nonnegativeFiniteNumber(event.data?.rawStdoutSilentSeconds);
    const phase =
      event.data?.phase === 'startup' || event.data?.phase === 'running'
        ? event.data.phase
        : undefined;
    const nativeSessionAdvanced = event.data?.nativeSessionAdvanced === true;
    const nativeSessionAvailable =
      typeof event.data?.nativeSessionAvailable === 'boolean'
        ? event.data.nativeSessionAvailable
        : undefined;
    const nativeSessionSilentSeconds = nonnegativeFiniteNumber(
      event.data?.nativeSessionSilentSeconds
    );
    const stdoutStreamEvent =
      event.data?.stdoutStreamEvent === 'attached' ||
      event.data?.stdoutStreamEvent === 'resume' ||
      event.data?.stdoutStreamEvent === 'pause' ||
      event.data?.stdoutStreamEvent === 'close'
        ? event.data.stdoutStreamEvent
        : undefined;
    const stdoutReadableFlowing =
      typeof event.data?.stdoutReadableFlowing === 'boolean' ||
      event.data?.stdoutReadableFlowing === null
        ? event.data.stdoutReadableFlowing
        : undefined;
    const stdoutReadableLengthBytes = nonnegativeFiniteNumber(
      event.data?.stdoutReadableLengthBytes
    );
    const nativeSessionSizeBytes = nonnegativeFiniteNumber(event.data?.nativeSessionSizeBytes);
    return {
      source: nativeSessionAdvanced ? 'native_session' : 'agent_cli_heartbeat',
      providerEventType: event.type,
      providerEventSource: event.source,
      heartbeat: {
        ...(unifiedEventSilentSeconds !== undefined ? { unifiedEventSilentSeconds } : {}),
        ...(rawStdoutSilentSeconds !== undefined ? { rawStdoutSilentSeconds } : {}),
        ...(phase ? { phase } : {}),
        ...(stdoutStreamEvent ? { stdoutStreamEvent } : {}),
        ...(stdoutReadableFlowing !== undefined ? { stdoutReadableFlowing } : {}),
        ...(stdoutReadableLengthBytes !== undefined ? { stdoutReadableLengthBytes } : {}),
        ...(nativeSessionAvailable !== undefined ? { nativeSessionAvailable } : {}),
        ...(nativeSessionAdvanced ? { nativeSessionAdvanced: true } : {}),
        ...(nativeSessionSilentSeconds !== undefined ? { nativeSessionSilentSeconds } : {}),
        ...(nativeSessionSizeBytes !== undefined ? { nativeSessionSizeBytes } : {}),
      },
    };
  }
  if (event.type === 'progress' && event.source === AGENT_CLI_NATIVE_SESSION_SOURCE) {
    return {
      source: 'native_session',
      providerEventType: event.type,
      providerEventSource: event.source,
    };
  }
  return {
    source: 'provider_event',
    providerEventType: event.type,
    ...(event.type === 'progress' ? { providerEventSource: event.source } : {}),
  };
}

export function describeTurnTimeout(
  kind: TurnTimeoutKind,
  input: {
    elapsedSeconds: number;
    bridgeIdleSeconds: number;
    providerIdleSeconds: number;
    sawMeaningfulOutput: boolean;
  }
): {
  terminalCause: 'bridge_timeout' | 'provider_idle_timeout' | 'max_runtime_timeout';
  message: string;
} {
  const outputDetail = input.sawMeaningfulOutput
    ? ''
    : ' (no assistant text or tool output reached Unleashd)';
  if (kind === 'bridge') {
    return {
      terminalCause: 'bridge_timeout',
      message: `Turn event bridge stalled: no unified event or bridge heartbeat for ${input.bridgeIdleSeconds}s${outputDetail}`,
    };
  }
  if (kind === 'provider') {
    return {
      terminalCause: 'provider_idle_timeout',
      message: `Turn stalled: no provider event or native-session advancement for ${input.providerIdleSeconds}s${outputDetail}`,
    };
  }
  return {
    terminalCause: 'max_runtime_timeout',
    message: `Turn reached its maximum runtime after ${input.elapsedSeconds}s${outputDetail}`,
  };
}

function nonnegativeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

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
  existingSessionId?: string;
  isWorker?: boolean;
  swarmId?: string | null;
  workerId?: string | null;
  workerRole?: 'work' | 'review' | 'fix' | null;
  parentConversationId?: string | null;
  resumedFromConversationId?: string | null;
  modelName?: string | null;
  swarmDebugPrefix?: string | null;
  buddyContext?: BuddyContext | null;
  buddyBriefing?: string | null;
  purpose?: ConversationPurpose;
  kind?: ConversationKind | null;
  mergeParentMeta?: MergeParentMeta | null;
  mergeChildMeta?: MergeChildMeta | null;
}

export interface ConversationRuntime extends EventEmitter, ConversationRuntimeView {
  messages: Message[];
  process: ChildProcess | null;
  isStreaming: boolean;
  createdAt: Date;
  workingDirectory: string;
  configRevision: number;
  configResolution: ConfigResolution;
  isWorker: boolean;
  swarmId: string | null;
  workerId: string | null;
  workerRole: 'work' | 'review' | 'fix' | null;
  parentConversationId: string | null;
  resumedFromConversationId: string | null;
  modelName: string | null;
  swarmDebugPrefix: string | null;
  mergeParentMeta: MergeParentMeta | null;
  mergeChildMeta: MergeChildMeta | null;
  purpose: ConversationPurpose;
  subAgents: SubAgent[];
  queue: QueuedMessage[];
  readonly provider: ProviderName;
  readonly model: ModelId | undefined;
  readonly reasoningEffort: string | undefined;
  sendMessage(content: string): void;
  spawnMergeReviewFork(content: string, forkSourceSessionId: string): void;
  stop(reason?: 'user_stop' | 'server_restart'): void;
  resetProcess(): void;
  enqueueMessage(content: string): void;
  interruptAndSend(content: string): void;
  cancelQueuedMessage(messageId: string): void;
  clearQueue(): void;
  processQueue(): void;
  hasActiveProcess(): boolean;
  hasStartedSession(): boolean;
  applyConfigState(state: ConversationConfigState): void;
  refreshConfigResolution(): ConfigResolution;
  canChangeProvider(): boolean;
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

export function buildFirstTurnCliContent(input: {
  content: string;
  messageCount: number;
  hasStartedSession: boolean;
  kind?: ConversationKind | null;
  buddyContext?: BuddyContext | null;
  buddyBriefing: string | null;
  swarmDebugPrefix: string | null;
  purpose?: ConversationPurpose;
}): string {
  const firstUnstartedTurn = input.messageCount === 0 && !input.hasStartedSession;
  const effectiveKind: ConversationKind =
    input.kind ??
    conversationKindFromLegacy({
      buddyContext: input.buddyContext ?? null,
      purpose: input.purpose ?? null,
      kind: null,
    });
  // Thin dispatcher δ — one clean handler per kind (D1, R1). Each handler has one semantic path.
  // New sessions must not rely on hidden HTML comments; kind is canonical. The comment
  // format is kept here for CLI backward compat but disk hydration no longer parses it for new writes.
  return matchConversationKind(effectiveKind, {
    buddy: (k) => {
      if (!firstUnstartedTurn || input.buddyBriefing === null) return input.content;
      const ctx: BuddyContext = buddyContextFromKind(k);
      const encodedContext = Buffer.from(JSON.stringify(ctx), 'utf8').toString('base64url');
      return `<!-- unleashd:buddy-context-v2 ${encodedContext} ${input.buddyBriefing.length} -->\n${input.buddyBriefing}\n<!-- /unleashd:buddy-context-v2 -->\n\n${input.content}`;
    },
    buddy_builder: () => {
      if (!firstUnstartedTurn) return input.content;
      return `<!-- unleashd:buddy-builder-v1 ${BUDDY_BUILDER_BRIEFING.length} -->\n${BUDDY_BUILDER_BRIEFING}\n<!-- /unleashd:buddy-builder-v1 -->\n\n${input.content}`;
    },
    general: () => {
      if (input.swarmDebugPrefix !== null && firstUnstartedTurn) {
        return `<!-- unleashd:swarm-prefix -->\n${input.swarmDebugPrefix}\n<!-- /unleashd:swarm-prefix -->\n\n${input.content}`;
      }
      return input.content;
    },
  });
}

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
    updateBuddyStatus: updateBuddyConversationLink,
    settleBuddyDelegation,
    getConversation,
    readLatestOompaRuntime,
    createSessionId,
    turnAttempts = NOOP_TURN_ATTEMPT_OBSERVER,
  } = dependencies;

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
    // See shared FORK_CAPABLE_PROVIDERS comment for the two "fork" concepts.
    resumedFromConversationId: string | null;
    // Full model name from CLI (e.g., "claude-sonnet-4-5-20250929") — more specific than provider.
    modelName: string | null;
    // Debug prefix for swarm conversations — prepended to first CLI message.
    // Stays on the object (never cleared) so toJSON() includes it for client rendering.
    swarmDebugPrefix: string | null;
    kind: ConversationKind;
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
    // Hidden first-turn context. Never serialized to clients; the typed
    // buddyContext is the durable/UI-facing metadata.
    private _buddyBriefing: string | null;
    // Merge feature: set on a "parent" thread that aggregates review docs from
    // N forked children. Children have mergeChildMeta instead.
    mergeParentMeta: MergeParentMeta | null;
    mergeChildMeta: MergeChildMeta | null;
    // Sub-agent tracking
    subAgents: SubAgent[];
    // Server-owned message queue — persists across client navigation/refresh.
    // Client mirrors this state via queue_updated broadcasts.
    queue: QueuedMessage[];
    // Track pending tool_use blocks that might be Task tools
    private _pendingTaskTools: Map<string, { id: string; startedAt: Date }>;
    // Track if we've started a CLI session (for --resume vs --session-id)
    private _hasStartedSession: boolean;
    // Buffer stderr for this process run so silent failures can be surfaced to UI.
    private _stderrBuffer: string;
    // Tracks whether assistant text or a tool event reached the unified stream.
    private _sawMeaningfulProviderOutputThisRun: boolean;
    // Start time of the current CLI process run (for duration tracking).
    private _processStartTime = 0;
    // Bridge activity and provider progress are intentionally independent.
    // A synthetic wrapper heartbeat proves transport health but not that the
    // provider is making progress.
    private _lastBridgeEventAt = 0;
    private _lastProviderProgressAt = 0;
    // Per-turn watchdog timers.
    private _turnBridgeTimer: NodeJS.Timeout | null = null;
    private _turnProviderIdleTimer: NodeJS.Timeout | null = null;
    private _turnMaxTimer: NodeJS.Timeout | null = null;
    // Track last known swarm run ID to detect newly launched swarms.
    private _lastSwarmRunId: string | null = null;
    // Whether _lastSwarmRunId was explicitly baselined for the current turn.
    // Distinguishes "no baseline yet" from "baseline exists and no prior run".
    private _hasSwarmBaseline = false;
    // Throttle _pollForNewSwarms() — synchronous fs I/O called from _noteTurnActivity().
    private _lastSwarmPollAt = 0;
    // Periodic swarm poller running during active turns (catches launches that happen
    // after the last text/tool event).
    private _swarmPollTimer: NodeJS.Timeout | null = null;
    // When true, message_complete already performed state cleanup (isStreaming/isRunning/broadcast).
    // The close handler checks this to skip redundant work on normal completion, while still
    // running full cleanup on crash/kill/error paths where message_complete never fired.
    private _turnCompletedCleanly = false;
    private _activeAttemptId: string | null = null;
    private _nextAttempt: { attemptId: string; queueMessageId?: string } | null = null;
    private _queuedAttemptIds = new Map<string, string>();
    private _terminalCauseHint: TurnTerminalCause | null = null;
    private _stopCause: 'user_stop' | 'server_restart' | null = null;
    private _lastAttemptActivityAt = 0;
    private _lastAttemptActivitySource: TurnActivitySource | null = null;
    private _lastObservedTurnActivity: TurnAttemptActivity | null = null;
    private _runToken = 0;
    private _activeTurnStop: ((signal?: NodeJS.Signals) => void) | null = null;

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
        swarmDebugPrefix = null,
        buddyContext = null,
        buddyBriefing = null,
        purpose = 'general',
        kind = null,
        mergeParentMeta = null,
        mergeChildMeta = null,
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
      // Canonical kind — derive from legacy when absent (migration on load).
      this.kind =
        kind ??
        conversationKindFromLegacy({
          buddyContext: buddyContext ?? null,
          purpose: purpose ?? null,
          kind: null,
        });
      const isBuddyConversation = isBuddyKind(this.kind);
      this.isWorker = isBuddyConversation ? false : isWorker;
      this.swarmId = isBuddyConversation ? null : swarmId;
      this.workerId = isBuddyConversation ? null : workerId;
      this.workerRole = isBuddyConversation ? null : workerRole;
      this.parentConversationId = parentConversationId;
      this.resumedFromConversationId = resumedFromConversationId;
      this.modelName = modelName;
      this.swarmDebugPrefix = isBuddyConversation ? null : swarmDebugPrefix;
      this._buddyBriefing = buddyBriefing;
      this.mergeParentMeta = mergeParentMeta;
      this.mergeChildMeta = mergeChildMeta;
      this.subAgents = [];
      this.queue = [];
      this._pendingTaskTools = new Map();
      // Mark session as started if loading existing (use --resume for next message)
      this._hasStartedSession = existingSessionId !== undefined;
      this._stderrBuffer = '';
      this._sawMeaningfulProviderOutputThisRun = false;
      this._lastSwarmRunId = null;
      this._hasSwarmBaseline = false;
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
      if (!this._activeAttemptId) return;
      turnAttempts.terminal({
        attemptId: this._activeAttemptId,
        state,
        terminalCause,
        providerSessionId: this.sessionId,
      });
      for (const [queueMessageId, attemptId] of this._queuedAttemptIds) {
        if (attemptId === this._activeAttemptId) {
          this._queuedAttemptIds.delete(queueMessageId);
        }
      }
      this._activeAttemptId = null;
      this._terminalCauseHint = null;
      this._stopCause = null;
    }

    private _cancelQueuedAttempt(queueMessageId: string): void {
      const attemptId = this._queuedAttemptIds.get(queueMessageId);
      if (!attemptId) return;
      turnAttempts.terminal({
        attemptId,
        state: 'cancelled',
        terminalCause: 'user_stop',
        providerSessionId: this.sessionId,
      });
      this._queuedAttemptIds.delete(queueMessageId);
    }

    private spawnForMessage(
      content: string,
      executionConfig: ResolvedExecutionConfig,
      forkSourceSessionId?: string
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
      const shouldResume = !forking && this._hasStartedSession;
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
      this._primeSwarmBaseline();
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

      // Per-provider narrowing: ExecuteCommandRequest is a discriminated union
      // keyed on `harness`. Reasoning effort is a pass-through string — the
      // Configuration validation rejects any level not accepted by the target
      // provider before we get here. The submodule
      // harness wraps the string in the correct CLI flag.
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
        const buddyServers = matchConversationKind(this.kind, {
          buddy: (kind) => buddyMcpServers(buddyContextFromKind(kind), this.id),
          buddy_builder: () => buddyBuilderMcpServers(this.id),
          general: () => undefined,
        });
        if (buddyServers) assertBuddyProviderSupportsMcp(executionConfig.provider);
        const buddyRequest = buddyServers ? { mcpServers: buddyServers } : {};

        turn = executeCommand(
          executionConfig.provider === 'claude'
            ? {
                harness: 'claude',
                ...baseRequest,
                reasoningEffort: executionConfig.reasoningEffort,
                ...buddyRequest,
              }
            : executionConfig.provider === 'codex'
              ? {
                  harness: 'codex',
                  ...baseRequest,
                  reasoningEffort: executionConfig.reasoningEffort,
                  ...buddyRequest,
                }
              : executionConfig.provider === 'muse'
                ? {
                    harness: 'muse',
                    ...baseRequest,
                    reasoningEffort: executionConfig.reasoningEffort,
                    ...buddyRequest,
                  }
                : ({
                    harness: executionConfig.provider,
                    ...baseRequest,
                    ...buddyRequest,
                  } as ExecuteCommandRequest)
        );
      } catch (error) {
        this._finishTurnAttempt('failed', 'spawn_failed');
        throw error;
      }

      this.process = turn.child;
      this._activeTurnStop = turn.stop;
      this.isRunning = true;
      if (this._activeAttemptId) {
        turnAttempts.running(this._activeAttemptId, this.sessionId);
      }
      updateBuddyConversationLink(this, 'active');
      this.emit('buddy-turn-started');
      this._hasStartedSession = true; // Mark session as started for next message
      this._startTurnWatchdogs();
      this.broadcastStatus();

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
              await persistCurrentConversationSession(this, event.sessionId);
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
            case 'text.delta': {
              this._sawMeaningfulProviderOutputThisRun = true;
              this.handleOutput({ type: 'text_delta', text: event.text });
              break;
            }
            case 'tool.use': {
              this._sawMeaningfulProviderOutputThisRun = true;
              this.handleOutput({
                type: 'tool_use',
                name: event.name,
                input: event.input,
                displayText: event.displayText,
              });
              break;
            }
            case 'turn.complete': {
              this.handleOutput({ type: 'message_complete', reason: event.reason });
              break;
            }
            case 'out_of_tokens': {
              this._terminalCauseHint = 'out_of_tokens';
              this.handleOutput({
                type: 'error',
                message: normalizeProviderErrorMessage(event.message),
              });
              break;
            }
            case 'error': {
              this._terminalCauseHint = 'provider_error';
              this.handleOutput({
                type: 'error',
                message: normalizeProviderErrorMessage(event.message),
              });
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
            default:
              break;
          }
        }
      };

      void consumeEvents().catch((err: unknown) => {
        if (runToken !== this._runToken) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${this.id}] Event stream error: ${message}`);
        this._terminalCauseHint = 'provider_error';
        this.handleOutput({ type: 'error', message: normalizeProviderErrorMessage(message) });
      });

      void turn.completed
        .then(async ({ exitCode, signal, sessionId, reason }) => {
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

          const durationMs = Date.now() - this._processStartTime;
          console.log(
            `[${this.id}] Process closed with code ${exitCode} signal=${signal ?? 'none'} (reason=${reason}) after ${durationMs}ms`
          );

          // message_complete already handled state cleanup and broadcast.
          // Just null the process ref, dequeue, and continue.
          if (this._turnCompletedCleanly) {
            this.process = null;
            this._activeTurnStop = null;
            this._pendingTaskTools.clear();
            clearExternalRunningStatus(this.id, this.sessionId);
            markLocalCompletionSuppression(this.id, this.sessionId);
            if (this.queue.length > 0 && this.queue[0].status === 'sending') {
              this.queue.shift();
              this.broadcastQueue();
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
          // Clear pending task tools — message_complete handles the normal path, but
          // kills/crashes skip it, leaving stale entries that accumulate across runs.
          this._pendingTaskTools.clear();
          // Suppress external-running detection for trailing disk writes from this
          // just-finished local run. Also clear any stale external flag immediately.
          clearExternalRunningStatus(this.id, this.sessionId);
          markLocalCompletionSuppression(this.id, this.sessionId);
          this.broadcastStatus();
          updateBuddyConversationLink(this, reason === 'killed' ? 'cancelled' : 'failed');
          settleBuddyDelegation(this, reason === 'killed' ? 'cancelled' : 'failed', reason);
          this.emit('buddy-turn-failed', reason);
          // Dequeue the "sending" message (completed or crashed) and process next.
          // This is the SINGLE code path for dequeue — not split between
          // message_complete and close. Handles both success and crash.
          if (this.queue.length > 0 && this.queue[0].status === 'sending') {
            this.queue.shift();
            this.broadcastQueue();
          }
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
          this.handleOutput({ type: 'error', message: normalizeProviderErrorMessage(message) });
          this.isStreaming = false;
          this.isRunning = false;
          this.process = null;
          this._activeTurnStop = null;
          this._pendingTaskTools.clear();
          this.broadcastStatus();
          updateBuddyConversationLink(this, 'failed');
          settleBuddyDelegation(this, 'failed', message);
          this.emit('buddy-turn-failed', message);
          if (this.queue.length > 0) {
            const removed = this.queue.length;
            for (const queued of this.queue) {
              if (queued.status === 'pending') this._cancelQueuedAttempt(queued.id);
            }
            this.queue = [];
            console.warn(
              `[${this.id}] Cleared ${removed} pending message(s) due to process error to prevent retry loops.`
            );
            this.broadcastQueue();
          }
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

    private _findSubAgentByRuntimeId(id: string): SubAgent | undefined {
      return this.subAgents.find((agent) => agent.id === id || agent.providerThreadId === id);
    }

    private _broadcastSubAgentUpdate(agent: SubAgent): void {
      broadcast({
        type: 'subagent_update',
        conversationId: this.id,
        subAgentId: agent.id,
        toolUses: agent.toolUses,
        tokens: agent.tokens,
        currentAction: agent.currentAction,
        status: agent.status,
        rawStatus: agent.rawStatus,
        statusSource: agent.statusSource,
      });
    }

    private _completeNativeCodexSubAgent(agent: SubAgent, completedAt = new Date()): void {
      if (agent.status === 'completed' || agent.status === 'error') {
        agent.completedAt = completedAt;
        agent.currentAction = agent.status === 'error' ? 'Error' : 'Done';
        broadcast({
          type: 'subagent_complete',
          conversationId: this.id,
          subAgentId: agent.id,
          status: agent.status,
          completedAt,
        });
      }
    }

    private _createOrUpdateCodexNativeSubAgent(
      childThreadId: string,
      toolName: string,
      prompt: string | undefined,
      rawStatus: string | undefined,
      statusMessage: string | null | undefined
    ): { agent: SubAgent; isNew: boolean; wasTerminal: boolean } {
      const description = getSubagentDescription(this.provider, toolName, {
        ...(prompt ? { prompt } : {}),
      });
      const fallbackStatus = toolName === 'spawn_agent' ? 'pending' : 'running';
      const normalizedStatus = normalizeCodexSubagentStatus(rawStatus, fallbackStatus);
      const currentAction = getCodexSubagentCurrentAction(toolName, rawStatus, statusMessage);
      let agent = this._findSubAgentByRuntimeId(childThreadId);
      const isNew = !agent;
      const wasTerminal = !!agent && isTerminalSubagentStatus(agent.status);

      if (!agent) {
        agent = {
          id: childThreadId,
          description,
          status: normalizedStatus,
          toolUses: 0,
          tokens: 0,
          currentAction,
          startedAt: new Date(),
          providerThreadId: childThreadId,
          rawStatus,
          statusSource: 'native',
        };
        this.subAgents.push(agent);
      } else {
        agent.providerThreadId = childThreadId;
        if (!agent.description || agent.description.startsWith('Running ')) {
          agent.description = description;
        }
        agent.status = normalizedStatus;
        agent.rawStatus = rawStatus;
        agent.statusSource = 'native';
        if (currentAction) {
          agent.currentAction = currentAction;
        } else if (normalizedStatus === 'completed' || normalizedStatus === 'error') {
          agent.currentAction = undefined;
        }
        if (normalizedStatus === 'completed' || normalizedStatus === 'error') {
          agent.completedAt ??= new Date();
        }
      }

      return { agent, isNew, wasTerminal };
    }

    private _handleCodexCollabToolUse(
      event: Extract<ProviderEvent, { type: 'tool_use' }>
    ): { suppressGenericSubagentHandling: boolean; suppressFormattedOutput: boolean } | null {
      if (this.provider !== 'codex' || !isCodexCollabToolName(event.name)) {
        return null;
      }

      const { phase, receiverThreadIds, prompt, agentStates } = extractCodexCollabToolInput(
        event.input
      );
      if (phase !== 'completed') {
        return {
          suppressGenericSubagentHandling: true,
          suppressFormattedOutput: false,
        };
      }

      const childIds = new Set<string>(receiverThreadIds);
      for (const childId of Object.keys(agentStates)) {
        childIds.add(childId);
      }

      for (const childId of childIds) {
        const agentState = agentStates[childId];
        const { agent, isNew, wasTerminal } = this._createOrUpdateCodexNativeSubAgent(
          childId,
          event.name,
          prompt,
          agentState?.status,
          agentState?.message
        );

        if (event.name !== 'spawn_agent') {
          agent.toolUses += 1;
        }

        if (isNew) {
          console.log(
            `[${this.id}] Codex sub-agent started: ${agent.id.substring(0, 8)} - "${agent.description.substring(0, 50)}"`
          );
          broadcast({
            type: 'subagent_start',
            conversationId: this.id,
            subAgent: agent,
          });
        } else {
          this._broadcastSubAgentUpdate(agent);
        }

        if (agentState?.message !== undefined && agentState.message !== null) {
          this._broadcastSubAgentUpdate(agent);
        }

        if (isTerminalSubagentStatus(agent.status)) {
          if (!agent.completedAt) {
            agent.completedAt = new Date();
          }
          if (agent.status === 'error') {
            agent.currentAction = 'Error';
          } else if (!agent.currentAction) {
            agent.currentAction = 'Done';
          }
          this._broadcastSubAgentUpdate(agent);
          if (!wasTerminal) {
            this._completeNativeCodexSubAgent(agent, agent.completedAt);
          }
        }
      }

      return {
        suppressGenericSubagentHandling: true,
        suppressFormattedOutput: true,
      };
    }

    /**
     * Unified output handler from executeCommand normalized events.
     */
    handleOutput(event: ProviderEvent): void {
      switch (event.type) {
        case 'message_start':
          // Only create assistant message if we don't have one pending
          // The actual message creation happens when we get text content
          break;

        case 'text_delta': {
          this._ensureAssistantMessage();

          // Accumulate content server-side too (for debugging)
          const currentMsg = this.messages[this.messages.length - 1];
          if (currentMsg.role === 'assistant') {
            currentMsg.content += event.text;
          }
          // Now send the text chunk - client will append to the assistant message
          if (VERBOSE)
            console.log(
              `[${this.id}] chunk (${event.text.length} chars): "${event.text.substring(0, 30).replace(/\n/g, '\\n')}..."`
            );
          this.broadcastChunk({
            type: 'chunk',
            conversationId: this.id,
            text: event.text,
          });
          break;
        }

        case 'tool_use': {
          this._ensureAssistantMessage();
          const codexCollabHandling = this._handleCodexCollabToolUse(event);
          // Check if this tool spawns a sub-agent
          if (!codexCollabHandling && isSubagentSpawnTool(this.provider, event.name)) {
            const description = getSubagentDescription(this.provider, event.name, event.input);
            const blockId = (event.input as { _blockId?: string })._blockId || createSessionId();

            // Create a new sub-agent
            const subAgent: SubAgent = {
              id: blockId,
              description,
              status: 'running',
              toolUses: 0,
              tokens: 0,
              currentAction: undefined,
              startedAt: new Date(),
            };

            this.subAgents.push(subAgent);
            this._pendingTaskTools.set(blockId, { id: blockId, startedAt: new Date() });

            console.log(
              `[${this.id}] Sub-agent started: ${blockId.substring(0, 8)} - "${description.substring(0, 50)}"`
            );

            // Broadcast sub-agent start
            broadcast({
              type: 'subagent_start',
              conversationId: this.id,
              subAgent,
            });
          } else if (!codexCollabHandling?.suppressGenericSubagentHandling) {
            // For non-Task tools, check if we have an active sub-agent and update its current action
            if (this.subAgents.length > 0) {
              const activeAgent = this.subAgents.find((a) => a.status === 'running');
              if (activeAgent) {
                // Format the current action based on tool name
                let actionDisplay = event.name;
                if (event.input) {
                  // Extract file path if present
                  const filePath =
                    (event.input as { file_path?: string; path?: string }).file_path ||
                    (event.input as { file_path?: string; path?: string }).path;
                  if (filePath) {
                    // Show just the filename for brevity
                    const fileName = filePath.split('/').pop() || filePath;
                    actionDisplay = `${event.name}: ${fileName}`;
                  }
                }

                activeAgent.toolUses += 1;
                activeAgent.currentAction = actionDisplay;

                // Broadcast sub-agent update
                broadcast({
                  type: 'subagent_update',
                  conversationId: this.id,
                  subAgentId: activeAgent.id,
                  toolUses: activeAgent.toolUses,
                  currentAction: activeAgent.currentAction,
                });
              }
            }

            // Normalize tool line formatting across providers (Claude/Gemini/Codex).
            // Suppress Codex shell completion-only events to avoid duplicate lines.
            if (
              !codexCollabHandling?.suppressFormattedOutput &&
              !isCompletionOnlyToolUse(event.name, event.input, event.displayText)
            ) {
              const formattedTool = formatToolUse(event.name, event.input, event.displayText);
              if (formattedTool) {
                const currentMsg = this.messages[this.messages.length - 1];
                const needsLeadingNewline =
                  !formattedTool.startsWith('<!--ask_user_question:') &&
                  currentMsg?.role === 'assistant' &&
                  currentMsg.content.length > 0 &&
                  !currentMsg.content.endsWith('\n');
                const chunkText = formattedTool.startsWith('<!--ask_user_question:')
                  ? formattedTool
                  : `${needsLeadingNewline ? '\n' : ''}${formattedTool}\n`;
                if (currentMsg?.role === 'assistant') {
                  // Keep server-side message text aligned with streamed chunks.
                  currentMsg.content += chunkText;
                }
                this.broadcastChunk({
                  type: 'chunk',
                  conversationId: this.id,
                  text: chunkText,
                });
              }
            }
          } else if (
            !codexCollabHandling.suppressFormattedOutput &&
            !isCompletionOnlyToolUse(event.name, event.input, event.displayText)
          ) {
            const formattedTool = formatToolUse(event.name, event.input, event.displayText);
            if (formattedTool) {
              const currentMsg = this.messages[this.messages.length - 1];
              const needsLeadingNewline =
                !formattedTool.startsWith('<!--ask_user_question:') &&
                currentMsg?.role === 'assistant' &&
                currentMsg.content.length > 0 &&
                !currentMsg.content.endsWith('\n');
              const chunkText = formattedTool.startsWith('<!--ask_user_question:')
                ? formattedTool
                : `${needsLeadingNewline ? '\n' : ''}${formattedTool}\n`;
              if (currentMsg?.role === 'assistant') {
                currentMsg.content += chunkText;
              }
              this.broadcastChunk({
                type: 'chunk',
                conversationId: this.id,
                text: chunkText,
              });
            }
          }
          break;
        }

        case 'message_complete': {
          // Clear watchdog timers immediately — the turn completed normally.
          // Without this they dangle until process close, risking a spurious timeout.
          this._clearTurnWatchdogs();
          if (event.reason === 'out_of_tokens' || this._terminalCauseHint === 'out_of_tokens') {
            this._finishTurnAttempt('failed', 'out_of_tokens');
          } else if (event.reason === 'error' || this._terminalCauseHint === 'provider_error') {
            this._finishTurnAttempt('failed', 'provider_error');
          } else if (event.reason === 'killed') {
            this._finishTurnAttempt(
              this._stopCause === 'server_restart'
                ? 'interrupted'
                : this._stopCause === 'user_stop'
                  ? 'cancelled'
                  : 'failed',
              this._stopCause ?? 'process_killed'
            );
          } else {
            this._finishTurnAttempt('succeeded', 'provider_complete');
          }
          // Mark all running sub-agents as complete
          const completedAt = new Date();

          // Update the last assistant message with completion metadata
          const lastMsg = this.messages[this.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.completedAt) {
            lastMsg.completedAt = completedAt;
            lastMsg.completionReason = event.reason;
          }

          for (const agent of this.subAgents) {
            if (agent.status === 'running') {
              if (this.provider === 'codex' && agent.providerThreadId) {
                continue;
              }
              agent.status = 'completed';
              agent.completedAt = completedAt;
              if (!agent.statusSource) {
                agent.statusSource = 'inferred_parent_completion';
              }
              agent.currentAction = 'Done';

              console.log(`[${this.id}] Sub-agent completed: ${agent.id.substring(0, 8)}`);

              // Broadcast sub-agent complete
              broadcast({
                type: 'subagent_complete',
                conversationId: this.id,
                subAgentId: agent.id,
                status: 'completed',
                completedAt,
              });
            }
          }

          // Clear pending task tools
          this._pendingTaskTools.clear();

          // Broadcast message_complete BEFORE status(isStreaming=false).
          // Client's message_complete handler calls flushChunkBuffer() — the last
          // buffered text must be flushed before isStreaming=false triggers a re-render
          // that hides typing dots. Preserves the documented broadcast sequence.
          this.broadcastChunk({
            type: 'message_complete',
            conversationId: this.id,
            reason: event.reason,
          });

          // turn.complete means the assistant has finished this turn from the
          // user's perspective; clear busy state now instead of waiting for
          // child-process teardown.
          this.isStreaming = false;
          this.isRunning = false;
          clearExternalRunningStatus(this.id, this.sessionId);
          markLocalCompletionSuppression(this.id, this.sessionId);
          this.broadcastStatus();

          broadcast({
            type: 'conversations_updated',
            conversations: [this.toJSON()],
          });

          // Signal to the close handler that cleanup already happened.
          // Close handler will skip redundant state changes and broadcasts.
          this._turnCompletedCleanly = true;
          updateBuddyConversationLink(this, 'active');
          const completedAssistant = [...this.messages]
            .reverse()
            .find((message) => message.role === 'assistant');
          this.emit('buddy-turn-complete', completedAssistant?.content ?? '');

          // Merge feature: if this is a review child, scan the final assistant
          // message for the sentinel `merge_review_docs/REVIEW_DOC_<uuid>.txt`.
          // Presence → complete; absence → error. Either way, broadcast once so
          // the parent's progress strip updates.
          if (this.mergeChildMeta) {
            const expectedPath = mergeReviewDocPath(this.mergeChildMeta.reviewUuid);
            const lastAssistant = [...this.messages].reverse().find((m) => m.role === 'assistant');
            const found = !!lastAssistant && lastAssistant.content.includes(expectedPath);
            broadcast({
              type: 'merge_child_status',
              parentConversationId: this.mergeChildMeta.parentConversationId,
              childConversationId: this.id,
              reviewUuid: this.mergeChildMeta.reviewUuid,
              status: found ? 'complete' : 'error',
              reviewDocPath: found ? expectedPath : null,
            });
          }

          break;
        }

        case 'error': {
          // Surface provider errors (usage limits, auth failures, turn errors)
          // to the client as a system message so the user sees what happened.
          console.error(`[${this.id}] Provider error: ${event.message}`);
          const errorMessage: Message = {
            role: 'system',
            content: event.message,
            timestamp: new Date(),
          };
          this.messages.push(errorMessage);
          broadcast({
            type: 'message',
            conversationId: this.id,
            role: 'system',
            content: event.message,
          });
          break;
        }

        default: {
          // TypeScript exhaustive check - this should never happen
          const _exhaustive: never = event;
          throw new Error(`Unhandled event type: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }

    sendMessage(content: string): void {
      console.log(
        `[${this.id}] sendMessage called, isRunning=${this.isRunning}, hasProcess=${this.process !== null}, queueDepth=${this.queue.length}, contentLen=${content.length}, preview="${formatLogPreview(content)}"`
      );

      if (this.process || this.isRunning) {
        console.warn(`[${this.id}] Already processing a message, ignoring`);
        return;
      }

      // --- Chat Fork vs merge session-fork (easy to confuse) ---
      //
      // Chat "Fork" (soft handoff): resumedFromConversationId is UI lineage.
      // Context is supposed to live in the draft / first user message
      // (originally a pasted transcript). Changing provider before send is
      // intentional and must still work — do not require same-provider CLI
      // session inheritance for that path.
      //
      // Merge review children: spawnMergeReviewFork() below, which ALWAYS
      // passes forkSourceSessionId into the harness (--fork / emulateFork).
      // That path is gated by FORK_CAPABLE_PROVIDERS.
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
        if (source.provider !== this.provider || !providerSupportsFork(this.provider)) {
          // Soft handoff via string context (draft/first message), not provider
          // session inheritance. This is intentional — the whole goal of Fork
          // is to inject prior convo as string context across clients.
          console.log(
            `[${this.id}] Soft fork ${source.provider} -> ${this.provider} (${source.provider === this.provider ? 'harness cannot fork sessions' : 'cross-provider'}), using string context handoff (no provider session fork)`
          );
        } else {
          if (!source.hasStartedSession()) {
            this.rejectFork('Cannot fork: the source conversation has no provider session yet');
            return;
          }
          forkSourceSessionId = source.sessionId;
        }
      }

      this._prepareTurnAttempt();
      const executionConfig = this.preflightExecution();
      if (!executionConfig) {
        this._finishTurnAttempt('failed', 'spawn_failed');
        return;
      }

      // UI/history retain clean user text. Only the first unstarted provider
      // turn receives a hidden context prefix.
      let cliContent = buildFirstTurnCliContent({
        content,
        messageCount: this.messages.length,
        hasStartedSession: this._hasStartedSession,
        kind: this.kind,
        buddyBriefing: this._buddyBriefing,
        swarmDebugPrefix: this.swarmDebugPrefix,
      });
      // When provider-session inheritance ran above, skip first-turn briefing /
      // pasted-context prefixes — the CLI already has the source transcript.
      // Soft Chat Forks (no forkSourceSessionId) keep buildFirstTurnCliContent.
      if (forkSourceSessionId) cliContent = content;

      // Merge feature: on the very first user send of a merge parent thread,
      // inject a prefix containing the contents of each child's review doc.
      // Loaded synchronously from each child's working directory. Missing files
      // become inline placeholders so the injection always succeeds even if a
      // child errored. Sentinel markers let a future restart path recover the
      // injected context the same way swarmDebugPrefix does.
      if (
        this.mergeParentMeta !== null &&
        !this.mergeParentMeta.prefixInjected &&
        this.messages.length === 0
      ) {
        // Race guard: even though the client disables Send until all children
        // settle via allMergeChildrenSettledAtomFamily, a server restart or a
        // WS reconnect could briefly put the client's view ahead of reality.
        // If any child is still running we reject with a clear system message
        // so the user retries rather than getting placeholder-injected reviews.
        const stillRunning: string[] = [];
        for (const child of this.mergeParentMeta.children) {
          const childConv = getConversation(child.childConversationId);
          if (childConv?.isRunning) stillRunning.push(child.childConversationId.substring(0, 8));
        }
        if (stillRunning.length > 0) {
          const msg = `Merge send blocked — ${stillRunning.length} review fork(s) still running: ${stillRunning.join(', ')}. Wait for the progress strip to settle.`;
          console.warn(`[${this.id}] ${msg}`);
          const systemMessage: Message = {
            role: 'system',
            content: msg,
            timestamp: new Date(),
          };
          broadcast({
            type: 'message',
            conversationId: this.id,
            role: 'system',
            content: msg,
          });
          // Do NOT push into this.messages — leaving messages empty preserves
          // prefixInjected=false so a retry re-enters this branch cleanly.
          void systemMessage;
          return;
        }
        const parts: string[] = [
          'This is a merge thread that should take all the "reviews" below from other agent conversations as context',
        ];
        for (const child of this.mergeParentMeta.children) {
          const docRel = mergeReviewDocPath(child.reviewUuid);
          const docAbs = path.join(child.childWorkingDirectory, docRel);
          let body: string;
          try {
            body = fs.readFileSync(docAbs, 'utf-8');
          } catch {
            body = `[review doc not found: ${docRel} — child ${child.childConversationId.substring(0, 8)} may have errored]`;
          }
          parts.push(
            `--- review ${child.reviewUuid} (source conversation ${child.sourceConversationId.substring(0, 8)}) ---\n${body}`
          );
        }
        const mergePrefix = parts.join('\n\n');
        cliContent = `<!-- unleashd:merge-prefix -->\n${mergePrefix}\n<!-- /unleashd:merge-prefix -->\n\n${content}`;
        this.mergeParentMeta.prefixInjected = true;
      }

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

      // Spawn CLI process with possibly-prefixed content
      this.spawnForMessage(cliContent, executionConfig, forkSourceSessionId);
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

    /**
     * Merge feature ONLY: spawn a turn by inheriting another conversation's
     * provider session (CLI --fork / emulateFork). `forkSourceSessionId` is the
     * provider session id, NOT the Unleashd conversation UUID.
     *
     * This is NOT the Chat "Fork" button. Chat Fork is a soft handoff via
     * resumedFromConversationId + draft/first-message text (often a pasted
     * transcript) and must not be routed through here.
     *
     * Requires FORK_CAPABLE_PROVIDERS / harness sessionForkFlags or emulateFork.
     * Only safe on a fresh Conversation (no prior messages).
     */
    spawnMergeReviewFork(content: string, forkSourceSessionId: string): void {
      if (this.process || this.isRunning) {
        console.warn(`[${this.id}] spawnMergeReviewFork: already running, ignoring`);
        return;
      }
      this._prepareTurnAttempt();
      const executionConfig = this.preflightExecution();
      if (!executionConfig) {
        this._finishTurnAttempt('failed', 'spawn_failed');
        return;
      }
      const userMessage: Message = {
        role: 'user',
        content,
        timestamp: new Date(),
      };
      this.messages.push(userMessage);
      this.broadcastMessage({
        type: 'message',
        role: 'user',
        content,
        conversationId: this.id,
      });
      // Native vs cp+resume emulation is decided inside agent-cli-tool based
      // on the harness config. From here it's opaque: pass the source session
      // id through, let the library handle the rest. Mark _hasStartedSession
      // false so spawnForMessage treats this as a first-turn fork.
      this._hasStartedSession = false;
      this.spawnForMessage(content, executionConfig, forkSourceSessionId);
    }

    private preflightExecution(): ResolvedExecutionConfig | undefined {
      // Resolve immediately before any message, merge-prefix, or queue mutation.
      // Catalog changes may affect defaults without changing durable intent.
      const resolution = this.refreshConfigResolution();
      if (resolution.status === 'resolved') return resolution.value;

      const errorMessage = `Configuration unavailable: ${resolution.error.message}`;
      console.error(`[${this.id}] ${errorMessage}`);
      this.messages.push({
        role: 'system',
        content: errorMessage,
        timestamp: new Date(),
        completionReason: 'error',
      });
      const queued = this.queue[0];
      if (queued?.status === 'sending') {
        queued.status = 'pending';
        this.broadcastQueue();
      }
      broadcast({
        type: 'conversation_updated',
        reason: 'config',
        conversation: this.toJSON(),
      });
      return undefined;
    }

    stop(reason: 'user_stop' | 'server_restart' = 'user_stop'): void {
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
      updateBuddyConversationLink(this, 'cancelled');
      settleBuddyDelegation(this, 'cancelled');

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
      this._clearTurnWatchdogs();
      const now = Date.now();
      this._lastBridgeEventAt = now;
      this._lastProviderProgressAt = now;
      this._refreshBridgeWatchdog();
      this._refreshProviderIdleWatchdog();
      this._startSwarmPoller();
      this._turnMaxTimer = setTimeout(() => {
        this._handleTurnTimeout('max');
      }, TURN_MAX_RUNTIME_MS);
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
      // Every normalized event proves the wrapper -> queue -> Unleashd bridge
      // is alive. Only provider events and typed native-session advancement
      // prove provider progress; the wrapper's timer heartbeat does not.
      this._lastBridgeEventAt = now;
      this._refreshBridgeWatchdog();
      if (isProviderProgressEvent(event)) {
        this._lastProviderProgressAt = now;
        this._refreshProviderIdleWatchdog();
      }
      this._pollForNewSwarms();
    }

    private _refreshBridgeWatchdog(): void {
      if (this._turnBridgeTimer) {
        clearTimeout(this._turnBridgeTimer);
        this._turnBridgeTimer = null;
      }
      if (!this.isRunning) return;
      this._turnBridgeTimer = setTimeout(() => {
        this._handleTurnTimeout('bridge');
      }, TURN_BRIDGE_TIMEOUT_MS);
    }

    private _refreshProviderIdleWatchdog(): void {
      if (this._turnProviderIdleTimer) {
        clearTimeout(this._turnProviderIdleTimer);
        this._turnProviderIdleTimer = null;
      }
      if (!this.isRunning) return;
      this._turnProviderIdleTimer = setTimeout(() => {
        this._handleTurnTimeout('provider');
      }, TURN_PROVIDER_IDLE_TIMEOUT_MS);
    }

    /**
     * Detects if the assistant launched a new Oompa Loompa Swarm by checking
     * the local runs directory for a new ID compared to what we saw previously.
     */
    private _pollForNewSwarms(options?: { force?: boolean }): void {
      // Throttle: _noteTurnActivity() fires on every text_delta/tool_use (100+ per response).
      // Avoid synchronous fs I/O (readdirSync, statSync, readFileSync) on every event.
      const now = Date.now();
      if (!options?.force && now - this._lastSwarmPollAt < SWARM_POLL_THROTTLE_MS) return;
      this._lastSwarmPollAt = now;

      const snapshot = readLatestOompaRuntime(this.workingDirectory);
      if (!snapshot.available || !snapshot.run) return;

      const run = snapshot.run;
      const currentRunId = snapshot.run.runId;
      if (!this._hasSwarmBaseline) {
        // Safety fallback: baseline if a turn starts without _primeSwarmBaseline.
        this._lastSwarmRunId = currentRunId;
        this._hasSwarmBaseline = true;
        return;
      }

      const previousRunId = this._lastSwarmRunId;
      if (previousRunId && previousRunId !== currentRunId) {
        this._completeSwarmSubAgent(previousRunId);
      }

      if (currentRunId !== previousRunId) {
        this._lastSwarmRunId = currentRunId;
        if (!run.isRunning) return;
        this._startSwarmSubAgent(run);
        return;
      }

      if (!run.isRunning) {
        this._completeSwarmSubAgent(currentRunId);
      }
    }

    private _clearTurnWatchdogs(): void {
      this._stopSwarmPoller();
      if (this._turnBridgeTimer) {
        clearTimeout(this._turnBridgeTimer);
        this._turnBridgeTimer = null;
      }
      if (this._turnProviderIdleTimer) {
        clearTimeout(this._turnProviderIdleTimer);
        this._turnProviderIdleTimer = null;
      }
      if (this._turnMaxTimer) {
        clearTimeout(this._turnMaxTimer);
        this._turnMaxTimer = null;
      }
    }

    private _handleTurnTimeout(kind: TurnTimeoutKind): void {
      if (!this.process || !this.isRunning) return;
      const now = Date.now();
      const elapsedSec = Math.round((now - this._processStartTime) / 1000);
      const bridgeIdleSec = Math.round((now - this._lastBridgeEventAt) / 1000);
      const providerIdleSec = Math.round((now - this._lastProviderProgressAt) / 1000);
      const sawMeaningfulOutput = this._sawMeaningfulProviderOutputThisRun;
      const timeout = describeTurnTimeout(kind, {
        elapsedSeconds: elapsedSec,
        bridgeIdleSeconds: bridgeIdleSec,
        providerIdleSeconds: providerIdleSec,
        sawMeaningfulOutput,
      });
      const lastActivity = this._lastObservedTurnActivity;

      console.error(
        `[${this.id}] ${timeout.message} | timeoutKind=${kind} terminalCause=${timeout.terminalCause} sawMeaningfulOutput=${sawMeaningfulOutput} elapsed=${elapsedSec}s bridgeIdle=${bridgeIdleSec}s providerIdle=${providerIdleSec}s lastActivitySource=${lastActivity?.source ?? 'none'} lastProviderEvent=${lastActivity?.providerEventType ?? 'none'} stderr=${this._stderrBuffer.length > 0 ? 'yes' : 'no'}`
      );
      this._clearTurnWatchdogs();
      this.handleOutput({ type: 'error', message: timeout.message });
      this._finishTurnAttempt('failed', timeout.terminalCause);

      const completedAt = new Date();
      const lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg?.role === 'assistant' && !lastMsg.completedAt) {
        lastMsg.completedAt = completedAt;
        lastMsg.completionReason = 'error';
      }
      for (const agent of this.subAgents) {
        if (agent.status !== 'running') continue;
        agent.status = 'error';
        agent.completedAt = completedAt;
        agent.currentAction = 'Parent turn timed out';
      }
      this._pendingTaskTools.clear();
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
      updateBuddyConversationLink(this, 'failed');
      settleBuddyDelegation(this, 'failed', timeout.message);
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

    private _primeSwarmBaseline(): void {
      const snapshot = readLatestOompaRuntime(this.workingDirectory);
      this._lastSwarmRunId = snapshot.available && snapshot.run ? snapshot.run.runId : null;
      this._hasSwarmBaseline = true;
      this._lastSwarmPollAt = 0;
    }

    private _startSwarmPoller(): void {
      this._stopSwarmPoller();
      if (!this.isRunning) return;
      this._swarmPollTimer = setInterval(() => {
        this._pollForNewSwarms({ force: true });
      }, SWARM_POLL_INTERVAL_MS);
      this._swarmPollTimer.unref?.();
      this._pollForNewSwarms({ force: true });
    }

    private _stopSwarmPoller(): void {
      if (!this._swarmPollTimer) return;
      clearInterval(this._swarmPollTimer);
      this._swarmPollTimer = null;
    }

    private _startSwarmSubAgent(run: NonNullable<OompaRuntimeSnapshot['run']>): void {
      const agentId = `swarm-${run.runId}`;
      if (this.subAgents.some((a) => a.id === agentId)) return;

      const swarmId = run.swarmId ?? run.runId;
      console.log(`[${this.id}] Detected new running swarm: ${swarmId}`);

      const newAgent: SubAgent = {
        id: agentId,
        description: `Swarm Run: ${swarmId} (${run.totalWorkers} workers)`,
        status: 'running',
        toolUses: 0,
        tokens: 0,
        currentAction: 'Running swarm...',
        startedAt: new Date(),
      };

      this.subAgents.push(newAgent);
      broadcast({
        type: 'subagent_start',
        conversationId: this.id,
        subAgent: newAgent,
      });
    }

    private _completeSwarmSubAgent(runId: string): void {
      const agentId = `swarm-${runId}`;
      const swarmAgent = this.subAgents.find((a) => a.id === agentId);
      if (!swarmAgent || swarmAgent.status !== 'running') return;

      const completedAt = new Date();
      swarmAgent.status = 'completed';
      swarmAgent.currentAction = 'Done';
      swarmAgent.completedAt = completedAt;

      broadcast({
        type: 'subagent_complete',
        conversationId: this.id,
        subAgentId: agentId,
        status: 'completed',
        completedAt,
      });
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
     * Add a message to the queue. If the conversation is ready and idle,
     * process immediately. Otherwise it sits until the next status/ready change.
     */
    enqueueMessage(content: string): void {
      const queueDepthBefore = this.queue.length;
      const msg: QueuedMessage = {
        id: crypto.randomUUID(),
        content,
        queuedAt: new Date(),
        status: 'pending',
      };
      const attemptId = crypto.randomUUID();
      this._queuedAttemptIds.set(msg.id, attemptId);
      turnAttempts.queued({
        attemptId,
        conversationId: this.id,
        queueMessageId: msg.id,
        providerSessionId: this.sessionId,
      });
      this.queue.push(msg);
      console.log(
        `[${this.id}] Queued message id=${msg.id.substring(0, 8)}, queueDepth=${queueDepthBefore}->${this.queue.length}, contentLen=${content.length}, preview="${formatLogPreview(content)}"`
      );
      this.broadcastQueue();
      this.processQueue();
    }

    /**
     * Atomically stop the active turn, flush pending queued work using server-side
     * state, and enqueue the user's final interruption message as the next task.
     */
    interruptAndSend(content: string): void {
      const pendingQueuedMessages = this.queue.filter((m) => m.status === 'pending');
      const hasPendingTasks = pendingQueuedMessages.length > 0;

      if (hasPendingTasks) {
        for (const queued of pendingQueuedMessages) this._cancelQueuedAttempt(queued.id);
        this.queue = this.queue.filter((m) => m.status === 'sending');
        console.log(
          `[${this.id}] interrupt_and_send flushed ${pendingQueuedMessages.length} pending queued message(s)`
        );
        this.broadcastQueue();
      }

      if (this.process) {
        this.stop();
      }

      this.enqueueMessage(content);
    }

    /**
     * Cancel a pending queued message by ID. Cannot cancel messages already sending.
     */
    cancelQueuedMessage(messageId: string): void {
      const idx = this.queue.findIndex((m) => m.id === messageId && m.status === 'pending');
      if (idx !== -1) {
        console.log(`[${this.id}] Cancelled queued message: ${messageId.substring(0, 8)}`);
        this._cancelQueuedAttempt(messageId);
        this.queue.splice(idx, 1);
        this.broadcastQueue();
      }
    }

    /**
     * Clear all pending messages from the queue. Messages currently sending are kept.
     */
    clearQueue(): void {
      const before = this.queue.length;
      for (const queued of this.queue) {
        if (queued.status === 'pending') this._cancelQueuedAttempt(queued.id);
      }
      this.queue = this.queue.filter((m) => m.status === 'sending');
      console.log(`[${this.id}] Cleared queue: removed ${before - this.queue.length} messages`);
      this.broadcastQueue();
    }

    /**
     * Process the next queued message if the conversation is idle.
     * Called from: close handler (after process exits), enqueueMessage (new message).
     */
    processQueue(): void {
      if (this.process || this.isRunning) return;
      if (this.queue.length === 0) return;

      const next = this.queue[0];
      if (next.status === 'sending') return; // already in flight

      next.status = 'sending';
      let attemptId = this._queuedAttemptIds.get(next.id);
      if (!attemptId) {
        attemptId = crypto.randomUUID();
        this._queuedAttemptIds.set(next.id, attemptId);
        turnAttempts.queued({
          attemptId,
          conversationId: this.id,
          queueMessageId: next.id,
          providerSessionId: this.sessionId,
        });
      }
      this._nextAttempt = { attemptId, queueMessageId: next.id };
      console.log(
        `[${this.id}] processQueue sending id=${next.id.substring(0, 8)}, queueDepth=${this.queue.length}, contentLen=${next.content.length}, preview="${formatLogPreview(next.content)}"`
      );
      this.broadcastQueue();
      this.sendMessage(next.content);
    }

    hasActiveProcess(): boolean {
      return this.process !== null;
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
        this.queue.length === 0 &&
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
        swarmDebugPrefix: this.swarmDebugPrefix,
        kind: this.kind,
        buddyContext: this.buddyContext,
        purpose: this.purpose,
        mergeParentMeta: this.mergeParentMeta,
        mergeChildMeta: this.mergeChildMeta,
      };
    }
  };
}
