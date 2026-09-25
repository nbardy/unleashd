//! Conversation records (T23a): the durable per-conversation config record that config-store.ts
//! kept as one pretty-printed JSON file per conversation plus one per session (16.8k files,
//! 78 MB, all read at startup), as one SQLite table owned by this crate.
//!
//! A sibling of the ingest store, not part of it: same crate (so the process links ONE SQLite
//! library — two in one process is the SIGBUS hazard in store.rs), its own `Connection`, its own
//! tables and schema key. The ingest `Writer` is owned by the watcher thread and holds batch
//! transactions of up to 256 sources; a config CAS must not queue behind a cold scan, and
//! records must be readable before `Ingest.start` resolves (15–40 s on a first run).
//! The file is the caller's choice: the tables coexist with ingest's in one file (tested), but
//! T23b should give them their own file — ingest's rows are a rebuildable cache, these are not,
//! and "delete the cache to rebuild it" must never be able to delete conversation records.

pub mod import;
#[cfg(feature = "node")]
pub mod node;
pub mod store;
pub mod types;
pub mod validate;

pub use store::{Records, RecordsError};
pub use types::*;
