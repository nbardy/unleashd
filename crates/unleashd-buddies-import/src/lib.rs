//! The one-time v33 importer and its verifier (DESIGN.md Part B, D1). A separate crate from the
//! addon so editing it never rebuilds `@unleashd/buddies-core` (S12). Delete after the live swap.

pub mod import;
pub mod notes;
pub mod verify;
