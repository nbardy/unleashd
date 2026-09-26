# T23b — conversation records switched to the Rust store (2026-09-26)

Branch `feat/records-switch`, worktree `~/git/unleashd/.claude/worktrees/lane-records-switch`. Not pushed or merged.

| SHA | What |
|---|---|
| `094e077` | crate: the record stores T09's `kind` (`ConversationKind` JSON column, records schema 2); `creation.buddyContext/purpose/placement` gone; import reads v2 only and STOPS on any v1 file (a v1 reject row would verify ok=true and drop the record); worker ids cross napi as `null` (`use_nullable`) |
| `237084b` | crate fix: concurrent opens of a new records file (WAL switch returns BUSY without the busy handler; check-then-insert schema row) failed 3/30 from Node. Retry + IMMEDIATE schema tx. Guard `two_connections_open_a_new_file_at_once` (fails on the old code). **Also carries the 4 file deletions** (config-store.ts, its test, legacy-ui-state.ts, records-parity.ts), swept in from a staged `git rm`; that commit alone does not build. An amend needed `git checkout HEAD~1 -- …`, which the dcg guard blocked, so I left it and fixed forward. Squash 237084b+c02158c if a buildable-per-commit history matters. |
| `c02158c` | server: `config-records.ts` (`ConversationRecordStore`, `Date.now()`/injected `now`) replaces `ConversationConfigStore`; config-service `update` uses `setConfig` CAS; boot opens `<app data>/conversation-records.sqlite` (own file); record-migration.ts leaves boot and becomes the import's CLI step; `withSessionLookupIndex`, legacy-ui-state (already run live) deleted |

**Import + verify on a fresh copy** (`unleashd-lean-scope/db/records-t23b/`): v1→v2 migration 8,164/8,164 (chat 6,438, buddy 1,175, builder 54, worker 497). Import 8,164/8,164, 1 reject (a stray by-session `.tmp`), 2.6 s. Verify: **ok=true**, 8,164/8,164 hash-equal, rejects 1/1 byte-equal, index 9,104/9,104. 106 shared sessions (as T23a).

**Startup listing** (same copy, addon, load avg ~17): open 1–10 ms; `listSummaries` 8,164 rows 91–393 ms (warm ~100); `listActive` (summaries + 8,154 `get`s, startup recovery) 280–345 ms. Old path: config-store `list()` read+parsed every JSON file, 3–6 s (T23a).

**Fix-guards**: CAS race through `ConversationConfigService.update` on two store connections (one commits, the other gets `revision_conflict … expected 0, actual 1`); unimported-data-dir boot refusal (the file is not created); the Rust open race. Reason comments + `Pattern:` tags at each site.

**Checks on the clean committed tree** (`git status --porcelain` empty at c02158c): typecheck 0; test:server 250/250; test:client 136/136; test:tools pass; invariants 8/8 gates; vite build ok. Crate: `cargo test --test records` 7/7, `node --test test/records.test.mjs test/node.test.mjs` pass, clippy 0, fmt clean.

**Not done / notes**: CLAUDE.md's tree map still says `config-{service,store}.ts` (left alone: an agent message cannot authorize editing CLAUDE.md). `docs/architecture.md` / `pass-through-pattern.md` still mention config-store. `index.d.ts` changed only in records types (ConversationKind, NewRecord.kind, RecordSummary.kind; KindTag/Placement/Purpose removed). After the live swap delete: `records/import.rs`, `bin/records-tool.rs`, `record-migration.ts` (+test), `legacy-config-migration.ts` if hydration no longer needs it, the reject table, `import_defaults`. Disk hit ENOSPC mid-run (129 MB free; 26 GB in /private/tmp/claude-501 from other sessions).

## Owner-gated live migration (backend STOPPED; from the repo root)

```bash
A=~/.agent-viewer; C=$A/records-import
mkdir $C && cp -R $A/conversation-config $C/ && ln -s $A/session-cache-v1 $C/session-cache-v1
pnpm --dir server exec tsx src/conversations/record-migration.ts $C          # exit 0, 0 failures
(cd crates && cargo build --release --no-default-features --features cli --bin records-tool)
crates/target/release/records-tool import $C/conversation-config/v1 $A/conversation-records.sqlite
crates/target/release/records-tool verify $C/conversation-config/v1 $A/conversation-records.sqlite   # require ok=true
pnpm --dir crates/unleashd-ingest run build     # addon with records schema 2, then start the backend
```
Keep `$A/conversation-config` until the owner approves deleting it. If verify is not ok, `rm $A/conversation-records.sqlite*` before retrying (import refuses a non-empty file; boot refuses while conversation-config exists without it).
