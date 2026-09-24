import { z } from 'zod';
import { BuddyKnowledgeScopeSchema } from './buddy-knowledge-scope.js';
import {
  type Provider,
  type ProviderCatalog,
  ProviderSchema,
  findModelDefinition,
  findProviderCatalogEntry,
} from './provider-catalog.js';

export const ModelIdSchema = z.string().min(1);
export type ModelId = z.infer<typeof ModelIdSchema>;

export const ReasoningEffortSchema = z.string().min(1);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const ModelSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('default') }),
  z.object({ mode: z.literal('explicit'), modelId: ModelIdSchema }),
]);
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;

export const ReasoningSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('default') }),
  z.object({ mode: z.literal('disabled') }),
  z.object({ mode: z.literal('explicit'), effort: ReasoningEffortSchema }),
]);
export type ReasoningSelection = z.infer<typeof ReasoningSelectionSchema>;

export const ConversationConfigSchema = z.object({
  provider: ProviderSchema,
  model: ModelSelectionSchema,
  reasoning: ReasoningSelectionSchema,
});
export type ConversationConfig = z.infer<typeof ConversationConfigSchema>;

export const ConversationConfigPatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('replace'), config: ConversationConfigSchema }),
  z.object({ kind: z.literal('set_provider'), provider: ProviderSchema }),
  z.object({ kind: z.literal('set_model'), model: ModelSelectionSchema }),
  z.object({
    kind: z.literal('set_reasoning'),
    reasoning: ReasoningSelectionSchema,
  }),
]);
export type ConversationConfigPatch = z.infer<typeof ConversationConfigPatchSchema>;

export const ResolvedExecutionConfigSchema = z.object({
  provider: ProviderSchema,
  modelId: ModelIdSchema,
  reasoningEffort: ReasoningEffortSchema.optional(),
});
export type ResolvedExecutionConfig = z.infer<typeof ResolvedExecutionConfigSchema>;

export const ConfigErrorCodeSchema = z.enum([
  'provider_unavailable',
  'model_unavailable',
  'reasoning_unsupported',
  'reasoning_unavailable',
  'provider_locked',
  'conversation_busy',
  'revision_conflict',
]);
export type ConfigErrorCode = z.infer<typeof ConfigErrorCodeSchema>;

export const ConfigErrorSchema = z.object({
  code: ConfigErrorCodeSchema,
  message: z.string().min(1),
  provider: ProviderSchema.optional(),
  modelId: ModelIdSchema.optional(),
  validValues: z.array(z.string()).optional(),
});
export type ConfigError = z.infer<typeof ConfigErrorSchema>;

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ConfigResolutionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('resolved'),
    catalogRevision: z.string().min(1),
    value: ResolvedExecutionConfigSchema,
  }),
  z.object({
    status: z.literal('unavailable'),
    catalogRevision: z.string().min(1),
    error: ConfigErrorSchema,
    lastResolved: ResolvedExecutionConfigSchema.optional(),
  }),
]);
export type ConfigResolution = z.infer<typeof ConfigResolutionSchema>;

export const RuntimeObservationSchema = z.object({
  reportedModel: z.string().min(1).optional(),
  providerSessionId: z.string().min(1).optional(),
});
export type RuntimeObservation = z.infer<typeof RuntimeObservationSchema>;

export const ConversationConfigStateSchema = z.object({
  config: ConversationConfigSchema,
  revision: z.number().int().nonnegative(),
  resolution: ConfigResolutionSchema,
});
export type ConversationConfigState = z.infer<typeof ConversationConfigStateSchema>;

/**
 * Provider-counted tokens for the most recent request on a session. This is
 * measured truth from the harness, NOT our chars/4 estimate: `contextTokens`
 * is the total input the provider actually counted, so a provider-side
 * compaction makes it DROP rather than climb.
 *
 * Each harness reports under a different convention; agent-cli canonicalises
 * them in its parsers (claude sums input + cache_read + cache_creation, codex
 * reports input_tokens alone with cache already inside it). Consumers here see
 * one shape and must not re-derive it.
 *
 * `contextWindow` is present only when the harness reports one (codex does;
 * claude does not). Absent means "ask the model id", not "unknown".
 */
export const ProviderTurnUsageSchema = z.object({
  contextTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  contextWindow: z.number().int().positive().optional(),
  observedAt: z.string().datetime(),
});
export type ProviderTurnUsage = z.infer<typeof ProviderTurnUsageSchema>;

export const ConversationSessionBindingSchema = z.object({
  provider: ProviderSchema,
  sessionId: z.string().min(1),
  // Host-verified disclosure audience for this exact native session. Legacy
  // bindings without it must establish a fresh Buddy context before reuse.
  buddyAudienceKey: z.string().min(1).optional(),
  // Last provider-counted usage seen on THIS session, so the context meter
  // survives a server reload without re-parsing the transcript. Bound to the
  // session rather than the conversation because a session rotation starts a
  // fresh provider context; carrying the old number forward would overstate it.
  latestUsage: ProviderTurnUsageSchema.optional(),
});
export type ConversationSessionBinding = z.infer<typeof ConversationSessionBindingSchema>;

export const ConversationLifecycleStatusSchema = z.enum(['active', 'deleted']);
export type ConversationLifecycleStatus = z.infer<typeof ConversationLifecycleStatusSchema>;

// Conversation IDs are opaque: Buddy runs use deterministic prefixed IDs and
// older provider imports can be non-UUIDs. Use the same contract on disk and
// across the wire; config-store encodes IDs before using them as file names.
export const ConversationIdSchema = z.string().min(1);

export const BuddyContextSchema = z.object({
  knowledgeScope: BuddyKnowledgeScopeSchema.optional(),
  coordinationRunId: z.string().min(1).nullish(),
  buddyId: z.string().min(1),
  workspaceId: z.string().min(1),
  buddyProjectId: z.string().min(1).nullish(),
  legacyWorkItemId: z.string().min(1).nullish(),
  automationRunId: z.string().min(1).nullish(),
  // Set only for Buddy-to-Buddy work. This is employee delegation metadata,
  // not a provider-native subagent/swarm relationship.
  delegatedByBuddyId: z.string().min(1).nullish(),
  parentBuddyConversationId: ConversationIdSchema.nullish(),
  // Delegated conversations can expose only the Buddy state operations
  // required by the assignment. Provider-native tools are unaffected.
  allowedBuddyOperations: z.array(z.string().min(1)).min(1).optional(),
});
export type BuddyContext = z.infer<typeof BuddyContextSchema>;

export const ConversationPurposeSchema = z.enum(['general', 'buddy_builder']);
export type ConversationPurpose = z.infer<typeof ConversationPurposeSchema>;

export const ConversationPlacementSchema = z.enum(['default', 'background']);
export type ConversationPlacement = z.infer<typeof ConversationPlacementSchema>;

export const ConversationBranchSchema = z.object({
  sourceConversationId: ConversationIdSchema,
  throughMessageId: z.string().min(1),
  audience: BuddyKnowledgeScopeSchema,
  handoff: z.string().max(64000),
  launches: z.record(z.string(), z.string().max(64000)).optional(),
});
export type ConversationBranch = z.infer<typeof ConversationBranchSchema>;

export const ConversationCreationMetadataSchema = z.object({
  branch: ConversationBranchSchema.optional(),
  commandId: z.string().min(1).optional(),
  fingerprint: z.string().min(1).optional(),
  placement: ConversationPlacementSchema.optional(),
  initialMessage: z.string().min(1).optional(),
  initialMessageDispatchClaimedAt: z.string().datetime().optional(),
  initialMessageDispatchClaimToken: z.string().min(1).optional(),
  initialMessageDispatchedAt: z.string().datetime().optional(),
  swarmDebugPrefix: z.string().optional(),
  resumedFromConversationId: ConversationIdSchema.optional(),
  buddyContext: BuddyContextSchema.optional(),
  purpose: ConversationPurposeSchema.optional(),
});
export type ConversationCreationMetadata = z.infer<typeof ConversationCreationMetadataSchema>;

export const PersistedConversationConfigRecordSchema = z.object({
  version: z.literal(1),
  conversationId: ConversationIdSchema,
  // Historical aliases remain indexed for transcript discovery. The session to
  // resume is stored separately so rotation never depends on array ordering.
  sessionBindings: z.array(ConversationSessionBindingSchema),
  currentSession: ConversationSessionBindingSchema.optional(),
  status: ConversationLifecycleStatusSchema.default('active'),
  // Owner marked this conversation done: hidden from working lists, still
  // loaded and resumable. It lives here, keyed by the stable conversationId,
  // because the retired client-synced list keyed hides by provider sessionId,
  // which the server rotates (session.started, reset, resume) — every rotation
  // silently un-hid the conversation. Absent on older records = never marked.
  done: z.boolean().default(false),
  workingDirectory: z.string().min(1).optional(),
  creation: ConversationCreationMetadataSchema.optional(),
  deletedAt: z.string().datetime().optional(),
  config: ConversationConfigSchema,
  // Internal persistence CAS token. Unlike configRevision, this advances for
  // lifecycle, session, and delivery-marker writes too.
  recordRevision: z.number().int().nonnegative().default(0),
  configRevision: z.number().int().nonnegative(),
  lastResolvedConfig: ResolvedExecutionConfigSchema.optional(),
  provenance: z.enum(['user', 'legacy_inferred', 'external_discovered']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PersistedConversationConfigRecord = z.infer<
  typeof PersistedConversationConfigRecordSchema
>;

export function createDefaultConversationConfig(provider: Provider = 'claude'): ConversationConfig {
  return {
    provider,
    model: { mode: 'default' },
    reasoning: { mode: 'default' },
  };
}

/**
 * Applies selection intent only. Relational validation and resolution are a
 * separate step so hydration can retain explicit values retired by a catalog.
 */
export function applyConversationConfigPatch(
  current: ConversationConfig,
  patch: ConversationConfigPatch
): ConversationConfig {
  switch (patch.kind) {
    case 'replace':
      return patch.config;
    case 'set_provider':
      return {
        provider: patch.provider,
        model: { mode: 'default' },
        reasoning: { mode: 'default' },
      };
    case 'set_model':
      return { ...current, model: patch.model };
    case 'set_reasoning':
      return { ...current, reasoning: patch.reasoning };
  }
}

function unavailable(
  catalogRevision: string,
  error: ConfigError,
  lastResolved?: ResolvedExecutionConfig
): ConfigResolution {
  return {
    status: 'unavailable',
    catalogRevision,
    error,
    ...(lastResolved ? { lastResolved } : {}),
  };
}

/**
 * Resolves durable selection intent into provider-native execution strings.
 * No value is translated or silently substituted.
 */
export function resolveConversationConfig(
  config: ConversationConfig,
  catalog: ProviderCatalog,
  lastResolved?: ResolvedExecutionConfig
): ConfigResolution {
  const provider = findProviderCatalogEntry(catalog, config.provider);
  if (!provider) {
    return unavailable(
      catalog.revision,
      {
        code: 'provider_unavailable',
        message: `Provider is unavailable: ${config.provider}`,
        provider: config.provider,
      },
      lastResolved
    );
  }

  const modelId = config.model.mode === 'default' ? provider.defaultModelId : config.model.modelId;
  const model = findModelDefinition(provider, modelId);
  if (!model) {
    return unavailable(
      catalog.revision,
      {
        code: 'model_unavailable',
        message: `Model is unavailable for ${config.provider}: ${modelId}`,
        provider: config.provider,
        modelId,
        validValues: provider.models.map((candidate) => candidate.id),
      },
      lastResolved
    );
  }

  let reasoningEffort: string | undefined;
  if (config.reasoning.mode === 'explicit') {
    if (!model.reasoning) {
      return unavailable(
        catalog.revision,
        {
          code: 'reasoning_unsupported',
          message: `Reasoning is not supported by ${config.provider}/${modelId}`,
          provider: config.provider,
          modelId,
        },
        lastResolved
      );
    }
    if (!model.reasoning.levels.includes(config.reasoning.effort)) {
      return unavailable(
        catalog.revision,
        {
          code: 'reasoning_unavailable',
          message: `Reasoning effort is unavailable for ${config.provider}/${modelId}: ${config.reasoning.effort}`,
          provider: config.provider,
          modelId,
          validValues: model.reasoning.levels,
        },
        lastResolved
      );
    }
    reasoningEffort = config.reasoning.effort;
  } else if (config.reasoning.mode === 'default') {
    reasoningEffort = model.reasoning?.defaultEffort;
  }

  return {
    status: 'resolved',
    catalogRevision: catalog.revision,
    value: {
      provider: config.provider,
      modelId,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    },
  };
}

export function validateConversationConfig(
  config: ConversationConfig,
  catalog: ProviderCatalog
): Result<ResolvedExecutionConfig, ConfigError> {
  const resolution = resolveConversationConfig(config, catalog);
  return resolution.status === 'resolved'
    ? { ok: true, value: resolution.value }
    : { ok: false, error: resolution.error };
}

/**
 * Atomic pure transition for creation/update paths. If the candidate cannot
 * resolve, the caller keeps `current` unchanged.
 */
export function transitionConversationConfig(
  current: ConversationConfig,
  patch: ConversationConfigPatch,
  catalog: ProviderCatalog
): Result<ConversationConfig, ConfigError> {
  const candidate = applyConversationConfigPatch(current, patch);
  const validation = validateConversationConfig(candidate, catalog);
  return validation.ok ? { ok: true, value: candidate } : validation;
}
