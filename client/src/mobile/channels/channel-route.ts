/**
 * Which mobile channels screen a URL names. The URL is the one desktop uses —
 * /buddies/workspaces/:id/channels?channel=&thread=&post=&dm= — so links work on
 * both devices; mobile renders it as Slack does on a phone: one screen at a
 * time. `post` is the reply a permalink names (components/buddies/channel-link.ts).
 * `dm` is a Buddy DM and wins over a channel still in the query, so Back can
 * drop `dm` and return to the channel the DM was opened from.
 *
 *   D = Home (channel list + Buddies) ⊕ Channel ⊕ Thread ⊕ DM
 */
export type MobileChannelScreen =
  | { kind: 'home' }
  | { kind: 'channel'; listId: string }
  | { kind: 'thread'; listId: string; rootId: string; linkedPostId: string | null }
  | { kind: 'dm'; conversationId: string };

const CHANNELS_PATH = /^\/buddies\/workspaces\/[^/]+\/channels\/?$/;

export function mobileChannelScreen(search: string): MobileChannelScreen {
  const params = new URLSearchParams(search);
  const dm = params.get('dm');
  if (dm) return { kind: 'dm', conversationId: dm };
  const listId = params.get('channel');
  const rootId = params.get('thread');
  if (listId && rootId) return { kind: 'thread', listId, rootId, linkedPostId: params.get('post') };
  if (listId) return { kind: 'channel', listId };
  return { kind: 'home' };
}

/**
 * Inside a channel or thread the screen is a full-height pane with its
 * composer pinned to the bottom and no tab bar — Slack's conversation screen.
 * Home keeps the tab bar and scrolls as a page.
 */
export function isImmersiveChannelRoute(pathname: string, search: string): boolean {
  return CHANNELS_PATH.test(pathname) && mobileChannelScreen(search).kind !== 'home';
}

export function channelsHref(workspaceId: string, screen: MobileChannelScreen): string {
  const base = `/buddies/workspaces/${encodeURIComponent(workspaceId)}/channels`;
  switch (screen.kind) {
    case 'home':
      return base;
    case 'channel':
      return `${base}?channel=${encodeURIComponent(screen.listId)}`;
    case 'thread': {
      const thread = `${base}?channel=${encodeURIComponent(screen.listId)}&thread=${encodeURIComponent(screen.rootId)}`;
      return screen.linkedPostId === null
        ? thread
        : `${thread}&post=${encodeURIComponent(screen.linkedPostId)}`;
    }
    case 'dm':
      return `${base}?dm=${encodeURIComponent(screen.conversationId)}`;
  }
}
