import type { BuddiesStorePort, BuddyMailingListPost } from './contract';

// Paging for agents moving through a channel (top-level posts) or a thread
// (replies). Every page is oldest-first and hands back the post ids to pass
// as the next `before` (older) / `after` (newer) anchor, null when there is
// nothing further that way. Anchors are keyset positions in the package, so a
// post landing between two reads can neither repeat nor skip a post.
//
// The owner's feeds page the same keyset (`readFeed` below).

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

// The owner's feeds (routes.ts), each read newest-first the same way:
//   D = Channel(its top-level posts) ⊕ Thread(one root's replies)
//     ⊕ Task(one Task's posts across a workspace's channels, replies included)
export type OwnerFeed =
  | { kind: 'channel'; list: string }
  | { kind: 'thread'; root: string }
  | { kind: 'task'; workspace: string; project: string };

// One read of a feed: D = Older(anchor, limit) ⊕ From(floor).
// Older with a null anchor is the newest page; with a post, the page before
// it. From is the window a reader holds once they have paged back: the floor
// and every newer post. Re-reading the newest page instead would slide the
// window, pushing the oldest post out above the reader on every new post,
// and leave a gap between it and the history they loaded.
export type FeedRead =
  | { kind: 'older'; anchor: BuddyMailingListPost | null; limit: number }
  | { kind: 'from'; floor: BuddyMailingListPost };

/** κ's membership check for a read's anchor or floor. */
export function inFeed(feed: OwnerFeed, post: BuddyMailingListPost): boolean {
  switch (feed.kind) {
    case 'channel':
      return post.listId === feed.list && post.threadRootId === null;
    case 'thread':
      return post.threadRootId === feed.root;
    case 'task':
      return post.workspaceId === feed.workspace && post.projectId === feed.project;
  }
}

// A From read's chunk: the most listPosts returns at once (pagePosts allows 200).
const FROM_CHUNK = 50;

export function readFeed(
  store: BuddiesStorePort,
  feed: OwnerFeed,
  read: FeedRead
): BuddyMailingListPost[] {
  switch (read.kind) {
    case 'older': {
      const page: BuddyMailingListPost[] = [];
      for (const post of olderPosts(store, feed, read.anchor, read.limit)) {
        page.push(post);
        if (page.length === read.limit) break;
      }
      return page;
    }
    case 'from': {
      // Unbounded on purpose: it is exactly what the reader already paged back through.
      const window: BuddyMailingListPost[] = [];
      for (const post of olderPosts(store, feed, null, FROM_CHUNK)) {
        if (!newer(post, read.floor)) break;
        window.push(post);
      }
      return [...window, read.floor];
    }
  }
}

// The package's post order: createdAt, then id.
function newer(a: BuddyMailingListPost, b: BuddyMailingListPost): boolean {
  return a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id > b.id);
}

// One feed newest-first, strictly older than `anchor` (from the newest when
// null), `chunk` posts per store read and only as far as the caller reads on.
function olderPosts(
  store: BuddiesStorePort,
  feed: OwnerFeed,
  anchor: BuddyMailingListPost | null,
  chunk: number
): Iterable<BuddyMailingListPost> {
  switch (feed.kind) {
    case 'channel':
      return keysetOlder(store, { list: feed.list }, anchor, chunk);
    case 'thread':
      return keysetOlder(store, { thread: feed.root }, anchor, chunk);
    case 'task':
      return offsetOlder(store, feed, anchor, chunk);
  }
}

// A channel's roots and a thread's replies page by keyset in the package.
function* keysetOlder(
  store: BuddiesStorePort,
  scope: PageScope,
  anchor: BuddyMailingListPost | null,
  chunk: number
): Generator<BuddyMailingListPost> {
  for (let cursor = anchor?.id ?? null; ; ) {
    const rows = store
      .pagePosts({ ...scope, direction: 'older', anchor: cursor, limit: chunk })
      .reverse();
    yield* rows;
    if (rows.length < chunk) return;
    cursor = rows[rows.length - 1].id;
  }
}

// The package reads a Task's posts only by offset (listPosts, newest-first).
// The keyset holds anyway: a read keeps only posts older than the last one
// taken, so a post landing between two reads (another process writes the same
// database), which shifts every later offset by one, repeats nothing; and
// posts are never deleted, so no offset skips one. The price is reading down
// from the newest to the anchor, which a From read of that window pays anyway.
function* offsetOlder(
  store: BuddiesStorePort,
  task: { workspace: string; project: string },
  anchor: BuddyMailingListPost | null,
  chunk: number
): Generator<BuddyMailingListPost> {
  let last = anchor;
  for (let offset = 0; ; offset += chunk) {
    const rows = store.listPosts({
      workspace: task.workspace,
      project: task.project,
      limit: chunk,
      offset,
    });
    for (const post of rows) {
      if (last !== null && !newer(last, post)) continue;
      last = post;
      yield post;
    }
    if (rows.length < chunk) return;
  }
}
