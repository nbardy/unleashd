import type { BuddyMailingListPost } from './contract';

// "A channel post was written", with the post. Posts reach the store by three
// doors: the owner HTTP route (channel-routes.ts), a Buddy's `post` tool
// (operations.ts, constructed per call) and the server-authored reply to a
// mention (channel-responder.ts). Each announces here so the thread follow-up
// gate sees every post, whoever wrote it. server.ts subscribes the responder.

const listeners = new Set<(post: BuddyMailingListPost) => void>();

export function announceChannelPost(post: BuddyMailingListPost): void {
  for (const listener of listeners) listener(post);
}

export function onChannelPost(listener: (post: BuddyMailingListPost) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
