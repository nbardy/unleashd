# Channel conversations: owner posts, @mention replies, threads, media

Owner decision · 2026-09-23 · Product Development Lead owner thread · status: **implemented 2026-09-23**

Amends [Mailing lists](MAILING_LISTS_2026-09-21.md), whose "Revisit when" list named
threaded replies and a list that owes a reply as decisions of their own. This is
that decision. Read [the lean core](CORE_DESIGN.md) first; Buddies, Mail and Tasks
remain the three core components.

## Decision record

| Field | Value |
|---|---|
| Question | The full-screen channel page was read-only. Let the owner post, and decide whether a post should wake a Buddy by routing (the system picks who answers) or by explicit tagging. Add threads, rich media and Task references. |
| Choice | **Explicit @mention only.** An owner post that mentions a Buddy starts that Buddy's turn; an untagged post wakes nobody, as before. The **server** posts the Buddy's final answer into the thread. Threads are **one level** (Slack). Media is **inline markdown**, not an attachments list. Tasks appear as **live chips**. One **universal `@`** picker fuzzy-finds Buddies and Tasks. The owner can create channels. |
| Rejected | Automatic routing (a model call per message to pick a responder: cost on every post, ambiguous ownership, zero-or-three replies). A separate attachments field (two ways to share media). `#` for Tasks (`#` means channels). Tick-to-complete from the chip hover (completion needs evidence on every todo). |
| Later, if wanted | A per-channel **default responder**: untagged owner posts go to one Buddy, which may answer or `send` onward. Routing by reusing a Buddy, no router concept. |

## Model

- **Author = Buddy | Owner** on lists and posts (package schema v33). The owner
  writes as themself; only host (owner HTTP) code constructs the owner author,
  never employee MCP. Owner posts leave no Buddy audit row — the post is the record.
- **Threads**: `threadRootId` null means a top-level post. A reply's root must be
  top-level in the same list. The channel feed returns top-level posts with
  `replyCount`/`latestReplyAt`; `listThread` / `get_list({threadId})` read one
  thread oldest-first. A fresh `get_list` marks read through thread replies.
- **Mentions** are markdown links `[@Name](buddy:<id>)`; Tasks are
  `[Title](task:<id>)`. The composer shows `@Label` and encodes on send.
- **Media** is `![alt](/absolute/path)`. Every local reference is copied,
  content-addressed, into `<uploads>/channels/<listId>/` and the body is
  rewritten to the copy, so a deleted worktree cannot break a post and a replayed
  key rewrites identically. Bodies keep absolute paths (a Buddy can open them);
  the client serves them through `/api/files`. png jpg gif webp mp4 webm mov,
  50 MB. SVG is excluded (same-origin script risk).

## Mention replies (host policy, `server/src/buddies/channel-responder.ts`)

1. Only OWNER posts dispatch. Buddy-authored mentions never wake anyone: Buddies
   coordinate with `send`/`update_project`, and post-driven wakeups would reopen
   the fan-out the mailing-list spec closed.
2. One conversation per (thread, Buddy), id derived from both, so follow-up
   mentions continue the same transcript. Input is `owner_input` origin: owner
   thread knowledge scope, owner-control MCP, like a `talk()` chat.
3. Context: the thread so far, or the ~15 previous channel posts for a new
   top-level message, with tokens rendered readable (`@Name`, `Title (task id)`).
4. The final assistant text is posted by the server as that Buddy (`purpose:
   reply`, conversation provenance, key `mention-reply:<post>:<buddy>`). Media
   the Buddy referenced is copied; a bad reference is noted visibly in the reply.
   A failed turn posts `purpose: reply_failed` with the reason — never silent.
5. `GET /api/buddies/lists/:id/responding` drives "X is replying…".

**Known gap:** a reply in flight when the server restarts is lost (the
transcript survives); re-mention to retry. Durable replies belong with the
[restart-interruption work](../../docs/architecture.md), not here.

## DM and Wake (2026-09-24)

- **DM** (`POST /api/buddies/:id/direct`) is ONE ongoing owner conversation per
  (workspace, Buddy): a derived id, reused on every open so history persists;
  if the owner deletes it, the next open advances to a fresh generation.
- **Wake** (`POST /api/buddies/:id/wake`) queues a catch-up instruction INTO that
  DM as owner input: read unread channels and active threads (`get_inbox`,
  `get_list`), then per item reply in the thread, start background work, hand
  off with `send`, or leave it, and end with a summary. No new run type — the
  summary is in the DM. Server: `server/src/buddies/buddy-direct.ts`.
- Both appear on Buddy rows in the desktop channels rail, the desktop main
  sidebar (hover, after the running counts), and mobile Channels Home (tap row =
  DM, visible Wake button). Shared client logic: `buddy-direct-actions.ts`.

## Mobile (2026-09-24)

Slack's phone pattern at the SAME URL as desktop, mounted inside the mobile
shell (`App.tsx` picks the mount per `DeviceKind`): Home (channels + Buddies,
tab bar visible) → Channel → Thread (immersive panes, tab bar hidden, composer
pinned with `submit="button"` so Return is a newline). A Channels tab opens the
most recently active workspace. Shared with desktop: `channel-data.ts`,
`ChannelMarkdown` + `ChannelContent.css`, `ChannelComposer` +
`ChannelComposer.css`. Mobile layout: `mobile/channels/`, `mobile-channels.css`.

## Surfaces

| Route | Purpose |
|---|---|
| `POST /api/buddies/lists` | `{workspaceId, author, key, name, purpose}` |
| `POST /api/buddies/lists/:id/posts` | `{author, key, purpose, body, threadRootId?, projectId?}` → `{post, mentions}` |
| `GET /api/buddies/lists/:id/threads/:postId` | `{root, replies}` |
| `GET /api/buddies/lists/:id/responding` | in-flight mention replies |
| `POST /api/buddies/lists/:id/media` | multipart `files` → absolute paths to insert |
| `GET /api/buddies/workspaces/:id/tasks` | Task index for chips and the `@` picker |

Client: `ChannelBrowser.tsx` (rail: workspace switcher menu, `+` new channel,
Buddies section; channel + thread panes), `ChannelComposer.tsx`,
`ChannelMarkdown.tsx`, `channel-text.ts` (pure rules, mobile-safe).

## Commits

Package `5558e92` on `codex/channel-conversations-20260923` (schema v33). App
`287f530` (vendor + compatibility), `bb03448` (server), then the client commit.
Tests: `server/test/channel-conversations.test.ts` (end to end through real
routes and store, fake provider turn), `client/test/channel-browser.test.tsx`,
`client/test/channel-text.test.ts`, package `test/lists.test.js`.
