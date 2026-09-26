import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Architectural guard (T20, owner decision O1, 2026-09-26). client/src/views/
// holds device-agnostic content rendered by BOTH trees. A view that imports the
// mobile tree (including useDeviceKind) or a desktop shell component would drag
// one shell's layout and CSS into the other, which is exactly what G3 guarded
// before views existed. Device differences are a named `presentation` prop that
// the caller picks, never a lookup inside the view.
const SRC = fileURLToPath(new URL('../src', import.meta.url));
const VIEWS = path.join(SRC, 'views');
const FORBIDDEN = [
  path.join(SRC, 'mobile'),
  path.join(SRC, 'components', 'ShellDesktop'),
  path.join(SRC, 'components', 'Sidebar'),
  path.join(SRC, 'components', 'Gallery'),
  path.join(SRC, 'components', 'SettingsMenu'),
];

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

test('views never import the mobile tree or a desktop shell component', () => {
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+|@import\s+)['"](\.[^'"]*)['"]/g;
  const violations = sourceFiles(VIEWS).flatMap((file) =>
    Array.from(fs.readFileSync(file, 'utf8').matchAll(pattern), (m) =>
      path.resolve(path.dirname(file), m[1])
    )
      .filter((target) =>
        FORBIDDEN.some((f) => target === f || target.startsWith(`${f}${path.sep}`))
      )
      .map((target) => `${path.relative(SRC, file)} → ${path.relative(SRC, target)}`)
  );
  assert.ok(sourceFiles(VIEWS).length > 0, 'client/src/views/ is empty: the guard checked nothing');
  assert.deepEqual(violations, []);
});
