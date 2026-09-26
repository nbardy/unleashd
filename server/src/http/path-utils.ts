import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME_DIRECTORY = os.homedir();

// Deep enough to climb out of `server/` or `packages/<name>/`, shallow enough
// that a stray marker far up the tree cannot capture an unrelated cwd.
const WORKSPACE_SEARCH_DEPTH = 4;

/**
 * The default workspace for a conversation with none: UNLEASHD_DEFAULT_CWD, else the enclosing
 * pnpm workspace root, else cwd. NOT `process.cwd()` alone: dev runs in `<repo>/server`
 * (docs/architecture.md#default-workspace-is-not-processcwd).
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

/** Root itself or a descendant, by path segments: `/work/app-evil` is not within `/work/app`. */
export function isPathWithin(
  root: string,
  candidate: string,
  options: { allowRoot?: boolean } = {}
): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '') return options.allowRoot !== false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
