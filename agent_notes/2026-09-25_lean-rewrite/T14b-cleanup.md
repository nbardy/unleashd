# T14b: deferred deletions, crate dev-loop, memory (report)

Branch `chore/cleanup-2` in `.claude/worktrees/lane-cleanup`. Five commits. Not pushed or merged.

| # | Commit | Item | Result |
|---|---|---|---|
| 1 | abfa6a3 | `send_message` | The server handler and schema were already gone (T09). Four `test/ws-*.js` scripts now send `queue_message` with a `commandId`. The `api.test.js` malformed probe now uses `queue_message`. |
| 2 | ce2d4c1 | `legacy-ui-state.ts` | Deleted with its startup call in server.ts and its retirement test. docs/mobile-view-tree.md updated. |
| 2b | — | `legacy-config-migration.ts`, `shared/src/legacy/codex-composite-model.ts` | **Blocked by ownership.** `config-service.ts:24,261` (lane records-switch) imports `migrateLegacyConversationConfig`. `disk-adapter.ts:24,256` (lane ingest-switch) calls `fromCodexModelId`. Once those two call sites go, delete both files, `toCodexModelId`/`fromCodexModelId` in shared/index.ts, `codex-spark-model.test.ts`, and the migration rows in `config-service.test.ts` (about 190 lines). |
| 3 | 63db0f3 | Dead wire types | Deleted 16 unused `*Message` aliases, `parseClientMessage`/`parseServerMessage`, `safeParseServerMessage` (the client uses `classifyServerFrame`), and `isClientMessage`/`isServerMessage`. Wire schemas used only inside the unions are no longer exported. |
| 4 | fcd36b5 | `channel_changed.listId` → `channelId` | Server, schema, client handler, and two docs. There is deliberately no `.default()`: the frame only invalidates a cache. A pre-rename frame from a backend that has not reloaded yet is classified `invalid` and dropped, costing one missed refresh; it is never applied to `channels/undefined`. Guard: `client/test/protocol-skew.test.ts`. |
| 5 | 2b280e6 | Dev watcher builds crates | Saving `crates/<c>/{src/**/*.rs,build.rs,Cargo.toml}` runs `pnpm --dir crates/<c> run build`, one cargo at a time. The rewritten `.node` then reloads the backend through the existing digest path: I verified that Node reports `buddies-core.node` as a loaded file. A failed build keeps the current addon. Three tests are in `tools/watch-server.test.mjs`: rebuild then reload, a failed build keeps the backend, and `target/` outputs never trigger a build. docs/architecture.md updated. |

Checks on the clean committed tree: typecheck 0; test:server 270/270; test:client 137/137; test:tools 3/3; test:dev-supervisor 13/13; invariants 0; vite build 0.

## 6. Memory: 411 → 490 MB is V8 heap left committed after a startup allocation spike, not the addon

Setup: a throwaway server on :7593 built from `server/dist` at HEAD. `HOME` was the scratchpad sandbox copy, and `PATH` held only `node`. The Buddies DB was freshly imported from the sandbox v33 snapshot (`buddies-v3-t14b.sqlite`). A preload probe recorded `memoryUsage`, V8 heap spaces after a forced GC, a sampling heap profile that includes collected objects, and `readFile` counts. `vmmap` and `footprint` were taken at steady state. Scripts are in `scratchpad/t14b/`.
- **Steady state:** RSS about 500 MB and footprint 555 MB, of which **439–450 MB is the V8 heap** (tag 16). All malloc zones together are about 49 MB dirty (22 MB allocated), and that includes the addon's SQLite. **The native addon is not the cause**: with the Buddies DB unavailable, the footprint was the same.
- **Live JS after a full GC:** 133–140 MB, mostly old_space. But `heapTotal` stays at 316–405 MB, and macOS keeps the freed pages dirty, so RSS holds near the peak.
- **The peak:** in the first ~15 s, heapUsed reaches 400–415 MB and heapTotal 519 MB (RSS 639–664 MB). There were 2.5 GB of sampled allocations. By first app frame:
  - `config-store readRecord` 614 MB;
  - `session-history mergeSessionMessages` 318 MB;
  - `session-cache read` 311 MB;
  - observability journal reloads about 60 MB.
- **Root cause (records):** `readFile` counting shows **18,850 reads of 8,019 config records (91 MB of JSON) in the first 7 s**.
  - Every record is read at least twice: the lookup-index scan, then per-conversation `getByConversationId`/hydrate.
  - 822 records are read 3×, 347 are read 6×, and 50 are read 11–36×.
  - Each read is `readFile` + `JSON.parse` + a zod copy.
  - 12.4 of the 20.4 MB per pass is `creation.branch`: 36 records are over 100 KB, the largest 1.2 MB.
- **Not fixed here:** the fix is in `conversations/config-store.ts` and `lifecycle/session-*`, which belong to lane records-switch and lane ingest. Cheap fixes, in order:
  1. Serve per-conversation hydrate from the scope's scan map instead of re-reading from disk.
  2. Move `creation.branch` out of the record, or stop re-parsing it.
  3. Stream and merge session history without whole-array copies.

  The Rust records store (T23) removes item 1 by construction.

## 7. Memory-curation benchmark: not ported; this is what it needs
- `createMemoryReviewer` hard-codes the ladder `MEMORY_REVIEW_MODELS` and `MEMORY_REVIEW_INSTRUCTIONS`. The benchmark needs a one-rung codex ladder (no fallback, so it can assert `fallbackFrom === undefined`) and an instructions override for the baseline variant. That is two options on `createMemoryReviewer`.
- `enqueue` is fire-and-forget. The harness has to await the `memory_review` event row (key `memory-review:<id>`), or `activeCount() === 0`.
- The harness itself, about 250 lines in `server/test/buddy-memory-curation.test.ts`, gated by `UNLEASHD_LIVE_MEMORY_CURATION`:
  - a temp buddies-core DB with each case's working/long_term docs and note seeded;
  - `createGrants`, plus the MCP endpoint on loopback for `spec()`;
  - reading the docs back after the run;
  - logging tool calls via the grant's `observe`;
  - JSON results with hashes, per the README.
- **Owner decision needed:** `baseline-2026-09-13.txt` names the old stdio tool names. Rewriting it to `doc_read`/`doc_write` changes the frozen control.
- A live run is 40 paid model calls.

**Notes.** The disk hit 100% twice (every shell call failed with ENOSPC until other sessions freed space;
`/private/tmp/claude-501` holds 26 GB). Nothing was lost. The dcg guard blocked `rm -rf` of the sandbox copy, so the runs reused `sandbox/home` in place.
