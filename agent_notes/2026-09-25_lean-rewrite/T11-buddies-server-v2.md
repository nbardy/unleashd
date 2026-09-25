# T11 — Buddy server v2 on the crate (report, 2026-09-25)

Branch `feat/buddies-server-v2` (worktree `.claude/worktrees/agent-aef6e1940d77d9ce4`), from `lean/integration`
@ 7449071, with `lean/integration` merged at 5b0dffb (patterns + T17) and d7613fd (T08). Not pushed, not merged
back. Tree clean at HEAD **`6f55d5f`** (after the 81c21d1 merge, the feature restorations and the ordered-ids fix below); every check
in "Verification" ran on that commit.

## Commits (T11 only, oldest first)

| SHA | What |
|---|---|
| 9dfbe27 | crate: `createBuddy`/`updateBuddy` (owner only, cycle refused, archive cancels queued runs), `recoverRuns`, `RunQuery::Live`, post `conversation_id` = provenance; importer `mark_direct_read` ON by default + verifier check |
| 0fef9d4 | server v2 modules (core, events, grants, mcp, runner, schedule, briefing, channels, routes, memory-review, policy-port) + server.ts wiring; deleted 41 old modules, the vendored `@nbardy/buddies` tarball + provenance, `tools/vendor-buddies.mjs`, package entries |
| 314e844 | merge lean/integration (5b0dffb) |
| 2090959 | `server/test/buddies-v2.test.ts` (integration through real boundaries); deleted 56 old Buddy/channel tests; crate `createWorkspace` + `POST /api/buddies/workspaces` |
| 116107f | crate: background runs of a buddy with `background_enabled` off stay queued; `createBuddy` takes it explicitly; README deploy section |
| 7c9ade6 | a chat enqueue failure never throws into the admission tick; guard citations in docs point at the new tests |
| 1f186a4 | owner routes as one table; HTTP test (route order, answers, typed errors) |
| 897f95c | client: Buddy UI on the v2 routes; dead screens deleted (done by a sub-agent, verified and committed by me) |
| 848bea5 | merge lean/integration (d7613fd, T08) |
| ce886cf | post-T08 wiring: `BuddyTurnPolicy` calls `BuddyPolicyPort` directly; legacy adapter and `mcp-config.ts` shim deleted |
| e09b90e | merge lean/integration (81c21d1, T18): BuddyTeamExecution stays deleted; T18's `tools/screenshots.mjs` is the base, its discovery moved to the v2 API (overview → workspace inbox → posts → threads), the 7 Buddy tabs still come from `EMPLOYEE_TABS`, the `task-filter` screen dropped with the feature |
| c7a1a78 | (superseded by 6f55d5f) timestamp nudge for same-millisecond posts; rejected by the owner |
| 6f55d5f | ordered ids: time-ordered UUIDv7 from one monotonic generator; posts order by `post.ord`, runs tie-break on their v7 id; `created_at` is the true write time again; import re-run to `db/buddies-v4.sqlite` |
| 4e5a01c | restored (owner: no visible feature removed without approval): post search (crate FTS5 `searchPosts`, `channel_read {search}`, `GET /workspaces/:ws/search`), posting as a Buddy (`asBuddyId` + the Messages-tab form), Builder `tasks`/`task_write` |

## Lines, before → after

| Area | Before (7449071) | After (ce886cf) |
|---|---:|---:|
| `server/src/buddies` | 15,471 (50 files) | **4,549** (18 files) |
| — of which new T11 modules | — | 3,069 (core 124, events 27, grants 130, mcp 638, runner 424, schedule 16, briefing 146, channels 644, routes 583, memory-review 508, policy-port 101, builder 12) |
| — kept helpers | — | 764 (channel-reply-gate 200, channel-media 139, buddy-conversation-slots 95, cursor-ephemeral 30, provider-capability 16) + `turn-policy.ts` 716 (T08's move, was 1,022) |
| `@nbardy/buddies` package (vendored) | 11,361 lines JS | **0** (deleted) |
| crate `unleashd-buddies` src | 3,510 | 3,925 (+team.rs 170, recovery, live query, DM read marks, workspace create; +415) |
| server Buddy/channel tests | 59 files, 19,765 lines | 1 file, `buddies-v2.test.ts` 812 lines (+ fixture `buddy-port.ts`) |
| client Buddy UI TS/TSX | 13,735 | **8,599** |
| client Buddy UI CSS | 5,057 | **3,361** (plus ~530 dead lines out of mobile-buddy.css / mobile.css) |
| shared buddy schemas | 1,811 (15 files) | 6 files deleted, 4 trimmed |

Against budget: the ~1.9k target counted only the 9 new modules at their 02 §8.2 sizes. The new modules are 3.1k;
mcp (12 zod schemas), channels (the ported responder, incl. seats, gate, delta prompts) and routes (33 routes as rows)
are over, and turn-policy (T08's runtime move) sits on top. Most remaining weight is behavior carried over intact
(the channel responder's dated fixes, the reviewer's harness flags), not scaffolding.

## Modules (server/src/buddies)

- **core.ts** — opens the NEW-schema DB: `UNLEASHD_BUDDIES_DB`, default `~/.buddies/buddies-v3.sqlite`. A missing file
  fails every Buddy call with the exact import+verify command (no silent empty DB, no fallback to v33); chats keep
  working. Typed `[code]` errors → HTTP status; `docScopeFor` (owner_thread→thread, project→task, workspace).
- **grants.ts** — `TurnGrant = BuddyGrant{worker|owner|reviewer} | BuilderGrant`, carrying `author` (who posts) and
  `principal` (whose authority writes use). Owner principal only via `promoteToOwner`, which only the owner-input path
  calls (B1). Revoked at settle (`revokeRun`), turn end/cancel (`revokeConversation`), and by TTL = lease.
- **mcp.ts** — one stateless streamable-HTTP endpoint on its own `127.0.0.1:0` listener (never the gated app). Tool
  table `{description, schema, writes, handler(deps, grant, input)}`; `toolsFor(role)` is presentation; the crate
  authorizes every call. 401 for an unknown/expired/revoked bearer.
- **runner.ts** — the only executor: `wake()` on every write/settle (change bus) + one 5 s backstop that also runs
  `dueSchedules`; `recoverRuns` once at start; one handler per `RunInput` (`chat` → hand the claim to the waiting
  conversation; `post` → recipient turn in a fresh background conversation, auto-answer with the final text if it did
  not answer; `reply`/`failure_notice` → a turn in the asking background conversation, or mailbox-only when it was a
  human chat; `schedule` → a fresh background turn). Leases every claim for `TURN_MAX_RUNTIME_MS`, passed explicitly.
- **schedule.ts**, **briefing.ts** (composed async, read sync by the runtime from a cache the runner warms right before
  each turn; a cold read is an error), **events.ts** (in-process bus: `changed | posted`; fixes B2).
- **channels.ts** — @mention + gated follow-up responder on unified posts, seats per (thread, Buddy), delta prompts for
  resumed seats, 3-Buddy chain bound, failed-gate notice, DM chat / wake. Seat authority per B1: the trigger post is
  re-read by id; owner author → `owner_input`, Buddy author → `buddy_post`.
- **routes.ts** — 33 owner routes over the crate (+ media upload), behind the existing auth gate.
- **memory-review.ts** — the codex→cursor→claude→muse ladder (harness flags kept), each attempt with its own
  `reviewer` grant on the same endpoint (tools `doc_read`/`doc_write`, memory kinds only); receipts are `event` rows
  (`op: memory_review`).
- **policy-port.ts** — `BuddyPolicyPort`: `currentBriefing`, `enqueueChat`/`admission`/`abandon`, `mcpServers({owner})`,
  `builderMcpServers`, `settle`, `revoke`, `afterTurn`. Refuses a runner lease < `TURN_MAX_RUNTIME_MS`.
- **turn-policy.ts** (T08's file) — now only turn-shaped logic over the port: admission tick, deadline ownership
  (`max_runtime_timeout`, unref'd timer), re-brief-on-generation, doc-scope audience fence, runner-owned runs.

Pattern tags: capability-grants (grants), table-driven (tool table, routes), sum-types (RunInput dispatch),
wake-on-write (runner), one-write-path (events), idempotency-keys (tools, routes).

## MCP tools (12) and roles

`post` (channel ref: `{id}` | `{direct:[members]}` | `{task}`; `kind` inform|request), `answer`, `inbox`,
`channel_read`, `tasks`, `task_write` (create | update CAS | comment), `doc_read`, `doc_write`, `runs`
(list|get|cancel), `schedule` (list|put), `team`, `team_admin` (create incl. soul | update).
`channel_read` also takes `{search}` (every word must appear; the reader's readable channels).
Worker: the first 11. Owner: all 12. Reviewer: `doc_read`, `doc_write` (working/long_term/note). Builder: `team`,
`team_admin`, `tasks`, `task_write` (ownerId required). Every write takes an idempotency `key`.

## Owner routes (33 + media)

`GET /api/buddies/overview` · `POST /api/buddies/workspaces` · `POST /api/buddies/builder` · `POST /api/buddies` ·
`POST /:buddyId/direct` · `POST /:buddyId/wake` · `GET|PUT /:buddyId/docs/:kind` · `GET /docs/:docId/revisions` ·
`GET /tasks` · `GET /tasks/:taskId` · `POST /tasks` · `PATCH /tasks/:taskId` · `GET /runs` (buddyId | taskId |
conversationId | liveInWorkspace) · `GET /runs/:runId` · `POST /runs/:runId/cancel` · `GET|POST /:buddyId/schedules` ·
`PUT /:buddyId/schedules/:id` · `POST /:buddyId/schedules/:id/run` · `GET /workspaces/:ws/inbox` ·
`POST /workspaces/:ws/channels` · `GET /channels/:id` · `GET /channels/:id/posts` · `GET /posts/:id/thread` ·
`POST /channels/:id/posts` · `POST /direct/posts` · `POST /posts/:id/answer` · `POST /channels/:id/read` ·
`GET /channels/:id/responding` · `GET /workspaces/:ws/search?q=` · `GET|PATCH|DELETE /:buddyId` ·
`POST /channels/:id/media`. `POST /channels/:id/posts` takes `asBuddyId` to post as a Buddy.
(all under `/api/buddies`; the single-buddy routes are registered last so literal paths never read as an id).

## Data

- Importer re-run on the copy with DMs marked read (owner decision, default ON; `--keep-direct-unread` turns it off):
  `db/buddies-v3.sqlite`, verify `ok`, read cursors 271 = 83 + **188 direct**. Previous T06b files kept as
  `db/buddies-v3.t06b.*`. `db/owner-channel-reads.json` is a read-only copy of the live file (sha unchanged);
  `db/buddies.sqlite` sha unchanged. `~/.buddies` never opened.
- Owner defaults implemented: owner reads/posts every DM (crate `authorize`), managers are not DM members, requests
  only in DMs, imported DMs read.
- Deploy sequence (stop → `VACUUM INTO` → import → verify → switch → restart, rollback, which queued runs will start)
  is in `crates/unleashd-buddies/README.md` "Deploy". At the swap 18 queued runs of background-enabled buddies start
  (11 failure notices, 4 replies, 3 requests) and 1 stays held; T15 should decide whether to cancel them first.
- Smoke on a COPY of v3 (queued runs cancelled in the copy): server starts, `recovered: 0 interrupted`, overview 16
  workspaces / 51 buddies (194 ms), owner inbox 27 channels incl. 17 DMs (83 ms), channel/thread/detail/soul/tasks
  all 200, unknown buddy 404 `[not_found]`.

## Tests (integration through real boundaries; only the provider is faked)

`server/test/buddies-v2.test.ts` (9 tests): full chat turn request→answer→return (mailbox into a human chat) with
**every settled grant rejected (401)** and the chat lease = `TURN_MAX_RUNTIME_MS`; **B2** MCP write fires the bus;
**B1** owner-triggered seat has owner tools and may write any soul, Buddy-triggered follow-up has no `team_admin` and the
crate denies (mutation-checked: flipping it to `owner_input` fails); schedule → background request → auto-answer →
return turn resumes the asking conversation; reviewer ladder on the same endpoint; missing DB names the import command;
briefing budget; 3-post chain bound + failed-gate notice; owner routes over HTTP (route order, answer, 400/409).
Crate: 18 core tests (+team admin, recovery, background hold), import (+DM read marks and a lost-cursor tamper), query-
plan guard (+recover, live runs, team writes, workspace), node boundary test.
Deleted: 59 server test files of the old stack (T17 verdicts). Guards carried: TURN_MAX (runner lease + port check +
runtime deadline test), recovery (crate), max_active_runs (crate), keyset paging/owner unread (crate), B1 whole
(buddies-v2), channel dated tests (chain bound, gate notice, resumed-seat delta), reviewer ladder, cursor-ephemeral,
self-schedule rule (crate authorize), re-brief-on-generation, audience fence ("unproven disclosure state starts fresh").
Client: `buddy-conversation-links` and all channel regression tests kept and adapted.

## Verification (clean tree at 6f55d5f, addon rebuilt first, `git status --porcelain` empty before and after)

```
pnpm --dir crates/unleashd-buddies run build   exit 0
pnpm typecheck                        exit 0 (server src+tests, client tsc -b + tests, shared, agent-cli)
pnpm test:server (run 1)              tests 266 · pass 266 · fail 0 · skipped 0
pnpm test:server (run 2)              tests 266 · pass 266 · fail 0 · skipped 0
pnpm test:client                      tests 139 · pass 139 · fail 0
pnpm test:tools                       tests 3 · pass 3 · fail 0
bash tools/check-client-invariants.sh all 6 gates PASS
crate pnpm test                       cargo 23 pass · 0 fail; release build; node boundary 2/2; clippy clean
buddies-v2.test.ts, 3 full-file runs  9/9 each
```

## Ordered ids (6f55d5f) — the fix for the flaky follow-up test

Root cause (found from the orchestrator's lean-integration failure, 1 in 3 full runs): posts sorted by
`(created_at, id)` with random UUIDv4 ids, so posts written in one millisecond read back shuffled (measured 48/50
back-to-back rounds tied, 29/50 threads shuffled). The responder's "is this the thread's newest post" check then
skipped the follow-up gate; the same tie affected the Buddy-chain bound, read cursors and paging, and the client
transcript, which also sorted by `createdAt`. The first fix (c7a1a78) nudged `created_at`; the owner rejected it.

- **One generator** (`src/ids.rs`, `Pattern: ordered-ids`): RFC 9562 UUIDv7, method 1 (12-bit counter within the
  millisecond, seeded randomly with its top bit clear, next millisecond on overflow, never backwards), one mutex per
  process; the crate owns the single writer connection. Chosen over `uuid::Uuid::now_v7()` (also monotonic per
  process) because the importer must issue ids at a source time from the same counter and read cursors need a
  millisecond "ceiling" id. `new_id()` uses it for every new row id.
- **Posts** order by `post.ord`, the post's UUIDv7 (a new post's id is `post_<ord>`): threads and pages
  (`Cursor {ord}`, keyset `ord < ?`), inbox unread (`ord > last_ord`), read cursors (`post_read.last_ord`, forward
  only by ord). Indexes `(channel_id, ord)`, `(root_id, ord)`, `UNIQUE(ord)`. `created_at` is untouched.
- **Legacy rows**: an explicit ordering key, not a re-id. Imported posts keep their v33 ids (runs, conversation links,
  answers and client permalinks name them); the importer walks them in (source time, import order) and issues each an
  `ord` from the same generator at its source write time. Every later post sorts after all history, with no reference
  rewritten. Source time is the only cross-table order v33 has (an inline reply exists only as `replied_at`); import
  order breaks its ties. Read cursors import as their post's ord, or the ceiling id of their instant for the owner's
  baseline. A file imported before ordered ids is refused (`[wrong_database] … re-import it`); no live file predates
  it (the swap is T15).
- **Other entities**: runs got new v7 ids, and claim FIFO/run lists tie-break on the id (they tied on `created_at`
  too). Events (`seq INTEGER PRIMARY KEY`) and doc revisions (integer `revision`) were already strictly ordered.
- **Verifier**: a new `ordering` check (every ord is a UUIDv7, a channel read in ord order never goes back in time,
  every cursor's `last_ord` matches its post or instant). Import + verify re-run on the copy into
  **`db/buddies-v4.sqlite`**: every class ok, read cursors 271/271, ordering 2415/2415, revision chains and souls ok;
  input hashes unchanged. (v3 and v3.t06b are kept; v3 no longer opens with the new crate.)
- **Guards**: `posts_read_back_in_write_order_within_a_millisecond` (fails with random ids, which I checked by
  mutation; asserts posts really shared a millisecond, so no timestamp adjustment),
  `ordered_ids_are_strictly_increasing_even_within_one_millisecond` (5,000 ids in one ms, counter overflow,
  clock step back), import tamper of an ord, client `a channel transcript orders same-millisecond posts by their
  ordered id`. `docs/patterns.md` has the `ordered-ids` entry.

## Done after T08 (the "post-T08 wiring")

Done in ce886cf: `BuddyTurnPolicy` uses the port; `ConversationRuntimeDependencies` carries `buddies: BuddyPolicyPort`
instead of 13 optional hooks; `mcp-config.ts` and the legacy adapter are gone; T08's "issue the Buddy grant before the
owner grant" invariant is moot (one grant, promoted, never re-issued mid-turn). Removed with the old package: legacy
automation turns/cancellation, delegation settlement, conversation-link status, turn-origin audit, package audience
containment (replaced by a doc-scope fence).

## Feature removals: restored, and the ones still needing an owner decision

Restored in 4e5a01c (each had a caller in the old UI or tools):
- **Owner posts as a Buddy** — the old Messages tab had a "post to a list as this Buddy" composer. Back as
  `asBuddyId` on the owner post route and a "Post as Buddy" form (channel, kind, body) in the Messages tab. Guarded by
  `client/test/buddy-messages.test.tsx` and the owner-routes test (a Buddy's @mention in it starts no turn).
- **Builder creates tasks** — the Builder's owner tools had `new_project`/`update_project`/`get_current_work`. Back
  as Builder `tasks` + `task_write` (ownerId required). Guarded in the owner-routes test.
- **Post search** — `search_posts` was a Buddy tool (31 uses); the old owner UI never called it. Back as crate
  `searchPosts` on an FTS5 index (post_search + triggers, built on open for existing files), `channel_read
  {search}` and an owner route. The query-plan guard covers it (an FTS MATCH is accepted as an index lookup;
  it also caught FK parent-check scans on every post insert, now indexed: `post_reply_to`, `post_answer`).
  Guarded by crate `post_search_finds_words_only_in_channels_the_reader_may_read` and the owner-routes test.

Still removed in the client migration, NOT restored here; each needs the owner's approval or a T14 restore:
1. Reply counts and "last reply" on channel rows (needs a per-root count query in the crate; small).
2. The "New messages" divider and bold unread threads (needs per-post read position; medium).
3. Reply permalinks landing on the reply (needs an "around this post" query; small).
4. The cross-channel Task filter in channels (desktop only; medium) and its screenshot screen.
5. Task/todo creation, reorder and pause in the Buddy Work tab (routes exist; UI only; medium).
6. Doc revision history, notes, shared and scoped docs in the Memory tab (routes exist; UI only; medium).
7. Thread view and `waitingOn` in the Messages tab (UI only; small).
8. Open/blocked counts on directory cards (needs counts in the overview; small).
9. Clearing a Buddy's provider/model/effort in Settings (crate patch cannot clear; small).
10. Team configuration, access/inactive access, approvals, review markers and legacy automation-run history were
    deleted with their data model (T11 scope, DESIGN B.1); they have no v3 data to show.

## Left for T14 / follow-ups

Server/crate:
1. Memory-curation benchmark harness was deleted with the stdio reviewer; port it onto `createMemoryReviewer` before the
   next rerun (fixtures README says so). The reviewer instructions changed tool names only.
2. The `channel_changed` wire field is still `listId` (it carries any channel id); rename with a client change.
3. `cargo build` is not wired into the dev watcher; `pnpm build` builds the addon, dev builds it by hand.
4. Notes `query` in `doc_read` is still a substring filter over one buddy's notes (post search is FTS).
6. shared: `buddy-team-configuration*` and the Builder result schemas stay only because `runtime`/transcripts render old
   tool results; delete with T09/T14.
7. Recursive audience of `buddy_message` inputs uses the run's task/workspace scope; channel seats keep `owner_thread`
   scope (02 §8.6 audience question still open).
Client: the removals listed above; a paging gap when >50 posts arrive while paged back; `tools/screenshots.mjs`
(T18 base) has not been run against a live v2 server.
