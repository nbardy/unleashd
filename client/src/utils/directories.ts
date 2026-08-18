/**
 * Working-directory normalization shared by both view trees.
 *
 * Extracted from Sidebar.tsx so the mobile create sheet and the desktop
 * new-conversation modal agree on what "the same folder" means — otherwise
 * `~/git/foo` and `~/git/foo/` show up as two different recent directories.
 */

export const ROOT_DIRECTORY = '/';

export function normalizeFolderDirectory(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return ROOT_DIRECTORY;
  const withoutTrailingSlashes = trimmed.replace(/\/+$/, '');
  return withoutTrailingSlashes || ROOT_DIRECTORY;
}
