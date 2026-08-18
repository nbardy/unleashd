import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Companion to css-tokens.test.ts. That guards undefined `var(--x)`; this guards
 * the other half of the same silent-failure family — a `className` with no CSS
 * rule behind it. Found 2026-08-18 via `.mobile-markdown`, which MessageRow has
 * always set and which no stylesheet ever defined, so every mobile message body
 * rendered as unstyled default HTML.
 *
 * Neither TypeScript nor Biome nor the browser complains about either one.
 *
 * UNSTYLED_BASELINE is a RATCHET, not an allowlist. It began as a real bug list
 * of 86 classes — the whole mobile buddy-detail and swarm-detail trees had been
 * written against stylesheets nobody authored — and is now empty.
 *
 * Scans every string literal in the file that contains a `mobile-` token, not
 * just static `className="..."` attributes. The narrower version missed six
 * classes that reach the DOM through conditional expressions and template
 * literals (`mobile-worker-row__dot`, `mobile-timeline__span`, …), which is
 * exactly where an unstyled name is hardest to notice by eye.
 */

const clientSrc = path.resolve(fileURLToPath(import.meta.url), '../../src');

// Emptied 2026-08-18: all 86 entries were styled in the same pass that found
// them (mobile-controls.css, mobile-buddy.css, mobile-swarm.css). Kept as a
// ratchet so a future unstyled class fails loudly instead of shipping.
const UNSTYLED_BASELINE: ReadonlySet<string> = new Set([]);

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else found.push(full);
  }
  return found;
}

function definedClasses(files: readonly string[]): Set<string> {
  const defined = new Set<string>();
  for (const file of files.filter((f) => f.endsWith('.css'))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\.([a-zA-Z][\w-]*)/g)) {
      defined.add(match[1]);
    }
  }
  return defined;
}

// `mobile-new-directory` and friends are element ids, not classes; requiring a
// `mobile-` prefix AND a CSS definition would flag them, so ids are excluded by
// only considering tokens that appear in a class-list-shaped literal.
const ID_LIKE = new Set(['mobile-new-directory']);

function mobileClassNames(files: readonly string[]): Array<{ file: string; name: string }> {
  const used: Array<{ file: string; name: string }> = [];
  const mobileDir = `${path.join(clientSrc, 'mobile')}${path.sep}`;
  for (const file of files.filter((f) => f.startsWith(mobileDir) && f.endsWith('.tsx'))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const match of src.matchAll(/['"`]([^'"`\n]*\bmobile-[\w-]+[^'"`\n]*)['"`]/g)) {
      for (const name of match[1].split(/\s+/)) {
        if (!/^mobile-[\w-]+$/.test(name) || ID_LIKE.has(name)) continue;
        used.push({ file: path.relative(clientSrc, file), name });
      }
    }
  }
  return used;
}

test('no new unstyled className in the mobile tree', () => {
  const files = walk(clientSrc);
  const defined = definedClasses(files);

  const missing = mobileClassNames(files)
    .filter((use) => !defined.has(use.name) && !UNSTYLED_BASELINE.has(use.name))
    .map((use) => `${use.file}: .${use.name}`);

  assert.deepEqual(
    [...new Set(missing)].sort(),
    [],
    'className with no matching CSS rule — it renders as unstyled default HTML, silently'
  );
});

test('UNSTYLED_BASELINE has no stale entries', () => {
  const defined = definedClasses(walk(clientSrc));
  const stale = [...UNSTYLED_BASELINE].filter((name) => defined.has(name));
  assert.deepEqual(stale, [], 'these classes now have CSS — remove them from UNSTYLED_BASELINE');
});
