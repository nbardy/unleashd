import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The `oompa` subcommands whose output seeds a new swarm conversation. */
export type OompaContextCommand = 'status' | 'info';

// Every child process on an HTTP request path runs asynchronously. Until
// 2026-09-25 these were execSync/execFileSync: GET /api/oompa-swarm-context ran
// `oompa status` then `oompa info` back to back (8s timeout each), freezing the
// whole backend (every WS stream, every other request) for up to 16s before a
// swarm conversation could be created, and SwarmDetail's polled /api/git-log
// stalled the event loop on every poll. Guarded by swarm-read-model-routes.test.ts.

/**
 * Runs `oompa <command>` without a shell and returns its combined output.
 * A failing or timed-out command is still context for the swarm prompt, so its
 * stdout/stderr/message become the returned text rather than an HTTP error.
 */
export async function captureOompaCommand(
  command: OompaContextCommand,
  cwd: string,
  timeoutMs: number
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('oompa', [command], {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf8',
    });
    return stdout.trim();
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    return [failure.stdout, failure.stderr, failure.message]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
      .trim();
  }
}

/** Runs `git <args>` without a shell; rejects on non-zero exit or timeout. */
export async function executeGit(args: string[], cwd: string, timeoutMs: number): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf8',
  });
  return stdout;
}
