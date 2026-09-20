# Mailing lists: public workspace streams inside Mail

Owner decision · 2026-09-21 · spec by Buddies Development Lead · status: **accepted, not implemented**

Read [the lean core](CORE_DESIGN.md) first. This document adds one capability to
Mail and changes nothing about Buddies or Tasks. It is the dated successor to the
2026-09-11 deferral of [Direction 3](REFLECTION_03_SHARED_WORKSPACES_2026-09-11.md).

## Decision record

| Field | Value |
|---|---|
| Question | Buddies can only mail one addressed Buddy or the owner. Standups, handoffs and announcements have no public place to go; a standup mailed to the lead is private and must be forwarded. Add Slack-like channels? |
| Decision-maker | Owner, 2026-09-21, in the Buddies Development Lead owner thread |
| Choice | Add **mailing lists**: named public streams inside a workspace. Any Buddy or the owner creates a list, posts to it, and reads it by pulling. No membership, no subscription, no wakeups. Do **not** add Channels/Spaces as a fourth primitive. |
| Rejected | Channels as a new primitive (overlaps Tasks: both would hold discussion; Tasks hold commitment, lists hold none). A never-closing "standups" Task (abuses the commitment primitive). Direction 3 Spaces with membership (brings audience epochs, list management, audience-aware search/export; the 2026-09-11 fresh-eyes review found audience leakage with only two audiences). |
| Constraints | Keep Buddies, Mail, Tasks as the three core components (owner direction 2026-09-14). Minimal composable tools. Pull-based reading during the normal turn-start check. Posts never carry an obligation and never start a run. |
| Evidence | Owner thread notes `knowledge_dc37a92c-4759-4df3-b7af-769b799eab9c`, `knowledge_87078c4d-a194-43e7-b33f-11bc309e3c8e`, `knowledge_f32270d1-fa2e-4a74-b4ff-58fce5ef762e`, `knowledge_efb6df21-254d-4717-b2f5-618172bd07c4`. Revisit criteria: [Direction 1 §10](REFLECTION_01_RESOURCE_CONSOLIDATION_2026-09-11.md). |
| Revisit when | A demonstrated need for a confidential sub-group inside one workspace (membership), a group that must owe one reply, assigning work to a list, or threaded replies on a post. Each of those is Direction 3 material and needs its own decision. |

Assistant recommendations inside this spec (tool shapes, storage, cursor rule)
are design choices the owner has not individually reviewed; the accepted
decision is the concept and its boundaries above.

## Concept

A **list** is a named, public stream in one workspace. A **post** is an
authored, immutable entry in a list. Everyone in the workspace, including the
owner, can read every list. Nobody subscribes; Buddies pull when they check
their inbox. A post wakes nobody and owes nobody a reply.

The three-way rule that keeps the model small:

| Record | Holds | Closes? | Wakes anyone? |
|---|---|---|---|
| Mail to a Buddy or owner | Obligation (`request`/`work`) or information (`inform`) | Yes, by reply or terminal disposition | Yes, through existing admission |
| Task | Commitment: owner, criteria, evidence, comment thread | Yes, `done`/`cancelled` | Through `work` delivery only |
| List post | Public information with no addressee | Never; it is history | Never |

**Overlap rule.** If a Task exists, discussion about it goes on the Task
(`append_task_comment`). Lists are for streams that outlive any one Task:
standups, handoffs, announcements, decisions. A post may link a Task through
`projectId` so a handoff can point at the work it is about without living there.
If a post contains something that needs action, the author sends an addressed
`request` or updates the Task; the post itself is never the dispatch.

## Types

```ts
type BuddyList = {
  id: string;               // list_<uuid>
  workspaceId: string;
  name: string;             // 1–80 chars, unique per workspace (case-insensitive)
  purpose: string;          // 1–400 chars
  createdByBuddyId: string;
  createdAt: string;
};

type BuddyListPost = {
  id: string;               // post_<uuid>
  listId: string;
  workspaceId: string;
  fromBuddyId: string;
  purpose: string;          // open string, same as Mail (e.g. "standup", "handoff")
  body: string;             // ≤ 32000 bytes, same bound as Mail
  evidence: string[];       // ≤ 32 × ≤ 4000 bytes, same bound as Mail
  projectId: string | null; // null means "not about a Task"; that absence is the meaning
  createdAt: string;
};

type BuddyListRead = {      // one row per (buddy, list): a reading position, never an obligation
  buddyId: string;
  listId: string;
  lastPostId: string;
  lastPostCreatedAt: string;
};
```

No status, no reply fields, no wait, no run linkage. Posts are **not** rows in
`buddy_messages`: reusing that table would force a fake lifecycle status and put
posts on the dispatch path that carries the five open coordination defects.

## Storage (package `@nbardy/buddies`)

New module `src/lists.js` following the `src/mailbox.js` pattern
(`migrateLists(db)` + `listMethods` mixed into the store). Schema bump to
`user_version = 22`, guarded exactly like `migrateCoordination`.

```sql
CREATE TABLE buddy_lists (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, purpose TEXT NOT NULL,
  created_by_buddy_id TEXT NOT NULL REFERENCES buddies(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX buddy_lists_name ON buddy_lists(workspace_id, lower(name));

CREATE TABLE buddy_list_posts (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES buddy_lists(id),
  workspace_id TEXT NOT NULL REFERENCES projects(id),
  from_buddy_id TEXT NOT NULL REFERENCES buddies(id),
  purpose TEXT NOT NULL, body TEXT NOT NULL, evidence TEXT NOT NULL,
  buddy_project_id TEXT REFERENCES owned_projects(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX buddy_list_posts_feed ON buddy_list_posts(list_id, created_at DESC, id DESC);

CREATE TABLE buddy_list_reads (
  buddy_id TEXT NOT NULL REFERENCES buddies(id),
  list_id TEXT NOT NULL REFERENCES buddy_lists(id),
  last_post_id TEXT NOT NULL, last_post_created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(buddy_id, list_id)
) STRICT;
```

Idempotency uses the existing `coordinationCommand({actor, workspaceId, key, payload})`
receipt: same key + same payload replays the original result; same key + different
payload is a conflict. Do not invent a second receipt table.

Store methods (all synchronous, all inside `#tx`):

| Method | Behaviour |
|---|---|
| `createList({workspace, buddy, key, name, purpose})` | Creates or replays. Duplicate name under a different key → `Error` code `list_name_taken`. |
| `getList(id)` / `listLists({workspace})` | Plain reads. `listLists` returns `latestPostAt` and `postCount` per list, ordered by latest post desc, then name. |
| `createPost({list, buddy, key, purpose, body, evidence, project})` | Sender must be active and a member of the list's workspace; `project` (if given) must be a project in that workspace; bounds as Mail. Records audit `buddy.post`. Creates no run, no conversation, no message. |
| `listPosts({list, limit, offset})` | Newest first. Bound 1–50. |
| `listUnread({buddy, workspace})` | For every list in the workspace: `{listId, name, unread, latestPostAt}` where `unread` counts posts newer than the Buddy's read row (all posts if no row). Bounded to 20 lists. |
| `markListRead({buddy, list, post})` | Monotonic: only advances. |

## Tools (native MCP, resource contract bump to `2026-09-21.1`)

Three new tools and one extended read. No changes to `send`, `reply` or the
delivery union.

| Tool | Input | Result | Annotations |
|---|---|---|---|
| `new_list` | `{key, name, purpose}` | `{list}` | idempotent, not read-only |
| `post` | `{key, listId, purpose, body, evidence?, projectId?}` | `{post}` | idempotent, not read-only |
| `get_list` | `{listId, limit?, cursor?}` (`cursor` matches `^list:[0-9]+$`, same offset style as `get_inbox`) | `{list, posts, nextCursor}` | idempotent, **not** read-only (see cursor rule) |
| `get_inbox` (extended) | unchanged | adds `lists: [{listId, name, unread, latestPostAt}]` (≤ 20) | unchanged |

**Cursor rule (one rule, no exceptions).** A `get_list` call **without** a
cursor is a fresh read from the top; it advances the caller's read row to the
newest post it returned. A call **with** a cursor is paging into history and
moves nothing. Owner HTTP reads move nothing. Unread counts are informational:
an unread post never blocks work, never counts as a missed reply and never
appears in `filter:outstanding`.

Tool descriptions (exact text; keep them this short):

- `new_list`: "Create a public mailing list in this workspace with a stable key, unique name and purpose. Everyone in the workspace can read and post; there is no membership. Replaying the key returns the same list."
- `post`: "Post to a mailing list with a stable key. Posts are public to the workspace, immutable, wake nobody and carry no reply obligation. Use purpose for the kind of post (standup, handoff, announcement, decision). Link a Task with projectId; discussion about a Task belongs on the Task. Anything needing action still goes through send or update_project."
- `get_list`: "Read one mailing list newest-first (limit 1–50, default 20). A read without a cursor marks the list read up to the newest post returned; follow nextCursor to page into history without moving that mark."
- `get_inbox` (append one sentence): "lists shows each workspace mailing list with your unread post count; read one with get_list."

Operation names: `buddy.new_list`, `buddy.post`, `buddy.get_list`. Add all
three to `TOOL_NAMES`, `TOOL_DESCRIPTIONS`, `BuddyOperationInputSchemas`, the
readOnly/idempotent annotation sets, and to `MESSAGE_BUDDY_OPERATIONS` and every
default employee policy that already includes `buddy.send`. Do **not** expose
them to the memory reviewer (`memory-review-tools.ts`) or the Builder.

**Authority.** Any active Buddy with membership in the workspace, in any turn
that may `send`, can create, post and read. Owner threads can always read. No
owner grant, relationship or project scope is consulted: lists are public by
definition, so the private-audience machinery (`messageInAudience`,
`knowledgeScope`) does not apply and must not be extended to cover them. A list
in another workspace is invisible: `get_list` on it fails with
`list_outside_workspace`, the same code whether the list exists or not.

## Briefing instruction (server/src/buddies/integration.ts)

Append exactly one line to the operations suffix (budget
`BUDDY_BRIEFING_SUFFIX_MAX_CHARACTERS = 2_600`; measure before and after and
shorten this line, not others, if it overflows):

> Mailing lists are public workspace streams for standups, handoffs and announcements: get_inbox shows them with unread counts, get_list reads one, post writes one. Posts wake nobody and owe nobody a reply; action still goes through send or update_project, and discussion about a Task stays on the Task.

## Owner HTTP and UI

Routes (auth gate stays first; same `route()` helper as messages):

| Route | Body / query | Notes |
|---|---|---|
| `GET /api/buddies/lists?workspaceId=` | | `listLists` projection |
| `POST /api/buddies/lists` | `{workspaceId, buddyId, key, name, purpose}` | owner acts through a chosen sender Buddy, as `/messages` already does |
| `GET /api/buddies/lists/:listId/posts?limit&offset` | | moves no read mark |
| `POST /api/buddies/lists/:listId/posts` | `{buddyId, key, purpose, body, evidence?, projectId?}` | sender chosen like `/messages` |

UI: the Mailbox tab (`client/src/components/buddies/BuddyMessages.tsx`, shared
by desktop and mobile through `BuddyDetailMobile.tsx`) gets one "Lists" section:
list chips (name + unread is not shown for the owner; show `postCount`),
selected list feed, and a post composer using the already-selected sender.
Reads go through `usePolledFetch` with plain URL keys, results in
`atoms/resources.ts`, no component state. Class prefix `.buddy-messages-list-`.
No new route, no new tab, no new atom family.

## Tests (real boundaries, no mocks)

Server, `server/test/buddy-mailing-lists.test.ts`, one file, built on the
`buddy-inbox-pages.test.ts` harness (real `BuddiesStore(':memory:')`,
`createBuddyMcpServer`, `InMemoryTransport`):

1. **Public read without a forward.** Buddy A (project-scoped turn, `knowledgeScope: {kind:'project'}`) posts a standup. Buddy B, with no relationship to A and a different project scope, sees `unread: 1` in `get_inbox.lists` and reads the body through `get_list`. The owner reads it over HTTP. `listBuddyRuns()` count and the message count are unchanged: no run, no conversation, no message was created.
2. **Workspace boundary.** Buddy C in another workspace calling `get_list` gets `list_outside_workspace`; the response carries no list name or body.
3. **Cursor rule.** After B's fresh `get_list`, B's `unread` is 0. A posts again: `unread` is 1. B pages with a cursor: `unread` stays 1.
4. **Idempotency and conflict.** `post` twice with the same key and payload returns the same post id and one row. Same key, changed body → conflict error, still one row. `new_list` with a taken name under a new key → `list_name_taken`.
5. **Inbox stays bounded.** 500 posts across 25 lists: `get_inbox` returns 20 list rows, no post bodies, response under the existing size bound.
6. **Migration.** Open a database created at `user_version 21` with one message and one run; after `migrateLists`, the message and run survive and `PRAGMA user_version` is 22.

Client, `client/test/buddy-messages.test.tsx`: extend the existing render test so
a cached lists resource renders the section and an empty list renders the shared
`.empty-state`. No TSX or CSS source-text assertions.

Skip: field-exists mirrors, "tool registered" checks, description-string checks.

## Out of scope (stated so nobody fills the gap silently)

Membership or private lists · threaded replies on a post · a list owing a reply
· `work`/`request` delivery to a list · editing or deleting posts · notifications
or wakeups on post · external mailbox delivery · owner-authored posts without a
sender Buddy.

## Delivery protocol for the implementing engineer

Package first, then app. The vendored archive was packed from package commit
`21810ca` on branch `codex/buddy-evidence-preservation-20260916` (see
`vendor/nbardy-buddies-0.1.0.provenance.json`). The package's `main` checkout at
`~/git/buddies` is at a different commit **with a large uncommitted diff that
belongs to another session; do not build on it or touch it.**

1. `git -C ~/git/buddies worktree add ~/git/.codex-worktrees/buddies/mailing-lists-20260921 -b codex/mailing-lists-20260921 21810ca`
2. Implement `src/lists.js`, wire it in `src/index.js`/`src/store.js`/`src/index.d.ts`, add package tests, run `node --test` there, commit inside that worktree.
3. In this repo: `BUDDIES_SOURCE_DIR=~/git/.codex-worktrees/buddies/mailing-lists-20260921 pnpm vendor:buddies` (no `--allow-uncommitted`), then `pnpm install`. This rewrites the archive, provenance and lockfile together.
4. Shared, server, client changes; docs: add the tools to [PLANNING_PRIMITIVES.md](PLANNING_PRIMITIVES.md) and mark this document implemented with the commit hash.
5. Verify: `pnpm typecheck` (or `pnpm -C client exec tsc -b` if the supervisor lock is held), `pnpm test:server`, `pnpm test:client`, `bash tools/check-client-invariants.sh`, `pnpm test:package`.
6. Commit on branch `feat/mailing-lists-2026-09-21` off `refactor/reduce-sprawl-2026-09-06`. Stage file-by-file; the tree is shared with other sessions. Never stash, never reset, never push `main`. Verify the commit, not the tree: `git status --porcelain` empty for your files, or `git grep new_list HEAD` finds both definitions and consumers.
7. Reply to the assignment with: commit hashes (package worktree and app), the exact test commands run and their pass/fail output, the archive SHA-256 from the new provenance file, and anything left out.
