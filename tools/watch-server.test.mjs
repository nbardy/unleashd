import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBackendRunner, esbuildCheck } from './watch-server.mjs';

// A stand-in backend: loads a local module and a node_modules package, records
// each boot, and honours the reload request the way the real server does
// (drain, then exit 0).
const BACKEND = `
const fs = require('node:fs');
const local = require('./local.cjs');
const pkg = require('pkg');
fs.appendFileSync('boots.log', JSON.stringify({ pid: process.pid, local: local.value, pkg: pkg.value }) + '\\n');
process.on('message', (message) => {
  if (message?.type === 'unleashd:dev-reload') setTimeout(() => process.exit(0), 50);
});
setInterval(() => {}, 1000);
`;

function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'watch-server-')));
  mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{}');
  writeFileSync(path.join(root, 'backend.cjs'), BACKEND);
  writeFileSync(path.join(root, 'local.cjs'), 'module.exports = { value: 1 };\n');
  writeFileSync(
    path.join(root, 'node_modules', 'pkg', 'index.js'),
    'module.exports = { value: 1 };\n'
  );
  const runner = createBackendRunner({
    command: process.execPath,
    args: ['backend.cjs'],
    cwd: root,
    watchRoot: root,
    check: esbuildCheck('backend.cjs', root),
    settleMs: 100,
    initialBackoffMs: 100,
    log: () => {},
    logError: () => {},
  });
  t.after(async () => {
    runner.stop('SIGTERM');
    await runner.stopped;
    rmSync(root, { recursive: true, force: true });
  });
  const boots = () =>
    readFileSync(path.join(root, 'boots.log'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { root, runner, boots };
}

async function until(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = predicate();
      if (value) return value;
    } catch {}
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// macOS starts a recursive fs.watch stream asynchronously and drops writes made
// in its first few milliseconds (measured: 1 in 10 at 0ms, none after 50ms).
// A real backend takes seconds to boot; this fixture boots in milliseconds.
async function firstBoot(boots) {
  await until(() => boots().length === 1);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

test('editing a loaded node_modules package reloads the backend', async (t) => {
  // Regression, 2026-09-23: a vendored package upgrade was invisible to the
  // hand-written watch list and the backend served the old code for hours.
  const { root, runner, boots } = fixture(t);
  runner.start();
  await firstBoot(boots);
  writeFileSync(
    path.join(root, 'node_modules', 'pkg', 'index.js'),
    'module.exports = { value: 2 };\n'
  );
  const [, second] = await until(() => boots().length === 2 && boots());
  assert.equal(second.pkg, 2);
});

test('rewriting loaded files with identical content does not restart the backend', async (t) => {
  // `pnpm typecheck` and `pnpm build` clean-rebuild shared/dist byte-for-byte
  // while dev runs; each rebuild must not cost a backend restart.
  const { root, runner, boots } = fixture(t);
  runner.start();
  await firstBoot(boots);
  const file = path.join(root, 'node_modules', 'pkg', 'index.js');
  rmSync(file);
  writeFileSync(file, 'module.exports = { value: 1 };\n');
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(boots().length, 1);
});

test('truncating then rewriting a loaded file with identical content does not restart', async (t) => {
  // Regression, 2026-09-25: `tsc --watch` truncates each output before writing
  // it. The runner digested the empty intermediate as a change, so the cli
  // watcher's initial (byte-identical) emit restarted the backend mid-startup
  // and every `pnpm dev` loaded the conversation history twice.
  const { root, runner, boots } = fixture(t);
  runner.start();
  await firstBoot(boots);
  const file = path.join(root, 'node_modules', 'pkg', 'index.js');
  writeFileSync(file, '');
  await new Promise((resolve) => setTimeout(resolve, 60));
  writeFileSync(file, 'module.exports = { value: 1 };\n');
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(boots().length, 1);
});

test('code that does not build keeps the current backend until it is fixed', async (t) => {
  const { root, runner, boots } = fixture(t);
  runner.start();
  await firstBoot(boots);
  writeFileSync(path.join(root, 'local.cjs'), 'module.exports = { value: ;\n');
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(boots().length, 1);
  process.kill(boots()[0].pid, 0);
  writeFileSync(path.join(root, 'local.cjs'), 'module.exports = { value: 3 };\n');
  const [, second] = await until(() => boots().length === 2 && boots());
  assert.equal(second.local, 3);
});

test('a backend killed from outside is restarted', async (t) => {
  // Regression, 2026-08-20: `kill <backend-pid>` escalated to fatal and took
  // the whole dev runtime down.
  const { runner, boots } = fixture(t);
  runner.start();
  const [first] = await until(() => boots().length === 1 && boots());
  process.kill(first.pid, 'SIGKILL');
  const [, second] = await until(() => boots().length === 2 && boots());
  assert.notEqual(second.pid, first.pid);
});
