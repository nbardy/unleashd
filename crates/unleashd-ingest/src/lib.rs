//! Transcript ingestion (DESIGN.md Part D2): an FSEvents watcher over the provider roots, one
//! incremental parser per provider format, and one SQLite store written only by this crate.
//! Replaces server/src/adapters (jsonl.ts, the session cache, the 5 s poller).

pub mod discover;
pub mod engine;
pub mod lines;
pub mod markers;
pub mod model;
#[cfg(feature = "node")]
pub mod node;
pub mod parsers;
pub mod paths;
pub mod read;
pub mod records;
pub mod store;
pub mod subagents;
pub mod text;
pub mod watch;
