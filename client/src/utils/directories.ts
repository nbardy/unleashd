/**
 * Working-directory normalization shared by both view trees.
 *
 * Extracted from Sidebar.tsx so the mobile create sheet and the desktop
 * new-conversation modal agree on what "the same folder" means — otherwise
 * `~/git/foo` and `~/git/foo/` show up as two different recent directories.
 */

import { getProjectRoot } from './swarmUtils';

export const ROOT_DIRECTORY = '/';

export function normalizeFolderDirectory(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return ROOT_DIRECTORY;
  const withoutTrailingSlashes = trimmed.replace(/\/+$/, '');
  return withoutTrailingSlashes || ROOT_DIRECTORY;
}

/**
 * Grouping key for the sidebar's recent-folder groups: the project a
 * conversation belongs to, not the exact directory it ran in.
 *
 * Worktrees are per-iteration scratch dirs (`<project>/.ws<swarm>-w3-i7`), so
 * keying groups on the raw working directory gave every iteration its own
 * header — 1,107 groups for room-runners-arena-lib alone on 2026-09-06, all
 * rendering as the same truncated `~/git/room-runners-aren…`. Folding them onto
 * the project root matches what `recentDirectoriesAtom` already does for the
 * "pick a directory" surfaces.
 *
 * Deliberately NOT folded into `normalizeFolderDirectory`: that one answers
 * "which directory did the user mean", and silently rewriting a worktree the
 * user typed into its parent repo would start conversations in the wrong tree.
 */
export function folderGroupKey(workingDirectory: string): string {
  return getProjectRoot(normalizeFolderDirectory(workingDirectory));
}
