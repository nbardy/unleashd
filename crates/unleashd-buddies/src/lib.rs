//! Lean Buddies core (DESIGN.md Part B, D1): the SQLite file, the schema, `authorize` and the
//! Buddy functions. The one-time v33 importer and its verifier are crates/unleashd-buddies-import.

pub mod docs;
pub mod error;
pub mod ids;
#[cfg(feature = "node")]
pub mod node;
pub mod posts;
pub mod runs;
pub mod schema;
pub mod store;
pub mod tasks;
pub mod team;
pub mod types;

pub use error::{CoreError, Result};
pub use store::Store;
