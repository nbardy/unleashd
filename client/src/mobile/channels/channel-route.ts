/**
 * Which mobile channels screen a URL names. The URL is the one desktop uses —
 * /buddies/workspaces/:id/channels?channel=&thread=&post=&task= — so links work
 * on both devices; mobile renders it as Slack does on a phone: one screen at a
 * time. `post` is the reply a permalink names (components/buddies/channel-link.ts);
 * `task` is the Task filter (one Task's posts across every channel), opened
 * from its channel.
 *
 *   D = Home (channel list + Buddies) ⊕ Channel ⊕ Thread ⊕ Task ⊕ DM
 *
 * `dm` is a Buddy DM conversation drawn as a thread (493c1c7). It wins over the other params,
 * which stay in the URL so Back (dropping `dm`) returns to the screen the DM was opened from.
 */
export type MobileChannelScreen =
  | { kind: 'home' }
  | { kind: 'channel'; channelId: string }
  | { kind: 'thread'; channelId: string; rootId: string; linkedPostId: string | null }
  | { kind: 'task'; channelId: string; taskId: string }
  | { kind: 'dm'; conversationId: string };

const CHANNELS_PATH = /^\/buddies\/workspaces\/[^/]+\/channels\/?$/;

export function mobileChannelScreen(search: string): MobileChannelScreen {
  const params = new URLSearchParams(search);
  const channelId = params.get('channel');
  const rootId = params.get('thread');
  const taskId = params.get('task');
  const dm = params.get('dm');
  if (dm) return { kind: 'dm', conversationId: dm };
  if (channelId && rootId)
    return { kind: 'thread', channelId, rootId, linkedPostId: params.get('post') };
  if (channelId && taskId) return { kind: 'task', channelId, taskId };
  if (channelId) return { kind: 'channel', channelId };
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
      return `${base}?channel=${encodeURIComponent(screen.channelId)}`;
    case 'thread': {
      const thread = `${base}?channel=${encodeURIComponent(screen.channelId)}&thread=${encodeURIComponent(screen.rootId)}`;
      return screen.linkedPostId === null
        ? thread
        : `${thread}&post=${encodeURIComponent(screen.linkedPostId)}`;
    }
    case 'task':
      return `${base}?channel=${encodeURIComponent(screen.channelId)}&task=${encodeURIComponent(screen.taskId)}`;
    case 'dm':
      return `${base}?dm=${encodeURIComponent(screen.conversationId)}`;
  }
}
