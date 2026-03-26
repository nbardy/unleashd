/**
 * Shared Zod schemas and TypeScript types for Claude Multi-Chat
 * Used by both client and server for type-safe WebSocket communication
 *
 * Pattern: Define Zod schema, then infer TypeScript type from it.
 * This gives us runtime validation + compile-time types from a single source.
 */

import { z } from 'zod';

// =============================================================================
// Provider-Specific Types (re-exported)
// =============================================================================

// Claude CLI types - strict type definitions for Claude CLI stream-json protocol
export {
  // Content block types
  type ClaudeTextBlock,
  type ClaudeToolUseBlock,
  type ClaudeToolResultBlock,
  type ClaudeContentBlock,
  // Output types from CLI stdout
  type ClaudeSystemInitOutput,
  type ClaudeToolDefinition,
  type ClaudeMcpServer,
  type ClaudeAssistantOutput,
  type ClaudeResultSuccessOutput,
  type ClaudeResultErrorOutput,
  type ClaudeResultOutput,
  type ClaudeUserOutput,
  type ClaudeCliOutput,
  // Input types to CLI stdin
  type ClaudeCliInput,
  // Unified internal event types
  type ClaudeEventMessageStart,
  type ClaudeEventTextDelta,
  type ClaudeEventMessageComplete,
  type ClaudeEventToolUse,
  type ClaudeEventError,
  type ClaudeEvent,
  // Type guards
  isClaudeSystemInitOutput,
  isClaudeAssistantOutput,
  isClaudeResultSuccessOutput,
  isClaudeResultErrorOutput,
  isClaudeResultOutput,
  isClaudeUserOutput,
  isClaudeTextBlock,
  isClaudeToolUseBlock,
  isClaudeToolResultBlock,
  // Parser functions and error class
  ClaudeParseError,
  parseClaudeCliOutput,
  parseClaudeCliOutputStream,
  formatClaudeCliInput,
  // Utility functions
  extractTextFromContentBlocks,
  extractToolUseFromContentBlocks,
} from './providers/claude.types.js';

// Codex CLI types - strict type definitions for Codex CLI JSON protocol
export {
  // Output schemas and types
  CodexStartOutputSchema,
  CodexMessageOutputSchema,
  CodexToolCallOutputSchema,
  CodexToolResultOutputSchema,
  CodexEndOutputSchema,
  CodexDoneOutputSchema,
  CodexOutputSchema,
  type CodexStartOutput,
  type CodexMessageOutput,
  type CodexToolCallOutput,
  type CodexToolResultOutput,
  type CodexEndOutput,
  type CodexDoneOutput,
  type CodexOutput,
  // Input schemas and types
  CodexInputSchema,
  type CodexInput,
  // Unified event schemas and types (normalized to match Claude's structure)
  UnifiedMessageStartEventSchema,
  UnifiedTextDeltaEventSchema,
  UnifiedMessageCompleteEventSchema,
  UnifiedToolUseEventSchema,
  UnifiedToolResultEventSchema,
  UnifiedErrorEventSchema,
  UnifiedCodexEventSchema,
  type UnifiedMessageStartEvent,
  type UnifiedTextDeltaEvent,
  type UnifiedMessageCompleteEvent,
  type UnifiedToolUseEvent,
  type UnifiedToolResultEvent,
  type UnifiedErrorEvent,
  type UnifiedCodexEvent,
  // Type guards
  isCodexStartOutput,
  isCodexMessageOutput,
  isCodexToolCallOutput,
  isCodexToolResultOutput,
  isCodexEndOutput,
  isCodexDoneOutput,
  isCodexTerminationOutput,
  // Parser functions and error class
  CodexParseError,
  parseCodexOutput,
  codexOutputToUnifiedEvent,
  parseCodexOutputToUnifiedEvent,
  formatCodexInput,
} from './providers/codex.types.js';

// =============================================================================
// Core Data Structures
// =============================================================================

// Provider enum for multi-CLI support (Claude, Codex, OpenCode, Gemini, etc.)
export const ProviderSchema = z.enum(['claude', 'codex', 'opencode', 'gemini', 'pi', 'qwen']);
export type Provider = z.infer<typeof ProviderSchema>;

export interface ProviderMetadata {
  id: Provider;
  label: string;
  shortLabel: string;
  cssClass: string;
}

export const PROVIDER_METADATA: Record<Provider, Omit<ProviderMetadata, 'id'>> = {
  claude: { label: 'Claude', shortLabel: 'C', cssClass: 'claude' },
  codex: { label: 'Codex', shortLabel: 'X', cssClass: 'codex' },
  opencode: { label: 'OpenCode', shortLabel: 'O', cssClass: 'opencode' },
  gemini: { label: 'Gemini', shortLabel: 'G', cssClass: 'gemini' },
  pi: { label: 'Pi', shortLabel: 'π', cssClass: 'pi' },
  qwen: { label: 'Qwen', shortLabel: 'Q', cssClass: 'qwen' },
};

export const PROVIDER_OPTIONS: readonly ProviderMetadata[] = [
  { id: 'claude', ...PROVIDER_METADATA.claude },
  { id: 'codex', ...PROVIDER_METADATA.codex },
  { id: 'opencode', ...PROVIDER_METADATA.opencode },
  { id: 'gemini', ...PROVIDER_METADATA.gemini },
  { id: 'pi', ...PROVIDER_METADATA.pi },
  { id: 'qwen', ...PROVIDER_METADATA.qwen },
];

export const PROVIDER_IDS: readonly Provider[] = PROVIDER_OPTIONS.map((provider) => provider.id);

export const getProviderMetadata = (provider: Provider): ProviderMetadata => ({
  id: provider,
  ...PROVIDER_METADATA[provider],
});

// =============================================================================
// Model Identifiers — per-provider model choices
//
// Each provider defines a union of "model identifiers" that the UI presents
// as a dropdown. These are opaque strings on the client side.
// The server's Provider.modelToParams() decomposes them into CLI flags.
//
// Claude: aliases passed to `claude --model <alias>`
// Codex: base model strings plus optional composite reasoning suffixes
//   e.g. "gpt-5.4-high" → `-m gpt-5.4 -c model_reasoning_effort=high`
//   e.g. "gpt-5.3-codex-spark-xhigh" → `-m gpt-5.3-codex-spark -c model_reasoning_effort=xhigh`
// OpenCode: path-style identifiers passed to `opencode run -m <id>`
//   e.g. "opencode/big-pickle" or "opencode/gpt-5-nano"
// We require at least one "/" segment to avoid collisions with Claude/Codex IDs.
// =============================================================================

export const ClaudeModelSchema = z.enum(['opus', 'sonnet', 'haiku']);
export type ClaudeModel = z.infer<typeof ClaudeModelSchema>;

export const GeminiModelSchema = z.enum([
  'gemini-3.1-pro-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
]);
export type GeminiModel = z.infer<typeof GeminiModelSchema>;

export const CODEX_THINKING_OPTIONS = ['high', 'medium', 'xhigh'] as const;
export type CodexThinkingOption = (typeof CODEX_THINKING_OPTIONS)[number];
export const NO_CODEX_THINKING = 'none' as const;
export type CodexThinkingMode = typeof NO_CODEX_THINKING | CodexThinkingOption;
export const CODEX_UNIFIED_THINKING_OPTIONS = [
  NO_CODEX_THINKING,
  ...CODEX_THINKING_OPTIONS,
] as const;

export type CodexModelRegistryEntry = {
  modelName: string;
  displayName: string;
  thinkingOptions: readonly CodexThinkingMode[];
  defaultThinkingOption?: CodexThinkingMode;
  isDefault?: boolean;
};

export const CODEX_MODEL_REGISTRY = [
  {
    modelName: 'gpt-5.4',
    displayName: 'GPT-5.4',
    thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS,
    defaultThinkingOption: 'high',
    isDefault: true,
  },
  {
    modelName: 'gpt-5.3-codex-spark',
    displayName: 'Codex Spark',
    thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS,
    defaultThinkingOption: 'high',
    isDefault: false,
  },
] as const satisfies ReadonlyArray<CodexModelRegistryEntry>;

type CodexModelRegistryItem = (typeof CODEX_MODEL_REGISTRY)[number];
type CodexModelIdForEntry<TEntry extends CodexModelRegistryItem> = TEntry extends unknown
  ? TEntry['thinkingOptions'][number] extends infer TThinkingOption
    ? TThinkingOption extends typeof NO_CODEX_THINKING
      ? TEntry['modelName']
      : TThinkingOption extends string
        ? `${TEntry['modelName']}-${TThinkingOption}`
        : never
    : never
  : never;

export type CodexModel = CodexModelIdForEntry<CodexModelRegistryItem>;

export const CODEX_THINKING_DISPLAY_NAMES: Record<CodexThinkingOption, string> = {
  medium: 'Medium Effort',
  high: 'High Effort',
  xhigh: 'Extra High Effort',
};

export function toCodexModelId(modelName: string, thinkingOption: CodexThinkingMode): CodexModel {
  return (
    thinkingOption === NO_CODEX_THINKING ? modelName : `${modelName}-${thinkingOption}`
  ) as CodexModel;
}

function formatCodexDisplayName(
  entry: CodexModelRegistryEntry,
  thinkingOption: CodexThinkingMode
): string {
  if (thinkingOption === NO_CODEX_THINKING) return entry.displayName;

  return `${entry.displayName} (${CODEX_THINKING_DISPLAY_NAMES[thinkingOption]})`;
}

export const CODEX_BASE_MODEL_INFOS = CODEX_MODEL_REGISTRY.map((entry) => ({
  id: entry.modelName,
  displayName: entry.displayName,
  isDefault: Boolean(entry.isDefault),
}));

export const CODEX_MODEL_INFOS = CODEX_MODEL_REGISTRY.flatMap((entry: CodexModelRegistryEntry) =>
  entry.thinkingOptions.map((thinkingOption: CodexThinkingMode) => {
    const defaultThinkingOption = entry.defaultThinkingOption ?? entry.thinkingOptions[0];
    return {
      id: toCodexModelId(entry.modelName, thinkingOption),
      displayName: formatCodexDisplayName(entry, thinkingOption),
      isDefault: Boolean(entry.isDefault && thinkingOption === defaultThinkingOption),
    };
  })
) as ReadonlyArray<{
  id: CodexModel;
  displayName: string;
  isDefault: boolean;
}>;

export const CODEX_MODEL_IDS = CODEX_MODEL_INFOS.map((model) => model.id) as readonly CodexModel[];
const CODEX_MODEL_ID_SET = new Set<string>(CODEX_MODEL_IDS);
const DEFAULT_CODEX_MODELS = CODEX_MODEL_INFOS.filter((model) => model.isDefault);
if (DEFAULT_CODEX_MODELS.length !== 1) {
  throw new Error(`Expected exactly one default Codex model, found ${DEFAULT_CODEX_MODELS.length}`);
}

export const DEFAULT_CODEX_MODEL_ID = DEFAULT_CODEX_MODELS[0].id;
export const CodexModelSchema = z.custom<CodexModel>(
  (value): value is CodexModel => typeof value === 'string' && CODEX_MODEL_ID_SET.has(value),
  {
    message: `Invalid Codex model identifier. Expected one of: ${CODEX_MODEL_IDS.join(', ')}`,
  }
);

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

export const ModelIdSchema = z.union([
  ClaudeModelSchema,
  CodexModelSchema,
  GeminiModelSchema,
  OpenCodeModelSchema,
]);
export type ModelId = z.infer<typeof ModelIdSchema>;

/** Display metadata returned by Provider.listModels() for the model dropdown */
export const ModelInfoSchema = z.object({
  id: ModelIdSchema,
  displayName: z.string(),
  isDefault: z.boolean(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.coerce.date(),
});

export type Message = z.infer<typeof MessageSchema>;

// =============================================================================
// Sub-Agent Types (for Task tool detection)
// =============================================================================

export const SubAgentStatusSchema = z.enum(['pending', 'running', 'completed', 'error']);
export type SubAgentStatus = z.infer<typeof SubAgentStatusSchema>;

export const SubAgentSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: SubAgentStatusSchema,
  toolUses: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  currentAction: z.string().optional(), // e.g., "Write: client/src/App.css"
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
});

export type SubAgent = z.infer<typeof SubAgentSchema>;

// Queue types (shared between server state and client display).
export const QueuedMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  queuedAt: z.coerce.date(),
  status: z.enum(['pending', 'sending']),
});

export type QueuedMessage = z.infer<typeof QueuedMessageSchema>;

// CONVERSATION STATE MODEL
// ========================
// Two server-authoritative flags + one client-only flag:
//
//   isRunning   (server-authoritative via 'status' broadcasts)
//     Process is alive. true on spawn, false on close.
//     Drives: spawn guard, queue processing, sidebar/gallery indicators.
//
//   isStreaming  (server-authoritative via 'status' broadcasts)
//     Assistant is actively producing content. true on first text_delta,
//     false on message_complete or process close (whichever comes first).
//     Drives: typing dots, pulse animation, scroll behavior.
//     INVARIANT: !isRunning → !isStreaming (enforced in close handler).
//     A dead process cannot produce content.
//
//   confirmed   (client-only, from 'conversation_created')
//     Server has acknowledged this conversation. false only in the
//     optimistic stub between createConversation() and server confirmation.
//     Drives: input gating ("Waiting for claude...").
//
// Broadcast sequence on normal completion:
//   1. message_complete  → server sets isStreaming=false, broadcasts status
//   2. process close     → server sets isRunning=false, broadcasts status
//   3. queue_updated     → client mirrors updated queue
//   4. processQueue()    → server spawns next message if queued
//
// MESSAGE AUTHORITY MODEL
// =======================
// Claude conversations: JSONL is authoritative (Claude CLI writes its own file).
//   The server relays streaming content but the poller's JSONL-parsed messages
//   are the canonical version. conversations_updated correctly replaces client state.
//
// Codex conversations: Server memory is authoritative while a turn is active.
//   The server builds messages from streaming stdout, while Codex CLI also
//   self-persists native session files under ~/.codex/sessions.
//   The poller skips active session IDs and rehydrates idle/reloaded sessions
//   from persisted files.
export const ConversationSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().optional(),
  messages: z.array(MessageSchema),
  isRunning: z.boolean(),
  // Server-authoritative: assistant is actively producing content.
  // true on first text_delta, false on message_complete or process close.
  // INVARIANT: !isRunning → !isStreaming (dead process can't stream).
  isStreaming: z.boolean().default(false),
  // Server has confirmed this conversation exists. Only false in the client's
  // optimistic stub (between createConversation and conversation_created).
  // Server always sends true — it only serializes conversations it owns.
  confirmed: z.boolean().default(true),
  createdAt: z.coerce.date(),
  workingDirectory: z.string(),
  provider: ProviderSchema.default('claude'),
  model: ModelIdSchema.optional(), // Provider-specific model identifier (undefined = provider default)
  subAgents: z.array(SubAgentSchema).default([]), // Active/recent sub-agents
  queue: z.array(QueuedMessageSchema).default([]), // Server-owned message queue
  // Oompa worker detection: true if first user message started with "[oompa]".
  // Workers are hidden from main Gallery/Sidebar and shown in a dedicated Workers section.
  // Tag format: [oompa], [oompa:<swarmId>], or [oompa:<swarmId>:<workerId>]
  isWorker: z.boolean().default(false),
  // Swarm grouping: all workers from the same oompa swarm run share a swarmId.
  // Parsed from [oompa:<swarmId>:...] tag on first user message.
  swarmId: z.string().nullish(),
  // Worker identity within a swarm (e.g., "w0", "claude-0").
  // Parsed from [oompa:...:<workerId>] tag on first user message.
  workerId: z.string().nullish(),
  // Worker role within the swarm — inferred from first user message content.
  // "work" = normal task execution, "review" = code review (contains diff + VERDICT),
  // "fix" = fixing reviewer feedback (starts with "The reviewer found issues").
  // Null for non-workers or when role can't be determined.
  workerRole: z.enum(['work', 'review', 'fix']).nullish(),
  // Optional parent conversation id for provider-native spawned sub-agent threads
  // (e.g., Codex thread_spawn parent_thread_id).
  // When present, UI can render this conversation nested under its parent.
  parentConversationId: z.string().nullish(),
  // The actual model name from the CLI (e.g., "claude-sonnet-4-5-20250929").
  // More specific than `provider` which is just "claude", "codex", or "opencode".
  modelName: z.string().nullish(),
  // Debug prefix for swarm conversations — prepended to first CLI message.
  // UI sees clean user content; CLI process gets the prefix + content.
  // Stays on the object so toJSON() includes it for client rendering.
  swarmDebugPrefix: z.string().nullish(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

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

export const NewConversationMessageSchema = z.object({
  type: z.literal('new_conversation'),
  id: z.string().uuid().optional(), // Client-generated UUID for optimistic insert
  workingDirectory: z.string().optional(),
  provider: ProviderSchema.optional(), // Defaults to 'claude' when not specified
  model: ModelIdSchema.optional(), // Provider-specific model (undefined = provider default)
  swarmDebugPrefix: z.string().optional(), // Debug prefix prepended to first CLI message
});

export type NewConversationMessage = z.infer<typeof NewConversationMessageSchema>;

export const SendMessageMessageSchema = z.object({
  type: z.literal('send_message'),
  conversationId: z.string().uuid(),
  content: z.string().min(1),
});

export type SendMessageMessage = z.infer<typeof SendMessageMessageSchema>;

export const StopConversationMessageSchema = z.object({
  type: z.literal('stop_conversation'),
  conversationId: z.string().uuid(),
});

export type StopConversationMessage = z.infer<typeof StopConversationMessageSchema>;

export const DeleteConversationMessageSchema = z.object({
  type: z.literal('delete_conversation'),
  conversationId: z.string().uuid(),
});

export type DeleteConversationMessage = z.infer<typeof DeleteConversationMessageSchema>;

export const SetModelMessageSchema = z.object({
  type: z.literal('set_model'),
  conversationId: z.string().uuid(),
  model: ModelIdSchema.optional(),
});

export type SetModelMessage = z.infer<typeof SetModelMessageSchema>;

export const SetProviderMessageSchema = z.object({
  type: z.literal('set_provider'),
  conversationId: z.string().uuid(),
  provider: ProviderSchema,
});

export type SetProviderMessage = z.infer<typeof SetProviderMessageSchema>;

// Queue Messages (Client → Server)
export const QueueMessageSchema = z.object({
  type: z.literal('queue_message'),
  conversationId: z.string().uuid(),
  content: z.string().min(1),
});

export type QueueMessage = z.infer<typeof QueueMessageSchema>;

export const CancelQueuedMessageSchema = z.object({
  type: z.literal('cancel_queued_message'),
  conversationId: z.string().uuid(),
  messageId: z.string(),
});

export type CancelQueuedMessage = z.infer<typeof CancelQueuedMessageSchema>;

export const ClearQueueMessageSchema = z.object({
  type: z.literal('clear_queue'),
  conversationId: z.string().uuid(),
});

export type ClearQueueMessage = z.infer<typeof ClearQueueMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  NewConversationMessageSchema,
  SendMessageMessageSchema,
  StopConversationMessageSchema,
  DeleteConversationMessageSchema,
  SetProviderMessageSchema,
  SetModelMessageSchema,
  QueueMessageSchema,
  CancelQueuedMessageSchema,
  ClearQueueMessageSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// =============================================================================
// UI State (server-synced preferences)
// =============================================================================

export const UIStateSchema = z.object({
  activeConversationId: z.string().nullable().default(null),
  lastWorkingDirectory: z.string().nullable().default(null),
  galleryExpandedProjects: z.array(z.string()).default([]),
  galleryCollapsedProjects: z.array(z.string()).default([]),
  showTempSessions: z.boolean().default(false),
  showDoneConversations: z.boolean().default(false),
  doneConversations: z.array(z.string()).default([]),
  promotedWorkers: z.array(z.string()).default([]),
  showWorkerConversations: z.boolean().default(false),
  lastSeenMessageIndex: z.record(z.string(), z.number()).default({}),
  sidebarViewMode: z.enum(['grouped', 'list']).default('list'),
});

export type UIState = z.infer<typeof UIStateSchema>;

// =============================================================================
// Server → Client Messages
// =============================================================================

export const InitMessageSchema = z.object({
  type: z.literal('init'),
  conversations: z.array(ConversationSchema),
  defaultCwd: z.string(),
  /** True if server is still loading conversations from disk. Client should wait for conversations_updated. */
  loading: z.boolean().optional(),
  /** UI preferences synced from server (~/.agent-viewer/ui-state.json) */
  uiState: UIStateSchema.optional(),
});

export type InitMessage = z.infer<typeof InitMessageSchema>;

export const ConversationCreatedMessageSchema = z.object({
  type: z.literal('conversation_created'),
  conversation: ConversationSchema,
});

export type ConversationCreatedMessage = z.infer<typeof ConversationCreatedMessageSchema>;

export const ConversationDeletedMessageSchema = z.object({
  type: z.literal('conversation_deleted'),
  conversationId: z.string().uuid(),
});

export type ConversationDeletedMessage = z.infer<typeof ConversationDeletedMessageSchema>;

export const MessageMessageSchema = z.object({
  type: z.literal('message'),
  conversationId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});

export type MessageMessage = z.infer<typeof MessageMessageSchema>;

export const ChunkMessageSchema = z.object({
  type: z.literal('chunk'),
  conversationId: z.string().uuid(),
  text: z.string(),
});

export type ChunkMessage = z.infer<typeof ChunkMessageSchema>;

export const MessageCompleteMessageSchema = z.object({
  type: z.literal('message_complete'),
  conversationId: z.string().uuid(),
  reason: z.enum(['success', 'error', 'out_of_tokens', 'killed']).optional(),
});

export type MessageCompleteMessage = z.infer<typeof MessageCompleteMessageSchema>;

export const SessionBoundMessageSchema = z.object({
  type: z.literal('session_bound'),
  conversationId: z.string().uuid(),
  sessionId: z.string(),
});

export type SessionBoundMessage = z.infer<typeof SessionBoundMessageSchema>;

export const StatusMessageSchema = z.object({
  type: z.literal('status'),
  conversationId: z.string().uuid(),
  isRunning: z.boolean(),
  isStreaming: z.boolean(),
});

export type StatusMessage = z.infer<typeof StatusMessageSchema>;

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
});

export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

// Sub-Agent Messages (Server -> Client)
export const SubAgentStartMessageSchema = z.object({
  type: z.literal('subagent_start'),
  conversationId: z.string().uuid(),
  subAgent: SubAgentSchema,
});

export type SubAgentStartMessage = z.infer<typeof SubAgentStartMessageSchema>;

export const SubAgentUpdateMessageSchema = z.object({
  type: z.literal('subagent_update'),
  conversationId: z.string().uuid(),
  subAgentId: z.string(),
  toolUses: z.number().int().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
  currentAction: z.string().optional(),
  status: SubAgentStatusSchema.optional(),
});

export type SubAgentUpdateMessage = z.infer<typeof SubAgentUpdateMessageSchema>;

export const SubAgentCompleteMessageSchema = z.object({
  type: z.literal('subagent_complete'),
  conversationId: z.string().uuid(),
  subAgentId: z.string(),
  status: z.enum(['completed', 'error']),
  completedAt: z.coerce.date(),
});

export type SubAgentCompleteMessage = z.infer<typeof SubAgentCompleteMessageSchema>;

// Queue update broadcast (Server → Client)
export const QueueUpdatedMessageSchema = z.object({
  type: z.literal('queue_updated'),
  conversationId: z.string().uuid(),
  queue: z.array(QueuedMessageSchema),
});

export type QueueUpdatedMessage = z.infer<typeof QueueUpdatedMessageSchema>;

// File polling: server detected external changes to JSONL files
export const ConversationsUpdatedMessageSchema = z.object({
  type: z.literal('conversations_updated'),
  conversations: z.array(ConversationSchema),
});

export type ConversationsUpdatedMessage = z.infer<typeof ConversationsUpdatedMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  InitMessageSchema,
  ConversationCreatedMessageSchema,
  ConversationDeletedMessageSchema,
  MessageMessageSchema,
  ChunkMessageSchema,
  MessageCompleteMessageSchema,
  SessionBoundMessageSchema,
  StatusMessageSchema,
  ErrorMessageSchema,
  SubAgentStartMessageSchema,
  SubAgentUpdateMessageSchema,
  SubAgentCompleteMessageSchema,
  ConversationsUpdatedMessageSchema,
  QueueUpdatedMessageSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Parse and validate a client message. Throws ZodError if invalid.
 */
export function parseClientMessage(data: unknown): ClientMessage {
  return ClientMessageSchema.parse(data);
}

/**
 * Safely parse a client message. Returns success/error result.
 */
export function safeParseClientMessage(data: unknown) {
  return ClientMessageSchema.safeParse(data);
}

/**
 * Parse and validate a server message. Throws ZodError if invalid.
 */
export function parseServerMessage(data: unknown): ServerMessage {
  return ServerMessageSchema.parse(data);
}

/**
 * Safely parse a server message. Returns success/error result.
 */
export function safeParseServerMessage(data: unknown) {
  return ServerMessageSchema.safeParse(data);
}

// =============================================================================
// Type Guards (for backwards compatibility)
// =============================================================================

export function isClientMessage(msg: unknown): msg is ClientMessage {
  return ClientMessageSchema.safeParse(msg).success;
}

export function isServerMessage(msg: unknown): msg is ServerMessage {
  return ServerMessageSchema.safeParse(msg).success;
}

// =============================================================================
// JSONL Adapter Types (for persistence layer)
// =============================================================================

export {
  // Content block types
  JsonlTextBlockSchema,
  JsonlThinkingBlockSchema,
  JsonlToolUseBlockSchema,
  JsonlToolResultBlockSchema,
  JsonlContentBlockSchema,
  type JsonlTextBlock,
  type JsonlThinkingBlock,
  type JsonlToolUseBlock,
  type JsonlToolResultBlock,
  type JsonlContentBlock,
  // Entry types
  JsonlUserEntrySchema,
  JsonlAssistantEntrySchema,
  JsonlProgressEntrySchema,
  JsonlSystemEntrySchema,
  JsonlFileHistorySnapshotEntrySchema,
  JsonlQueueOperationEntrySchema,
  JsonlEntrySchema,
  type JsonlUserEntry,
  type JsonlAssistantEntry,
  type JsonlProgressEntry,
  type JsonlSystemEntry,
  type JsonlFileHistorySnapshotEntry,
  type JsonlQueueOperationEntry,
  type JsonlEntry,
  type JsonlSession,
  // Type guards
  isJsonlUserEntry,
  isJsonlAssistantEntry,
  isJsonlTextBlock,
  isJsonlThinkingBlock,
  isJsonlToolUseBlock,
  isJsonlToolResultBlock,
} from './adapters/jsonl.types.js';

// Oompa raw JSON file types (auto-generated from oompa_loompas schemas)
export type {
  OompaCycle,
  OompaReviewLog,
  OompaStarted,
  OompaStopped,
} from './generated/oompa-types.js';

// Codex Native Session Types (for reading ~/.codex/sessions/)
export {
  // Schemas
  CodexSessionMetaSchema,
  CodexResponseMessageSchema,
  CodexFunctionCallSchema,
  CodexFunctionCallOutputSchema,
  CodexUserMessageEventSchema,
  CodexAgentMessageEventSchema,
  CodexTurnContextSchema,
  CodexSessionEntrySchema,
  // Types
  type CodexSessionMeta,
  type CodexResponseMessage,
  type CodexFunctionCall,
  type CodexFunctionCallOutput,
  type CodexUserMessageEvent,
  type CodexAgentMessageEvent,
  type CodexTurnContext,
  type CodexSessionEntry,
  type CodexParsedSession,
  // Type guards
  isCodexSessionMeta,
  isCodexResponseMessage,
  isCodexFunctionCall,
  isCodexFunctionCallOutput,
  isCodexUserMessageEvent,
  isCodexAgentMessageEvent,
} from './adapters/codex-session.types.js';
