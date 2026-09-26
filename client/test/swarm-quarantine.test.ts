import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Architectural guard (T10, 2026-09-26). The swarm viewer lives in
// client/src/swarm/ and must stay deletable in one go (DESIGN.md §C.5).
// Outside that folder, code may reach it only through client/src/swarm/index.ts
// (whose exports are all lazy), and only from the files listed below. A new
// importer grows the "delete swarm" surface: add it here on purpose, and update
// the removal list in the T10 report.
// Pattern: quarantine (docs/patterns.md#quarantine)
const SRC = fileURLToPath(new URL('../src', import.meta.url));
const SWARM = path.join(SRC, 'swarm');
const ENTRY_IMPORTERS = [
  'App.tsx',
  'components/Chat.tsx',
  'components/VirtualizedMessageList.tsx',
  'mobile/conversations/ConversationView.tsx',
  'views/transcript/TranscriptGroup.tsx',
];

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

/** Every relative specifier: static `from`, side-effect `import '…'`, dynamic `import('…')`, CSS `@import`. */
function relativeImports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+|@import\s+)['"](\.[^'"]*)['"]/g;
  return Array.from(text.matchAll(pattern), (match) => path.resolve(path.dirname(file), match[1]));
}

test('core client code reaches swarm only through client/src/swarm/index.ts', () => {
  const violations: string[] = [];
  const importers = new Set<string>();
  for (const file of sourceFiles(SRC).filter((f) => !f.startsWith(`${SWARM}${path.sep}`))) {
    for (const target of relativeImports(file)) {
      if (target === SWARM || target === path.join(SWARM, 'index')) {
        importers.add(path.relative(SRC, file));
      } else if (target.startsWith(`${SWARM}${path.sep}`)) {
        violations.push(`${path.relative(SRC, file)} → ${path.relative(SRC, target)}`);
      }
    }
  }
  assert.deepEqual(violations, [], 'import swarm code from the entry, not a file inside swarm/');
  assert.deepEqual([...importers].sort(), ENTRY_IMPORTERS);
});

// The entry's exports are lazy so a core chunk carries no swarm code or CSS.
// A static re-export (`export { X } from './X'`) would silently undo that.
test('the client swarm entry has no static import of swarm code', () => {
  const text = fs.readFileSync(path.join(SWARM, 'index.ts'), 'utf8');
  assert.deepEqual(text.match(/(?:from|import)\s+['"]\.[^'"]*['"]/g) ?? [], []);
});
