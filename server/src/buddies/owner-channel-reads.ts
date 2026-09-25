import fs from 'node:fs';
import path from 'node:path';
import {
  type OwnerChannelUnread,
  type OwnerListUnread,
  type OwnerReadThrough,
  isAfterReadThrough as isAfter,
} from '@unleashd/shared';
import type { BuddiesStorePort, BuddyMailingListPost } from './contract';

// The owner's channel read state: where they have read each channel up to,
// and what that leaves unread. It is HOST data, deliberately not the Buddies
// package's `buddy_list_reads`: those marks decide what each Buddy's get_list
// calls unread, and the owner catching up must never move them (nor a Buddy
// reading clear the owner's unread). Owner decision, 2026-09-25.
//
// One mark per channel, advanced to the newest post anywhere in it (replies
// included) when the owner views the channel. Before the owner has read a
// channel its floor is the store's baseline: the moment this file was first
// written. Without it, the first load would call every post in every existing
// channel unread.

type Mark = { postId: string; createdAt: string };
type ReadFile = { version: 1; baselineAt: string; marks: Record<string, Mark> };

// One read scans the workspace's posts newer than the oldest floor. A channel
// ignored for a long time could make that scan unbounded, so it stops here and
// the response says `capped`: the counts are then lower bounds.
const MAX_SCANNED_POSTS = 2000;
const SCAN_PAGE = 50;

export interface OwnerChannelReads {
  unread(store: BuddiesStorePort): OwnerChannelUnread;
  markRead(listId: string, post: BuddyMailingListPost): OwnerReadThrough;
}

export function ownerChannelReads(filePath: string): OwnerChannelReads {
  const load = (): ReadFile => {
    if (!fs.existsSync(filePath)) {
      const fresh: ReadFile = { version: 1, baselineAt: new Date().toISOString(), marks: {} };
      save(fresh);
      return fresh;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ReadFile;
    if (parsed.version !== 1) throw new Error(`Unknown owner read state version in ${filePath}`);
    return parsed;
  };
  const save = (state: ReadFile) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
    fs.renameSync(temporary, filePath);
  };
  let state: ReadFile | null = null;
  const current = () => {
    state ??= load();
    return state;
  };

  return {
    unread(store) {
      const file = current();
      const floorOf = (listId: string): OwnerReadThrough => {
        const mark = file.marks[listId];
        return mark ? readThroughOf(mark) : { kind: 'baseline', at: file.baselineAt };
      };
      let capped = false;
      const workspaces = store.listWorkspaces().map((workspace) => {
        const lists = store.listLists({ workspace: workspace.id });
        const scan = scanWorkspace(
          store,
          workspace.id,
          lists.map((list) => floorOf(list.id))
        );
        capped ||= scan.capped;
        return {
          workspaceId: workspace.id,
          lists: lists.map((list) =>
            tally(
              store,
              list.id,
              floorOf(list.id),
              scan.posts,
              store.newestListPost({ list: list.id })
            )
          ),
        };
      });
      return { workspaces, capped };
    },

    // Forward only, like the package's markListRead: a stale tab echoing an
    // older newest-post id never un-reads what another device already read.
    markRead(listId, post) {
      const file = current();
      const previous = file.marks[listId];
      if (!previous || isAfter(post, readThroughOf(previous))) {
        file.marks[listId] = { postId: post.id, createdAt: post.createdAt };
        save(file);
      }
      return readThroughOf(file.marks[listId]);
    },
  };
}

function readThroughOf(mark: Mark): OwnerReadThrough {
  return { kind: 'post', postId: mark.postId, createdAt: mark.createdAt };
}

function floorInstant(floor: OwnerReadThrough): string {
  switch (floor.kind) {
    case 'post':
      return floor.createdAt;
    case 'baseline':
      return floor.at;
  }
}

// Every post in the workspace, replies included, newer than the oldest floor.
// Newest-first offset pages: a post landing mid-scan shifts rows down, so a row
// can repeat but never be skipped; the id map drops the repeat.
function scanWorkspace(
  store: BuddiesStorePort,
  workspace: string,
  floors: readonly OwnerReadThrough[]
): { posts: BuddyMailingListPost[]; capped: boolean } {
  if (floors.length === 0) return { posts: [], capped: false };
  const oldest = floors.map(floorInstant).reduce((a, b) => (a < b ? a : b));
  const seen = new Map<string, BuddyMailingListPost>();
  for (let offset = 0; offset < MAX_SCANNED_POSTS; offset += SCAN_PAGE) {
    const page = store.listPosts({ workspace, limit: SCAN_PAGE, offset });
    for (const post of page) if (post.createdAt >= oldest) seen.set(post.id, post);
    if (page.length < SCAN_PAGE || page[page.length - 1].createdAt < oldest)
      return { posts: [...seen.values()], capped: false };
  }
  return { posts: [...seen.values()], capped: true };
}

// One channel's owner view of the scanned posts:
//   unread        top-level posts by others after the floor (the bold name)
//   repliesToYou  replies by others after the floor in a thread the owner
//                 started or replied in: what is waiting on the owner (badge)
//   unreadThreads roots with any reply by others after the floor
function tally(
  store: BuddiesStorePort,
  listId: string,
  floor: OwnerReadThrough,
  scanned: readonly BuddyMailingListPost[],
  newest: BuddyMailingListPost | null
): OwnerListUnread {
  const participation = new Map<string, boolean>();
  const ownerIsIn = (rootId: string): boolean => {
    const known = participation.get(rootId);
    if (known !== undefined) return known;
    const thread = store.listThread({ root: rootId });
    const answer = [thread.root, ...thread.replies].some((post) => post.author.kind === 'owner');
    participation.set(rootId, answer);
    return answer;
  };
  let unread = 0;
  let repliesToYou = 0;
  const unreadThreads = new Set<string>();
  for (const post of scanned) {
    if (post.listId !== listId || post.author.kind === 'owner' || !isAfter(post, floor)) continue;
    if (post.threadRootId === null) {
      unread += 1;
      continue;
    }
    unreadThreads.add(post.threadRootId);
    if (ownerIsIn(post.threadRootId)) repliesToYou += 1;
  }
  return {
    listId,
    readThrough: floor,
    newestPostId: newest?.id ?? null,
    unread,
    repliesToYou,
    unreadThreads: [...unreadThreads],
  };
}
