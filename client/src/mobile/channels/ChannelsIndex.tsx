import { Navigate } from 'react-router-dom';
import type { BuddyOverview } from '../../components/buddies/types';
import { useBuddyOverview } from '../../hooks/useBuddyData';
import { MobileEmptyPanel, MobilePage } from '../components/MobileUI';
import { channelsHref } from './channel-route';

// Its own module because BOTH device trees route /channels here (App.tsx).
// Living in ChannelsMobile.tsx made the desktop load the mobile channels chunk.

type OverviewWorkspace = { id: string; name: string; lastActiveAt: string };

// Most recently active workspace first (by its Buddies' latest runs), then by
// name: the Channels tab opens where the team is working, not whichever
// workspace sorts first alphabetically (that was often an empty one).
export function overviewWorkspaces(overview: BuddyOverview | null): OverviewWorkspace[] {
  const lastActive = new Map<string, string>();
  for (const run of overview?.recentRuns ?? []) {
    const seen = lastActive.get(run.workspaceId);
    if (seen === undefined || run.lastActiveAt > seen)
      lastActive.set(run.workspaceId, run.lastActiveAt);
  }
  const byId = new Map<string, OverviewWorkspace>();
  for (const employee of overview?.employees ?? [])
    for (const workspace of employee.workspaces)
      byId.set(workspace.id, {
        id: workspace.id,
        name: workspace.name,
        lastActiveAt: lastActive.get(workspace.id) ?? '',
      });
  return [...byId.values()].sort(
    (a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt) || a.name.localeCompare(b.name)
  );
}

/** /channels — the tab's entry: open the first workspace's channels. */
export function ChannelsIndex() {
  const overview = useBuddyOverview();
  const [first] = overviewWorkspaces(overview.data);
  if (first) return <Navigate to={channelsHref(first.id, { kind: 'home' })} replace />;
  return (
    <MobilePage title="Channels" subtitle={overview.data ? 'No workspaces' : 'Loading…'}>
      {overview.data && (
        <MobileEmptyPanel>Create a Buddy in a workspace to start its channels.</MobileEmptyPanel>
      )}
    </MobilePage>
  );
}
