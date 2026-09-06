import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ModelInfo, stripJsonc } from '@unleashd/shared';

// Shared loader for vendor/agent-cli-tool/catalog.jsonc
// Providers use this as primary source; hardcoded fallbacks are only for minimal test env.

function findCatalogPath(): string | null {
  const candidates: string[] = [];
  // Explicit override for checkouts where the catalog lives outside the repo.
  if (process.env.UNLEASHD_CATALOG_PATH) candidates.push(process.env.UNLEASHD_CATALOG_PATH);
  // __dirname, NOT import.meta: this package compiles to CommonJS, and `import.meta`
  // is ESM-only SYNTAX — Node's module-syntax detection sees it in the emitted .js,
  // classifies the whole file as ESM, and boot dies with "exports is not defined in
  // ES module scope" (the @ts-ignore that used to sit here was silencing exactly
  // this). Regression guard: server boot itself; see also `node dist/server.js`.
  candidates.push(join(__dirname, '../../../vendor/agent-cli-tool/catalog.jsonc'));
  candidates.push(join(__dirname, '../../vendor/agent-cli-tool/catalog.jsonc'));
  candidates.push(join(__dirname, '../vendor/agent-cli-tool/catalog.jsonc'));
  candidates.push(join(process.cwd(), 'vendor/agent-cli-tool/catalog.jsonc'));
  candidates.push(join(process.cwd(), '../agent-cli-tool/catalog.jsonc'));
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

const cache = new Map<string, ModelInfo[]>();

export function loadProviderModels(providerId: string, fallback: ModelInfo[]): ModelInfo[] {
  if (cache.has(providerId)) return cache.get(providerId)!;
  const path = findCatalogPath();
  if (!path) return fallback;
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(stripJsonc(raw)) as {
    providers: Array<{ id: string; models: ModelInfo[] }>;
  };
  const entry = parsed.providers.find((p) => p.id === providerId);
  if (!entry) throw new Error(`${providerId} provider not found in catalog at ${path}`);
  cache.set(providerId, entry.models);
  return entry.models;
}

// Test helper — not used in prod, but useful for resetting between tests if needed
export function __clearCatalogCache(): void {
  cache.clear();
}
