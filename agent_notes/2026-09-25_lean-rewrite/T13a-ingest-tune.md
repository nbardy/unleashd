# T13a — ingest crate tune + usage/context aggregates (2026-09-25)

Branch `feat/ingest-tune` (from `lean/integration` @ 81c21d1), worktree
`~/git/unleashd/.claude/worktrees/agent-a0706b3fda22d979b`. Crate-side only: no server code changed. Not merged,
not pushed by this task (the coordinator backed up an earlier state to `origin/wip/ingest-tune`).

| SHA | What |
|---|---|
| `20541c3` | watcher: kqueue watch on growing files, 2 ms burst settle (was a fixed 50 ms), compact digest sets in checkpoints |
| `c80a4f2` | Codex event-mode switch withdraws shown messages instead of re-reading from byte 0 (`Apply` sum type) |
| `86ae723` | `usage_turn` table + `session.context` / `session.rate_limits` (schema 2); napi `usage()` and `latestContext()` |
| `28440b5` | `tools/ingest-usage-parity.ts`, patterns.md entries, README |

Verified: `git status` clean at `28440b5` (the tree is HEAD). `cargo test --no-default-features` (45 tests, 7
binaries), clippy with no warnings, rustfmt, release build plus the Node test (it calls `usage` and `latestContext`
across the boundary), biome on the tools. The parity harness ran once, on `86ae723` plus the harness.

## 1. Latency

Measured with `tools/ingest-measure.ts crate-tail`, which appends to an APFS clone in a scratch dir. Release build.
Machine load average was 20–28 on 10 cores during the runs.

| append → `onChange` | before (50 ms settle, FSEvents only) | after |
|---|---|---|
| 934 MB Codex rollout, 15–30 appends | p50 **68 ms**, max 79 | p50 **6 ms** (load 21) / **9 ms** (load 22, 30 appends), max 22 |
| 121 MB Claude transcript | p50 **66 ms**, max 69 | p50 **4 ms**, max 24 (one of 30 above 12) |
| first write to a file (FSEvents, no kqueue watch yet) | ~70 ms | 3–19 ms over 6 fresh runs |

Where the time goes, from a trace of watched-file batches: 2.2–3.8 ms waiting (the quiet window plus timer
granularity), then processing of 0.5–1.2 ms for Claude and 1.9–2.8 ms for Codex (checkpoint decode/encode and one
transaction).

- `watch.rs`: **burst settle**. A batch closes `QUIET` = 2 ms after its last event (cap `MAX_BATCH` = 25 ms), so a
  burst of lines is still one revision.
- `filewatch.rs` (new, 202 lines, libc kqueue): FSEvents stays the recursive discovery watch. Once FSEvents reports a
  file as written, that file also gets an `EVFILT_VNODE` watch (`NOTE_WRITE|EXTEND|DELETE|RENAME`, up to 64 files,
  dropped after 5 min idle or on delete/rename). The FSEvents copy of the same write re-reads nothing, because the
  stamp is unchanged. notify cannot run FSEvents and kqueue in one build (cfg-exclusive features), so this is direct
  libc.
- Checkpoint digest sets (Codex call ids, Claude usage ids) are now one base64 string instead of a JSON number array.
  The rollout's checkpoint went from 188 KB to 108 KB; it is decoded and re-encoded on every append.
- Guards: `tests/watch.rs` runs a real watcher and requires a median below 30 ms (the 50 ms window fails it), plus
  filewatch unit tests and `tests/regressions.rs` `codex_call_id_digests_cost_about_eleven_bytes_each…`.

## 2. No full re-read on a Codex event-mode flip

The TS parser picks one source for the whole file: once a file has event messages, response-item messages are never
shown. Before this change, the first event line after shown response-item messages triggered a full re-read
(`Rebuild::EventMode`).

Now the Codex fold remembers the seqs of the response-item messages it has shown, which only matters while the file
is not in event mode. On the first event message it withdraws them and continues from the state event mode would
have had. Nothing else depended on those messages: they were the only readers and writers of `prev` (dedupe and
reply start time) and the only user messages (first-prompt markers). Every other item keeps its order.

- `read.rs`: `Outcome.apply` is now `Append | Replace | Withdraw(seqs)`, replacing `replace: bool`.
  `Rebuild::EventMode`, the `codex_events` hint and the retry are deleted: a full read handles the switch inside its
  buffer.
- `store.rs`: `Withdraw` deletes those seqs, then renumbers with one primary-key range update per gap, passing
  through negative seqs so no key collides. A correlated `count(*)` per row took 0.9 s.
- Real file: the 934 MB clone of the legacy rollout (2,076 response-item messages, 0 event messages, 8,258 tool
  calls), measured with `--line codex-event`:
  - The flip append takes **374 ms**, and no full re-read is logged. All of that time is the store rewriting ~10k
    renumbered rows.
  - Before, the file was re-read: 1.7–3.5 s (BENCH-ingest-js-vs-rust.md).
  - Later appends take 4–8 ms.
- Guards:
  - `tests/tail.rs` `codex_switch_to_event_mode_withdraws_without_a_reread` fails unless the append is `Resumed` and
    `bytes_read` equals the appended bytes. It also checks that withdraw + append equals a full read.
  - `tests/engine.rs` checks the store renumbering against a fresh full read.
  - The resume == full property test (formats.rs) now hits the switch at every line boundary.

## 3. Usage and context in the store

**Store (schema 2).**
- `usage_turn(source_id, n, at, model, input, output, cache_read, cache_write, reported_cost)` has a primary key of
  `(source_id, n)` and an index on `at`. What counts as one turn:
  - Claude: one counted message id. It keeps the TS rule that a missing id is the key "undefined".
  - Codex: one growth of the cumulative `total_token_usage`. The turns telescope exactly to the last total, and a
    repeated total is not a turn.
  - OpenCode: one assistant message, with the cost the provider recorded.
- `session.context` holds a `ContextReading` for each format:
  - Claude: input + cache read + cache write from the last main-thread request; sidechain rows are skipped.
    `compact_boundary` gives the compaction count, pre/post tokens and trigger.
  - Codex: the last `last_token_usage.input_tokens` above 0 (the post-compaction 0 is skipped),
    `model_context_window`, and a count of top-level `compacted` records.
  - Muse: the last `model_completed` input; window = target / soft from the compaction strategy; only `succeeded`
    compactions count.
  - OpenCode: the newest assistant message by creation time.
- `session.rate_limits` holds Codex's last `rate_limits` payload as raw JSON.

**API** (`index.d.ts`, +81 lines):

```ts
usage(query: { since: number; until?: number; groupBy: 'session' | 'day' | 'model' }): Promise<{
  groups: Array<{ key: UsageKey; turns; sessions; input; output; cacheRead; cacheWrite; reportedCostUsd; firstAt; lastAt }>;
  codexRateLimits?: string;
}>
UsageKey = { t:'session', sessionId, sourcePath, provider, format, model? } | { t:'day', day } | { t:'model', provider, model? }
latestContext(sessionId: string): Promise<{ contextTokens; contextWindow?; compaction?: { count; preTokens?; postTokens?; trigger? } } | null>
```

- `since` is required, so every usage read is a range on the turn-time index. Pricing stays with the caller, except
  `reportedCostUsd` (OpenCode).
- The query-plan guard now also covers the usage, context, rate-limit and withdraw statements (`Writer::plans()`).
  None of them does a full scan.
- `engine.rs`: a read that changes only the context or rate limits is no longer treated as "quiet".

### Parity (`tools/ingest-usage-parity.ts`, all real roots, read-only, one run)

Setup: a fresh scratch store; the crate's cold ingest took 14.2 s over 7,905 sources. It compares against the real
TS functions: `parseClaudeSession`, `parseCodexTokenTotals`, the `/api/usage` handler and `lookupSessionContext`.

| check | compared | exact | match |
|---|---|---|---|
| usage per source, claude (4 token totals + first model) | 3,128 | 3,127 | 99.97% |
| usage per source, codex | 2,091 | 2,091 | 100% |
| context per session, claude | 3,128 | 3,128 | 100% |
| context per session, codex | 2,091 | 2,091 | 100% |
| context per session, muse | 198 | 103 | 52% raw / **100% of `session.jsonl` sessions** |

| mismatch category | count | what it is |
|---|---|---|
| `live:changed-during-run` | 1 (usage) | a Claude transcript written between the crate's scan and the TS read |
| `ts:muse-child-session-not-looked-up` | 95 (context) | all 95 are `…/<parent>/approval-review/<id>.jsonl` child sessions. TS `findMuseSessionFile` only checks `<Y/M/D>/<id>/session.jsonl`, so the meter never shows them anything; the crate reads their own `model_completed`. Found by SQL: 198 Muse contexts = 103 `…/<id>/session.jsonl` (all exact) + 95 approval-review. The harness now names this category; it ran before the rename, as `context:crate-only`. |
| usage model | 0 | |
| `crate:undated-turns` | 0 | no Claude/Codex usage record lacked a timestamp |

**`/api/usage?days=30`**, TS handler vs the same numbers from `usage()`, using the route's inclusion rules and
prices:

| | TS | crate |
|---|---|---|
| total cost | $10,233.88 | $8,570.04 |
| input / output tokens | 589.6M / 96.9M | 594.5M / 84.6M |
| sessions | 2,159 | 2,112 |
| time | **38.4 s** (streams ~all transcripts) | **755 ms** |
| Codex rate limits | 0 windows (the newest rollout had none) | present (the latest session that recorded any) |

- Per-source all-time totals match exactly (table above), so the whole difference comes from the **window rule**:
  - TS credits a Claude session's entire history to its file mtime, and a Codex session to its rollout directory
    date (the day it started).
  - The crate counts turns whose own time falls in the window. A month-old Claude session touched yesterday
    contributes only yesterday's turns (lower output and cost); a Codex session started 31 days ago that is active
    now does count (higher input).
- T13b decides whether the UsagePanel keeps turn-time windows. They are the correct reading of "last 30 days", but
  the numbers will change on switch-over.
- Rate limits: TS reads the newest rollout by mtime even when that file has no `rate_limits`. The crate takes the
  most recently active session that recorded any.
- Not covered on real data: OpenCode (its file storage does not exist on this machine) and Muse usage (TS
  `/api/usage` never counted Muse; the crate does not either). OpenCode has fixture coverage only.

## 4. Tags and guards

- Pattern tags:
  - `Pattern: wake-on-write` on `watch.rs` and `filewatch.rs`.
  - `Pattern: one-write-path` on `store.rs` and `Reader::usage`.
  - `docs/patterns.md` "Here:" lines now name the ingest watcher, plus the usage and context read models.
- Every fix carries a reason comment with its measured cost and the guard's name:
  - the `QUIET` constant;
  - `digest_set`;
  - `enter_event_mode`;
  - store `withdraw`.
- Tests: `tests/watch.rs`, `tests/aggregates.rs` (one per format through engine + store), additions to `tail.rs`,
  `engine.rs` and `regressions.rs`, turn equality in the resume == full property, and Node-boundary calls.

## Lines

| | lines |
|---|---|
| Rust `src/` | 5,600 total (+987 / −104 vs 81c21d1); new `filewatch.rs` 202. Store 444 → ~640, model +100, parsers +~230 |
| tests (Rust + Node) | +339 / −17 |
| tools | `ingest-usage-parity.ts` 243, `ingest-measure.ts` +6 |
| TS that T13b can delete | usage-routes.ts parsers (788 lines, most of it) and session-context.ts (421) |

## Notes for T13b

- **Schema 2.** The crate refuses a schema-1 store with a clear error. The store is a cache of the transcripts:
  delete it and restart.
- **History rewrites.** A `Withdraw` renumbers stored seqs, just as `Replace` rewrites them. A client paging with
  `afterSeq` must refetch a session that `onChange` reports; `ChangeEvent` does not yet say "rewritten" versus
  "appended". Add that flag if the server caches message pages.
- **Muse context gap.** Context is stored only for sessions that produce a row: Muse needs at least one message, and
  Codex at least one retained line. The 95 Muse child sessions are now covered, which is a gain over TS.
- **Remaining cost of the switch.** The first event-mode flip of a huge legacy rollout still costs ~0.4 s of SQLite
  row rewrites, once per file.
