/**
 * client/src/components/buddies/types.ts
 *
 * The Buddy owner API's shapes (server/src/buddies/routes.ts). Every domain
 * type is the crate's generated one (`@unleashd/buddies-core`, the same
 * `index.d.ts` the server compiles against), so a crate rename fails the
 * client build instead of drifting. Only the route envelopes are declared here.
 * Pure types: mobile may import this file (gate G3).
 */
import type {
  Buddy,
  Channel,
  Cursor,
  Post,
  Run,
  Schedule,
  Task,
  Workspace,
} from '@unleashd/buddies-core';

// Pattern: one-type-source (docs/patterns.md#one-type-source)
export type {
  Actor,
  Buddy,
  Channel,
  ChannelKind,
  ChannelUnread,
  Cursor,
  Doc,
  DocKind,
  DocRevision,
  Inbox,
  Post,
  PostPage,
  RequestState,
  Run,
  RunInput,
  RunStatus,
  Schedule,
  Task,
  TaskStatus,
  Workspace,
} from '@unleashd/buddies-core';

/** A Buddy page section; each is a URL segment (buddy-tabs.ts). */
export type EmployeeTab =
  | 'conversations'
  | 'work'
  | 'mailbox'
  | 'background'
  | 'memory'
  | 'schedules'
  | 'settings';

/** GET /api/buddies/overview: one entry per workspace, archived Buddies included. */
export type WorkspaceRoster = Workspace & { buddies: Buddy[] };
export type BuddyOverview = WorkspaceRoster[];

/** GET /api/buddies/:buddyId */
export interface BuddyDetail {
  buddy: Buddy;
  tasks: Task[];
  schedules: Schedule[];
  runs: Run[];
}

/** GET /api/buddies/tasks/:taskId — comments are the task channel's posts, newest first. */
export interface TaskDetail {
  task: Task;
  channel: Channel;
  children: Task[];
  comments: Post[];
  runs: Run[];
}

/** GET /api/buddies/posts/:postId/thread — replies newest first. */
export interface ThreadPage {
  root: Post;
  posts: Post[];
  next?: Cursor;
}

/** GET /api/buddies/channels/:channelId/responding */
export interface ChannelResponse {
  channelId: string;
  threadRootId: string;
  buddyId: string;
  startedAt: string;
  state: 'replying' | 'queued';
}

/** POST /api/buddies/channels/:channelId/posts (and /direct/posts) */
export interface PostResult {
  post: Post;
  mentions: MentionDispatch[];
}

/** Whether an owner @mention in a public channel started the Buddy's reply. */
export type MentionDispatch =
  | { buddyId: string; status: 'started' }
  | { buddyId: string; status: 'rejected'; reason: string };
