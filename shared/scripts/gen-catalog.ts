/**
 * Generate shared/src/generated/catalog.ts from vendor/agent-cli-tool/catalog.jsonc
 *
 * Single source of truth: vendor/agent-cli-tool/catalog.jsonc
 * Run: pnpm --filter @unleashd/shared gen:catalog  (or pnpm exec tsx shared/scripts/gen-catalog.ts)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const CATALOG_PATH = join(REPO_ROOT, 'vendor/agent-cli-tool/catalog.jsonc');
const OUT_FILE = join(REPO_ROOT, 'shared/src/generated/catalog.ts');

// Minimal JSONC stripper — same regex as shared/src/utils/jsonc.ts
function stripJsonc(text: string): string {
  return text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

type CatalogModel = {
  id: string;
  displayName: string;
  isDefault?: boolean;
  reasoning?: { levels: string[]; defaultEffort?: string };
};
type CatalogProvider = {
  id: string;
  displayName: string;
  shortName: string;
  defaultModelId: string;
  supportsDynamicModels?: boolean;
  models: CatalogModel[];
};
type Catalog = { revision: string; providers: CatalogProvider[] };

function findProvider(catalog: Catalog, id: string): CatalogProvider {
  const p = catalog.providers.find((e) => e.id === id);
  if (!p) throw new Error(`Provider ${id} not found in catalog`);
  return p;
}

function uniquePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of items) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

async function main() {
  const raw = await readFile(CATALOG_PATH, 'utf-8');
  const catalog: Catalog = JSON.parse(stripJsonc(raw));

  const claude = findProvider(catalog, 'claude');
  const codex = findProvider(catalog, 'codex');
  const gemini = findProvider(catalog, 'gemini');
  const cursor = findProvider(catalog, 'cursor');
  const muse = findProvider(catalog, 'muse');

  // Model ID arrays
  const claudeIds = claude.models.map((m) => m.id);
  const geminiIds = gemini.models.map((m) => m.id);
  const museIds = muse.models.map((m) => m.id);
  // Cursor registry as-is from catalog (id, displayName, isDefault)
  // Codex registry: need to build CODEX_MODEL_REGISTRY shape used in shared/src/index.ts
  // That shape has modelName, displayName, thinkingOptions, defaultThinkingOption, isDefault

  // Effort levels — union of all levels per provider, preserving catalog order
  const claudeLevels = uniquePreserveOrder(claude.models.flatMap((m) => m.reasoning?.levels ?? []));
  const codexLevels = uniquePreserveOrder(codex.models.flatMap((m) => m.reasoning?.levels ?? []));
  const museLevels = uniquePreserveOrder(muse.models.flatMap((m) => m.reasoning?.levels ?? []));

  // For Codex, the unified options add 'none' prefix (used for thinkingOptions)
  // CODEX_EFFORT_LEVELS is just codexLevels (without 'none'), CODEX_THINKING_OPTIONS mirrors it.
  // Keep generation explicit so adding a model with different levels still converges to union.
  // If catalog ever diverges per-model, this union remains correct for validation.

  const lines: string[] = [];
  lines.push('// DO NOT EDIT - generated from catalog.jsonc');
  lines.push(`// Source: vendor/agent-cli-tool/catalog.jsonc (revision ${catalog.revision})`);
  lines.push('// Generator: shared/scripts/gen-catalog.ts');
  lines.push('// Run: pnpm --filter @unleashd/shared gen:catalog');
  lines.push('');

  lines.push(`export const CLAUDE_MODEL_IDS = ${JSON.stringify(claudeIds)} as const;`);
  lines.push(`export const GEMINI_MODEL_IDS = ${JSON.stringify(geminiIds)} as const;`);
  lines.push(`export const MUSE_MODEL_IDS = ${JSON.stringify(museIds)} as const;`);
  lines.push('');
  // Cursor registry
  const cursorIds = cursor.models.map((m) => m.id);
  lines.push(
    `export const CURSOR_MODEL_REGISTRY = ${JSON.stringify(
      cursor.models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        isDefault: Boolean(m.isDefault),
      })),
      null,
      2
    )} as const;`
  );
  lines.push(`export const CURSOR_MODEL_IDS = ${JSON.stringify(cursorIds)} as const;`);
  lines.push('');
  // Effort levels
  lines.push(`export const CLAUDE_EFFORT_LEVELS = ${JSON.stringify(claudeLevels)} as const;`);
  lines.push(`export const CODEX_EFFORT_LEVELS = ${JSON.stringify(codexLevels)} as const;`);
  lines.push(`export const MUSE_EFFORT_LEVELS = ${JSON.stringify(museLevels)} as const;`);
  lines.push('');
  // Codex thinking options — alias of effort levels per current catalog; kept separate for backward compat
  lines.push('export const CODEX_THINKING_OPTIONS = CODEX_EFFORT_LEVELS;');
  lines.push(`export const NO_CODEX_THINKING = "none" as const;`);
  lines.push(
    'export const CODEX_UNIFIED_THINKING_OPTIONS = [NO_CODEX_THINKING, ...CODEX_THINKING_OPTIONS] as const;'
  );
  lines.push('');
  // Codex registry — references unified thinking options for each entry
  // We emit literal objects with thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS and defaultThinkingOption per catalog
  lines.push('export const CODEX_MODEL_REGISTRY = [');
  for (const m of codex.models) {
    const def = m.reasoning?.defaultEffort;
    const defStr = def ? `, defaultThinkingOption: ${JSON.stringify(def)}` : '';
    lines.push(
      `  { modelName: ${JSON.stringify(m.id)}, displayName: ${JSON.stringify(m.displayName)}, thinkingOptions: CODEX_UNIFIED_THINKING_OPTIONS${defStr}, isDefault: ${Boolean(m.isDefault)} },`
    );
  }
  lines.push('] as const;');
  lines.push('');

  const out = `${lines.join('\n')}\n`;
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, out, 'utf-8');
  console.log(`Wrote ${OUT_FILE}`);
  console.log(
    `  claude: ${claudeIds.length} models, gemini: ${geminiIds.length}, cursor: ${cursor.models.length}, muse: ${museIds.length}, codex: ${codex.models.length}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
