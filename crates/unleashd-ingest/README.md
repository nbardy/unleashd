# unleashd-ingest

Transcript ingestion (DESIGN.md Part D2) as an in-process Rust addon built with napi-rs. It
replaces `server/src/adapters` (jsonl.ts, the session cache, the 5 s poller): an FSEvents watcher
over the provider roots, one incremental parser per provider format, and one SQLite store that
only this crate writes.

## Build and test

```bash
cd crates/unleashd-ingest
pnpm run build          # release: ingest.node + index.d.ts (generated from the Rust types)
pnpm test               # cargo tests (--no-default-features), the release build, the Node test
```

`ingest.node` and `crates/target/` are build output. Commit `index.d.ts` when the API changes.

## API

```ts
import { Ingest, defaultRoots } from '@unleashd/ingest';

const ingest = await Ingest.start(defaultRoots(os.homedir()), dbPath, (event) => {
  // { t: 'changes', rev, sessionIds, removed } | { t: 'failed', message }
});
ingest.initialScan;                                  // counts, timing, full-read reasons
const page = await ingest.listSessions({ since: 0 }); // { rev, rows, removed }; pass rev next time
const row = await ingest.session(sessionId);          // SessionRow | null
const msgs = await ingest.messages(sessionId, { afterSeq: -1, limit: 200 });
const report = await ingest.usage({ since, until, groupBy: 'session' }); // | 'day' | 'model'
// { groups: [{ key, turns, sessions, input, output, cacheRead, cacheWrite, reportedCostUsd, firstAt, lastAt }],
//   codexRateLimits }  — replaces /api/usage's transcript parsers (usage-routes.ts)
const context = await ingest.latestContext(sessionId); // { contextTokens, contextWindow?, compaction? } | null
                                                       // — replaces session-context.ts
await ingest.stop();                                  // releases onChange so Node can exit
```

`start` resolves after the initial scan is committed. Changes arrive through FSEvents (recursive, finds new
files) and, for a file once written, through a direct kqueue watch (at most 64 files, 5 min idle); a batch
closes 2 ms after its last event. Append → `onChange`: 4–6 ms for a watched file, ~10–20 ms for the first
write to a file (FSEvents).

Usage turns are one row per provider-counted request (Claude message id, growth of the Codex cumulative total,
OpenCode assistant message), keyed by their transcript time; `usage()` sums the turns in `[since, until)`.
`/api/usage` dated a whole session by its file mtime (Claude) or rollout directory (Codex) instead. Every call runs on tokio's blocking pool;
the watcher runs on its own thread and reaches JS through a threadsafe function.

## How a source is read

A JSONL format's parser is a serializable fold. Each source row stores the byte offset read to,
the 64 bytes before it, and the fold. On a change:

| Situation | Read |
|---|---|
| stamp (dev, inode, size, mtime) unchanged | nothing |
| same inode, grew, fingerprint matches | resume at the offset |
| new inode / shrank / fingerprint differs | from byte 0 (`replaced` / `shrank` / `rewritten`) |
| a new line proves earlier output wrong | from byte 0 (`rebuild:Reordered`, `rebuild:OwnedLater`) |
| Codex: the first event message after shown response-item messages | resume; those messages are withdrawn (`Apply::Withdraw`) |
| unterminated last line that does not parse | left for the next read |

Every resume produces exactly what a full read of the same bytes produces (`tests/formats.rs`
checks it at every line boundary). Gemini (one JSON document) and OpenCode (a directory tree) are
re-read whole when their stamp moves.

## Hazards

- **Never open the store with a second SQLite library in the same process** (e.g. `node:sqlite`).
  POSIX locks are per process: closing that copy's descriptor drops the crate's locks, and it
  may truncate the WAL index the crate has mapped. The parity harness did this and died with
  SIGBUS. Use the crate's API, or the `sqlite3` CLI (another process).
- Node cannot unload an addon: a Rust change means rebuild, then restart the backend.

## Where it differs from the TS parsers (on purpose)

| TS behaviour | Crate |
|---|---|
| readline also ends lines at U+2028/U+2029, dropping records that contain one | splits on `\n` only |
| no cwd recorded → `process.cwd()` | `cwd: { t: 'unknown' }` |
| no time recorded → `new Date()` (differs on every parse) | `null`, or file mtime with `timeFrom: 'fileMtime'` |
| Cursor messages stamped with the file's current mtime | `at: null` |
| merge-review envelope no longer stripped (8c9fcfa) | stripped |
| Builder receipts embed the Zod-normalized event | embed the recorded event (the client parses both to the same value) |

`tools/ingest-parity.ts` compares both over the real local roots; see T12-ingest-crate.md.

## Conversation records (T23a)

`ConversationRecords` is the durable per-conversation config record (what
`server/src/conversations/config-store.ts` kept as 16.8k JSON files). It lives in
`src/records/`: same crate as ingest (one SQLite library per process), its own
connection, tables and schema key (`meta.records_schema`). Give it its own file:
ingest rows are a rebuildable cache, records are not.

```ts
import { ConversationRecords } from '@unleashd/ingest';
const records = await ConversationRecords.open(dbPath);
await records.get(id);                                 // ConversationRecord | null
await records.findBySession('codex', sessionId);        // most recently updated claimant
await records.listSummaries();                          // RecordSummary[] (startup join)
await records.create(input, Date.now());                // {t:'created'} | {t:'exists', current}
await records.setConfig({ conversationId, expectedConfigRevision, config, lastResolvedConfig }, Date.now());
// {t:'committed'} | {t:'revision_conflict', current} | {t:'tombstoned', current} | {t:'missing'}
```

`ConversationRecord` has the `PersistedConversationConfigRecord` shape minus `version`
(always 2: T09's stored `kind`). The server (`server/src/conversations/config-records.ts`)
opens its own file, `<app data>/conversation-records.sqlite`, never the ingest cache file:
records are authoritative, and deleting the cache must never delete them. Every mutation is read-modify-write in one `BEGIN IMMEDIATE` transaction and
goes through `store::put`, which validates the Zod refinements and rebuilds the
`conversation_session` index rows. Errors reject as `[sqlite|corrupt|invalid|schema] …`;
conflicts are return values.

One-time import from a COPY of the data dir. The server refuses to boot, printing this
sequence, while `conversation-config/` exists without the records file. The importer reads
record v2 only and stops on a v1 file, so T09's v1 → v2 rewrite runs on the copy first:

```bash
mkdir <copy> && cp -R ~/.agent-viewer/conversation-config <copy>/ \
  && ln -s ~/.agent-viewer/session-cache-v1 <copy>/session-cache-v1   # read only
pnpm --dir server exec tsx src/conversations/record-migration.ts <copy>
cargo build --release --manifest-path crates/Cargo.toml -p unleashd-records-tool   # its own crate (S12)
records-tool import <copy>/conversation-config/v1 new.sqlite   # → new.sqlite.import.json
records-tool verify <copy>/conversation-config/v1 new.sqlite   # sha256 per record; must print ok=true
records-tool bench new.sqlite 500          # list + CAS latency on a scratch copy
```

Nothing is dropped: unparseable, future-version, schema-invalid, duplicate, stray and
quarantined files, and by-session entries the records do not reproduce, are stored with
their bytes in `conversation_record_reject`.
