# Unleashd lean rework — design (2026-09-25)

Combines four inventories in this folder. Evidence and file:line citations are in:
`00-reconcile-fix.md` (tick fix), `01-buddies-package.md` (package data model),
`02-buddies-server.md` (server, MCP, HTTP), `03-app-core.md` (rest of the app).

## Goals (from the owner)

1. Make the app fast and light again. Use Rust where it clearly pays off; move toward Rust over time.
2. Re-architect into safer, faster, cleaner patterns, and delete the bloat along the way.
3. Buddies: go from 35 tables and ~27k lines to about 10 primitives and 2–4k lines
   (package + server + MCP). Lose **zero** channel posts, messages, memories or soul.md.
4. Delete merge completely (in progress on branch `chore/delete-merge-2026-09-25`).
5. Scope first; port second. Moving the MCP/tool layer is the first Rust candidate.

## Where the time and weight actually go (measured)

| Finding | Evidence | Language problem? |
|---|---|---|
| A 1 s Buddy tick ran full scans: 0.6–2.5 s per tick, up to 20 s when swapping | 00, fixed by `ab47223` (not deployed yet) | No: missing indexes |
| The machine is out of memory: 9.3 of 10 GB swap in use, 19 tsx helper processes (2.4 GB), 14 claude processes (3.1 GB) | earlier `ps`/`vm_stat` | Partly: each Node helper costs 45–170 MB |
| Each Buddy turn spawns 2 `node --import tsx` helpers: 2.5–4.5 s startup (0.3 s if prebuilt), plus a 143 ms–3.3 s SQLite open | 02 §2.1 | Partly |
| Transcripts are held 3 times (provider file, 491 MB cache, 472 MB in RAM); a 934 MB Codex file is reparsed on every change; 14.9k files are re-checked every 5 s | 03 §4.2, §5 | Partly: parse cost is CPU |
| The init message is 1.95 MB (could be ~0.3 MB); marking a chat done resends every message to every tab | 03 §3 | No: payload design |
| `runtime.ts`: 3,510 lines, ~11 concerns in one class | 03 §4.1 | No: structure |
| Model is stored in 8 places, kind 4 ways, 4 parsers per transcript format, turn events re-typed 4 times | 03 §2 | No: duplication |

**Conclusion.** Most of the slowness and weight is design, not TypeScript. Rust pays off in two
places: transcript ingest (CPU and memory heavy) and small, long-lived daemons that replace
per-turn Node processes.

---

## Part A — Architecture principles (apply in any language)

1. **One owner per piece of data.** Each fact has exactly one writer and one store. Everyone else
   reads through it: no copies, no mirrors, no "sync on read" (knowledge.js:83 copies memory heads into knowledge today).
2. **Types decide behavior.** The kind of a thing is a sum type fixed once at the boundary. Handlers
   never ask "which provider / which kind" again (runtime.ts:1196 has three identical branches).
3. **One authorization point.** A single `authorize(actor, op, target)`, where `actor = Owner | Buddy(id)`.
   Tool lists are presentation only. Today the `send` check runs in 7+ places.
4. **Nothing blocking on the event loop.** No `*Sync` fs, no big `JSON.parse`, no unindexed
   SQLite on request or timer paths. An event-loop lag monitor records any pause over
   100 ms and names the timer or route, so a regression becomes a journal entry instead of a mystery.
5. **Push patches, not snapshots.** The server sends field-level changes. Lists get summary rows
   and message bodies load on demand.
6. **Event-driven, not polling.** Wake on writes (enqueue, settle, file change) and keep one slow backstop tick.
   Never one timer per conversation.
7. **Delete instead of keeping compatibility.** One-time migrations, then the legacy code is gone. No shims,
   no optional "legacy" fields on the wire.
8. **Process boundaries follow ownership.** A separate process exists only when it owns
   something (a database, a watcher). Per-turn helper processes that only relay calls are removed.

9. **Every fix leaves a guard: a reason comment plus a test.** At the fix site, a short comment (1–3 lines) says
   what broke, the measured cost, and the name of the test that guards it. Example: "Indexed: a full scan here ran
   every 1 s tick and stalled the loop 0.6–2.5 s (2026-09-25). Guard: `reconcile tick never scans a table`."
   Long incident stories go to docs/commit messages, not code. The comment explains; the test and the stall monitor
   enforce. A comment alone does not stop a regression.

---

## Part B — Buddies: the lean model

### B.1 Primitives (11 tables, replacing 35)

Full SQL is in `01-buddies-package.md` §6.

| Primitive | What it is | Replaces |
|---|---|---|
| `workspace` | a folder Buddies work in | projects |
| `buddy` | an employee: role, model, `manager_id`, soul path, run limit | buddies, buddy_projects, buddy_relationships, access grants, skills, builder records |
| `task` | a unit of owned work; todos are child tasks | owned_projects, buddy_todos, work_items, sprints |
| `channel` | a Slack-like room | buddy_lists |
| `post` | anything written to a buddy, the owner, a channel or a task; may owe a reply | buddy_messages, buddy_list_posts, buddy_task_comments |
| `post_read` | read cursor per reader and channel | buddy_list_reads, owner-channel-reads.json |
| `doc` / `doc_revision` | soul, working and long-term memory, notes, scoped knowledge; every revision kept | memory_heads/revisions, knowledge/revisions, fs notes |
| `schedule` | cron + prompt | automations + policies |
| `run` | one execution of a buddy on some input: queue, lease, outcome | buddy_runs, automation_runs, conversation_links, checkpoints |
| `event` | write-only audit log with idempotency keys, time-limited | audit_events, command_receipts |

Deleted outright: mail (0 rows), approvals, delegations, reviews, checkpoints, access grants,
skills, builder_creations, sprints, work_items. The last live rows are from July or August.

### B.2 The behaviors (all composable functions over the primitives)

```
authorize(actor, op, target) -> Allowed | Denied(reason)        // owner | self | manager-of
post(actor, target, body, {replyTo?, taskId?, expectsReply?, key}) -> Post
reply(actor, postId, body, evidence) -> Post
readDoc(actor, buddyId, kind, scope) / writeDoc(actor, docKey, content, baseRevision, reason) -> Doc   // CAS
upsertTask(actor, changes, baseRevision) -> Task
enqueueRun(input: RunInput) -> Run          // RunInput = Chat | Mention | FollowUp | Schedule | Request | Return
claimRun() / settleRun(runId, outcome) -> Run
dueSchedules(now) -> Schedule[]  // the scheduler just enqueues Schedule runs
```

**Messages vs runs.** A request to another Buddy is a `post` with `reply_state='awaiting'`
plus a `run` for the recipient. The post is the conversation history and must be preserved. The run is
execution bookkeeping. A reply fills the post's reply fields and enqueues a `Return` run to the sender.
This combines the package report (posts) with the server report (mail as runs) and keeps all 600 messages intact.

### B.3 Where the code lives (the boundary)

| Layer | Owns | Does not own |
|---|---|---|
| **Buddies core** (package today, Rust daemon later) | the SQLite file, the 11 tables, `authorize`, the functions above, schedule math, retention | processes, conversations, UI |
| **Unleashd Buddy module** | running turns (runner), channel responder, briefing text, the MCP endpoint, the owner HTTP routes | table layout, authorization rules |
| **MCP tools** | nothing: a thin table of `{name, schema, handler}` calling core functions under the turn's grant | business rules |

Conversation linkage and foreground chat admission move from the package into unleashd.
The package CLI (566 lines) is deleted.

### B.4 Server modules (~1,900 lines, from 15,280). Detail in 02 §8

| Module | Lines | Job |
|---|---:|---|
| `grants.ts` | 100 | per-turn token → `TurnGrant {buddy, workspace, conversation, run, role}` |
| `mcp.ts` | 400 | 12 tools on one HTTP endpoint; the role (Worker/Owner/Reviewer) picks the subset |
| `runner.ts` | 350 | the only executor: claim → turn → settle; wakes on enqueue/settle, 5 s backstop |
| `schedule.ts` | 80 | cron → next; enqueue due runs |
| `briefing.ts` | 150 | the prompt preamble |
| `channels.ts` | 500 | @mention and follow-up responder |
| `routes.ts` | 250 | about 35 owner routes (from about 75) |
| `memory-review.ts` | 220 | the reviewer, same endpoint, receipts as events |
| `events.ts` | 30 | in-process change bus. This also fixes B2, because writes now happen in the process that is listening |

Buddies core in TS: about 1,000–1,200 lines for 11 tables and the functions. **Total: about 3–3.2k lines**, within the 2–4k target.
The Buddy client UI (20.6k lines) is scoped separately: about 2k lines go with the dead features; the rest follows the new routes.

### B.5 Tools over HTTP instead of per-turn helper processes

- All 4 installed CLIs accept an HTTP MCP server with a per-turn bearer token (02 §7).
- Missing piece: `vendor/agent-cli-tool` `McpServerSpec` is stdio-only. Add `{kind:'http', url, headers}` plus one encoder per harness and an HTTP startup probe. Commit inside the submodule first.
- Serve it from a separate loopback listener (not the auth-gated Express app), stateless streamable-HTTP.
- Result: 0 helper processes per turn and no second SQLite open; one credential instead of three; four files deleted.
- Muse can only take a literal header, so its token is written to a 0600 temp file. The token dies with the run.

### B.6 Migration (zero loss)

1. `VACUUM INTO` a backup of the v33 database. Open it read-only.
2. Write the clean schema to a **new file**. Import messages, channel posts and task comments into `post`. Import every memory and knowledge revision into `doc_revision`. Unmapped columns go into a `legacy` JSON column on each row.
3. Soul files are left as they are. Today: 44 match the DB with a version header, 4 match with no header (seed files), 3 are empty with no file, and **0 differ** (01 §7.2).
4. Verify per Buddy: row counts, content hashes per data class, revision chains, soul file hashes. Swap only if everything matches.
5. Delete `#migrate()` and every legacy path: about 1,450 lines.

---

## Part C — Rest of the app

### C.1 Split `runtime.ts` (03 §4.1)

| New unit | Job |
|---|---|
| `TurnQueue` | pure queue state machine |
| `TurnRunner` | spawn one turn and fold its events; no Buddy code, no provider branches |
| `BuddyTurnPolicy` | admission, briefing, grants; chosen once by conversation kind; a plain chat gets a no-op policy |
| `SwarmObserver` | one per folder, async (today: a 2 s blocking poll per running chat) |
| `TurnWatchdog` | timeouts |

Also delete the `ProviderEvent` layer so events are typed once, not four times, and move the Codex subagent branch into the Codex parser.

### C.2 Data model cleanup

- `Conversation` becomes a sum type by kind (Chat | Buddy | Worker), not 37 fields with about 11 nulls per row. The init drops from 1.95 MB to about 0.3 MB.
- Store the model in one place. The generated catalog is the only model list.
- Kind is encoded once: delete `buddyContext`, `purpose`, `placement` and the transcript text marker as sources of identity.
- `conversation_updated` becomes field patches.

### C.3 Deletions (03 §7)

| Item | Lines |
|---|---:|
| Merge (in progress) | ~800 |
| Safe dead code, re-typing layers, duplicate parsers (usage, context meter), catalog fallbacks, legacy config/UI-state migrations | ~3–4k |
| Incident-story comments (move to docs or commits) | ~1.5k |
| swarm/oompa: **kept for now, quarantined** (C.5) | 0 now |
| **Owner decision:** palette generator → presets | ~600 |

### C.4 Client

- Code-split the 1.08 MB bundle: routes lazy-loaded, desktop and mobile trees in separate chunks.
- Stop the ~10 full-list passes per conversation event. Stop regrouping the whole transcript while streaming.
- Merge duplicated helpers (a time-ago tick in 8 places, a home-path regex in 17).

---

### C.5 Swarm/oompa: quarantine, don't delete (owner decision 2026-09-25)

Oompa itself lives in `~/git/oompa_loompas`. Unleashd only views its runs by reading `.oompa/runs`.
The viewer code in this repo:

| Part | Lines | Separate? |
|---|---:|---|
| `server/src/swarm/` | 1,112 | yes |
| Swarm UI (`Swarm*.tsx/.css`, `InlineSwarmRunWidget`, `mobile/swarms/`) | 5,665 | yes |
| `shared/src/generated/oompa-types.ts` | 109 | yes |
| **Tangled into the core:** the per-conversation 2 s swarm poller and subagent in runtime.ts (97 mentions, ~200 lines); worker/swarm fields on every `Conversation` (`isWorker`, `swarmId`, `workerId`, `workerRole`, `swarmDebugPrefix`); oompa marker parsing in jsonl.ts (33 mentions); grouping in Sidebar, Gallery, Chat and mobile ConversationView (~76 mentions) | ~600 | **no** |

Plan: untangle only the core-touching part so the rest can be dropped later in one delete.
- Worker/swarm fields become one `Worker` variant of the Conversation kind (C.2).
- The poller becomes one async `SwarmObserver` per folder (C.1).
- Marker parsing moves behind one parser function.
- UI grouping reads one derived atom.

After that, removing swarms means deleting the separate folders plus one variant.

## Part D — Rust plan: in-process libraries, not extra servers

Owner decision (2026-09-25): no second communicating server. Rust code is **called from TS in-process**
as a native addon built with **napi-rs**, so there is still one server process.

How it works:
- A Rust crate compiles to a `.node` file that TS imports like any module (`import { core } from '@unleashd/core'`).
- napi-rs **generates the `.d.ts` from the Rust signatures**, so there is one source of types and no hand-kept contract.
- Heavy calls are `async` napi functions. They run on Node's worker thread pool, so SQLite and parsing never block
  the event loop. Long-lived work (a file watcher) runs on a Rust thread and calls back into JS
  through a thread-safe function.
- The Rust side owns its SQLite connection, so there is no second process opening the file.
- Risks: a Rust panic is caught at the boundary and becomes a JS error; a hard crash (unlikely in safe Rust)
  would take the server down with it. Builds are per platform, but only macOS arm64 is needed today.

| Step | Crate | What it exposes to TS | Replaces |
|---|---|---|---|
| **D1. `unleashd-buddies`** | the lean Buddies core (B.1–B.3): 11 tables, `authorize`, `post`/`reply`/`writeDoc`/`upsertTask`/`enqueueRun`/`claimRun`/`settleRun`/`dueSchedules`, retention, and the one-time v33 import with verification | async functions returning typed rows | the 11.4k-line package, `#migrate`, the per-turn SQLite opens |
| **D2. `unleashd-ingest`** | FSEvents watcher, six transcript parsers, incremental tail reads, one SQLite store | `listSessions(since)`, `messages(id, afterSeq, limit)`, `onChange(cb)` | jsonl.ts (2,339), the 491 MB cache, 472 MB in RAM, the 5 s rescan, the usage/context re-parsers |
| ~~D3. `agent-cli`~~ | **Dropped (2026-09-25):** it is 4.1k lines of TypeScript and already thin (argv building + stream parsers). Its cost is the provider CLIs it spawns, which Rust cannot change. It stays TS; it only gains the HTTP MCP variant (B.5). | — | — |
| **D4. Runtime pieces** | `TurnQueue`, watchdogs, and so on after the C.1 split, one piece at a time | — | parts of runtime.ts, only if still worth it |

**The MCP tool endpoint stays in the TS server.** It is a thin HTTP handler (B.5) whose 12 tools call the
D1 functions directly. There are no helper processes and no second server, and the tools run in the process that owns
the change bus (this is what fixes B2).

Why D1 first: it is being rewritten anyway (write it once), it is small (~1.5k lines of Rust), and it takes SQLite
off the event loop for good. The runner, channels and briefing stay in TS because they are tied to the conversation
runtime. They call D1 like a library.

The alternative (lean core in TS first, port later) is lower risk while the data model changes, but
writes the same code twice.

---

### D.1 Build and reload (measured 2026-09-25, rustc 1.93, napi-rs 2 + bundled rusqlite)

| Build | Time |
|---|---|
| First clean debug build (compiles SQLite from C + all deps) | 10.7 s |
| Incremental debug rebuild after editing the crate | 0.14 s (tiny probe crate; expect ~1–3 s at 1.5–3k lines) |
| Clean release build | 14.6 s |
| Incremental release rebuild | 0.2 s |
| Node loads the `.node` addon and runs a query on the real DB copy | 7.8 ms |

Only the edited crate recompiles; dependencies are cached. Splitting into several crates (core / import / ingest)
keeps each rebuild small.

**Hot reload.** Node cannot unload a native addon from a running process, so a Rust change means
rebuild and then restart the backend. That is what already happens for any server TS change: the dev watcher
restarts the backend and defers until running turns finish. So the dev loop is the same as today: save → cargo build
(1–3 s) → backend restart. Frontend HMR is unaffected. Wire `cargo build` into the existing server watcher
(tools/watch-server.mjs) so a `.rs` save triggers it.

## Part E — Order of work

| Phase | Work | Size |
|---|---|---|
| **0. Now** | deploy the tick fix (`ab47223`); fix B1 (channel seat turns carry owner authority, `channel-responder.ts:610`); land merge deletion; launch the compiled MCP entrypoint in dev; event-loop lag monitor; async fs in usage/context/swarm; `conversation_updated` as patches | days |
| **1. Buddies lean** | new schema + verified import; core as the D1 napi-rs crate (or TS); HTTP MCP in agent-cli; new server modules; delete old package code, 25+ server files and ~2k client lines | 1–2 weeks |
| **2. App cleanup** | split runtime.ts; Conversation as a sum type; slim init; deletion list; client code-split and derived-atom fixes | 1–2 weeks |
| **3. Transcript ingest crate (D2)** | build next to the current loader, compare on real data, switch, delete jsonl.ts/cache/poller | 1–2 weeks |
| **4. Later** | D4 runtime pieces, only if still needed | — |

Each phase lands on its own branch with the checks from CLAUDE.md. Commit-level verification applies.

---

## Decisions (recommended defaults; override any)

| # | Question | Default |
|---|---|---|
| 1 | Keep doc audience scopes (owner-private vs team)? | **Keep** a `scope` on `doc`. It is cheap and preserves the privacy contract. |
| 2 | Task comments: posts or events? | **Posts** (target = task), so they stay readable history. |
| 3 | Messages as runs? | **Post + run** (B.2), so all messages are preserved. |
| 4 | The one enabled legacy automation (`0 22 * * *`) | **Migrate** it to a `schedule` row. |
| 5 | Muse as a Buddy harness (token in a 0600 file) | **Allow**: the token is per-run and revoked at settle. |
| 6 | Fix B1 now? | **Yes**, independently of the rewrite. |
| 7 | 5 thread-scoped soul edits that differ from the main soul (3 `builder-*`, `betting-deployment-lead`, `quant-lead`) | Import as separate thread docs, **flagged**; the owner decides later. |
| 8 | 10 memberships outside a buddy's home workspace | **Ask the owner** before the import (listed in 01 §6). |
| 9 | Swarm/oompa | **Decided: keep for now, but quarantine it** (C.5). Swarms are moving to Buddies and automations; delete later. Palettes (~600): owner call. |
| 10 | Buddies core: Rust now (D1, in-process napi-rs) or TS first? | **Rust now, in-process.** |
