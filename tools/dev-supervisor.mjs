#!/usr/bin/env node
// Runs one named task: dev | dev-server | dev-client | build | typecheck.
//
// Dev tasks host their long-lived tools in THIS process (tools/dev-runtime.mjs):
// compilers, Vite and the backend runner; only the backend server itself is a
// child. `pnpm dev` went from 18 processes to ~7 (2026-09-25).
//
// Dev tasks claim one dev runtime per data directory (a lock file holding the
// owner's PID) and refuse dev ports held by anything else. `--replace` stops the
// recorded owner first. Build and typecheck take no lock: when they clean-rebuild
// shared/dist under a running dev runtime, the backend runner ignores the
// byte-identical rewrite, and a restart that races the rebuild backs off and
// retries (tools/watch-server.mjs).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startBackend, startCompiler, startVite } from './dev-runtime.mjs';
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

// A task = one-shot `steps` (spawned in order, each must exit 0), then the
// long-lived `services` this process hosts itself (tools/dev-runtime.mjs).
export function taskPlan(task) {
  const buildShared = pnpm('--filter', '@unleashd/shared', 'build');
  const buildCli = pnpm('--dir', 'vendor/agent-cli-tool', 'build');
  switch (task) {
    case 'build':
      return {
        steps: [
          buildShared,
          buildCli,
          pnpm('--filter', '@unleashd/server', 'build'),
          pnpm('--filter', '@unleashd/client', 'build'),
        ],
        services: [],
      };
    case 'typecheck':
      return {
        steps: [
          buildShared,
          pnpm('--filter', '@unleashd/server', 'typecheck'),
          pnpm('--filter', '@unleashd/client', 'exec', 'tsc', '-b'),
          pnpm('--dir', 'vendor/agent-cli-tool', 'typecheck'),
        ],
        services: [],
      };
    case 'dev-server':
      return { steps: [buildShared, buildCli], services: ['backend'] };
    case 'dev-client':
      return { steps: [buildShared], services: ['vite'] };
    // No build steps: the compilers' first pass is the build, and nothing else
    // starts until it has finished.
    case 'dev':
      return { steps: [], services: ['compilers', 'backend', 'vite'] };
    default:
      throw new Error(
        `Unknown task "${task}"; expected dev, dev-server, dev-client, build or typecheck`
      );
  }
}

// The compilers `pnpm dev` runs: the same configs as the packages' watch scripts.
const COMPILERS = [
  { name: 'shared-esm', configPath: path.join(repositoryRoot, 'shared', 'tsconfig.json') },
  { name: 'shared-cjs', configPath: path.join(repositoryRoot, 'shared', 'tsconfig.cjs.json') },
  {
    name: 'cli',
    configPath: path.join(repositoryRoot, 'vendor', 'agent-cli-tool', 'tsconfig.build.json'),
  },
];

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
      child = spawn(step.command, step.args, {
        cwd: repositoryRoot,
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

const log = (line) => process.stdout.write(`${line}\n`);

/**
 * Host `services` until a signal. Compilers finish their first pass before the
 * backend or Vite starts. Returns the exit code.
 */
async function runServices(services) {
  const running = { compilers: [], backend: null, vite: null };
  let stopping = null;
  const stop = (name) => {
    if (stopping) {
      running.backend?.stop('SIGKILL');
      return;
    }
    stopping = name;
    for (const compiler of running.compilers) compiler.close();
    void running.vite?.close();
    if (running.backend) running.backend.stop(name);
    else process.exit(130);
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const name of signals) process.on(name, stop);
  try {
    if (services.includes('compilers')) {
      // The build scripts write these CommonJS markers after tsc; watch mode never does.
      await import(
        pathToFileURL(path.join(repositoryRoot, 'shared/scripts/write-cjs-package.mjs')).href
      );
      await import(
        pathToFileURL(
          path.join(repositoryRoot, 'vendor/agent-cli-tool/scripts/write-dist-package.mjs')
        ).href
      );
      running.compilers = COMPILERS.map((compiler) => startCompiler({ ...compiler, log }));
      await Promise.all(running.compilers.map((compiler) => compiler.ready));
    }
    if (stopping) return 130;
    if (services.includes('backend')) {
      running.backend = startBackend({ repositoryRoot, env: { NODE_ENV: 'development' }, log });
    }
    if (services.includes('vite')) {
      running.vite = await startVite({ clientRoot: path.join(repositoryRoot, 'client') });
    }
    if (running.backend) await running.backend.stopped;
    else await new Promise(() => {});
    return 130;
  } finally {
    for (const name of signals) process.off(name, stop);
  }
}

export async function runTask({ task, replace }) {
  const plan = taskPlan(task);
  if (!(task in DEV_PORTS)) return runSteps(plan.steps, () => {});
  // Vite's config and the backend read this at load; both now run in or under
  // this process, so it is set here rather than per spawned tool.
  process.env[LOCAL_DOMAIN_ENV] = detectLocalDomain({ task }) ? '1' : '0';
  const runtime = await claimDevRuntime({ replace });
  try {
    await assertPortsFree(DEV_PORTS[task]);
    const code = await runSteps(plan.steps, runtime.recordChild);
    if (code !== 0) return code;
    return await runServices(plan.services);
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
  // Hosted services (Vite's watchers, compiler timers) may still hold handles.
  process.exit();
}
