import type { BuddiesStorePort, BuddyMailingListPost } from './contract';

// Paging for agents moving through a channel (top-level posts) or a thread
// (replies). Every page is oldest-first and hands back the post ids to pass
// as the next `before` (older) / `after` (newer) anchor, null when there is
// nothing further that way. Anchors are keyset positions in the package, so a
// post landing between two reads can neither repeat nor skip a post.

export type PageScope = { list: string } | { thread: string };

export type PageRequest =
  | { kind: 'latest' }
  | { kind: 'earliest' }
  | { kind: 'before'; anchor: string }
  | { kind: 'after'; anchor: string }
  | { kind: 'around'; anchor: BuddyMailingListPost };

export type PostPage = {
  posts: BuddyMailingListPost[];
  older: string | null;
  newer: string | null;
};

type Pager = (
  store: BuddiesStorePort,
  scope: PageScope,
  limit: number
) => {
  olderThan(anchor: string | null): { posts: BuddyMailingListPost[]; more: boolean };
  newerThan(anchor: string | null): { posts: BuddyMailingListPost[]; more: boolean };
};

// Over-fetch one row per direction to learn whether another page exists.
const pager: Pager = (store, scope, limit) => ({
  olderThan(anchor) {
    const rows = store.pagePosts({ ...scope, direction: 'older', anchor, limit: limit + 1 });
    return { posts: rows.slice(-limit), more: rows.length > limit };
  },
  newerThan(anchor) {
    const rows = store.pagePosts({ ...scope, direction: 'newer', anchor, limit: limit + 1 });
    return { posts: rows.slice(0, limit), more: rows.length > limit };
  },
});

const first = (posts: BuddyMailingListPost[]) => posts[0]?.id ?? null;
const last = (posts: BuddyMailingListPost[]) => posts[posts.length - 1]?.id ?? null;

export function readPage(
  store: BuddiesStorePort,
  scope: PageScope,
  request: PageRequest,
  limit: number
): PostPage {
  const read = pager(store, scope, limit);
  switch (request.kind) {
    case 'latest': {
      const page = read.olderThan(null);
      return { posts: page.posts, older: page.more ? first(page.posts) : null, newer: null };
    }
    case 'earliest': {
      const page = read.newerThan(null);
      return { posts: page.posts, older: null, newer: page.more ? last(page.posts) : null };
    }
    case 'before': {
      // Everything after this page is at least the anchor, so `newer` is
      // always available: pass the page's last id to continue forward.
      const page = read.olderThan(request.anchor);
      return {
        posts: page.posts,
        older: page.more ? first(page.posts) : null,
        newer: last(page.posts),
      };
    }
    case 'after': {
      const page = read.newerThan(request.anchor);
      return {
        posts: page.posts,
        older: first(page.posts),
        newer: page.more ? last(page.posts) : null,
      };
    }
    case 'around': {
      const half = Math.max(1, Math.floor(limit / 2));
      const before = pager(store, scope, half).olderThan(request.anchor.id);
      const after = pager(store, scope, half).newerThan(request.anchor.id);
      const posts = [...before.posts, request.anchor, ...after.posts];
      return {
        posts,
        older: before.more ? first(posts) : null,
        newer: after.more ? last(posts) : null,
      };
    }
  }
}
