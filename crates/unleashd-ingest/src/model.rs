//! Pattern: one-type-source (docs/patterns.md#one-type-source)
//!
//! The rows the crate hands to TS. Every type here is also the generated `index.d.ts` type
//! (napi-rs derives it from these definitions), so this file is the one source of the contract.
//!
//! Times are epoch milliseconds (`f64`, what JS `Date.getTime()` returns). A time is `null`
//! only where the transcript does not record one (Cursor lines carry no timestamps); it is never
//! invented. The TS parsers used `new Date()` in those places, which made every re-parse
//! produce a different history.

use serde::{Deserialize, Serialize};

macro_rules! str_enum {
    ($name:ident { $($variant:ident = $s:literal),+ $(,)? }) => {
        // The napi case rule and the literals must agree; the node test reads them back.
        #[cfg_attr(feature = "node", napi_derive::napi(string_enum = "camelCase"))]
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        pub enum $name { $(#[serde(rename = $s)] $variant),+ }

        impl $name {
            pub fn as_str(&self) -> &'static str {
                match self { $($name::$variant => $s),+ }
            }
            pub fn parse(s: &str) -> Option<Self> {
                match s { $($s => Some($name::$variant),)+ _ => None }
            }
        }
    };
}

// The on-disk layout a source is read with. One parser per format.
str_enum!(Format { Claude = "claude", Codex = "codex", Cursor = "cursor", Gemini = "gemini", Opencode = "opencode", Muse = "muse" });

// The provider a session belongs to. Equal to its format except for Claude-layout files, whose
// provider is inferred from the model (a Claude Code transcript of a GPT model is codex).
str_enum!(Provider { Claude = "claude", Codex = "codex", Cursor = "cursor", Gemini = "gemini", Opencode = "opencode", Muse = "muse" });

str_enum!(Role { User = "user", Assistant = "assistant", System = "system" });

// The oompa swarm role, read from the first prompt after its `[oompa…]` tag.
str_enum!(WorkerRole { Work = "work", Review = "review", Fix = "fix" });

// Where `createdAt`/`activityAt` came from.
str_enum!(TimeFrom { Transcript = "transcript", FileMtime = "fileMtime" });

/// One provider root to ingest. Absent roots are reported by `start`, not guessed.
#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Root {
    pub format: Format,
    pub path: String,
}

/// The working directory of a session and how it was learned.
#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "t", discriminant_case = "camelCase"))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum Cwd {
    /// The transcript names it (Claude/Codex `cwd`, Muse route facts, Gemini `.project_root`).
    Transcript { path: String },
    /// Recovered from a lossy `~/.claude/projects` / `~/.cursor/projects` directory name and
    /// verified to exist on this machine (`resolveEncodedProjectDirectory`).
    ProjectDir { path: String },
    /// The naive `-` → `/` reading of that name; nothing on disk matched it.
    Decoded { path: String },
    /// Nothing recorded. The TS parsers substituted `process.cwd()` here.
    Unknown,
}

impl Cwd {
    pub fn path(&self) -> Option<&str> {
        match self {
            Cwd::Transcript { path } | Cwd::ProjectDir { path } | Cwd::Decoded { path } => Some(path),
            Cwd::Unknown => None,
        }
    }
}

/// Who a session belongs to, recovered from in-band markers (and Muse's durable creation record).
#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "t", discriminant_case = "camelCase"))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum Identity {
    General,
    /// `context` is the Buddy context JSON exactly as recorded. The server validates it with the
    /// shared Zod schema; the crate only checks the two ids it cannot live without.
    Buddy {
        buddy_id: String,
        context: String,
    },
    Builder,
    Worker {
        swarm_id: Option<String>,
        worker_id: Option<String>,
        role: WorkerRole,
    },
}

/// Provider-reported token totals. Claude: summed per request id; Codex: the last cumulative
/// `token_count`; OpenCode: summed per assistant message. Other providers record none.
#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Usage {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubAgent {
    pub id: String,
    pub description: String,
    pub tool_uses: u32,
    pub current_action: Option<String>,
    pub started_at: Option<f64>,
    pub completed_at: Option<f64>,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    /// Raw input as text (pretty JSON when the arguments were JSON). Absent when none was sent.
    pub input: Option<String>,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    /// 0-based position in the session's visible history. Stable while the file only grows.
    pub seq: u32,
    pub role: Role,
    /// When the message started (an assistant reply starts when the message before it did).
    pub at: Option<f64>,
    /// Set on assistant replies whose completion the transcript records.
    pub completed_at: Option<f64>,
    pub content: String,
    pub tool_call: Option<ToolCall>,
}

/// The list row for one session: everything the sidebar needs, nothing per message.
#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone, PartialEq)]
pub struct SessionRow {
    pub session_id: String,
    pub provider: Provider,
    pub format: Format,
    /// The file (a directory for OpenCode) this row was read from.
    pub source_path: String,
    pub cwd: Cwd,
    /// The model the transcript names. `null` = none recorded (the TS `'unknown'` sentinel).
    pub observed_model: Option<String>,
    /// Provider-generated title (Claude ai-title / custom-title).
    pub title: Option<String>,
    /// `title`, else the first visible user text, on one line, at most 60 characters.
    pub label: String,
    pub created_at: f64,
    pub activity_at: f64,
    pub time_from: TimeFrom,
    pub message_count: u32,
    /// Codex sub-agent threads name the thread that spawned them.
    pub parent_session_id: Option<String>,
    pub identity: Identity,
    /// The hidden swarm debug prefix removed from the first prompt, when there was one.
    pub swarm_debug_prefix: Option<String>,
    /// Muse durable lineage for a forked chat.
    pub resumed_from_conversation_id: Option<String>,
    pub usage: Option<Usage>,
    pub sub_agents: Vec<SubAgent>,
    /// Store revision that last changed this row; `listSessions({ since })` pages on it.
    pub rev: i64,
}
