//! Lean Buddies core (DESIGN.md Part B, D1): the SQLite file, the schema, `authorize` and the
//! Buddy functions, plus the one-time v33 importer and its verifier.

pub mod docs;
pub mod error;
pub mod import;
#[cfg(feature = "node")]
pub mod node;
pub mod posts;
pub mod runs;
pub mod schema;
pub mod store;
pub mod tasks;
pub mod types;
pub mod verify;

pub use error::{CoreError, Result};
pub use store::Store;
