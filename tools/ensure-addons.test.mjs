// S12, 2026-09-26: every lane worktree cold-built both addons (~30 s each) even when it
// never touched Rust. These guard the two properties that removed that: the key moves
// with the crate's build inputs and nothing else, and a cache hit never reaches cargo.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addonKey, ensureAddon, listAddons } from './ensure-addons.mjs';

const TOOLCHAIN = 'rustc 1.90.0 (test)\nhost: aarch64-apple-darwin\n';
const LOCK = `version = 4

[[package]]
name = "demo"
version = "0.1.0"
dependencies = [
 "leaf",
]

[[package]]
name = "leaf"
version = "1.0.0"
checksum = "aaa"

[[package]]
name = "tool"
version = "0.1.0"
dependencies = [
 "demo",
 "unrelated",
]

[[package]]
name = "unrelated"
version = "2.0.0"
checksum = "bbb"
`;

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ensure-addons-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  write('crates/Cargo.toml', '[workspace]\nmembers = ["demo", "tool"]\n');
  write('crates/Cargo.lock', LOCK);
  write('crates/demo/package.json', JSON.stringify({ napi: { binaryName: 'demo' } }));
  write('crates/demo/Cargo.toml', '[package]\nname = "demo"\n');
  write('crates/demo/build.rs', 'fn main() {}\n');
  write('crates/demo/src/lib.rs', 'pub fn a() {}\n');
  write('crates/tool/Cargo.toml', '[package]\nname = "tool"\n');
  write('crates/tool/src/main.rs', 'fn main() {}\n');
  write('server/src/x.ts', 'export const x = 1;\n');
  const [demo] = listAddons(root);
  return { root, write, demo, key: () => addonKey(root, demo, TOOLCHAIN) };
}

test('the key moves with the addon crate build inputs and nothing else', (t) => {
  const { write, key } = fixture(t);
  const base = key();

  write('server/src/x.ts', 'export const x = 2;\n');
  write('crates/tool/src/main.rs', 'fn main() { println!("edited importer"); }\n');
  write('crates/Cargo.toml', '[workspace]\nmembers = ["demo", "tool", "tool2"]\n');
  write('crates/Cargo.lock', LOCK.replace('checksum = "bbb"', 'checksum = "ccc"'));
  write('crates/demo/index.d.ts', 'export declare function a(): void\n');
  assert.equal(key(), base, 'a TS file, a tool crate, members and an unreachable lock entry');

  write('crates/demo/src/nested/deep.rs', '// new file\n');
  const withFile = key();
  assert.notEqual(withFile, base, 'a new source file');
  write('crates/demo/src/lib.rs', 'pub fn b() {}\n');
  assert.notEqual(key(), withFile, 'a source edit');
  const edited = key();
  write('crates/Cargo.lock', LOCK.replace('checksum = "aaa"', 'checksum = "zzz"'));
  assert.notEqual(key(), edited, 'a reachable dependency');
});

test('a cache hit installs the cached addon without spawning cargo', async (t) => {
  const { root, demo, key } = fixture(t);
  const cacheRoot = path.join(root, 'cache');
  const entry = path.join(cacheRoot, 'demo', key());
  mkdirSync(entry, { recursive: true });
  writeFileSync(path.join(entry, 'demo.node'), 'cached addon bytes');
  writeFileSync(path.join(entry, 'index.d.ts'), 'export declare function a(): void\n');

  const outcome = await ensureAddon(demo, {
    root,
    cacheRoot,
    toolchain: TOOLCHAIN,
    spawn: () => {
      throw new Error('a cache hit spawned a build');
    },
  });

  assert.equal(outcome.kind, 'hit');
  assert.equal(
    readFileSync(path.join(root, 'crates/demo/demo.node'), 'utf8'),
    'cached addon bytes'
  );
});
