#!/usr/bin/env node
// Runs one named task: dev | dev-server | dev-client | build | typecheck.
//
// Dev tasks claim one dev runtime per data directory (a lock file holding the
// owner's PID) and refuse dev ports held by anything else. `--replace` stops the
// recorded owner first. Build and typecheck take no lock: when they clean-rebuild
// shared/dist under a running dev runtime, the backend runner ignores the
// byte-identical rewrite, and a restart that races the rebuild backs off and
// retries (tools/watch-server.mjs).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_DOMAIN_ENV, detectLocalDomain } from './local-domain.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PORTS = { dev: [7489, 7499], 'dev-server': [7499], 'dev-client': [7489] };
// Covers the backend's shutdown drain grace plus its state-flush watchdog.
const REPLACE_TIMEOUT_MS = 10_000;

export function parseArgs(argv) {
  let task = 'dev';
  let replace = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--replace') replace = true;
    else if (argv[index] === '--task') task = argv[++index];
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  if (replace && !(task in DEV_PORTS)) throw new Error('--replace applies only to dev tasks');
  return { task, replace };
}

// Through the invoking pnpm when there is one: under nvm, pnpm may not be on PATH.
function pnpm(...args) {
  const pnpmScript = process.env.npm_execpath;
  return pnpmScript?.includes('pnpm')
    ? { command: process.execPath, args: [pnpmScript, ...args] }
    : { command: 'pnpm', args };
}

export function taskSteps(task, localDomain) {
  const domainEnv = { [LOCAL_DOMAIN_ENV]: localDomain ? '1' : '0' };
  const buildShared = pnpm('--filter', '@unleashd/shared', 'build');
  const buildCli = pnpm('--dir', 'vendor/agent-cli-tool', 'build');
  const vite = { ...pnpm('--filter', '@unleashd/client', 'exec', 'vite'), env: domainEnv };
  const backend = {
    command: process.execPath,
    args: [path.join(repositoryRoot, 'tools', 'watch-server.mjs')],
    env: { NODE_ENV: 'development', ...domainEnv },
  };
  switch (task) {
    case 'build':
      return [
        buildShared,
        buildCli,
        pnpm('--filter', '@unleashd/server', 'build'),
        pnpm('--filter', '@unleashd/client', 'build'),
      ];
    case 'typecheck':
      return [
        buildShared,
        pnpm('--filter', '@unleashd/server', 'typecheck'),
        pnpm('--filter', '@unleashd/client', 'exec', 'tsc', '-b'),
        pnpm('--dir', 'vendor/agent-cli-tool', 'typecheck'),
      ];
    case 'dev-server':
      return [buildShared, buildCli, backend];
    case 'dev-client':
      return [buildShared, vite];
    case 'dev':
      return [
        buildShared,
        buildCli,
        {
          command: process.execPath,
          args: [
            path.join(
              path.dirname(createRequire(import.meta.url).resolve('concurrently/package.json')),
              'dist',
              'bin',
              'concurrently.js'
            ),
            '--kill-others-on-fail',
            '-n',
            'shared-esm,shared-cjs,cli,server,client',
            '-c',
            'yellow,yellow,magenta,blue,green',
            'pnpm --filter @unleashd/shared watch:esm',
            'pnpm --filter @unleashd/shared watch:cjs',
            'pnpm --dir vendor/agent-cli-tool watch',
            'node tools/watch-server.mjs',
            'pnpm --filter @unleashd/client exec vite',
          ],
          env: { NODE_ENV: 'development', ...domainEnv },
        },
      ];
    default:
      throw new Error(
        `Unknown task "${task}"; expected dev, dev-server, dev-client, build or typecheck`
      );
  }
}

// --- the dev runtime lock -----------------------------------------------------

export function lockPath(dataDirectory = process.env.UNLEASHD_DATA_DIR) {
  return path.join(
    path.resolve(dataDirectory ?? path.join(os.homedir(), '.agent-viewer')),
    'dev-supervisor.lock.json'
  );
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// Owner = Recorded({pid, childPgid}) ⊕ Unreadable ⊕ Gone. An unreadable lock
// records no process to protect, so it is reclaimed like a dead owner.
function readOwner(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'gone' };
    throw error;
  }
  try {
    const { pid, childPgid } = JSON.parse(raw);
    if (Number.isSafeInteger(pid)) return { kind: 'recorded', raw, pid, childPgid };
  } catch {}
  return { kind: 'unreadable', raw };
}

// Reclaim only the lock we inspected: a concurrent start may have replaced it.
function reclaim(file, owner) {
  if (owner.kind === 'gone') return;
  try {
    if (readFileSync(file, 'utf8') === owner.raw) rmSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function signal(target, name) {
  try {
    process.kill(target, name);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function stopOwner({ pid, childPgid }) {
  signal(pid, 'SIGTERM');
  const deadline = Date.now() + REPLACE_TIMEOUT_MS;
  while (isAlive(pid) && Date.now() < deadline) await sleep(100);
  // The owner forwards SIGTERM to its child group; the SIGKILLs only land when
  // it could not, so nothing it started outlives it.
  if (childPgid) signal(-childPgid, 'SIGKILL');
  signal(pid, 'SIGKILL');
}

export async function claimDevRuntime({ file = lockPath(), replace = false } = {}) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, childPgid: null }), { flag: 'wx' });
      return {
        recordChild: (childPgid) =>
          writeFileSync(file, JSON.stringify({ pid: process.pid, childPgid })),
        release: () => rmSync(file, { force: true }),
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const owner = readOwner(file);
    if (owner.kind === 'recorded' && isAlive(owner.pid)) {
      if (!replace) {
        throw new Error(
          `A dev runtime is already running (PID ${owner.pid}). Use "pnpm dev:replace" to replace it; if PID ${owner.pid} is not Unleashd, delete ${file}.`
        );
      }
      console.log(`[dev-supervisor] Stopping the dev runtime owned by PID ${owner.pid}`);
      await stopOwner(owner);
    }
    reclaim(file, owner);
  }
}

// Something listening on a dev port without holding the lock (an orphaned
// backend, a stray vite) would make this runtime fail or serve stale code.
// lsof sees every address family; the bind probe covers hosts without lsof.
// A probe alone is not enough: binding 127.0.0.1 succeeds beside vite's IPv6
// `*:7489` listener.
export async function assertPortsFree(ports) {
  const held = [];
  for (const port of ports) {
    const pids = (
      spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
        .stdout ?? ''
    )
      .split('\n')
      .filter(Boolean);
    const bindable = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (pids.length > 0 || !bindable) {
      held.push(`port ${port} (PID ${pids.join(', ') || 'unknown'})`);
    }
  }
  if (held.length > 0) {
    throw new Error(
      `${held.join(', ')} already in use by a process outside the dev runtime. Stop it, then retry; nothing was signalled.`
    );
  }
}

// --- running ------------------------------------------------------------------

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runSteps(steps, onChild) {
  let received = null;
  let child = null;
  const forward = (name) => {
    if (child) signal(-child.pid, received ? 'SIGKILL' : name);
    received = name;
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const name of signals) process.on(name, forward);
  try {
    for (const step of steps) {
      if (received) return 130;
      // concurrently forces colour for its children; an inherited NO_COLOR makes
      // every Node child warn about the conflict before any useful output.
      // (spawn drops undefined env entries.)
      const env = { ...process.env, ...step.env, NO_COLOR: undefined };
      child = spawn(step.command, step.args, {
        cwd: repositoryRoot,
        env,
        stdio: 'inherit',
        detached: true,
      });
      onChild(child.pid);
      const { code, killedBy } = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (exitCode, exitSignal) =>
          resolve({ code: exitCode, killedBy: exitSignal })
        );
      });
      child = null;
      if (received || killedBy) return 130;
      if (code !== 0) return code;
    }
    return 0;
  } finally {
    for (const name of signals) process.off(name, forward);
  }
}

export async function runTask({ task, replace }) {
  const steps = taskSteps(task, task in DEV_PORTS && detectLocalDomain({ task }));
  if (!(task in DEV_PORTS)) return runSteps(steps, () => {});
  const runtime = await claimDevRuntime({ replace });
  try {
    await assertPortsFree(DEV_PORTS[task]);
    return await runSteps(steps, runtime.recordChild);
  } finally {
    runtime.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runTask(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`[dev-supervisor] ${error.message}`);
    process.exitCode = 1;
  }
}
