/**
 * Which mobile channels screen a URL names. The URL is the one desktop uses —
 * /buddies/workspaces/:id/channels?channel=&thread= — so links work on both
 * devices; mobile renders it as Slack does on a phone: one screen at a time.
 *
 *   D = Home (channel list + Buddies) ⊕ Channel ⊕ Thread
 */
export type MobileChannelScreen =
  | { kind: 'home' }
  | { kind: 'channel'; listId: string }
  | { kind: 'thread'; listId: string; rootId: string };

const CHANNELS_PATH = /^\/buddies\/workspaces\/[^/]+\/channels\/?$/;

export function mobileChannelScreen(search: string): MobileChannelScreen {
  const params = new URLSearchParams(search);
  const listId = params.get('channel');
  const rootId = params.get('thread');
  if (listId && rootId) return { kind: 'thread', listId, rootId };
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
    case 'thread':
      return `${base}?channel=${encodeURIComponent(screen.listId)}&thread=${encodeURIComponent(screen.rootId)}`;
  }
}
