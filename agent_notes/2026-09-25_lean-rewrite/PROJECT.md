# Lean rewrite — project board (started 2026-09-25)

Design: `DESIGN.md`. Evidence: `00`–`04` reports in this folder.

## Branching

- **Integration branch:** `lean/integration`, in worktree `~/git/unleashd/.claude/worktrees/lean-integration`.
  It starts from `feat/channels-project-view-2026-09-22` @ cbb8820.
- Every workstream branches off `lean/integration` in its own worktree and is merged back by the orchestrator
  after checks pass on the committed tree.
- The owner's branch and the live `~/.buddies` DB stay untouched until the owner approves a merge or swap.
- Hard rules from CLAUDE.md apply to every agent: stage file-by-file, verify the commit, no stash/reset --hard,
  never push, biome, `pnpm typecheck` (tsc -b), `pnpm test:client`, `tools/check-client-invariants.sh`.

## Workstreams

| Code | Workstream | Owner's name for it | Goal |
|---|---|---|---|
| SPD | Speed-up | speed-up | nothing blocks the event loop; the client stops doing O(n) work per event |
| SAF | Safety | — | one authorization point; fix B1 |
| DET | Detangle | re-architecture / detangle | split runtime.ts; Conversation as a sum type; patches instead of snapshots |
| DAT | Data model | redesign data model | Buddies: 35 tables → 11, zero-loss import |
| SQL | SQLite / Rust core | redo SQLite | `crates/unleashd-buddies` (napi-rs); SQLite off the event loop |
| SUB | Sub-portions | rebuild the sub-portions | Buddy server modules, HTTP MCP, transcript ingest, deletions |

## Tasks

Status: ☐ todo · ◐ running · ☑ merged into lean/integration · ⛔ needs owner

| ID | Task | Stream | Depends on | Wave | Status |
|---|---|---|---|---|---|
| T00a | Lean target for server core + shared: canonical model, wire contract, per-module line budgets for a 3–4x cut → `05-target-server-core.md` | DET/DAT | — | 1 | ☑ 05-target-server-core.md |
| T00b | Lean target for client + 18.8k CSS: atoms, view-tree sharing, styling layer, per-module budgets → `06-target-client.md` | DET | — | 1 | ☑ 06-target-client.md |
| T01 | Reconcile tick indexes (the nested scan-in-loop) | SPD | — | 0 | ☑ ab47223 |
| T02 | Delete merge | DET | — | 0 | ☑ 8c9fcfa |
| T03 | Fix B1: channel seat turns must not carry owner authority | SAF | — | 1 | ☑ 59ea29a (merged 7549a27) |
| T04 | Server speed: event-loop lag monitor → error journal; async fs in usage/context routes; prebuilt MCP entrypoint in dev; no per-conversation 1 s admission poll | SPD | — | 1 | ☑ 4 commits, merged 176361b |
| T05 | Client speed: stop ~10 full-list passes per event; no whole-transcript regroup while streaming; route code-splitting; dedupe time-ago and home-path helpers | SPD | — | 1 | ☑ 4db9a1c (v2, rebased), on lean/integration |
| T06 | `crates/unleashd-buddies`: napi-rs crate, the 11-table schema, `authorize`, the core functions, v33 → new importer with a zero-loss verification report (run on the DB copy) | SQL/DAT | — | 1 | ☑ merged f6cc2ca — zero-loss import verified on the copy |
| T06b | Unified posts (owner model): everything is a post in a channel — Public / Direct{members} / Task; replies are posts; one read cursor for all; zero-loss re-import → `db/buddies-v3.sqlite` | DAT/SQL | T06 | 1 | ☑ merged 7449071 — v3 import verified (bytes equal, 261/261 replies) |
| T07 | agent-cli: HTTP MCP variant (`{kind:'http'}`) for claude/codex/cursor/muse + HTTP startup probe; fix muse `mcpServers` key (B5) | SUB | — | 1 | ☑ b9c819f (sub) + fc69cb2, merged f940da2 — submodule commit NOT pushed |
| T08 | (aims at T00a budgets) Detangle runtime.ts into TurnQueue / TurnRunner / BuddyTurnPolicy / SwarmObserver / TurnWatchdog; delete the ProviderEvent re-typing layer and the provider ternary | DET | T02, T04 | 2 | ☑ merged d7613fd — runtime.ts 3,395→1,086; moved not yet cut (4,199 total), budgets land with T09/T11/T14 |
| T09 | Conversation as a sum type (Chat \| Buddy \| Worker); one kind encoding; slim init (~0.3 MB); `conversation_updated` as field patches | DET | T08 | 2 | ☑ merged 5da6fa3 — init 1.87 MB→274 KB, done 1.36 MB→93 B, startup 33→7.5 s |
| T10 | Swarm quarantine: Worker variant, one async SwarmObserver per folder, one marker parser, one derived atom for grouping | DET | T09 | 3 | ☑ merged 84e8038 — swarm behind one entry per side + quarantine guard tests |
| T11 | Buddy server rewrite on the T06/T06b crate: grants, HTTP MCP endpoint (12 tools, 3 roles), runner, schedule, briefing, channels, ~35 routes, events; delete the old package, 25+ server files and dead client UI | SUB/DAT | T06, T07, T08 | 3 | ☑ merged e721900 — UUIDv7 ordered ids; Buddy server 15.5k→4.5k lines |
| T12 | `crates/unleashd-ingest`: watcher, six parsers, tail reads, SQLite store; compare harness against the current loader on real data | SUB/SQL | — | 2 | ☑ merged 08baecd — 100% parity on real transcripts; restart 7.2 s → ~1 s; 934 MB append 11.8 s → 74 ms |
| T13 | Switch the server to ingest; delete jsonl.ts, session cache, poller, usage/context re-parsers. Crate fixes first (BENCH-ingest-js-vs-rust.md): settle 50 ms→5–10 ms, per-file kqueue watch on growing files, no full re-read on Codex EventMode flip. Never open the store with node:sqlite in-process (SIGBUS) | SUB | T12, T09 | 4 | ☐ |
| T14 | Safe deletion list (03 §7 items 1–2, 6, 8, 9, 16, 19; incident comments → docs) | DET | T09 | 3 | ☐ |
| T17 | Test audit: delete tautology/mirror/mock-heavy tests (owner rule), keep integration + regression guards, put server/test under typecheck | DET | — | 2 | ☑ merged f3bae5f — tests now typechecked; 41 T08/T11 files temporarily excluded |
| T18 | Client plan S0: screenshot coverage for every route + `--compare` pixel diff between runs (prerequisite for CSS/view work) | DET | T05 | 2 | ☑ merged 81c21d1 — 106 shots × 4 sizes, compare = 0% drift; tool now read-only |
| T19 | Client state collapse: 57 atoms → 8 base + 6 derived (one `listIndexAtom`, `rowFamily`, `groupsFamily`); delete per-view derivations, pending-creation migration, config re-derivation (06 §1) | DET | T09 (new row shape) | 3 | ◐ running (lane-client-state) |
| T20 | (O1 approved 2026-09-25) One view tree: shared device-neutral views + two thin shells; deletes ~5k duplicated mobile lines (06 §2; needs owner decision O1: relax "mobile never imports components/*") | DET | T19, O1 | 3 | ☐ (O1 pending) |
| T21 | CSS layers: tokens → primitives → markdown → views → shells; 18.5k → ~3.75k, verified by T18 pixel diffs; new ratchet gates (06 §3) | DET | T18, T20 | 4 | ☐ |
| T22 | Buddy UI on the 7-tab route model (06 §4) — whatever T11 leaves for the client | SUB | T11 | 4 | ◐ running (lane-buddy-ui) |
| T13a | Ingest crate fixes (settle 50→5–10 ms, per-file kqueue on growing files, no full re-read on Codex EventMode flip) + per-turn usage and latest-context aggregates in the store (replace /api/usage + context-meter re-parsers) — crate only | SUB/SQL | T12 | 3 | ☑ merged cf5e3aa — append→onChange 68→4–9 ms; usage 38 s → 755 ms; no EventMode re-read |
| T23a | Config records → Rust store: 16.8k JSON files → one SQLite table owned by the ingest crate (CAS, by-session index, provenance), zero-loss importer + verifier on a COPY — crate only | DAT/SQL | T12 | 3 | ☑ merged 75c1458 (local) — 8,018/8,018 records hash-equal; startup list 1,971 ms → 17 ms (125 ms via addon). T23b: records get their OWN file |
| T14a | Safe deletions in files no running task owns: dead exports/functions, catalog fallbacks → generated catalog as the single source, legacy UI-state migration, uploads retention/GC, send_message WS cmd if unused | DET | — | 3 | ☑ merged 6b2467e — ~1.4k lines; one catalog; uploads GC |
| T21a | CSS layer 1–2: design tokens + primitives, collapse the 45 font sizes / 172 paddings / 9 breakpoints, add ratchet gates; proven by T18 compare | DET | T18 | 3 | ☑ merged e125c7c — tokens + primitives, non-Buddy CSS −7% (weight is in T20 view dup + Buddy CSS), gates G7/G8 |
| T13b-1 | Transcripts → ingest crate at boot; delete jsonl.ts, session cache, 5 s poller (lane-ingest-switch) | SUB | T09, T13a | 4 | ◐ running |
| T13b-2 | /api/usage + context meter → crate usage()/latestContext(); delete TS re-parsers (lane-usage-switch) | SUB | T13a | 4 | ◐ running |
| T23b | Config records → Rust ConversationRecords (own file); delete config-store.ts; importer accepts T09 kind (lane-records-switch) | SUB | T09, T23a | 4 | ☑ merged 9e3d73f — records from Rust store; listing 3–6 s → ~100 ms; config-store.ts deleted |
| T14b | Deferred deletions (send_message, legacy migrations, dead wire types), channelId rename, dev watcher builds crates, memory 411→490 MB investigation, memory-curation harness (lane-cleanup) | DET | T14a | 4 | ☑ merged f6f629b — send_message/legacy/dead wire types gone; channelId; crate rebuild-on-save; memory rise = startup heap spike from old config store (now gone) |
| TL | Thread load: sigils rendered in a Web Worker; cold "Loading thread" 782→184 ms | SPD | — | 3 | ☑ merged f25777c |
| T15 | **Owner gate:** swap the live `~/.buddies` DB to the new schema (backup + verified import) | DAT | T11 | 4 | ⛔ |
| T16 | **Owner gate:** merge `lean/integration` into the working branch and restart the backend | — | each wave | — | ◐ Wave 1 pushed to origin/main f6cc2ca (2026-09-25, owner asked); backend restart still owner’s |

## Decisions taken (DESIGN.md table; owner may override)

Doc scopes kept · task comments = posts · messages = post + run · migrate the one legacy automation ·
muse allowed · B1 fixed now · 5 divergent thread-souls imported as flagged thread docs ·
10 non-home memberships preserved in the import report + `legacy` column (no data dropped) ·
swarm quarantined, not deleted · Buddies core in Rust, in-process napi-rs · agent-cli stays TS.

## Execution queue (max 4 agents at once; small, fresh slices)

| Slot | Slice | Depends on | Status |
|---|---|---|---|
| 1 | S1 ingest: boot + list rows (+ usage-switch merged in) | — | ☑ fe0dc8c on feat/ingest-switch — merge only WITH S2 |
| 2 | S3 client state | — | ☑ merged b3cd090 — 65 → 19 exported atoms; re-render bug fixed |
| 3 | S4 Buddy UI features 1–4, 9 | — | ☑ merged 17e8cc6 |
| 4 | T15-prep: dry run + runbook | — | ☑ both imports verified on fresh live snapshots; T15-RUNBOOK.md |
| ☑ | S12 build tooling (merged 400c93f; no-Rust lane setup 5.5 s, addons 0.01 s): `tools/ensure-addons.mjs` (a source-hash-keyed `.node` cache shared by all worktrees and the dev loop; build only on a miss, with nice, jobs=3 and a shared target dir); split the one-time importer/verifier/CLI tools into their own crates so the addon doesn't rebuild for them | — | ◐ running |
| 4 | S2 ingest: message bodies via `messages()`; delete jsonl.ts, session cache, 5 s poller | S1 | ☑ done 3c93975 (net −8,486 lines; warm boot 1.1 s); landing agent resolving 3 conflicts |
| 3 | S5 Buddy UI features 5–8 | S4 | ☑ merged b484aaa |
| 2 | PORT: other sessions' committed QoL fixes | — | ☑ merged 76a0512 — 3 ported, 5 already covered; submodule 85ba151 pushed |
| gate | PORT-2: the active session's 77 uncommitted files, once THEY commit them; T20 waits for this (same files) | their commit | ⛔ |
| 1 | S6 Buddy CSS token pass (not channel CSS: another session is editing it) | S4 | ◐ running |
| next | S7 T20 one view tree (split by screen group), O1 approved | S3, PORT-2 | ☐ held so it doesn't clobber the active session's edits |
| next | S8 T21b CSS views and shells | S7 | ☐ |
| 2 | S9 ingest crate: Codex rate limits per bucket | — | ☑ merged 1079114 |
| 2 | S9b usage labels (168h → 7d; weekly-only payload) | — | ◐ running |
| next | S10 thread-load follow-ups: markdown 190 ms first view, start the thread request from the URL, cache sigils across reloads | — | ☐ |
| 3 | S11 docs + leftovers: CLAUDE.md/architecture/pass-through mention of config-store; delete legacy-config-migration.ts + codex-composite-model.ts (now unblocked) | — | ☑ merged; package-smoke removed (broken) |
| owner | memory-curation harness port: the baseline prompt names old tools, 40 paid calls | owner decision | ⛔ |
| owner | T15 live swap + restart | T15-prep, S2 | ⛔ |
| queued | BUDGET passes (server / client / Rust): compare each module with its 05/06 line budget; consolidate the overages | S2, T20 | ☐ (proposed; owner asked) |
| next | FIX test:api: fails on integration (2 pass / 14 fail), probably boot now needs the Buddies DB and the records file on a fresh data dir. Owner of the fix is TBD after S2 lands | S2 land | ☐ |
| next | Packaging smoke for the napi addons (replaces the deleted package-smoke.js) | — | ☐ |

## Wrap-up (2026-09-26)

| # | Step | Status |
|---|---|---|
| 1 | Land S2 through the full gate | ☑ merged 47468ed (test:api failure predates S2) |
| 2 | S6 Buddy CSS | ☑ merged 94e0ae4 — Buddy literals 215→0, G8 cap 14,961→14,855; screenshot tool fixed for v3 |
| 3 | PORT-2: other session's 6d04860 / 89b27ad / c5e0ded (workspace home, emblems) | ◐ running |
| 4a | Post-S2: fix test:api (2/14) + a napi-addon packaging smoke test | ◐ running |
| 4b | Post-S2: labels, docs, `sessionEvidence` rename | ☑ merged a688d7a |
| 5 | Final review: correctness review of lean/integration vs main, fix findings, final line/perf/table report | ☐ last |
| owner | T15 live swap (runbook ready; decide the 20 queued runs) + merge integration → working branch / main | ⛔ |

**Deferred follow-ups** (documented, not in this wrap-up): T20 one view tree and T21b CSS shells (they rewrite files the other session is
editing; start after it commits and PORT-3 lands); the budget passes; the memory-curation harness (baseline prompt + 40 paid calls);
swarm deletion and feature removals (owner decisions); deleting the one-time importers and record-migration after the live swap.
