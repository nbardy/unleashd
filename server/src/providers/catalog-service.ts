import crypto from 'node:crypto';
import { harnessMcpCapability } from '@nbardy/agent-cli';
import type {
  ConfigResolution,
  ConversationConfig,
  Provider,
  ProviderCatalog,
  ProviderCatalogEntry,
} from '@unleashd/shared';
import {
  ProviderCatalogSchema,
  ProviderSchema,
  catalogEntryForProvider,
  getProviderMetadata,
  isModelIdValidForProvider,
  resolveConversationConfig,
} from '@unleashd/shared';

function catalogRevision(entries: readonly ProviderCatalogEntry[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16);
}

function buildProviderEntry(provider: Provider): ProviderCatalogEntry {
  const metadata = getProviderMetadata(provider);
  const entry = catalogEntryForProvider(provider);
  return {
    id: provider,
    displayName: metadata.label,
    shortName: metadata.shortLabel,
    defaultModelId: entry.defaultModelId,
    supportsDynamicModels: entry.supportsDynamicModels,
    supportsRequiredMcp: harnessMcpCapability(provider) === 'required',
    models: entry.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      ...(model.reasoning === undefined
        ? {}
        : {
            reasoning: {
              levels: [...model.reasoning.levels],
              ...(model.reasoning.defaultEffort === undefined
                ? {}
                : { defaultEffort: model.reasoning.defaultEffort }),
            },
          }),
    })),
  };
}

function buildProviderCatalog(): ProviderCatalog {
  const entries = ProviderSchema.options.map(buildProviderEntry);
  return ProviderCatalogSchema.parse({
    revision: catalogRevision(entries),
    providers: entries,
  });
}

let cachedCatalog: ProviderCatalog | undefined;

/**
 * Returns the current provider capabilities snapshot. Provider discovery is
 * centralized here so config resolution and API consumers always observe the
 * same revision.
 */
export function createProviderCatalog(): ProviderCatalog {
  cachedCatalog ??= buildProviderCatalog();
  return cachedCatalog;
}

/**
 * Dynamic providers keep opaque IDs off the closed dropdown catalog. For
 * validation/resolution, add a request-local model definition after the
 * provider adapter accepts the ID. The shared resolver stays pure.
 */
function catalogForConfig(catalog: ProviderCatalog, config: ConversationConfig): ProviderCatalog {
  if (config.model.mode !== 'explicit') return catalog;
  const modelId = config.model.modelId;
  const entry = catalog.providers.find((provider) => provider.id === config.provider);
  if (!entry?.supportsDynamicModels) return catalog;
  if (entry.models.some((model) => model.id === modelId)) return catalog;
  if (!isModelIdValidForProvider(config.provider, modelId)) return catalog;

  return {
    ...catalog,
    providers: catalog.providers.map((provider) =>
      provider.id === config.provider
        ? {
            ...provider,
            models: [
              ...provider.models,
              {
                id: modelId,
                displayName: modelId,
              },
            ],
          }
        : provider
    ),
  };
}

export function resolveConfigAgainstProviderCatalog(
  config: ConversationConfig,
  lastResolved?: Extract<ConfigResolution, { status: 'resolved' }>['value']
): ConfigResolution {
  const catalog = createProviderCatalog();
  return resolveConversationConfig(config, catalogForConfig(catalog, config), lastResolved);
}
