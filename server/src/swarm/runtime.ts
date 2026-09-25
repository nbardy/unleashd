import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  OompaCycle,
  OompaRuntimeSnapshot,
  OompaStarted,
  OompaStopped,
  OompaWorkerStatus,
} from '@unleashd/shared';

export interface SwarmRuntimeDependencies {
  isProcessAlive(pid: number): boolean;
  now(): number;
}

export interface SwarmRunDirectory {
  id: string;
  path: string;
  mtimeMs: number;
}

const DEFAULT_DEPENDENCIES: SwarmRuntimeDependencies = {
  isProcessAlive,
  now: Date.now,
};

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Every read here is async. The swarm observer calls readLatestSwarmRuntime
// every 2 s while a turn runs in the folder; until 2026-09-25 each running
// conversation did it with readdirSync/readFileSync on the event loop (03 §5.2).
// Guard: `a swarm runtime read never touches synchronous fs` (swarm-runtime.test.ts).

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function safeReadJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function readLatestRunDirectory(
  runsDirectory: string
): Promise<SwarmRunDirectory | null> {
  try {
    const directories = (await fs.readdir(runsDirectory, { withFileTypes: true })).filter((entry) =>
      entry.isDirectory()
    );
    const entries = await Promise.all(
      directories.map(async (entry) => {
        const runPath = path.join(runsDirectory, entry.name);
        return { id: entry.name, path: runPath, mtimeMs: (await fs.stat(runPath)).mtimeMs };
      })
    );
    entries.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return entries[0] ?? null;
  } catch {
    return null;
  }
}

export function isTerminalWorkerStatus(status: OompaWorkerStatus): boolean {
  return status === 'done' || status === 'error';
}

export function normalizeWorkerStatus(rawStatus: unknown): OompaWorkerStatus {
  if (typeof rawStatus !== 'string') return 'starting';
  const status = rawStatus.toLowerCase();
  if (status === 'done' || status === 'completed' || status === 'exhausted') return 'done';
  if (status === 'idle') return 'idle';
  if (status === 'error' || status === 'failed' || status === 'fatal') return 'error';
  if (
    [
      'working',
      'running',
      'merged',
      'rejected',
      'no-changes',
      'executor-done',
      'claimed',
      'sync-failed',
      'merge-failed',
    ].includes(status)
  ) {
    return 'running';
  }
  return 'starting';
}

export async function readCycleFiles(directory: string): Promise<OompaCycle[]> {
  try {
    const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.json')).sort();
    const cycles = await Promise.all(
      files.map(async (file): Promise<OompaCycle[]> => {
        try {
          return [JSON.parse(await fs.readFile(path.join(directory, file), 'utf-8')) as OompaCycle];
        } catch {
          return [];
        }
      })
    );
    return cycles.flat();
  } catch {
    return [];
  }
}

export async function readLatestSwarmRuntime(
  projectRoot: string,
  dependencies: SwarmRuntimeDependencies = DEFAULT_DEPENDENCIES
): Promise<OompaRuntimeSnapshot> {
  const runsDirectory = path.join(projectRoot, 'runs');
  if (!(await pathExists(runsDirectory))) {
    return { available: false, run: null, reason: 'No runs directory found' };
  }

  const latestRun = await readLatestRunDirectory(runsDirectory);
  if (!latestRun) {
    return { available: false, run: null, reason: 'No run directories found' };
  }

  const started = ((await safeReadJson(path.join(latestRun.path, 'started.json'))) ??
    (await safeReadJson(path.join(latestRun.path, 'run.json'))) ??
    {}) as Partial<OompaStarted>;
  const stopped = (await safeReadJson(
    path.join(latestRun.path, 'stopped.json')
  )) as OompaStopped | null;
  const cyclesDirectory = path.join(latestRun.path, 'cycles');
  const iterationsDirectory = path.join(latestRun.path, 'iterations');
  const eventDirectory = (await pathExists(cyclesDirectory))
    ? cyclesDirectory
    : (await pathExists(iterationsDirectory))
      ? iterationsDirectory
      : null;
  const cycles = eventDirectory ? await readCycleFiles(eventDirectory) : [];

  const configuredWorkers = (started.workers ?? [])
    .map((worker) => worker.id)
    .filter((id): id is string => Boolean(id));
  const latestCycleByWorker = new Map<string, OompaCycle>();
  for (const cycle of cycles) {
    const workerId = cycle['worker-id'];
    if (!workerId) continue;
    const existing = latestCycleByWorker.get(workerId);
    if (!existing || cycleNumber(cycle) > cycleNumber(existing)) {
      latestCycleByWorker.set(workerId, cycle);
    }
  }

  const workerIds = new Set([...configuredWorkers, ...latestCycleByWorker.keys()]);
  const isStopped = stopped !== null;
  const pid = started.pid;
  const isLive =
    !isStopped &&
    ((typeof pid === 'number' && dependencies.isProcessAlive(pid)) ||
      (await isLegacyOompaProcessAlive(projectRoot, dependencies)));
  const startedAt = Date.parse(String(started['started-at'] ?? ''));
  const runAge = dependencies.now() - startedAt;

  const workersStateDirectory = path.join(latestRun.path, 'workers');
  const workerStates = new Map(
    await Promise.all(
      Array.from(
        workerIds,
        async (id) =>
          [id, await safeReadJson(path.join(workersStateDirectory, `${id}.json`))] as const
      )
    )
  );
  const workers = Array.from(workerIds)
    .map((id) => {
      const cycle = latestCycleByWorker.get(id);
      // Oompa (since 2026-08-07) writes runs/<id>/workers/<worker>.json at every
      // cycle start and at worker terminal exit. This is the liveness authority:
      // cycle files are only written at cycle END, so deriving status from the
      // latest cycle rendered a mid-cycle worker as dead/red for the whole cycle.
      const state = workerStates.get(id) ?? null;
      let status: OompaWorkerStatus;
      let lastEvent: string;
      if (state && typeof state.status === 'string') {
        if (state.status === 'running' && isLive) {
          status = 'running';
          lastEvent = cycle
            ? `Cycle ${state.cycle ?? '?'} in progress (cycle ${cycleNumber(cycle) || '?'}: ${cycle.outcome ?? 'unknown'})`
            : `Cycle ${state.cycle ?? '?'} in progress`;
        } else if (state.status === 'stopped') {
          status = normalizeWorkerStatus(String(state.reason ?? 'done'));
          lastEvent = `Stopped after cycle ${state.cycle ?? '?'}: ${state.reason ?? 'unknown'}`;
        } else {
          // state says running but the swarm process is gone — crashed mid-cycle
          status = 'done';
          lastEvent = `Swarm exited mid-cycle ${state.cycle ?? '?'}`;
        }
      } else if (cycle) {
        // Legacy runs without worker state files: last cycle outcome is the best
        // available signal, but on a live run a finished cycle means the worker
        // is already in its next cycle (or backing off) — render it as running.
        status = isLive ? 'running' : normalizeWorkerStatus(cycle.outcome);
        lastEvent = `Cycle ${cycleNumber(cycle) || '?'}: ${cycle.outcome ?? 'unknown'}`;
      } else if (isLive) {
        status = !Number.isFinite(runAge) || runAge > 60_000 ? 'running' : 'starting';
        lastEvent = 'Starting';
      } else {
        status = 'done';
        lastEvent = isStopped ? 'Worker completed' : 'No data';
      }
      if (!isLive && !isTerminalWorkerStatus(status)) status = 'done';

      return { id, status, lastEvent };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const doneWorkers = workers.filter((worker) => isTerminalWorkerStatus(worker.status)).length;
  const activeWorkers = workers.length - doneWorkers;
  return {
    available: true,
    run: {
      runId: latestRun.id,
      swarmId: started['swarm-id'] ?? latestRun.id,
      isRunning: isLive && activeWorkers > 0,
      totalWorkers: Math.max(workerIds.size, configuredWorkers.length),
      activeWorkers,
      doneWorkers,
      configPath: started['config-file'] ?? null,
      logFile: null,
      workers,
      runCount: await countRunDirectories(runsDirectory),
    },
    reason: null,
  };
}

function cycleNumber(cycle: OompaCycle): number {
  const legacyIteration = (cycle as unknown as Record<string, unknown>).iteration;
  return cycle.cycle ?? (typeof legacyIteration === 'number' ? legacyIteration : 0);
}

async function countRunDirectories(runsDirectory: string): Promise<number> {
  try {
    return (await fs.readdir(runsDirectory, { withFileTypes: true })).filter((entry) =>
      entry.isDirectory()
    ).length;
  } catch {
    return 0;
  }
}

async function isLegacyOompaProcessAlive(
  projectRoot: string,
  dependencies: SwarmRuntimeDependencies
): Promise<boolean> {
  const logsDirectory = path.join(projectRoot, 'oompa', 'logs');
  try {
    const metaFiles = (await fs.readdir(logsDirectory)).filter((name) =>
      /^run_.+\.meta$/.test(name)
    );
    for (const file of metaFiles) {
      const metadata = parseMetadata(await fs.readFile(path.join(logsDirectory, file), 'utf-8'));
      for (const value of [metadata.script_pid, metadata.bb_pid]) {
        const pid = Number.parseInt(value ?? '', 10);
        if (Number.isFinite(pid) && pid > 0 && dependencies.isProcessAlive(pid)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function parseMetadata(content: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return metadata;
}
