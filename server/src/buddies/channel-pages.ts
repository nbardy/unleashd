import type { BuddiesStorePort, BuddyMailingListPost } from './contract';

// Paging for agents moving through a channel (top-level posts) or a thread
// (replies). Every page is oldest-first and hands back the post ids to pass
// as the next `before` (older) / `after` (newer) anchor, null when there is
// nothing further that way. Anchors are keyset positions in the package, so a
// post landing between two reads can neither repeat nor skip a post.
//
// The owner's channel view pages the same keyset (`readChannel` below).

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

type Slice = { posts: BuddyMailingListPost[]; more: boolean };

// Each read over-fetches one row to learn whether another page exists.
function olderThan(
  store: BuddiesStorePort,
  scope: PageScope,
  anchor: string | null,
  limit: number
): Slice {
  const rows = store.pagePosts({ ...scope, direction: 'older', anchor, limit: limit + 1 });
  return { posts: rows.slice(-limit), more: rows.length > limit };
}

function newerThan(
  store: BuddiesStorePort,
  scope: PageScope,
  anchor: string | null,
  limit: number
): Slice {
  const rows = store.pagePosts({ ...scope, direction: 'newer', anchor, limit: limit + 1 });
  return { posts: rows.slice(0, limit), more: rows.length > limit };
}

const first = (posts: BuddyMailingListPost[]) => posts[0]?.id ?? null;
const last = (posts: BuddyMailingListPost[]) => posts[posts.length - 1]?.id ?? null;

export function readPage(
  store: BuddiesStorePort,
  scope: PageScope,
  request: PageRequest,
  limit: number
): PostPage {
  switch (request.kind) {
    case 'latest': {
      const page = olderThan(store, scope, null, limit);
      return { posts: page.posts, older: page.more ? first(page.posts) : null, newer: null };
    }
    case 'earliest': {
      const page = newerThan(store, scope, null, limit);
      return { posts: page.posts, older: null, newer: page.more ? last(page.posts) : null };
    }
    // Paging from an anchor, the anchor side always has more (the anchor
    // itself), so that side's cursor is simply the page edge.
    case 'before': {
      const page = olderThan(store, scope, request.anchor, limit);
      return {
        posts: page.posts,
        older: page.more ? first(page.posts) : null,
        newer: last(page.posts),
      };
    }
    case 'after': {
      const page = newerThan(store, scope, request.anchor, limit);
      return {
        posts: page.posts,
        older: first(page.posts),
        newer: page.more ? last(page.posts) : null,
      };
    }
    case 'around': {
      const half = Math.max(1, Math.floor(limit / 2));
      const before = olderThan(store, scope, request.anchor.id, half);
      const after = newerThan(store, scope, request.anchor.id, half);
      const posts = [...before.posts, request.anchor, ...after.posts];
      return {
        posts,
        older: before.more ? first(posts) : null,
        newer: after.more ? last(posts) : null,
      };
    }
  }
}

// The owner's channel read (GET /api/buddies/lists/:listId/posts), newest-first:
//   D = Older(anchor, limit) ⊕ From(floor)
// Older with a null anchor is the newest page; with a post, the page before
// it. From is the window a reader holds once they have paged back: the floor
// and every newer post. Re-reading the newest page instead would slide the
// window, pushing the oldest post out above the reader on every new post,
// and leave a gap between it and the history they loaded.
export type ChannelRead =
  | { kind: 'older'; anchor: string | null; limit: number }
  | { kind: 'from'; floor: BuddyMailingListPost };

// The package's per-read ceiling (MAX_THREAD_REPLIES_PER_READ).
const READ_CHUNK = 200;

export function readChannel(
  store: BuddiesStorePort,
  list: string,
  read: ChannelRead
): BuddyMailingListPost[] {
  switch (read.kind) {
    case 'older':
      return store
        .pagePosts({ list, direction: 'older', anchor: read.anchor, limit: read.limit })
        .reverse();
    case 'from':
      return readFrom(store, list, read.floor).reverse();
  }
}

// Unbounded on purpose: it is exactly what the reader already scrolled back
// through, in chunks of the package ceiling.
function readFrom(
  store: BuddiesStorePort,
  list: string,
  floor: BuddyMailingListPost
): BuddyMailingListPost[] {
  const posts = [floor];
  for (let anchor = floor.id; ; ) {
    const rows = store.pagePosts({ list, direction: 'newer', anchor, limit: READ_CHUNK });
    posts.push(...rows);
    if (rows.length < READ_CHUNK) return posts;
    anchor = rows[rows.length - 1].id;
  }
}
