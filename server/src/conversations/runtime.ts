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
  ConversationDetail,
  ConversationKind,
  ConversationRow,
  Message,
  OompaRuntimeSnapshot,
  Provider as ProviderName,
  ProviderTurnUsage,
  QueuedMessage,
  ResolvedExecutionConfig,
  RowPatch,
  RunState,
  ServerMessageInput,
  SubAgent,
} from '@unleashd/shared';
import {
  encodeRows,
  kindBuddyContext,
  matchConversationKind,
  providerSupportsFork,
  rowKind,
} from '@unleashd/shared';
import {
  BuddyBuilderTurnPolicy,
  type BuddyPolicyHost,
  BuddyTurnPolicy,
  type BuddyTurnPolicyDependencies,
  type BuddyTurnPolicySeed,
  type MemoryGenerationInput,
  createMemorySnapshot,
} from '../buddies/turn-policy';
import { SWARM_POLL_INTERVAL_MS, SWARM_POLL_THROTTLE_MS } from '../constants/timeouts';
import type { RuntimeTurnAttemptObserver } from '../observability';
import { resolveConfigAgainstProviderCatalog } from '../providers/catalog-service';
import { SwarmObservers } from '../swarm';
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
import { type TurnBroadcast, TurnRunner, type TurnRunnerPorts } from '../turns/runner';

/**
 * The conversation: its record, its queue, its turn policy and the runner for
 * its current turn. Turn mechanics live in turns/ (queue, runner, watchdog,
 * sub-agent folds), kind-specific behavior in the policy chosen once by kind
 * (turns/policy.ts, buddies/turn-policy.ts), swarm observation in
 * swarm/observer.ts.
 */

export type { SeatTurnInput, SessionRelativePrompt } from '../turns/input';

export type ConversationBroadcast = ServerMessageInput | TurnBroadcast;

export interface ConversationRuntimeView {
  id: string;
  sessionId: string;
  config: ConversationConfig;
  readonly provider: ProviderName;
  /** Derived from `kind` (never a second identity): the Buddy run data or null. */
  readonly buddyContext: BuddyContext | null;
  readonly memoryGeneration: string | null;
  kind: ConversationKind;
  getMemorySnapshot(): MemorySnapshot | null;
  isRunning: boolean;
  toRow(): ConversationRow;
}

/** Input with no recorded producer: no owner authority, workspace audience. */
function unknownInput(): TurnInput {
  return { origin: 'unknown', inputId: crypto.randomUUID() };
}

/** The host server's ports: the runner's, the Buddy policies', and the conversation's own. */
export interface ConversationRuntimeDependencies
  extends BuddyTurnPolicyDependencies,
    Omit<TurnRunnerPorts, 'executeTurn' | 'turnAttempts' | 'swarmObservers'> {
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
  /** Test seam for the real provider boundary; production uses agent-cli directly. */
  executeTurn?: typeof executeCommand;
  turnAttempts?: RuntimeTurnAttemptObserver;
  /** The ingest list (production); absent = a host with no transcripts (the overlay is all). */
  history?: RuntimeHistory;
}

/** What the history owns in a runtime's row: label, times and the served history's length. */
export interface HistoryRowFields {
  label: string;
  createdAt: number;
  activityAt: number;
  messageCount: number;
}

/** A runtime as the history reads it. */
export interface HistorySubject {
  readonly id: string;
  readonly title?: string;
  readonly messages: readonly Message[];
  readonly createdAt: Date;
  hasActiveProcess(): boolean;
}

/**
 * The history port (server/src/ingest/conversation-list.ts): rows take their durable fields
 * from it, so a runtime's row and a listed row follow one rule; `idle` applies transcript
 * changes that were held back while a turn ran.
 */
export interface RuntimeHistory {
  fields(conversation: HistorySubject): HistoryRowFields;
  idle(conversationId: string): void;
}

/** A conversation with no transcript yet (app-created, first turn not flushed): its overlay. */
export function overlayHistoryFields(conversation: HistorySubject): HistoryRowFields {
  const createdAt = conversation.createdAt.getTime();
  const last = conversation.messages.at(-1);
  return {
    label: conversationLabel(conversation.title, conversation.messages),
    createdAt,
    activityAt: last ? new Date(last.timestamp).getTime() : createdAt,
    messageCount: conversation.messages.length,
  };
}

const OVERLAY_ONLY_HISTORY: RuntimeHistory = {
  fields: overlayHistoryFields,
  idle: () => undefined,
};

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
  /** The one identity; chosen at creation or read from the record. */
  kind: ConversationKind;
  parentConversationId?: string | null;
  resumedFromConversationId?: string | null;
  /** Provider-reported model from the latest turn / transcript. */
  observedModel?: string | null;
  /** Provider-generated label (Claude ai-title/custom-title) restored on hydration. */
  title?: string | null;
  swarmDebugPrefix?: string | null;
  buddyBriefing?: string | null;
  /** Native generation when the Buddy resolver provides one; otherwise derived from the briefing. */
  buddyMemoryGeneration?: MemoryGenerationInput | null;
  /** Usage restored from the persisted session binding on reload. */
  existingProviderUsage?: ProviderTurnUsage | null;
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

/** What every conversation of one host shares: its ports and the history port. */
interface ConversationEnv {
  deps: ConversationRuntimeDependencies;
  history: RuntimeHistory;
  runnerPorts: TurnRunnerPorts;
}

export type ConversationRuntime = Conversation;

export function createConversationRuntime(
  dependencies: ConversationRuntimeDependencies
): ConversationConstructor {
  const env: ConversationEnv = {
    deps: dependencies,
    history: dependencies.history ?? OVERLAY_ONLY_HISTORY,
    runnerPorts: {
      ...dependencies,
      executeTurn: dependencies.executeTurn ?? executeCommand,
      turnAttempts: dependencies.turnAttempts ?? NOOP_TURN_ATTEMPT_OBSERVER,
      // One async swarm poller per working directory, shared by all turns there.
      swarmObservers: new SwarmObservers(dependencies.readLatestOompaRuntime, {
        intervalMs: SWARM_POLL_INTERVAL_MS,
        throttleMs: SWARM_POLL_THROTTLE_MS,
      }),
    },
  };
  return class extends Conversation {
    constructor(options: ConversationOptions) {
      super(options, env);
    }
  };
}

export class Conversation extends EventEmitter {
  id: string; // UI conversation ID (persists across resets)
  sessionId: string; // Provider CLI session ID (can be reset for fresh context)
  // The live-turn overlay (messages appended this run); ingest merges it with disk history.
  messages: Message[] = [];
  // The last run state sent, so a status change publishes one `run` patch.
  private _publishedRun: RunState = 'idle';
  private _process: ChildProcess | null = null;
  get process(): ChildProcess | null {
    return this._process;
  }
  // The provider process exiting is the idle boundary: transcript changes that arrived while
  // the turn ran are merged now, replacing the overlay's rows with the provider's own.
  set process(value: ChildProcess | null) {
    const ended = this._process !== null && value === null;
    this._process = value;
    if (ended) this.env.history.idle(this.id);
  }
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
  // Parent conversation id for provider-native spawned sub-agent threads.
  // For Codex this is resolved from thread_spawn.parent_thread_id.
  parentConversationId: string | null;
  // Chat "Fork" soft-handoff lineage (UI). Not a provider-session fork.
  // See the shared FORK_CAPABLE_PROVIDERS comment for when it upgrades to a session fork.
  resumedFromConversationId: string | null;
  // Provider-reported model (e.g. "claude-sonnet-4-5-20250929"). An observation
  // of the latest turn, never configuration authority (that is `config`).
  observedModel: string | null;
  // Provider-generated conversation label (Claude ai-title/custom-title).
  // Undefined until observed; the row label falls back to first-message text.
  title: string | undefined;
  private _titleSource: 'ai' | 'custom' | null = null;
  // Debug prefix for swarm conversations — prepended to first CLI message.
  // Stays on the object (never cleared) so the detail carries it for rendering.
  swarmDebugPrefix: string | null;
  // Latest request's usage on the current session (docs/turn-lifecycle.md#provider-usage).
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
  private _sendingFromQueue = false;
  private readonly runner: TurnRunner;

  // The one identity (shared ConversationKindSchema). Setting it re-selects
  // the turn policy: the ONE place a conversation's kind decides turn
  // behavior (`policyFor`).
  private _kind: ConversationKind;
  private _policy: TurnPolicy;
  get kind(): ConversationKind {
    return this._kind;
  }
  set kind(value: ConversationKind) {
    this._kind = value;
    this._policy = this.policyFor(value, { memorySnapshot: null, audienceKey: null });
  }
  get buddyContext(): BuddyContext | null {
    return kindBuddyContext(this._kind);
  }

  constructor(
    opts: ConversationOptions,
    private readonly env: ConversationEnv
  ) {
    super();
    const {
      id,
      workingDirectory = null,
      configState,
      existingSessionId,
      kind,
      parentConversationId = null,
      resumedFromConversationId = null,
      observedModel = null,
      title = null,
      swarmDebugPrefix = null,
      buddyBriefing = null,
      buddyMemoryGeneration = null,
    } = opts;
    this.id = id;
    // sessionId defaults to id so JSONL filename matches Map key (no poller mismatch).
    // Only differs from id after resetProcess() rotates it for fresh CLI context.
    this.sessionId = existingSessionId ?? id;
    this.env.deps.registerSessionAlias(this.sessionId, this.id);
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
    this._kind = kind;
    this.parentConversationId = parentConversationId;
    this.resumedFromConversationId = resumedFromConversationId;
    this.observedModel = observedModel;
    this.title = title ?? undefined;
    this._titleSource = this.title !== undefined ? 'custom' : null;
    this.swarmDebugPrefix = kind.t === 'chat' ? swarmDebugPrefix : null;
    this._policy = this.policyFor(this._kind, {
      memorySnapshot: createMemorySnapshot(buddyBriefing, buddyMemoryGeneration),
      audienceKey: existingSessionId ? (opts.existingSessionAudienceKey ?? null) : null,
    });
    this.providerUsage = opts.existingProviderUsage ?? null;
    this.subAgents = [];
    // Mark session as started if loading existing (use --resume for next message)
    this._hasStartedSession = existingSessionId !== undefined;
    this.runner = new TurnRunner(this, env.runnerPorts);
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
  private policyFor(kind: ConversationKind, seed: BuddyTurnPolicySeed): TurnPolicy {
    return matchConversationKind<TurnPolicy>(kind, {
      chat: () => new ChatTurnPolicy(() => this.swarmDebugPrefix),
      buddy: (buddyKind) => new BuddyTurnPolicy(buddyKind, this.policyHost(), this.env.deps, seed),
      builder: () => new BuddyBuilderTurnPolicy(this.policyHost(), this.env.deps),
      // A swarm worker is an external oompa transcript; typing into it is a plain chat turn.
      worker: () => new ChatTurnPolicy(() => null),
    });
  }

  private policyHost(): BuddyPolicyHost {
    return {
      id: this.id,
      view: this,
      visibility: () => (this._kind.t === 'buddy' ? this._kind.visibility : 'foreground'),
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
    return this.env.deps.persistCurrentSession(this, sessionId, audienceKey);
  }

  // Custom beats ai; a hydrated title counts as custom (the backfill resolved precedence).
  observeTitle(title: string, source: 'ai' | 'custom'): void {
    const next = title.trim();
    if (!next) return;
    if (source !== 'custom' && this._titleSource === 'custom') return;
    if (this.title === next) return;
    this.title = next;
    this._titleSource = source;
    this.publish({ t: 'label', label: this.label() });
  }

  runCoordinationMessage(
    content: string,
    context: BuddyContext,
    claimToken: string,
    onDrained?: CoordinationDrained,
    onAdmitted?: (config: ResolvedExecutionConfig) => void
  ): Promise<string> {
    if (this._kind.t !== 'buddy' || this._kind.visibility !== 'background') {
      return Promise.reject(new Error('Automated Buddy inputs require a background conversation'));
    }
    if (this.process || this.isRunning || this.turnQueue.length) {
      return Promise.reject(new Error('Conversation is busy'));
    }
    return this._policy.runCoordination(content, context, claimToken, onDrained, onAdmitted);
  }

  sendMessage(content: string, ownerInput?: OwnerInput): void {
    if (this.refusesUserInput()) return;
    this.sendMessageInternal(sameEitherWay(content), ownerInput ?? unknownInput());
  }

  // Both wordings: resume is decided at admission (docs/turn-lifecycle.md#session-relative-prompt).
  sendSessionRelativeMessage(prompt: SessionRelativePrompt, input: SeatTurnInput): void {
    if (this.refusesUserInput()) return;
    this.sendMessageInternal(prompt, input);
  }

  /** Coordinator-only admission for an owned automation occurrence (see BuddyTurnPolicy). */
  sendAutomationMessage(content: string): void {
    this._policy.sendAutomation(content);
  }

  /** Automation transcripts are read-only: refuse (with a system line) and report it. */
  private refusesUserInput(): boolean {
    if (this._policy.acceptsUserInput) return false;
    this.refuseAutomationTranscript();
    return true;
  }

  private refuseAutomationTranscript(message?: string): void {
    this.addSystemMessage(
      message ??
        'This automation transcript is read-only. Start an ordinary Buddy conversation to continue working.'
    );
  }

  private addSystemMessage(content: string): void {
    this.appendMessage({ role: 'system', content, timestamp: new Date() });
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
    // Worded at admission, by the decision the runner resumes on.
    const resume = this.resumesProviderSession(forkSourceSessionId);
    const content = resume ? prompt.resumed : prompt.fresh;

    this.runner.beginAttempt();
    const executionConfig = this.preflightExecution();
    if (!executionConfig) return;

    // History keeps the clean text; the provider gets the policy's prompt (none after a
    // session fork: the CLI has the source transcript).
    const cliContent =
      forkSourceSessionId && !refreshBriefing
        ? content
        : this._policy.providerPrompt({
            content,
            messageCount: this.messages.length,
            hasStartedSession: this._hasStartedSession,
            refreshBriefing,
          });

    this.appendMessage({ role: 'user', content, timestamp: new Date() });
    this._policy.admitted(input, content);
    // Provenance comes from the host producer, never transcript text.
    this.runner.start({
      content: cliContent,
      config: executionConfig,
      forkSourceSessionId,
      resume,
      input,
    });
  }

  // Soft handoff, upgraded to session inheritance by capability, never rejecting the send
  // (docs/turn-lifecycle.md#chat-fork; guard `same-provider fork on a fork-incapable harness …`).
  private chatForkSource():
    | { t: 'none' }
    | { t: 'session'; sessionId: string }
    | { t: 'rejected'; message: string } {
    if (this._hasStartedSession || this.messages.length > 0 || !this.resumedFromConversationId)
      return { t: 'none' };
    const source = this.env.deps.getConversation(this.resumedFromConversationId);
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
  }

  private preflightExecution(): ResolvedExecutionConfig | undefined {
    // docs/turn-lifecycle.md#preflight
    const resolution = this.refreshConfigResolution();
    if (resolution.status !== 'resolved') {
      this.refusePreflight(`Configuration unavailable: ${resolution.error.message}`);
      return undefined;
    }
    try {
      this._policy.preflight(resolution.value.provider);
    } catch (error) {
      this.refusePreflight(error instanceof Error ? error.message : String(error));
      return undefined;
    }
    return resolution.value;
  }

  // No child, so no later completion: terminalise here (docs/turn-lifecycle.md#one-terminal-path).
  private refusePreflight(errorMessage: string): void {
    console.error(`[${this.id}] ${errorMessage}`);
    this.appendMessage({
      role: 'system',
      content: errorMessage,
      timestamp: new Date(),
      completionReason: 'error',
    });
    if (this.turnQueue.releaseHead()) this.broadcastQueue();
    this.publish({ t: 'config', state: this.configState(), commandId: null });
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
    this.sessionId = this.env.deps.createSessionId();
    this._policy.sessionReset();
    // A new session is an empty context: no carried-over meter.
    this.providerUsage = null;
    this.env.deps.unregisterSessionAlias(oldSessionId, { keepKnown: true });
    this.env.deps.registerSessionAlias(this.sessionId, this.id);
    // Provisional until the provider confirms it; never persisted as resumable here.
    this._hasStartedSession = false;
    console.log(
      `[${this.id}] Reset session: ${oldSessionId.substring(0, 8)}... -> ${this.sessionId.substring(0, 8)}...`
    );
  }

  expireCoordinationRun(): void {
    this.runner.timeout('max');
  }

  broadcastQueue(): void {
    this.publish({ t: 'queue', queue: this.queue });
    this.publishRun();
  }

  /** The one run-state field: streaming implies running; `queued` = work waiting, no process. */
  runState(): RunState {
    if (this.isStreaming) return 'streaming';
    if (this.isRunning) return 'running';
    return this.turnQueue.length > 0 ? 'queued' : 'idle';
  }

  /** Send a `run` patch when the run state changed since the last one sent. */
  publishRun(): void {
    const run = this.runState();
    if (run === this._publishedRun) return;
    this._publishedRun = run;
    this.publish({ t: 'run', run });
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

  private logEntry(what: string, { message }: QueueEntry): void {
    console.log(
      `[${this.id}] ${what} id=${message.id.substring(0, 8)}, queueDepth=${this.turnQueue.length}, contentLen=${message.content.length}, preview="${formatLogPreview(message.content)}"`
    );
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
    if (this.refusesUserInput()) return;
    const entry = this.createQueueEntry(prompt, input);
    this.turnQueue.pushBack(entry);
    this.logEntry('Queued message', entry);
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
    if (this.refusesUserInput()) return;
    this.retireInFlightHead();

    if (this.process) {
      this.stop();
    }

    const entry = this.createQueueEntry(sameEitherWay(content), ownerInput ?? unknownInput());
    this.turnQueue.pushFront(entry);
    this.logEntry('interrupt_and_send', entry);
    this.broadcastQueue();
    this.processQueue();
  }

  /**
   * Move a pending queued message to the front so it runs next,
   * interrupting the active turn when there is one. Unknown or non-pending
   * ids are a no-op, like cancelQueuedMessage.
   */
  promoteQueuedMessage(messageId: string): void {
    if (this.refusesUserInput()) return;
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
    this.logEntry('processQueue sending', next);
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

  applyConfigState(state: ConversationConfigState): void {
    this.config = state.config;
    this.configRevision = state.revision;
    this.configResolution = state.resolution;
  }

  refreshConfigResolution(): ConfigResolution {
    this.configResolution = resolveConfigAgainstProviderCatalog(this.config, this.effectiveConfig);
    return this.configResolution;
  }

  // Only before the first turn: session files and resume ids are provider-specific.
  canChangeProvider(): boolean {
    return (
      !this._hasStartedSession &&
      this.messages.length === 0 &&
      this.turnQueue.length === 0 &&
      !this.isRunning &&
      !this.isStreaming
    );
  }

  configState(): ConversationConfigState {
    return {
      config: this.config,
      revision: this.configRevision,
      resolution: this.configResolution,
    };
  }

  /** Provider title, else the first user line with hidden envelopes stripped. */
  label(): string {
    return this.env.history.fields(this).label;
  }

  // Pattern: patches-not-snapshots (docs/patterns.md#patches-not-snapshots)
  toRow(): ConversationRow {
    return {
      id: this.id,
      kind: rowKind(this._kind),
      parent: this.parentConversationId,
      resumedFrom: this.resumedFromConversationId,
      provider: this.provider,
      cwd: this.workingDirectory,
      ...this.env.history.fields(this),
      run: this.runState(),
      done: this.done,
    };
  }

  toDetail(): ConversationDetail {
    return {
      id: this.id,
      sessionId: this.sessionId,
      config: this.configState(),
      queue: this.queue,
      subAgents: this.subAgents,
      latestTurn: { observedModel: this.observedModel, usage: this.providerUsage },
      swarmDebugPrefix: this.swarmDebugPrefix,
    };
  }

  appendMessage(message: Message): void {
    this.messages.push(message);
    this.env.deps.broadcast({
      type: 'message',
      conversationId: this.id,
      role: message.role,
      content: message.content,
    });
    this.publishActivity();
  }

  publishActivity(): void {
    const { activityAt, messageCount } = this.env.history.fields(this);
    this.publish({ t: 'activity', activityAt, messageCount });
  }

  /** Turn end: the new history length and the provider's observations. */
  publishTurnEnd(): void {
    this.publishActivity();
    this.publish({
      t: 'turn',
      latestTurn: { observedModel: this.observedModel, usage: this.providerUsage },
    });
  }

  publish(patch: RowPatch): void {
    this.env.deps.broadcast({ type: 'patch', id: this.id, patch });
  }

  publishRow(): void {
    this.env.deps.broadcast({ type: 'rows', ...encodeRows([this.toRow()]) });
  }
}

// The crate's rule (markers.rs `label`): 60 UTF-16 units, whitespace folded onto one line.
const LABEL_MAX_UNITS = 60;
const HIDDEN_ENVELOPE_RE = /<!--[\s\S]*?-->/g;
const OOMPA_TAG_RE = /^\[oompa[^\]]*\]\s*/i;

/**
 * The label of a conversation whose transcript the ingest store has not read yet: provider
 * title, else the first user message with hidden `<!-- ... -->` envelopes and the oompa tag
 * removed, folded onto one line. It is the crate's rule for a listed row, so the label does not
 * change when the transcript lands (T13b S2; until then the runtime kept line 1 at 80 chars and
 * the list folded every line at 60, so multi-line prompts showed two labels).
 */
export function conversationLabel(title: string | undefined, messages: readonly Message[]): string {
  if (title?.trim()) return title.trim();
  const source = messages.find((message) => message.role === 'user') ?? messages[0];
  if (!source) return 'New conversation';
  const visible = source.content.replace(HIDDEN_ENVELOPE_RE, '').trim().replace(OOMPA_TAG_RE, '');
  const line = visible.split(/\s+/).filter(Boolean).join(' ');
  if (!line) return 'New conversation';
  return line.length > LABEL_MAX_UNITS ? `${line.slice(0, LABEL_MAX_UNITS - 1)}…` : line;
}
