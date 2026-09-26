# T13b-2: /api/usage and the context meter now read the ingest crate (2026-09-26)

Branch `feat/usage-switch` (worktree `.claude/worktrees/lane-usage-switch`). Not pushed or merged.

| SHA | What |
|---|---|
| `51c558b` | `server/src/ingest/instance.ts`: `IngestAccessor` / `provideIngest` / `currentIngest` (slot `starting` or `ready`); adds the `@unleashd/ingest` dependency to server |
| `d196373` | UsagePanel treats a non-OK `/api/usage` response as a failure (a 503 body would have thrown on `data.daily`) |
| `fa6f1ee` | The switch: `usage-routes.ts` calls `usage()`, `session-context.ts` calls `latestContext()`, and the context breakdown's per-session usage comes from `session(id).usage`; the TS parsers, caches and parity tool are deleted |
| `2203db4` | `docs/patterns.md` one-write-path "Here:" line |

**Lines:** −2,227 / +562 net over 19 files.
- usage-routes.ts: 788 → 297.
- session-context.ts: 421 → 60.
- Deleted: 4 parser unit tests (503 lines), `tools/ingest-usage-parity.ts` (317), and the usage section of `ingest-parity.ts` (52).

**Merge contract with the ingest-switch lane:** boot calls `provideIngest(ingest)` after `Ingest.start`. Until that lands, this branch serves `/api/usage` as 503 and the meter shows estimates only. That state is explicit, never a guessed number. `server.ts` passes `currentIngest` to `registerUsageRoutes` and to the conversation routes (`deps.ingest`, which replaces `lookupUsage` / `lookupContext`).

**Route latency** (dev machine, real roots; the "after" store is a scratch DB whose cold ingest took 11.4 s):

| days | before (TS) | after (crate) |
|---|---|---|
| 30 | 16,516 ms | 966 ms cold, 386 ms warm |
| 7 | 6,157 ms | 169 ms |
| 365 | n/a | 1,553 ms (100 day rows) |

**Numbers change as T13a predicted.** The window rule is now per request: at days=30, $10,316 (TS) vs $8,414 (crate); sessions 2,202 vs 2,287.
- Each daily row is priced per provider: one range query per UTC day that has usage.
- A session's `date` is the UTC day of its last request in the window.
- `model` is null when the transcript names none (Codex had the fake `'codex'`). The client does not render it.

**Guards:**
- `usage-context-async-parity.test.ts` runs the real `Ingest.start` over the fixture HOME with a fixed clock. It asserts the per-source totals and context readings that the TS implementation recorded, byte for byte (Claude, Codex, OpenCode, Muse).
- It also asserts the per-request window: `CLAUDE_OLD` has a turn 40 days ago plus one yesterday, and only yesterday's counts. Codex cached pricing is 0.045, not all-uncached. Every daily and rate-limit value was computed by hand before the run, and all matched.
- To match real transcripts, the fixture gained Codex timestamps, `session_meta` and a user message, a Muse `stream` / `recorded_at` / start event, and an OpenCode part file. The store keeps only sessions with a visible message.
- Crate `tests/aggregates.rs` owns dedup, sidechain, the Codex reset sentinel and Muse `failed` compaction, so the TS unit tests of those are deleted.

**Checks** on a clean committed tree (`git status --porcelain` empty):
- typecheck 0
- test:server 256/256
- test:client 136/136
- invariants 0
- vite build 0

**Follow-up (crate, not fixed here):** Codex now writes several `rate_limits` buckets (`limit_id` `codex` and `premium`). The newest payload on this machine is `premium`, with `primary` and `secondary` both null, so the panel shows no Codex limits. `usage()` should return the latest payload per `limit_id`, or the latest one that has a window.
