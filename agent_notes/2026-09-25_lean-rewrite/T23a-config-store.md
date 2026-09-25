# T23a — conversation config records → Rust SQLite (2026-09-25)

Branch `feat/config-store-rust` (from `lean/integration` @ 81c21d1), worktree
`~/git/unleashd/.claude/worktrees/agent-aa2cf68a9303b2d96`. Not pushed (the orchestrator's backup of the
checkpoint is `origin/wip/config-store-rust`), not merged. Crate side only; the server still uses config-store.ts.

| SHA | What |
|---|---|
| `686656c` | WIP checkpoint (saved by the orchestrator at the session-limit stop): records module, importer/verifier, records-tool, napi, tests |
| `7db5bd6` | tests green (Rust + Node boundary test), regenerated `index.d.ts`, clippy clean |
| `615b11e` | `tools/records-parity.ts`, README section, patterns.md entries |

Verified on the commit: `git status --porcelain` empty at `615b11e`. `cargo test --no-default-features -p unleashd-ingest`
passes: all suites, 6 of the tests in `tests/records.rs`. `node --test test/records.test.mjs` passes against the release
addon. `cargo clippy --all-targets` reports 0 warnings, and `cargo fmt --check` and biome pass.

## Decision: (b) a sibling module in the ingest crate. It has its own connection, not a shared one

`crates/unleashd-ingest/src/records/` holds `types`, `validate`, `store`, `import` and `node`.

- **Same crate.** The server process then links one SQLite library and loads one addon. Two SQLite libraries in one
  process is the SIGBUS hazard from T12. node:sqlite is never involved.
- **Not the ingest `Writer`'s connection.** The watcher thread owns that connection, and it holds batch
  transactions of up to 256 sources. If records shared it:
  - a `set_config` CAS would queue behind a cold-scan batch;
  - records could not be read before `Ingest.start` resolves, which takes 15–40 s on a first run.
- **Own tables and schema key.** The tables are `conversation_record`, `conversation_session` and
  `conversation_record_reject`, under `meta.records_schema`.
  - They can share a file with ingest. The test `records_and_the_ingest_store_share_one_file_without_interfering` covers this.
- **Recommendation for T23b: give records their own file.** Ingest rows are a rebuildable cache, but records are
  authoritative. "Delete the cache to rebuild it" must never delete conversation records. A separate file also means
  zero write-lock contention with ingest. The records connection uses `synchronous=FULL`; ingest uses NORMAL.

## Schema

```sql
conversation_record (                          -- WITHOUT ROWID, PK conversation_id
  conversation_id, status CHECK IN ('active','deleted'), deleted_at, done CHECK IN (0,1),
  kind CHECK IN ('general','buddy','buddy_builder'), buddy_id CHECK ((kind='buddy') = (buddy_id IS NOT NULL)),
  provenance CHECK IN ('user','legacy_inferred','external_discovered'), working_directory,
  config JSON, config_revision ≥0, record_revision ≥0, last_resolved JSON, current_session JSON,
  session_bindings JSON (order kept), creation JSON, created_at, updated_at,
  import_defaults)                             -- keys a legacy file lacked ('done','status','recordRevision'); cleared by the first write
conversation_session (provider, session_id, conversation_id)  -- PK all three; FK ON DELETE/UPDATE CASCADE; index by conversation
conversation_record_reject (source_path PK, reason, detail, content BLOB)   -- import only
```

Rust sum types (`records/types.rs`) cover every Zod union:

- `RecordStatus`
- `Provenance`
- `ModelSelection {mode}`
- `ReasoningSelection {mode}`
- `KnowledgeScope {kind}`
- `Placement`
- `Purpose`
- `KindTag {t: general | buddy{buddyId} | buddy_builder}`, derived at the write path by the
  `conversationKindFromLegacy` rule

`Provider` is reused from `model.rs`. Nullish Buddy-context fields are `Option<Option<T>>`, so null and absent stay
distinct: 999 real contexts write `null` and 2 omit the key.

JSON columns are always decoded into these types. A value outside its domain is a typed `Corrupt` error, never a default.

## API (generated `crates/unleashd-ingest/index.d.ts`)

```ts
class ConversationRecords {
  static open(dbPath): Promise<ConversationRecords>
  get(id): Promise<ConversationRecord | null>
  findBySession(provider, sessionId): Promise<ConversationRecord | null>   // most recently updated claimant, then smaller id
  listSummaries(): Promise<RecordSummary[]>   // {conversationId,status,done,kind,provenance,workingDirectory?,provider,
                                              //  currentSession?,sessions[],configRevision,createdAt,updatedAt}
  create(NewRecord, at): Promise<{t:'created',record} | {t:'exists',current}>
  setConfig({conversationId, expectedConfigRevision, config, lastResolvedConfig}, at):
    Promise<{t:'committed',record} | {t:'revision_conflict',current} | {t:'tombstoned',current} | {t:'missing'}>
  setDone(id, done, at) / markDeleted(id, at): boolean / purge(id): boolean
  rekey(from, to): {t:'rekeyed'|'missing'|'exists'}
  setCurrentSession / addSessionBinding / setCurrentSessionUsage(id, …, at): ConversationRecord | null
  appendBranchLaunch(id, digest, handoff): {t:'recorded'|'missing'|'unavailable'|'full'}
  claimInitialMessageDispatch(id, token, at) / completeInitialMessageDispatch(id, token, at): ConversationRecord | null
}
```

- **Record shape.** `ConversationRecord` equals `PersistedConversationConfigRecord` without `version` (always 1).
- **Times.** `at` is `Date.now()`. Rust formats it exactly as `toISOString`.
- **Errors.** Real failures reject with a `[sqlite|corrupt|invalid|schema]` prefix. Conflicts are return values, not
  exceptions.
- **One write path.** Every mutation is one `BEGIN IMMEDIATE` read-modify-write through `store::put`. `put` validates
  the Zod refinements (`min(1)`, `.datetime()`, non-negative, `max(64000)` in UTF-16 units, non-empty ops). It also
  rebuilds the session index rows in the same transaction.
- **What goes away.**
  - config-store.ts's per-process promise locks: SQLite's write lock covers other processes too.
  - The `unindexed/building/indexed` identity-index states.
  - Lazy by-session repair.

## Import and verify: real run on a copy

- **Source:** `db/config-copy/v1`, copied `cp -Rp` from `~/.agent-viewer/conversation-config/v1` (read only).
  - 8,018 by-conversation files and 8,857 by-session files, 78 MB.
  - No quarantine directory.
- **Output:** `db/conversation-records.sqlite`, 20.5 MB, with `.import.json`, `.verify.json`, `.bench.json` and
  `.parity.json` beside it.

| | result |
|---|---|
| record files imported | **8,018 / 8,018** (active 8,008, deleted 10; external_discovered 6,918, user 1,100; general 6,963, buddy 1,001, buddy_builder 54) |
| schema-defaulted keys recorded as data | done 7,142, status 21, recordRevision 21 |
| rejected (stored with bytes) | **1**: `by-session/claude/.NzM1….json.80547.<uuid>.tmp`, a crashed atomic-write temp file (`corrupt_session_index`) |
| by-session entries | 8,856 consistent (derived), 0 orphan, 0 stale, 1 corrupt (above), 0 record bindings without an index file |
| sessions claimed by >1 record | 106 (codex re-bindings). The by-session file names one record for 104 of them; `findBySession` gives the same answer for all 104. 2 have no file. |
| **verify** | `ok=true`: **8,018/8,018 records sha256-equal** (canonical JSON of source file vs record rebuilt from the row), rejects 1/1 byte-equal, index 8,962/8,962 rows = the source files' bindings, 0 unaccounted, 0 extra |
| **TS cross-check** (`tools/records-parity.ts`) | every record config-store.ts serves (Zod-parsed) equals the addon's `get()`: **8,018/8,018**; `findBySession` for all 14,629 bindings: **0 differ** |

Import took 2.7 s and verify 1.9 s.

## Measurements (same copy, machine load average 17–54)

| | today (TS) | records |
|---|---|---|
| startup "list all records" | config-store.ts `list()`: **1,971 ms** median (1,624–2,327, 5 fresh instances) | Rust `list_summaries`: **17 ms** median. Through the addon, including `open`: 125 ms median (72–231); the napi conversion of 8k objects is most of it. Rust `get` of every record: 74 ms |
| one CAS update | (file write, no fsync) | Rust `set_config`, synchronous=FULL: **p50 0.13 ms**, p99 0.44, max 1.9 (500 runs). Through the addon: p50 0.55 ms, p90 2.3 |

## Tests

Rust tests are in `tests/records.rs`; the Node test is `test/records.test.mjs`.

- **Two-writer CAS race.** Two connections are released by a barrier on the same revision, for 40 rounds. Exactly one
  commits, and the loser is handed the winner's record. Stale, tombstoned and missing are typed outcomes.
- **Importer fixture.**
  - It contains one of each bad file: a torn JSON file, an unknown key, an empty `sessionId`, a future version, a
    duplicate id, a stray `.tmp`, a quarantined file, and orphan, stale and corrupt by-session entries.
  - A full Buddy record: nullish null and absent, a branch with launches, usage.
  - A legacy file with defaulted keys.
  - Verify passes. After one stored field is changed, verify fails on exactly that record, so it is not vacuous.
  - A re-import into the same DB is refused.
- **Query-plan guard.** No read or write plan has a `SCAN` step. The only exemption is `list_summaries`, the
  deliberate startup scan.
- **Regression tests** from config-store.ts's incident comments:
  - re-binding the same session keeps its usage;
  - late usage for a session that has moved on is dropped;
  - the 15 s first-message lease: exclusive, expires, delivered once.
- **Same-file coexistence** with the ingest `Writer`/`Reader`.
- **Node test.** The exact record shape round-trips through the addon, null vs absent included. Five concurrent
  `setConfig` calls from JS give one commit and four conflicts. A Zod-invalid record rejects with `[invalid]` and is
  not stored.

## Lines

| Part | Lines |
|---|---|
| `src/records/` | 2,000: store 665, import 552, types 423, validate 178, node 156, mod 26 |
| `records-tool` | 127 |
| Tests | 324 Rust + 115 Node |
| `tools/records-parity.ts` | 157 |

The TS it replaces in T23b:

- config-store.ts: 991
- the by-session directory logic
- `legacy-config-migration.ts` / `legacy-ui-state.ts` (per 05), where T23b decides

`import.rs` (552), `records-tool` and `records-parity.ts` are one-time code: delete them after the swap. What stays
is about 1,450 lines of Rust.

## Exact steps for T23b (after T09)

1. **Build the addon.** Run `cd crates/unleashd-ingest && pnpm run build`. Load it in the server via the same
   `createRequire('…/crates/unleashd-ingest/index.js')` that T13 uses for `Ingest`. Never open the file with node:sqlite.
2. **Import.** With the backend stopped, copy `~/.agent-viewer/conversation-config/v1` aside, then run:
   - `records-tool import <copy>/v1 ~/.agent-viewer/conversation-records.sqlite`
   - `records-tool verify <copy>/v1 ~/.agent-viewer/conversation-records.sqlite`
   - Require `ok=true`.
   - Keep the JSON directory until the owner approves deleting it.
   - This is a live-data swap, so it needs the owner's approval, as with T15.
3. **Replace the store.** Replace `ConversationConfigStore` with a thin `config/records.ts` (about 80 lines) over
   `ConversationRecords`, mapping one to one:

   | config-store.ts | ConversationRecords |
   |---|---|
   | `getByConversationId` | `get` |
   | `findBySession` | `findBySession` |
   | `create(…, 'missing')` | `create`. `exists` is the old `ConfigRevisionConflictError(-1)`; config-service's replay check stays. |
   | `save` in config-service `update` | `setConfig` (`revision_conflict`/`tombstoned`/`missing` → the `revision_conflict` ConfigError) |
   | `setDone` / `delete` / `purge` / `rekeyConversation` | `setDone` / `markDeleted` / `purge` / `rekey` |
   | `setCurrentSession` / `addSessionBinding` / `setCurrentSessionUsage` | same names |
   | `appendBranchLaunch` | same name: `unavailable`/`full` → the two errors it threw |
   | `claimInitialMessageDispatch` | same name, with the token (`randomUUID()`) passed in |
   | `listActive` | `listSummaries().filter(s => s.status === 'active')`, then `get` where a full record is needed |

   Pass `Date.now()` (or the injected `now().getTime()`) as `at`. Records returned lack `version`. Add `version: 1`
   only if something still reads it; better, drop it from the shared schema.
4. **Delete the old path.** Delete `withSessionLookupIndex` (server.ts:799, legacy-ui-state.ts). No lookup scope
   exists any more.
5. **Delete the old files:**
   - `config-store.ts`
   - its tests that mirror file mechanics
   - the `by-session` code
6. **Record in 05.** `conversation-records.sqlite` becomes the authority, and `version` goes away.
7. **After the swap, delete the one-time code:**
   - `src/records/import.rs`
   - `src/bin/records-tool.rs`
   - `tools/records-parity.ts`
   - the `conversation_record_reject` table (or keep its rows as the audit trail)
   - the `import_defaults` column

## Notes

- The 106 shared sessions are real data: codex conversations whose `currentSession` points at a sibling conversation's
  first session. TS and Rust answer identically for every one today. The tie-break is "most recently updated", which
  is deterministic where the TS scan order was not.
- The WIP checkpoint `686656c` is a real commit on the branch. If a squash is preferred, the orchestrator can squash
  `686656c..615b11e` when merging.
