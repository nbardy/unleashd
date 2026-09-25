/**
 * The swarm/oompa viewer's ONE entry point. Core server files (server.ts,
 * conversations/, turns/, transport/) import swarm code only from here, never
 * from a file inside this folder, so deleting swarm support is: delete
 * server/src/swarm/, then delete the few call sites of these exports (listed in
 * the lean-rewrite T10 report). Owner decision 2026-09-25: keep swarm, but
 * keep it deletable in one go (DESIGN.md §C.5).
 * Pattern: quarantine (docs/patterns.md#quarantine)
 * Guard: server/test/swarm-quarantine.test.ts
 */
import type { Application } from 'express';
import { captureOompaCommand, executeGit } from './commands';
import { registerSwarmReadModelRoutes } from './read-model-routes';
import { registerSwarmRuntimeRoutes } from './routes';
import { isProcessAlive } from './runtime';

export { SwarmObservers, watchSwarmRuns } from './observer';
export { readLatestSwarmRuntime } from './runtime';

export interface SwarmRoutePorts {
  isUnderKnownProject(resolvedPath: string): boolean;
  listProjectRoots(): Iterable<string>;
  resolveWorkingDirectory(input: string): string;
  commandTimeoutMs: number;
}

/** Every swarm HTTP route: runtime/config/reviews/signal plus the read model. */
export function registerSwarmRoutes(app: Application, ports: SwarmRoutePorts): void {
  registerSwarmRuntimeRoutes(app, {
    isUnderKnownProject: ports.isUnderKnownProject,
    listProjectRoots: ports.listProjectRoots,
  });
  registerSwarmReadModelRoutes(app, {
    isUnderKnownProject: ports.isUnderKnownProject,
    resolveWorkingDirectory: ports.resolveWorkingDirectory,
    captureOompaCommand: (command, workingDirectory) =>
      captureOompaCommand(command, workingDirectory, ports.commandTimeoutMs),
    executeGit,
    isProcessAlive,
    now: Date.now,
  });
}
