let startupAuditResults: any[] = [];
import { type ChildProcess, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type {
  Conversation as ConversationData,
  Message,
  ModelId,
  OompaCycle,
  OompaReviewLog,
  OompaRuntimeSnapshot,
  OompaStarted,
  OompaStopped,
  OompaWorkerStatus,
  Provider as ProviderName,
  QueuedMessage,
  ServerMessage,
  SubAgent,
  UIState,
} from '@unleashd/shared';
import { safeParseClientMessage } from '@unleashd/shared';
import { executeCommand } from '@nbardy/agent-cli';
import express, { type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket, WebSocketServer } from 'ws';
import { loadAllConversations, pollForChanges } from './adapters/loader';
import { formatToolUse, isCompletionOnlyToolUse } from './adapters/tool-format';
import { type ProviderEvent, getProvider, providers } from './providers';
import { isModelIdValidForProvider, modelValidationHint } from './providers/model-validation';

import multer from 'multer';
import { auditLocalAgents } from './audit.js';

const VERBOSE = process.env.VERBOSE === '1' || process.argv.includes('--verbose');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store active conversations
const conversations = new Map<string, Conversation>();

// Mtime index for JSONL file polling (filepath → mtime ms)
let fileMtimes = new Map<string, number>();

// Track conversations detected as running by an external process (not launched by us).
// Maps session ID → timestamp (ms) of last detected file activity.
// A session is marked running when its JSONL file changes between polls.
// Marked idle only after EXTERNAL_GRACE_MS with no file changes, to avoid
// flicker during gaps in Claude's output (thinking, API calls, tool use).
const externallyRunning = new Map<string, number>();
const EXTERNAL_GRACE_MS = 30_000; // 30s grace period before marking idle
const LOCAL_COMPLETION_SUPPRESS_MS = EXTERNAL_GRACE_MS;
// Session IDs that were just completed by a local process.
// Suppresses false "external running" detection from trailing disk writes.
const localCompletionSuppressUntil = new Map<string, number>();

// All sessionIds belonging to known conversations (including rotated ones from resetProcess).
// Prevents the file poller from importing an orphaned JSONL as a duplicate conversation.
const knownSessionIds = new Set<string>();
// Session IDs of deliberately deleted conversations. Prevents the file poller
// from re-importing orphaned JSONL files that still exist on disk.
const deletedSessionIds = new Set<string>();
// Provider session IDs can differ from UI conversation IDs (notably Gemini).
// This alias map resolves provider-session identity back to canonical conversation IDs.
const sessionAliasToConversationId = new Map<string, string>();

// Track initial load readiness. Resolved immediately at startup so WebSocket
// handlers can send init right away. Conversations stream in progressively
// via conversations_updated as batches are parsed from disk.
let initialLoadComplete: Promise<void>;
let resolveInitialLoad: () => void;
// Initialize the promise (resolved by startServer after loadExistingConversations)
initialLoadComplete = new Promise((resolve) => {
  resolveInitialLoad = resolve;
});

// =============================================================================
// Types for WebSocket Messages
// =============================================================================

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

type BroadcastData = ServerMessage | ChunkData | MessageCompleteData | MessageData;

// =============================================================================
// Helper Functions
// =============================================================================

interface SearchResult {
  conversationId: string;
  messageIndex: number;
  role: 'user' | 'assistant' | 'system';
  snippet: string;
  workingDirectory: string;
  timestampMs: number;
}

const SEARCH_SNIPPET_RADIUS = 60; // chars before/after match to show
const MIN_SEARCH_QUERY_LENGTH = 2;
const SEARCH_MAX_RESULTS = 50;
const SEARCH_HARD_RESULT_LIMIT = 200;
const LOG_CONTENT_PREVIEW_CHARS = 140;
const HOME_DIR = os.homedir();
const STARTUP_INITIAL_LOAD_LIMIT = readPositiveIntEnv('CWV_STARTUP_INITIAL_LOAD_LIMIT', 500);
const STARTUP_PARSE_CONCURRENCY = readPositiveIntEnv('CWV_STARTUP_PARSE_CONCURRENCY', 16);
const STARTUP_LOAD_BATCH_SIZE = readPositiveIntEnv('CWV_STARTUP_BATCH_SIZE', 100);
const STARTUP_PROGRESS_FILE_STEP = readPositiveIntEnv('CWV_STARTUP_LOG_EVERY_FILES', 500);
const HOT_RELOAD_DRAIN_MS = readPositiveIntEnv('CWV_HOT_RELOAD_DRAIN_MS', 15 * 60_000);
const HOT_RELOAD_FORCE_EXIT_GRACE_MS = readPositiveIntEnv(
  'CWV_HOT_RELOAD_FORCE_EXIT_GRACE_MS',
  3_000
);
const TURN_IDLE_TIMEOUT_MS = readPositiveIntEnv('CWV_TURN_IDLE_TIMEOUT_MS', 10 * 60_000);
const TURN_MAX_RUNTIME_MS = readPositiveIntEnv('CWV_TURN_MAX_RUNTIME_MS', 60 * 60_000);
const TURN_TIMEOUT_KILL_GRACE_MS = readPositiveIntEnv('CWV_TURN_TIMEOUT_KILL_GRACE_MS', 5_000);
const SWARM_POLL_INTERVAL_MS = readPositiveIntEnv('CWV_SWARM_POLL_INTERVAL_MS', 2_000);
const SWARM_POLL_THROTTLE_MS = readPositiveIntEnv('CWV_SWARM_POLL_THROTTLE_MS', 1_500);
const AGENT_CLI_DEBUG_EVENTS = process.env.AGENT_CLI_DEBUG_EVENTS === '1';

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function formatLogPreview(content: string, maxChars = LOG_CONTENT_PREVIEW_CHARS): string {
  return content.replace(/\s+/g, ' ').slice(0, maxChars);
}

function expandHomeAlias(inputPath: string): string {
  if (inputPath === '~') return HOME_DIR;
  if (inputPath.startsWith('~/')) return path.join(HOME_DIR, inputPath.slice(2));
  if (path.sep === '\\' && inputPath.startsWith('~\\')) {
    return path.join(HOME_DIR, inputPath.slice(2));
  }
  if (inputPath.startsWith('~')) {
    return inputPath.replace(/^~/, HOME_DIR);
  }
  return inputPath;
}

function normalizeDirectoryInput(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) return '';
  return path.normalize(expandHomeAlias(trimmed));
}

function resolveWorkingDirectoryInput(
  inputPath: string | null | undefined,
  fallback = process.cwd()
): string {
  const normalized = normalizeDirectoryInput(inputPath ?? '');
  const resolved = path.resolve(normalized || fallback);
  const root = path.parse(resolved).root;
  if (resolved === root) return resolved;
  return resolved.replace(/[\\/]+$/, '');
}

function displayPathWithHomeAlias(resolvedPath: string, useHomeAlias: boolean): string {
  if (!useHomeAlias) return resolvedPath;
  if (resolvedPath === HOME_DIR) return '~';
  if (resolvedPath.startsWith(`${HOME_DIR}${path.sep}`)) {
    return `~${resolvedPath.slice(HOME_DIR.length)}`;
  }
  return resolvedPath;
}

function registerSessionAlias(sessionId: string | null | undefined, conversationId: string): void {
  if (!sessionId) return;
  sessionAliasToConversationId.set(sessionId, conversationId);
  knownSessionIds.add(sessionId);
}

function unregisterSessionAlias(
  sessionId: string | null | undefined,
  options: { keepKnown?: boolean } = {}
): void {
  if (!sessionId) return;
  sessionAliasToConversationId.delete(sessionId);
  if (!options.keepKnown) {
    knownSessionIds.delete(sessionId);
  }
}

function unregisterConversationAliases(
  conversationId: string,
  options: { keepKnown?: boolean } = {}
): void {
  for (const [sessionId, mappedConversationId] of sessionAliasToConversationId) {
    if (mappedConversationId !== conversationId) continue;
    unregisterSessionAlias(sessionId, options);
  }
}

function clearExternalRunningStatus(...ids: Array<string | null | undefined>): void {
  for (const id of ids) {
    if (!id) continue;
    externallyRunning.delete(id);
  }
}

function markLocalCompletionSuppression(...ids: Array<string | null | undefined>): void {
  const until = Date.now() + LOCAL_COMPLETION_SUPPRESS_MS;
  for (const id of ids) {
    if (!id) continue;
    localCompletionSuppressUntil.set(id, until);
  }
}

function clearLocalCompletionSuppression(...ids: Array<string | null | undefined>): void {
  for (const id of ids) {
    if (!id) continue;
    localCompletionSuppressUntil.delete(id);
  }
}

function isLocalCompletionSuppressed(sessionId: string, now: number): boolean {
  const until = localCompletionSuppressUntil.get(sessionId);
  if (until === undefined) return false;
  if (now >= until) {
    localCompletionSuppressUntil.delete(sessionId);
    return false;
  }
  return true;
}

function pruneLocalCompletionSuppressions(now: number): void {
  for (const [sessionId, until] of localCompletionSuppressUntil) {
    if (now >= until) {
      localCompletionSuppressUntil.delete(sessionId);
    }
  }
}

/**
 * Broadcast data to all connected WebSocket clients.
 * Serializes once and sends the same string to all — avoids redundant JSON.stringify
 * calls per client (matters during progressive load: 30 batches × N tabs).
 */
function broadcastToAll(data: BroadcastData): void {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, '');
}

function buildSearchSnippet(content: string, query: string): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerContent.indexOf(lowerQuery);
  if (matchIndex === -1) return content.substring(0, 120);

  const start = Math.max(0, matchIndex - SEARCH_SNIPPET_RADIUS);
  const end = Math.min(content.length, matchIndex + query.length + SEARCH_SNIPPET_RADIUS);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < content.length ? '...' : '';
  return prefix + content.substring(start, end) + suffix;
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

// =============================================================================
// Process Spawning Mutex
// =============================================================================
// Prevents concurrent CLI executions from fighting over token refresh logic on startup.
const globalSpawnMutex = {
  queue: Promise.resolve(),
  lock: function() {
    let resolve!: () => void;
    const next = new Promise<void>((r) => (resolve = r));
    const current = this.queue;
    this.queue = this.queue.then(() => next);
    return { wait: current, release: resolve };
  }
};

// =============================================================================
// Conversation Class
// =============================================================================

/**
 * id and sessionId start equal, but can diverge if resetProcess() is called
 * (loop engine with clearContext). sessionId is what the CLI uses for
 * --session-id/--resume and what JSONL files are named after.
 * knownSessionIds tracks all sessionIds (including rotated ones) so the
 * file poller doesn't import orphaned JSONL files as duplicates.
 */
// STATE MACHINE
// =============
// Server-side (authoritative, broadcast to clients via 'status' events):
//   isRunning   — process is alive (spawn → true, turn.complete/close → false)
//   isStreaming  — assistant is producing content (first text_delta → true, message_complete/close → false)
//                  INVARIANT: !isRunning → !isStreaming (enforced in close handler)
//   queue[]     — server-owned FIFO (pending → sending → removed on close)
//
// Client-side (derived, NOT in this class):
//   confirmed   — server has confirmed this conversation exists (optimistic stub = false)
//
// Broadcast sequence on normal completion:
//   1. message_complete  → client stops streaming indicator
//   2. status:false      → client marks turn complete (from turn.complete)
//   3. queue_updated     → client mirrors updated queue (from close handler)
//   4. processQueue()    → server spawns next message if queued (after close)
//
// Kill paths (all lead to close handler):
//   stop_conversation WS → stop() → SIGTERM → close
//   delete_conversation WS → stop() + delete → close
//   resetProcess (loop) → kill → _isResetting skips close handler
//   SIGINT (Ctrl-C) → SIGKILL all children
interface ConversationOptions {
  id: string;
  workingDirectory?: string | null;
  provider?: ProviderName;
  existingSessionId?: string;
  model?: ModelId;
  isWorker?: boolean;
  swarmId?: string | null;
  workerId?: string | null;
  workerRole?: 'work' | 'review' | 'fix' | null;
  parentConversationId?: string | null;
  modelName?: string | null;
  swarmDebugPrefix?: string | null;
}

class Conversation extends EventEmitter {
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
  provider: ProviderName;
  model: ModelId | undefined; // Provider-specific model identifier (e.g. 'opus', 'gpt-5.3-codex-high')
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
  // Full model name from CLI (e.g., "claude-sonnet-4-5-20250929") — more specific than provider.
  modelName: string | null;
  // Debug prefix for swarm conversations — prepended to first CLI message.
  // Stays on the object (never cleared) so toJSON() includes it for client rendering.
  swarmDebugPrefix: string | null;
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
  // Tracks whether we received provider stream events for this process run.
  private _sawStdoutEventThisRun: boolean;
  // When true, close handler is a no-op — resetProcess() handles its own cleanup.
  // Prevents duplicate broadcasts and spurious dequeue during loop context resets.
  private _isResetting: boolean;
  // Sticky flag set alongside _isResetting in resetProcess(). Unlike _isResetting
  // (which is cleared in the close handler), this stays true until the *next*
  // spawnForMessage() call. Prevents ghost errors when the consumeEvents iterator
  // rejects after the close handler has already cleared _isResetting.
  private _wasResetDuringThisRun: boolean;
  // Start time of the current CLI process run (for duration tracking).
  private _processStartTime = 0;
  // Last provider event timestamp for idle-hang detection.
  private _lastTurnEventAt = 0;
  // Per-turn watchdog timers.
  private _turnIdleTimer: NodeJS.Timeout | null = null;
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

  constructor(opts: ConversationOptions) {
    super();
    const {
      id,
      workingDirectory = null,
      provider = 'claude',
      existingSessionId,
      model,
      isWorker = false,
      swarmId = null,
      workerId = null,
      workerRole = null,
      parentConversationId = null,
      modelName = null,
      swarmDebugPrefix = null,
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
    this.provider = provider;
    this.model = model;
    this.isWorker = isWorker;
    this.swarmId = swarmId;
    this.workerId = workerId;
    this.workerRole = workerRole;
    this.parentConversationId = parentConversationId;
    this.modelName = modelName;
    this.swarmDebugPrefix = swarmDebugPrefix;
    this.subAgents = [];
    this.queue = [];
    this._pendingTaskTools = new Map();
    // Mark session as started if loading existing (use --resume for next message)
    this._hasStartedSession = existingSessionId !== undefined;
    this._stderrBuffer = '';
    this._sawStdoutEventThisRun = false;
    this._isResetting = false;
    this._wasResetDuringThisRun = false;
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
  private spawnForMessage(content: string): void {
    if (this.process || this.isRunning) {
      console.warn(`[${this.id}] Already processing a message, ignoring`);
      return;
    }

    // This session is now being handled locally; clear any stale external flags.
    clearExternalRunningStatus(this.id, this.sessionId);
    clearLocalCompletionSuppression(this.id, this.sessionId);

    const shouldResume = this._hasStartedSession;
    console.log(
      `[${this.id}] Spawning ${this.provider} (provider-session=${this.sessionId.substring(0, 8)}..., resume=${shouldResume})`
    );
    console.log(`[${this.id}] Message: "${content.substring(0, 50)}"`);

    // Reset per-run buffers
    this._stderrBuffer = '';
    this._sawStdoutEventThisRun = false;
    this._turnCompletedCleanly = false;
    this._wasResetDuringThisRun = false;
    this._processStartTime = Date.now();
    this._primeSwarmBaseline();

    const turn = executeCommand({
      harness: this.provider,
      mode: 'conversation',
      prompt: content,
      cwd: this.workingDirectory,
      model: this.model,
      resumeSessionId: shouldResume ? this.sessionId : undefined,
      yolo: true,
      detached: true,
      debugRawEvents: AGENT_CLI_DEBUG_EVENTS,
    });

    this.process = turn.child;
    this.isRunning = true;
    this._hasStartedSession = true; // Mark session as started for next message
    this._startTurnWatchdogs();
    this.broadcastStatus();

    const consumeEvents = async (): Promise<void> => {
      for await (const event of turn.events) {
        this._noteTurnActivity();
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
            broadcastToAll({
              type: 'session_bound',
              conversationId: this.id,
              sessionId: this.sessionId,
            });
            break;
          }
          case 'text.delta': {
            this._sawStdoutEventThisRun = true;
            this.handleOutput({ type: 'text_delta', text: event.text });
            break;
          }
          case 'tool.use': {
            this._sawStdoutEventThisRun = true;
            this.handleOutput({
              type: 'tool_use',
              name: event.name,
              input: event.input,
              displayText: event.displayText,
            });
            break;
          }
          case 'turn.complete': {
            this.handleOutput({ type: 'message_complete', reason: event.reason as any });
            break;
          }
          case 'out_of_tokens': {
            this.handleOutput({ type: 'error', message: normalizeProviderErrorMessage(event.message) });
            break;
          }
          case 'error': {
            this.handleOutput({ type: 'error', message: normalizeProviderErrorMessage(event.message) });
            break;
          }
          case 'stderr': {
            this._stderrBuffer = (this._stderrBuffer + event.text).slice(-4096);
            console.error(`[${this.id}] stderr:`, event.text);
            break;
          }
          case 'progress': {
            // Always log provider warnings (network retries, etc.) — these are
            // operational signals, not debug noise. Other progress events
            // (heartbeats, non-assistant messages) only log with debug flag.
            if (event.source === 'gemini.warning') {
              console.warn(`[${this.id}] provider warning:`, event.data?.message ?? JSON.stringify(event));
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
      // Intentional kill from resetProcess(). _isResetting is live during async
      // close; _wasResetDuringThisRun is sticky and catches late rejections that
      // arrive after the close handler has already cleared _isResetting.
      if (this._isResetting || this._wasResetDuringThisRun) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${this.id}] Event stream error: ${message}`);
      this.handleOutput({ type: 'error', message: normalizeProviderErrorMessage(message) });
    });

    void turn.completed
      .then(({ exitCode, sessionId, reason }) => {
        this._clearTurnWatchdogs();
        if (sessionId && sessionId !== this.sessionId) {
          const oldSessionId = this.sessionId;
          this.sessionId = sessionId;
          unregisterSessionAlias(oldSessionId, { keepKnown: true });
          registerSessionAlias(sessionId, this.id);
        }

        const durationMs = Date.now() - this._processStartTime;
        console.log(
          `[${this.id}] Process closed with code ${exitCode} (reason=${reason}) after ${durationMs}ms`
        );

        // resetProcess() handles its own cleanup. If _isResetting, the kill was
        // intentional (loop context clear) and the loop engine will immediately
        // call sendMessage() and spawn the next iteration. Skip all cleanup here.
        // NOTE: _isResetting is cleared HERE (not in resetProcess) because
        // process.kill() triggers this close handler asynchronously via the
        // turn.completed promise. Clearing it synchronously in resetProcess()
        // races: by the time this .then() fires, the flag is already false.
        if (this._isResetting) {
          this._isResetting = false;
          return;
        }

        // message_complete already handled state cleanup and broadcast.
        // Just null the process ref, dequeue, and continue.
        if (this._turnCompletedCleanly) {
          this.process = null;
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

        const emitSystemMessage = (content: string): void => {
          this.messages.push({ role: 'system', content, timestamp: new Date() });
          broadcastToAll({
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
        } else if (exitCode === 0 && !this._sawStdoutEventThisRun) {
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
        // Clear pending task tools — message_complete handles the normal path, but
        // kills/crashes skip it, leaving stale entries that accumulate across runs.
        this._pendingTaskTools.clear();
        // Suppress external-running detection for trailing disk writes from this
        // just-finished local run. Also clear any stale external flag immediately.
        clearExternalRunningStatus(this.id, this.sessionId);
        markLocalCompletionSuppression(this.id, this.sessionId);
        this.broadcastStatus();
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
        this._clearTurnWatchdogs();
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${this.id}] Process completion error: ${message}`);
        this.handleOutput({ type: 'error', message: normalizeProviderErrorMessage(message) });
        this.isStreaming = false;
        this.isRunning = false;
        this.process = null;
        this._pendingTaskTools.clear();
        this.broadcastStatus();
        if (this.queue.length > 0) {
          const removed = this.queue.length;
          this.queue = [];
          console.warn(`[${this.id}] Cleared ${removed} pending message(s) due to process error to prevent retry loops.`);
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
        // Check if this is a Task tool (sub-agent spawn)
        if (event.name === 'Task') {
          // Extract description from input if available, otherwise use generic
          const description =
            (event.input as { description?: string }).description || 'Running sub-agent task...';
          const blockId = (event.input as { _blockId?: string })._blockId || uuidv4();

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
          broadcastToAll({
            type: 'subagent_start',
            conversationId: this.id,
            subAgent,
          });
        } else {
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
              broadcastToAll({
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
          if (!isCompletionOnlyToolUse(event.name, event.input, event.displayText)) {
            const formattedTool = formatToolUse(event.name, event.input, event.displayText);
            if (formattedTool) {
              const currentMsg = this.messages[this.messages.length - 1];
              const needsLeadingNewline =
                !formattedTool.startsWith('<!--ask_user_question:') &&
                currentMsg?.role === 'assistant' &&
                currentMsg.content.length > 0 &&
                !currentMsg.content.endsWith('\n');
              const chunkText =
                formattedTool.startsWith('<!--ask_user_question:')
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
        }
        break;
      }

      case 'message_complete': {
        // Clear watchdog timers immediately — the turn completed normally.
        // Without this they dangle until process close, risking a spurious timeout.
        this._clearTurnWatchdogs();
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
            agent.status = 'completed';
            agent.completedAt = completedAt;
            agent.currentAction = 'Done';

            console.log(`[${this.id}] Sub-agent completed: ${agent.id.substring(0, 8)}`);

            // Broadcast sub-agent complete
            broadcastToAll({
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

        broadcastToAll({
          type: 'conversations_updated',
          conversations: [this.toJSON()],
        });

        // Signal to the close handler that cleanup already happened.
        // Close handler will skip redundant state changes and broadcasts.
        this._turnCompletedCleanly = true;

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
        broadcastToAll({
          type: 'message',
          conversationId: this.id,
          role: 'system',
          content: event.message,
        });
        break;
      }

      default:
        // TypeScript exhaustive check - this should never happen
        const _exhaustive: never = event;
        throw new Error(`Unhandled event type: ${JSON.stringify(_exhaustive)}`);
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

    // Prepend swarm debug prefix on first message only.
    // UI sees clean content; CLI process gets the full context.
    // Sentinel markers let disk-adapter.ts recover swarmDebugPrefix after server restart
    // (the JSONL stores CLI content, not the clean UI message).
    let cliContent = content;
    if (this.swarmDebugPrefix !== null && this.messages.length === 0) {
      cliContent = `<!-- unleashd:swarm-prefix -->\n${this.swarmDebugPrefix}\n<!-- /unleashd:swarm-prefix -->\n\n${content}`;
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
    this.spawnForMessage(cliContent);
  }

  stop(): void {
    this._clearTurnWatchdogs();
    if (!this.process) return;

    const proc = this.process;
    // CRITICAL: Don't set isRunning here. The 'close' handler does that.
    // This ensures atomicity: process exits → state updated → queue dequeued →
    // processQueue() spawns next. If we set state here, processQueue could fire
    // while the old process is still alive, and spawnForMessage's isRunning
    // guard would silently drop the queued message.
    proc.kill('SIGTERM');

    const killTimer = setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        console.warn(`[${this.id}] Process did not exit after SIGTERM, sending SIGKILL`);
        proc.kill('SIGKILL');
      }
    }, 3000);

    proc.once('close', () => clearTimeout(killTimer));
  }

  // Reset process for fresh context (used in loop with clearContext).
  // Generates new CLI session ID while keeping conversation ID for UI continuity.
  // Sets _isResetting so the close handler skips cleanup — we handle it here
  // because the loop engine immediately spawns the next iteration.
  // _isResetting stays true until the async close handler (.then on turn.completed)
  // fires and clears it. Clearing it synchronously here would race: the .then()
  // callback runs on the next microtask, after this function returns, so it would
  // see _isResetting=false and run full cleanup (duplicate broadcasts + spurious dequeue).
  resetProcess(): void {
    this._clearTurnWatchdogs();
    if (this.process) {
      this._isResetting = true;
      this._wasResetDuringThisRun = true;
      this.process.kill();
      this.process = null;
      this.isStreaming = false;
      this.isRunning = false;
      this.broadcastStatus();
      // DO NOT clear _isResetting here — the close handler clears it when it
      // fires and sees the flag. See the guard in turn.completed.then().
    }
    // Generate new session ID for fresh context
    const oldSessionId = this.sessionId;
    this.sessionId = uuidv4();
    unregisterSessionAlias(oldSessionId, { keepKnown: true });
    registerSessionAlias(this.sessionId, this.id);
    this._hasStartedSession = false;
    console.log(
      `[${this.id}] Reset session: ${oldSessionId.substring(0, 8)}... -> ${this.sessionId.substring(0, 8)}...`
    );
  }

  private _startTurnWatchdogs(): void {
    this._clearTurnWatchdogs();
    this._lastTurnEventAt = Date.now();
    this._refreshIdleWatchdog();
    this._startSwarmPoller();
    this._turnMaxTimer = setTimeout(() => {
      this._handleTurnTimeout('max');
    }, TURN_MAX_RUNTIME_MS);
  }

  private _noteTurnActivity(): void {
    if (!this.isRunning) return;
    this._lastTurnEventAt = Date.now();
    this._refreshIdleWatchdog();
    this._pollForNewSwarms();
  }

  private _refreshIdleWatchdog(): void {
    if (this._turnIdleTimer) {
      clearTimeout(this._turnIdleTimer);
      this._turnIdleTimer = null;
    }
    if (!this.isRunning) return;
    this._turnIdleTimer = setTimeout(() => {
      this._handleTurnTimeout('idle');
    }, TURN_IDLE_TIMEOUT_MS);
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
    if (this._turnIdleTimer) {
      clearTimeout(this._turnIdleTimer);
      this._turnIdleTimer = null;
    }
    if (this._turnMaxTimer) {
      clearTimeout(this._turnMaxTimer);
      this._turnMaxTimer = null;
    }
  }

  private _handleTurnTimeout(kind: 'idle' | 'max'): void {
    if (!this.process || !this.isRunning) return;
    const now = Date.now();
    const elapsedSec = Math.round((now - this._processStartTime) / 1000);
    const idleSec = Math.round((now - this._lastTurnEventAt) / 1000);
    const sawContent = this._sawStdoutEventThisRun;
    const detail = !sawContent ? ' (no content ever received — likely API-level hang)' : '';
    const message =
      kind === 'idle'
        ? `Turn stalled: no provider events for ${idleSec}s${detail} (timed out)`
        : `Turn exceeded max runtime after ${elapsedSec}s${detail} (timed out)`;

    console.error(`[${this.id}] ${message} | sawContent=${sawContent} elapsed=${elapsedSec}s idle=${idleSec}s stderr=${this._stderrBuffer.length > 0 ? 'yes' : 'no'}`);
    this._clearTurnWatchdogs();
    this.handleOutput({ type: 'error', message });
    // Clear busy state now so processQueue() sees isRunning=false and can dequeue.
    // Without this, the close handler's fast path (_turnCompletedCleanly) skips
    // state reset, leaving isRunning=true and stalling the queue permanently.
    this.isStreaming = false;
    this.isRunning = false;
    this.broadcastStatus();
    // Mark turn as cleanly completed so the close handler (triggered by SIGTERM
    // below) takes the fast path and doesn't emit a duplicate system message.
    this._turnCompletedCleanly = true;

    const proc = this.process;
    proc.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        console.warn(`[${this.id}] Timeout kill escalation: sending SIGKILL`);
        proc.kill('SIGKILL');
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
    broadcastToAll({
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

    broadcastToAll({
      type: 'subagent_complete',
      conversationId: this.id,
      subAgentId: agentId,
      status: 'completed',
      completedAt,
    });
  }

  broadcastChunk(data: ChunkData | MessageCompleteData): void {
    broadcastToAll(data);
  }

  broadcastMessage(data: MessageData): void {
    broadcastToAll(data);
  }

  broadcastStatus(): void {
    broadcastToAll({
      type: 'status',
      conversationId: this.id,
      isRunning: this.isRunning,
      isStreaming: this.isStreaming,
    });
  }

  broadcastQueue(): void {
    broadcastToAll({
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
    this.queue.push(msg);
    console.log(
      `[${this.id}] Queued message id=${msg.id.substring(0, 8)}, queueDepth=${queueDepthBefore}->${this.queue.length}, contentLen=${content.length}, preview="${formatLogPreview(content)}"`
    );
    this.broadcastQueue();
    this.processQueue();
  }

  /**
   * Cancel a pending queued message by ID. Cannot cancel messages already sending.
   */
  cancelQueuedMessage(messageId: string): void {
    const idx = this.queue.findIndex((m) => m.id === messageId && m.status === 'pending');
    if (idx !== -1) {
      console.log(`[${this.id}] Cancelled queued message: ${messageId.substring(0, 8)}`);
      this.queue.splice(idx, 1);
      this.broadcastQueue();
    }
  }

  /**
   * Clear all pending messages from the queue. Messages currently sending are kept.
   */
  clearQueue(): void {
    const before = this.queue.length;
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
    console.log(
      `[${this.id}] processQueue sending id=${next.id.substring(0, 8)}, queueDepth=${this.queue.length}, contentLen=${next.content.length}, preview="${formatLogPreview(next.content)}"`
    );
    this.broadcastQueue();
    this.sendMessage(next.content);
  }

  hasActiveProcess(): boolean {
    return this.process !== null;
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
      isRunning: this.isRunning,
      isStreaming: this.isStreaming,
      confirmed: true,
      createdAt: this.createdAt,
      workingDirectory: this.workingDirectory,
      provider: this.provider,
      model: this.model,
      subAgents: this.subAgents,
      queue: this.queue,
      isWorker: this.isWorker,
      swarmId: this.swarmId,
      workerId: this.workerId,
      workerRole: this.workerRole,
      parentConversationId: this.parentConversationId,
      modelName: this.modelName,
      swarmDebugPrefix: this.swarmDebugPrefix,
    };
  }
}

// =============================================================================
// WebSocket Message Types
// =============================================================================

interface NewConversationData {
  type: 'new_conversation';
  id?: string; // Client-generated UUID for optimistic insert
  workingDirectory?: string;
  provider?: ProviderName;
  model?: ModelId; // Provider-specific model identifier (e.g. 'opus', 'gpt-5.3-codex-high')
  swarmDebugPrefix?: string; // Debug prefix prepended to first CLI message
}

interface SendMessageData {
  type: 'send_message';
  conversationId: string;
  content: string;
}

interface StopConversationData {
  type: 'stop_conversation';
  conversationId: string;
}

interface DeleteConversationData {
  type: 'delete_conversation';
  conversationId: string;
}

interface QueueMessageData {
  type: 'queue_message';
  conversationId: string;
  content: string;
}

interface CancelQueuedMessageData {
  type: 'cancel_queued_message';
  conversationId: string;
  messageId: string;
}

interface ClearQueueData {
  type: 'clear_queue';
  conversationId: string;
}

interface SetModelData {
  type: 'set_model';
  conversationId: string;
  model?: ModelId;
}

interface SetProviderData {
  type: 'set_provider';
  conversationId: string;
  provider: ProviderName;
}

type ClientMessageData =
  | NewConversationData
  | SendMessageData
  | StopConversationData
  | DeleteConversationData
  | SetProviderData
  | QueueMessageData
  | CancelQueuedMessageData
  | ClearQueueData
  | SetModelData;

// =============================================================================
// WebSocket Handler
// =============================================================================

wss.on('connection', (ws: WebSocket) => {
  console.log('New WebSocket connection');

  // Wait for initialLoadComplete (resolves immediately at startup).
  // Clients get init with whatever conversations are loaded so far — remaining
  // conversations stream in via conversations_updated as batches are parsed.
  // Late-connecting clients get more in init; early ones get progressive updates.
  (async () => {
    await initialLoadComplete;

    // Guard: client may have disconnected while we were waiting
    if (ws.readyState !== WebSocket.OPEN) return;

    // Send current state (include external running status for accurate initial render)
    ws.send(
      JSON.stringify({
        type: 'init',
        conversations: Array.from(conversations.values()).map((c) => {
          const json = c.toJSON();
          if (externallyRunning.has(c.sessionId) || externallyRunning.has(c.id)) {
            json.isRunning = true;
          }
          return json;
        }),
        defaultCwd: process.cwd(),
        uiState: getActiveUIState(),
      })
    );
  })();

  ws.on('message', (message: Buffer | string) => {
    try {
      const parsed = JSON.parse(message.toString());
      const result = safeParseClientMessage(parsed);
      if (!result.success) {
        console.error('[WS] Invalid client message:', result.error.message);
        ws.send(
          JSON.stringify({
            type: 'error',
            message: `Invalid message: ${result.error.issues.map((i) => i.message).join(', ')}`,
          })
        );
        return;
      }
      const data = result.data;
      if (data.type === 'queue_message') {
        console.log(
          `[WS] Received queue_message conversationId=${data.conversationId}, contentLen=${data.content.length}, preview="${formatLogPreview(data.content)}"`
        );
      } else {
        console.log(
          `[WS] Received message type: ${data.type}`,
          JSON.stringify(data).substring(0, 200)
        );
      }

      switch (data.type) {
        case 'new_conversation': {
          // Use client-provided UUID if present (optimistic insert), otherwise generate one
          const id = data.id || uuidv4();
          // Resolve input consistently across WS and REST path endpoints.
          // Keeps '/' valid while normalizing '/foo/bar/' to '/foo/bar'.
          const workingDir = resolveWorkingDirectoryInput(data.workingDirectory);
          const provider = data.provider || 'claude'; // Support 'claude', 'codex', or 'opencode'
          const model = data.model; // Provider-specific model (undefined = provider default)
          const swarmDebugPrefix = data.swarmDebugPrefix ?? null;

          // Validate provider against the registry — no manual list needed
          if (!(provider in providers)) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: `Invalid provider: ${provider}. Must be one of: ${Object.keys(providers).join(', ')}.`,
              })
            );
            return;
          }

          if (!isModelIdValidForProvider(provider, model)) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: `Invalid model '${model}' for provider '${provider}'. Expected ${modelValidationHint(provider)}.`,
              })
            );
            return;
          }

          // Validate directory exists and is accessible
          try {
            const stats = fs.statSync(workingDir);
            if (!stats.isDirectory()) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  message: 'Path is not a directory',
                })
              );
              return;
            }
          } catch {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: `No matching folder: ${workingDir}`,
              })
            );
            return;
          }

          const conv = new Conversation({
            id,
            workingDirectory: workingDir,
            provider,
            model,
            swarmDebugPrefix,
          });

          // If no model specified by client, resolve the provider's isDefault model
          // so the CLI receives the same model the UI shows pre-selected in the dropdown.
          if (!conv.model) {
            const providerInfo = providers[conv.provider];
            if (providerInfo) {
              const defaultModel = providerInfo.listModels().find((m) => m.isDefault);
              if (defaultModel) {
                conv.model = defaultModel.id as ModelId;
              }
            }
          }

          conversations.set(id, conv);

          // No need to start - we spawn per message now

          ws.send(
            JSON.stringify({
              type: 'conversation_created',
              conversation: conv.toJSON(),
            })
          );
          break;
        }

        case 'send_message': {
          console.log(
            `[WS] send_message for ${data.conversationId}: "${data.content.substring(0, 50)}"`
          );
          const conversation = conversations.get(data.conversationId);
          if (conversation) {
            console.log(`[WS] Found conversation, calling sendMessage`);
            conversation.sendMessage(data.content);
          } else {
            console.error(`[WS] Conversation not found: ${data.conversationId}`);
            console.error(`[WS] Available conversations:`, Array.from(conversations.keys()));
          }
          break;
        }

        case 'stop_conversation': {
          const convToStop = conversations.get(data.conversationId);
          if (convToStop) {
            convToStop.stop();
          }
          break;
        }

        case 'delete_conversation': {
          const convToDelete = conversations.get(data.conversationId);
          if (convToDelete) {
            convToDelete.stop();
            conversations.delete(data.conversationId);
            // Tombstone all session IDs (current + rotated) so the poller never
            // re-imports the orphaned JSONL files that still exist on disk.
            deletedSessionIds.add(convToDelete.sessionId);
            for (const [sid, cid] of sessionAliasToConversationId) {
              if (cid === convToDelete.id) deletedSessionIds.add(sid);
            }
            // Evict session IDs so the orphan-detection guard doesn't accumulate forever
            unregisterConversationAliases(convToDelete.id);
            clearExternalRunningStatus(convToDelete.sessionId, convToDelete.id);
            clearLocalCompletionSuppression(convToDelete.sessionId, convToDelete.id);
            ws.send(
              JSON.stringify({
                type: 'conversation_deleted',
                conversationId: data.conversationId,
              })
            );
          }
          break;
        }

        case 'set_model': {
          const conv = conversations.get(data.conversationId);
          if (conv) {
            if (!isModelIdValidForProvider(conv.provider, data.model)) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  message: `Invalid model '${data.model}' for provider '${conv.provider}'. Expected ${modelValidationHint(conv.provider)}.`,
                })
              );
              return;
            }
            conv.model = data.model;
            console.log(
              `[WS] Model changed for ${data.conversationId}: ${data.model ?? 'default'}`
            );
            // Broadcast updated conversation
            ws.send(
              JSON.stringify({
                type: 'conversation_created',
                conversation: conv.toJSON(),
              })
            );
          }
          break;
        }

        case 'set_provider': {
          const conv = conversations.get(data.conversationId);
          if (conv) {
            if (!(data.provider in providers)) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  message: `Invalid provider: ${data.provider}. Must be one of: ${Object.keys(providers).join(', ')}.`,
                })
              );
              return;
            }

            if (!conv.canChangeProvider()) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  message: 'Harness can only be changed before the conversation starts.',
                })
              );
              return;
            }

            conv.provider = data.provider;
            // Reset model when switching provider to avoid invalid cross-provider IDs.
            conv.model = undefined;
            conv.modelName = null;
            console.log(`[WS] Provider changed for ${data.conversationId}: ${data.provider}`);
            ws.send(
              JSON.stringify({
                type: 'conversation_created',
                conversation: conv.toJSON(),
              })
            );
          }
          break;
        }

        case 'queue_message': {
          const conv = conversations.get(data.conversationId);
          if (conv) {
            conv.enqueueMessage(data.content);
          }
          break;
        }

        case 'cancel_queued_message': {
          const conv = conversations.get(data.conversationId);
          if (conv) {
            conv.cancelQueuedMessage(data.messageId);
          }
          break;
        }

        case 'clear_queue': {
          const conv = conversations.get(data.conversationId);
          if (conv) {
            conv.clearQueue();
          }
          break;
        }
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});

// =============================================================================
// Express Routes
// =============================================================================

// JSON body parser for API routes
app.use(express.json());

// File upload API — saves files to disk and returns absolute paths
// CLI agents (Claude, Codex) run on the same machine and can read these paths directly.
const UPLOADS_DIR = path.join(os.homedir(), '.agent-viewer', 'uploads');

const uploadStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const conversationId = req.body.conversationId as string;
    if (!conversationId) {
      cb(new Error('conversationId is required'), '');
      return;
    }
    const dir = path.join(UPLOADS_DIR, conversationId);
    // Guard against path traversal — conversationId must not escape UPLOADS_DIR
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) {
      cb(new Error('Invalid conversationId'), '');
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${sanitized}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
});

app.post('/api/upload', upload.array('files', 20), (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files provided' });
    return;
  }

  const result = files.map((f) => ({
    originalName: f.originalname,
    absolutePath: f.path,
    mimeType: f.mimetype,
    size: f.size,
  }));

  console.log(
    `[Upload] ${files.length} file(s) saved:`,
    result.map((r) => r.absolutePath)
  );
  res.json({ files: result });
});

// Settings API - stored in ~/.agent-viewer/settings.json
const SETTINGS_DIR = path.join(os.homedir(), '.agent-viewer');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

interface Settings {
  colorPalette: string;
}

const DEFAULT_SETTINGS: Settings = {
  colorPalette: 'solarized',
};

// =============================================================================
// Settings Cache — initialized once at startup, updated on POST
// =============================================================================

let settingsCache: Settings | null = null;

/**
 * Initialize settings cache from disk. Called once at startup.
 * Throws if the file exists but is malformed (fail eagerly).
 */
async function initSettingsCache(): Promise<void> {
  try {
    const data = await fs.promises.readFile(SETTINGS_FILE, 'utf-8');
    settingsCache = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    console.log('Settings loaded from disk');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // File doesn't exist — use defaults
      settingsCache = { ...DEFAULT_SETTINGS };
      console.log('Settings file not found, using defaults');
    } else {
      throw new Error(`Failed to load settings: ${(e as Error).message}`);
    }
  }
}

/**
 * Get settings from cache. Throws if cache not initialized (programming error).
 */
function getSettings(): Settings {
  if (!settingsCache) {
    throw new Error('Settings cache not initialized — call initSettingsCache() at startup');
  }
  return settingsCache;
}

/**
 * Update settings cache and write to disk asynchronously.
 * Cache is updated immediately; disk write is fire-and-forget with error logging.
 */
function writeSettingsAsync(settings: Settings): void {
  settingsCache = settings;

  // Fire-and-forget disk write
  (async () => {
    try {
      await fs.promises.mkdir(SETTINGS_DIR, { recursive: true });
      await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (e) {
      console.error('Error saving settings to disk:', e);
    }
  })();
}

app.get('/api/audit', (_req: Request, res: Response) => {
  res.json(startupAuditResults);
});

app.get('/api/settings', (_req: Request, res: Response) => {
  res.json(getSettings());
});

// =============================================================================
// UI State Cache — server-synced preferences from ~/.agent-viewer/ui-state.json
// =============================================================================

const UI_STATE_FILE = path.join(SETTINGS_DIR, 'ui-state.json');

let uiStateCache: { [key: string]: unknown } = {};
let uiStateSyncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize UI state cache from disk. Called once at startup.
 * File is optional — missing file defaults to empty object (schema provides defaults).
 */
async function initUIStateCache(): Promise<void> {
  try {
    const data = await fs.promises.readFile(UI_STATE_FILE, 'utf-8');
    uiStateCache = JSON.parse(data);
    console.log('UI state loaded from disk');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // File doesn't exist — start with empty object (schema provides defaults)
      uiStateCache = {};
      console.log('UI state file not found, using defaults');
    } else {
      console.warn(`Failed to load UI state: ${(e as Error).message}`);
      uiStateCache = {};
    }
  }
}

/**
 * Get UI state from cache. Returns object (or {} if cache not initialized).
 */
/**
 * Return UI state from cache. No pruning — conversations load progressively
 * after the WebSocket init fires, so pruning against an incomplete `conversations`
 * Map would silently drop valid doneConversations / lastSeenMessageIndex entries.
 * The client tolerates stale keys harmlessly (they reference IDs that don't render).
 */
function getActiveUIState(): { [key: string]: unknown } {
  return { ...uiStateCache };
}

/**
 * Update UI state cache and write to disk asynchronously.
 * Merges partial updates into the existing state. Disk file keeps ALL entries
 * (including stale) so nothing is lost across server restarts — getActiveUIState
 * filters at read time.
 */
function setUIState(partial: { [key: string]: unknown }): void {
  uiStateCache = { ...uiStateCache, ...partial };

  // Fire-and-forget disk write with debounce
  if (uiStateSyncTimer) {
    clearTimeout(uiStateSyncTimer);
  }
  uiStateSyncTimer = setTimeout(async () => {
    uiStateSyncTimer = null;
    try {
      await fs.promises.mkdir(SETTINGS_DIR, { recursive: true });
      await fs.promises.writeFile(UI_STATE_FILE, JSON.stringify(uiStateCache, null, 2));
    } catch (e) {
      console.error('Error saving UI state to disk:', e);
    }
  }, 500);
}

app.get('/api/ui-state', (_req: Request, res: Response) => {
  res.json(getActiveUIState());
});

// Body limit raised from default 100kb — lastSeenMessageIndex grows with conversation count
// and was causing silent 413 rejections once the payload crossed ~100KB.
app.post('/api/ui-state', express.json({ limit: '1mb' }), (req: Request, res: Response) => {
  setUIState(req.body);
  res.json({ ok: true });
});

// Model list API — returns ModelInfo[] for the given provider.
// Used by the Sidebar model dropdown to show available models per provider.
app.get('/api/models', (req: Request, res: Response) => {
  const providerName = (req.query.provider as string) || 'claude';
  if (!(providerName in providers)) {
    res
      .status(400)
      .json({
        error: `Invalid provider: ${providerName}. Must be one of: ${Object.keys(providers).join(', ')}.`,
      });
    return;
  }
  const provider = getProvider(providerName as ProviderName);
  res.json(provider.listModels());
});

// Search across all messages.
// Used by SearchPalette to fetch message-level matches without loading every
// conversation into client state.
app.get('/api/search', (req: Request, res: Response) => {
  const rawQuery = req.query.q;
  const filterDirectory = (typeof req.query.filterDirectory === 'string' ? req.query.filterDirectory : '').trim();
  const rawLimit = Number(req.query.limit);

  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, SEARCH_HARD_RESULT_LIMIT)
      : SEARCH_MAX_RESULTS;

  if (typeof rawQuery !== 'string') {
    res.status(400).json({ error: 'q is required' });
    return;
  }

  const query = rawQuery.trim();
  if (query.length < MIN_SEARCH_QUERY_LENGTH) {
    res.json({ query, results: [] });
    return;
  }

  const lowerQuery = query.toLowerCase();
  const matches: SearchResult[] = [];

  for (const conversation of conversations.values()) {
    if (filterDirectory && !conversation.workingDirectory.startsWith(filterDirectory)) continue;

    for (let i = 0; i < conversation.messages.length; i++) {
      const message = conversation.messages[i];
      const content = message.content;

      if (!content.toLowerCase().includes(lowerQuery)) continue;

      matches.push({
        conversationId: conversation.id,
        messageIndex: i,
        role: message.role,
        snippet: buildSearchSnippet(content, query),
        workingDirectory: conversation.workingDirectory,
        timestampMs: new Date(message.timestamp).getTime(),
      });
    }
  }

  matches.sort((a, b) => b.timestampMs - a.timestampMs);
  const response = matches.slice(0, limit).map((match) => ({
    conversationId: match.conversationId,
    messageIndex: match.messageIndex,
    role: match.role,
    snippet: match.snippet,
    workingDirectory: match.workingDirectory,
    timestamp: new Date(match.timestampMs).toISOString(),
  }));

  res.json({ query, results: response });
});

// Path autocomplete API - returns directory listings for a given path
// Used by the PathAutocomplete component in the new conversation dialog
app.get('/api/paths', async (req: Request, res: Response) => {
  const inputPath = typeof req.query.path === 'string' ? req.query.path : '';
  const trimmedInput = inputPath.trim();
  const useHomeAlias = trimmedInput.startsWith('~');

  // Handle empty path - return home directory contents
  if (!trimmedInput) {
    try {
      const entries = await fs.promises.readdir(HOME_DIR, { withFileTypes: true });
      const results = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .slice(0, 20)
        .map((entry) => ({
          name: entry.name,
          path: path.join(HOME_DIR, entry.name),
          isDirectory: true,
        }));
      res.json(results);
    } catch {
      res.json([]);
    }
    return;
  }

  const normalizedPath = normalizeDirectoryInput(trimmedInput);
  if (!normalizedPath) {
    res.json([]);
    return;
  }
  const partialSegment = path.basename(normalizedPath);
  const includeHidden = partialSegment.startsWith('.');

  // Check if the path exists and is a directory
  try {
    const stats = await fs.promises.stat(normalizedPath);
    if (stats.isDirectory()) {
      // Path is a complete directory - list its contents
      const entries = await fs.promises.readdir(normalizedPath, { withFileTypes: true });
      const results = entries
        .filter(
          (entry) => entry.isDirectory() && (includeHidden || !entry.name.startsWith('.'))
        )
        .slice(0, 20)
        .map((entry) => ({
          name: entry.name,
          path: displayPathWithHomeAlias(path.join(normalizedPath, entry.name), useHomeAlias),
          isDirectory: true,
        }));
      res.json(results);
      return;
    }
  } catch {
    // Path doesn't exist as-is, try parent directory with partial match
  }

  // Path might be partial - get parent directory and filter
  const parentDir = path.dirname(normalizedPath);
  const partial = partialSegment.toLowerCase();

  try {
    const stats = await fs.promises.stat(parentDir);
    if (stats.isDirectory()) {
      const entries = await fs.promises.readdir(parentDir, { withFileTypes: true });
      const results = entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            (includeHidden || !entry.name.startsWith('.')) &&
            entry.name.toLowerCase().startsWith(partial)
        )
        .slice(0, 20)
        .map((entry) => ({
          name: entry.name,
          path: displayPathWithHomeAlias(path.join(parentDir, entry.name), useHomeAlias),
          isDirectory: true,
        }));
      res.json(results);
      return;
    }
  } catch {
    // Parent directory doesn't exist either
  }

  // Return empty array for invalid paths
  res.json([]);
});

// Validate if a path exists and is a directory (used by PathAutocomplete validation)
app.get('/api/validate-path', async (req: Request, res: Response) => {
  const inputPath = typeof req.query.path === 'string' ? req.query.path : '';
  const trimmedInput = inputPath.trim();

  if (!trimmedInput) {
    res.json({ valid: false, error: 'Empty path' });
    return;
  }

  const normalizedPath = normalizeDirectoryInput(trimmedInput);
  const resolvedPath = path.resolve(normalizedPath);

  try {
    const stats = await fs.promises.stat(resolvedPath);
    if (stats.isDirectory()) {
      res.json({
        valid: true,
        path: displayPathWithHomeAlias(resolvedPath, trimmedInput.startsWith('~')),
      });
    } else {
      res.json({ valid: false, error: 'Path is not a directory' });
    }
  } catch {
    res.json({ valid: false, error: 'No matching folder' });
  }
});

// Create a directory (used by PathAutocomplete's "Create folder" option)
app.post('/api/mkdir', express.json(), async (req: Request, res: Response) => {
  const dirPath = typeof req.body?.path === 'string' ? req.body.path : '';
  const trimmedInput = dirPath.trim();
  if (!trimmedInput) {
    res.status(400).json({ error: 'Missing path' });
    return;
  }

  const normalizedPath = normalizeDirectoryInput(trimmedInput);
  const resolvedPath = path.resolve(normalizedPath);

  try {
    await fs.promises.mkdir(resolvedPath, { recursive: true });
    res.json({
      path: displayPathWithHomeAlias(resolvedPath, trimmedInput.startsWith('~')),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create directory';
    res.status(500).json({ error: message });
  }
});

// Serve local files over HTTP so the browser can display them
// (browsers block file:// links from http:// origins)
app.get('/api/files', (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath || !filePath.startsWith('/')) {
    res.status(400).json({ error: 'Absolute path required' });
    return;
  }

  const resolved = path.resolve(filePath);
  if (resolved !== path.normalize(filePath)) {
    res.status(400).json({ error: 'Path traversal rejected' });
    return;
  }

  // Security: only serve files under known conversation directories or the uploads dir
  if (!isUnderKnownProject(resolved) && !resolved.startsWith(UPLOADS_DIR + path.sep)) {
    res.status(403).json({ error: 'Path not under any known project' });
    return;
  }

  res.sendFile(resolved, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'File not found' });
    }
  });
});

// Serve local files via URL path so relative assets (videos, CSS, images)
// resolve naturally from the HTML file's directory.
// e.g. /api/serve/Users/nick/project/report.html
//      → relative <video src="video.mp4"> resolves to /api/serve/Users/nick/project/video.mp4
app.get('/api/serve/*', (req: Request, res: Response) => {
  // Express wildcard: everything after /api/serve/
  const rawPath = '/' + req.params[0];
  const resolved = path.resolve(rawPath);

  if (resolved !== path.normalize(rawPath)) {
    res.status(400).json({ error: 'Path traversal rejected' });
    return;
  }

  if (!isUnderKnownProject(resolved) && !resolved.startsWith(UPLOADS_DIR + path.sep)) {
    res.status(403).json({ error: 'Path not under any known project' });
    return;
  }

  res.sendFile(resolved, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'File not found' });
    }
  });
});

// =============================================================================
// Swarm Dashboard APIs — git log, oompa config, and file reading for the
// /workers detail view. These are one-shot REST queries (not streaming).
//
// SECURITY: Endpoints that return file/diff data restrict access to
// directories known to the server as conversation working directories.
// /api/oompa-swarm-context intentionally accepts any existing local directory
// so users can start a first swarm before a conversation already exists there.
// =============================================================================

/** Check if a resolved path is within any known conversation directory. */
function isUnderKnownProject(resolved: string): boolean {
  for (const conv of conversations.values()) {
    if (resolved.startsWith(path.resolve(conv.workingDirectory))) return true;
  }
  return false;
}

type OompaRunDir = {
  id: string;
  path: string;
  mtimeMs: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeReadJson(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readLatestRunDir(runsDir: string): OompaRunDir | null {
  try {
    const entries = fs
      .readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const runPath = path.join(runsDir, entry.name);
        return {
          id: entry.name,
          path: runPath,
          mtimeMs: fs.statSync(runPath).mtimeMs,
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return entries[0] ?? null;
  } catch {
    return null;
  }
}

function isTerminalWorkerStatus(status: OompaWorkerStatus): boolean {
  return status === 'done' || status === 'error';
}

function normalizeStatus(rawStatus: unknown): OompaWorkerStatus {
  if (!rawStatus || typeof rawStatus !== 'string') return 'starting';
  const status = rawStatus.toLowerCase();
  if (status === 'done' || status === 'completed' || status === 'exhausted') return 'done';
  if (status === 'idle') return 'idle';
  if (status === 'error' || status === 'failed' || status === 'fatal') return 'error';
  if (
    status === 'working' ||
    status === 'running' ||
    status === 'merged' ||
    status === 'rejected' ||
    status === 'no-changes' ||
    status === 'executor-done' ||
    status === 'claimed' ||
    status === 'sync-failed' ||
    status === 'merge-failed' ||
    status === 'starting'
  ) {
    return status === 'starting' ? 'starting' : 'running';
  }
  return 'starting';
}

/**
 * Read all JSON files from a cycles/ (or iterations/) directory.
 * Returns parsed OompaCycle objects sorted by filename.
 * NOTE: Old runs may use 'iteration' instead of 'cycle' field — the OompaCycle
 * type uses 'cycle' (authoritative from schema). Callers must handle the legacy field.
 */
function readCycleFiles(dir: string): OompaCycle[] {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    return files
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as OompaCycle;
        } catch {
          return null;
        }
      })
      .filter((x): x is OompaCycle => x !== null);
  } catch {
    return [];
  }
}

/**
 * Check if a process is alive via signal 0 (doesn't kill, just tests).
 */
function isPidAlive(pidValue: string | undefined): boolean {
  if (!pidValue) return false;
  const pid = Number.parseInt(pidValue, 10);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the oompa orchestrator process is alive by reading meta files.
 * Returns true if any meta file's script_pid or bb_pid is alive.
 */
function isOompaProcessAlive(projectRoot: string): boolean {
  const logsDir = path.join(projectRoot, 'oompa', 'logs');
  try {
    const metaFiles = fs
      .readdirSync(logsDir)
      .filter((f) => /^run_.+\.meta$/.test(f))
      .map((f) => path.join(logsDir, f));

    for (const metaFile of metaFiles) {
      const content = fs.readFileSync(metaFile, 'utf-8');
      const meta: Record<string, string> = {};
      for (const line of content.split(/\r?\n/)) {
        if (!line) continue;
        const idx = line.indexOf('=');
        if (idx <= 0) continue;
        meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      if (isPidAlive(meta.script_pid) || isPidAlive(meta.bb_pid)) {
        return true;
      }
    }
  } catch {
    // No oompa/logs directory — can't confirm liveness from PIDs
  }
  return false;
}

/**
 * Event-sourced runtime reader: scans started.json + stopped.json + cycles/
 * directory to derive swarm state. Uses PID from started.json for liveness.
 * Backward-compatible with old format (run.json + iterations/).
 */
function readLatestOompaRuntime(projectRoot: string): OompaRuntimeSnapshot {
  const runsDir = path.join(projectRoot, 'runs');
  if (!fs.existsSync(runsDir)) {
    return { available: false, run: null, reason: 'No runs directory found' };
  }

  const latestRun = readLatestRunDir(runsDir);
  if (!latestRun) {
    return { available: false, run: null, reason: 'No run directories found' };
  }

  let runCount = 0;
  try {
    runCount = fs
      .readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).length;
  } catch {
    runCount = 0;
  }

  const runId = latestRun.id;

  // Read event files: started.json (new) or run.json (old backward compat)
  // Cast to OompaStarted — safeReadJson returns Record<string,unknown> but the
  // schema-generated type is authoritative. Old run.json has the same shape.
  const startedData = (safeReadJson(path.join(latestRun.path, 'started.json')) ??
    safeReadJson(path.join(latestRun.path, 'run.json')) ??
    {}) as Partial<OompaStarted>;
  const stoppedData = safeReadJson(
    path.join(latestRun.path, 'stopped.json')
  ) as OompaStopped | null;

  // Scan cycles/ (new) or iterations/ (old backward compat)
  const cyclesDir = path.join(latestRun.path, 'cycles');
  const iterationsDir = path.join(latestRun.path, 'iterations');
  const scanDir = fs.existsSync(cyclesDir)
    ? cyclesDir
    : fs.existsSync(iterationsDir)
      ? iterationsDir
      : null;

  const cycleFiles = scanDir ? readCycleFiles(scanDir) : [];

  // Worker IDs from started.json config
  const configuredWorkers: string[] = [];
  if (startedData.workers) {
    for (const w of startedData.workers) {
      if (w.id) configuredWorkers.push(w.id);
    }
  }

  // Latest cycle per worker (handles both 'cycle' and legacy 'iteration' field names)
  // NOTE: OompaCycle uses 'cycle' (schema-authoritative). Old runs may have 'iteration'
  // instead — we cast to OompaCycle but tolerate the legacy field via bracket access.
  const latestCycleByWorker = new Map<string, OompaCycle>();
  for (const cycle of cycleFiles) {
    const wid = cycle['worker-id'];
    if (!wid) continue;
    const existing = latestCycleByWorker.get(wid);
    // Legacy compat: old runs used 'iteration' field instead of 'cycle'
    // Legacy compat: old runs used 'iteration' instead of 'cycle'
    const cycleNum =
      cycle.cycle ??
      ((cycle as unknown as Record<string, unknown>)['iteration'] as number | undefined) ??
      0;
    const existingNum =
      existing?.cycle ??
      ((existing as unknown as Record<string, unknown>)?.['iteration'] as number | undefined) ??
      0;
    if (!existing || cycleNum > existingNum) {
      latestCycleByWorker.set(wid, cycle);
    }
  }

  // Union of all known worker IDs
  const workerIds = new Set<string>([...configuredWorkers, ...latestCycleByWorker.keys()]);
  const totalWorkers = Math.max(workerIds.size, configuredWorkers.length);

  // Liveness: stopped.json present = swarm finished.
  // Otherwise check PID from started.json, with isOompaProcessAlive() as fallback
  // for old runs that don't have PID in started.json.
  const swarmStopped = stoppedData !== null;
  const pid = startedData.pid;
  const pidAlive = !swarmStopped && typeof pid === 'number' && isPidAlive(String(pid));
  const fallbackAlive = !swarmStopped && !pidAlive && isOompaProcessAlive(projectRoot);
  const isLive = !swarmStopped && (pidAlive || fallbackAlive);
  const startedAtMs = Date.parse(String(startedData['started-at'] ?? ''));
  const liveNoCycleGraceMs = 60_000;

  // Build worker snapshots from cycle data
  const swarmId = startedData['swarm-id'] ?? runId;
  const configPath = startedData['config-file'] ?? null;

  const workerSnapshots = Array.from(workerIds).map((id) => {
    const cycle = latestCycleByWorker.get(id);
    let status: OompaWorkerStatus;

    if (cycle) {
      status = normalizeStatus(cycle.outcome);
    } else if (isLive) {
      // Avoid "eternal starting": once the swarm is live past a short grace period,
      // workers with no completed cycles yet should be shown as running.
      const noCycleShouldBeRunning =
        !Number.isFinite(startedAtMs) || Date.now() - startedAtMs > liveNoCycleGraceMs;
      status = noCycleShouldBeRunning ? 'running' : 'starting';
    } else {
      status = 'done';
    }

    // If swarm is not live (clean stop OR crashed without stopped.json),
    // force all non-terminal workers to done — their "running" status is stale.
    if (!isLive && status !== 'done' && status !== 'error') {
      status = 'done';
    }

    return {
      id,
      status,
      lastEvent: cycle
        ? `Cycle ${cycle.cycle ?? '?'}: ${cycle.outcome ?? 'unknown'}`
        : swarmStopped
          ? 'Worker completed'
          : isLive
            ? 'Starting'
            : 'No data',
    };
  });

  const states = workerSnapshots.sort((a, b) => a.id.localeCompare(b.id));
  const doneWorkers = states.filter((w) => isTerminalWorkerStatus(w.status)).length;
  const activeWorkers = states.filter((w) => !isTerminalWorkerStatus(w.status)).length;

  return {
    available: true,
    run: {
      runId,
      swarmId,
      isRunning: isLive && activeWorkers > 0,
      totalWorkers,
      activeWorkers,
      doneWorkers,
      configPath,
      logFile: null,
      workers: states,
      runCount,
    },
    reason: null,
  };
}

const SWARM_CONTEXT_COMMAND_TIMEOUT_MS = 8_000;
const SWARM_CONTEXT_MAX_OUTPUT_CHARS = 8_000;
const SWARM_CONTEXT_MAX_DOC_CHARS = 3_000;
const SWARM_CONTEXT_MAX_DOC_FILES = 6;

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...<truncated>`;
}

function runCommandCapture(command: string, cwd: string): string {
  try {
    return execSync(command, {
      cwd,
      timeout: SWARM_CONTEXT_COMMAND_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    }).trim();
  } catch (error) {
    const e = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString('utf-8') ?? '';
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf-8') ?? '';
    const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    return combined || e.message || `Command failed: ${command}`;
  }
}

function findDocCandidates(projectRoot: string): string[] {
  const candidates = [
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'docs/agent_client_spec.md',
    'docs/README.md',
    'docs/SWARM_GUIDE.md',
    'docs/OOMPA.md',
    'docs/JSON_TICKETS.md',
  ];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rel of candidates) {
    const abs = path.join(projectRoot, rel);
    if (!fs.existsSync(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    result.push(abs);
  }

  const docsDir = path.join(projectRoot, 'docs');
  if (fs.existsSync(docsDir)) {
    try {
      const files = fs
        .readdirSync(docsDir)
        .filter((f) => f.toLowerCase().endsWith('.md'))
        .sort((a, b) => a.localeCompare(b));
      for (const file of files) {
        const abs = path.join(docsDir, file);
        if (seen.has(abs)) continue;
        seen.add(abs);
        result.push(abs);
      }
    } catch {
      // Ignore docs directory read failures
    }
  }

  return result.slice(0, SWARM_CONTEXT_MAX_DOC_FILES);
}

function listAvailableConfigFiles(projectRoot: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const addPath = (absPath: string) => {
    if (!absPath.toLowerCase().endsWith('.json')) return;
    if (seen.has(absPath)) return;
    seen.add(absPath);
    result.push(absPath);
  };

  try {
    for (const file of fs.readdirSync(projectRoot)) {
      if (!file.toLowerCase().startsWith('oompa')) continue;
      addPath(path.join(projectRoot, file));
    }
  } catch {
    // Ignore root listing failures
  }

  const oompaDir = path.join(projectRoot, 'oompa');
  if (fs.existsSync(oompaDir)) {
    try {
      for (const file of fs.readdirSync(oompaDir)) {
        if (!file.toLowerCase().startsWith('oompa')) continue;
        addPath(path.join(oompaDir, file));
      }
    } catch {
      // Ignore oompa/ listing failures
    }
  }

  return result.sort((a, b) => a.localeCompare(b));
}

app.get('/api/oompa-swarm-context', (req: Request, res: Response) => {
  const dir = typeof req.query.dir === 'string' ? req.query.dir : '';
  if (!dir.trim()) {
    res.status(400).json({ error: 'Directory path required' });
    return;
  }

  const projectRoot = resolveWorkingDirectoryInput(dir);
  if (!fs.existsSync(projectRoot)) {
    res.status(404).json({ error: 'Directory does not exist' });
    return;
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(projectRoot);
  } catch (error) {
    res.status(500).json({ error: `Failed to stat directory: ${(error as Error).message}` });
    return;
  }

  if (!stats.isDirectory()) {
    res.status(400).json({ error: 'Path must be a directory' });
    return;
  }

  const availableConfigs = listAvailableConfigFiles(projectRoot);
  const configPath = path.join(projectRoot, 'oompa.json');
  let oompaConfigSummary = 'No oompa.json found';
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      const workers = Array.isArray(config.workers)
        ? (config.workers as Array<Record<string, unknown>>)
        : [];
      const reviewer = config.reviewer && typeof config.reviewer === 'object';
      const planner = config.planner && typeof config.planner === 'object';
      const workerSummary =
        workers.length === 0
          ? 'workers=0'
          : `workers=${workers.length} (${workers
              .map((w, i) => {
                const harness = typeof w.harness === 'string' ? w.harness : 'default';
                const model = typeof w.model === 'string' ? w.model : 'default';
                const count = typeof w.count === 'number' ? `x${w.count}` : '';
                return `w${i}:${harness}:${model}${count}`;
              })
              .join(', ')})`;
      oompaConfigSummary = `${workerSummary}; reviewer=${reviewer ? 'yes' : 'no'}; planner=${
        planner ? 'yes' : 'no'
      }`;
    } catch (error) {
      oompaConfigSummary = `Failed to parse oompa.json: ${(error as Error).message}`;
    }
  }

  const oompaStatus = clip(runCommandCapture('oompa status', projectRoot), SWARM_CONTEXT_MAX_OUTPUT_CHARS);
  const oompaInfo = clip(runCommandCapture('oompa info', projectRoot), SWARM_CONTEXT_MAX_OUTPUT_CHARS);
  const docCandidates = findDocCandidates(projectRoot);
  const docBlocks = docCandidates.map((absPath) => {
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      const rel = path.relative(projectRoot, absPath) || path.basename(absPath);
      return `### ${rel}\n${clip(content, SWARM_CONTEXT_MAX_DOC_CHARS)}`;
    } catch (error) {
      const rel = path.relative(projectRoot, absPath) || path.basename(absPath);
      return `### ${rel}\nFailed to read file: ${(error as Error).message}`;
    }
  });

  const lines: string[] = [
    'You are helping create and run a NEW oompa swarm configuration.',
    'Use this context before writing or editing swarm config files.',
    '',
    '## Project Context',
    `- Project: ${projectRoot}`,
    `- Generated At: ${new Date().toISOString()}`,
    `- Primary Config: ${fs.existsSync(configPath) ? configPath : 'not found'}`,
    `- Oompa Config Summary: ${oompaConfigSummary}`,
    '',
    '## Available Oompa Config Files',
  ];

  if (availableConfigs.length === 0) {
    lines.push('- (none found)');
  } else {
    for (const cfg of availableConfigs) {
      lines.push(`- ${cfg}`);
    }
  }

  lines.push(
    '',
    '## Command Output: oompa status',
    '```',
    oompaStatus || '(no output)',
    '```',
    '',
    '## Command Output: oompa info',
    '```',
    oompaInfo || '(no output)',
    '```',
    '',
    '## Docs To Follow For Good Oompa Agents',
    ...(docBlocks.length > 0
      ? docBlocks.flatMap((block) => ['```markdown', block, '```'])
      : ['No docs discovered (look for README.md, AGENTS.md, and docs/*.md).']),
    '',
    'When the user asks for a new swarm config, follow these docs and command outputs exactly.',
    'Prefer editing or creating oompa config files and explain why each worker/planner/reviewer setting exists.'
  );

  res.json({ prefix: lines.join('\n') });
});

app.get('/api/git-log', (req: Request, res: Response) => {
  const dir = req.query.dir as string;
  if (!dir || !dir.startsWith('/')) {
    res.status(400).json({ error: 'Absolute directory path required' });
    return;
  }

  const resolved = path.resolve(dir);
  if (!isUnderKnownProject(resolved)) {
    res.status(403).json({ error: 'Directory not associated with any conversation' });
    return;
  }

  // Use tab delimiter — tabs never appear in commit messages, unlike |
  try {
    const raw = execSync('git log --oneline -20 --format="%H\t%s\t%aI\t%an"', {
      cwd: resolved,
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim();

    const entries = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        if (parts.length < 4) return { hash: parts[0] ?? '', message: line, date: '', author: '' };
        return { hash: parts[0], message: parts[1], date: parts[2], author: parts[3] };
      });

    res.json(entries);
  } catch {
    res.json([]);
  }
});

app.get('/api/oompa-config', (req: Request, res: Response) => {
  const dir = req.query.dir as string;
  if (!dir || !dir.startsWith('/')) {
    res.status(400).json({ error: 'Absolute directory path required' });
    return;
  }

  const resolved = path.resolve(dir);
  if (!isUnderKnownProject(resolved)) {
    res.status(403).json({ error: 'Directory not associated with any conversation' });
    return;
  }

  const configPath = path.join(resolved, 'oompa.json');
  if (!fs.existsSync(configPath)) {
    res.status(404).json({ error: 'No oompa.json found' });
    return;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    res.json(JSON.parse(content));
  } catch (e) {
    res.status(500).json({ error: `Failed to parse oompa.json: ${(e as Error).message}` });
  }
});

// =============================================================================
// Swarm Run Data API — serves structured run/review/summary JSON from
// runs/{swarm-id}/ written by oompa's agentnet.runs module.
// =============================================================================

/**
 * Synthesize a SwarmRunSummary from run.json (or started.json) worker configs + review files.
 *
 * Keep this synthesis path for compatibility with older runs or environments
 * where summary.json is missing; otherwise prefer live/final summary data from
 * runs/{swarm-id}/summary.json when available.
 * NOTE: New event-sourced runs use started.json instead of run.json.
 *
 * Verdict buckets:
 *   "approved"      → merges (iteration merged to main)
 *   "rejected"      → rejections (iteration permanently rejected)
 *   "needs-changes" → neither (iteration sent back for another round)
 */
async function synthesizeSummary(
  runDir: string,
  swarmId: string,
  run: OompaStarted
): Promise<Record<string, unknown>> {
  // Read cycle files — these are the primary source of truth for worker progress
  const cyclesDir = path.join(runDir, 'cycles');
  const iterationsDir = path.join(runDir, 'iterations');
  let cycleFileDir: string | null = null;
  try {
    await fs.promises.access(cyclesDir);
    cycleFileDir = cyclesDir;
  } catch {
    try {
      await fs.promises.access(iterationsDir);
      cycleFileDir = iterationsDir;
    } catch {
      // No cycle data at all
    }
  }

  // OompaCycle is the schema-authoritative type. Old runs may use 'iteration' instead of 'cycle'.
  const cyclesByWorker = new Map<string, OompaCycle[]>();

  if (cycleFileDir) {
    const cycleFileNames = (await fs.promises.readdir(cycleFileDir)).filter((f) =>
      f.endsWith('.json')
    );
    await Promise.all(
      cycleFileNames.map(async (cf) => {
        try {
          const content = await fs.promises.readFile(path.join(cycleFileDir!, cf), 'utf-8');
          const cycle = JSON.parse(content) as OompaCycle;
          const wid = cycle['worker-id'];
          if (!wid) return;
          if (!cyclesByWorker.has(wid)) cyclesByWorker.set(wid, []);
          cyclesByWorker.get(wid)!.push(cycle);
        } catch {
          // Skip malformed cycle files
        }
      })
    );
  }

  // Read review files
  const reviewsDir = path.join(runDir, 'reviews');
  let reviewFileNames: string[] = [];
  try {
    reviewFileNames = (await fs.promises.readdir(reviewsDir)).filter((f) => f.endsWith('.json'));
  } catch {
    // No reviews directory
  }

  const reviewsByWorker = new Map<string, OompaReviewLog[]>();

  await Promise.all(
    reviewFileNames.map(async (rf) => {
      try {
        const content = await fs.promises.readFile(path.join(reviewsDir, rf), 'utf-8');
        const review = JSON.parse(content) as OompaReviewLog;
        const wid = review['worker-id'];
        if (!wid) return;
        if (!reviewsByWorker.has(wid)) reviewsByWorker.set(wid, []);
        reviewsByWorker.get(wid)!.push(review);
      } catch {
        // Skip malformed review files
      }
    })
  );

  // Check liveness: stopped.json present = done, else check PID
  const stoppedFile = path.join(runDir, 'stopped.json');
  let isStopped = false;
  try {
    await fs.promises.access(stoppedFile);
    isStopped = true;
  } catch {
    // No stopped.json — check PID
  }

  let isLive = false;
  if (!isStopped) {
    const pid = run.pid;
    if (typeof pid === 'number') {
      isLive = isPidAlive(String(pid));
    }
  }
  const startedAtMs = Date.parse(String(run['started-at'] ?? ''));
  const liveNoCycleGraceMs = 60_000;

  const workers = (run.workers ?? []).map((w) => {
    const wid = w.id;
    const workerCycles = cyclesByWorker.get(wid) ?? [];
    const workerReviews = reviewsByWorker.get(wid) ?? [];

    // Count outcomes from cycle data
    let merges = 0;
    let rejections = 0;
    let errors = 0;
    let latestOutcome: OompaCycle['outcome'] | null = null;
    let latestCycleNum = 0;

    for (const c of workerCycles) {
      const num = c.cycle ?? 0;
      if (num > latestCycleNum) {
        latestCycleNum = num;
        latestOutcome = c.outcome;
      }
      if (c.outcome === 'merged') merges++;
      else if (c.outcome === 'rejected') rejections++;
      else if (c.outcome === 'error' || c.outcome === 'sync-failed' || c.outcome === 'merge-failed')
        errors++;
    }

    // Derive status from what we actually know — never fabricate
    let status: string;
    if (workerCycles.length === 0 && !isLive) {
      status = 'unknown'; // No data and not running — don't pretend we know
    } else if (workerCycles.length === 0 && isLive) {
      const noCycleShouldBeRunning =
        !Number.isFinite(startedAtMs) || Date.now() - startedAtMs > liveNoCycleGraceMs;
      status = noCycleShouldBeRunning ? 'running' : 'starting';
    } else if (latestOutcome === 'done' || latestOutcome === 'executor-done') {
      status = 'completed';
    } else if (latestOutcome === 'error') {
      status = 'error';
    } else if (isLive) {
      status = 'running';
    } else if (isStopped) {
      status = 'completed';
    } else {
      status = 'unknown'; // Not running, no stopped.json, ambiguous — say so
    }

    // needs-changes from reviews
    let needsChanges = 0;
    // OompaReviewLog uses 'cycle' (schema-authoritative), keyed per-cycle for last verdict
    const cycleVerdicts = new Map<number, OompaReviewLog['verdict']>();
    for (const r of workerReviews) {
      cycleVerdicts.set(r.cycle, r.verdict);
    }
    for (const verdict of cycleVerdicts.values()) {
      if (verdict === 'needs-changes') needsChanges++;
    }

    return {
      id: wid,
      harness: w.harness ?? 'default',
      model: w.model ?? 'unknown',
      status,
      completed: merges + rejections,
      iterations: w.iterations ?? 0,
      merges,
      rejections,
      'needs-changes': needsChanges,
      errors,
      'review-rounds-total': workerReviews.length,
    };
  });

  // Timestamps: only report what we actually have
  let latestTimestamp = '';
  for (const cycles of cyclesByWorker.values()) {
    for (const c of cycles) {
      if (c.timestamp && c.timestamp > latestTimestamp) {
        latestTimestamp = c.timestamp;
      }
    }
  }
  for (const reviews of reviewsByWorker.values()) {
    for (const r of reviews) {
      if (r.timestamp && r.timestamp > latestTimestamp) {
        latestTimestamp = r.timestamp;
      }
    }
  }

  return {
    'swarm-id': swarmId,
    // Don't fabricate finished-at from started-at — null means "we don't know"
    'finished-at': isStopped ? latestTimestamp || null : isLive ? null : latestTimestamp || null,
    'total-workers': workers.length,
    'total-completed': workers.reduce((s, w) => s + w.completed, 0),
    'total-iterations': workers.reduce((s, w) => s + w.iterations, 0),
    'status-counts': {},
    workers,
  };
}

app.get('/api/swarm-runs', async (req: Request, res: Response) => {
  const dir = req.query.dir as string;
  if (!dir || !dir.startsWith('/')) {
    res.status(400).json({ error: 'Absolute directory path required' });
    return;
  }

  const resolved = path.resolve(dir);
  if (!isUnderKnownProject(resolved)) {
    res.status(403).json({ error: 'Directory not associated with any conversation' });
    return;
  }

  const runsDir = path.join(resolved, 'runs');
  try {
    await fs.promises.access(runsDir);
  } catch {
    res.json({ runs: [] });
    return;
  }

  const entries = await fs.promises.readdir(runsDir, { withFileTypes: true });
  const runs = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const runDir = path.join(runsDir, e.name);
        const startedFile = path.join(runDir, 'started.json');
        const runFile = path.join(runDir, 'run.json'); // backward compat
        const summaryFile = path.join(runDir, 'summary.json');

        let run: OompaStarted | null = null;
        let summary = null;

        // New format: started.json; old format: run.json (same shape = OompaStarted)
        try {
          run = JSON.parse(await fs.promises.readFile(startedFile, 'utf-8')) as OompaStarted;
        } catch {
          try {
            run = JSON.parse(await fs.promises.readFile(runFile, 'utf-8')) as OompaStarted;
          } catch {
            // No started.json or run.json — skip
          }
        }
        try {
          summary = JSON.parse(await fs.promises.readFile(summaryFile, 'utf-8'));
        } catch {
          // No summary.json — synthesize below
        }

        if (!summary && run) {
          summary = await synthesizeSummary(runDir, e.name, run);
        }

        return { swarmId: e.name, run, summary };
      })
  );

  runs.sort((a, b) => {
    const aTime = a.run?.['started-at'] ?? '';
    const bTime = b.run?.['started-at'] ?? '';
    return bTime.localeCompare(aTime);
  });

  res.json({ runs });
});

// Count .json files added in merge commits during a swarm run's time window.
// Uses git log --merges with the run's started-at / finished-at to scope commits,
// then --diff-filter=A --name-only to find added .json files across those merges.
app.get('/api/swarm-new-files', async (req: Request, res: Response) => {
  const dir = req.query.dir as string;
  const swarmId = req.query.swarmId as string;
  if (!dir || !dir.startsWith('/') || !swarmId) {
    res.status(400).json({ error: 'Absolute directory path and swarmId required' });
    return;
  }

  const resolved = path.resolve(dir);
  if (!isUnderKnownProject(resolved)) {
    res.status(403).json({ error: 'Directory not associated with any conversation' });
    return;
  }

  const runDir = path.join(resolved, 'runs', swarmId);

  // Read start time from started.json or run.json (backward compat)
  let startedAt: string | null = null;
  for (const filename of ['started.json', 'run.json']) {
    try {
      const data = JSON.parse(
        await fs.promises.readFile(path.join(runDir, filename), 'utf-8')
      ) as Record<string, unknown>;
      if (typeof data['started-at'] === 'string') {
        startedAt = data['started-at'];
        break;
      }
    } catch {
      // try next file
    }
  }

  if (!startedAt) {
    res.json({ count: 0, files: [] });
    return;
  }

  // Read finish time from summary.json or stopped.json (open-ended if still running)
  let finishedAt: string | null = null;
  for (const filename of ['summary.json', 'stopped.json']) {
    try {
      const data = JSON.parse(
        await fs.promises.readFile(path.join(runDir, filename), 'utf-8')
      ) as Record<string, unknown>;
      const t = data['finished-at'] ?? data['stopped-at'];
      if (typeof t === 'string') {
        finishedAt = t;
        break;
      }
    } catch {
      // try next file
    }
  }

  try {
    // Sanitize ISO 8601 timestamps — only allow digits, T, :, Z, ., +, -
    const safeStart = startedAt.replace(/[^0-9T:Z.+\-]/g, '');
    const beforeFlag = finishedAt
      ? `--before="${finishedAt.replace(/[^0-9T:Z.+\-]/g, '')}"`
      : '';

    const raw = execSync(
      `git log --merges --after="${safeStart}" ${beforeFlag} --diff-filter=A --name-only --pretty=format: -- "*.json"`,
      { cwd: resolved, timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    )
      .toString()
      .trim();

    const files = raw.split('\n').filter((l) => l.trim().length > 0);
    res.json({ count: files.length, files });
  } catch {
    res.json({ count: 0, files: [] });
  }
});

app.get('/api/swarm-runtime', (req: Request, res: Response) => {
  const dir = req.query.dir as string;
  if (!dir || !dir.startsWith('/')) {
    res.status(400).json({ error: 'Absolute directory path required' });
    return;
  }

  const resolved = path.resolve(dir);
  if (!isUnderKnownProject(resolved)) {
    res.status(403).json({ error: 'Directory not associated with any conversation' });
    return;
  }

  const snapshot = readLatestOompaRuntime(resolved);
  res.json(snapshot);
});

/**
 * Discover all projects that have oompa runs/ directories.
 * This is the primary swarm discovery mechanism — derived from oompa's own
 * event-sourced run data, not from conversation files. Projects appear here
 * even when workers use non-Claude harnesses (gemini, codex, etc.) that
 * don't produce JSONL conversation files.
 */
app.get('/api/swarm-projects', (_req: Request, res: Response) => {
  // Collect unique project roots from all conversations
  const projectRoots = new Set<string>();
  for (const conv of conversations.values()) {
    if (conv.workingDirectory) {
      projectRoots.add(path.resolve(conv.workingDirectory));
    }
  }

  const projects: Array<{
    projectRoot: string;
    projectName: string;
    runtime: ReturnType<typeof readLatestOompaRuntime>;
  }> = [];

  for (const root of projectRoots) {
    const runsDir = path.join(root, 'runs');
    try {
      if (!fs.existsSync(runsDir)) continue;
      const latestRun = readLatestRunDir(runsDir);
      if (!latestRun) continue;
      // Verify it has a started.json (not just a random directory)
      const startedPath = path.join(latestRun.path, 'started.json');
      if (!fs.existsSync(startedPath)) continue;

      const runtime = readLatestOompaRuntime(root);
      projects.push({
        projectRoot: root,
        projectName: root.split('/').filter(Boolean).pop() ?? root,
        runtime,
      });
    } catch {
      // Skip projects where runs/ scan fails
    }
  }

  res.json({ projects });
});

/**
 * Send stop (SIGTERM) or kill (SIGKILL) signal to a running oompa swarm.
 * - 'stop': graceful — workers finish current cycle then exit
 * - 'kill': immediate — SIGKILL bypasses shutdown hooks, so we write stopped.json
 */
app.post('/api/swarm-signal', (req: Request, res: Response) => {
  const { dir, signal, swarmId } = req.body as {
    dir?: string;
    signal?: 'stop' | 'kill';
    swarmId?: string;
  };

  if (!dir || !dir.startsWith('/')) {
    res.status(400).json({ ok: false, message: 'Absolute directory path required' });
    return;
  }
  if (signal !== 'stop' && signal !== 'kill') {
    res.status(400).json({ ok: false, message: 'signal must be "stop" or "kill"' });
    return;
  }

  const resolved = path.resolve(dir);
  if (!isUnderKnownProject(resolved)) {
    res.status(403).json({ ok: false, message: 'Directory not associated with any conversation' });
    return;
  }

  // Find the run directory
  const runsDir = path.join(resolved, 'runs');
  let runDir: string;
  if (swarmId) {
    // Prevent path traversal — swarmId must not escape runsDir
    const candidate = path.resolve(runsDir, swarmId);
    if (!candidate.startsWith(runsDir + path.sep)) {
      res.status(400).json({ ok: false, message: 'Invalid swarmId' });
      return;
    }
    runDir = candidate;
  } else {
    const latest = readLatestRunDir(runsDir);
    if (!latest) {
      res.status(404).json({ ok: false, message: 'No runs found' });
      return;
    }
    runDir = latest.path;
  }

  // Check if already stopped
  const stoppedPath = path.join(runDir, 'stopped.json');
  if (fs.existsSync(stoppedPath)) {
    res.json({ ok: false, message: 'Swarm already stopped' });
    return;
  }

  // Read PID from started.json
  const startedData = safeReadJson(path.join(runDir, 'started.json')) as Record<
    string,
    unknown
  > | null;
  const pid = startedData?.pid as number | undefined;
  if (!pid || !Number.isFinite(pid) || pid <= 0) {
    res.json({ ok: false, message: 'No valid PID found in started.json' });
    return;
  }

  // Check if PID is alive
  if (!isPidAlive(String(pid))) {
    // Stale PID — write stopped.json to clean up
    const stoppedEvent = {
      'swarm-id': startedData?.['swarm-id'] ?? 'unknown',
      'stopped-at': new Date().toISOString(),
      reason: 'interrupted',
      error: 'Process was not running (stale PID)',
    };
    fs.writeFileSync(stoppedPath, JSON.stringify(stoppedEvent, null, 2));
    res.json({ ok: true, message: 'Swarm was not running (stale PID). Marked as stopped.' });
    return;
  }

  // Send the signal
  try {
    if (signal === 'stop') {
      process.kill(pid, 'SIGTERM');
      res.json({
        ok: true,
        message: `SIGTERM sent to PID ${pid}. Workers will finish current cycle.`,
      });
    } else {
      process.kill(pid, 'SIGKILL');
      // SIGKILL bypasses shutdown hooks — write stopped.json ourselves
      const stoppedEvent = {
        'swarm-id': startedData?.['swarm-id'] ?? 'unknown',
        'stopped-at': new Date().toISOString(),
        reason: 'interrupted',
      };
      fs.writeFileSync(stoppedPath, JSON.stringify(stoppedEvent, null, 2));
      res.json({ ok: true, message: `SIGKILL sent to PID ${pid}. Swarm terminated.` });
    }
  } catch (err) {
    res.status(500).json({ ok: false, message: `Failed to send signal: ${err}` });
  }
});

app.get('/api/swarm-reviews', (req: Request, res: Response) => {
  const dir = req.query.dir as string;
  const swarmId = req.query.swarmId as string;
  if (!dir || !dir.startsWith('/') || !swarmId) {
    res.status(400).json({ error: 'dir (absolute path) and swarmId required' });
    return;
  }

  const resolved = path.resolve(dir);
  if (!isUnderKnownProject(resolved)) {
    res.status(403).json({ error: 'Directory not associated with any conversation' });
    return;
  }

  // Prevent path traversal — swarmId must not escape runsDir (mirrors /api/swarm-signal)
  const runsDir = path.join(resolved, 'runs');
  const swarmRunDir = path.resolve(runsDir, swarmId);
  if (!swarmRunDir.startsWith(runsDir + path.sep)) {
    res.status(400).json({ error: 'Invalid swarmId' });
    return;
  }

  const reviewsDir = path.join(swarmRunDir, 'reviews');
  if (!fs.existsSync(reviewsDir)) {
    res.json({ reviews: [] });
    return;
  }

  const files = fs
    .readdirSync(reviewsDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  // Per-file try/catch so one bad file doesn't crash the whole endpoint
  const reviews: OompaReviewLog[] = files.flatMap((f) => {
    try {
      const content = fs.readFileSync(path.join(reviewsDir, f), 'utf-8');
      return [JSON.parse(content) as OompaReviewLog];
    } catch {
      return [];
    }
  });

  res.json({ reviews });
});

app.get('/api/read-file', (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath || !filePath.startsWith('/')) {
    res.status(400).json({ error: 'Absolute path required' });
    return;
  }

  const resolved = path.resolve(filePath);
  if (!isUnderKnownProject(resolved)) {
    res.status(403).json({ error: 'Path not under any known project directory' });
    return;
  }

  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  res.json({ content });
});

app.post('/api/settings', (req: Request, res: Response) => {
  const settings = { ...getSettings(), ...req.body };
  writeSettingsAsync(settings);
  res.json(settings);
});

// =============================================================================
// Custom Palette API — AI-generated color palettes stored as plain .json files
// Palettes are saved in ~/.agent-viewer/palettes/palette_{N}.json
// Each file stores a Palette16 (14 color keys + name + description).
//
// Palette16 keys: base03, base02, base01, base00, base0, base1,
//                 yellow, orange, red, magenta, violet, blue, cyan, green
// =============================================================================

const PALETTES_DIR = path.join(os.homedir(), '.agent-viewer', 'palettes');

/** The 14 semantic keys that make up a Palette16 (excluding 'name') */
const PALETTE16_KEYS = [
  'bgCanvas',
  'bgSurface',
  'textMuted',
  'textSubtle',
  'textBody',
  'textBright',
  'primary',
  'user',
  'ai',
  'success',
  'warning',
  'queue',
  'danger',
  'meta',
] as const;

/** Shape stored on disk — Palette16 values plus description for provenance */
interface StoredPalette {
  name: string;
  description: string;
  bgCanvas: string;
  bgSurface: string;
  textMuted: string;
  textSubtle: string;
  textBody: string;
  textBright: string;
  primary: string;
  user: string;
  ai: string;
  success: string;
  warning: string;
  queue: string;
  danger: string;
  meta: string;
}

// =============================================================================
// Palette Cache — initialized once at startup, updated on generate
// =============================================================================

/** In-memory cache of custom palettes (keyed by "custom_N") */
let paletteCache: Record<string, Record<string, string>> = {};
/** Next available palette number (incremented after each generation) */
let nextPaletteNumber = 1;

/**
 * Initialize palette cache from disk. Called once at startup.
 * Reads all palette_N.json files and builds the cache.
 */
async function initPaletteCache(): Promise<void> {
  paletteCache = {};
  nextPaletteNumber = 1;

  try {
    const entries = await fs.promises.readdir(PALETTES_DIR, { withFileTypes: true });

    // Parse all palette files in parallel
    const parsePromises = entries
      .filter((entry) => entry.isFile() && /^palette_\d+\.json$/.test(entry.name))
      .map(async (entry) => {
        const match = entry.name.match(/^palette_(\d+)\.json$/);
        if (!match) return null;

        const n = Number.parseInt(match[1], 10);
        const filePath = path.join(PALETTES_DIR, entry.name);

        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const stored = JSON.parse(content) as StoredPalette;
          const palette: Record<string, string> = { name: stored.name };
          for (const key of PALETTE16_KEYS) {
            palette[key] = stored[key];
          }
          return { key: `custom_${n}`, palette, n };
        } catch (e) {
          console.error(`Failed to parse palette file ${entry.name}:`, e);
          return null;
        }
      });

    const results = await Promise.all(parsePromises);

    for (const result of results) {
      if (result) {
        paletteCache[result.key] = result.palette;
        if (result.n >= nextPaletteNumber) {
          nextPaletteNumber = result.n + 1;
        }
      }
    }

    console.log(
      `Palette cache initialized: ${Object.keys(paletteCache).length} palettes, next number: ${nextPaletteNumber}`
    );
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // Directory doesn't exist — no palettes yet
      console.log('Palettes directory not found, starting with empty cache');
    } else {
      throw new Error(`Failed to initialize palette cache: ${(e as Error).message}`);
    }
  }
}

// GET /api/custom-palettes — returns Record<string, Palette16> of saved custom palettes
// Each entry has { name, base03, base02, ..., green } matching the Palette16 interface.
// Reads from in-memory cache (zero I/O).
app.get('/api/custom-palettes', (_req: Request, res: Response) => {
  res.json(paletteCache);
});

// POST /api/generate-palette — run executeCommand in single-shot mode to generate a palette.
// Query param ?provider=... selects the harness (defaults to 'claude').
// Query param ?provider=codex to use a different agent (defaults to 'claude').
app.post('/api/generate-palette', (req: Request, res: Response) => {
  const { description } = req.body as { description?: string };
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    res.status(400).json({ error: 'description is required' });
    return;
  }

  // Allow choosing which agent generates the palette (default: claude)
  const providerName = (req.query.provider as string) || 'claude';
  getProvider(providerName as ProviderName);

  // 4 example palettes from our library so the AI understands the semantic color system
  const examplePalettes = `
Here are 4 example palettes from our library for reference. Keys are semantic roles, not literal colors:

Solarized Dark:
{"name":"Solarized Dark","bgCanvas":"#002b36","bgSurface":"#073642","textMuted":"#586e75","textSubtle":"#657b83","textBody":"#839496","textBright":"#93a1a1","primary":"#6c71c4","user":"#268bd2","ai":"#2aa198","success":"#859900","warning":"#b58900","queue":"#cb4b16","danger":"#dc322f","meta":"#d33682"}

Nord:
{"name":"Nord","bgCanvas":"#2e3440","bgSurface":"#3b4252","textMuted":"#4c566a","textSubtle":"#d8dee9","textBody":"#e5e9f0","textBright":"#eceff4","primary":"#5e81ac","user":"#81a1c1","ai":"#88c0d0","success":"#a3be8c","warning":"#ebcb8b","queue":"#d08770","danger":"#bf616a","meta":"#b48ead"}

Tokyo Night:
{"name":"Tokyo Night","bgCanvas":"#1a1b26","bgSurface":"#24283b","textMuted":"#414868","textSubtle":"#565f89","textBody":"#a9b1d6","textBright":"#c0caf5","primary":"#7aa2f7","user":"#7dcfff","ai":"#7dcfff","success":"#9ece6a","warning":"#e0af68","queue":"#ff9e64","danger":"#f7768e","meta":"#bb9af7"}

Catppuccin Mocha:
{"name":"Catppuccin Mocha","bgCanvas":"#1e1e2e","bgSurface":"#313244","textMuted":"#45475a","textSubtle":"#6c7086","textBody":"#cdd6f4","textBright":"#bac2de","primary":"#89b4fa","user":"#89dceb","ai":"#94e2d5","success":"#a6e3a1","warning":"#f9e2af","queue":"#fab387","danger":"#f38ba8","meta":"#cba6f7"}`;

  const prompt = `Design a 14-token semantic color palette for a dark-themed code editor UI based on this description: "${description.trim()}"
${examplePalettes}

You MUST respond with ONLY a JSON object (no markdown, no explanation) with exactly these 15 keys:
{
  "name": "Palette Name",
  "bgCanvas": "#hex",
  "bgSurface": "#hex",
  "textMuted": "#hex",
  "textSubtle": "#hex",
  "textBody": "#hex",
  "textBright": "#hex",
  "primary": "#hex",
  "user": "#hex",
  "ai": "#hex",
  "success": "#hex",
  "warning": "#hex",
  "queue": "#hex",
  "danger": "#hex",
  "meta": "#hex"
}

Requirements:
- All values must be valid #RRGGBB hex strings.
- bgCanvas must be the darkest (the main background). bgSurface slightly lighter (surface/card bg).
- textMuted = muted/comment text. textSubtle = secondary text. textBody = primary body text. textBright = emphasis text.
- Monotonic luminance: bgCanvas (darkest) < bgSurface < textMuted < textSubtle < textBody <= textBright (lightest).
- The 8 intent colors (primary, user, ai, success, warning, queue, danger, meta) should be visually distinct.
- Intent colors should have good contrast (WCAG AA, >= 4.5:1) against the bgCanvas background.
- Monochromatic and analogous palettes are encouraged — you don't need rainbow variety.
  For example, a "forest" theme might use green-tinted variants for most intents.
- Prefer perceptually uniform accent lightness (all intents roughly equal perceived brightness).
- bgCanvas should be very dark (suitable for long coding sessions).`;

  // Use cached counter instead of scanning filesystem
  const n = nextPaletteNumber;
  nextPaletteNumber++;

  void (async () => {
    let stdout = '';
    let stderr = '';
    let responded = false;

    // Guard: only send one HTTP response per request
    const sendError = (status: number, error: string) => {
      if (responded) return;
      responded = true;
      console.error(`[generate-palette] Error: ${error}`);
      res.status(status).json({ error });
    };

    const turn = executeCommand({
      harness: providerName as 'claude' | 'codex' | 'gemini' | 'opencode' | 'pi' | 'qwen',
      mode: 'single-shot',
      prompt,
      cwd: process.cwd(),
      yolo: true,
      debugRawEvents: AGENT_CLI_DEBUG_EVENTS,
    });

    // Timeout: kill the process if it takes longer than 90 seconds
    const TIMEOUT_MS = 90_000;
    const timeout = setTimeout(() => {
      console.error(`[generate-palette] Timed out after ${TIMEOUT_MS / 1000}s — killing process`);
      turn.stop('SIGTERM');
      sendError(504, `Palette generation timed out after ${TIMEOUT_MS / 1000}s`);
    }, TIMEOUT_MS);

    try {
      for await (const event of turn.events) {
        switch (event.type) {
          case 'text.delta':
            stdout += event.text;
            break;
          case 'stderr':
            stderr += event.text;
            break;
          case 'out_of_tokens':
          case 'error':
            stderr += `${event.message}\n`;
            break;
          default:
            break;
        }
      }

      const completion = await turn.completed;
      clearTimeout(timeout);

      if (completion.exitCode !== 0 || completion.reason !== 'success') {
        sendError(
          500,
          `${providerName} process failed (exit code ${completion.exitCode})${stderr ? `: ${stderr.slice(0, 500)}` : ''}`
        );
        return;
      }

      let parsed: Record<string, string>;
      try {
        const trimmed = stdout.trim();
        // Strip markdown fences if the agent added them despite instructions
        const jsonStr = trimmed.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
        parsed = JSON.parse(jsonStr) as Record<string, string>;
        if (!parsed.name) {
          throw new Error('Missing "name" field');
        }
        // Validate all 14 palette keys are present and are valid hex
        for (const key of PALETTE16_KEYS) {
          if (!parsed[key] || !/^#[0-9a-fA-F]{6}$/.test(parsed[key])) {
            throw new Error(`Missing or invalid hex for key "${key}": ${parsed[key]}`);
          }
        }
      } catch (parseErr) {
        console.error(
          `[generate-palette] Raw stdout (first 500 chars):`,
          stdout.substring(0, 500)
        );
        const msg = parseErr instanceof Error ? parseErr.message : 'Unknown parse error';
        sendError(500, `Failed to parse palette from ${providerName} response: ${msg}`);
        return;
      }

      // Build StoredPalette (Palette16 + description for provenance)
      const stored: StoredPalette = {
        name: parsed.name,
        description: description.trim(),
        bgCanvas: parsed.bgCanvas,
        bgSurface: parsed.bgSurface,
        textMuted: parsed.textMuted,
        textSubtle: parsed.textSubtle,
        textBody: parsed.textBody,
        textBright: parsed.textBright,
        primary: parsed.primary,
        user: parsed.user,
        ai: parsed.ai,
        success: parsed.success,
        warning: parsed.warning,
        queue: parsed.queue,
        danger: parsed.danger,
        meta: parsed.meta,
      };

      // Build Palette16 shape for client and cache
      const key = `custom_${n}`;
      const palette: Record<string, string> = { name: parsed.name };
      for (const k of PALETTE16_KEYS) {
        palette[k] = parsed[k];
      }

      // Update cache immediately
      paletteCache[key] = palette;

      // Fire-and-forget disk write. On failure, roll back cache entry so a
      // restart doesn't silently lose the palette (the client still has it for
      // this session, but won't survive a server restart without the file).
      void (async () => {
        try {
          await fs.promises.mkdir(PALETTES_DIR, { recursive: true });
          const filePath = path.join(PALETTES_DIR, `palette_${n}.json`);
          await fs.promises.writeFile(filePath, JSON.stringify(stored, null, 2));
          console.log(`[generate-palette] Saved palette to ${filePath}`);
        } catch (writeErr) {
          console.error(`[generate-palette] Failed to save palette file:`, writeErr);
          delete paletteCache[key];
        }
      })();

      // Return Palette16 shape to client
      if (responded) return; // timeout already fired
      responded = true;
      console.log(`[generate-palette] Success: "${parsed.name}" -> ${key}`);
      res.json({ key, palette });
    } catch (err) {
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : String(err);
      sendError(500, `Palette generation failed: ${message}`);
    }
  })();
});

// =============================================================================
// GET /api/usage — Aggregate token usage from Claude + Codex + OpenCode sessions.
//
// Reads persisted files on disk, sums token counts, and computes approximate cost.
// Claude: ~/.claude/projects/**/*.jsonl → assistant entries with message.usage
// Codex:  ~/.codex/sessions/**/*.jsonl  → event_msg with payload.type=token_count
// OpenCode: ~/.local/share/opencode/storage/message/{session-id}/*.json
//
// Query params:
//   ?days=N  — only include sessions from the last N days (default: 30)
// =============================================================================

interface UsageEntry {
  sessionId: string;
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  date: string; // YYYY-MM-DD
}

// Approximate pricing per 1M tokens (as of early 2026).
// Claude: input $3, output $15, cache read $0.30, cache write $3.75
// Codex: input $2.50, output $10
function estimateCost(
  provider: ProviderName,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number
): number {
  if (provider === 'claude') {
    return (input * 3 + output * 15 + cacheRead * 0.3 + cacheWrite * 3.75) / 1_000_000;
  }
  // Codex/OpenAI and OpenCode (provider-backed model pricing can vary by backend).
  // Gemini mirrors Codex-like pricing here until token billing data is emitted per-provider.
  return (input * 2.5 + output * 10) / 1_000_000;
}

// Per-session cached usage data so we don't re-read unchanged files.
// Maps filePath → { mtimeMs, data }. Survives across requests.
const usageFileCache = new Map<
  string,
  { mtimeMs: number; data: UsageEntry & { timestampedTokens: { ts: number; tokens: number }[] } }
>();
const openCodeUsageCache = new Map<
  string,
  { mtimeMs: number; data: UsageEntry & { lastTimestampMs: number } }
>();

// Full response cache — avoids re-aggregating when nothing changed.
// Key is `days` param. Invalidated after USAGE_CACHE_TTL_MS.
interface RateLimit {
  label: string;
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
  tokenCount?: number;
}
interface UsageResponse {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSessions: number;
  days: number;
  daily: {
    date: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    sessions: number;
  }[];
  topSessions: UsageEntry[];
  rateLimits: Record<ProviderName, RateLimit[]>;
}
const usageResponseCache = new Map<number, { time: number; data: UsageResponse }>();
const USAGE_CACHE_TTL_MS = 60_000; // 60s

// Parse a single Claude JSONL file. Returns cached result if mtime unchanged.
function parseClaudeSession(
  filePath: string,
  stat: fs.Stats
): UsageEntry & { timestampedTokens: { ts: number; tokens: number }[] } {
  const cached = usageFileCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;

  const sessionId = path.basename(filePath, '.jsonl');
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let model = 'unknown';
  const timestampedTokens: { ts: number; tokens: number }[] = [];

  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'assistant' && entry.message?.usage) {
        const u = entry.message.usage;
        const inTok = u.input_tokens ?? 0;
        const outTok = u.output_tokens ?? 0;
        inputTokens += inTok;
        outputTokens += outTok;
        cacheRead += u.cache_read_input_tokens ?? 0;
        cacheWrite += u.cache_creation_input_tokens ?? 0;
        if (entry.message.model && model === 'unknown') {
          model = entry.message.model;
        }
        if (entry.timestamp) {
          timestampedTokens.push({
            ts: new Date(entry.timestamp).getTime(),
            tokens: inTok + outTok,
          });
        }
      }
    } catch {
      /* skip malformed lines */
    }
  }

  const date = stat.mtime.toISOString().slice(0, 10);
  const data: UsageEntry & { timestampedTokens: { ts: number; tokens: number }[] } = {
    sessionId,
    provider: 'claude',
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd: estimateCost('claude', inputTokens, outputTokens, cacheRead, cacheWrite),
    date,
    timestampedTokens,
  };
  usageFileCache.set(filePath, { mtimeMs: stat.mtimeMs, data });
  return data;
}

function parseOpenCodeSessionUsage(
  sessionDirPath: string
): (UsageEntry & { lastTimestampMs: number }) | null {
  const messageFiles = fs.readdirSync(sessionDirPath).filter((f) => f.endsWith('.json'));
  if (messageFiles.length === 0) {
    return null;
  }

  let maxMtimeMs = 0;
  for (const file of messageFiles) {
    try {
      const stat = fs.statSync(path.join(sessionDirPath, file));
      if (stat.mtimeMs > maxMtimeMs) {
        maxMtimeMs = stat.mtimeMs;
      }
    } catch {
      // File may disappear between readdir and stat/read.
    }
  }

  const cached = openCodeUsageCache.get(sessionDirPath);
  if (cached && cached.mtimeMs === maxMtimeMs) {
    return cached.data;
  }

  const sessionId = path.basename(sessionDirPath);
  let model = 'unknown';
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costUsd = 0;
  let lastTimestampMs = 0;
  let hasUsage = false;

  for (const file of messageFiles) {
    const filePath = path.join(sessionDirPath, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (parsed?.role !== 'assistant') {
        continue;
      }

      const inTok = typeof parsed?.tokens?.input === 'number' ? parsed.tokens.input : 0;
      const outTok = typeof parsed?.tokens?.output === 'number' ? parsed.tokens.output : 0;
      const cacheRead =
        typeof parsed?.tokens?.cache?.read === 'number' ? parsed.tokens.cache.read : 0;
      const cacheWrite =
        typeof parsed?.tokens?.cache?.write === 'number' ? parsed.tokens.cache.write : 0;
      const messageCost = typeof parsed?.cost === 'number' ? parsed.cost : 0;

      inputTokens += inTok;
      outputTokens += outTok;
      cacheReadTokens += cacheRead;
      cacheWriteTokens += cacheWrite;
      costUsd += messageCost;

      if (inTok + outTok + cacheRead + cacheWrite > 0 || messageCost > 0) {
        hasUsage = true;
      }

      const providerID = typeof parsed?.providerID === 'string' ? parsed.providerID : null;
      const modelID = typeof parsed?.modelID === 'string' ? parsed.modelID : null;
      if (model === 'unknown') {
        if (providerID && modelID) model = `${providerID}/${modelID}`;
        else if (modelID) model = modelID;
        else if (providerID) model = providerID;
      }

      const completedTs = typeof parsed?.time?.completed === 'number' ? parsed.time.completed : 0;
      const createdTs = typeof parsed?.time?.created === 'number' ? parsed.time.created : 0;
      const ts = Math.max(completedTs, createdTs);
      if (ts > lastTimestampMs) {
        lastTimestampMs = ts;
      }
    } catch {
      // Skip malformed/unreadable message file.
    }
  }

  if (!hasUsage) {
    return null;
  }

  if (costUsd === 0) {
    costUsd = estimateCost(
      'opencode',
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens
    );
  }

  const fallbackTs = maxMtimeMs > 0 ? maxMtimeMs : Date.now();
  const date = new Date(lastTimestampMs > 0 ? lastTimestampMs : fallbackTs)
    .toISOString()
    .slice(0, 10);

  const data: UsageEntry & { lastTimestampMs: number } = {
    sessionId,
    provider: 'opencode',
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd,
    date,
    lastTimestampMs: lastTimestampMs > 0 ? lastTimestampMs : fallbackTs,
  };

  openCodeUsageCache.set(sessionDirPath, { mtimeMs: maxMtimeMs, data });
  return data;
}

app.get('/api/usage', async (_req: Request, res: Response) => {
  const days = Math.min(Math.max(Number.parseInt(String(_req.query.days)) || 30, 1), 365);

  // Check response cache
  const cached = usageResponseCache.get(days);
  if (cached && Date.now() - cached.time < USAGE_CACHE_TTL_MS) {
    res.json(cached.data);
    return;
  }

  // Response cache expired (or missing) — clear per-file caches so entries for
  // deleted files don't accumulate unboundedly across requests.
  usageFileCache.clear();
  openCodeUsageCache.clear();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffMs = cutoff.getTime();
  const now = Date.now();
  const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const entries: UsageEntry[] = [];
  let claude5hTokens = 0;
  let claudeWeeklyTokens = 0;

  // --- Claude sessions (single pass: usage entries + rate limit token counts) ---
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    const projectDirs = fs
      .readdirSync(claudeDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(claudeDir, d.name));

    for (const projDir of projectDirs) {
      const jsonlFiles = fs.readdirSync(projDir).filter((f) => f.endsWith('.jsonl'));
      for (const file of jsonlFiles) {
        const filePath = path.join(projDir, file);
        const stat = fs.statSync(filePath);
        // Skip files older than both the query window AND the 7-day rate-limit window
        if (stat.mtimeMs < cutoffMs && stat.mtimeMs < sevenDaysAgo) continue;

        const data = parseClaudeSession(filePath, stat);

        // Usage entry (for the requested days window)
        if (stat.mtimeMs >= cutoffMs && data.inputTokens + data.outputTokens > 0) {
          entries.push(data);
        }

        // Rate limit token counts (5h + 7d windows)
        for (const { ts, tokens } of data.timestampedTokens) {
          if (ts >= sevenDaysAgo) claudeWeeklyTokens += tokens;
          if (ts >= fiveHoursAgo) claude5hTokens += tokens;
        }
      }
    }
  } catch {
    /* ~/.claude/projects may not exist */
  }

  // --- Codex sessions (single pass: usage entries + rate limits from most recent) ---
  const codexDir = path.join(os.homedir(), '.codex', 'sessions');
  const rateLimits = {} as Record<ProviderName, RateLimit[]>;
  for (const provider of Object.keys(providers) as ProviderName[]) {
    rateLimits[provider] = [];
  }
  let newestCodexFile = '';
  let newestCodexMtime = 0;

  try {
    const years = fs.readdirSync(codexDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const year of years) {
      const months = fs
        .readdirSync(path.join(codexDir, year.name), { withFileTypes: true })
        .filter((d) => d.isDirectory());
      for (const month of months) {
        const dayDirs = fs
          .readdirSync(path.join(codexDir, year.name, month.name), { withFileTypes: true })
          .filter((d) => d.isDirectory());
        for (const day of dayDirs) {
          const dateStr = `${year.name}-${month.name}-${day.name}`;
          const dateMs = new Date(dateStr).getTime();
          // Skip entire day dirs that are too old for BOTH usage and rate limits
          if (dateMs < cutoffMs && dateMs < sevenDaysAgo) continue;

          const dayPath = path.join(codexDir, year.name, month.name, day.name);
          const files = fs.readdirSync(dayPath).filter((f) => f.endsWith('.jsonl'));
          for (const file of files) {
            const filePath = path.join(dayPath, file);
            const stat = fs.statSync(filePath);

            // Track most recent for rate limits
            if (stat.mtimeMs > newestCodexMtime) {
              newestCodexMtime = stat.mtimeMs;
              newestCodexFile = filePath;
            }

            // Only parse for usage if within the query window
            if (dateMs < cutoffMs) continue;

            const sessionId = file.replace('.jsonl', '');
            let inputTokens = 0;
            let outputTokens = 0;

            const content = fs.readFileSync(filePath, 'utf-8');
            for (const line of content.split('\n')) {
              if (!line.trim()) continue;
              try {
                const entry = JSON.parse(line);
                if (
                  entry.type === 'event_msg' &&
                  entry.payload?.type === 'token_count' &&
                  entry.payload.info?.total_token_usage
                ) {
                  const u = entry.payload.info.total_token_usage;
                  inputTokens = u.input_tokens ?? 0;
                  outputTokens = u.output_tokens ?? 0;
                }
              } catch {
                /* skip malformed lines */
              }
            }

            if (inputTokens + outputTokens > 0) {
              entries.push({
                sessionId,
                provider: 'codex',
                model: 'codex',
                inputTokens,
                outputTokens,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                costUsd: estimateCost('codex', inputTokens, outputTokens, 0, 0),
                date: dateStr,
              });
            }
          }
        }
      }
    }
  } catch {
    /* ~/.codex/sessions may not exist */
  }

  // --- OpenCode sessions (single pass: assistant message token usage from local storage) ---
  const openCodeMessageDir = path.join(
    os.homedir(),
    '.local',
    'share',
    'opencode',
    'storage',
    'message'
  );
  try {
    const openCodeSessionDirs = fs
      .readdirSync(openCodeMessageDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(openCodeMessageDir, d.name));

    for (const sessionDirPath of openCodeSessionDirs) {
      const usage = parseOpenCodeSessionUsage(sessionDirPath);
      if (!usage) {
        continue;
      }

      if (usage.lastTimestampMs < cutoffMs) {
        continue;
      }

      entries.push({
        sessionId: usage.sessionId,
        provider: usage.provider,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costUsd: usage.costUsd,
        date: usage.date,
      });
    }
  } catch {
    /* ~/.local/share/opencode/storage/message may not exist */
  }

  // Extract rate limits from the most recent Codex session file
  if (newestCodexFile) {
    try {
      const content = fs.readFileSync(newestCodexFile, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === 'event_msg' && entry.payload?.rate_limits) {
            const r = entry.payload.rate_limits;
            if (r.primary) {
              rateLimits.codex.push({
                label: `${r.primary.window_minutes / 60}h limit`,
                usedPercent: r.primary.used_percent,
                windowMinutes: r.primary.window_minutes,
                resetsAt: r.primary.resets_at ?? null,
              });
            }
            if (r.secondary) {
              rateLimits.codex.push({
                label: 'Weekly limit',
                usedPercent: r.secondary.used_percent,
                windowMinutes: r.secondary.window_minutes,
                resetsAt: r.secondary.resets_at ?? null,
              });
            }
            break;
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* file may have been deleted */
    }
  }

  // Claude rate limits from timestamped tokens (already computed in single pass above)
  if (claude5hTokens > 0 || claudeWeeklyTokens > 0) {
    rateLimits.claude.push({
      label: '5h window',
      usedPercent: 0,
      windowMinutes: 300,
      resetsAt: null,
      tokenCount: claude5hTokens,
    });
    rateLimits.claude.push({
      label: 'Weekly',
      usedPercent: 0,
      windowMinutes: 10080,
      resetsAt: null,
      tokenCount: claudeWeeklyTokens,
    });
  }

  // Aggregate by day
  const byDay = new Map<
    string,
    { inputTokens: number; outputTokens: number; costUsd: number; sessions: number }
  >();
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for (const e of entries) {
    totalCost += e.costUsd;
    totalInput += e.inputTokens;
    totalOutput += e.outputTokens;

    const existing = byDay.get(e.date);
    if (existing) {
      existing.inputTokens += e.inputTokens;
      existing.outputTokens += e.outputTokens;
      existing.costUsd += e.costUsd;
      existing.sessions += 1;
    } else {
      byDay.set(e.date, {
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        costUsd: e.costUsd,
        sessions: 1,
      });
    }
  }

  const daily = Array.from(byDay.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, data]) => ({ date, ...data }));

  const sortedEntries = [...entries].sort((a, b) => b.costUsd - a.costUsd);
  const topSessions = sortedEntries.slice(0, 20);

  // Keep provider tabs useful even when one provider's sessions are lower-cost.
  const orderedProviders = Object.keys(providers) as ProviderName[];
  for (const provider of orderedProviders) {
    if (topSessions.some((entry) => entry.provider === provider)) {
      continue;
    }
    const providerTopSession = sortedEntries.find((entry) => entry.provider === provider);
    if (providerTopSession) {
      topSessions.push(providerTopSession);
    }
  }
  topSessions.sort((a, b) => b.costUsd - a.costUsd);

  const response: UsageResponse = {
    totalCostUsd: totalCost,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalSessions: entries.length,
    days,
    daily,
    topSessions,
    rateLimits,
  };

  usageResponseCache.set(days, { time: Date.now(), data: response });
  res.json(response);
});

// Serve static files from client build
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// =============================================================================
// Server Lifecycle
// =============================================================================

// Signal Handlers — split behavior for intentional shutdown vs hot-reload.
//
// SIGINT (Ctrl-C): Intentional shutdown. Kill all child processes immediately.
// SIGTERM (tsx watch, kill, pm2, Docker stop): Defer restart while active turns
//   are running so long tasks don't get cut off mid-flight.
//
// If the drain timeout is reached, active turns are interrupted with a system
// message and shutdown proceeds after a short grace period.

function getActiveConversationRuns(): Conversation[] {
  const active: Conversation[] = [];
  for (const conversation of conversations.values()) {
    if (conversation.hasActiveProcess()) {
      active.push(conversation);
    }
  }
  return active;
}

function interruptActiveConversationsForShutdown(reason: string): void {
  for (const conversation of getActiveConversationRuns()) {
    const content = `Server is restarting (${reason}); interrupted current turn.`;
    conversation.messages.push({ role: 'system', content, timestamp: new Date() });
    broadcastToAll({
      type: 'message',
      conversationId: conversation.id,
      role: 'system',
      content,
    });
    conversation.stop();
  }
}

let sigtermDrainInterval: NodeJS.Timeout | null = null;
let sigtermForceTimeout: NodeJS.Timeout | null = null;
let sigtermDraining = false;

function clearSigtermDrainTimers(): void {
  if (sigtermDrainInterval) {
    clearInterval(sigtermDrainInterval);
    sigtermDrainInterval = null;
  }
  if (sigtermForceTimeout) {
    clearTimeout(sigtermForceTimeout);
    sigtermForceTimeout = null;
  }
}

process.on('SIGINT', () => {
  console.log('SIGINT — killing child processes and shutting down...');
  for (const conv of conversations.values()) {
    if (conv.process) {
      conv.process.kill('SIGKILL');
    }
  }
  process.exit();
});

process.on('SIGTERM', () => {
  const activeRuns = getActiveConversationRuns();
  if (activeRuns.length === 0) {
    console.log('SIGTERM — no active turns, exiting for restart');
    process.exit();
    return;
  }

  if (sigtermDraining) {
    console.warn(
      `SIGTERM received again with ${activeRuns.length} active turn(s); forcing shutdown now`
    );
    clearSigtermDrainTimers();
    interruptActiveConversationsForShutdown('forced restart');
    setTimeout(() => process.exit(), HOT_RELOAD_FORCE_EXIT_GRACE_MS);
    return;
  }

  sigtermDraining = true;
  console.warn(
    `SIGTERM deferred: waiting for ${activeRuns.length} active turn(s) to finish (timeout ${Math.round(HOT_RELOAD_DRAIN_MS / 1000)}s)`
  );

  sigtermDrainInterval = setInterval(() => {
    const remaining = getActiveConversationRuns().length;
    if (remaining === 0) {
      clearSigtermDrainTimers();
      console.log('SIGTERM — active turns drained, exiting for restart');
      process.exit();
    }
  }, 500);

  sigtermForceTimeout = setTimeout(() => {
    const remaining = getActiveConversationRuns().length;
    if (remaining > 0) {
      console.warn(
        `SIGTERM drain timeout reached with ${remaining} active turn(s); interrupting and exiting`
      );
      interruptActiveConversationsForShutdown('hot-reload timeout');
    }
    clearSigtermDrainTimers();
    setTimeout(() => process.exit(), HOT_RELOAD_FORCE_EXIT_GRACE_MS);
  }, HOT_RELOAD_DRAIN_MS);
});

const DEV_CLIENT_PORT = 7489;
const DEV_API_PORT = 7499;
const LOCAL_DOMAIN = 'unleashd.localhost';
const LOCAL_HTTP_PORT = 80;
const PORT = process.env.PORT || (process.env.NODE_ENV === 'development' ? DEV_API_PORT : DEV_CLIENT_PORT);
const SETUP_SCRIPT = path.join(__dirname, '../../tools/setup-domain.sh');

function canReachBareLocalDomain(callback: (useBareDomain: boolean) => void): void {
  const socket = net.connect({ host: '127.0.0.1', port: LOCAL_HTTP_PORT });
  const finish = (result: boolean) => {
    socket.removeAllListeners();
    socket.destroy();
    callback(result);
  };

  socket.setTimeout(250);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
}

function ensureBareLocalDomain(callback: (useBareDomain: boolean) => void): void {
  canReachBareLocalDomain((useBareDomain) => {
    if (useBareDomain) {
      console.log(`[unleashd] Local port-80 routing active for http://${LOCAL_DOMAIN}`);
      callback(true);
      return;
    }

    if (process.platform !== 'darwin' || !process.stdin.isTTY || !process.stdout.isTTY) {
      console.log(
        '[unleashd] Skipping automatic local domain setup: requires macOS + interactive TTY'
      );
      callback(false);
      return;
    }

    try {
      console.log('[unleashd] Attempting automatic local domain setup...');
      execSync(`sudo bash ${JSON.stringify(SETUP_SCRIPT)}`, { stdio: 'inherit' });
    } catch {
      console.log('[unleashd] Automatic local domain setup failed or was cancelled');
      callback(false);
      return;
    }

    console.log('[unleashd] Re-checking local domain after setup');
    canReachBareLocalDomain(callback);
  });
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          resolve(false);
        }
      })
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
}

function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function killProcessOnPort(port: number): boolean {
  try {
    // Get the PID
    const pidCmd = `lsof -i :${port} | grep LISTEN | awk '{print $2}'`;
    const pid = execSync(pidCmd, { stdio: 'pipe' }).toString().trim();

    if (!pid) {
      process.stdout.write('port already free\n');
      return true;
    }

    execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
    process.stdout.write(`killed PID ${pid}\n`);
    return true;
  } catch (err) {
    console.error(`✗ Failed to kill process on port ${port}:`, (err as Error).message);
    return false;
  }
}

/**
 * Hydrate a server-side Conversation instance from shared ConversationData.
 * Used by both initial load (progressive batches) and file polling (new sessions).
 */
function hydrateConversation(convData: ConversationData): Conversation {
  const sessionId = convData.id;
  const conversation = new Conversation({
    id: sessionId,
    workingDirectory: convData.workingDirectory,
    provider: convData.provider,
    existingSessionId: sessionId,
    isWorker: convData.isWorker,
    swarmId: convData.swarmId ?? null,
    workerId: convData.workerId ?? null,
    workerRole: convData.workerRole ?? null,
    parentConversationId: resolveParentConversationId(convData.parentConversationId ?? null),
    modelName: convData.modelName ?? null,
  });
  conversation.messages = convData.messages;
  conversation.createdAt = convData.createdAt;
  conversation.subAgents = convData.subAgents;
  return conversation;
}

/**
 * Load existing conversations from persisted Claude/Codex/OpenCode files.
 * Called on server startup to hydrate the in-memory Map.
 *
 * Progressive loading: files are sorted by mtime descending (most recent first)
 * and broadcast to connected clients in batches as they're parsed. This lets the
 * UI stream in conversations instead of blocking until all 1500+ files are loaded.
 */
async function loadExistingConversations(): Promise<void> {
  console.log('Loading conversations from persisted session files...');

  try {
    const { mtimes } = await loadAllConversations({
      limit: STARTUP_INITIAL_LOAD_LIMIT,
      concurrency: STARTUP_PARSE_CONCURRENCY,
      batchSize: STARTUP_LOAD_BATCH_SIZE,
      onProgress: (batch, progress) => {
        // Hydrate each batch into server-side Conversation instances
        const broadcastBatch: ConversationData[] = [];
        for (const convData of batch) {
          const conversation = hydrateConversation(convData);
          conversations.set(convData.id, conversation);
          broadcastBatch.push(conversation.toJSON());
        }

        // Stream batch to all connected clients (most recent conversations arrive first)
        if (broadcastBatch.length > 0) {
          broadcastToAll({
            type: 'conversations_updated',
            conversations: broadcastBatch,
          });
        }

        if (progress.loaded % STARTUP_PROGRESS_FILE_STEP === 0 || progress.loaded === progress.total) {
          console.log(
            `[startup] Parsed ${progress.loaded}/${progress.total} files (${conversations.size} conversations)...`
          );
        }
      },
    });

    fileMtimes = mtimes;

    // Second pass: re-resolve parentConversationId now that all conversations are loaded.
    // During progressive loading, child conversations (sub-agent threads) may have been
    // hydrated before their parent, leaving parentConversationId as an unresolved raw
    // session ID. Re-resolve and broadcast corrections so clients update sub-agent hierarchy.
    const reresolvedBatch: ConversationData[] = [];
    for (const conv of conversations.values()) {
      if (conv.parentConversationId) {
        const resolved = resolveParentConversationId(conv.parentConversationId);
        if (resolved !== conv.parentConversationId) {
          conv.parentConversationId = resolved;
          reresolvedBatch.push(conv.toJSON());
        }
      }
    }
    if (reresolvedBatch.length > 0) {
      broadcastToAll({ type: 'conversations_updated', conversations: reresolvedBatch });
    }

    console.log(`Loaded ${conversations.size} conversations from persisted session files`);
  } catch (error) {
    console.error('Failed to load conversations from persisted sessions:', error);
    // Continue anyway - server can still work without historical data
  }
}

function findConversationBySessionId(sessionId: string): Conversation | undefined {
  const direct = conversations.get(sessionId);
  if (direct) {
    registerSessionAlias(sessionId, direct.id);
    return direct;
  }

  const mappedConversationId = sessionAliasToConversationId.get(sessionId);
  if (mappedConversationId) {
    const mappedConversation = conversations.get(mappedConversationId);
    if (mappedConversation) {
      registerSessionAlias(sessionId, mappedConversation.id);
      return mappedConversation;
    }
    unregisterSessionAlias(sessionId);
  }

  for (const conversation of conversations.values()) {
    if (conversation.sessionId === sessionId) {
      registerSessionAlias(sessionId, conversation.id);
      return conversation;
    }
  }

  return undefined;
}

function collectActiveConversationAndSessionIds(): Set<string> {
  const activeIds = new Set<string>();
  for (const [id, conversation] of conversations) {
    if (!conversation.hasActiveProcess()) continue;
    activeIds.add(id);
    activeIds.add(conversation.sessionId);
  }
  return activeIds;
}

function getLastUserMessageContent(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const content = messages[i].content.trim();
      return content.length > 0 ? content : null;
    }
  }
  return null;
}

function isOpenCodeSessionLike(sessionId: string): boolean {
  return sessionId.startsWith('ses_');
}

/**
 * Reconcile sessions when the CLI created a real id in local
 * storage but did not emit JSON events (so we could not capture sessionID on stdout)
 * or the file poller ran before the event was processed.
 *
 * Without this, file polling imports the new file as a duplicate conversation.
 */
function findBootstrapMatch(
  sessionId: string,
  convData: ConversationData
): Conversation | undefined {
  const importedLastUser = getLastUserMessageContent(convData.messages);
  if (!importedLastUser) return undefined;

  const importedCreatedMs = new Date(convData.createdAt).getTime();

  for (const conv of conversations.values()) {
    if (conv.provider !== convData.provider) continue;
    if (conv.id === sessionId) continue;
    
    // If the conversation already has a provider session ID assigned, skip it.
    // We know it's unassigned if sessionId === id (the UI-generated UUID).
    // Exception: Gemini's CLI emits a session.started event with a random UUID
    // that differs from the actual UUID written to the JSON file. We must allow
    // findBootstrapMatch to re-bind Gemini sessions to their true on-disk ID.
    if (conv.sessionId !== conv.id && conv.provider !== 'gemini') continue;

    if (conv.provider === 'opencode' && isOpenCodeSessionLike(conv.sessionId)) continue;
    if (conv.workingDirectory !== convData.workingDirectory) continue;

    const existingLastUser = getLastUserMessageContent(conv.messages);
    if (!existingLastUser || existingLastUser !== importedLastUser) continue;

    const existingCreatedMs = conv.createdAt.getTime();
    if (
      Number.isFinite(importedCreatedMs) &&
      Math.abs(existingCreatedMs - importedCreatedMs) > 5 * 60_000
    ) {
      continue;
    }

    return conv;
  }

  return undefined;
}

function resolveParentConversationId(parentSessionId: string | null | undefined): string | null {
  if (!parentSessionId) {
    return null;
  }
  const parentConversation = findConversationBySessionId(parentSessionId);
  return parentConversation?.id ?? parentSessionId;
}

/**
 * Prevent unbounded growth of deletedSessionIds and knownSessionIds.
 * deletedSessionIds: hard cap — worst case a very old deleted JSONL gets re-imported once.
 * knownSessionIds: evict entries that have no active conversation or alias mapping.
 */
function pruneSessionSets(): void {
  if (deletedSessionIds.size > 10000) {
    deletedSessionIds.clear();
  }
  for (const sid of knownSessionIds) {
    if (!conversations.has(sid) && !sessionAliasToConversationId.has(sid)) {
      knownSessionIds.delete(sid);
    }
  }
}

/**
 * Poll persisted session files every 5s for external changes (e.g., user ran
 * `claude`, `codex`, or `opencode` in terminal).
 * Only re-parses files with newer mtimes. Skips running conversations (launched by us).
 * Detects externally-running sessions: if a file's mtime changed between polls and
 * we didn't cause it, an external provider process is writing to it.
 * Broadcasts `conversations_updated` and `status` changes to all connected clients.
 */
function startFilePolling(): void {
  const POLL_INTERVAL_MS = 5000;

  setInterval(async () => {
    try {
      // Snapshot active IDs for pollForChanges skip-list.
      const activeIdsAtPollStart = collectActiveConversationAndSessionIds();
      const { updated, mtimes } = await pollForChanges(fileMtimes, activeIdsAtPollStart);
      fileMtimes = mtimes;
      // Re-snapshot after poll returns to catch session ID changes during an active run,
      // then union with the pre-poll snapshot so both old/new IDs are treated as active.
      const activeIds = collectActiveConversationAndSessionIds();
      for (const activeId of activeIdsAtPollStart) {
        activeIds.add(activeId);
      }

      // --- External process detection ---
      // Sessions in `updated` had their files modified this cycle.
      // If we didn't launch them (not in activeIds), an external process wrote to them.
      const now = Date.now();
      pruneLocalCompletionSuppressions(now);

      for (const sessionId of updated.keys()) {
        if (activeIds.has(sessionId)) continue;
        // This session just completed locally; ignore file-tail writes.
        if (isLocalCompletionSuppressed(sessionId, now)) continue;

        const existingConversation = findConversationBySessionId(sessionId);
        const conversationId = existingConversation?.id ?? sessionId;

        // File changed and we didn't cause it — refresh the "last seen" timestamp
        if (!externallyRunning.has(sessionId)) {
          // Newly detected external activity
          console.log(`[Poll] External activity detected: ${sessionId.substring(0, 8)}`);
          broadcastToAll({
            type: 'status',
            conversationId,
            isRunning: true,
            isStreaming: false, // External activity — we don't know if streaming, but safe default
          });
        }
        externallyRunning.set(sessionId, now);
      }

      // Check grace period: only mark idle after EXTERNAL_GRACE_MS with no file changes.
      // This prevents flicker during gaps in Claude's output (thinking, API calls, tool use).
      for (const [sessionId, lastSeen] of externallyRunning) {
        if (isLocalCompletionSuppressed(sessionId, now)) {
          externallyRunning.delete(sessionId);
          continue;
        }
        if (now - lastSeen >= EXTERNAL_GRACE_MS) {
          externallyRunning.delete(sessionId);
          const existingConversation = findConversationBySessionId(sessionId);
          const conversationId = existingConversation?.id ?? sessionId;
          console.log(`[Poll] External activity stopped: ${sessionId.substring(0, 8)}`);
          broadcastToAll({
            type: 'status',
            conversationId,
            isRunning: false,
            isStreaming: false,
          });
        }
      }

      if (updated.size === 0) return;

      console.log(`[Poll] ${updated.size} conversation(s) changed`);

      const changedForBroadcast: ConversationData[] = [];

      for (const [sessionId, convData] of updated) {
        // Never let disk updates clobber active in-memory streaming turns.
        if (activeIds.has(sessionId)) {
          continue;
        }

        let existing = findConversationBySessionId(sessionId);

        if (!existing) {
          const reconciled = findBootstrapMatch(sessionId, convData);
          if (reconciled) {
            const oldSessionId = reconciled.sessionId;
            reconciled.sessionId = sessionId;
            if (oldSessionId !== sessionId) {
              unregisterSessionAlias(oldSessionId, { keepKnown: true });
            }
            registerSessionAlias(sessionId, reconciled.id);
            existing = reconciled;
            console.log(
              `[Poll] Reconciled session ${sessionId.substring(0, 8)} with conversation ${reconciled.id.substring(0, 8)} (old session ${oldSessionId.substring(0, 8)})`
            );
          }
        }

        if (existing && !existing.hasActiveProcess()) {
          registerSessionAlias(sessionId, existing.id);
          // Update existing conversation in-place (preserve process handles).
          // Preserve server-injected system messages (error reports, exit info) that
          // exist only in memory — disk files don't contain these. Without this,
          // the poller would nuke error messages like "usage limit" within one poll cycle.
          const trailingSystemMessages = existing.messages.filter(
            (m, i) => m.role === 'system' && i >= convData.messages.length
          );
          existing.messages =
            trailingSystemMessages.length > 0
              ? [...convData.messages, ...trailingSystemMessages]
              : convData.messages;
          existing.subAgents = convData.subAgents;
          existing.createdAt = convData.createdAt;
          existing.isWorker = convData.isWorker;
          existing.swarmId = convData.swarmId ?? null;
          existing.workerId = convData.workerId ?? null;
          existing.workerRole = convData.workerRole ?? null;
          existing.parentConversationId = resolveParentConversationId(
            convData.parentConversationId ?? null
          );
          existing.modelName = convData.modelName ?? null;
          const json = existing.toJSON();
          // Mark as running if externally active
          if (externallyRunning.has(sessionId)) {
            json.isRunning = true;
          }
          changedForBroadcast.push(json);
        } else if (!existing && !knownSessionIds.has(sessionId) && !deletedSessionIds.has(sessionId)) {
          // New conversation (not an orphaned JSONL from resetProcess or a deleted one) — create fresh instance
          const conversation = hydrateConversation(convData);
          conversations.set(sessionId, conversation);
          const json = conversation.toJSON();
          if (externallyRunning.has(sessionId)) {
            json.isRunning = true;
          }
          changedForBroadcast.push(json);
        }
      }

      if (changedForBroadcast.length > 0) {
        broadcastToAll({
          type: 'conversations_updated',
          conversations: changedForBroadcast,
        });
      }

      // Evict stale entries from session tracking sets to prevent unbounded growth
      pruneSessionSets();
    } catch (error) {
      console.error('[Poll] Error during file polling:', error);
    }
  }, POLL_INTERVAL_MS);
}

async function startServer(): Promise<void> {
  startupAuditResults = auditLocalAgents();

  // Initialize caches before opening the port
  await initSettingsCache();
  await initUIStateCache();
  await initPaletteCache();

  const portNumber = typeof PORT === 'string' ? Number.parseInt(PORT, 10) : PORT;
  let isPortAvailable = await checkPort(portNumber);

  if (!isPortAvailable) {
    console.log(`\nPort ${PORT} is already in use.`);
    const answer = await askQuestion(`Kill the process using port ${PORT}? [y/N] `);

    if (answer === 'y' || answer === 'yes') {
      process.stdout.write('Killing... ');
      const killed = killProcessOnPort(portNumber);
      if (killed) {
        // Wait a moment for port to be released
        await new Promise((resolve) => setTimeout(resolve, 500));
        isPortAvailable = await checkPort(portNumber);

        if (!isPortAvailable) {
          console.error(`\n✗ Port ${PORT} still in use. Try manually or use a different port.`);
          process.exit(1);
        }
        console.log(`✓ Done\n`);
      } else {
        process.exit(1);
      }
    } else {
      console.log('\nAlternatives:');
      console.log(
        `  1. Kill manually: lsof -i :${PORT} | grep LISTEN | awk '{print $2}' | xargs kill -9`
      );
      console.log(`  2. Use different port: PORT=3001 pnpm dev:server\n`);
      process.exit(1);
    }
  }

  // Start listening FIRST so the Vite proxy can connect immediately.
  server.listen(portNumber, () => {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const domainUrl = `http://${LOCAL_DOMAIN}`;
    const fallbackUrl = isDevelopment
      ? `http://localhost:${DEV_CLIENT_PORT}`
      : `http://localhost:${portNumber}`;

    // Use the bare localhost alias when port-80 routing is active, or set it up on demand.
    ensureBareLocalDomain((useDomain) => {
      const startUrl = useDomain ? domainUrl : fallbackUrl;
      if (isDevelopment) {
        console.log(`Server running on http://localhost:${portNumber} (frontend on ${startUrl})`);
        return;
      }
      console.log(`Server running on ${startUrl} (backend on port ${portNumber})`);
      const startCmd =
        process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      require('child_process').exec(`${startCmd} ${startUrl}`);
    });
  });

  // Unblock WebSocket handlers immediately — clients get an init with whatever
  // conversations have been loaded so far (initially empty). As loadExistingConversations
  // parses files in mtime-descending order, it broadcasts batches via conversations_updated
  // so the UI streams in progressively (most recent first).
  resolveInitialLoad();
  console.log('WebSocket handlers unblocked, loading conversations progressively...');

  // Load existing conversations — broadcasts batches to connected clients as they parse.
  await loadExistingConversations();
  console.log('Initial load complete');

  // Start file polling AFTER initial load so mtimes are populated.
  // If poller starts before loadExistingConversations completes, the first poll
  // would see empty mtimes and re-broadcast all conversations.
  startFilePolling();
  console.log('File polling started (5s interval)');
}

startServer();
