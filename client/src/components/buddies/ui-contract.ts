import { directReportsOf, isActive } from './roster';
import type { Buddy, BuddyOverview, TaskStatus, WorkspaceRoster } from './types';

/** Up to two initials for an avatar: "Pixel Bot", "pixel_bot" and "pixel-bot" all give "PB". */
export function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

export type TaskStatusView = {
  glyph: string;
  label: string;
  tone: 'idle' | 'active' | 'blocked' | 'done';
};

/** One table for every surface that names a Task status (chips, @ menu, work cards). */
export const TASK_STATUS: Readonly<Record<TaskStatus, TaskStatusView>> = {
  open: { glyph: '○', label: 'Open', tone: 'idle' },
  in_progress: { glyph: '◐', label: 'In progress', tone: 'active' },
  review: { glyph: '◑', label: 'In review', tone: 'active' },
  blocked: { glyph: '■', label: 'Blocked', tone: 'blocked' },
  done: { glyph: '✓', label: 'Done', tone: 'done' },
  cancelled: { glyph: '✕', label: 'Cancelled', tone: 'idle' },
};

export const taskStatusView = (status: TaskStatus): TaskStatusView => TASK_STATUS[status];

/** Finished tasks stay reachable without mixing into current work. */
export const isTaskOpen = (status: TaskStatus): boolean =>
  status !== 'done' && status !== 'cancelled';

/** One directory card: an active Buddy, its home workspace and its active reports. */
export interface DirectoryEntry {
  buddy: Buddy;
  workspace: WorkspaceRoster;
  reports: Buddy[];
}

/** Every active Buddy in the overview, by name. */
export function directoryEntries(overview: BuddyOverview): DirectoryEntry[] {
  return overview
    .flatMap((workspace) =>
      workspace.buddies.filter(isActive).map((buddy) => ({
        buddy,
        workspace,
        reports: directReportsOf(overview, buddy.id),
      }))
    )
    .sort((a, b) => a.buddy.name.localeCompare(b.buddy.name));
}

/**
 * The directory search: names, roles, the workspace and report names are all
 * useful ways to find a Buddy. Keeps the given order.
 */
export function filterDirectoryEntries(entries: DirectoryEntry[], query: string): DirectoryEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return entries;
  return entries.filter((entry) =>
    [
      entry.buddy.name,
      entry.buddy.role,
      entry.workspace.name,
      ...entry.reports.map((report) => `${report.name} ${report.role}`),
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalized)
  );
}
