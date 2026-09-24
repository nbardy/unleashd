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

export const BuddyChannelThreadSchema = z.object({
  root: BuddyMailingListPostSchema,
  replies: BuddyMailingListPostsSchema,
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
