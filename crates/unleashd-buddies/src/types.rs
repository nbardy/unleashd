//! Canonical domain types. Kinds are sum types; the napi attributes make the same types the
//! TypeScript contract (`index.d.ts` is generated from them). Rows are decoded once, here, and
//! a stored value outside its domain is a typed `Corrupt` error, never a default.

use crate::error::{CoreError, Result};
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};

macro_rules! str_enum {
    ($name:ident { $($v:ident = $s:literal),+ $(,)? }) => {
        #[cfg_attr(feature = "node", napi_derive::napi(string_enum = "snake_case"))]
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum $name { $($v),+ }
        impl $name {
            pub fn as_str(self) -> &'static str { match self { $(Self::$v => $s),+ } }
            pub fn parse(s: &str) -> Result<Self> {
                match s { $($s => Ok(Self::$v),)+ other => Err(CoreError::Corrupt(format!("{}: {other:?}", stringify!($name)))) }
            }
        }
        impl ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> { Ok(ToSqlOutput::from(self.as_str())) }
        }
        impl FromSql for $name {
            fn column_result(v: ValueRef<'_>) -> FromSqlResult<Self> {
                Self::parse(v.as_str()?).map_err(|e| FromSqlError::Other(Box::new(e)))
            }
        }
    };
}

str_enum!(BuddyStatus { Active = "active", Archived = "archived" });
str_enum!(TaskStatus { Open = "open", InProgress = "in_progress", Blocked = "blocked", Review = "review", Done = "done", Cancelled = "cancelled" });
str_enum!(RunStatus { Queued = "queued", Running = "running", CancelRequested = "cancel_requested", Complete = "complete", Failed = "failed", Cancelled = "cancelled" });
str_enum!(DocKind { Soul = "soul", Working = "working", LongTerm = "long_term", Note = "note", Shared = "shared" });
str_enum!(PostKind { Inform = "inform", Request = "request" });
str_enum!(Op { ReadDoc = "read_doc", WriteDoc = "write_doc", Post = "post", Reply = "reply", WriteTask = "write_task", EnqueueRun = "enqueue_run", CancelRun = "cancel_run", WriteSchedule = "write_schedule", Admin = "admin" });

/// Who acts. Stored as NULL (post author / channel creator) or the key `'owner'` (events, read cursors).
#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "kind", discriminant_case = "lowercase"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Actor {
    Owner,
    Buddy { id: String },
}

pub const OWNER_KEY: &str = "owner";

impl Actor {
    pub fn key(&self) -> &str {
        match self {
            Actor::Owner => OWNER_KEY,
            Actor::Buddy { id } => id,
        }
    }
    pub fn buddy_id(&self) -> Option<&str> {
        match self {
            Actor::Owner => None,
            Actor::Buddy { id } => Some(id),
        }
    }
    pub fn from_nullable(id: Option<String>) -> Actor {
        id.map_or(Actor::Owner, |id| Actor::Buddy { id })
    }
}

/// Whose resource an operation touches (the `target` of `authorize`).
#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "kind", discriminant_case = "lowercase"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Subject {
    Owner,
    Buddy { id: String },
}

#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "kind", discriminant_case = "lowercase"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allowed,
    Denied { reason: String },
}

/// Where a post is addressed. Columns: (target_kind, target_id), target_id NULL for the owner.
#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "kind", discriminant_case = "lowercase"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    Buddy { id: String },
    Owner,
    Channel { id: String },
    Task { id: String },
}

impl Target {
    pub fn columns(&self) -> (&'static str, Option<&str>) {
        match self {
            Target::Buddy { id } => ("buddy", Some(id)),
            Target::Owner => ("owner", None),
            Target::Channel { id } => ("channel", Some(id)),
            Target::Task { id } => ("task", Some(id)),
        }
    }
    pub fn from_columns(kind: &str, id: Option<String>) -> Result<Target> {
        match (kind, id) {
            ("buddy", Some(id)) => Ok(Target::Buddy { id }),
            ("owner", None) => Ok(Target::Owner),
            ("channel", Some(id)) => Ok(Target::Channel { id }),
            ("task", Some(id)) => Ok(Target::Task { id }),
            (kind, id) => Err(CoreError::Corrupt(format!("post target {kind}/{id:?}"))),
        }
    }
}

/// A post's reply lifecycle. `reply_state` NULL is `NotOwed`.
#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "state", discriminant_case = "snake_case"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reply {
    NotOwed,
    Awaiting,
    Replied { body: String, evidence: Vec<String>, replied_at: String },
    Cancelled,
    Failed,
}

/// Why a run exists. Columns: (input_kind, input_id); the input_key is derived from it.
#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "kind", discriminant_case = "snake_case"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunInput {
    Chat { turn_id: String },
    Post { post_id: String },
    Reply { post_id: String },
    Schedule { schedule_id: String, slot: String },
    FailureNotice { run_id: String },
}

impl RunInput {
    pub fn columns(&self) -> (&'static str, &str, String) {
        match self {
            RunInput::Chat { turn_id } => ("chat", turn_id, format!("chat:{turn_id}")),
            RunInput::Post { post_id } => ("post", post_id, format!("post:{post_id}")),
            RunInput::Reply { post_id } => ("reply", post_id, format!("reply:{post_id}")),
            RunInput::Schedule { schedule_id, slot } => ("schedule", schedule_id, format!("schedule:{schedule_id}:{slot}")),
            RunInput::FailureNotice { run_id } => ("failure_notice", run_id, format!("failure:{run_id}")),
        }
    }
    /// A schedule run's slot is its `ready_at`.
    pub fn from_columns(kind: &str, id: String, ready_at: &str) -> Result<RunInput> {
        match kind {
            "chat" => Ok(RunInput::Chat { turn_id: id }),
            "post" => Ok(RunInput::Post { post_id: id }),
            "reply" => Ok(RunInput::Reply { post_id: id }),
            "schedule" => Ok(RunInput::Schedule { schedule_id: id, slot: ready_at.to_string() }),
            "failure_notice" => Ok(RunInput::FailureNotice { run_id: id }),
            other => Err(CoreError::Corrupt(format!("run input_kind {other:?}"))),
        }
    }
}

/// How a run ended, reported by the runner.
#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "kind", discriminant_case = "lowercase"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Complete { text: String },
    Failed { code: String, error: String },
    Cancelled { reason: String },
}

/// Doc audience. Columns (scope_kind, scope_id); Buddy scope's id is the buddy, Workspace's the workspace.
#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "kind", discriminant_case = "lowercase"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocScope {
    Buddy,
    Workspace { workspace_id: String },
    Task { task_id: String },
    Thread { thread_id: String },
}

impl DocScope {
    pub fn columns<'a>(&'a self, buddy_id: &'a str) -> (&'static str, &'a str) {
        match self {
            DocScope::Buddy => ("buddy", buddy_id),
            DocScope::Workspace { workspace_id } => ("workspace", workspace_id),
            DocScope::Task { task_id } => ("task", task_id),
            DocScope::Thread { thread_id } => ("thread", thread_id),
        }
    }
    pub fn from_columns(kind: &str, id: String) -> Result<DocScope> {
        match kind {
            "buddy" => Ok(DocScope::Buddy),
            "workspace" => Ok(DocScope::Workspace { workspace_id: id }),
            "task" => Ok(DocScope::Task { task_id: id }),
            "thread" => Ok(DocScope::Thread { thread_id: id }),
            other => Err(CoreError::Corrupt(format!("doc scope_kind {other:?}"))),
        }
    }
}

// ---- rows -------------------------------------------------------------------------------------

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Buddy {
    pub id: String,
    pub workspace_id: String,
    pub slug: String,
    pub name: String,
    pub role: String,
    pub status: BuddyStatus,
    pub manager_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub soul_path: Option<String>,
    pub background_enabled: bool,
    pub max_active_runs: i64,
    pub created_at: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Task {
    pub id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub done_criteria: String,
    pub status: TaskStatus,
    pub paused: bool,
    pub epoch: i64,
    pub next_action: Option<String>,
    pub blocked_reason: Option<String>,
    pub evidence: Vec<String>,
    pub position: i64,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Channel {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub purpose: String,
    pub created_by: Actor,
    pub created_at: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Post {
    pub id: String,
    pub workspace_id: String,
    pub author: Actor,
    pub target: Target,
    pub root_id: Option<String>,
    pub reply_to_id: Option<String>,
    pub task_id: Option<String>,
    pub purpose: Option<String>,
    pub body: String,
    pub evidence: Vec<String>,
    pub reply: Reply,
    pub conversation_id: Option<String>,
    pub return_conversation_id: Option<String>,
    pub created_at: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Doc {
    pub id: String,
    pub buddy_id: String,
    pub workspace_id: String,
    pub scope: DocScope,
    pub kind: DocKind,
    pub name: String,
    pub revision: i64,
    pub content: String,
    pub updated_at: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct DocRevision {
    pub doc_id: String,
    pub revision: i64,
    pub content: String,
    pub reason: String,
    pub author: String,
    pub provenance: String,
    pub sha256: String,
    pub created_at: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Schedule {
    pub id: String,
    pub buddy_id: String,
    pub workspace_id: String,
    pub task_id: Option<String>,
    pub name: String,
    pub cron: String,
    pub timezone: String,
    pub prompt: String,
    pub limits: String,
    pub enabled: bool,
    pub next_run_at: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Run {
    pub id: String,
    pub input_key: String,
    pub attempt: i64,
    pub input: RunInput,
    pub buddy_id: String,
    pub workspace_id: String,
    pub conversation_id: Option<String>,
    pub task_id: Option<String>,
    pub task_epoch: Option<i64>,
    pub after_run_id: Option<String>,
    pub retry_of: Option<String>,
    pub status: RunStatus,
    pub deadline: Option<String>,
    pub lease_expires_at: Option<String>,
    pub snapshot: Option<String>,
    pub outcome: Option<String>,
    pub error_code: Option<String>,
    pub error: Option<String>,
    pub ready_at: String,
    pub created_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Claim {
    pub run: Run,
    pub lease_token: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Event {
    pub seq: i64,
    pub at: String,
    pub actor: String,
    pub workspace_id: String,
    pub buddy_id: Option<String>,
    pub task_id: Option<String>,
    pub op: String,
    pub payload: String,
    pub idem_key: Option<String>,
    pub result_ref: Option<String>,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Conversation {
    pub id: String,
    pub buddy_id: String,
    pub workspace_id: String,
    pub task_id: Option<String>,
    pub created_at: String,
}

// ---- inputs and query shapes ----------------------------------------------------------------

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct PostInput {
    pub target: Target,
    pub kind: PostKind,
    pub body: String,
    pub purpose: Option<String>,
    pub evidence: Vec<String>,
    /// Reply inside a thread: the post being answered. Absent = a new top-level post.
    pub reply_to_id: Option<String>,
    pub task_id: Option<String>,
    /// The sender's conversation; a `Request`'s reply returns there.
    pub from_conversation_id: Option<String>,
    pub key: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct ReplyInput {
    pub post_id: String,
    pub body: String,
    pub evidence: Vec<String>,
    pub key: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct DocRef {
    pub buddy_id: String,
    pub scope: DocScope,
    pub kind: DocKind,
    pub name: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct DocWrite {
    pub doc: DocRef,
    pub content: String,
    /// The revision the writer read; 0 when the doc does not exist yet.
    pub base_revision: i64,
    pub reason: String,
    pub key: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone, Default)]
pub struct TaskChanges {
    pub title: Option<String>,
    pub done_criteria: Option<String>,
    pub status: Option<TaskStatus>,
    pub next_action: Option<String>,
    pub blocked_reason: Option<String>,
    pub evidence: Option<Vec<String>>,
    pub paused: Option<bool>,
    pub position: Option<i64>,
    pub owner_id: Option<String>,
}

/// A task write. Every field of `TaskChanges` is a patch: absent = unchanged.
#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "kind", discriminant_case = "lowercase"))]
#[derive(Debug, Clone)]
pub enum TaskWrite {
    Create { owner_id: String, parent_id: Option<String>, title: String, done_criteria: String, key: String },
    Update { task_id: String, base_revision: i64, changes: TaskChanges, key: String },
}

#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "kind", discriminant_case = "lowercase"))]
#[derive(Debug, Clone)]
pub enum TaskQuery {
    Owner { buddy_id: String },
    Workspace { workspace_id: String },
    Children { parent_id: String },
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct EnqueueInput {
    pub buddy_id: String,
    pub input: RunInput,
    pub conversation_id: Option<String>,
    pub task_id: Option<String>,
    pub after_run_id: Option<String>,
    pub deadline: Option<String>,
}

#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "kind", discriminant_case = "lowercase"))]
#[derive(Debug, Clone)]
pub enum RunQuery {
    Buddy { buddy_id: String },
    Conversation { conversation_id: String },
    Task { task_id: String },
    Queued,
}

/// Keyset position: posts strictly older than (created_at, id).
#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Cursor {
    pub created_at: String,
    pub id: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(discriminant = "kind", discriminant_case = "snake_case"))]
#[derive(Debug, Clone)]
pub enum PostQuery {
    /// Top-level posts of a channel.
    Channel { channel_id: String },
    /// Replies under a thread root.
    Thread { root_id: String },
    /// Comments on a task.
    Task { task_id: String },
    /// Posts addressed to a buddy, or to the owner.
    To { target: Target },
    /// Posts written by an actor.
    From { author: Actor },
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct PostPage {
    pub posts: Vec<Post>,
    pub next: Option<Cursor>,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct ChannelUnread {
    pub channel_id: String,
    pub name: String,
    pub unread: i64,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct Inbox {
    /// Requests addressed to the actor that still await its reply.
    pub requests: Vec<Post>,
    /// The actor's own requests still awaiting someone else's reply.
    pub waiting_on: Vec<Post>,
    pub unread: Vec<ChannelUnread>,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct ChannelInput {
    pub workspace_id: String,
    pub name: String,
    pub purpose: String,
    pub key: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct ScheduleInput {
    /// Absent = create.
    pub id: Option<String>,
    pub buddy_id: String,
    pub task_id: Option<String>,
    pub name: String,
    pub cron: String,
    pub timezone: String,
    pub prompt: String,
    pub limits: String,
    pub enabled: bool,
    pub key: String,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct EventInput {
    pub workspace_id: String,
    pub op: String,
    pub payload: String,
    pub key: Option<String>,
    pub buddy_id: Option<String>,
    pub task_id: Option<String>,
}

#[cfg_attr(feature = "node", napi_derive::napi(object))]
#[derive(Debug, Clone)]
pub struct ConversationInput {
    pub id: String,
    pub buddy_id: String,
    pub task_id: Option<String>,
}

pub fn evidence_json(v: &[String]) -> String {
    serde_json::to_string(v).expect("string list serializes")
}

pub fn parse_evidence(s: &str) -> Result<Vec<String>> {
    serde_json::from_str(s).map_err(|e| CoreError::Corrupt(format!("evidence {s:?}: {e}")))
}
