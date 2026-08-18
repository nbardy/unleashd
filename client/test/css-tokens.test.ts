import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Regression guard for the class of bug found 2026-08-18: `--accent` was
 * referenced by ~15 rules across the mobile tree but defined nowhere. CSS
 * resolves an undefined custom property to the unset/inherited value instead of
 * erroring, so the mobile "+ New" button, the unread "New" badge, and every
 * mobile focus ring rendered transparent-on-dark — invisible, with no console
 * warning, no type error, and no lint failure.
 *
 * A bare `var(--x)` is a hard dependency. `var(--x, fallback)` is deliberately
 * defensive and is skipped.
 *
 * KNOWN_UNDEFINED is a ratchet, not an exemption: these are pre-existing
 * desktop-tree references to Solarized-era token names that were dropped when
 * index.css moved to semantic tokens. They render unset today. Fix one and
 * delete its entry; the test fails if anyone adds a new undefined token.
 */

const KNOWN_UNDEFINED: ReadonlySet<string> = new Set([
  '--font-xs',
  '--text-dim',
  '--theme-base0',
  '--theme-base01',
  '--theme-base02',
  '--theme-base03',
  '--theme-base1',
  '--theme-green',
  '--theme-red',
  '--theme-violet',
  '--theme-yellow',
]);

const clientSrc = path.resolve(fileURLToPath(import.meta.url), '../../src');

function cssFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) cssFiles(full, found);
    else if (entry.isFile() && full.endsWith('.css')) found.push(full);
  }
  return found;
}

function definedTokens(files: readonly string[]): Set<string> {
  const defined = new Set<string>();
  for (const file of files) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/(--[\w-]+)\s*:/g)) {
      defined.add(match[1]);
    }
  }
  return defined;
}

// Bare references only: a comma before the closing paren means a fallback.
function bareReferences(files: readonly string[]): Array<{ file: string; token: string }> {
  const refs: Array<{ file: string; token: string }> = [];
  for (const file of files) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
      refs.push({ file: path.relative(clientSrc, file), token: match[1] });
    }
  }
  return refs;
}

test('no new undefined CSS custom properties', () => {
  const files = cssFiles(clientSrc);
  assert.ok(files.length > 0, 'expected to find CSS files under client/src');
  const defined = definedTokens(files);

  const missing = bareReferences(files)
    .filter((ref) => !defined.has(ref.token) && !KNOWN_UNDEFINED.has(ref.token))
    .map((ref) => `${ref.file}: var(${ref.token})`);

  assert.deepEqual(
    [...new Set(missing)].sort(),
    [],
    'CSS references a custom property that is never defined — it renders as unset, not as an error'
  );
});

test('the mobile tree defines every token it references', () => {
  // Mobile is held to zero debt: it is the tree the --accent bug shipped in.
  const files = cssFiles(clientSrc);
  const defined = definedTokens(files);

  const missing = bareReferences(files)
    .filter((ref) => ref.file.startsWith(`mobile${path.sep}`) && !defined.has(ref.token))
    .map((ref) => `${ref.file}: var(${ref.token})`);

  assert.deepEqual([...new Set(missing)].sort(), []);
});

test('KNOWN_UNDEFINED has no stale entries', () => {
  // Deleting a token from the allowlist must be forced when it gets defined,
  // otherwise the ratchet quietly loosens over time.
  const defined = definedTokens(cssFiles(clientSrc));
  const stale = [...KNOWN_UNDEFINED].filter((token) => defined.has(token));
  assert.deepEqual(stale, [], 'these tokens are now defined — remove them from KNOWN_UNDEFINED');
});
