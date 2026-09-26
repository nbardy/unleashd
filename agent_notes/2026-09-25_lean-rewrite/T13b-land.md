# T13b S2 land: feat/ingest-switch -> merge/ingest-switch

SHA: 47468ed (merge of 3c93975 into 79efc37), worktree lane-land-s2. Not pushed; lean/integration untouched.

Conflicts:
- server/test/codex-spark-model.test.ts: deleted; `fromCodexModelId` (+2 comment refs) removed from shared/src/index.ts because nothing else used it.
- client/src/atoms/actions.ts: S2's `rewritten` patch is now in T19's patchEffects. `historyReplaced` drops a loaded transcript to `absent`, and useConversationBodies reloads it for the open view. The WS spine still never fetches. S2's staleTranscriptIds/refreshIfStale/activityMoved are not ported: `activity` stays a no-op, as in integration.
- docs/architecture.md: kept the records-store paragraph, added "transcripts from the Rust ingest, no adapters/session cache/poller/loader", and pointed to the existing addons/bootstrap text. Dropped the adapter/loader/session-cache startup rules; kept the record-scan, lone-transcript and recovery rules.
- AGENTS.md map: `server/src/adapters/*` became `server/src/ingest/*`; "disk adapter if persisted" now reads "a parser in crates/unleashd-ingest".
- `legacy:` hydrate field: session-loader is gone. The remaining callers (server.ts:237, ingest/runtimes.ts:100) typecheck against config-service; nothing dangles. The rename is still pending.

Checks on the committed tree (git status clean):
- pnpm typecheck: pass
- pnpm test:server x2: pass both (183/0)
- pnpm test:client: 152/0 | test:tools: 5/0 | test:cli: 273/0
- check-client-invariants.sh: pass | vite build: pass
- pnpm test:api: 2 passed, 14 failed before the merge (79efc37) and in both runs after it. Unchanged, not fixed (owned elsewhere).

Notes:
- `pnpm addons` rebuilt unleashd-ingest with a cargo cache miss (15s) using the default target dir, not the shared CARGO_TARGET_DIR. I forgot the env on that call.
- Stale text left in architecture.md §2.0/2.1, all from the S2 side: it names the deleted session-loader-hydration.test.ts and disk-adapter.ts, and mentions the cache v5/v6 notes.
