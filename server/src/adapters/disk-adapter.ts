/**
 * DiskAdapter — shared interface for reading persisted CLI agent sessions from disk.
 *
 * Design: One DiskAdapter per CLI provider (Claude, Codex, OpenCode, Gemini, …).
 * Adding a new provider = one new file implementing DiskAdapter. Zero changes to
 * the core load/poll loop in loader.ts.
 *
 * Flow:
 *   DiskAdapter.discoverFiles() → string[]    (paths to scan)
 *   DiskAdapter.parseFile(path) → ParsedSession | null  (null = skip)
 *   sessionToConversation(ParsedSession) → DiscoveredSession | null  (null = hidden)
 */

import type {
  ConversationKind,
  ConversationSessionBinding,
  Message,
  ModelId,
  Provider,
  SubAgent,
} from '@unleashd/shared';
import {
  ModelIdSchema,
  fromCodexModelId,
  isModelIdValidForProvider,
  normalizeModelId,
} from '@unleashd/shared';
import {
  type WorkerMetadata,
  extractSwarmDebugPrefix,
  extractWorkerMetadata,
  stripBuddyBuilderEnvelope,
  stripBuddyContextEnvelopes,
} from './jsonl';

// =============================================================================
// Normalized session output — all adapters produce this before conversion
// =============================================================================

/**
 * Normalized representation of a parsed CLI session — output of every DiskAdapter.parseFile().
 * All provider-specific types (JsonlSession, CodexSession, etc.) convert to this before
 * reaching the shared sessionToConversation() function.
 */
export interface ParsedSession {
  sessionId: string;
  filePath: string; // path used for mtime tracking
  workingDirectory: string;
  provider: Provider; // set by the adapter (claude may use inferProviderFromModel)
  model: string; // 'unknown' if unavailable
  createdAt: Date;
  modifiedAt: Date;
  messages: Message[];
  subAgents?: SubAgent[]; // Claude only — extracted from JSONL entries
  parentSessionId?: string | null; // Codex only — for nested thread display
  /** Provider-generated label (Claude ai-title/custom-title). Null when unobserved. */
  title?: string | null;
  swarmDebugPrefix?: string | null;
  resumedFromConversationId?: string | null;
}

/**
 * A provider transcript found on disk, before it is bound to a conversation
 * record. Server-internal: nothing here goes on the wire (the row does).
 */
export interface DiscoveredSession {
  /** Opaque provider-owned identity. Never use as the application conversation ID. */
  sessionId: string;
  messages: Message[];
  createdAt: Date;
  workingDirectory: string;
  provider: Provider;
  /** Canonical model id recovered from the transcript: config evidence for a new record. */
  model: ModelId | undefined;
  reasoningEffort: string | undefined;
  /** The provider-reported model string, verbatim (null when the file names none). */
  observedModel: string | null;
  subAgents: SubAgent[];
  parentConversationId: string | null;
  resumedFromConversationId: string | null;
  title: string | undefined;
  swarmDebugPrefix: string | null;
  /**
   * Kind for a record this transcript CREATES (chat, or a tagged swarm worker).
   * An existing record's kind always wins; nothing re-derives identity from
   * transcript text after that.
   */
  discoveredKind: ConversationKind;
}

// =============================================================================
// DiskAdapter interface
// =============================================================================

/**
 * One implementation per CLI agent. Adding a new provider = one new file implementing this.
 * discoverFiles() returns paths to session files/dirs (whatever parseFile() expects).
 * parseFile() returns null for empty/invalid sessions (caller skips them).
 */
export interface DiskAdapter {
  provider: Provider;
  discoverFiles(): Promise<string[]>;
  parseFile(filePath: string): Promise<ParsedSession | null>;
  /**
   * Native ids this file may hold, as found in its path. Candidate lookup only;
   * callers must verify the parsed provider and full native id. Keys (rather than
   * a `matches(file, id)` predicate) let a caller index every discovered file
   * once: the predicate form scanned all ~7,700 sources per session binding and
   * cost ~8s of every startup (2026-09-25).
   */
  sessionFileKeys(filePath: string): readonly string[];
  /** How the poller re-reads one of this adapter's sources after it changes. */
  growth: SourceGrowth;
}

/**
 * How a changed source is re-read.
 *
 * `rewritten`: every change is parsed from scratch (parseFile). Formats whose
 * derived state needs the whole file (Codex's turn lifecycle and final sort),
 * whole-document JSON (Gemini), or directories (OpenCode) stay here.
 *
 * `appended`: the provider only ever appends complete records, so a read can
 * be resumed from its byte offset. The poller's TranscriptTails decides per
 * change whether the file really only grew; see transcript-tails.ts.
 */
export type SourceGrowth =
  | { kind: 'rewritten' }
  | { kind: 'appended'; read(filePath: string): Promise<AppendableRead> };

/** A parsed source plus the point to resume from when more bytes are appended. */
export interface AppendableRead {
  session: ParsedSession | null;
  /** Byte offset just past the last record folded in. */
  offset: number;
  /** Fold the bytes appended since `offset`. Consumes this read. */
  extend(): Promise<AppendableRead>;
}

/** Keys a native id is looked up under; see DiskAdapter.sessionFileKeys. */
export function sessionLookupKeys(sessionId: string): readonly string[] {
  // Gemini names files session-{timestamp}-{first eight id characters}.
  return [sessionId, sessionId.slice(0, 8)];
}

// =============================================================================
// Shared result types (used by loader.ts)
// =============================================================================

export interface LoadResult {
  conversations: Map<string, DiscoveredSession>;
  mtimes: Map<string, number>; // filepath → mtime ms
}

/** Related native sessions are display history only, never provider resume input. */
export type SessionHistorySource = DiscoveredSession & {
  boundSessionSources?: DiscoveredSession[];
};

export interface SessionHistoryOptions {
  resolveSessionBindings?(source: DiscoveredSession): Promise<readonly ConversationSessionBinding[]>;
}

export interface PollResult {
  updated: Map<string, DiscoveredSession>; // changed or new conversations
  mtimes: Map<string, number>; // full updated mtime index
  // Changed sources skipped because their session is active. Callers must keep
  // the previous baseline for these paths so the final persisted state is
  // guaranteed to be reconciled after the process stops.
  deferredDirtyPaths: Set<string>;
}

export type LoadProgressCallback = (
  batch: SessionHistorySource[],
  progress: { loaded: number; total: number }
) => void | Promise<void>;

// =============================================================================
// Shared session → Conversation conversion
// =============================================================================

const NOT_A_WORKER: WorkerMetadata = {
  isHidden: false,
  isWorker: false,
  swarmId: null,
  workerId: null,
  workerRole: null,
};

/**
 * Convert a ParsedSession to a DiscoveredSession.
 * Returns null for [_HIDE_TEST_] conversations (dropped at ingestion).
 * Hidden first-turn envelopes (Buddy, Builder, swarm prefix) are stripped for
 * display; they are never read as identity. The one classification made here
 * is the oompa tag, and only for a record this transcript creates.
 */
export function sessionToConversation(session: ParsedSession): DiscoveredSession | null {
  // Display cleanup runs for every transcript: skipping it restores hidden
  // instructions as user text.
  const buddyEnvelope = stripBuddyContextEnvelopes(session.messages);
  const builderEnvelope = stripBuddyBuilderEnvelope(session.messages);
  // A Buddy or Builder turn is never a swarm worker, whatever its prompt
  // starts with, and its prefix is not a swarm debug prefix.
  const appTurn = buddyEnvelope || builderEnvelope;
  const extractedSwarmPrefix = appTurn ? null : extractSwarmDebugPrefix(session.messages);
  const worker = appTurn ? NOT_A_WORKER : extractWorkerMetadata(session.messages);
  if (worker.isHidden) return null;

  // Recover the canonical ModelId when session.model parses against the schema.
  // For codex, decompose any legacy composite (e.g. "gpt-5.4-xhigh") into its
  // base + reasoningEffort so they live as separate fields (matches claude shape).
  const { model: recoveredModel, reasoningEffort } = recoverModelAndEffort(session);

  return {
    sessionId: session.sessionId,
    messages: session.messages,
    createdAt: session.createdAt,
    workingDirectory: session.workingDirectory,
    provider: session.provider,
    model: recoveredModel,
    reasoningEffort,
    observedModel: session.model !== 'unknown' ? session.model : null,
    subAgents: session.subAgents ?? [],
    parentConversationId: session.parentSessionId ?? null,
    resumedFromConversationId: session.resumedFromConversationId ?? null,
    title: session.title ?? undefined,
    swarmDebugPrefix: appTurn ? null : (session.swarmDebugPrefix ?? extractedSwarmPrefix),
    discoveredKind: worker.isWorker
      ? { t: 'worker', swarmId: worker.swarmId, workerId: worker.workerId, role: worker.workerRole }
      : { t: 'chat' },
  };
}

/**
 * Recover canonical ModelId + reasoningEffort from a ParsedSession.model string.
 *
 * Codex: legacy composite strings ("gpt-5.4-xhigh") are split into base model +
 * reasoningEffort via fromCodexModelId. Native codex session files already store
 * base IDs, so this is a no-op for non-legacy data.
 *
 * Claude/opencode/gemini/cursor: session files don't persist --effort, so
 * reasoningEffort is always undefined here. Hydration preserves that absence;
 * it must not invent a new flag for an existing provider session.
 */
function recoverModelAndEffort(session: ParsedSession): {
  model: ModelId | undefined;
  reasoningEffort: string | undefined;
} {
  if (session.model === 'unknown') {
    return { model: undefined, reasoningEffort: undefined };
  }

  if (session.provider === 'codex') {
    const { baseModel, effort } = fromCodexModelId(session.model);
    const canonical = normalizeModelId(session.provider, baseModel) ?? baseModel;
    const parsedBase = ModelIdSchema.safeParse(canonical);
    return {
      model:
        parsedBase.success && isModelIdValidForProvider(session.provider, parsedBase.data)
          ? parsedBase.data
          : undefined,
      reasoningEffort: effort ?? undefined,
    };
  }

  const canonical = normalizeModelId(session.provider, session.model) ?? session.model;
  const parsed = ModelIdSchema.safeParse(canonical);
  return {
    model:
      parsed.success && isModelIdValidForProvider(session.provider, parsed.data)
        ? parsed.data
        : undefined,
    reasoningEffort: undefined,
  };
}
