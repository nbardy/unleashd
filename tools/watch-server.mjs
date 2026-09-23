#!/usr/bin/env node
// Keeps exactly one dev backend running the code that is on disk.
//
// A reload must never break agent runs the harness launched: agents build
// Unleashd with Unleashd, so their own edits trigger these reloads. The runner
// only ASKS the backend to reload; the backend finishes every active turn first
// (server/src/lifecycle/shutdown.ts), and code that does not build never
// replaces a working backend.
//
// State = Running(child) ⊕ Draining(child) ⊕ Down(retry timer) ⊕ Stopping(child) ⊕ Stopped
//   source change → Running:  build-check, then ask the backend to drain → Draining
//                   Down:     build-check, then start now
//   backend exit  → Draining: start the replacement
//                   Running:  it crashed or was killed → Down, retry with backoff (never gives up)
//                   Stopping: done
//
// What to watch is never configured. The backend reports every file it loads
// (Node's own --watch protocol, WATCH_REPORT_DEPENDENCIES), so no dependency can
// be missing from the list. On 2026-09-23 Buddies v33 was vendored into
// node_modules, which the old hand-written watch list did not cover, and the
// backend kept serving the v32 post shape for hours.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELOAD_MESSAGE = 'unleashd:dev-reload';
const SETTLE_MS = 300;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const HEALTHY_UPTIME_MS = 30_000;

// Synchronous on purpose: the baseline must be read the moment the backend
// reports a file. An async read let an edit land first, become the baseline,
// and hide the change.
function digest(file) {
  try {
    return createHash('sha1').update(readFileSync(file)).digest('base64');
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

function describeExit(code, signal) {
  return signal ? `signal ${signal}` : `exit ${code}`;
}

/** Whole-graph esbuild bundle: catches syntax errors and missing exports in ~60ms. */
export function esbuildCheck(entry, cwd) {
  const esbuild = createRequire(createRequire(import.meta.url).resolve('tsx'))('esbuild');
  return async () => {
    try {
      await esbuild.build({
        entryPoints: [entry],
        absWorkingDir: cwd,
        bundle: true,
        write: false,
        platform: 'node',
        packages: 'external',
        format: 'cjs',
        logLevel: 'silent',
      });
      return { ok: true };
    } catch (error) {
      const formatted = await esbuild.formatMessages(error.errors ?? [], { kind: 'error' });
      return { ok: false, message: formatted.join('\n') || String(error) };
    }
  };
}

export function createBackendRunner({
  command,
  args,
  cwd,
  env = {},
  watchRoot,
  check,
  settleMs = SETTLE_MS,
  initialBackoffMs = INITIAL_BACKOFF_MS,
  log = (line) => console.log(`[server-watch] ${line}`),
  logError = (line) => console.error(`[server-watch] ${line}`),
}) {
  const root = realpathSync(watchRoot);
  let state = { kind: 'down', timer: undefined };
  // Loaded file → digest of the content the backend loaded.
  let loaded = new Map();
  let backoffMs = initialBackoffMs;
  let settleTimer;
  let watcher;
  let resolveStopped;
  const stopped = new Promise((resolve) => {
    resolveStopped = resolve;
  });

  // Node's report lists paths, file: URLs, and null (for modules without a file).
  function recordLoaded(message) {
    for (const key of ['watch:require', 'watch:import']) {
      for (const entry of message?.[key] ?? []) {
        if (typeof entry !== 'string') continue;
        const file = entry.startsWith('file:') ? fileURLToPath(entry) : entry;
        loaded.set(file, digest(file));
      }
    }
  }

  // A clean build (pnpm typecheck / build) rewrites shared/dist byte-for-byte;
  // only a real content change may restart the backend. 'missing' is a file
  // mid-rewrite: the write that completes it fires its own event.
  function onFileEvent(file) {
    const current = digest(file);
    if (current === 'missing' || current === loaded.get(file)) return;
    loaded.set(file, current);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => void onSourceChanged(), settleMs);
  }

  function spawnBackend() {
    loaded = new Map();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env, WATCH_REPORT_DEPENDENCIES: '1' },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    const startedAt = Date.now();
    child.on('message', recordLoaded);
    child.once('exit', (code, signal) => onExit(code, signal, Date.now() - startedAt));
    state = { kind: 'running', child };
  }

  function onExit(code, signal, uptimeMs) {
    switch (state.kind) {
      case 'draining':
        log('Backend finished its active work; starting the updated backend');
        backoffMs = initialBackoffMs;
        spawnBackend();
        return;
      case 'running': {
        const delayMs = uptimeMs >= HEALTHY_UPTIME_MS ? initialBackoffMs : backoffMs;
        backoffMs = Math.min(delayMs * 2, MAX_BACKOFF_MS);
        logError(
          `Backend exited (${describeExit(code, signal)}) after ${uptimeMs}ms; restarting in ${delayMs}ms (or on the next source change)`
        );
        state = { kind: 'down', timer: setTimeout(spawnBackend, delayMs) };
        return;
      }
      case 'stopping':
        finish();
        return;
    }
  }

  async function onSourceChanged() {
    const result = await check();
    if (!result.ok) {
      logError(`New code does not build; keeping the current backend.\n${result.message}`);
      return;
    }
    switch (state.kind) {
      case 'running':
        // A send failure means the channel just closed: the backend is exiting,
        // and onExit owns what happens next.
        state.child.send({ type: RELOAD_MESSAGE }, () => {});
        state = { kind: 'draining', child: state.child };
        log('Source changed; the backend restarts once its active work finishes');
        return;
      case 'down':
        clearTimeout(state.timer);
        log('Source changed; starting the backend');
        spawnBackend();
        return;
      case 'draining':
      case 'stopping':
      case 'stopped':
        return;
    }
  }

  function finish() {
    clearTimeout(settleTimer);
    watcher.close();
    state = { kind: 'stopped' };
    resolveStopped();
  }

  function start() {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      const file = filename && path.join(root, filename);
      if (file && loaded.has(file)) onFileEvent(file);
    });
    spawnBackend();
  }

  function stop(signal) {
    switch (state.kind) {
      case 'running':
      case 'draining':
        state.child.kill(signal);
        state = { kind: 'stopping', child: state.child };
        return;
      case 'down':
        clearTimeout(state.timer);
        finish();
        return;
      case 'stopping':
        state.child.kill('SIGKILL');
        return;
      case 'stopped':
        return;
    }
  }

  return { start, stop, stopped };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const serverRoot = path.join(repositoryRoot, 'server');
  const runner = createBackendRunner({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/server.ts'],
    cwd: serverRoot,
    env: { NODE_ENV: 'development' },
    watchRoot: repositoryRoot,
    check: esbuildCheck('src/server.ts', serverRoot),
  });
  process.on('SIGINT', () => runner.stop('SIGINT'));
  process.on('SIGTERM', () => runner.stop('SIGTERM'));
  runner.start();
}
