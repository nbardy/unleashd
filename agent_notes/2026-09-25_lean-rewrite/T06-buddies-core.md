# T06: `crates/unleashd-buddies` (lean Buddies core, napi-rs)

**Status: done.** The work is on branch `feat/buddies-core-crate`, off `lean/integration` @ ab47223.
It is in worktree `~/git/unleashd/.claude/worktrees/agent-a8d7281c234c1034c`, in 3 commits, and is
neither merged nor pushed.

| Commit | What |
|---|---|
| `c3ff355` | Adds the crate: schema, core functions, napi bindings, importer, verifier and CLI. Registers the pnpm workspace package `@unleashd/buddies-core` and adds biome ignores for `crates/target` and the generated `index.d.ts` |
| `7191385` | Adds the tests: Rust core, import end-to-end, query-plan guard, and the Node boundary test |
| `4996071` | Adds the crate README (API, build, how the server calls it) |

`git status --porcelain` was empty after the last commit, so the checks below ran against the commit
itself. No server code changed.

## Real run on the DB copy

- **Source:** `db/buddies.sqlite`, 89.2 MB. It was opened `mode=ro`, and its 0444 files are unchanged.
- **Target:** `db/buddies-v2.sqlite`, 58.8 MB.
- **Reports:**
  - `db/buddies-v2.import.json`
  - `db/buddies-v2.verify.json`
- The verifier exited 0 with `"ok": true`.

**Import counts.** For every mapping the source count equals the target count; the import aborts
if any pair differs.

| Mapping | Rows |
|---|---:|
| workspace ← projects | 16 |
| buddy ← buddies | 51 |
| task ← owned_projects 359 + buddy_todos 1,182 | 1,541 |
| channel ← buddy_lists | 32 |
| post (buddy/owner) ← buddy_messages | 600 |
| post (channel) ← buddy_list_posts | 321 |
| post (task) ← buddy_task_comments | 962 |
| post_read ← buddy_list_reads | 51 |
| doc ← memory heads 153 + knowledge 1,451 | 1,604 |
| doc_revision ← memory revisions 238 + knowledge revisions 2,365 | 2,603 |
| schedule ← automations (+ policies) | 16 |
| run ← buddy_runs 2,605 + automation_runs 51 | 2,656 |
| conversation ← conversation_links | 976 |
| event ← audit mutations 15,208 + receipts 5,802 + builder hires 42 | 21,052 |

These rows were dropped by design:
- 8,245 audit rows that are pure reads (`get_*`, `list_*`, `search_*`, `recall`).
- The cached result JSON of each receipt. The key and payload hash are kept, and the result's size
  is recorded in `legacy`.

**Verifier results (01 §7.3 checks 1–4).** Every group's count and sha256 match.

| Class (group key) | Rows old → new | Groups matched |
|---|---:|---:|
| messages by sender | 600 → 600 | 23 / 23 |
| messages by recipient, including reply body, evidence and time | 600 → 600 | 36 / 36 |
| channel posts by author | 321 → 321 | 17 / 17 |
| channel posts by (channel, author), including thread root | 321 → 321 | 77 / 77 |
| task comments by task | 962 → 962 | 176 / 176 |
| memory revisions by (buddy, kind) | 238 → 238 | 153 / 153 |
| memory heads by (buddy, kind) | 153 → 153 | 153 / 153 |
| knowledge docs by (buddy, scope, kind) | 1,451 → 1,451 | 175 / 175 |
| knowledge revisions by (buddy, scope, kind) | 2,365 → 2,365 | 175 / 175 |
| revision chains: (revision, sha256) set per doc, stored sha = content sha, head = last revision | 1,604 docs, 2,603 revisions | 0 mismatches |
| soul files: re-hashed against the pre-import baseline, classified like soul-check.mjs | 51 unchanged | 44 match / 4 no header / 3 empty, 0 differ |

**Flagged for the owner.** Both lists are in the import report, and the data is preserved.
- **10 memberships outside a buddy's home workspace.** Each is kept in `buddy.legacy.other_memberships`.
  - growth-lead, growth-engineer, growth-operator and gtm-critic each have 2.
  - builder-d1c621fb970e8c30 and portfolio-historian each have 1.
- **5 divergent thread souls.** Each is imported as a `thread`-scoped soul doc with
  `legacy.flag = 'divergent_thread_soul'`: betting-deployment-lead-f5cd058594bb, builder-03dcaf078826cd40,
  builder-28978554c7b8e865, builder-908b36c6d714b2e5 and quant-lead-ada2cbd159e3. This is the same set
  as 01 §7.2.
- **1 interval schedule** was converted to cron (1800 s → `*/30 * * * *`). It is disabled, and its
  original cadence is kept in `legacy`.
- `PRAGMA foreign_key_check` finds 0 violations.

**Smoke test through the built addon (a copy of v2).**
- Every imported row decoded through the public API with no `corrupt` errors: 51 buddies,
  1,604 docs, 2,603 revisions, 1,541 tasks, 2,656 runs, 921 posts, 16 schedules, all channels and
  pages. The whole pass took 432 ms.
- Worst single call: `listRuns(buddy)` returning every run of the busiest buddy, 18.8 ms.
  `claimRun` took 0.4 ms and `inbox(owner)` 2.0 ms.

## API surface

The generated `crates/unleashd-buddies/index.d.ts` is the contract.
- `BuddiesCore.open(path)` returns an instance, and every method on it is async.
- Sum types cross the boundary as tagged objects: `Actor`, `Subject`, `Target`, `Reply`, `RunInput`,
  `Outcome`, `DocScope`, `TaskWrite`, `TaskQuery`, `RunQuery`, `PostQuery` and `Decision`.
- Errors reject with `[code] message`. The codes are `denied`, `not_found`, `revision_conflict`,
  `idempotency_conflict`, `invalid`, `lease_lost`, `conversation_busy`, `corrupt`, `wrong_database`,
  `sqlite`, `json` and `io`.

| Area | Functions |
|---|---|
| Authorization | `authorize(actor, op, subject)`. Rules: the owner can do everything; `admin` is owner only; any active buddy can `post`; every other op needs self or a transitive manager (a recursive CTE over `buddy.manager_id`). Every mutating function calls it internally |
| Posts | `post` (a `request` to a buddy sets reply `awaiting` and enqueues a `post` run), `reply` (enqueues a `reply` run to a buddy author in the sender's conversation), `listPosts(channel\|thread\|task\|to\|from, before?, limit)` (keyset), `inbox(actor, ws)`, `markRead`, `createChannel`, `listChannels` |
| Docs | `readDoc`, `writeDoc` (CAS on `baseRevision`; every revision is kept with its sha256), `listDocs`, `docRevisions` |
| Tasks | `upsertTask(create\|update)` (CAS on `revision`; pause, cancel or reassign bumps `epoch` and cancels queued runs from the stale epoch), `getTask`, `listTasks` |
| Runs | `enqueueRun` (idempotent on the input key), `claimRun(leaseMs)`, `settleRun(complete\|failed\|cancelled)`, `bindRun`, `cancelRun`, `getRun`, `listRuns`.<br>`claimRun` requires the run to be ready, its `after_run` to have finished, its conversation to be free, the buddy to be under `max_active_runs` and the task not to be paused. It first fails any expired lease.<br>`settleRun`: a failed `post` run marks the request failed and enqueues a `failure_notice` run for the sender |
| Schedules | `putSchedule` (cron + IANA timezone), `listSchedules`, `dueSchedules(now)` (enqueues one run per due schedule and collapses missed slots) |
| Events | `appendEvent` (idempotent per actor, workspace and key), `pruneEvents(before)`, `listEvents`. Every core mutation writes its own event and is idempotent on its `key` |
| Identity | `listWorkspaces`, `getBuddy`, `listBuddies`, `bindConversation`, `getConversation` |

**Schema deviations from 01 §6.** Each one is documented at the top of `src/schema.rs`.
- Every imported table has a `legacy` JSON column.
- `run` gains `lease_expires_at` and drops `allowed_ops`. Per 02 §8.3 the role picks the tools; the old
  op lists are kept in `legacy.policy`.
- `post_read` gains `last_post_at`, and its `reader` column holds `'owner'` or a buddy id, so it can
  replace owner-channel-reads.json.
- `schedule` gains `name` and `created_at`.
- The optional 12th table `conversation` is included. Without it, 976 conversation↔buddy bindings
  would be lost, 213 of them with no run.
- There are no versions: `open` creates the schema in an empty file and refuses any file without the
  `application_id` marker (a v33 file gets `[wrong_database]`).

## Line counts

- **Rust excluding tests: 3,107 lines** after `cargo fmt` at width 140. This is over the ~1.5k aim.
  The core behaviour alone is about 1.4k.

| Part | Lines | Files |
|---|---:|---|
| Core behaviour | 1,382 | store 300 (authorize, events/idempotency, identity), posts 322, runs 379 (queue, leases, schedules), tasks 180, docs 128, error 55, lib 18 |
| Types / TS contract | 574 | types.rs: canonical sum types and rows. rustfmt puts one field per line |
| Schema DDL | 152 | schema.rs |
| napi bindings | 208 | node.rs: one line of glue per exported function |
| One-time migration | 791 | import 453 (mostly the mapping SQL), verify 271, CLI 67. **Deletable after the T15 swap** |
| Tests | 712 Rust + 77 JS | core 288, import e2e 128, query-plan guard 253, common 43, node.test.mjs 77 |

## Tests (all passing on the commit)

- `cargo test --no-default-features`: 14 tests.
  - `core.rs` (12):
    - authorize rules;
    - authorize enforced inside the functions;
    - doc CAS and revision history with sha256;
    - task CAS and the blocked-reason rule;
    - idempotency replay and changed-payload conflict;
    - **two claimers on separate connections with exactly one winner, over 25 rounds**;
    - lease token checked and lease expiry;
    - one running run per conversation;
    - request → claim → reply → return run, and failure → `failure_notice`;
    - epoch cancellation;
    - schedules;
    - event pruning.
  - `import.rs` (1): a v33 fixture, on the real v33 schema dump (byte-identical to the copy's
    `.schema`), is imported and verified. The verifier must then catch a changed message body, a changed
    revision and a rewritten soul file.
  - `query_plan.rs` (1):
    - traces every statement (more than 40 distinct) from a workload over every public function;
    - runs `EXPLAIN QUERY PLAN` on each and fails on any bare `SCAN <table>`;
    - allows `listWorkspaces` only, since it lists every workspace by design;
    - includes a self-check that the detector flags a known scan.
- `node --test test/node.test.mjs`: 2 tests.
  - The first loads the built `.node` and runs post, claim, reply and settle with tagged unions, and
    checks the `[not_found]` and `[denied]` rejections.
  - The second checks that `open` refuses a non-core file.
- `pnpm test` in the crate runs all of the above, and `cargo clippy` is clean.
- Toolchain: napi-rs **3** (napi 3.13, CLI 3.10.5 via `pnpm dlx`). I chose version 3 over 2 because
  its structured enums produce the discriminated unions shown in the d.ts. A clean release build takes
  about 20 s and an incremental rebuild 1–8 s.

## Notes for T11 and T15

- **Error codes.** napi async functions only carry a `Status`, so the code travels as a `[code]` prefix
  on the message. The TS wrapper should parse it once into a typed error.
- **Missing writes.** There are no writes for buddies or workspaces yet (the `team_admin` tool) and no
  post search. Both were left out on purpose; add them when T11 has a route that calls them.
- **Owner channel reads.** `owner-channel-reads.json` is not in the v33 DB, so it was not imported.
  T11 or T15 should load it into `post_read` with `reader = 'owner'`.
- **Legacy run keys.** Imported runs keep their old input keys (`message:<id>:request`). New keys look
  like `post:<id>`, so re-enqueueing an imported input creates a new run rather than matching the old
  one.
- **Live runs at import.** The copy had 19 queued runs and 0 running ones, and they are imported as
  queued. At the T15 swap, run the import on a fresh `VACUUM INTO` backup, taken with the server
  stopped.
- **Build steps.** `cargo test` and the CLI need `--no-default-features`, because the default `node`
  feature links napi. The CLI is built with `--features cli`.
