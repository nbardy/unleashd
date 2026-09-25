# T06b: unified posts (every post lives in a channel)

**Status: done.** The work is on branch `feat/buddies-unified-posts`, off `lean/integration` @ f6cc2ca.
It is in worktree `~/git/unleashd/.claude/worktrees/agent-a353fc9fb08b3b5a1`, in 2 commits, and is
neither merged nor pushed.

| Commit | What |
|---|---|
| `50755a9` | The schema, types, core functions, napi bindings, importer, verifier, CLI, generated `index.d.ts` and tests |
| `ecf828a` | The crate README |

`git status --porcelain` was empty after the commits, so `pnpm --dir crates/unleashd-buddies test`
ran against the commit itself. Results: cargo 17 tests, the release build and 2 Node tests all pass,
and `cargo clippy` is clean with both feature sets. The real import ran with the release CLI built
from `50755a9`.

Owner model: "base the slack on top of messages so we can send direct messages between two buddies
or send messages to a channel and it should be the same table and same data type."

## Schema diff

```diff
 CREATE TABLE channel (
   id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
-  name TEXT NOT NULL COLLATE NOCASE, purpose TEXT NOT NULL,
+  kind TEXT NOT NULL CHECK(kind IN ('public','direct','task')),
+  name TEXT COLLATE NOCASE, purpose TEXT, member_key TEXT UNIQUE, task_id TEXT UNIQUE REFERENCES task(id),
   created_by TEXT REFERENCES buddy(id), created_at TEXT NOT NULL,
+  CHECK((kind = 'public') = (name IS NOT NULL AND purpose IS NOT NULL)),
+  CHECK((kind = 'direct') = (member_key IS NOT NULL)),
+  CHECK((kind = 'task') = (task_id IS NOT NULL)),
   UNIQUE(workspace_id, name)) STRICT;
+CREATE TABLE channel_member (
+  channel_id TEXT NOT NULL REFERENCES channel(id), member TEXT NOT NULL,
+  PRIMARY KEY(channel_id, member)) STRICT, WITHOUT ROWID;
+CREATE INDEX channel_member_by_member ON channel_member(member, channel_id);

 CREATE TABLE post (
-  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
+  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channel(id),
   author_id TEXT REFERENCES buddy(id),
-  target_kind TEXT NOT NULL CHECK(target_kind IN ('buddy','owner','channel','task')),
-  target_id TEXT CHECK((target_kind = 'owner') = (target_id IS NULL)),
   root_id TEXT REFERENCES post(id), reply_to_id TEXT REFERENCES post(id),
   task_id TEXT REFERENCES task(id),
   purpose TEXT, body TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]',
-  reply_state TEXT CHECK(reply_state IN ('awaiting','replied','cancelled','failed')),
-  reply_body TEXT, reply_evidence TEXT, replied_at TEXT,
+  request TEXT CHECK(request IN ('awaiting','answered','cancelled','failed')),
+  answer_id TEXT REFERENCES post(id),
   conversation_id TEXT, return_conversation_id TEXT, created_at TEXT NOT NULL, legacy TEXT,
-  CHECK((reply_state = 'replied') = (reply_body IS NOT NULL AND replied_at IS NOT NULL))) STRICT;
-CREATE INDEX post_target ON post(target_kind, target_id, created_at, id);
+  CHECK((request IS 'answered') = (answer_id IS NOT NULL))) STRICT;
+CREATE INDEX post_channel ON post(channel_id, created_at, id);
 CREATE INDEX post_root ON post(root_id, created_at, id) WHERE root_id IS NOT NULL;
-CREATE INDEX post_author ON post(author_id, created_at, id);
-CREATE INDEX post_awaiting_target ON post(target_kind, target_id, created_at) WHERE reply_state = 'awaiting';
-CREATE INDEX post_awaiting_author ON post(author_id, created_at) WHERE reply_state = 'awaiting';
+CREATE INDEX post_awaiting ON post(channel_id, created_at) WHERE request = 'awaiting';
+CREATE INDEX post_awaiting_author ON post(author_id, created_at) WHERE request = 'awaiting';

 CREATE TABLE post_read (
   reader TEXT NOT NULL, channel_id TEXT NOT NULL REFERENCES channel(id),
-  last_post_id TEXT NOT NULL, last_post_at TEXT NOT NULL, updated_at TEXT NOT NULL,
+  last_post_id TEXT NOT NULL, last_post_at TEXT NOT NULL, updated_at TEXT NOT NULL, legacy TEXT,
   PRIMARY KEY(reader, channel_id)) STRICT;
```

- **Direct channels.** A direct channel's member set is stored twice:
  - `member_key` is the canonical key: the member keys sorted by byte, deduplicated and joined with
    `,`. It is `UNIQUE`, so there is exactly one direct channel per unordered member set.
  - `channel_member` indexes the same set by member.
  - The owner is the member `'owner'`.
- **Task channels.** A task channel is `UNIQUE` per task.
- **`post.workspace_id` is removed.** It is derived from the channel. Imported messages keep theirs
  in `legacy.workspace_id`. The import proves that list posts share their list's workspace, and
  fails otherwise.
- **The CHECK uses `IS` rather than `=`.** With `=`, a NULL `request` would make the CHECK evaluate
  to NULL, and a NULL CHECK passes.
- **Read cursors.** A cursor is a keyset position `(last_post_at, last_post_id)`. The owner's
  baseline from owner-channel-reads.json imports as `(baselineAt, '')`, which means "read through
  that instant".

## API changes (generated `index.d.ts`)

| Change | Detail |
|---|---|
| **New types** | `ChannelKind = {type:'public', name, purpose} \| {type:'direct', members: Actor[]} \| {type:'task', taskId}` (on `Channel.kind`).<br>`ChannelRef = {kind:'id', id} \| {kind:'direct', members} \| {kind:'task', taskId}`.<br>`RequestState = none \| awaiting \| answered{answerId} \| cancelled \| failed`. It is named `RequestState`, not `Request`, so it does not shadow the global fetch `Request` in TS.<br>`AnswerInput {requestId, body, evidence, key}`.<br>`Subject` gains `{kind:'channel', id}`.<br>`Op` gains `read_channel` and `create_channel`, and loses `reply` |
| `post(actor, channel: ChannelRef, input)` | A direct or task channel is found, or created on first use.<br>`input.kind: 'request'` needs a direct channel. The other members owe the answer (the author alone in a note-to-self channel), and each buddy among them gets a `post` run. Posting to a non-direct channel is `[invalid]` |
| `answer(actor, AnswerInput)` (new) | One transaction does three things:<br>- inserts the answer post (`replyToId` = the request, `rootId` = the request's thread);<br>- flips the request to `answered{answerId}`, but only if it is still awaiting (otherwise `[invalid]` and the insert rolls back);<br>- queues the `reply` run to a buddy author in its return conversation |
| `getPost(actor, id)`, `openChannel(actor, ref)` (new) | Both are authorized as `read_channel`. `openChannel` finds or creates the channel. The runner needs `getPost` to read the request behind a `post` run |
| `listPosts(actor, query, before?, limit)` | It now takes the actor and is authorized. The queries are `channel` (top level) and `thread` |
| `inbox(actor, ws)` | Returns:<br>- `requests`: awaiting requests in the direct channels where the actor is a member and not the author, across all workspaces;<br>- `waitingOn`: the actor's own open requests;<br>- `channels: [{channel, unread}]`: the actor's channels in `ws`, meaning every public channel, its direct channels and any channel it holds a cursor on. Unread counts posts by others after the cursor |
| `markRead` | Works for any channel kind. It moves forward only, and the post must be in the channel |
| `createChannel` / `listChannels` | Public channels only |
| **Removed (no shims)** | `reply()`, `ReplyInput`, `Target`, `Reply`, `Post.target`, `Post.workspaceId`, `Post.reply`, and the `to`, `from` and `task` post queries |

**`authorize` is still one function.** The existing rules are unchanged:
- the owner can do anything;
- `admin` is owner only;
- everything else is self or a transitive manager.

The channel rules are new:
- `post` and `read_channel` on a channel are open to any active buddy for public and task channels
  (the old `post` rule), and to members only for direct channels.
- `create_channel` is open to any active buddy.

## Verifier on the real copy

- **Input:** `db/buddies.sqlite`, opened read-only.
- **Output:**
  - `db/buddies-v3.sqlite`, 61.7 MB;
  - `db/buddies-v3.import.json`;
  - `db/buddies-v3.verify.json`.
- **Owner reads:** `~/.agent-viewer/owner-channel-reads.json`, read only. The format comes from
  `server/src/buddies/owner-channel-reads.ts`: `{version: 1, baselineAt, marks: {listId: {postId, createdAt}}}`.
  It has 2 marks and a baseline of 2026-09-25T04:55:46.996Z.
- **Inputs unchanged:** the sha256 of both inputs was checked before and after the run
  (`.work/t06b-inputs-before.sha256`), and both still match. The v2 files are kept.
- **Result:** `verify` exited 0 with `"ok": true`. `~/.buddies` was not touched.

**Import counts.** For every mapping the source count equals the target count.

| Mapping | Rows |
|---|---:|
| channel:public ← buddy_lists | 32 |
| channel:direct ← distinct {from, to} sets | 66 |
| channel:task ← tasks with comments | 176 |
| channel_member | 127 |
| post:direct ← 600 messages + 261 inline replies | 861 |
| post:answered requests | 261 |
| post:public ← buddy_list_posts | 321 |
| post:task ← buddy_task_comments | 962 |
| post_read:buddy ← buddy_list_reads | 51 |
| post_read:owner ← 2 marks + 30 baseline cursors | 32 |

The other tables are unchanged from v2: workspace 16, buddy 51, task 1,541, doc 1,604,
doc_revision 2,603, schedule 16, run 2,656, conversation 976, event 21,052. `PRAGMA
foreign_key_check` finds 0 violations and `integrity_check` returns `ok`.

**Verifier classes and checks.**

| Class / check | Rows | Groups matched |
|---|---:|---:|
| messages by sender | 600 | 23/23 |
| messages by recipient (recipient read from channel membership), with request state | 600 | 36/36 |
| messages by channel, with reply_to, v33 root, purpose, task | 600 | 66/66 |
| answers by (channel, author): body, evidence, time | 261 | 52/52 |
| channel posts by author | 321 | 17/17 |
| channel posts by (channel, author), with thread root | 321 | 77/77 |
| task comments by (task, author) | 962 | 257/257 |
| memory and knowledge docs and revisions (unchanged from v2) | — | all match |
| **answers**, per request: hex of the reply body bytes, author = recipient, time = replied_at, answer.reply_to = request, answer.root = request thread | 261 | 261 identical |
| **links**: every reply_to and root resolves in its own channel; a reply sits in its parent's thread; a same-channel v33 root is kept as the thread root; answer ↔ request | 550 linked posts | 0 broken |
| **read cursors**: `post_read` = buddy_list_reads + owner marks + owner baseline; the JSON must be unchanged since import | 83 | 83 identical |
| revision chains | 2,603 revisions, 1,604 docs | ok |
| soul files | 51 unchanged | 44 match / 4 no header / 3 empty |

**Independent byte totals.** These were computed with plain `sqlite3`, using
`sum(length(CAST(body AS BLOB)))`.

| Class | Old | New |
|---|---:|---:|
| messages + replies (body + reply_body) | 1,392,261 B / 861 | direct: 1,392,261 B / 861 |
| channel posts | 591,186 B / 321 | public: 591,186 B / 321 |
| task comments | 909,510 B / 962 | task: 909,510 B / 962 |

**Smoke test through the built addon (on a copy of v3).**
- All 274 channels decoded.
- All 2,144 posts decoded through `listPosts`: channel top levels plus threads, equal to `count(*)`.
- The run took 29 ms in total, and `inbox(owner)` took at most 0.2 ms.

## Import mapping notes (the non-obvious parts)

- **v33 `root_message_id` is not a channel thread.** It is the root of a delegation chain.
  - For 390 of the 600 messages that root is in another direct channel, for example owner→A as the
    root of A→B.
  - Mapping it straight to `root_id` would have hidden those messages from their own channel's top
    level.
  - It is therefore kept verbatim in `legacy.root_message_id`, and the count is in the report as
    `cross_channel_roots: 390`.
- **How `root_id` is set.** A message that answers another (`in_reply_to_id`, 34 rows, all in the
  same channel) joins the thread of its chain's top message. A top message is threaded under its v33
  root only when that root is in the same channel (91 rows).
- **The link invariants hold on the real data.** The verifier's links check proves this, with 0
  violations.
- **Inline replies.** Each becomes the post `reply_<message id>`:
  - the author is `to_buddy_id` (NULL means the owner; `replied_by` equals `to_buddy_id` in all
    261 rows);
  - `created_at` is `replied_at`;
  - its evidence is `reply_evidence`;
  - `replied_by` stays in the request's `legacy`.
- **New import guards.** The import now fails with a typed error before writing if any of these is
  true:
  - the reply columns disagree with the status;
  - an `in_reply_to` is in another channel or another delegation root;
  - a list post is outside its list's workspace;
  - a `reply_` id is already taken.

  All four are 0 on the copy.
- **Direct channel workspace.** A direct channel takes the workspace of its first message; each
  member set has one workspace on the copy.
- **Owner baseline cursors.** Each public channel the owner never opened gets a baseline cursor.
  This mirrors the floor the TS reader applies. Without it, every existing post would count as
  unread. Their `updated_at` is the import time, because the file records none.

## Decisions to flag for the owner or T11

1. **The owner can read and post in every direct channel, including buddy↔buddy ones.** This keeps
   "owner always" from `authorize` and matches today's UI, where the owner sees every message.
   Remove it if DMs should be private from the owner.
2. **Managers lose access to their reports' DMs.** A manager is not a member of those channels, so
   it can no longer read or answer them. The old `reply` allowed self or a manager, and old post
   reads had no authorization at all.
3. **Requests need a direct channel.** In a group DM every buddy member other than the author gets a
   run, and the first answer wins.
4. **DMs have no read cursors yet.** v33 had no read state for messages, so the owner's 5 DMs and
   the buddies' DMs count all posts by others as unread until the first `markRead`. T11 may want to
   mark them read at the swap (T15). That is a decision, not something the importer should invent.
5. **Answering is limited only by membership.** Any member, or the owner, may answer, including the
   requester in a 2-person DM.
6. **Inbox scope.** `inbox.requests` is not scoped to a workspace (as before); `channels` is.

## Line counts

The Rust figures are after `cargo fmt` at width 140. The budget was to hold the line count; it grew
by 153 lines in the core and by 331 in the migration code, which is deletable after T15.

| Part | Before (T06) | After | Δ |
|---|---:|---:|---:|
| Core behaviour + types + schema + napi (src excluding import/verify/CLI) | 2,316 | 2,469 | +153 |
| – posts.rs | 322 | 415 | +93 (find-or-create of direct and task channels, `answer`, `getPost`, `openChannel`) |
| – types.rs / store.rs / schema.rs / node.rs | 574 / 300 / 152 / 208 | 596 / 317 / 163 / 218 | +22 / +17 / +11 / +10 |
| One-time migration (import / verify / CLI) | 453 / 271 / 67 = 791 | 621 / 420 / 81 = 1,122 | +331 (the new checks the task asked for: answers, links, read cursors, owner JSON) |
| Rust tests | 712 | 844 | +132 |
| Node test | 77 | 82 | +5 |
| README / index.d.ts | 140 / 403 | 159 / 410 | +19 / +7 |

**Trimmed while writing.** The answer insert was folded into one statement, which removed a
row-builder struct and saved 31 lines. The first version used a self-referencing
`INSERT … SELECT FROM post`. The query-plan guard caught it: the bundled SQLite materializes it
through a table scan, so it became a plain INSERT followed by a guarded flip.

## Tests (all passing on the commit)

- `core.rs` (15 tests), new or changed:
  - `channel_access_is_membership_for_direct_and_open_for_public_and_task`. A non-member is denied
    both reading and posting. When a non-member tries to open someone else's DM, the denial rolls
    back the channel it would have created.
  - `one_direct_channel_per_member_set_even_under_a_race`. Member order and duplicates map to the
    same channel. Over 10 rounds, two posters on separate connections race and always land in one
    channel, which has exactly 2 `channel_member` rows.
  - `two_answerers_race_and_exactly_one_answer_lands`. Over 10 rounds, a buddy and the owner answer
    at the same moment. Exactly one answer succeeds and the thread holds exactly that post, so the
    loser's insert rolled back.
  - `request_answer_round_trip_and_failure_notice`. The answer is threaded under the request, a
    second answer is `[invalid]`, the `reply` run returns to the sender's conversation, DM unread
    counts and forward-only `markRead` work, and a failed run triggers the failure notice.
- `import.rs`. The fixture now has:
  - an inline reply;
  - a same-channel thread;
  - a reply chain;
  - a cross-channel root;
  - a replied note-to-self;
  - two lists, together with an owner read file.

  The test asserts the answer post's body, author, time, channel, thread and evidence, and the owner
  cursors (one mark and one baseline). It checks that a missing owner file is recorded as `absent`.
  Then it tampers with a message body, an answer body, a thread link, the owner file, a revision and
  the soul file, and the verifier must report each one (`answers.mismatches == ["m1"]`,
  `links.mismatches == ["m3: same-channel v33 root lost"]`).
- `query_plan.rs`. The workload now covers `post` to an id, a direct and a task channel, `answer`,
  `getPost`, both `listPosts` queries, `inbox` for a buddy and the owner, and `markRead` on a
  public and a direct channel. There are no full scans.
- `node.test.mjs`. It posts a request to `{kind:'direct', members}`, then:
  - `openChannel` with the reversed member order returns the same channel, and its kind is
    `{type:'direct', members}`;
  - `answer` is called, and `getPost` returns `{state:'answered', answerId}`.
