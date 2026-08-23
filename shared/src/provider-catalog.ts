import { z } from 'zod';

/**
 * Stable provider identity. Provider-native model and effort values deliberately
 * remain opaque strings and are validated against a ProviderCatalog.
 */
export const ProviderSchema = z.enum(['claude', 'codex', 'opencode', 'gemini', 'cursor', 'muse']);
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
  cursor: { label: 'Cursor', shortLabel: 'Cu', cssClass: 'cursor' },
  muse: { label: 'Muse', shortLabel: 'M', cssClass: 'muse' },
};

export const PROVIDER_OPTIONS: readonly ProviderMetadata[] = ProviderSchema.options.map((id) => ({
  id,
  ...PROVIDER_METADATA[id],
}));

export const PROVIDER_IDS: readonly Provider[] = ProviderSchema.options;

/**
 * Default provider when no explicit selection exists.
 * Single source for client draft defaults and server fallbacks.
 * Keep aligned with shared/src/conversation-config.ts createDefaultConversationConfig()
 * and server catalog-service.
 */
export const DEFAULT_PROVIDER: Provider = 'claude';

export const getProviderMetadata = (provider: Provider): ProviderMetadata => ({
  id: provider,
  ...PROVIDER_METADATA[provider],
});

export const ModelDefinitionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  reasoning: z
    .object({
      levels: z.array(z.string().min(1)),
      defaultEffort: z.string().min(1).optional(),
    })
    .optional(),
});
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;

export const ProviderCatalogEntrySchema = z.object({
  id: ProviderSchema,
  displayName: z.string().min(1),
  shortName: z.string().min(1),
  models: z.array(ModelDefinitionSchema),
  defaultModelId: z.string().min(1),
  supportsDynamicModels: z.boolean().default(false),
  // Buddy conversations require an MCP harness that fails closed when its
  // state-authority server cannot initialize. This capability is generated
  // from the harness registry, so profile UIs never maintain a second provider
  // allowlist. See agent_notes/2026-08-24_automation-execution-ownership-design.md.
  supportsRequiredMcp: z.boolean().default(false),
});
export type ProviderCatalogEntry = z.infer<typeof ProviderCatalogEntrySchema>;

/**
 * Relational catalog invariants live at the catalog boundary instead of being
 * repeated by consumers. A successfully parsed catalog is safe to index and
 * resolve without defensive guesses.
 */
export const ProviderCatalogSchema = z
  .object({
    revision: z.string().min(1),
    providers: z.array(ProviderCatalogEntrySchema),
  })
  .superRefine((catalog, context) => {
    const providerIds = new Set<Provider>();

    catalog.providers.forEach((provider, providerIndex) => {
      if (providerIds.has(provider.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', providerIndex, 'id'],
          message: `Duplicate provider id: ${provider.id}`,
        });
      }
      providerIds.add(provider.id);

      const modelIds = new Set<string>();
      provider.models.forEach((model, modelIndex) => {
        if (modelIds.has(model.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providers', providerIndex, 'models', modelIndex, 'id'],
            message: `Duplicate model id for ${provider.id}: ${model.id}`,
          });
        }
        modelIds.add(model.id);

        const levels = model.reasoning?.levels ?? [];
        const uniqueLevels = new Set(levels);
        if (uniqueLevels.size !== levels.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providers', providerIndex, 'models', modelIndex, 'reasoning', 'levels'],
            message: `Duplicate reasoning level for ${provider.id}/${model.id}`,
          });
        }

        const defaultEffort = model.reasoning?.defaultEffort;
        if (defaultEffort !== undefined && !uniqueLevels.has(defaultEffort)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providers', providerIndex, 'models', modelIndex, 'reasoning', 'defaultEffort'],
            message: `Default reasoning effort must be one of the model's levels`,
          });
        }
      });

      if (!modelIds.has(provider.defaultModelId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', providerIndex, 'defaultModelId'],
          message: `Default model does not exist in ${provider.id}'s model list`,
        });
      }
    });
  });
export type ProviderCatalog = z.infer<typeof ProviderCatalogSchema>;

export function findProviderCatalogEntry(
  catalog: ProviderCatalog,
  provider: Provider
): ProviderCatalogEntry | undefined {
  return catalog.providers.find((entry) => entry.id === provider);
}

export function findModelDefinition(
  entry: ProviderCatalogEntry,
  modelId: string
): ModelDefinition | undefined {
  return entry.models.find((model) => model.id === modelId);
}
