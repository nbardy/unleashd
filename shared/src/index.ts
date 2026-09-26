/**
 * Shared Zod schemas and TypeScript types for Claude Multi-Chat
 * Used by both client and server for type-safe WebSocket communication
 *
 * Pattern: Define Zod schema, then infer TypeScript type from it.
 * This gives us runtime validation + compile-time types from a single source.
 */

import { z } from 'zod';
import {
  ConfigErrorSchema,
  ConversationConfigPatchSchema,
  ConversationConfigSchema,
  ConversationIdSchema,
  ModelIdSchema,
} from './conversation-config.js';
import { CreateKindSchema, EncodedRowsSchema, RowPatchSchema } from './conversation.js';
import {
  PROVIDER_METADATA,
  PROVIDER_OPTIONS,
  type Provider,
  type ProviderMetadata,
  ProviderSchema,
  getProviderMetadata,
} from './provider-catalog.js';

export * from './conversation-config.js';
export * from './conversation.js';
export * from './buddy.js';
export * from './provider-catalog.js';

// =============================================================================
// Core Data Structures
// =============================================================================

export {
  ProviderSchema,
  type Provider,
  type ProviderMetadata,
  PROVIDER_METADATA,
  PROVIDER_OPTIONS,
  getProviderMetadata,
};

// =============================================================================
// Model Identifiers — per-provider model choices
//
// Each provider defines a union of "model identifiers" that the UI presents
// as a dropdown. These are opaque strings on the client side.
// The server's Provider.modelToParams() decomposes them into CLI flags.
//
// Claude: aliases passed to `claude --model <alias>`
// Codex: base model IDs only. Reasoning effort is a SEPARATE field on the
//   Conversation (Conversation.reasoningEffort), mirroring Claude.
// OpenCode: path-style identifiers passed to `opencode run -m <id>`
//   e.g. "opencode/big-pickle" or "opencode/gpt-5-nano"
// We require at least one "/" segment to avoid collisions with Claude/Codex IDs.
// =============================================================================

// =============================================================================
// Generated catalog — single source of truth is vendor/agent-cli-tool/catalog.jsonc
// Run `pnpm --filter @unleashd/shared gen:catalog` after editing catalog.jsonc.
// This block derives schemas and helpers from the generated catalog to avoid
// duplicate enum literals in shared/src/index.ts.
// =============================================================================
import {
  CLAUDE_EFFORT_LEVELS as GEN_CLAUDE_EFFORT_LEVELS,
  CLAUDE_MODEL_IDS as GEN_CLAUDE_MODEL_IDS,
  CODEX_EFFORT_LEVELS as GEN_CODEX_EFFORT_LEVELS,
  CODEX_MODEL_REGISTRY as GEN_CODEX_MODEL_REGISTRY,
  CODEX_THINKING_OPTIONS as GEN_CODEX_THINKING_OPTIONS,
  CODEX_UNIFIED_THINKING_OPTIONS as GEN_CODEX_UNIFIED_THINKING_OPTIONS,
  CURSOR_MODEL_REGISTRY as GEN_CURSOR_MODEL_REGISTRY,
  GEMINI_MODEL_IDS as GEN_GEMINI_MODEL_IDS,
  MUSE_EFFORT_LEVELS as GEN_MUSE_EFFORT_LEVELS,
  MUSE_MODEL_IDS as GEN_MUSE_MODEL_IDS,
  NO_CODEX_THINKING as GEN_NO_CODEX_THINKING,
  PROVIDER_MODEL_CATALOG,
} from './generated/catalog.js';
import type { CatalogProviderEntry } from './generated/catalog.js';

export { PROVIDER_MODEL_CATALOG } from './generated/catalog.js';
export type { CatalogProviderEntry } from './generated/catalog.js';

// Re-export generated arrays so consumers can import from shared entry point
export const CLAUDE_EFFORT_LEVELS = GEN_CLAUDE_EFFORT_LEVELS;
export const CODEX_EFFORT_LEVELS = GEN_CODEX_EFFORT_LEVELS;
export const MUSE_EFFORT_LEVELS = GEN_MUSE_EFFORT_LEVELS;
export const CODEX_THINKING_OPTIONS = GEN_CODEX_THINKING_OPTIONS;
export const NO_CODEX_THINKING = GEN_NO_CODEX_THINKING;
export const CODEX_UNIFIED_THINKING_OPTIONS = GEN_CODEX_UNIFIED_THINKING_OPTIONS;
export const CURSOR_MODEL_REGISTRY = GEN_CURSOR_MODEL_REGISTRY;
export const CODEX_MODEL_REGISTRY = GEN_CODEX_MODEL_REGISTRY;

export type CodexThinkingOption = (typeof CODEX_THINKING_OPTIONS)[number];
export type CodexThinkingMode = typeof NO_CODEX_THINKING | CodexThinkingOption;

export type CodexModelRegistryEntry = {
  modelName: string;
  displayName: string;
  thinkingOptions: readonly CodexThinkingMode[];
  defaultThinkingOption?: CodexThinkingMode;
  isDefault?: boolean;
};

// Type assertion: generated registry conforms to CodexModelRegistryEntry[]
// (cast avoids circular const-assertion issues while keeping runtime identical)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _codexRegistryCheck: ReadonlyArray<CodexModelRegistryEntry> = CODEX_MODEL_REGISTRY;

export const ClaudeModelSchema = z.enum(GEN_CLAUDE_MODEL_IDS as unknown as [string, ...string[]]);

export const GeminiModelSchema = z.enum(GEN_GEMINI_MODEL_IDS as unknown as [string, ...string[]]);

export type CursorModel = (typeof CURSOR_MODEL_REGISTRY)[number]['id'];
export const CURSOR_MODEL_IDS = CURSOR_MODEL_REGISTRY.map((entry) => entry.id);
export const CursorModelSchema = z.enum(
  CURSOR_MODEL_IDS as unknown as [CursorModel, ...CursorModel[]]
);

export const MuseModelSchema = z.enum(GEN_MUSE_MODEL_IDS as unknown as [string, ...string[]]);

/** Retired / shorthand ids → canonical Cursor `--model` value. */
export const CURSOR_MODEL_ALIASES: Readonly<Record<string, CursorModel>> = {
  'composer-2': 'composer-2.5',
  composer2: 'composer-2.5',
  'composer-2-fast': 'composer-2.5',
  'composer-2.5-fast': 'composer-2.5',
  'grok-4.5': 'cursor-grok-4.5-high',
  'grok-4.7': 'grok-4.7-high',
};

type CodexModelRegistryItem = (typeof CODEX_MODEL_REGISTRY)[number];

// Codex model IDs are base IDs only. Reasoning effort lives on
// Conversation.reasoningEffort (same shape as Claude).
export type CodexModel = CodexModelRegistryItem['modelName'];

export const CODEX_BASE_MODEL_INFOS = CODEX_MODEL_REGISTRY.map((entry) => ({
  id: entry.modelName,
  displayName: entry.displayName,
  isDefault: Boolean(entry.isDefault),
})) as ReadonlyArray<{
  id: CodexModel;
  displayName: string;
  isDefault: boolean;
}>;

// Canonical Codex ModelInfo list — base IDs only. Effort is chosen via
// Conversation.reasoningEffort (separate field), mirroring Claude.
export const CODEX_MODEL_INFOS = CODEX_BASE_MODEL_INFOS;

export const CODEX_MODEL_IDS = CODEX_MODEL_INFOS.map((model) => model.id) as readonly CodexModel[];
const CODEX_MODEL_ID_SET = new Set<string>(CODEX_MODEL_IDS);
export const CodexModelSchema = z.custom<CodexModel>(
  (value): value is CodexModel => typeof value === 'string' && CODEX_MODEL_ID_SET.has(value),
  {
    message: `Invalid Codex model identifier. Expected one of: ${CODEX_MODEL_IDS.join(', ')}`,
  }
);

/**
 * The catalog entry for a provider. Every Provider has one: a missing entry is a
 * stale generated catalog, and this throws at startup instead of guessing.
 */
export function catalogEntryForProvider(provider: Provider): CatalogProviderEntry {
  const entry = PROVIDER_MODEL_CATALOG.find((candidate) => candidate.id === provider);
  if (!entry) {
    throw new Error(
      `Provider '${provider}' is missing from the generated model catalog; run pnpm --filter @unleashd/shared gen:catalog`
    );
  }
  return entry;
}

export type OpenCodeModel = `${string}/${string}`;

// "provider/model" path-style ID (allows additional segments like "openrouter/openai/gpt-5").
// Allowed chars keep to typical provider/model slugs and version suffixes.
const OPENCODE_MODEL_ID_REGEX = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._:+-]*)+$/i;

export const OpenCodeModelSchema = z.custom<OpenCodeModel>(
  (value): value is OpenCodeModel =>
    typeof value === 'string' && OPENCODE_MODEL_ID_REGEX.test(value),
  {
    message:
      "Invalid OpenCode model identifier. Expected 'provider/model' format (e.g. 'opencode/big-pickle').",
  }
);

export function isModelIdValidForProvider(provider: Provider, modelId?: string): boolean {
  if (!modelId) return true;
  // Validate the canonical form so aliases never need to live in the schema.
  const canonical = normalizeModelId(provider, modelId) ?? modelId;

  switch (provider) {
    case 'claude':
      return ClaudeModelSchema.safeParse(canonical).success;
    case 'codex':
      return CodexModelSchema.safeParse(canonical).success;
    case 'gemini':
      return GeminiModelSchema.safeParse(canonical).success;
    case 'opencode':
      return OpenCodeModelSchema.safeParse(canonical).success;
    case 'cursor':
      return CursorModelSchema.safeParse(canonical).success;
    case 'muse':
      return MuseModelSchema.safeParse(canonical).success;
  }
}

export function normalizeModelId(provider: Provider, model?: string): string | undefined {
  if (!model) return undefined;
  if (provider === 'cursor') {
    return CURSOR_MODEL_ALIASES[model] ?? model;
  }
  return model;
}

/** Display metadata returned by Provider.listModels() for the model dropdown */
export const ModelInfoSchema = z.object({
  id: ModelIdSchema,
  displayName: z.string(),
  isDefault: z.boolean(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

// Reasoning-effort values are passed through verbatim — we never translate or
// map them. Whatever the CLI accepts is what flows through the wire.
//
// Per-provider authoritative sources (verified via --help / rejection messages):
//   claude --effort:                 low | medium | high | xhigh | max
//   codex -c model_reasoning_effort: minimal | low | medium | high | xhigh | max | ultra
//
// Omitting the effort flag is represented as undefined on
// Conversation.reasoningEffort, so it does not appear in these lists.
//
// No shared union enum on the wire — reasoningEffort is a nullable optional
// string at the schema layer. The per-provider arrays below are for UI rendering
// and server-side validation only; the submodule only "aligns" the flag name,
// and each CLI does the final runtime reject if something slips through.
// Effort-level arrays and types are re-exported from generated/catalog.ts (single source: vendor/agent-cli-tool/catalog.jsonc)

const EFFORT_LEVELS_BY_PROVIDER: Partial<Record<Provider, readonly string[]>> = {
  claude: CLAUDE_EFFORT_LEVELS,
  codex: CODEX_EFFORT_LEVELS,
  muse: MUSE_EFFORT_LEVELS,
};

export function effortLevelsForProvider(provider: Provider): readonly string[] {
  return EFFORT_LEVELS_BY_PROVIDER[provider] ?? [];
}

export function isEffortValidForProvider(
  provider: Provider,
  effort: string | null | undefined
): boolean {
  // Both control variants are valid at the boundary: undefined requests the
  // provider/model default, while null explicitly requests no flag.
  if (effort == null) return true;
  return effortLevelsForProvider(provider).includes(effort);
}

// =============================================================================
// Provider-SESSION fork capability
// =============================================================================
//
// Chat "Fork" creates a new conversation with resumedFromConversationId and
// draft/first-message context (a soft handoff; cross-provider is fine). On the
// first send, when source and target share a provider in this set, the turn
// upgrades to native session inheritance: the child inherits the source's CLI
// transcript under a NEW provider session id (source untouched). Needs harness
// sessionForkFlags (claude/opencode) or emulateFork (codex/gemini). Cursor is
// omitted: no `--fork`, and chats are opaque sqlite / cloud-backed under
// ~/.cursor/chats/. See Conversation.sendMessage in server runtime.ts.
//
export const FORK_CAPABLE_PROVIDERS: ReadonlySet<Provider> = new Set<Provider>([
  'claude',
  'opencode',
  'codex',
  'gemini',
]);

/** True if this provider's harness can fork a provider session natively. */
export function providerSupportsFork(p: Provider): boolean {
  return FORK_CAPABLE_PROVIDERS.has(p);
}

// =============================================================================
// Oompa Runtime Visibility Contract
// Used by /api/swarm-runtime and all worker-facing UIs.
//
// These are DERIVED view types that the server constructs from process state.
// For the RAW JSON file shapes written by oompa_loompas (run.json,
// live-summary.json, iteration logs, review logs, summary.json),
// see shared/src/generated/oompa-types.ts.
// =============================================================================

/** Worker activity states used for live worker visibility in Workers views. */
export type OompaWorkerStatus = 'starting' | 'idle' | 'running' | 'done' | 'error';

export interface OompaRuntimeWorker {
  id: string;
  status: OompaWorkerStatus;
  lastEvent: string;
}

export interface OompaRuntimeRun {
  runId: string;
  swarmId: string | null;
  isRunning: boolean;
  totalWorkers: number;
  activeWorkers: number;
  doneWorkers: number;
  configPath: string | null;
  logFile: string | null;
  workers: OompaRuntimeWorker[];
  runCount: number;
}

export interface OompaRuntimeSnapshot {
  available: boolean;
  run: OompaRuntimeRun | null;
  reason: string | null;
}

// =============================================================================
// Swarm Run Persistence Types (from oompa agentnet.runs)
// These are the JSON shapes written to disk by oompa_loompas:
//   runs/{swarm-id}/run.json       → SwarmRunLog
//   runs/{swarm-id}/summary.json   → SwarmRunSummary (or server-synthesized)
//   runs/{swarm-id}/reviews/*.json → SwarmReviewLog
// Field names use hyphens to match the on-disk JSON keys.
// =============================================================================

/** Per-worker metrics within a swarm run summary. */
export interface SwarmRunWorker {
  id: string;
  harness: string;
  model: string;
  status: string;
  completed: number;
  iterations: number;
  merges: number;
  rejections: number;
  errors: number;
  'review-rounds-total': number;
}

/** Aggregate summary of a completed (or synthesized) swarm run. */
export interface SwarmRunSummary {
  'swarm-id': string;
  'finished-at': string;
  /** Present when synthesized from run.json; absent in raw summary.json. */
  'started-at'?: string;
  'total-workers': number;
  'total-completed': number;
  'total-iterations': number;
  'status-counts': Record<string, number>;
  workers: SwarmRunWorker[];
}

/** Shape of runs/{swarm-id}/run.json — written at swarm start. */
export interface SwarmRunLog {
  'swarm-id': string;
  'started-at': string;
  'config-file': string;
  workers: Array<{
    id: string;
    harness: string;
    model: string;
    iterations: number;
  }>;
}

/** Shape of runs/{swarm-id}/reviews/*.json — one per review round. */
export interface SwarmReviewLog {
  'worker-id': string;
  iteration: number;
  round: number;
  verdict: string;
  timestamp: string;
  output: string;
  'diff-files': string[];
}

/** Container pairing a run log with its summary for a single swarm run. */
export interface SwarmRun {
  swarmId: string;
  run: SwarmRunLog | null;
  summary: SwarmRunSummary | null;
}

// =============================================================================
// Client → Server Messages
// =============================================================================

export const CreateConversationCommandSchema = z.object({
  type: z.literal('create_conversation'),
  commandId: z.string().min(1),
  conversationId: ConversationIdSchema,
  workingDirectory: z.string().min(1),
  config: ConversationConfigSchema,
  initialMessage: z.string().min(1).optional(),
  swarmDebugPrefix: z.string().optional(),
  kind: CreateKindSchema,
});
export type CreateConversationCommand = z.infer<typeof CreateConversationCommandSchema>;

export const SetConversationConfigCommandSchema = z.object({
  type: z.literal('set_conversation_config'),
  commandId: z.string().min(1),
  conversationId: ConversationIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  patch: ConversationConfigPatchSchema,
});
export type SetConversationConfigCommand = z.infer<typeof SetConversationConfigCommandSchema>;

const StopConversationMessageSchema = z.object({
  type: z.literal('stop_conversation'),
  conversationId: ConversationIdSchema,
});

const SetConversationDoneMessageSchema = z.object({
  type: z.literal('set_conversation_done'),
  conversationId: ConversationIdSchema,
  done: z.boolean(),
});

const DeleteConversationMessageSchema = z.object({
  type: z.literal('delete_conversation'),
  conversationId: ConversationIdSchema,
});

// Queue Messages (Client → Server)
const QueueMessageSchema = z.object({
  type: z.literal('queue_message'),
  commandId: z.string().min(1),
  conversationId: ConversationIdSchema,
  content: z.string().min(1),
});

const InterruptAndSendMessageSchema = z.object({
  type: z.literal('interrupt_and_send'),
  commandId: z.string().min(1),
  conversationId: ConversationIdSchema,
  content: z.string().min(1),
});

const CancelQueuedMessageSchema = z.object({
  type: z.literal('cancel_queued_message'),
  conversationId: ConversationIdSchema,
  messageId: z.string(),
});

const ClearQueueMessageSchema = z.object({
  type: z.literal('clear_queue'),
  conversationId: ConversationIdSchema,
});

// Promote a pending queued message to run next, interrupting the active
// turn when there is one. Fire-and-forget like cancel/clear: the
// queue_updated broadcast is the confirmation.
const PromoteQueuedMessageSchema = z.object({
  type: z.literal('promote_queued_message'),
  conversationId: ConversationIdSchema,
  messageId: z.string(),
});

const ClientMessageSchema = z.discriminatedUnion('type', [
  CreateConversationCommandSchema,
  SetConversationConfigCommandSchema,
  StopConversationMessageSchema,
  DeleteConversationMessageSchema,
  SetConversationDoneMessageSchema,
  QueueMessageSchema,
  InterruptAndSendMessageSchema,
  CancelQueuedMessageSchema,
  ClearQueueMessageSchema,
  PromoteQueuedMessageSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// =============================================================================
// Device UI preferences (browser localStorage; never synced)
// =============================================================================

// Per-device view state. Conversation facts (done) live on the conversation
// record instead: the retired server-synced UI blob keyed them by an unstable
// id and lost writes on refresh and reconnect.
export const DeviceUiPrefsSchema = z.object({
  galleryExpandedProjects: z.array(z.string()),
  galleryCollapsedProjects: z.array(z.string()),
  showTempSessions: z.boolean(),
  showDoneConversations: z.boolean(),
  showWorkerConversations: z.boolean(),
  lastWorkingDirectory: z.string().nullable(),
  promotedWorkers: z.array(z.string()),
});

export type DeviceUiPrefs = z.infer<typeof DeviceUiPrefsSchema>;

/** Last viewed message index per conversation id, for the NEW badge. */
export const SeenMessageIndexSchema = z.record(z.string(), z.number());

// =============================================================================
// Server → Client Messages (protocol v3, T09 2026-09-25)
//
// Skew rule: the client reads `hello.protocol.version` before anything else. A
// v2 backend (still running while Vite already serves this client) sends
// `init`, which this client recognises by type and answers with a typed
// "backend reloading" state + reconnect — it never replaces the list with an
// empty one. A v2 client talking to a v3 backend rejects `hello` as an
// unknown type and keeps the list it had. Fields ADDED within v3 still need
// `.default(...)` (CLAUDE.md). Guard: client/test/protocol-skew.test.ts.
// =============================================================================

export const PROTOCOL_VERSION = 3;

// Pattern: sum-types (docs/patterns.md#sum-types)
// A tab left open across a protocol swap kept its list and silently stopped
// updating: the server's frames failed the old client's schema one by one.
// Every socket therefore names its protocol in the upgrade URL, and the
// server closes a socket that names another one (or none: a client built
// before v3 sends no version) with PROTOCOL_MISMATCH_CLOSE_CODE and
// `protocol <server version>` as the reason. Guards:
// server/test/websocket-lifecycle.test.ts, client/test/protocol-skew.test.ts.
export const PROTOCOL_MISMATCH_CLOSE_CODE = 4426;
export const WS_PATH = `/ws?protocol=${PROTOCOL_VERSION}`;

/** The protocol a socket's upgrade URL names; null when it names none. */
export function requestedProtocol(requestUrl: string): number | null {
  const named = new URL(requestUrl, 'http://upgrade').searchParams.get('protocol');
  return named === null ? null : Number(named);
}

/**
 * Why a socket closed, as this client must act on it. `outdated`: the server
 * is newer, so only loading its client helps. `skew`: the server is older (a
 * dev reload in flight) and reconnecting heals it. `dropped`: anything else.
 */
export type SocketClose =
  | { t: 'dropped' }
  | { t: 'skew'; serverVersion: number }
  | { t: 'outdated'; serverVersion: number };

export function classifySocketClose(code: number, reason: string): SocketClose {
  if (code !== PROTOCOL_MISMATCH_CLOSE_CODE) return { t: 'dropped' };
  const serverVersion = Number(reason.replace('protocol ', ''));
  return serverVersion > PROTOCOL_VERSION
    ? { t: 'outdated', serverVersion }
    : { t: 'skew', serverVersion };
}

const HelloMessageSchema = EncodedRowsSchema.extend({
  type: z.literal('hello'),
  protocol: z.object({ version: z.literal(PROTOCOL_VERSION) }),
  defaultCwd: z.string(),
  /** True while the server still hydrates history; `ready` ends it. */
  loading: z.boolean(),
  archivedBuddyIds: z.array(z.string()),
});

/** Upsert rows (discovery batches, external refresh, a creation seen by other sockets). */
const RowsMessageSchema = EncodedRowsSchema.extend({ type: z.literal('rows') });

const RemovedMessageSchema = z.object({
  type: z.literal('removed'),
  ids: z.array(ConversationIdSchema),
});

/** Startup hydration finished; `conversationIds` is the authoritative membership. */
const ReadyMessageSchema = z.object({
  type: z.literal('ready'),
  conversationIds: z.array(ConversationIdSchema),
});

const PatchMessageSchema = z.object({
  type: z.literal('patch'),
  id: ConversationIdSchema,
  patch: RowPatchSchema,
});

const GeneralCommandErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
});
export type GeneralCommandError = z.infer<typeof GeneralCommandErrorSchema>;

const CommandErrorSchema = z.union([ConfigErrorSchema, GeneralCommandErrorSchema]);
export type CommandError = z.infer<typeof CommandErrorSchema>;

/**
 * The one acknowledgement for a correlated command. `created` answers the
 * creating socket (other sockets get `rows`); `rejected` may follow `created`
 * for the same commandId on a create replay (docs/ws-contract-surprises.md).
 * A rejection never carries a snapshot: the authoritative state already went
 * out as a patch.
 */
const AckMessageSchema = z.object({
  type: z.literal('ack'),
  commandId: z.string().min(1),
  result: z.discriminatedUnion('t', [
    z.object({ t: z.literal('created'), rows: EncodedRowsSchema }),
    z.object({ t: z.literal('accepted') }),
    z.object({
      t: z.literal('rejected'),
      conversationId: ConversationIdSchema.nullable(),
      error: CommandErrorSchema,
    }),
  ]),
});

const MessageMessageSchema = z.object({
  type: z.literal('message'),
  conversationId: ConversationIdSchema,
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});

const ChunkMessageSchema = z.object({
  type: z.literal('chunk'),
  conversationId: ConversationIdSchema,
  text: z.string(),
});

const MessageCompleteMessageSchema = z.object({
  type: z.literal('message_complete'),
  conversationId: ConversationIdSchema,
  reason: z.enum(['success', 'error', 'out_of_tokens', 'killed']).optional(),
});

const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
});

const ServerMessageSchema = z.discriminatedUnion('type', [
  HelloMessageSchema,
  RowsMessageSchema,
  RemovedMessageSchema,
  ReadyMessageSchema,
  PatchMessageSchema,
  AckMessageSchema,
  MessageMessageSchema,
  ChunkMessageSchema,
  MessageCompleteMessageSchema,
  ErrorMessageSchema,
  z.object({ type: z.literal('buddy_archived'), buddyId: z.string() }),
  // Debounced server change feed: some Buddy state was written; clients
  // refresh their cached Buddy views (see server/src/buddies/change-feed.ts).
  z.object({ type: z.literal('buddies_changed') }),
  // One channel's posts or responders changed; clients refresh only that
  // channel's views (client atoms/resources.ts invalidateChannelResources).
  // `channelId` was `listId` until T14b (2026-09-26); it names a channel of any kind. No
  // `.default()` on purpose: the frame only invalidates a cache, so an older backend's
  // `listId` frame during a dev reload is classified `invalid` and dropped (one missed
  // refresh), never applied to a made-up channel. Guard: client/test/protocol-skew.test.ts.
  z.object({ type: z.literal('channel_changed'), channelId: z.string() }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
/** What a server builds: rows are encoded (`encodeRows`) before they go out. */
export type ServerMessageInput = z.input<typeof ServerMessageSchema>;

// =============================================================================
// Validation Helpers
// =============================================================================
// Only the two parsers the transports call stay exported (T14b removed ~20 unused
// per-message type aliases, the throwing parsers and the is*Message guards).
// Pattern: one-type-source (docs/patterns.md#one-type-source)

/**
 * Safely parse a client message. Returns success/error result.
 */
export function safeParseClientMessage(data: unknown) {
  return ClientMessageSchema.safeParse(data);
}

/**
 * What one server frame means to this client (protocol v3). A v2 backend —
 * still running while Vite already serves this client during a dev reload —
 * greets with `init`; that is a typed version skew, never a parse failure that
 * the caller might answer by clearing state. Guard: client/test/protocol-skew.test.ts.
 */
export type ServerFrame =
  | { t: 'message'; message: ServerMessage }
  | { t: 'skew'; serverVersion: number }
  | { t: 'invalid'; issues: string };

export function classifyServerFrame(raw: unknown): ServerFrame {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  if (record.type === 'init') {
    const protocol = record.protocol as { version?: unknown } | undefined;
    return {
      t: 'skew',
      serverVersion: typeof protocol?.version === 'number' ? protocol.version : 2,
    };
  }
  const parsed = ServerMessageSchema.safeParse(raw);
  return parsed.success
    ? { t: 'message', message: parsed.data }
    : { t: 'invalid', issues: parsed.error.issues.map((issue) => issue.message).join('; ') };
}

// Oompa raw JSON file types (auto-generated from oompa_loompas schemas)
export type {
  OompaCycle,
  OompaReviewLog,
  OompaStarted,
  OompaStopped,
} from './generated/oompa-types.js';

export * from './buddy-workspace-activity.js';
export * from './buddy-channel-posts.js';
export * from './harness-retry.js';
export * from './buddy-team-configuration.js';

export * from './buddy-team-configuration-result.js';
