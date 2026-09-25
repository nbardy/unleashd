import type { OwnerUnreadTotal } from './channel-data';
import type { BuddyOverview } from './types';

export interface WorkspaceRecord {
  id: string;
  slug: string;
  name: string;
  root_path: string;
}

export interface RecentBuddy {
  id: string;
  name: string;
}

/** A workspace with a Buddy run in the overview window, and one without. */
export type WorkspaceActivity =
  | { kind: 'active'; lastActiveAt: string; buddies: RecentBuddy[] }
  | { kind: 'quiet' };

export interface WorkspaceHomeRow extends WorkspaceRecord {
  repliesToYou: number;
  unreadChannels: number;
  activity: WorkspaceActivity;
}

export interface WorkspaceHomeSections {
  recent: WorkspaceHomeRow[];
  rest: WorkspaceHomeRow[];
}

/** How many workspaces get an icon tile on the home screen. */
export const RECENT_TILES = 4;
/** Buddy faces shown per workspace, most recently active first. */
export const RECENT_FACES = 3;

type Run = BuddyOverview['recentRuns'][number];

/**
 * Most recently active workspace first, then name. The first RECENT_TILES
 * active workspaces are `recent`; everything else, quiet ones included, is
 * `rest`, so every workspace appears exactly once.
 */
export function workspaceHomeSections(
  workspaces: readonly WorkspaceRecord[],
  totals: ReadonlyMap<string, OwnerUnreadTotal>,
  runs: readonly Run[]
): WorkspaceHomeSections {
  const rows = workspaces
    .map((workspace) => {
      const total = totals.get(workspace.id);
      return {
        ...workspace,
        repliesToYou: total?.repliesToYou ?? 0,
        unreadChannels: total?.unreadChannels ?? 0,
        activity: workspaceActivity(runs.filter((run) => run.workspaceId === workspace.id)),
      };
    })
    .sort(
      (a, b) =>
        lastActive(b).localeCompare(lastActive(a)) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
    );
  const recent = rows.filter((row) => row.activity.kind === 'active').slice(0, RECENT_TILES);
  const tiled = new Set(recent.map((row) => row.id));
  return { recent, rest: rows.filter((row) => !tiled.has(row.id)) };
}

function workspaceActivity(runs: readonly Run[]): WorkspaceActivity {
  if (runs.length === 0) return { kind: 'quiet' };
  const latest = [...runs].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  const buddies = new Map<string, RecentBuddy>();
  for (const run of latest) {
    if (buddies.size === RECENT_FACES) break;
    if (!buddies.has(run.buddyId))
      buddies.set(run.buddyId, { id: run.buddyId, name: run.buddyName });
  }
  return { kind: 'active', lastActiveAt: latest[0].lastActiveAt, buddies: [...buddies.values()] };
}

function lastActive(row: WorkspaceHomeRow): string {
  return row.activity.kind === 'active' ? row.activity.lastActiveAt : '';
}
