import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Owner home for `/`: every Buddy workspace, and creating one from a folder.
 * Path rules match `resolveDirectory` in builder.ts — an existing folder is
 * reused, the filesystem root is refused, and the slug is path-unique so two
 * folders with the same name can both exist (`projects.slug` is UNIQUE).
 */

export interface WorkspaceHomeRecord {
  id: string;
  slug: string;
  name: string;
  root_path: string;
}

type WorkspaceRow = {
  id: string;
  slug?: string;
  name: string;
  root_path?: string;
  rootPath?: string;
};

export interface WorkspaceWriter {
  listWorkspaces(): WorkspaceRow[];
  createWorkspace(input: { name: string; rootPath: string; slug?: string }): WorkspaceRow;
}

export function listWorkspaceHome(store: {
  listWorkspaces(): WorkspaceRow[];
}): WorkspaceHomeRecord[] {
  return store
    .listWorkspaces()
    .map(toRecord)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function ensureWorkspace(
  store: WorkspaceWriter,
  input: { rootPath: string; name?: string }
): { workspace: WorkspaceHomeRecord; created: boolean } {
  const rootPath = resolveWorkspaceDirectory(input.rootPath);
  const existing = store.listWorkspaces().find((workspace) => samePath(rootOf(workspace), rootPath));
  if (existing) return { workspace: toRecord(existing), created: false };
  const name = input.name?.trim() || path.basename(rootPath);
  if (!name || name.length > 120) {
    throw new Error('Workspace name must be 1–120 characters');
  }
  const taken = new Set<string>();
  for (const workspace of store.listWorkspaces()) {
    if (workspace.slug) taken.add(workspace.slug);
  }
  const created = store.createWorkspace({
    name,
    rootPath,
    slug: workspaceSlug(name, rootPath, taken),
  });
  return { workspace: toRecord(created), created: true };
}

function resolveWorkspaceDirectory(input: string): string {
  const expanded =
    input === '~' || input.startsWith(`~${path.sep}`)
      ? path.join(os.homedir(), input.slice(2))
      : input;
  if (!path.isAbsolute(expanded)) {
    throw new Error(`Workspace path must be absolute: ${input}`);
  }
  const resolved = fs.realpathSync(expanded);
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${input}`);
  }
  if (resolved === path.parse(resolved).root) {
    throw new Error('The filesystem root cannot be used as a workspace');
  }
  return resolved;
}

function samePath(stored: string, resolved: string): boolean {
  try {
    return fs.realpathSync(stored) === resolved;
  } catch {
    return path.resolve(stored) === resolved;
  }
}

function rootOf(row: WorkspaceRow): string {
  const root = row.root_path ?? row.rootPath;
  if (!root) throw new Error('Workspace is missing a root path');
  return root;
}

function toRecord(row: WorkspaceRow): WorkspaceHomeRecord {
  return {
    id: row.id,
    slug: row.slug ?? row.id,
    name: row.name,
    root_path: rootOf(row),
  };
}

function workspaceSlug(name: string, rootPath: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace';
  const suffix = crypto.createHash('sha256').update(rootPath).digest('hex').slice(0, 8);
  let slug = `${base}-${suffix}`;
  let n = 2;
  while (taken.has(slug)) {
    slug = `${base}-${suffix}-${n}`;
    n += 1;
  }
  return slug;
}
