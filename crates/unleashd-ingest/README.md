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
await ingest.stop();                                  // releases onChange so Node can exit
```

`start` resolves after the initial scan is committed. Every call runs on tokio's blocking pool;
the watcher runs on its own thread and reaches JS through a threadsafe function.

## How a source is read

A JSONL format's parser is a serializable fold. Each source row stores the byte offset read to,
the 64 bytes before it, and the fold. On a change:

| Situation | Read |
|---|---|
| stamp (dev, inode, size, mtime) unchanged | nothing |
| same inode, grew, fingerprint matches | resume at the offset |
| new inode / shrank / fingerprint differs | from byte 0 (`replaced` / `shrank` / `rewritten`) |
| a new line proves earlier output wrong | from byte 0 (`rebuild:Reordered`, `rebuild:EventMode`, `rebuild:OwnedLater`) |
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
