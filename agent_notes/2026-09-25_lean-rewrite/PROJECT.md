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
| T10 | Swarm quarantine: Worker variant, one async SwarmObserver per folder, one marker parser, one derived atom for grouping | DET | T09 | 3 | ☐ |
| T11 | Buddy server rewrite on the T06/T06b crate: grants, HTTP MCP endpoint (12 tools, 3 roles), runner, schedule, briefing, channels, ~35 routes, events; delete the old package, 25+ server files and dead client UI | SUB/DAT | T06, T07, T08 | 3 | ☑ merged e721900 — UUIDv7 ordered ids; Buddy server 15.5k→4.5k lines |
| T12 | `crates/unleashd-ingest`: watcher, six parsers, tail reads, SQLite store; compare harness against the current loader on real data | SUB/SQL | — | 2 | ☑ merged 08baecd — 100% parity on real transcripts; restart 7.2 s → ~1 s; 934 MB append 11.8 s → 74 ms |
| T13 | Switch the server to ingest; delete jsonl.ts, session cache, poller, usage/context re-parsers. Crate fixes first (BENCH-ingest-js-vs-rust.md): settle 50 ms→5–10 ms, per-file kqueue watch on growing files, no full re-read on Codex EventMode flip. Never open the store with node:sqlite in-process (SIGBUS) | SUB | T12, T09 | 4 | ☐ |
| T14 | Safe deletion list (03 §7 items 1–2, 6, 8, 9, 16, 19; incident comments → docs) | DET | T09 | 3 | ☐ |
| T17 | Test audit: delete tautology/mirror/mock-heavy tests (owner rule), keep integration + regression guards, put server/test under typecheck | DET | — | 2 | ☑ merged f3bae5f — tests now typechecked; 41 T08/T11 files temporarily excluded |
| T18 | Client plan S0: screenshot coverage for every route + `--compare` pixel diff between runs (prerequisite for CSS/view work) | DET | T05 | 2 | ☑ merged 81c21d1 — 106 shots × 4 sizes, compare = 0% drift; tool now read-only |
| T19 | Client state collapse: 57 atoms → 8 base + 6 derived (one `listIndexAtom`, `rowFamily`, `groupsFamily`); delete per-view derivations, pending-creation migration, config re-derivation (06 §1) | DET | T09 (new row shape) | 3 | ☐ |
| T20 | (O1 approved 2026-09-25) One view tree: shared device-neutral views + two thin shells; deletes ~5k duplicated mobile lines (06 §2; needs owner decision O1: relax "mobile never imports components/*") | DET | T19, O1 | 3 | ☐ (O1 pending) |
| T21 | CSS layers: tokens → primitives → markdown → views → shells; 18.5k → ~3.75k, verified by T18 pixel diffs; new ratchet gates (06 §3) | DET | T18, T20 | 4 | ☐ |
| T22 | Buddy UI on the 7-tab route model (06 §4) — whatever T11 leaves for the client | SUB | T11 | 4 | ☐ |
| T13a | Ingest crate fixes (settle 50→5–10 ms, per-file kqueue on growing files, no full re-read on Codex EventMode flip) + per-turn usage and latest-context aggregates in the store (replace /api/usage + context-meter re-parsers) — crate only | SUB/SQL | T12 | 3 | ☑ merged cf5e3aa — append→onChange 68→4–9 ms; usage 38 s → 755 ms; no EventMode re-read |
| T23a | Config records → Rust store: 16.8k JSON files → one SQLite table owned by the ingest crate (CAS, by-session index, provenance), zero-loss importer + verifier on a COPY — crate only | DAT/SQL | T12 | 3 | ☑ merged 75c1458 (local) — 8,018/8,018 records hash-equal; startup list 1,971 ms → 17 ms (125 ms via addon). T23b: records get their OWN file |
| T14a | Safe deletions in files no running task owns: dead exports/functions, catalog fallbacks → generated catalog as the single source, legacy UI-state migration, uploads retention/GC, send_message WS cmd if unused | DET | — | 3 | ☑ merged 6b2467e — ~1.4k lines; one catalog; uploads GC |
| T21a | CSS layer 1–2: design tokens + primitives, collapse the 45 font sizes / 172 paddings / 9 breakpoints, add ratchet gates; proven by T18 compare | DET | T18 | 3 | ☑ merged e125c7c — tokens + primitives, non-Buddy CSS −7% (weight is in T20 view dup + Buddy CSS), gates G7/G8 |
| T13b / T23b | Switch server transcripts + config records to the Rust store; delete jsonl.ts, session cache, poller, usage/context parsers, config-store.ts | SUB | T09, T13a, T23a | 4 | ☐ |
| T15 | **Owner gate:** swap the live `~/.buddies` DB to the new schema (backup + verified import) | DAT | T11 | 4 | ⛔ |
| T16 | **Owner gate:** merge `lean/integration` into the working branch and restart the backend | — | each wave | — | ◐ Wave 1 pushed to origin/main f6cc2ca (2026-09-25, owner asked); backend restart still owner’s |

## Decisions taken (DESIGN.md table; owner may override)

Doc scopes kept · task comments = posts · messages = post + run · migrate the one legacy automation ·
muse allowed · B1 fixed now · 5 divergent thread-souls imported as flagged thread docs ·
10 non-home memberships preserved in the import report + `legacy` column (no data dropped) ·
swarm quarantined, not deleted · Buddies core in Rust, in-process napi-rs · agent-cli stays TS.
