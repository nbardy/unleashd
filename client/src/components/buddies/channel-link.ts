import type { Post } from './types';

/**
 * Shareable links into a workspace's channels, for pasting into a bug report
 * when a thread is confusing or a Buddy reply is wrong. They use the URL both
 * device trees already route on — /buddies/workspaces/:id/channels
 * ?channel=&thread=&post= (mobile parses it in mobile/channels/channel-route.ts)
 * — so one link opens the same place on desktop and phone. `channel` is a
 * channel id of any kind (public or direct).
 *
 *   D = Channel ⊕ Thread ⊕ Reply
 *
 * A top-level message IS its thread's root, so its link is the thread link:
 * the thread pane fetches the root by id, so the link works however old the
 * post is. A reply (`post=`) opens its thread on a page that starts FROM the
 * reply (`?from=`), so it is on screen and highlighted however old it is; the
 * T11 migration opened the newest page only and missed older replies (T22).
 */
export type ChannelLink =
  | { kind: 'channel'; channelId: string }
  | { kind: 'thread'; channelId: string; rootId: string }
  | { kind: 'reply'; channelId: string; rootId: string; postId: string };

export function postLink(post: Post): ChannelLink {
  return post.rootId === undefined
    ? { kind: 'thread', channelId: post.channelId, rootId: post.id }
    : { kind: 'reply', channelId: post.channelId, rootId: post.rootId, postId: post.id };
}

function linkParams(link: ChannelLink): Record<string, string> {
  switch (link.kind) {
    case 'channel':
      return { channel: link.channelId };
    case 'thread':
      return { channel: link.channelId, thread: link.rootId };
    case 'reply':
      return { channel: link.channelId, thread: link.rootId, post: link.postId };
  }
}

export function channelLinkPath(workspaceId: string, link: ChannelLink): string {
  const query = new URLSearchParams(linkParams(link));
  return `/buddies/workspaces/${encodeURIComponent(workspaceId)}/channels?${query}`;
}
