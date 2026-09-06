/**
 * Shared Zod schemas and TypeScript types for Claude Multi-Chat
 * Used by both client and server for type-safe WebSocket communication
 *
 * Pattern: Define Zod schema, then infer TypeScript type from it.
 * This gives us runtime validation + compile-time types from a single source.
 */

import { z } from 'zod';
import {
  BuddyContextSchema,
  ConfigErrorSchema,
  ConfigResolutionSchema,
  ConversationConfigPatchSchema,
  ConversationConfigSchema,
  ConversationPurposeSchema,
  ModelIdSchema,
} from './conversation-config.js';
import { ConversationKindSchema } from './conversation-kind.js';
import {
  decodeLegacyCodexCompositeModel,
  encodeLegacyCodexCompositeModel,
} from './legacy/codex-composite-model.js';
import {
  PROVIDER_IDS,
  PROVIDER_METADATA,
  PROVIDER_OPTIONS,
  type Provider,
  type ProviderMetadata,
  ProviderSchema,
  getProviderMetadata,
} from './provider-catalog.js';

export * from './conversation-config.js';
export * from './conversation-kind.js';
export * from './buddy.js';
export * from './provider-catalog.js';
export * from './legacy/codex-composite-model.js';
export { stripJsonc } from './utils/jsonc.js';

// =============================================================================
// Core Data Structures
// =============================================================================

export {
  ProviderSchema,
  type Provider,
  type ProviderMetadata,
  PROVIDER_METADATA,
  PROVIDER_OPTIONS,
  PROVIDER_IDS,
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
//   Conversation (Conversation.reasoningEffort), mirroring Claude. Composite IDs
//   (e.g. "gpt-5.4-high") are a legacy wire format that survives only as a
//   display/migration helper via toCodexModelId/fromCodexModelId.
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
  CLAUDE_MODEL_IDS as GEN_CLAUDE_MODEL_IDS,
  GEMINI_MODEL_IDS as GEN_GEMINI_MODEL_IDS,
  MUSE_MODEL_IDS as GEN_MUSE_MODEL_IDS,
  CURSOR_MODEL_REGISTRY as GEN_CURSOR_MODEL_REGISTRY,
  CODEX_MODEL_REGISTRY as GEN_CODEX_MODEL_REGISTRY,
  CLAUDE_EFFORT_LEVELS as GEN_CLAUDE_EFFORT_LEVELS,
  CODEX_EFFORT_LEVELS as GEN_CODEX_EFFORT_LEVELS,
  MUSE_EFFORT_LEVELS as GEN_MUSE_EFFORT_LEVELS,
  CODEX_THINKING_OPTIONS as GEN_CODEX_THINKING_OPTIONS,
  NO_CODEX_THINKING as GEN_NO_CODEX_THINKING,
  CODEX_UNIFIED_THINKING_OPTIONS as GEN_CODEX_UNIFIED_THINKING_OPTIONS,
} from './generated/catalog.js';

// Re-export generated arrays so consumers can import from shared entry point
export const CLAUDE_EFFORT_LEVELS = GEN_CLAUDE_EFFORT_LEVELS;
export const CODEX_EFFORT_LEVELS = GEN_CODEX_EFFORT_LEVELS;
export const MUSE_EFFORT_LEVELS = GEN_MUSE_EFFORT_LEVELS;
export const CODEX_THINKING_OPTIONS = GEN_CODEX_THINKING_OPTIONS;
export const NO_CODEX_THINKING = GEN_NO_CODEX_THINKING;
export const CODEX_UNIFIED_THINKING_OPTIONS = GEN_CODEX_UNIFIED_THINKING_OPTIONS;
export const CURSOR_MODEL_REGISTRY = GEN_CURSOR_MODEL_REGISTRY;
export const CODEX_MODEL_REGISTRY = GEN_CODEX_MODEL_REGISTRY;

export type ClaudeEffortLevel = (typeof CLAUDE_EFFORT_LEVELS)[number];
export type CodexEffortLevel = (typeof CODEX_EFFORT_LEVELS)[number];
export type MuseEffortLevel = (typeof MUSE_EFFORT_LEVELS)[number];
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
export type ClaudeModel = z.infer<typeof ClaudeModelSchema>;

export const GeminiModelSchema = z.enum(GEN_GEMINI_MODEL_IDS as unknown as [string, ...string[]]);
export type GeminiModel = z.infer<typeof GeminiModelSchema>;

export type CursorModel = (typeof CURSOR_MODEL_REGISTRY)[number]['id'];
export const CURSOR_MODEL_IDS = CURSOR_MODEL_REGISTRY.map((entry) => entry.id);
export const CursorModelSchema = z.enum(
  CURSOR_MODEL_IDS as unknown as [CursorModel, ...CursorModel[]]
);

export const MuseModelSchema = z.enum(GEN_MUSE_MODEL_IDS as unknown as [string, ...string[]]);
export type MuseModel = z.infer<typeof MuseModelSchema>;

/** Retired / shorthand ids → canonical Cursor `--model` value. */
export const CURSOR_MODEL_ALIASES: Readonly<Record<string, CursorModel>> = {
  'composer-2': 'composer-2.5',
  composer2: 'composer-2.5',
  'composer-2-fast': 'composer-2.5',
  'composer-2.5-fast': 'composer-2.5',
  'grok-4.5': 'cursor-grok-4.5-high',
};

type CodexModelRegistryItem = (typeof CODEX_MODEL_REGISTRY)[number];

// Codex model IDs are base IDs only. Reasoning effort lives on
// Conversation.reasoningEffort (same shape as Claude). Composite IDs like
// "gpt-5.4-high" are a legacy wire format handled by toCodexModelId/fromCodexModelId.
export type CodexModel = CodexModelRegistryItem['modelName'];

export const CODEX_THINKING_DISPLAY_NAMES: Record<CodexThinkingOption, string> = {
  minimal: 'Minimal Effort',
  low: 'Low Effort',
  medium: 'Medium Effort',
  high: 'High Effort',
  xhigh: 'Extra High Effort',
  max: 'Max Effort',
  ultra: 'Ultra Effort',
};

/**
 * MIGRATION HELPER for legacy composite Codex model IDs.
 *
 * Preferred path: store `model` as a base CodexModel and `reasoningEffort` as
 * a separate field on Conversation. This helper only exists for (a) decoding
 * legacy composites persisted on disk / in old in-memory state, and (b) building
 * display strings where a single combined label is still useful. The return type
 * is a plain `string` because composites are no longer valid `CodexModel` values.
 */
export function toCodexModelId(modelName: string, thinkingOption: CodexThinkingMode): string {
  return encodeLegacyCodexCompositeModel(
    modelName,
    thinkingOption === NO_CODEX_THINKING ? null : thinkingOption
  );
}

/**
 * MIGRATION HELPER: inverse of `toCodexModelId`. Decomposes a (possibly legacy)
 * composite Codex model id into its base model + optional effort suffix.
 *
 * Used by:
 *   - disk-adapter: parse legacy composite `session.model` strings
 *   - server spawn path: self-heal in-memory conversations that still hold a
 *     composite `conv.model` from the pre-refactor wire contract
 *   - client display: recover base+effort from a composite for split dropdowns
 *
 * Matching strategy: try the longest known base-model prefix first, then check
 * for a known effort suffix. This disambiguates base names that themselves
 * contain hyphens (e.g. `gpt-5.3-codex-spark` vs. `gpt-5.3-codex-spark-high`).
 *
 * Unknown composites pass through as `{ baseModel: modelId, effort: null }`
 * (NO silent defaulting of the effort — unknown means unknown).
 */
export function fromCodexModelId(modelId: string): {
  baseModel: string;
  effort: string | null;
} {
  return decodeLegacyCodexCompositeModel(modelId, {
    modelIds: CODEX_MODEL_REGISTRY.map((entry) => entry.modelName),
    effortLevels: CODEX_EFFORT_LEVELS,
  });
}

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
const DEFAULT_CODEX_MODELS = CODEX_MODEL_INFOS.filter((model) => model.isDefault);
if (DEFAULT_CODEX_MODELS.length !== 1) {
  throw new Error(`Expected exactly one default Codex model, found ${DEFAULT_CODEX_MODELS.length}`);
}

export const DEFAULT_CODEX_MODEL_ID: CodexModel = DEFAULT_CODEX_MODELS[0].id;
export const CodexModelSchema = z.custom<CodexModel>(
  (value): value is CodexModel => typeof value === 'string' && CODEX_MODEL_ID_SET.has(value),
  {
    message: `Invalid Codex model identifier. Expected one of: ${CODEX_MODEL_IDS.join(', ')}`,
  }
);

/**
 * Canonical server-side default for provider reasoning flags.
 * Codex defaults are model-specific; an absent/unknown model uses the registry default.
 * `none` is represented as undefined throughout Conversation state.
 */
export function defaultReasoningEffortForProvider(
  provider: Provider,
  model?: string
): string | undefined {
  if (provider === 'claude' || provider === 'muse') return 'high';
  if (provider !== 'codex') return undefined;

  const entry: CodexModelRegistryEntry =
    CODEX_MODEL_REGISTRY.find((candidate) => candidate.modelName === model) ??
    CODEX_MODEL_REGISTRY.find((candidate) => candidate.isDefault) ??
    CODEX_MODEL_REGISTRY[0];
  const defaultOption = entry.defaultThinkingOption ?? NO_CODEX_THINKING;
  return defaultOption === NO_CODEX_THINKING ? undefined : defaultOption;
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

export function modelValidationHint(provider: Provider): string {
  switch (provider) {
    case 'claude':
      return `one of: ${ClaudeModelSchema.options.map((id) => `'${id}'`).join(', ')}`;
    case 'codex':
      return `one of: ${CODEX_MODEL_IDS.map((id) => `'${id}'`).join(', ')}`;
    case 'gemini':
      return `one of: ${GeminiModelSchema.options.map((id) => `'${id}'`).join(', ')}`;
    case 'opencode':
      return "'provider/model' format (e.g. 'opencode/big-pickle')";
    case 'cursor':
      return `one of: ${CURSOR_MODEL_IDS.map((id) => `'${id}'`).join(', ')}`;
    case 'muse':
      return `one of: ${MuseModelSchema.options.map((id) => `'${id}'`).join(', ')}`;
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

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
  completionReason: z.enum(['success', 'error', 'out_of_tokens', 'killed']).optional(),
});

export type Message = z.infer<typeof MessageSchema>;

// =============================================================================
// Sub-Agent Types (for Task tool detection)
// =============================================================================

export const SubAgentStatusSchema = z.enum(['pending', 'running', 'completed', 'error']);
export type SubAgentStatus = z.infer<typeof SubAgentStatusSchema>;

export const SubAgentStatusSourceSchema = z.enum([
  'native',
  'inferred_parent_completion',
  'recovered_from_disk',
]);
export type SubAgentStatusSource = z.infer<typeof SubAgentStatusSourceSchema>;

export const SubAgentSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: SubAgentStatusSchema,
  toolUses: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  currentAction: z.string().optional(), // e.g., "Write: client/src/App.css"
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
  providerThreadId: z.string().optional(),
  rawStatus: z.string().optional(),
  statusSource: SubAgentStatusSourceSchema.optional(),
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

// Display labels for the union of every level any provider accepts. Keyed by
// plain string since the wire shape is string, not a typed enum.
export const EFFORT_DISPLAY_NAMES: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'xHigh',
  max: 'Max',
  ultra: 'Ultra',
};

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().optional(),
  messages: z.array(MessageSchema),
  // Full snapshots set this to messages.length. Summary snapshots keep only
  // the last preview message while preserving the authoritative total.
  messageCount: z.number().int().nonnegative().optional(),
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
  // Standalone reasoning level for providers that expose it (claude + codex).
  // Pass-through string: value is whatever the target CLI accepts (see
  // CLAUDE_EFFORT_LEVELS / CODEX_EFFORT_LEVELS). Other providers leave it undefined.
  reasoningEffort: z.string().optional(),
  // Canonical configuration authority for every server-owned conversation.
  // Disk discoveries use DiscoveredConversation until server hydration resolves
  // provider defaults and produces this complete snapshot.
  config: ConversationConfigSchema,
  configRevision: z.number().int().nonnegative(),
  configResolution: ConfigResolutionSchema,
  // Provider-reported observation; never configuration authority.
  reportedModel: z.string().nullish(),
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
  // Optional UI lineage for Chat "Fork" (soft handoff). Points at the source
  // conversation the user forked from. This is NOT provider-session inheritance
  // and does NOT imply FORK_CAPABLE_PROVIDERS. Context handoff is the draft /
  // first-message content (historically a pasted transcript); the Resume
  // badge is UI chrome for that lineage. Contrast with merge review children,
  // which use spawnMergeReviewFork + CLI --fork / emulateFork.
  resumedFromConversationId: z.string().nullish(),
  // The actual model name from the CLI (e.g., "claude-sonnet-4-5-20250929").
  // More specific than `provider` which is just "claude", "codex", or "opencode".
  modelName: z.string().nullish(),
  // Debug prefix for swarm conversations — prepended to first CLI message.
  // UI sees clean user content; CLI process gets the prefix + content.
  // Stays on the object so toJSON() includes it for client rendering.
  swarmDebugPrefix: z.string().nullish(),
  // Canonical kind — holistic sum type. Single source of truth.
  // `buddyContext`/`purpose` are legacy compat only: new writes set kind
  // and mirror to legacy fields for old clients/parsers; reads derive kind
  // from legacy via `getConversationKind()` when kind is absent.
  kind: ConversationKindSchema,
  // Persistent employee ownership (deprecated in favor of kind.buddy). Kept for
  // compat; new writes mirror kind → buddyContext. Read via `getBuddyContext()` or `isBuddyConversation()`.
  buddyContext: BuddyContextSchema.nullish(),
  // Application-owned purpose (deprecated in favor of kind). `general` is implicit.
  purpose: ConversationPurposeSchema.optional(),

  // Merge feature metadata. Parent threads that aggregate review docs from
  // forked children set mergeParentMeta; forked children set mergeChildMeta.
  // Exactly one is set; both null for ordinary conversations.
  mergeParentMeta: z
    .object({
      children: z.array(
        z.object({
          sourceConversationId: z.string().uuid(),
          childConversationId: z.string().uuid(),
          reviewUuid: z.string().uuid(),
          childWorkingDirectory: z.string(),
        })
      ),
      prefixInjected: z.boolean().default(false),
    })
    .nullish(),
  mergeChildMeta: z
    .object({
      parentConversationId: z.string().uuid(),
      reviewUuid: z.string().uuid(),
    })
    .nullish(),
});

export type Conversation = z.infer<typeof ConversationSchema>;
export type DiscoveredConversation = Omit<
  Conversation,
  'id' | 'sessionId' | 'config' | 'configRevision' | 'configResolution'
> & {
  /** Opaque provider-owned identity. Never use as the application conversation ID. */
  sessionId: string;
};

// =============================================================================
// Merge feature — provider-SESSION fork capability (NOT Chat "Fork")
// =============================================================================
//
// Two different "fork" concepts in this codebase — do not conflate them:
//
// 1) Chat "Fork" button (soft handoff)
//    New conversation + resumedFromConversationId + draft/first-message
//    context (originally a pasted transcript). Cross-provider is fine because
//    nothing inherits a CLI session. Gated by nothing here. See Chat.tsx
//    handleForkThread + ResumeThreadWidget.
//
// 2) Merge review / provider-session fork (this set)
//    Child turn inherits the parent's native CLI transcript under a NEW
//    provider session id (parent untouched). Needs harness sessionForkFlags
//    (claude/opencode) or emulateFork (codex/gemini). Cursor is omitted: no
//    `--fork`, and chats are opaque sqlite / cloud-backed under
//    ~/.cursor/chats/. Used only by /api/conversations/merge +
//    spawnMergeReviewFork.
//
export const FORK_CAPABLE_PROVIDERS: ReadonlySet<Provider> = new Set<Provider>([
  'claude',
  'opencode',
  'codex',
  'gemini',
]);

/** True if this provider can do merge-style provider-session forks. Not Chat Fork. */
export function providerSupportsFork(p: Provider): boolean {
  return FORK_CAPABLE_PROVIDERS.has(p);
}

export const MergeChildStatusSchema = z.enum(['spinning', 'complete', 'error']);
export type MergeChildStatus = z.infer<typeof MergeChildStatusSchema>;

// Review prompt sent verbatim to each forked child. {UUID} is replaced by a
// per-child reviewUuid before the fork spawns.
export const MERGE_REVIEW_PROMPT = `stop, review the entire thread, report everything you've done, commit completed, work, not incomplete work, reflect on any potential bugs you've raised, any you've fixed what your key goals started as, how they evolved, which sub goals arose, which goals and sub goals are completed, and what is still pending, also report all mistakes you made, key learnings, any struggles or confusion you had, and any broader issues with the tooling or the code base.

Write ALL the above in a long over descriptive doc, then report back with
"merge_review_docs/REVIEW_DOC_{UUID}.txt"`;

export function buildMergeReviewPrompt(reviewUuid: string): string {
  return MERGE_REVIEW_PROMPT.replace('{UUID}', reviewUuid);
}

export function mergeReviewDocPath(reviewUuid: string): string {
  return `merge_review_docs/REVIEW_DOC_${reviewUuid}.txt`;
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
  conversationId: z.string().uuid(),
  workingDirectory: z.string().min(1),
  config: ConversationConfigSchema,
  initialMessage: z.string().min(1).optional(),
  swarmDebugPrefix: z.string().optional(),
  // Chat "Fork" soft-handoff lineage only — not merge provider-session fork.
  resumedFromConversationId: z.string().uuid().optional(),
  buddyContext: BuddyContextSchema.optional(),
  kind: ConversationKindSchema.optional(),
});
export type CreateConversationCommand = z.infer<typeof CreateConversationCommandSchema>;

export const SetConversationConfigCommandSchema = z.object({
  type: z.literal('set_conversation_config'),
  commandId: z.string().min(1),
  conversationId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  patch: ConversationConfigPatchSchema,
});
export type SetConversationConfigCommand = z.infer<typeof SetConversationConfigCommandSchema>;

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

// Queue Messages (Client → Server)
export const QueueMessageSchema = z.object({
  type: z.literal('queue_message'),
  commandId: z.string().min(1),
  conversationId: z.string().uuid(),
  content: z.string().min(1),
});

export type QueueMessage = z.infer<typeof QueueMessageSchema>;

export const InterruptAndSendMessageSchema = z.object({
  type: z.literal('interrupt_and_send'),
  commandId: z.string().min(1),
  conversationId: z.string().uuid(),
  content: z.string().min(1),
});

export type InterruptAndSendMessage = z.infer<typeof InterruptAndSendMessageSchema>;

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
  CreateConversationCommandSchema,
  SetConversationConfigCommandSchema,
  SendMessageMessageSchema,
  StopConversationMessageSchema,
  DeleteConversationMessageSchema,
  QueueMessageSchema,
  InterruptAndSendMessageSchema,
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

export const ProtocolInfoSchema = z.object({
  version: z.literal(2),
  capabilities: z.tuple([
    z.literal('conversation_config'),
    z.literal('conversation_updated'),
    z.literal('structured_command_errors'),
  ]),
});
export type ProtocolInfo = z.infer<typeof ProtocolInfoSchema>;

export const PROTOCOL_INFO: ProtocolInfo = {
  version: 2,
  capabilities: ['conversation_config', 'conversation_updated', 'structured_command_errors'],
};

export const InitMessageSchema = z.object({
  type: z.literal('init'),
  conversations: z.array(ConversationSchema),
  defaultCwd: z.string(),
  /** Conversations contain metadata + last-message previews, not full transcripts. */
  summaries: z.boolean().optional(),
  /** True if server is still loading conversations from disk. Client should wait for conversations_updated. */
  loading: z.boolean().optional(),
  /** UI preferences synced from server (~/.agent-viewer/ui-state.json) */
  uiState: UIStateSchema.optional(),
  protocol: ProtocolInfoSchema,
});

export type InitMessage = z.infer<typeof InitMessageSchema>;

export const ConversationCreatedEventSchema = z.object({
  type: z.literal('conversation_created'),
  commandId: z.string().min(1),
  conversation: ConversationSchema,
});
export type ConversationCreatedEvent = z.infer<typeof ConversationCreatedEventSchema>;

export const ConversationCreatedMessageSchema = ConversationCreatedEventSchema;
export type ConversationCreatedMessage = z.infer<typeof ConversationCreatedMessageSchema>;

export const ConversationUpdatedEventSchema = z.object({
  type: z.literal('conversation_updated'),
  commandId: z.string().min(1).optional(),
  reason: z.enum(['config', 'catalog', 'status', 'queue', 'messages', 'external_refresh']),
  conversation: ConversationSchema,
});
export type ConversationUpdatedEvent = z.infer<typeof ConversationUpdatedEventSchema>;

export const ConversationDeletedEventSchema = z.object({
  type: z.literal('conversation_deleted'),
  commandId: z.string().min(1).optional(),
  conversationId: z.string().uuid(),
});
export type ConversationDeletedEvent = z.infer<typeof ConversationDeletedEventSchema>;

export const ConversationDeletedMessageSchema = ConversationDeletedEventSchema;
export type ConversationDeletedMessage = z.infer<typeof ConversationDeletedMessageSchema>;

export const GeneralCommandErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
});
export type GeneralCommandError = z.infer<typeof GeneralCommandErrorSchema>;

export const CommandRejectedEventSchema = z.object({
  type: z.literal('command_rejected'),
  commandId: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  error: z.union([ConfigErrorSchema, GeneralCommandErrorSchema]),
  authoritativeConversation: ConversationSchema.optional(),
});
export type CommandRejectedEvent = z.infer<typeof CommandRejectedEventSchema>;

export const CommandAcceptedEventSchema = z.object({
  type: z.literal('command_accepted'),
  commandId: z.string().min(1),
  conversationId: z.string().uuid(),
});
export type CommandAcceptedEvent = z.infer<typeof CommandAcceptedEventSchema>;

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
  rawStatus: z.string().optional(),
  statusSource: SubAgentStatusSourceSchema.optional(),
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
  /** Conversations contain metadata + last-message previews, not full transcripts. */
  summaries: z.boolean().optional(),
});

export type ConversationsUpdatedMessage = z.infer<typeof ConversationsUpdatedMessageSchema>;

export const ConversationLoadCompleteMessageSchema = z.object({
  type: z.literal('conversation_load_complete'),
  /** Final authoritative membership after progressive startup hydration. */
  conversationIds: z.array(z.string()).optional(),
});

export type ConversationLoadCompleteMessage = z.infer<typeof ConversationLoadCompleteMessageSchema>;

export const MergeChildStatusMessageSchema = z.object({
  type: z.literal('merge_child_status'),
  parentConversationId: z.string().uuid(),
  childConversationId: z.string().uuid(),
  reviewUuid: z.string().uuid(),
  status: MergeChildStatusSchema,
  reviewDocPath: z.string().nullish(),
  errorMessage: z.string().nullish(),
});

export type MergeChildStatusMessage = z.infer<typeof MergeChildStatusMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  InitMessageSchema,
  ConversationCreatedMessageSchema,
  ConversationUpdatedEventSchema,
  ConversationDeletedMessageSchema,
  CommandAcceptedEventSchema,
  CommandRejectedEventSchema,
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
  ConversationLoadCompleteMessageSchema,
  QueueUpdatedMessageSchema,
  MergeChildStatusMessageSchema,
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
