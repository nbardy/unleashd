import { useAtomValue } from 'jotai';
import { Navigate } from 'react-router-dom';
import { conversationListAtom } from '../../atoms/conversations';
import { sameMap, stableAtom } from '../../atoms/structural';
import type { BuddyOverview } from '../../components/buddies/types';
import { useBuddyOverview } from '../../hooks/useBuddyData';
import { MobileEmptyPanel, MobilePage } from '../components/MobileUI';
import { channelsHref } from './channel-route';

// Its own module because BOTH device trees route /channels here (App.tsx).
// Living in ChannelsMobile.tsx made the desktop load the mobile channels chunk.

type OverviewWorkspace = { id: string; name: string; lastActiveMs: number };

/** Latest Buddy conversation activity per workspace, from the conversation list. */
export const buddyWorkspaceActivityAtom = stableAtom((get) => {
  const latest = new Map<string, number>();
  // Newest-first, so the first entry per workspace is its latest.
  for (const entry of get(conversationListAtom)) {
    if (entry.buddyWorkspaceId !== null && !latest.has(entry.buddyWorkspaceId))
      latest.set(entry.buddyWorkspaceId, entry.activityMs);
  }
  return latest;
}, sameMap);

// Most recently active workspace first (by its Buddies' latest conversation),
// then by name: the Channels tab opens where the team is working, not
// whichever workspace sorts first alphabetically (that was often an empty one).
export function overviewWorkspaces(
  overview: BuddyOverview | null,
  lastActive: ReadonlyMap<string, number>
): OverviewWorkspace[] {
  return (overview ?? [])
    .map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      lastActiveMs: lastActive.get(workspace.id) ?? 0,
    }))
    .sort((a, b) => b.lastActiveMs - a.lastActiveMs || a.name.localeCompare(b.name));
}

/** /channels — the tab's entry: open the most recently active workspace's channels. */
export function ChannelsIndex() {
  const overview = useBuddyOverview();
  const [first] = overviewWorkspaces(overview.data, useAtomValue(buddyWorkspaceActivityAtom));
  if (first) return <Navigate to={channelsHref(first.id, { kind: 'home' })} replace />;
  return (
    <MobilePage title="Channels" subtitle={overview.data ? 'No workspaces' : 'Loading…'}>
      {overview.data && (
        <MobileEmptyPanel>Create a Buddy in a workspace to start its channels.</MobileEmptyPanel>
      )}
    </MobilePage>
  );
}
