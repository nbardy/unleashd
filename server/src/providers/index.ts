/**
 * Provider metadata contract and registry.
 *
 * Runtime command execution and stream parsing are delegated to
 * `@nbardy/agent-cli` (`executeCommand`).
 */

import {
  type ModelInfo,
  type Provider as ProviderName,
  ProviderSchema,
  catalogEntryForProvider,
} from '@unleashd/shared';

/**
 * Minimal provider contract used by the server runtime.
 */
export interface Provider {
  name: ProviderName;

  listModels(): ModelInfo[];
}

// Pattern: one-type-source (docs/patterns.md#one-type-source)
// Models come only from the generated catalog (shared/src/generated/catalog.ts, built from
// vendor/agent-cli-tool/catalog.jsonc). This replaced six per-provider files, each with a
// FALLBACK_*_MODELS copy that drifted from the catalog, and a runtime catalog.jsonc search
// over seven candidate paths (one an absolute home path). A provider missing from the
// generated catalog throws here, at startup.
function providerFromCatalog(name: ProviderName): Provider {
  const models: ModelInfo[] = catalogEntryForProvider(name).models.map(
    ({ id, displayName, isDefault }) => ({ id, displayName, isDefault })
  );
  return { name, listModels: () => models };
}

const providers = Object.fromEntries(
  ProviderSchema.options.map((name) => [name, providerFromCatalog(name)])
) as Record<ProviderName, Provider>;

/**
 * Get a provider by name
 * @throws Error if provider not found
 */
export function getProvider(name: ProviderName): Provider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(providers).join(', ')}`);
  }
  return provider;
}

export { providers };
