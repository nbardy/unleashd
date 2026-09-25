# T12 — `crates/unleashd-ingest` (2026-09-25)

Branch `feat/ingest-crate` (from `lean/integration`), worktree
`~/git/unleashd/.claude/worktrees/agent-ae758b2549f51a806`. Not pushed, not merged into lean/integration.
The server still uses the TS loader (the switch is T13).

| SHA | What |
|---|---|
| `c49ffa8` | the crate: watcher, six parsers, tail reads, store, napi API, tests |
| `cb0b6ce` | loud full re-reads in the log, the one-SQLite-per-process hazard, README, clippy/fmt |
| `570a112` | `tools/ingest-parity.ts`, `tools/ingest-parity-one.ts`, `tools/ingest-measure.ts`; `usage-routes.ts` exports its Codex/OpenCode usage parsers |
| `166972c` | merge of lean/integration `5b0dffb` (patterns doc), as the coordinator asked |
| `08baecd` | merge of lean/integration `d7613fd` (T08 runtime split): clean, no conflicts; adapters/ and usage-routes.ts untouched by T08 |

Verified on the commit: `git status` clean at `08baecd` (branch head); `cargo test --no-default-features` (37 tests),
`pnpm test` in the crate (cargo + release build + Node test), `pnpm typecheck`, the two usage server tests.

## API (generated `crates/unleashd-ingest/index.d.ts`)

```ts
class Ingest {
  static start(roots: Root[], dbPath: string, onChange: (e: ChangeEvent) => void): Promise<Ingest>
  get initialScan(): ScanReport          // counts, ms, fullReasons, missingRoots, rev
  listSessions({ since }): Promise<{ rev, rows: SessionRow[], removed: RemovedSession[] }>
  session(sessionId): Promise<SessionRow | null>
  messages(sessionId, { afterSeq, limit }): Promise<Message[]>
  stop(): Promise<void>                  // idempotent; releases onChange so Node can exit
}
defaultRoots(home): Root[]               // Root = { format: Format, path }
ChangeEvent = { t:'changes', rev, sessionIds, removed } | { t:'failed', message }
SessionRow  = { sessionId, provider, format, sourcePath, cwd: Cwd, observedModel?, title?, label,
                createdAt, activityAt, timeFrom:'transcript'|'fileMtime', messageCount, parentSessionId?,
                identity: Identity, swarmDebugPrefix?, resumedFromConversationId?, usage?: Usage,
                subAgents, rev }
Cwd         = {t:'transcript',path} | {t:'projectDir',path} | {t:'decoded',path} | {t:'unknown'}
Identity    = {t:'general'} | {t:'buddy',buddyId,context} | {t:'builder'} | {t:'worker',swarmId?,workerId?,role}
Message     = { seq, role:'user'|'assistant'|'system', at?, completedAt?, content, toolCall?: {name, input?} }
```

`SessionRow` replaces `ParsedSession` plus the summary row: the `'unknown'` model sentinel is `observedModel`
absent, `process.cwd()` is `{t:'unknown'}`, `new Date()` is a `null` time or `timeFrom:'fileMtime'`, and the
kind/Buddy/worker/hidden fields are one `Identity` (hidden sessions are never listed). `start` resolves after the
initial scan is committed.

## Lines

| | lines |
|---|---|
| Rust `src/` | 4,690 total = 3,836 code, 345 comment, 215 in-file unit tests (05 budgeted ~3.3k) |
| Rust `tests/` + Node test | 564 + 89 |
| Harness + tools (TS) | 500 parity + 54 one-source + 189 measure |
| TS it replaces (T13) | `server/src/adapters` 4,671 + file-poller 137 + the usage/context re-parsers (usage-routes 788, session-context 421, in part) |

Largest files: text.rs 549 (tool-line formatter + Buddy receipts, ports of tool-format.ts and buddy.ts),
codex.rs 488, store.rs 443, markers.rs 397, read.rs 392.

## Design, briefly

- **Watcher** (`watch.rs`, Pattern: wake-on-write): notify/FSEvents on every existing root, started before the
  initial scan; events settle for 50 ms and are applied as one batch = one revision. `need_rescan`/errors and
  a single 10-minute backstop tick run a full stat scan. FSEvents reports `/private/var/…` for `/var/…` roots,
  so event paths are mapped back through each root's canonical path (the Node test caught this).
- **Parsers** (`parsers/`, Pattern: table-driven / sum-types): a JSONL format is a serializable fold; one
  generic driver (`read.rs`). Each source row stores offset + the 64 bytes before it + the fold, so appends and
  restarts read only new bytes. Truncation (`shrank`), a new inode (`replaced`), changed bytes before the offset
  (`rewritten`) re-read from 0. A line that proves earlier output wrong re-reads from 0 with a hint:
  out-of-order time (Muse/Codex sort), Codex event messages after response-item messages were shown
  (`EventMode`), a Buddy identity after the first prompt's worker tag was removed (`OwnedLater`). A resume
  equals a full read at every line boundary (property test over every fixture). Unterminated fragments that do
  not parse are left for the next read.
- **Store** (`store.rs`, Pattern: one-write-path): `source`, `session`, `message(source_id, seq)` WITHOUT ROWID,
  `removed` tombstones, `meta.rev`. One writer connection on the ingest thread; one reader connection (WAL) for
  the API. Query-plan guard: no read does a full table scan.
- **Markers** (`markers.rs`): Buddy v1/v2 (UTF-16 length prefix), Builder v1, swarm prefix, merge-review prefix
  (TS dropped it in 8c9fcfa; old transcripts still carry it), `[oompa…]`, `[_HIDE_TEST_]`, `[ai-writing-tool]`,
  Codex AGENTS.md/environment/plugins bundles (by provenance tag), Muse durable `record.creation`.

## Parity (tools/ingest-parity.ts, all real roots, 2026-09-25)

The harness streams: one source at a time (TS parse → crate row/messages → compare → drop), keeping only
mismatch records. Re-run after the d7613fd merge on Muse: 1,840 sources, 0 unexplained.

Opencode's file storage does not exist on this machine (OpenCode now keeps `opencode.db`, which the TS
parser never read either), and `~/.gemini/tmp` is empty: those two parsers are covered by fixture tests only.

| format | sources | listed (TS) | listed (crate) | exact | explained only | unexplained | match |
|---|---|---|---|---|---|---|---|
| claude | 3,123 | 3,082 | 3,082 | 3,122 | 1 | 0 | 100% |
| codex | 2,487 | 2,175 | 2,175 | 2,479 | 8 | 0 | 100% |
| cursor | 441 | 438 | 438 | 3 | 438 | 0 | 100% |
| muse | 1,833 | 208 | 208 | 1,736 | 97 | 0 | 100% |

Compared per session: presence, sessionId, provider, cwd, title, identity (incl. buddyId / swarm / worker role),
swarm prefix, parent session, model, message count, and per message role, text, tool call name+input, start and
completion time; plus session created/activity times and usage totals (vs usage-routes.ts's own parsers).

| category | sessions | what it is |
|---|---|---|
| `time:cursor-mtime` | 438 | TS stamps every Cursor message with the file's CURRENT mtime (re-dated on each append); the crate has `at: null` |
| `cwd:ts-process-cwd` | 95 | no cwd recorded; TS substitutes the server's `process.cwd()`; crate `{t:'unknown'}` |
| `receipt:zod-normalized` | 8 | Builder receipt: TS embeds the Zod output (defaults filled, unknown keys like `soul_path` stripped), crate the recorded JSON; equal after `BuddyBuilderEventSchema.parse`, which the client does anyway |
| `live:changed-during-run` | 2 | transcripts written between the two reads (this session, a live Muse file) |
| `ts:readline-splits-u2028` | 1 | **TS bug:** Node readline also ends lines at U+2028/U+2029, so the Codex/Cursor/Muse TS parsers cut a record holding a raw one in two and drop it ("Skipped 1 malformed line"); the crate keeps the message |

Crate-side bugs the harness found and that are fixed (with regression tests):
- Muse `recorded_at` is microseconds; JS `Date` truncates the fraction. Keeping it made 208 Muse sessions' times
  differ by <1 ms and reordered same-millisecond records (roles misaligned in `approval-review` sessions).
- Codex turn-abort `completed_at` epochs: same truncation.
- Event paths under a symlinked root were ignored (FSEvents canonical paths).

TS behaviour not copied (listed in the harness as explained): the U+2028 split, `process.cwd()` and `new Date()`
fallbacks, Cursor mtime stamping, and the merge-prefix regression (no real transcript hit it in this run).

## Measurements (real data; machine load average 130–210 on 10 cores during the runs, from other sessions)

| | crate | current TS |
|---|---|---|
| Cold full ingest, all 7.9k sources, 9.49 GB | **15.5 s** (quieter run) – 27 s – 39 s (load 200); peak RSS **357–366 MB**; 290k messages | full parse, no cache (`loadAllConversations`): **248 s**, peak RSS **1,611 MB**, 1.0 GB heap |
| Store / cache on disk | DB **556 MB** after checkpoint (message text 259 MB + tool inputs 126 MB; checkpoints 7 MB) | session cache **491 MB** in 7,612 files |
| Restart | warm start (stat every source, no parse): **0.46–1.26 s**, peak RSS 136 MB, all 5.9k rows available | startup with a copy of the real cache, limit 500, concurrency 16: **7.2 s**, 287 MB, only 314 conversations hydrated |
| Append to the 934 MB Codex rollout | append → `onChange`: p50 **74 ms**, max 115 ms (15 appends; incl. FSEvents + 50 ms settle) | full re-parse on every change: **11.8 s** |
| Append to a 121 MB Claude transcript | p50 **71 ms**, max 247 ms | tail resume exists in TS; full parse 1.05 s |
| One full read of the 934 MB rollout | 2.4–4.2 s | 11.8 s |

Checkpoint diet: first build stored the previous message and every Codex call id verbatim; the largest
checkpoints were 0.5–1.1 MB (rewritten on every append), 110 MB total. They now hold 64-bit digests and a
2 KB label prefix (guard: `checkpoints_stay_small_for_huge_prompts_and_replies`); the DB went 640 → 556 MB.

## Findings for T13

1. **Never open the ingest DB with `node:sqlite` in the server process.** Two SQLite libraries in one process
   break POSIX locking; closing node's handle dropped the crate's locks and truncated the mapped WAL index, and
   the first parity run died with SIGBUS. Read only through the crate API (or the `sqlite3` CLI, another
   process). Documented in store.rs and the README.
2. `start` resolves after the initial scan: ~0.5–1.3 s warm, but 15–40 s on a first run with an empty store.
   T13 should either accept a one-time slow first start or subscribe to `onChange` progress batches (they fire
   during the scan) before `start` resolves.
3. `messages(sessionId)` serves the most recently active copy when two files share an id (6 Cursor transcripts
   exist in both `empty-window` and a project directory). Rows carry `sourcePath` if T13 needs the other copy.
4. The watcher does not watch roots that are missing at start (reported in `initialScan.missingRoots`); a
   provider installed later is picked up on restart.
5. Codex files switching to event mode, or a turn abort that sorts before earlier messages, force a full
   re-read of that file (logged when >16 MB, counted in `fullReasons`). Correct per TS semantics; measured cost
   2.4–4.2 s for the 934 MB file, once.

## Unresolved

- Line budget: 3.8k code lines vs the 05 estimate of ~3.3k. text.rs (tool-line formatter + receipts) and
  codex.rs (two message modes, lifecycle notices, setup-bundle filter) are the bulk.
- OpenCode's current storage is `~/.local/share/opencode/opencode.db` (259 MB); neither TS nor the crate reads
  it, so OpenCode sessions are invisible either way. Gemini/OpenCode parsers are tested on fixtures only.
- Known narrow divergences, none hit on real data: two Codex turn-abort notices with the same millisecond keep
  abort-row order (TS: turn order); a Claude sub-agent's provider is fixed when its tool use is read; the
  OpenCode metadata file is looked up by directory name, not by the `sessionID` field.
- `search`/`usage` aggregate APIs from 05 (`/api/search`, `/api/usage`) are not built; the store has per-session
  usage totals, and FTS5 is a T13 decision.
