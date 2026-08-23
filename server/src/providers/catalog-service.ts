import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  defaultReasoningEffortForProvider,
  effortLevelsForProvider,
  getProviderMetadata,
  isModelIdValidForProvider,
  resolveConversationConfig,
  stripJsonc,
} from '@unleashd/shared';
import { providers } from './index';

type FileReasoning = { levels: string[]; defaultEffort?: string };

function loadFileCatalogReasoning(): Map<string, Map<string, FileReasoning>> | null {
  const candidates: string[] = [];
  // CJS __dirname candidates
  try {
    // @ts-ignore - __dirname exists in CJS builds
    if (typeof __dirname !== 'undefined') {
      const dir = __dirname as string;
      candidates.push(join(dir, '../../vendor/agent-cli-tool/catalog.jsonc'));
      candidates.push(join(dir, '../vendor/agent-cli-tool/catalog.jsonc'));
      candidates.push(join(dir, '../../../vendor/agent-cli-tool/catalog.jsonc'));
    }
  } catch {
    // ignore
  }
  candidates.push(join(process.cwd(), 'vendor/agent-cli-tool/catalog.jsonc'));
  candidates.push(join(process.cwd(), '../agent-cli-tool/catalog.jsonc'));
  candidates.push('/Users/nicholasbardy/git/unleashd/vendor/agent-cli-tool/catalog.jsonc');
  candidates.push('/Users/nicholasbardy/git/agent-cli-tool/catalog.jsonc');

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf-8');
      const parsed = JSON.parse(stripJsonc(raw)) as {
        providers?: Array<{
          id: string;
          models?: Array<{ id: string; reasoning?: FileReasoning }>;
        }>;
      };
      if (!Array.isArray(parsed.providers)) continue;
      const map = new Map<string, Map<string, FileReasoning>>();
      for (const prov of parsed.providers) {
        if (!prov.id || !Array.isArray(prov.models)) continue;
        const mMap = new Map<string, FileReasoning>();
        for (const m of prov.models) {
          if (m.reasoning && Array.isArray(m.reasoning.levels)) {
            mMap.set(m.id, {
              levels: [...m.reasoning.levels],
              ...(m.reasoning.defaultEffort ? { defaultEffort: m.reasoning.defaultEffort } : {}),
            });
          }
        }
        map.set(prov.id, mMap);
      }
      return map;
    } catch {}
  }
  return null;
}

let fileReasoningCache: Map<string, Map<string, FileReasoning>> | null | undefined;

function getFileReasoning(provider: Provider, modelId: string): FileReasoning | undefined {
  if (fileReasoningCache === undefined) {
    fileReasoningCache = loadFileCatalogReasoning();
  }
  if (!fileReasoningCache) return undefined;
  return fileReasoningCache.get(provider)?.get(modelId);
}

function hasFileCatalog(): boolean {
  if (fileReasoningCache === undefined) {
    fileReasoningCache = loadFileCatalogReasoning();
  }
  return fileReasoningCache !== null;
}

function catalogRevision(entries: readonly ProviderCatalogEntry[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16);
}

function buildProviderEntry(provider: Provider): ProviderCatalogEntry {
  const metadata = getProviderMetadata(provider);
  const models = providers[provider].listModels();
  const defaultModel = models.find((model) => model.isDefault) ?? models[0];
  if (!defaultModel) {
    throw new Error(`Provider '${provider}' has no configured models`);
  }

  const fileCatalogFound = hasFileCatalog();
  return {
    id: provider,
    displayName: metadata.label,
    shortName: metadata.shortLabel,
    defaultModelId: defaultModel.id,
    supportsDynamicModels: provider === 'opencode',
    supportsRequiredMcp: harnessMcpCapability(provider) === 'required',
    models: models.map((model) => {
      const fileReasoning = getFileReasoning(provider, model.id);
      if (fileReasoning) {
        return {
          id: model.id,
          displayName: model.displayName,
          reasoning: {
            levels: fileReasoning.levels,
            ...(fileReasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: fileReasoning.defaultEffort }),
          },
        };
      }
      if (fileCatalogFound) {
        // Catalog file present but no reasoning entry for this model — omit reasoning.
        return {
          id: model.id,
          displayName: model.displayName,
        };
      }
      // Fallback to helpers if catalog file not found (e.g. tests with mocked fs).
      const levels = [...effortLevelsForProvider(provider)];
      const defaultEffort = defaultReasoningEffortForProvider(provider, model.id);
      return {
        id: model.id,
        displayName: model.displayName,
        ...(levels.length === 0
          ? {}
          : {
              reasoning: {
                levels,
                ...(defaultEffort === undefined ? {} : { defaultEffort }),
              },
            }),
      };
    }),
  };
}

function buildProviderCatalog(): ProviderCatalog {
  const entries = (Object.keys(providers) as Provider[]).map(buildProviderEntry);
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

export function refreshProviderCatalog(): ProviderCatalog {
  cachedCatalog = buildProviderCatalog();
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
