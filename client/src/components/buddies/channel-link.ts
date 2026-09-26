import type { BuddyMailingListPost } from '@unleashd/shared';

/**
 * Shareable links into a workspace's channels, for pasting into a bug report
 * when a thread is confusing or a Buddy reply is wrong. They use the URL both
 * device trees already route on — /buddies/workspaces/:id/channels
 * ?channel=&thread=&post= (mobile parses it in mobile/channels/channel-route.ts)
 * — so one link opens the same place on desktop and phone.
 *
 *   D = Channel ⊕ Thread ⊕ Reply ⊕ DM
 *
 * A top-level message IS its thread's root, so its link is the thread link.
 * That is deliberate: the thread pane fetches the root by id, so the link
 * works however old the post is, without paging the channel pane back to it
 * (it loads older posts only as the reader scrolls up). A reply opens its
 * thread and scrolls to itself (`post=`).
 */
export type ChannelLink =
  | { kind: 'channel'; listId: string }
  | { kind: 'thread'; listId: string; rootId: string }
  | { kind: 'reply'; listId: string; rootId: string; postId: string }
  | { kind: 'dm'; conversationId: string };

export function postLink(post: BuddyMailingListPost): ChannelLink {
  return post.threadRootId === null
    ? { kind: 'thread', listId: post.listId, rootId: post.id }
    : { kind: 'reply', listId: post.listId, rootId: post.threadRootId, postId: post.id };
}

function linkParams(link: ChannelLink): Record<string, string> {
  switch (link.kind) {
    case 'channel':
      return { channel: link.listId };
    case 'thread':
      return { channel: link.listId, thread: link.rootId };
    case 'reply':
      return { channel: link.listId, thread: link.rootId, post: link.postId };
    case 'dm':
      return { dm: link.conversationId };
  }
}

export function channelLinkPath(workspaceId: string, link: ChannelLink): string {
  const query = new URLSearchParams(linkParams(link));
  return `/buddies/workspaces/${encodeURIComponent(workspaceId)}/channels?${query}`;
}
