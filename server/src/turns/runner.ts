import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import type { ExecuteCommandRequest, UnifiedAgentEvent, executeCommand } from '@nbardy/agent-cli';
import type {
  Message,
  ProviderTurnUsage,
  ResolvedExecutionConfig,
  RowPatch,
  ServerMessageInput,
  SubAgent,
} from '@unleashd/shared';
import {
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
import { type SwarmObservers, watchSwarmRuns } from '../swarm';
import { type BackgroundWait, backgroundWaitFor } from './background-wait';
import type { TurnInput } from './input';
import type { TurnPolicy } from './policy';
import type { QueueEntry, TurnQueue } from './queue';
import {
  type SubAgentFold,
  type SubAgentHost,
  failRunningSubAgents,
  subAgentFoldFor,
} from './subagents';
import { formatToolUse, isCompletionOnlyToolUse } from './tool-format';
import {
  type TurnTimeoutKind,
  TurnWatchdog,
  describeTurnTimeout,
  turnAttemptActivityFromEvent,
} from './watchdog';

/**
 * Spawns one provider turn through agent-cli and folds its `UnifiedAgentEvent`
 * stream into the conversation (messages, streaming status, sub-agents,
 * session binding, usage). Events are typed once, by agent-cli; the former
 * ProviderEvent re-typing layer is gone (T08 S1). No Buddy code and no
 * provider branching live here: kind-specific behavior arrives through the
 * conversation's TurnPolicy, harness differences through the sub-agent fold
 * table and agent-cli.
 */

type ToolUseEvent = Extract<UnifiedAgentEvent, { type: 'tool.use' }>;
type CompletionReason = Extract<UnifiedAgentEvent, { type: 'turn.complete' }>['reason'];
type AttemptState = 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

const VERBOSE = process.env.VERBOSE === '1' || process.argv.includes('--verbose');
const AGENT_CLI_DEBUG_EVENTS = process.env.AGENT_CLI_DEBUG_EVENTS === '1';
const ATTEMPT_ACTIVITY_INTERVAL_MS = 5_000;
const STOP_KILL_GRACE_MS = 3000;

/** The conversation as one turn sees it. */
export interface TurnRunnerHost {
  readonly id: string;
  readonly workingDirectory: string;
  readonly resumedFromConversationId: string | null;
  sessionId: string;
  messages: Message[];
  subAgents: SubAgent[];
  process: ChildProcess | null;
  isRunning: boolean;
  isStreaming: boolean;
  providerUsage: ProviderTurnUsage | null;
  readonly policy: TurnPolicy;
  readonly turnQueue: TurnQueue;
  markSessionStarted(): void;
  /** A provider-generated title; the conversation owns custom-over-ai precedence. */
  observeTitle(title: string, source: 'ai' | 'custom'): void;
  persistSession(sessionId: string, audienceKey: string | undefined): Promise<void>;
  broadcastQueue(): void;
  processQueue(): void;
  emit(event: string, ...args: string[]): void;
  /** Push one message: the `message` event plus the row's activity patch. */
  appendMessage(message: Message): void;
  publish(patch: RowPatch): void;
  /** One `run` patch when isRunning/isStreaming/queue moved the run state. */
  publishRun(): void;
  /** Turn end: activity + the latest turn's observations (usage, model). */
  publishTurnEnd(): void;
}

/** The host server's ports a turn uses. */
export interface TurnRunnerPorts {
  broadcast(data: ServerMessageInput | TurnBroadcast): void;
  registerSessionAlias(sessionId: string | null | undefined, conversationId: string): void;
  unregisterSessionAlias(
    sessionId: string | null | undefined,
    options?: { keepKnown?: boolean }
  ): void;
  clearExternalRunningStatus(...ids: Array<string | null | undefined>): void;
  clearLocalCompletionSuppression(...ids: Array<string | null | undefined>): void;
  markLocalCompletionSuppression(...ids: Array<string | null | undefined>): void;
  persistSessionUsage?(
    conversationId: string,
    sessionId: string,
    usage: ProviderTurnUsage
  ): Promise<void>;
  createSessionId(): string;
  executeTurn: typeof executeCommand;
  turnAttempts: RuntimeTurnAttemptObserver;
  swarmObservers: SwarmObservers;
}

/** Streaming frames that are not (yet) part of the shared ServerMessage schema. */
export type TurnBroadcast =
  | { type: 'chunk'; conversationId: string; text: string }
  | { type: 'message_complete'; conversationId: string; reason?: CompletionReason }
  | {
      type: 'message';
      conversationId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
    };

export class TurnRunner {
  // Per-run token: every late event/completion from a replaced handle is ignored.
  private runToken = 0;
  private stopTurn: ((signal?: NodeJS.Signals) => void) | null = null;
  private activeDrain: Promise<void> | null = null;
  private stderrBuffer = '';
  // Whether assistant text or a tool event reached the unified stream.
  private sawMeaningfulOutput = false;
  // When true, turn.complete (or a timeout) already performed the user-visible
  // cleanup. The close handler then takes the fast path, while crash/kill/error
  // paths where it never fired still run the full cleanup.
  private completedCleanly = false;
  // A timeout or stop already finalized the user-visible turn: later provider
  // events are dropped. A normal turn.complete does NOT seal. On resume Claude
  // can emit a result for drained task-notifications before the prompt's own
  // answer, and that answer must still be recorded (493c1c7; guard:
  // conversation-runtime.test.ts "an early turn.complete does not drop …").
  private sealed = false;
  private terminalCauseHint: TurnTerminalCause | null = null;
  // The provider's own error text. It names the failure on the terminal path
  // instead of the generic "Provider reported an error".
  private providerFailureMessage: string | null = null;
  private stopCause: 'user_stop' | 'server_restart' | null = null;
  private processStartTime = 0;
  private lastAttemptActivityAt = 0;
  private lastAttemptActivitySource: TurnActivitySource | null = null;
  private lastObservedActivity: TurnAttemptActivity | null = null;
  // Set when providerUsage changed during the active turn and has not yet been
  // persisted. Avoids a CAS write per streamed usage event.
  private providerUsageDirty = false;
  private activeAttemptId: string | null = null;
  private nextAttempt: { attemptId: string; queueMessageId?: string } | null = null;
  // Chosen once per turn from the harness capability table (turns/subagents.ts).
  private subAgentFold: SubAgentFold = subAgentFoldFor('claude');
  // Chosen with it: how long the harness may wait silently on background tasks it launched.
  private backgroundWait: BackgroundWait = backgroundWaitFor('claude');
  // This turn's subscription to its folder's swarm observer (swarm/observer.ts).
  private stopSwarmWatch: (() => void) | null = null;
  // Bridge / provider-idle / max-runtime clocks. The max budget is passed
  // explicitly: foreground Buddy turns must never inherit a shorter claim
  // default (incident 2026-09-10, see turns/watchdog.ts).
  private readonly watchdog = new TurnWatchdog(
    {
      bridgeMs: TURN_BRIDGE_TIMEOUT_MS,
      providerIdleMs: TURN_PROVIDER_IDLE_TIMEOUT_MS,
      maxRuntimeMs: TURN_MAX_RUNTIME_MS,
    },
    (kind) => this.timeout(kind)
  );
  private readonly subAgentHost: SubAgentHost;

  constructor(
    private readonly host: TurnRunnerHost,
    private readonly ports: TurnRunnerPorts
  ) {
    this.subAgentHost = {
      conversationId: host.id,
      get agents() {
        return host.subAgents;
      },
      changed: (agent) => host.publish({ t: 'subagent', subAgent: { ...agent } }),
      newId: () => ports.createSessionId(),
    };
  }

  // --- attempt records ---------------------------------------------------------

  /** The queue head about to be sent reuses its registered attempt. */
  prepareQueuedAttempt(entry: QueueEntry): void {
    if (!entry.attemptId) {
      entry.attemptId = crypto.randomUUID();
      this.ports.turnAttempts.queued({
        attemptId: entry.attemptId,
        conversationId: this.host.id,
        queueMessageId: entry.message.id,
        providerSessionId: this.host.sessionId,
      });
    }
    this.nextAttempt = { attemptId: entry.attemptId, queueMessageId: entry.message.id };
  }

  /** Make the prepared (or a new) attempt the active one. */
  beginAttempt(): void {
    const prepared = this.nextAttempt;
    this.nextAttempt = null;
    if (prepared) {
      this.activeAttemptId = prepared.attemptId;
      return;
    }
    const attemptId = crypto.randomUUID();
    this.ports.turnAttempts.queued({
      attemptId,
      conversationId: this.host.id,
      providerSessionId: this.host.sessionId,
    });
    this.activeAttemptId = attemptId;
  }

  finishAttempt(state: AttemptState, terminalCause: TurnTerminalCause): void {
    this.host.policy.attemptFinished(terminalCause);
    if (!this.activeAttemptId) return;
    this.ports.turnAttempts.terminal({
      attemptId: this.activeAttemptId,
      state,
      terminalCause,
      providerSessionId: this.host.sessionId,
    });
    this.host.turnQueue.forgetAttempt(this.activeAttemptId);
    this.activeAttemptId = null;
    this.terminalCauseHint = null;
    this.providerFailureMessage = null;
    this.stopCause = null;
  }

  cancelQueuedAttempt(entry: QueueEntry): void {
    if (!entry.attemptId) return;
    this.ports.turnAttempts.terminal({
      attemptId: entry.attemptId,
      state: 'cancelled',
      terminalCause: 'user_stop',
      providerSessionId: this.host.sessionId,
    });
    entry.attemptId = null;
  }

  createQueuedAttempt(queueMessageId: string): string {
    const attemptId = crypto.randomUUID();
    this.ports.turnAttempts.queued({
      attemptId,
      conversationId: this.host.id,
      queueMessageId,
      providerSessionId: this.host.sessionId,
    });
    return attemptId;
  }

  drain(): Promise<void> | null {
    return this.activeDrain;
  }

  // --- start ---------------------------------------------------------------------

  start(turn: {
    content: string;
    config: ResolvedExecutionConfig;
    forkSourceSessionId: string | undefined;
    resume: boolean;
    input: TurnInput;
  }): void {
    const host = this.host;
    if (host.process || host.isRunning) {
      console.warn(`[${host.id}] Already processing a message, ignoring`);
      return;
    }
    const runToken = ++this.runToken;

    // This session is now being handled locally; clear any stale external flags.
    this.ports.clearExternalRunningStatus(host.id, host.sessionId);
    this.ports.clearLocalCompletionSuppression(host.id, host.sessionId);

    const forking = !!turn.forkSourceSessionId;
    const executionMode = forking ? 'fork' : turn.resume ? 'resume' : 'fresh';
    console.log(
      `[${host.id}] Spawning ${turn.config.provider} (mode=${executionMode}, provider-session=${host.sessionId.substring(0, 8)}...${turn.forkSourceSessionId ? `, fork-source-session=${turn.forkSourceSessionId.substring(0, 8)}...` : ''}${host.resumedFromConversationId ? `, parent-conversation=${host.resumedFromConversationId.substring(0, 8)}...` : ''})`
    );
    console.log(`[${host.id}] Message: "${turn.content.substring(0, 50)}"`);

    this.stderrBuffer = '';
    this.sawMeaningfulOutput = false;
    this.completedCleanly = false;
    this.sealed = false;
    this.terminalCauseHint = null;
    this.providerFailureMessage = null;
    this.stopCause = null;
    this.processStartTime = Date.now();
    this.lastAttemptActivityAt = 0;
    this.lastAttemptActivitySource = null;
    this.lastObservedActivity = null;
    this.subAgentFold = subAgentFoldFor(turn.config.provider);
    this.backgroundWait = backgroundWaitFor(turn.config.provider);
    if (this.activeAttemptId) {
      this.ports.turnAttempts.starting(this.activeAttemptId);
      this.ports.turnAttempts.activity(
        this.activeAttemptId,
        {
          source: 'runtime',
          providerEventType: `execution.${executionMode}`,
          providerEventSource: host.resumedFromConversationId
            ? `parent-conversation:${host.resumedFromConversationId}`
            : 'unleashd.runtime',
        },
        host.sessionId
      );
    }

    let handle: ReturnType<typeof executeCommand>;
    try {
      const extras = host.policy.startTurn(turn.input, turn.config);
      // One request shape for every harness. Effort is a pass-through string:
      // configuration validation rejects levels the provider does not accept,
      // and agent-cli maps it to a flag only for harnesses that take one
      // (execute.ts), so the cast covers only its `never` typing on the rest.
      // Replaces three identical per-provider branches (T08 S2). Guard:
      // `every harness receives its resolved effort in one request shape`.
      handle = this.ports.executeTurn({
        harness: turn.config.provider,
        mode: 'conversation',
        prompt: turn.content,
        cwd: host.workingDirectory,
        model: turn.config.modelId,
        resumeSessionId: turn.resume ? host.sessionId : undefined,
        forkSessionId: forking ? turn.forkSourceSessionId : undefined,
        yolo: true,
        detached: true,
        debugRawEvents: AGENT_CLI_DEBUG_EVENTS,
        reasoningEffort: turn.config.reasoningEffort,
        ...extras,
      } as ExecuteCommandRequest);
    } catch (error) {
      host.policy.spawnFailed();
      this.finishAttempt('failed', 'spawn_failed');
      const message = error instanceof Error ? error.message : String(error);
      // An automation subscribes to this event before calling sendMessage(). A
      // provider/configuration failure can happen synchronously, before there
      // is a child process whose completion could reject the run. Keep this
      // signal at the conversation boundary so every caller sees one terminal
      // result. See agent_notes/2026-08-24_automation-execution-ownership-design.md.
      host.emit('buddy-turn-failed', message);
      throw error;
    }

    host.policy.spawned(turn.input, {
      attemptId: this.activeAttemptId ?? crypto.randomUUID(),
      messageStart: Math.max(0, host.messages.length - 1),
    });
    host.process = handle.child;
    this.stopTurn = handle.stop;
    host.isRunning = true;
    if (this.activeAttemptId) this.ports.turnAttempts.running(this.activeAttemptId, host.sessionId);
    host.emit('buddy-turn-started');
    host.markSessionStarted();
    this.startWatchdogs();
    this.broadcastStatus();

    const fold = new EventFold(this, runToken);
    const eventConsumption = fold.consume(handle.events).catch((err: unknown) => {
      if (runToken !== this.runToken) return;
      fold.streamError = err instanceof Error ? err : new Error(String(err));
      console.error(`[${host.id}] Event stream error: ${fold.streamError.message}`);
      this.terminalCauseHint = 'provider_error';
      this.surfaceError(normalizeProviderErrorMessage(fold.streamError.message));
    });

    const turnDrain = handle.completed
      .then(async (completion) => {
        if (runToken !== this.runToken) return;
        // `completed` describes child-process termination, not consumption of
        // the normalized event stream. In particular, session persistence is
        // asynchronous. Releasing ownership before that consumer drains can
        // start the next queued turn while text/session/turn.complete events
        // from this one are still being applied. One joined terminal path is
        // simpler than trying to make every event handler replay-safe. See
        // agent_notes/2026-08-24_automation-execution-ownership-design.md.
        await eventConsumption;
        if (runToken !== this.runToken) return;
        await this.settle(completion, fold);
      })
      .catch((err: unknown) => {
        if (runToken !== this.runToken) return;
        this.completionBroke(err);
      });
    this.activeDrain = turnDrain;
    void turnDrain.finally(() => {
      if (this.activeDrain === turnDrain) this.activeDrain = null;
    });
  }

  // --- event fold (called by EventFold) ----------------------------------------

  isCurrent(runToken: number): boolean {
    return runToken === this.runToken;
  }

  get streamClosed(): boolean {
    return this.sealed;
  }

  async bindSession(sessionId: string): Promise<void> {
    const host = this.host;
    if (sessionId !== host.sessionId) console.log(`[${host.id}] Session captured: ${sessionId}`);
    const oldSessionId = host.sessionId;
    host.sessionId = sessionId;
    if (oldSessionId !== sessionId) {
      this.ports.unregisterSessionAlias(oldSessionId, { keepKnown: true });
    }
    this.ports.registerSessionAlias(sessionId, host.id);
    await host.persistSession(sessionId, host.policy.audienceKey());
    if (this.activeAttemptId) {
      this.ports.turnAttempts.bindProviderSession(this.activeAttemptId, sessionId);
    }
    host.publish({ t: 'session', sessionId });
  }

  noteActivity(event: UnifiedAgentEvent): void {
    if (!this.host.isRunning) return;
    const now = Date.now();
    const activity = turnAttemptActivityFromEvent(event);
    this.lastObservedActivity = activity;
    if (
      this.activeAttemptId &&
      (now - this.lastAttemptActivityAt >= ATTEMPT_ACTIVITY_INTERVAL_MS ||
        this.lastAttemptActivitySource !== activity.source)
    ) {
      this.lastAttemptActivityAt = now;
      this.lastAttemptActivitySource = activity.source;
      this.ports.turnAttempts.activity(this.activeAttemptId, activity, this.host.sessionId);
    }
    this.watchdog.note(event);
    this.ports.swarmObservers.poke(this.host.workingDirectory);
  }

  sawOutput(): void {
    this.sawMeaningfulOutput = true;
  }

  observeTitle(title: string, source: 'ai' | 'custom'): void {
    this.host.observeTitle(title, source);
  }

  logProgress(event: Extract<UnifiedAgentEvent, { type: 'progress' }>): void {
    // Always log provider warnings (network retries, etc.) — operational
    // signals, not debug noise. Other progress events only log with debug on.
    if (event.source === 'gemini.warning') {
      console.warn(
        `[${this.host.id}] provider warning:`,
        event.data?.message ?? JSON.stringify(event)
      );
    } else if (AGENT_CLI_DEBUG_EVENTS) {
      console.error(`[${this.host.id}] progress:`, JSON.stringify(event));
    }
  }

  noteStderr(text: string): void {
    this.stderrBuffer = (this.stderrBuffer + text).slice(-4096);
    if (VERBOSE) console.error(`[${this.host.id}] stderr:`, text);
  }

  noteFailure(cause: 'out_of_tokens' | 'provider_error', message: string): void {
    this.terminalCauseHint = cause;
    this.providerFailureMessage = normalizeProviderErrorMessage(message);
    this.surfaceError(this.providerFailureMessage);
  }

  noteUsage(usage: Omit<ProviderTurnUsage, 'observedAt'>): void {
    // Provider-counted truth for the request that just completed. agent-cli
    // already canonicalised the per-harness conventions and excluded claude's
    // turn-aggregate `result` usage and its subagent measurements, so take this
    // verbatim — re-deriving it here would reintroduce the double-counting
    // those parsers avoid. Last write wins within a turn: a turn can issue
    // several requests (tool loops), and the latest is the live context size.
    // It can go DOWN when the provider compacts; that is the signal, not a bug.
    this.host.providerUsage = { ...usage, observedAt: new Date().toISOString() };
    this.providerUsageDirty = true;
  }

  ensureAssistantMessage(): void {
    const host = this.host;
    const lastMsg = host.messages[host.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') return;
    console.log(`[${host.id}] Creating NEW assistant message (msg #${host.messages.length + 1})`);
    host.appendMessage({ role: 'assistant', content: '', timestamp: new Date() });
    if (!host.isStreaming) {
      host.isStreaming = true;
      this.broadcastStatus();
    }
  }

  appendText(text: string): void {
    this.ensureAssistantMessage();
    const currentMsg = this.host.messages[this.host.messages.length - 1];
    if (currentMsg.role === 'assistant') currentMsg.content += text;
    if (VERBOSE)
      console.log(
        `[${this.host.id}] chunk (${text.length} chars): "${text.substring(0, 30).replace(/\n/g, '\\n')}..."`
      );
    this.ports.broadcast({ type: 'chunk', conversationId: this.host.id, text });
  }

  applyToolUse(event: ToolUseEvent): void {
    this.ensureAssistantMessage();
    this.backgroundWait.toolUse(event, this.watchdog);
    if (this.subAgentFold.toolUse(this.subAgentHost, event) === 'hide') return;
    // Normalize tool line formatting across providers (Claude/Gemini/Codex).
    // Suppress Codex shell completion-only events to avoid duplicate lines.
    if (isCompletionOnlyToolUse(event.name, event.input, event.displayText)) return;
    const formattedTool = formatToolUse(event.name, event.input, event.displayText);
    if (!formattedTool) return;
    const currentMsg = this.host.messages[this.host.messages.length - 1];
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
    this.ports.broadcast({ type: 'chunk', conversationId: this.host.id, text: chunkText });
  }

  applyTaskStarted(event: Extract<UnifiedAgentEvent, { type: 'task.started' }>): void {
    this.backgroundWait.taskStarted(event);
  }

  applyTaskFinished(event: Extract<UnifiedAgentEvent, { type: 'task.finished' }>): void {
    this.backgroundWait.taskFinished(event, this.watchdog);
  }

  applyToolResult(output: unknown): void {
    const content = this.host.policy.formatToolResult(output);
    if (content) this.appendText(`\n${content}\n`);
  }

  /** turn.complete: close the UI stream. Execution ownership ends only at drain. */
  completeMessage(reason: CompletionReason): void {
    const host = this.host;
    // Clear watchdog timers immediately — the turn completed normally.
    // Without this they dangle until process close, risking a spurious timeout.
    this.clearWatchdogs();
    // The attempt is terminalized only after child exit and event EOF join. See
    // invariant I8 and its alternatives in the ownership design note.
    const completedAt = new Date();
    const lastMsg = host.messages[host.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.completedAt) {
      lastMsg.completedAt = completedAt;
      lastMsg.completionReason = reason;
    }
    this.subAgentFold.parentCompleted(this.subAgentHost, completedAt);

    // Broadcast message_complete BEFORE status(isStreaming=false). The client's
    // message_complete handler flushes its chunk buffer; the last buffered text
    // must land before isStreaming=false hides the typing dots.
    this.ports.broadcast({ type: 'message_complete', conversationId: host.id, reason });

    // turn.complete means the assistant has finished this turn from the user's
    // perspective; clear busy state now instead of waiting for child teardown.
    host.isStreaming = false;
    host.isRunning = false;
    this.ports.clearExternalRunningStatus(host.id, host.sessionId);
    this.ports.markLocalCompletionSuppression(host.id, host.sessionId);
    this.broadcastStatus();
    host.publishTurnEnd();
    this.completedCleanly = true;
    host.policy.streamCompleted();
  }

  /** Surface provider errors (usage limits, auth failures, turn errors) as a system message. */
  surfaceError(message: string): void {
    console.error(`[${this.host.id}] Provider error: ${message}`);
    this.host.appendMessage({ role: 'system', content: message, timestamp: new Date() });
  }

  // --- drain -------------------------------------------------------------------------

  private async settle(
    completion: {
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      sessionId: string;
      reason: CompletionReason;
    },
    fold: EventFold
  ): Promise<void> {
    const host = this.host;
    const { exitCode, signal, sessionId, reason } = completion;
    this.clearWatchdogs();
    if (sessionId && sessionId !== host.sessionId) {
      const oldSessionId = host.sessionId;
      host.sessionId = sessionId;
      this.ports.unregisterSessionAlias(oldSessionId, { keepKnown: true });
      this.ports.registerSessionAlias(sessionId, host.id);
      await host.persistSession(sessionId, undefined);
      if (this.activeAttemptId) {
        this.ports.turnAttempts.bindProviderSession(this.activeAttemptId, sessionId);
      }
    }

    // Flush once per turn rather than per usage event: a tool loop emits one per
    // request, and each write is a CAS round-trip on the config record. Filed
    // against the session settled just above, so a mid-turn rotation records the
    // usage under the session that actually holds that context.
    if (this.providerUsageDirty && host.providerUsage) {
      this.providerUsageDirty = false;
      try {
        await this.ports.persistSessionUsage?.(host.id, host.sessionId, host.providerUsage);
      } catch (error) {
        // The meter is observability. Losing a usage write must never fail a
        // turn that otherwise succeeded; the session-file parser still covers
        // this session on the next read.
        console.warn(
          `[${host.id}] Failed to persist provider usage:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    const durationMs = Date.now() - this.processStartTime;
    console.log(
      `[${host.id}] Process closed with code ${exitCode} signal=${signal ?? 'none'} (reason=${reason}) after ${durationMs}ms`
    );
    if (this.completedCleanly) {
      this.settleCleanStream(completion, fold);
      return;
    }
    this.settleCrash(completion, durationMs);
  }

  /** turn.complete (or a timeout) already closed the stream: release ownership. */
  private settleCleanStream(
    completion: { exitCode: number | null; reason: CompletionReason },
    fold: EventFold
  ): void {
    const host = this.host;
    host.policy.revoke();
    host.process = null;
    this.stopTurn = null;
    this.ports.clearExternalRunningStatus(host.id, host.sessionId);
    this.ports.markLocalCompletionSuppression(host.id, host.sessionId);
    if (host.turnQueue.finishHead()) host.broadcastQueue();
    const completionFailure =
      this.providerFailureMessage ??
      fold.streamError?.message ??
      fold.completionError ??
      (this.terminalCauseHint === 'out_of_tokens'
        ? 'Provider ran out of tokens'
        : this.terminalCauseHint === 'provider_error'
          ? 'Provider reported an error'
          : null);
    if (completionFailure) {
      if (this.stopCause) {
        this.finishAttempt(
          this.stopCause === 'server_restart' ? 'interrupted' : 'cancelled',
          this.stopCause
        );
      } else if (this.terminalCauseHint === 'out_of_tokens') {
        this.finishAttempt('failed', 'out_of_tokens');
      } else {
        this.finishAttempt('failed', 'provider_error');
      }
      host.emit('buddy-turn-failed', completionFailure);
    } else {
      // Enqueue memory review before completion listeners or processQueue can
      // start another turn.
      if (completion.reason === 'success' && completion.exitCode === 0 && !this.stopCause) {
        host.policy.reviewCompleted(host.messages);
      }
      this.finishAttempt('succeeded', 'provider_complete');
      const completedAssistant = [...host.messages]
        .reverse()
        .find((message) => message.role === 'assistant');
      host.emit('buddy-turn-complete', completedAssistant?.content ?? '');
    }
    host.processQueue();
  }

  /** The process ended without turn.complete: crash, kill, OOM or a silent exit. */
  private settleCrash(
    completion: { exitCode: number | null; reason: CompletionReason },
    durationMs: number
  ): void {
    const host = this.host;
    const { exitCode, reason } = completion;
    if (reason === 'killed' && this.stopCause) {
      this.finishAttempt(
        this.stopCause === 'server_restart' ? 'interrupted' : 'cancelled',
        this.stopCause
      );
    } else if (reason === 'out_of_tokens' || this.terminalCauseHint === 'out_of_tokens') {
      this.finishAttempt('failed', 'out_of_tokens');
    } else if (this.terminalCauseHint === 'provider_error') {
      this.finishAttempt('failed', 'provider_error');
    } else if (reason === 'killed') {
      this.finishAttempt('failed', 'process_killed');
    } else {
      this.finishAttempt('failed', 'process_exit');
    }

    const systemMessage = crashMessage(completion, stderrSnippet(this.stderrBuffer), {
      sawOutput: this.sawMeaningfulOutput,
      durationMs,
    });
    if (systemMessage) {
      if (systemMessage.level === 'error') console.error(`[${host.id}] ${systemMessage.text}`);
      host.appendMessage({ role: 'system', content: systemMessage.text, timestamp: new Date() });
    }

    // INVARIANT: a dead process cannot stream. This is the safety net for
    // crash/kill/OOM — every path that skips turn.complete.
    const lastMsg = host.messages[host.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.completedAt) {
      lastMsg.completedAt = new Date();
      lastMsg.completionReason = reason || (exitCode === 0 ? 'success' : 'error');
    }
    host.isStreaming = false;
    host.isRunning = false;
    host.process = null;
    this.stopTurn = null;
    // Suppress external-running detection for trailing disk writes from this
    // just-finished local run. Also clear any stale external flag immediately.
    this.ports.clearExternalRunningStatus(host.id, host.sessionId);
    this.ports.markLocalCompletionSuppression(host.id, host.sessionId);
    this.broadcastStatus();
    host.policy.ended(
      reason === 'killed' ? { t: 'cancelled', detail: reason } : { t: 'failed', detail: reason }
    );
    host.emit('buddy-turn-failed', reason);
    // Dequeue the "sending" message (completed or crashed) and process next.
    // This is the SINGLE code path for dequeue, for success and crash alike.
    if (host.turnQueue.finishHead()) host.broadcastQueue();
    // WS message ordering guarantees clients see status:false before the next
    // spawn's status:true. No delay needed.
    host.processQueue();
  }

  /** The completion promise itself rejected. */
  private completionBroke(err: unknown): void {
    const host = this.host;
    this.clearWatchdogs();
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${host.id}] Process completion error: ${message}`);
    this.finishAttempt('failed', 'process_exit');
    this.surfaceError(normalizeProviderErrorMessage(message));
    host.isStreaming = false;
    host.isRunning = false;
    host.process = null;
    this.stopTurn = null;
    this.broadcastStatus();
    host.policy.ended({ t: 'failed', detail: message });
    host.emit('buddy-turn-failed', message);
    if (host.turnQueue.length === 0) return;
    const removed = host.turnQueue.length;
    for (const entry of host.turnQueue.clearAll()) this.cancelQueuedAttempt(entry);
    console.warn(
      `[${host.id}] Cleared ${removed} pending message(s) due to process error to prevent retry loops.`
    );
    host.broadcastQueue();
  }

  // --- stop, reset, timeout ----------------------------------------------------------

  /** Stop the live process; the close handler finishes the turn. */
  stop(reason: 'user_stop' | 'server_restart'): void {
    const host = this.host;
    this.clearWatchdogs();
    const proc = host.process;
    if (!proc) return;
    this.sealed = true;
    this.stopCause = reason;
    if (this.activeAttemptId) {
      this.ports.turnAttempts.stopping(this.activeAttemptId);
      if (reason === 'server_restart') this.finishAttempt('interrupted', 'server_restart');
    }
    const stopTurn = this.stopTurn;
    // CRITICAL: Don't set isRunning here. The close handler does that. This
    // keeps it atomic: process exits → state updated → queue dequeued →
    // processQueue() spawns next. Setting state here could let processQueue fire
    // while the old process is still alive, and start()'s isRunning guard would
    // silently drop the queued message.
    stopTurn?.('SIGTERM');
    host.policy.ended({ t: 'cancelled' });
    escalateKill(proc, stopTurn, STOP_KILL_GRACE_MS, () =>
      console.warn(`[${host.id}] Process did not exit after SIGTERM, sending SIGKILL`)
    );
  }

  /** Kill the live process for a fresh context; late events of the old handle are ignored. */
  reset(): void {
    const host = this.host;
    this.clearWatchdogs();
    this.providerUsageDirty = false;
    const proc = host.process;
    if (!proc) return;
    const stopTurn = this.stopTurn;
    this.finishAttempt('interrupted', 'process_killed');
    this.runToken += 1;
    stopTurn?.('SIGTERM');
    escalateKill(proc, stopTurn, TURN_TIMEOUT_KILL_GRACE_MS, () =>
      console.warn(`[${host.id}] Reset process did not exit after SIGTERM, sending SIGKILL`)
    );
    host.process = null;
    this.stopTurn = null;
    host.isStreaming = false;
    host.isRunning = false;
    this.broadcastStatus();
  }

  /**
   * A watchdog or run deadline expired. The user-visible turn ends now, as
   * the timeout's own terminal cause (max_runtime_timeout for a deadline,
   * never user_stop); ownership still waits for the joined drain.
   */
  timeout(kind: TurnTimeoutKind): void {
    const host = this.host;
    const proc = host.process;
    if (!proc || !host.isRunning) return;
    host.policy.revoke();
    const idle = this.watchdog.idle();
    const timeout = describeTurnTimeout(kind, {
      ...idle,
      sawMeaningfulOutput: this.sawMeaningfulOutput,
    });
    const lastActivity = this.lastObservedActivity;
    console.error(
      `[${host.id}] ${timeout.message} | timeoutKind=${kind} terminalCause=${timeout.terminalCause} sawMeaningfulOutput=${this.sawMeaningfulOutput} elapsed=${idle.elapsedSeconds}s bridgeIdle=${idle.bridgeIdleSeconds}s providerIdle=${idle.providerIdleSeconds}s lastActivitySource=${lastActivity?.source ?? 'none'} lastProviderEvent=${lastActivity?.providerEventType ?? 'none'} stderr=${this.stderrBuffer.length > 0 ? 'yes' : 'no'}`
    );
    this.clearWatchdogs();
    this.surfaceError(timeout.message);
    this.finishAttempt('failed', timeout.terminalCause);

    const completedAt = new Date();
    const lastMsg = host.messages[host.messages.length - 1];
    if (lastMsg?.role === 'assistant' && !lastMsg.completedAt) {
      lastMsg.completedAt = completedAt;
      lastMsg.completionReason = 'error';
    }
    failRunningSubAgents(host.subAgents, completedAt);
    // Commit buffered text before status:false makes the client discard its
    // transient streaming buffer, then publish the authoritative transcript.
    this.ports.broadcast({ type: 'message_complete', conversationId: host.id, reason: 'error' });
    host.isStreaming = false;
    host.isRunning = false;
    this.ports.clearExternalRunningStatus(host.id, host.sessionId);
    this.ports.markLocalCompletionSuppression(host.id, host.sessionId);
    this.broadcastStatus();
    host.publishTurnEnd();
    // The close handler (after SIGTERM below) takes the fast path and does not
    // add a duplicate system message. Seal so a late provider event cannot
    // append another answer after the timeout message.
    this.sealed = true;
    this.completedCleanly = true;
    host.policy.ended({ t: 'failed', detail: timeout.message });
    host.emit('buddy-turn-failed', timeout.message);

    const stopTurn = this.stopTurn;
    stopTurn?.('SIGTERM');
    escalateKill(proc, stopTurn, TURN_TIMEOUT_KILL_GRACE_MS, () =>
      console.warn(`[${host.id}] Timeout kill escalation: sending SIGKILL`)
    );
  }

  clearWatchdogs(): void {
    this.stopSwarmWatch?.();
    this.stopSwarmWatch = null;
    this.watchdog.clear();
  }

  private startWatchdogs(): void {
    this.watchdog.start();
    this.stopSwarmWatch?.();
    this.stopSwarmWatch = watchSwarmRuns(
      this.ports.swarmObservers,
      this.host.workingDirectory,
      this.subAgentHost
    );
  }

  broadcastStatus(): void {
    this.host.publishRun();
  }
}

/** One turn's event stream folded into its runner: one handler per event type. */
class EventFold {
  streamError: Error | null = null;
  // A turn.complete that reports failure fails automation even though the
  // stream closed cleanly.
  completionError: string | null = null;

  constructor(
    private readonly runner: TurnRunner,
    private readonly runToken: number
  ) {}

  async consume(events: AsyncIterable<UnifiedAgentEvent>): Promise<void> {
    for await (const event of events) {
      if (!this.runner.isCurrent(this.runToken)) return;
      // A timeout or stop finalizes the user-visible turn before the child has
      // necessarily acknowledged SIGTERM. Ignore buffered/late provider events
      // so they cannot resurrect or complete it twice. A normal turn.complete
      // does not seal: the events after it can be the prompt's own answer.
      if (this.runner.streamClosed) continue;
      this.runner.noteActivity(event);
      await this.apply(event);
    }
  }

  private async apply(event: UnifiedAgentEvent): Promise<void> {
    const runner = this.runner;
    switch (event.type) {
      case 'session.started':
        await runner.bindSession(event.sessionId);
        return;
      case 'session.title':
        runner.observeTitle(event.title, event.source);
        return;
      case 'turn.started':
        runner.ensureAssistantMessage();
        return;
      case 'text.delta':
        runner.sawOutput();
        runner.appendText(event.text);
        return;
      case 'tool.use':
        runner.sawOutput();
        runner.applyToolUse(event);
        return;
      case 'tool.result':
        if (!event.isError) runner.applyToolResult(event.output);
        return;
      case 'turn.complete':
        this.completionError = completionFailure(event.reason);
        runner.completeMessage(event.reason);
        return;
      case 'out_of_tokens':
        runner.noteFailure('out_of_tokens', event.message);
        return;
      case 'error':
        runner.noteFailure('provider_error', event.message);
        return;
      case 'stderr':
        runner.noteStderr(event.text);
        return;
      case 'progress':
        runner.logProgress(event);
        return;
      case 'usage':
        runner.noteUsage(event.usage);
        return;
      // Codex collab sub-agents are folded from their tool.use events by the
      // codex sub-agent fold (turns/subagents.ts), which keeps the UI's
      // description and tool counts; this duplicate is not consumed yet.
      case 'subagent.state':
        return;
      case 'task.started':
        runner.applyTaskStarted(event);
        return;
      case 'task.finished':
        runner.applyTaskFinished(event);
        return;
    }
  }
}

function completionFailure(reason: CompletionReason): string | null {
  switch (reason) {
    case 'success':
      return null;
    case 'error':
    case 'out_of_tokens':
      return `Provider completed the turn with reason: ${reason}`;
    case 'killed':
      return 'Provider turn was interrupted';
  }
}

/** The system line a crashed turn leaves, by how it ended. */
function crashMessage(
  completion: { exitCode: number | null; reason: CompletionReason },
  details: string,
  run: { sawOutput: boolean; durationMs: number }
): { level: 'error' | 'info'; text: string } | null {
  const { exitCode, reason } = completion;
  // The executeCommand completion reason comes first: it carries protocol-level
  // failures that can otherwise look like successful exits.
  if (reason === 'killed') {
    return {
      level: 'error',
      text: details
        ? `Process interrupted before completion: ${details}`
        : 'Process interrupted before completion',
    };
  }
  if (reason === 'error') {
    const text =
      exitCode !== null && exitCode !== 0
        ? details
          ? `Process exited with code ${exitCode}: ${details}`
          : `Process exited with code ${exitCode}`
        : details
          ? `Provider exited before completing the turn: ${details}`
          : 'Provider exited before completing the turn';
    return { level: 'error', text };
  }
  if (exitCode === 0 && !run.sawOutput) {
    // A silent zero-exit without any streamed output is a provider failure.
    return {
      level: 'error',
      text: details
        ? `Provider reported an error without response output: ${details}`
        : 'Provider exited without response output',
    };
  }
  if (reason === 'out_of_tokens') return null;
  return {
    level: 'info',
    text: `Process completed successfully in ${(run.durationMs / 1000).toFixed(1)}s`,
  };
}

function escalateKill(
  proc: ChildProcess,
  stopTurn: ((signal?: NodeJS.Signals) => void) | null,
  graceMs: number,
  warn: () => void
): void {
  const killTimer = setTimeout(() => {
    if (proc.exitCode !== null) return;
    warn();
    stopTurn?.('SIGKILL');
  }, graceMs);
  proc.once('close', () => clearTimeout(killTimer));
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

// Harnesses sometimes hand back the raw API error envelope
// ({"error":{"message":…}}); the owner should read the message, not the JSON.
function providerErrorText(message: string): string {
  const trimmed = message.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: unknown }; message?: unknown };
    const inner = parsed.error?.message ?? parsed.message;
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
  } catch {
    // Prose that starts with a brace, not an envelope.
  }
  return trimmed;
}

function normalizeProviderErrorMessage(message: string): string {
  const trimmed = providerErrorText(message);
  if (!trimmed) return 'Unknown provider error';
  if (!OUT_OF_TOKENS_PATTERN.test(trimmed)) return trimmed;
  if (/^out of tokens:/i.test(trimmed)) return trimmed;
  return `Out of tokens: ${trimmed}`;
}
