import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Architectural guard (T10, 2026-09-26). Swarm/oompa is kept but must stay
// deletable in one go (DESIGN.md §C.5). Outside server/src/swarm/, code may
// reach swarm only through server/src/swarm/index.ts, and only from the files
// listed below. A new importer grows the "delete swarm" surface: add it here
// on purpose, and update the removal list in the T10 report.
// Pattern: quarantine (docs/patterns.md#quarantine)
const SRC = path.resolve(__dirname, '../src');
const SWARM = path.join(SRC, 'swarm');
const ENTRY_IMPORTERS = ['conversations/runtime.ts', 'server.ts', 'turns/runner.ts'];

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Every relative specifier: static `from`, side-effect `import '…'`, dynamic `import('…')`. */
function relativeImports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.[^'"]*)['"]/g;
  return Array.from(text.matchAll(pattern), (match) => path.resolve(path.dirname(file), match[1]));
}

test('core server code reaches swarm only through server/src/swarm/index.ts', () => {
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
