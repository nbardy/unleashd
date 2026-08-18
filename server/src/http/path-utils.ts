import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME_DIRECTORY = os.homedir();

// Deep enough to climb out of `server/` or `packages/<name>/`, shallow enough
// that a stray marker far up the tree cannot capture an unrelated cwd.
const WORKSPACE_SEARCH_DEPTH = 4;

/**
 * The default workspace handed to a user-facing conversation.
 *
 * NOT `process.cwd()`. The dev supervisor spawns the server with
 * `cwd: <repo>/server` (tools/watch-server.mjs), so `process.cwd()` was
 * resolving to the server PACKAGE directory. Every Buddy Builder conversation
 * therefore started in `<repo>/server`, and an agent reasoning about the repo
 * with root-relative paths ("server/src/...") resolved them to
 * `<repo>/server/server/src/...` — ENOENT, surfacing as
 * "No such file or directory (os error 2)" on its first read_file.
 *
 * Production (`node server/dist/server.js` from the repo root) had a different
 * cwd than dev, which is why this only ever reproduced in dev.
 *
 * Resolution order:
 *  1. `UNLEASHD_DEFAULT_CWD` — explicit operator override, always wins.
 *  2. The enclosing pnpm workspace root, if the cwd sits inside one. This is
 *     what turns `<repo>/server` back into `<repo>`.
 *  3. `process.cwd()` — unchanged behaviour when the server runs outside a
 *     workspace (a global install, say).
 *
 * Note this is only a DEFAULT. A buddy with a workspace uses that workspace's
 * `root_path`; this is the fallback for conversations that have no workspace
 * yet, the Buddy Builder chief among them.
 */
export function resolveDefaultWorkingDirectory(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  fileExists: (candidate: string) => boolean = (candidate) => fs.existsSync(candidate)
): string {
  const override = normalizeDirectoryInput(env.UNLEASHD_DEFAULT_CWD ?? '');
  if (override) return path.resolve(override);

  let current = path.resolve(cwd);
  for (let depth = 0; depth <= WORKSPACE_SEARCH_DEPTH; depth += 1) {
    if (fileExists(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(cwd);
}

export function expandHomeAlias(inputPath: string): string {
  if (inputPath === '~') return HOME_DIRECTORY;
  if (inputPath.startsWith('~/')) return path.join(HOME_DIRECTORY, inputPath.slice(2));
  if (path.sep === '\\' && inputPath.startsWith('~\\')) {
    return path.join(HOME_DIRECTORY, inputPath.slice(2));
  }
  return inputPath.startsWith('~') ? inputPath.replace(/^~/, HOME_DIRECTORY) : inputPath;
}

export function normalizeDirectoryInput(inputPath: string): string {
  const trimmed = inputPath.trim();
  return trimmed ? path.normalize(expandHomeAlias(trimmed)) : '';
}

export function resolveWorkingDirectoryInput(
  inputPath: string | null | undefined,
  fallback = process.cwd()
): string {
  const normalized = normalizeDirectoryInput(inputPath ?? '');
  const resolved = path.resolve(normalized || fallback);
  return resolved === path.parse(resolved).root ? resolved : resolved.replace(/[\\/]+$/, '');
}

export function displayPathWithHomeAlias(resolvedPath: string, useHomeAlias: boolean): string {
  if (!useHomeAlias) return resolvedPath;
  if (resolvedPath === HOME_DIRECTORY) return '~';
  return resolvedPath.startsWith(`${HOME_DIRECTORY}${path.sep}`)
    ? `~${resolvedPath.slice(HOME_DIRECTORY.length)}`
    : resolvedPath;
}

/**
 * Return whether candidate is root itself or a descendant of root.
 *
 * A string-prefix check is not a path boundary check: `/work/app-evil` starts
 * with `/work/app`. `path.relative` gives us path segments, so parent traversal
 * and absolute cross-volume results can be rejected explicitly.
 */
export function isPathWithin(
  root: string,
  candidate: string,
  options: { allowRoot?: boolean } = {}
): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '') return options.allowRoot !== false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
