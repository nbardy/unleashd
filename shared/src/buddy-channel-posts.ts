import { z } from 'zod';
import { BuddyMemberExecutionSchema } from './buddy-workspace-activity.js';
import { ConversationConfigSchema } from './conversation-config.js';

// Wire shape of a channel post (Buddies list schema v33). The client parses
// every post fetch with these, so a server serving another shape fails loudly
// at the fetch instead of deep in rendering: on 2026-09-23 a server started
// before the v33 vendor bump still sent `fromBuddyId` with no `author`, and
// the channel view crashed in `authorKey`.
export const BuddyListAuthorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('buddy'), buddyId: z.string() }),
  z.object({ kind: z.literal('owner') }),
]);

export const BuddyMailingListPostSchema = z.object({
  id: z.string(),
  listId: z.string(),
  workspaceId: z.string(),
  author: BuddyListAuthorSchema,
  threadRootId: z.string().nullable(),
  replyCount: z.number(),
  latestReplyAt: z.string().nullable(),
  purpose: z.string(),
  body: z.string(),
  evidence: z.array(z.string()),
  projectId: z.string().nullable(),
  createdAt: z.string(),
  senderConversationId: z.string().nullable(),
  senderRunId: z.string().nullable(),
});

export const BuddyMailingListPostsSchema = z.array(BuddyMailingListPostSchema);

// The harness, model, and reasoning a Buddy's next reply in this thread runs
// on: its latest seat, not the profile default. Absent until that Buddy has
// one. `.default([])` so a server that predates the field still parses.
export const ThreadSeatSchema = z.object({
  buddyId: z.string(),
  config: ConversationConfigSchema,
});

export const BuddyChannelThreadSchema = z.object({
  root: BuddyMailingListPostSchema,
  replies: BuddyMailingListPostsSchema,
  seats: z.array(ThreadSeatSchema).default([]),
});

export const BuddyMentionDispatchSchema = z.discriminatedUnion('status', [
  // No conversation id: the reply queues for the Buddy's thread seat, which
  // is only chosen when the reply runs (channel-responder.ts).
  z.object({ buddyId: z.string(), status: z.literal('started') }),
  z.object({ buddyId: z.string(), status: z.literal('rejected'), reason: z.string() }),
]);

// The owner's model choice for one mentioned Buddy, sent beside the post (not
// in its body, so the channel reads the same either way). A mentioned Buddy
// with no entry replies on whatever its thread already runs: its profile
// default for a new thread.
export const OwnerPostMentionConfigSchema = z.object({
  buddyId: z.string().min(1),
  config: ConversationConfigSchema,
});

export const BuddyOwnerPostResultSchema = z.object({
  post: BuddyMailingListPostSchema,
  mentions: z.array(BuddyMentionDispatchSchema),
});

export type BuddyListAuthor = z.infer<typeof BuddyListAuthorSchema>;
export type BuddyMailingListPost = z.infer<typeof BuddyMailingListPostSchema>;
export type ThreadSeat = z.infer<typeof ThreadSeatSchema>;
export type BuddyChannelThread = z.infer<typeof BuddyChannelThreadSchema>;
export type BuddyMentionDispatch = z.infer<typeof BuddyMentionDispatchSchema>;
export type OwnerPostMentionConfig = z.infer<typeof OwnerPostMentionConfigSchema>;
export type BuddyOwnerPostResult = z.infer<typeof BuddyOwnerPostResultSchema>;

// A reference picked from the channel composer's @ menu. The composer shows
// `@Label` and swaps it for the token on send, so the pick is state beside
// the text, not part of it.
export const ChannelReferenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('buddy'),
    id: z.string(),
    label: z.string(),
    detail: z.string(),
    execution: BuddyMemberExecutionSchema,
  }),
  z.object({
    kind: z.literal('task'),
    id: z.string(),
    label: z.string(),
    detail: z.string(),
    status: z.string(),
  }),
]);

// An unsent channel/thread composer draft (device-local, localStorage
// `draft:channel:…`). It keeps the picks with the text: text alone would
// restore `@Lead` as plain words and the post would mention nobody.
export const ChannelComposerDraftSchema = z.object({
  text: z.string(),
  picked: z.array(ChannelReferenceSchema),
});

export type ChannelReference = z.infer<typeof ChannelReferenceSchema>;
export type ChannelComposerDraft = z.infer<typeof ChannelComposerDraftSchema>;

// The owner's channel read state (server/src/buddies/owner-channel-reads.ts):
// kept apart from the Buddies' own read marks. A channel the owner has never
// opened reads from the baseline, the moment owner read state began.
export const OwnerReadThroughSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('post'), postId: z.string(), createdAt: z.string() }),
  z.object({ kind: z.literal('baseline'), at: z.string() }),
]);

export const OwnerListUnreadSchema = z.object({
  listId: z.string(),
  readThrough: OwnerReadThroughSchema,
  // What "mark read" echoes back; null only for a channel with no posts.
  newestPostId: z.string().nullable(),
  // Top-level posts by others since readThrough: the channel shows bold.
  unread: z.number(),
  // Replies by others in threads the owner started or replied in: the badge.
  repliesToYou: z.number(),
  // Thread roots with a reply by others since readThrough.
  unreadThreads: z.array(z.string()),
});

export const OwnerChannelUnreadSchema = z.object({
  workspaces: z.array(z.object({ workspaceId: z.string(), lists: z.array(OwnerListUnreadSchema) })),
  // The scan stopped early: every count is a lower bound.
  capped: z.boolean(),
});

export type OwnerReadThrough = z.infer<typeof OwnerReadThroughSchema>;
export type OwnerListUnread = z.infer<typeof OwnerListUnreadSchema>;
export type OwnerChannelUnread = z.infer<typeof OwnerChannelUnreadSchema>;

// Posts order by (createdAt, id), the Buddies package's keyset order. The
// server counts unread with this and the client draws "New messages" with it,
// so the two can never disagree about which post is the first unread one.
export function isAfterReadThrough(
  post: { id: string; createdAt: string },
  readThrough: OwnerReadThrough
): boolean {
  switch (readThrough.kind) {
    case 'post':
      return (
        post.createdAt > readThrough.createdAt ||
        (post.createdAt === readThrough.createdAt && post.id > readThrough.postId)
      );
    case 'baseline':
      return post.createdAt > readThrough.at;
  }
}
