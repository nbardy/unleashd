/**
 * client/src/components/buddies/roster.ts
 *
 * Lookups over GET /api/buddies/overview (workspaces with their Buddies). Pure
 * and CSS-free so mobile may import it (gate G3). The overview includes
 * archived Buddies — they still name old posts — so rosters filter on status.
 */
import type { Buddy, BuddyOverview, WorkspaceRoster } from './types';

export const isActive = (buddy: Buddy): boolean => buddy.status === 'active';

export function activeBuddies(roster: WorkspaceRoster): Buddy[] {
  return roster.buddies.filter(isActive);
}

/** Every Buddy's display name, archived ones included (they author history). */
export function buddyNamesOf(overview: BuddyOverview): Record<string, string> {
  return Object.fromEntries(
    overview.flatMap((workspace) => workspace.buddies.map((buddy) => [buddy.id, buddy.name]))
  );
}

export function findWorkspace(
  overview: BuddyOverview,
  workspaceId: string
): WorkspaceRoster | undefined {
  return overview.find((workspace) => workspace.id === workspaceId);
}

export function findBuddy(overview: BuddyOverview, buddyId: string): Buddy | undefined {
  for (const workspace of overview) {
    const buddy = workspace.buddies.find((candidate) => candidate.id === buddyId);
    if (buddy) return buddy;
  }
  return undefined;
}

/** Active Buddies that report to `managerId`. */
export function directReportsOf(overview: BuddyOverview, managerId: string): Buddy[] {
  return overview.flatMap((workspace) =>
    workspace.buddies.filter((buddy) => isActive(buddy) && buddy.managerId === managerId)
  );
}
