import fs from 'node:fs';
import path from 'node:path';
import type { OompaReviewLog, OompaRuntimeSnapshot } from '@unleashd/shared';
import type { Application, Request, Response } from 'express';
import {
  type SwarmRuntimeDependencies,
  isProcessAlive,
  readLatestRunDirectory,
  readLatestSwarmRuntime,
  safeReadJson,
} from './runtime';

export interface SwarmRouteDependencies {
  isUnderKnownProject(resolvedPath: string): boolean;
  listProjectRoots(): Iterable<string>;
  runtimeDependencies?: SwarmRuntimeDependencies;
  signalProcess?(pid: number, signal: NodeJS.Signals): void;
  now?(): Date;
}

export function registerSwarmRuntimeRoutes(
  app: Application,
  dependencies: SwarmRouteDependencies
): void {
  const readRuntime = (projectRoot: string): OompaRuntimeSnapshot =>
    readLatestSwarmRuntime(projectRoot, dependencies.runtimeDependencies);

  app.get('/api/oompa-config', (request, response) => {
    const projectRoot = authorizeProjectDirectory(request, response, dependencies);
    if (!projectRoot) return;

    const configPath = path.join(projectRoot, 'oompa.json');
    if (!fs.existsSync(configPath)) {
      response.status(404).json({ error: 'No oompa.json found' });
      return;
    }
    try {
      response.json(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
    } catch (error) {
      console.error('[swarm] Failed to parse oompa.json:', error);
      response.status(500).json({ error: `Failed to parse oompa.json: ${errorMessage(error)}` });
    }
  });

  app.get('/api/swarm-runtime', (request, response) => {
    const projectRoot = authorizeProjectDirectory(request, response, dependencies);
    if (!projectRoot) return;
    response.json(readRuntime(projectRoot));
  });

  app.get('/api/swarm-projects', (_request, response) => {
    const projects: Array<{
      projectRoot: string;
      projectName: string;
      runtime: OompaRuntimeSnapshot;
    }> = [];
    const uniqueRoots = new Set(
      Array.from(dependencies.listProjectRoots(), (root) => path.resolve(root))
    );
    for (const projectRoot of uniqueRoots) {
      const latestRun = readLatestRunDirectory(path.join(projectRoot, 'runs'));
      if (!latestRun || !fs.existsSync(path.join(latestRun.path, 'started.json'))) continue;
      projects.push({
        projectRoot,
        projectName: path.basename(projectRoot) || projectRoot,
        runtime: readRuntime(projectRoot),
      });
    }
    response.json({ projects });
  });

  app.post('/api/swarm-signal', (request, response) => {
    handleSwarmSignal(request, response, dependencies);
  });

  app.get('/api/swarm-reviews', (request, response) => {
    const projectRoot = authorizeProjectDirectory(request, response, dependencies);
    if (!projectRoot) return;
    const swarmId = queryString(request.query.swarmId);
    if (!swarmId) {
      response.status(400).json({ error: 'dir (absolute path) and swarmId required' });
      return;
    }

    const runDirectory = resolveRunDirectory(projectRoot, swarmId);
    if (!runDirectory) {
      response.status(400).json({ error: 'Invalid swarmId' });
      return;
    }
    const reviewsDirectory = path.join(runDirectory, 'reviews');
    if (!fs.existsSync(reviewsDirectory)) {
      response.json({ reviews: [] });
      return;
    }

    const reviews = fs
      .readdirSync(reviewsDirectory)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .flatMap((file): OompaReviewLog[] => {
        try {
          return [
            JSON.parse(
              fs.readFileSync(path.join(reviewsDirectory, file), 'utf-8')
            ) as OompaReviewLog,
          ];
        } catch (error) {
          console.warn('[swarm] Failed to read review artifact', file, error);
          return [];
        }
      });
    response.json({ reviews });
  });
}

function handleSwarmSignal(
  request: Request,
  response: Response,
  dependencies: SwarmRouteDependencies
): void {
  const body =
    request.body !== null && typeof request.body === 'object'
      ? (request.body as Record<string, unknown>)
      : {};
  const directory = body.dir;
  const signal = body.signal;
  const swarmId = body.swarmId;
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    response.status(400).json({ ok: false, message: 'Absolute directory path required' });
    return;
  }
  if (signal !== 'stop' && signal !== 'kill') {
    response.status(400).json({ ok: false, message: 'signal must be "stop" or "kill"' });
    return;
  }

  const projectRoot = path.resolve(directory);
  if (!dependencies.isUnderKnownProject(projectRoot)) {
    response
      .status(403)
      .json({ ok: false, message: 'Directory not associated with any conversation' });
    return;
  }

  const runsDirectory = path.join(projectRoot, 'runs');
  const runDirectory =
    typeof swarmId === 'string'
      ? resolveRunDirectory(projectRoot, swarmId)
      : readLatestRunDirectory(runsDirectory)?.path;
  if (!runDirectory) {
    response.status(typeof swarmId === 'string' ? 400 : 404).json({
      ok: false,
      message: typeof swarmId === 'string' ? 'Invalid swarmId' : 'No runs found',
    });
    return;
  }

  const stoppedPath = path.join(runDirectory, 'stopped.json');
  if (fs.existsSync(stoppedPath)) {
    response.json({ ok: false, message: 'Swarm already stopped' });
    return;
  }

  const started = safeReadJson(path.join(runDirectory, 'started.json')) ?? {};
  const pid = started?.pid;
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) {
    response.json({ ok: false, message: 'No valid PID found in started.json' });
    return;
  }
  const isAlive = dependencies.runtimeDependencies?.isProcessAlive(pid) ?? isProcessAlive(pid);
  if (!isAlive) {
    writeStoppedEvent(stoppedPath, started, dependencies, 'Process was not running (stale PID)');
    response.json({ ok: true, message: 'Swarm was not running (stale PID). Marked as stopped.' });
    return;
  }

  try {
    const osSignal = signal === 'stop' ? 'SIGTERM' : 'SIGKILL';
    (dependencies.signalProcess ?? process.kill)(pid, osSignal);
    if (signal === 'kill') writeStoppedEvent(stoppedPath, started, dependencies);
    response.json({
      ok: true,
      message:
        signal === 'stop'
          ? `SIGTERM sent to PID ${pid}. Workers will finish current cycle.`
          : `SIGKILL sent to PID ${pid}. Swarm terminated.`,
    });
  } catch (error) {
    console.error('[swarm] Failed to signal process:', error);
    response
      .status(500)
      .json({ ok: false, message: `Failed to send signal: ${errorMessage(error)}` });
  }
}

function authorizeProjectDirectory(
  request: Request,
  response: Response,
  dependencies: SwarmRouteDependencies
): string | undefined {
  const directory = queryString(request.query.dir);
  if (!directory || !path.isAbsolute(directory)) {
    response.status(400).json({ error: 'Absolute directory path required' });
    return undefined;
  }
  const resolved = path.resolve(directory);
  if (!dependencies.isUnderKnownProject(resolved)) {
    response.status(403).json({ error: 'Directory not associated with any conversation' });
    return undefined;
  }
  return resolved;
}

function resolveRunDirectory(projectRoot: string, swarmId: string): string | undefined {
  const runsDirectory = path.join(projectRoot, 'runs');
  const candidate = path.resolve(runsDirectory, swarmId);
  return candidate.startsWith(`${runsDirectory}${path.sep}`) ? candidate : undefined;
}

function writeStoppedEvent(
  stoppedPath: string,
  started: Record<string, unknown>,
  dependencies: SwarmRouteDependencies,
  error?: string
): void {
  fs.writeFileSync(
    stoppedPath,
    JSON.stringify(
      {
        'swarm-id': started['swarm-id'] ?? 'unknown',
        'stopped-at': (dependencies.now ?? (() => new Date()))().toISOString(),
        reason: 'interrupted',
        ...(error ? { error } : {}),
      },
      null,
      2
    )
  );
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
