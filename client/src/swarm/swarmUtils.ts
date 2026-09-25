/**
 * Swarm display helpers. The worktree fold (`getProjectRoot`,
 * `isWorktreeDirectory`) is NOT swarm code: every folder group uses it, so it
 * lives in utils/directories.ts and survives deleting client/src/swarm/.
 */

/**
 * Extract just the last path segment as a display-friendly project name.
 */
export function getProjectName(root: string): string {
  return root.split('/').filter(Boolean).pop() ?? root;
}
