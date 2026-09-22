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
 *   sessionToConversation(ParsedSession) → Conversation | null  (null = hidden)
 */

import type {
  BuddyContext,
  Conversation,
  ConversationKind,
  ConversationSessionBinding,
  DiscoveredConversation,
  Message,
  Provider,
  SubAgent,
} from '@unleashd/shared';
import {
  ModelIdSchema,
  buddyContextFromKind,
  conversationKindFromLegacy,
  fromCodexModelId,
  isModelIdValidForProvider,
  matchConversationKind,
  normalizeModelId,
} from '@unleashd/shared';
import {
  extractBuddyBuilderPurpose,
  extractBuddyContext,
  extractSwarmDebugPrefix,
  extractWorkerMetadata,
  stripMergePrefix,
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
  // Canonical kind — new sessions set this directly. Legacy sessions may only have
  // buddyContext/purpose + hidden HTML prefix; we migrate via conversationKindFromLegacy.
  kind?: ConversationKind | null;
  buddyContext?: BuddyContext | null;
  swarmDebugPrefix?: string | null;
  resumedFromConversationId?: string | null;
  purpose?: string | null;
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
  /** Candidate lookup only; callers must verify the parsed provider and full native id. */
  matchesSessionFile?(filePath: string, sessionId: string): boolean;
}

// =============================================================================
// Shared result types (used by loader.ts)
// =============================================================================

export interface LoadResult {
  conversations: Map<string, DiscoveredConversation>;
  mtimes: Map<string, number>; // filepath → mtime ms
}

/** Related native sessions are display history only, never provider resume input. */
export type SessionHistorySource = DiscoveredConversation & {
  boundSessionSources?: DiscoveredConversation[];
};

export interface SessionHistoryOptions {
  resolveSessionBindings?(
    source: DiscoveredConversation
  ): Promise<readonly ConversationSessionBinding[]>;
}

export interface PollResult {
  updated: Map<string, DiscoveredConversation>; // changed or new conversations
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

/**
 * Convert a ParsedSession to a Conversation.
 * Returns null for [_HIDE_TEST_] conversations (dropped at ingestion).
 * Detects oompa workers by checking for "[oompa...]" tag in the first user message.
 *
 * This is the single canonical conversion function replacing the four near-identical
 * jsonlSessionToConversation / codexSessionToConversation / openCodeSessionToConversation /
 * geminiSessionToConversation functions that previously existed in jsonl.ts.
 */
export function sessionToConversation(session: ParsedSession): DiscoveredConversation | null {
  // Durable kind owns identity. Briefing removal is separate: even sessions
  // with durable identity can contain the first-turn CLI envelope on disk.
  const durableKind = session.kind ?? null;
  const durableBuddy = session.buddyContext ?? null;
  const durableSwarmPrefix = session.swarmDebugPrefix ?? null;
  const durableResumed = session.resumedFromConversationId ?? null;
  const durablePurpose = session.purpose ?? null;

  const extractedBuddy = extractBuddyContext(session.messages);
  // Display cleanup must run even when durable metadata already owns identity.
  // Skipping extraction in that case restores hidden instructions as user text.
  const extractedBuilder = extractBuddyBuilderPurpose(session.messages);
  const extractedSwarmPrefix = extractSwarmDebugPrefix(session.messages);
  stripMergePrefix(session.messages);
  let buddyContext: BuddyContext | null = durableBuddy;
  let isBuddyBuilder = false;
  let swarmDebugPrefix: string | null = durableSwarmPrefix;

  if (durableKind) {
    // Kind already present — derive legacy fields without trusting marker identity.
    swarmDebugPrefix = durableSwarmPrefix ?? extractedSwarmPrefix;
    // Thin dispatcher δ over the canonical kind — one clean handler per variant (D1/D2).
    // Handlers must not re-derive the buddy context field-by-field: `buddyContextFromKind`
    // is the single canonical projection and owns the null/omit absence invariant.
    const derived = matchConversationKind<{
      buddyContext: BuddyContext | null;
      isBuddyBuilder: boolean;
    }>(durableKind, {
      buddy: (k) => ({ buddyContext: buddyContextFromKind(k), isBuddyBuilder: false }),
      buddy_builder: () => ({ buddyContext: null, isBuddyBuilder: true }),
      general: () => ({ buddyContext: null, isBuddyBuilder: false }),
    });
    buddyContext = derived.buddyContext;
    isBuddyBuilder = derived.isBuddyBuilder;
  } else {
    buddyContext = durableBuddy ?? extractedBuddy;
    isBuddyBuilder = buddyContext
      ? false
      : durablePurpose === 'buddy_builder'
        ? true
        : extractedBuilder;
    swarmDebugPrefix =
      buddyContext || isBuddyBuilder ? null : (durableSwarmPrefix ?? extractedSwarmPrefix);
  }
  // Resumed lineage durable wins; otherwise keep any prefix-extracted lineage
  // (none currently from extractors, but preserve future extraction).
  const resumedFromConversationId = durableResumed ?? null;
  const worker =
    buddyContext || isBuddyBuilder
      ? {
          isWorker: false,
          isHidden: false,
          swarmId: null,
          workerId: null,
          workerRole: null,
        }
      : extractWorkerMetadata(session.messages);
  if (worker.isHidden) return null;

  // Recover the canonical ModelId when session.model parses against the schema.
  // For codex, decompose any legacy composite (e.g. "gpt-5.4-xhigh") into its
  // base + reasoningEffort so they live as separate fields (matches claude shape).
  const { model: recoveredModel, reasoningEffort } = recoverModelAndEffort(session);

  // Holistic kind — canonical when session.kind present, else migration from legacy.
  const durableKindPurpose = durablePurpose as 'buddy_builder' | null;
  const kind =
    durableKind ??
    conversationKindFromLegacy({
      buddyContext,
      purpose: isBuddyBuilder ? 'buddy_builder' : durableKindPurpose,
      kind: null,
    });

  return {
    sessionId: session.sessionId,
    messages: session.messages,
    isRunning: false,
    isStreaming: false, // Loaded from disk — process is dead
    confirmed: true,
    createdAt: session.createdAt,
    workingDirectory: session.workingDirectory,
    provider: session.provider,
    model: recoveredModel,
    reasoningEffort,
    subAgents: session.subAgents ?? [],
    queue: [],
    isWorker: worker.isWorker,
    swarmId: worker.swarmId ?? null,
    workerId: worker.workerId ?? null,
    workerRole: worker.workerRole ?? null,
    parentConversationId: session.parentSessionId ?? null,
    title: session.title ?? undefined,
    modelName: session.model !== 'unknown' ? session.model : null,
    swarmDebugPrefix: swarmDebugPrefix ?? null,
    resumedFromConversationId,
    kind,
    buddyContext,
    purpose: isBuddyBuilder
      ? 'buddy_builder'
      : ((durablePurpose as 'buddy_builder' | 'general' | undefined) ?? undefined),
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
  model: Conversation['model'];
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
