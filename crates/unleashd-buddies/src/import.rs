//! One-time import of a v33 `@nbardy/buddies` database into the new schema (01 §7.1).
//!
//! The source is opened read-only (`mode=ro`) and the target must be a NEW file. Every source
//! column without a home in the new schema is kept in the row's `legacy` JSON. Soul files are
//! hashed (baseline for the verifier) and never written. Any source value outside the mapped
//! domains aborts the import with a typed error before anything is written.
//!
//! Messages, channel posts and task comments all become posts in channels (T06b): a message goes
//! to the direct channel of {sender, recipient}, its inline reply becomes its own answer post, and
//! owner-channel-reads.json (read-only, optional) becomes the owner's `post_read` cursors.

use crate::error::{CoreError, Result};
use crate::runs::next_run;
use crate::schema;
use crate::store::{now_iso, sha256_hex};
use rusqlite::functions::FunctionFlags;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

pub const SOURCE_VERSION: i64 = 33;

#[derive(Debug, Serialize)]
pub struct ImportReport {
    pub source: String,
    pub target: String,
    pub imported_at: String,
    /// (mapping, source rows, target rows); the import fails unless every pair is equal.
    pub counts: Vec<(String, i64, i64)>,
    /// Audit rows for pure reads, dropped by design (events are mutations only).
    pub dropped_read_events: i64,
    pub non_home_memberships: Vec<Value>,
    pub divergent_thread_souls: Vec<Value>,
    pub converted_schedules: Vec<Value>,
    /// Dangling references carried over from the source (`PRAGMA foreign_key_check`), reported, not repaired.
    pub foreign_key_violations: Vec<Value>,
    pub soul_files: Vec<SoulFile>,
    /// Messages whose v33 `root_message_id` (the delegation-chain root) is in another direct
    /// channel. It is kept in `legacy.root_message_id`; `root_id` is the thread in the channel.
    pub cross_channel_roots: i64,
    pub owner_reads: OwnerReads,
}

/// owner-channel-reads.json, as `server/src/buddies/owner-channel-reads.ts` writes it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OwnerMark {
    pub post_id: String,
    pub created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerReadFile {
    version: i64,
    baseline_at: String,
    marks: BTreeMap<String, OwnerMark>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum OwnerReads {
    /// No file: the owner has no cursors to import.
    Absent {
        path: String,
    },
    Loaded {
        path: String,
        sha256: String,
        baseline_at: String,
        marks: BTreeMap<String, OwnerMark>,
    },
}

pub fn load_owner_reads(path: &Path) -> Result<OwnerReads> {
    let shown = path.display().to_string();
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(OwnerReads::Absent { path: shown }),
        Err(e) => return Err(e.into()),
    };
    let file: OwnerReadFile = serde_json::from_slice(&bytes)?;
    match file.version {
        1 => Ok(OwnerReads::Loaded { path: shown, sha256: sha256_hex(&bytes), baseline_at: file.baseline_at, marks: file.marks }),
        v => Err(CoreError::WrongDatabase(format!("{shown}: owner read state version {v}, expected 1"))),
    }
}

impl OwnerReads {
    /// The owner's cursors as (channel, post id, instant): each mark, and for every other list the
    /// file's baseline, the floor the TS reader applies to a list the owner never opened. A
    /// baseline cursor has post id '' and means "read through that instant".
    pub fn cursors(&self, lists: &[String]) -> Vec<(String, String, String)> {
        match self {
            OwnerReads::Absent { .. } => vec![],
            OwnerReads::Loaded { baseline_at, marks, .. } => {
                let baseline = lists.iter().filter(|l| !marks.contains_key(*l)).map(|l| (l.clone(), String::new(), baseline_at.clone()));
                marks.iter().map(|(l, m)| (l.clone(), m.post_id.clone(), m.created_at.clone())).chain(baseline).collect()
            }
        }
    }
}

/// A message's direct channel: its {sender, recipient} set spelled as `types::member_key` spells
/// it (byte-sorted, deduplicated, ','-joined; a NULL recipient is the owner).
pub const DM_KEY: &str = "CASE WHEN from_buddy_id = coalesce(to_buddy_id, 'owner') THEN from_buddy_id
    ELSE min(from_buddy_id, coalesce(to_buddy_id, 'owner')) || ',' || max(from_buddy_id, coalesce(to_buddy_id, 'owner')) END";

/// Every direct channel's (member_key, member) rows.
const DM_MEMBERS: &str =
    "SELECT member_key, from_buddy_id AS member FROM msg UNION SELECT member_key, coalesce(to_buddy_id, 'owner') FROM msg";

/// Temp objects the mapping reads. `msg_thread` is each message's thread root inside its channel:
/// a message answering another (`in_reply_to_id`) joins the thread of its chain's top message; a
/// top message is threaded under its v33 root only when that root is in the same channel.
fn setup_sql() -> Vec<String> {
    vec![
        format!("CREATE TEMP VIEW msg AS SELECT *, {DM_KEY} AS member_key FROM old.buddy_messages"),
        "CREATE TEMP TABLE msg_thread AS
         WITH RECURSIVE chain(id, top) AS (
           SELECT id, id FROM old.buddy_messages WHERE in_reply_to_id IS NULL
           UNION ALL SELECT m.id, chain.top FROM old.buddy_messages m JOIN chain ON m.in_reply_to_id = chain.id)
         SELECT chain.id, CASE WHEN chain.id = chain.top THEN top.local ELSE coalesce(top.local, chain.top) END AS root_id
         FROM chain JOIN (SELECT a.id, CASE WHEN r.member_key = a.member_key AND a.root_message_id != a.id THEN a.root_message_id END AS local
                          FROM msg a LEFT JOIN msg r ON r.id = a.root_message_id) top ON top.id = chain.top"
            .into(),
        "CREATE TEMP TABLE owner_read (list_id TEXT NOT NULL, post_id TEXT NOT NULL, created_at TEXT NOT NULL)".into(),
    ]
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SoulFileState {
    NoPath,
    Missing { path: String },
    Present { path: String, sha256: String },
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
pub struct SoulFile {
    pub buddy_id: String,
    pub slug: String,
    #[serde(flatten)]
    pub state: SoulFileState,
}

pub(crate) fn uri(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('%', "%25").replace('?', "%3f").replace('#', "%23");
    format!("file:{raw}?mode=ro")
}

pub fn open_source(path: &Path) -> Result<Connection> {
    let conn = Connection::open_with_flags(uri(path), OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI)?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    match version {
        SOURCE_VERSION => Ok(conn),
        v => Err(CoreError::WrongDatabase(format!("{}: user_version {v}, expected {SOURCE_VERSION}", path.display()))),
    }
}

pub const V33_SOUL_PATHS: &str =
    "SELECT b.id, b.slug, b.soul_path, w.root_path FROM buddies b JOIN projects w ON w.id = b.project_id ORDER BY b.slug";

/// Hashes each buddy's soul file. `soul_path` is absolute or relative to the home workspace root.
/// `sql` yields (buddy id, slug, soul_path, workspace root).
pub fn soul_files(conn: &Connection, sql: &str) -> Result<Vec<SoulFile>> {
    let rows: Vec<(String, String, Option<String>, String)> =
        crate::store::collect(conn.prepare(sql)?.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?)?;
    Ok(rows.into_iter().map(|(buddy_id, slug, soul_path, root)| SoulFile { buddy_id, slug, state: soul_state(soul_path, &root) }).collect())
}

pub fn soul_state(soul_path: Option<String>, root: &str) -> SoulFileState {
    match soul_path {
        None => SoulFileState::NoPath,
        Some(p) => {
            let path = Path::new(root).join(&p).to_string_lossy().into_owned();
            match std::fs::read(&path) {
                Ok(bytes) => SoulFileState::Present { sha256: sha256_hex(&bytes), path },
                Err(_) => SoulFileState::Missing { path },
            }
        }
    }
}

/// Source values the mapping does not cover. Each must match zero rows.
const DOMAIN_CHECKS: &[(&str, &str)] = &[
    ("buddies.status outside active|archived", "SELECT count(*) FROM old.buddies WHERE status NOT IN ('active','archived')"),
    ("buddy_relationships.kind = reports_to", "SELECT count(*) FROM old.buddy_relationships WHERE kind = 'reports_to'"),
    (
        "owned_projects.status unknown",
        "SELECT count(*) FROM old.owned_projects WHERE status NOT IN ('backlog','ready','in_progress','blocked','review','done','cancelled')",
    ),
    (
        "buddy_messages.status unknown",
        "SELECT count(*) FROM old.buddy_messages WHERE status NOT IN ('pending','active','replied','failed','cancelled')",
    ),
    (
        "buddy_runs.status claimed",
        "SELECT count(*) FROM old.buddy_runs WHERE status NOT IN ('queued','running','cancel_requested','complete','failed','cancelled')",
    ),
    (
        "buddy_runs.input_kind unknown",
        "SELECT count(*) FROM old.buddy_runs WHERE input_kind NOT IN ('chat','message_request','message_reply','failure_notice')",
    ),
    (
        "buddy_automation_runs.status claimed",
        "SELECT count(*) FROM old.buddy_automation_runs WHERE status NOT IN ('running','cancel_requested','complete','failed','cancelled')",
    ),
    (
        "buddy_automations.job_kind not prompt",
        "SELECT count(*) FROM old.buddy_automations WHERE job_kind != 'prompt' OR json_extract(job_payload, '$.prompt') IS NULL",
    ),
    (
        "buddy_knowledge.scope_kind unknown",
        "SELECT count(*) FROM old.buddy_knowledge WHERE scope_kind NOT IN ('owner_thread','project','workspace')",
    ),
    ("conversation_links without an unleashd id", "SELECT count(*) FROM old.conversation_links WHERE unleashd_conversation_id IS NULL"),
    (
        "buddy_todos without a task",
        "SELECT count(*) FROM old.buddy_todos WHERE buddy_project_id NOT IN (SELECT id FROM old.owned_projects)",
    ),
    (
        "buddy_task_comments without a task",
        "SELECT count(*) FROM old.buddy_task_comments WHERE project_id NOT IN (SELECT id FROM old.owned_projects)",
    ),
    (
        "buddy_messages reply columns disagree with status",
        "SELECT count(*) FROM old.buddy_messages WHERE (status = 'replied') != (reply_body IS NOT NULL AND replied_at IS NOT NULL)
           OR (status != 'replied' AND reply_evidence != '[]')",
    ),
    (
        "buddy_messages in_reply_to in another channel or delegation root",
        "SELECT count(*) FROM msg a JOIN msg p ON p.id = a.in_reply_to_id WHERE p.member_key != a.member_key OR p.root_message_id != a.root_message_id",
    ),
    (
        "buddy_list_posts outside their list's workspace",
        "SELECT count(*) FROM old.buddy_list_posts p JOIN old.buddy_lists l ON l.id = p.list_id WHERE p.workspace_id != l.workspace_id",
    ),
    (
        "answer ids ('reply_' || message id) already taken",
        "SELECT count(*) FROM old.buddy_messages WHERE 'reply_' || id IN (SELECT id FROM old.buddy_messages
           UNION ALL SELECT id FROM old.buddy_list_posts UNION ALL SELECT id FROM old.buddy_task_comments)",
    ),
];

/// A pure read in the audit log: `<actor>.get_*`, `.list_*`, `.search_*`, `.recall`.
const IS_READ: &str =
    "(substr(operation, instr(operation, '.') + 1) GLOB 'get_*' OR substr(operation, instr(operation, '.') + 1) GLOB 'list_*'
    OR substr(operation, instr(operation, '.') + 1) GLOB 'search_*' OR substr(operation, instr(operation, '.') + 1) = 'recall')";

fn mapping_sql() -> Vec<String> {
    vec![
        "INSERT INTO workspace SELECT id, name, root_path, created_at, json_object('slug', slug, 'updated_at', updated_at) FROM old.projects".into(),
        "INSERT INTO buddy (id, workspace_id, slug, name, role, status, manager_id, provider, model, reasoning_effort, soul_path,
           background_enabled, max_active_runs, created_at, legacy)
         SELECT b.id, b.project_id, b.slug, b.name, b.role, b.status,
           (SELECT r.from_buddy_id FROM old.buddy_relationships r WHERE r.kind = 'manager' AND r.to_buddy_id = b.id),
           b.provider, b.model, b.reasoning_effort, b.soul_path, m.background_enabled, m.max_active_runs, b.created_at,
           json_object('memory_path', b.memory_path, 'hire_quota', b.hire_quota, 'profile_revision', b.profile_revision,
             'employment_mode', b.employment_mode, 'updated_at', b.updated_at,
             'home_membership', json_object('assignment_role', m.assignment_role, 'read_all_work', m.read_all_work, 'dispatch', m.dispatch,
               'max_background_runs_per_hour', m.max_background_runs_per_hour, 'max_sends_per_hour', m.max_sends_per_hour,
               'max_pending_runs', m.max_pending_runs, 'background_paused_reason', m.background_paused_reason, 'created_at', m.created_at),
             'other_memberships', json((SELECT json_group_array(json_object('project_id', o.project_id, 'assignment_role', o.assignment_role,
               'read_all_work', o.read_all_work, 'dispatch', o.dispatch, 'background_enabled', o.background_enabled,
               'max_active_runs', o.max_active_runs, 'max_background_runs_per_hour', o.max_background_runs_per_hour,
               'max_sends_per_hour', o.max_sends_per_hour, 'max_pending_runs', o.max_pending_runs,
               'background_paused_reason', o.background_paused_reason, 'created_at', o.created_at))
               FROM old.buddy_projects o WHERE o.buddy_id = b.id AND o.project_id != b.project_id)),
             'relationships', json((SELECT json_group_array(json_object('id', r.id, 'from', r.from_buddy_id, 'to', r.to_buddy_id,
               'kind', r.kind, 'created_at', r.created_at)) FROM old.buddy_relationships r WHERE r.from_buddy_id = b.id OR r.to_buddy_id = b.id)))
         FROM old.buddies b JOIN old.buddy_projects m ON m.buddy_id = b.id AND m.project_id = b.project_id".into(),
        "INSERT INTO task (id, workspace_id, owner_id, parent_id, title, done_criteria, status, paused, epoch, next_action,
           blocked_reason, evidence, position, revision, created_at, updated_at, legacy)
         SELECT id, workspace_id, buddy_id, parent_project_id, title, definition_of_done,
           CASE status WHEN 'backlog' THEN 'open' WHEN 'ready' THEN 'open' ELSE status END,
           execution_state = 'paused', execution_epoch, next_action, blocked_reason, completion_evidence, 0, revision, created_at, updated_at,
           json_object('source', 'owned_projects', 'status', status, 'objective', objective, 'priority', priority,
             'source_path', source_path, 'external_key', external_key, 'sprint_id', sprint_id, 'completed_at', completed_at,
             'execution_state', execution_state, 'pending_owner_id', pending_owner_id, 'accepted_by', accepted_by, 'accepted_at', accepted_at)
         FROM old.owned_projects".into(),
        "INSERT INTO task (id, workspace_id, owner_id, parent_id, title, done_criteria, status, paused, epoch, next_action,
           blocked_reason, evidence, position, revision, created_at, updated_at, legacy)
         SELECT t.id, p.workspace_id, p.buddy_id, t.buddy_project_id, t.title, coalesce(t.definition_of_done, ''), t.status, 0, 1,
           t.next_action, t.blocked_reason, t.completion_evidence, t.position, 1, t.created_at, t.updated_at,
           json_object('source', 'buddy_todos', 'definition_of_done', t.definition_of_done, 'completed_at', t.completed_at)
         FROM old.buddy_todos t JOIN old.owned_projects p ON p.id = t.buddy_project_id".into(),
        // Channels: lists are public; each {sender, recipient} set of messages is one direct channel
        // (the owner is the member 'owner'); each task with comments gets its task channel.
        "INSERT INTO channel (id, workspace_id, kind, name, purpose, created_by, created_at)
         SELECT id, workspace_id, 'public', name, purpose, created_by_buddy_id, created_at FROM old.buddy_lists".into(),
        "INSERT INTO channel (id, workspace_id, kind, member_key, created_by, created_at)
         SELECT 'dm_' || substr(sha256(member_key), 1, 32), workspace_id, 'direct', member_key, from_buddy_id, created_at
         FROM (SELECT *, row_number() OVER (PARTITION BY member_key ORDER BY created_at, id) AS n FROM msg) WHERE n = 1".into(),
        format!("INSERT INTO channel_member SELECT c.id, m.member FROM ({DM_MEMBERS}) m JOIN channel c ON c.member_key = m.member_key"),
        "INSERT INTO channel (id, workspace_id, kind, task_id, created_by, created_at)
         SELECT 'tc_' || p.id, p.workspace_id, 'task', p.id, nullif(f.author, 'owner'), f.created_at FROM old.owned_projects p
         JOIN (SELECT project_id, author, created_at, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS n
               FROM old.buddy_task_comments) f ON f.project_id = p.id AND f.n = 1".into(),
        // A message is a post in its direct channel. Its v33 root_message_id is the delegation-chain
        // root, often in another channel, so it stays in legacy and `root_id` is the channel thread
        // (msg_thread). An inline reply becomes its own post, answering the request.
        "INSERT INTO post (id, channel_id, author_id, root_id, reply_to_id, task_id, purpose, body, evidence, request, answer_id,
           conversation_id, return_conversation_id, created_at, legacy)
         SELECT m.id, c.id, m.from_buddy_id, t.root_id, m.in_reply_to_id, m.buddy_project_id, m.purpose, m.body, m.evidence,
           CASE WHEN m.status = 'replied' THEN 'answered' WHEN m.expects_reply = 0 THEN NULL
                WHEN m.status IN ('pending','active') THEN 'awaiting' ELSE m.status END,
           CASE WHEN m.status = 'replied' THEN 'reply_' || m.id END,
           m.child_conversation_id, json_extract(m.return_policy, '$.return_conversation_id'), m.created_at,
           json_object('source', 'buddy_messages', 'workspace_id', m.workspace_id, 'root_message_id', m.root_message_id,
             'status', m.status, 'expects_reply', m.expects_reply, 'outcome', m.outcome,
             'replied_by', m.replied_by, 'parent_conversation_id', m.parent_conversation_id, 'wait_until', m.wait_until,
             'wait_status', m.wait_status, 'updated_at', m.updated_at, 'notification_pending', m.notification_pending,
             'source_project_id', m.source_project_id, 'source_workspace_id', m.source_workspace_id, 'caused_by_run_id', m.caused_by_run_id,
             'not_before', m.not_before, 'after_run_id', m.after_run_id, 'continue_from_message_id', m.continue_from_message_id,
             'superseded_by_message_id', m.superseded_by_message_id, 'root_stopped_at', m.root_stopped_at, 'command_key', m.command_key,
             'payload_hash', m.payload_hash, 'return_policy', json(m.return_policy), 'visibility', m.visibility)
         FROM msg m JOIN channel c ON c.member_key = m.member_key JOIN msg_thread t ON t.id = m.id".into(),
        "INSERT INTO post (id, channel_id, author_id, root_id, reply_to_id, task_id, body, evidence, created_at, legacy)
         SELECT 'reply_' || m.id, c.id, m.to_buddy_id, coalesce(t.root_id, m.id), m.id, m.buddy_project_id, m.reply_body,
           m.reply_evidence, m.replied_at, json_object('source', 'buddy_messages.reply')
         FROM msg m JOIN channel c ON c.member_key = m.member_key JOIN msg_thread t ON t.id = m.id WHERE m.status = 'replied'".into(),
        "INSERT INTO post (id, channel_id, author_id, root_id, task_id, purpose, body, evidence, return_conversation_id, created_at, legacy)
         SELECT id, list_id, from_buddy_id, thread_root_id, buddy_project_id, purpose, body, evidence, sender_conversation_id, created_at,
           json_object('source', 'buddy_list_posts', 'sender_conversation_id', sender_conversation_id, 'sender_run_id', sender_run_id)
         FROM old.buddy_list_posts".into(),
        "INSERT INTO post (id, channel_id, author_id, task_id, body, evidence, created_at, legacy)
         SELECT id, 'tc_' || project_id, nullif(author, 'owner'), project_id, body, evidence, created_at,
           json_object('source', 'buddy_task_comments')
         FROM old.buddy_task_comments".into(),
        "INSERT INTO post_read SELECT buddy_id, list_id, last_post_id, last_post_created_at, updated_at,
           json_object('source', 'buddy_list_reads') FROM old.buddy_list_reads".into(),
        "INSERT INTO doc (id, buddy_id, workspace_id, scope_kind, scope_id, kind, name, revision, content, updated_at, legacy)
         SELECT 'mem_' || h.buddy_id || '_' || h.document_kind, h.buddy_id, b.project_id, 'buddy', h.buddy_id, h.document_kind, '',
           r.revision, r.body, h.updated_at,
           json_object('source', 'buddy_memory_heads', 'head_revision_id', h.revision_id, 'generation', h.generation)
         FROM old.buddy_memory_heads h JOIN old.buddies b ON b.id = h.buddy_id JOIN old.buddy_memory_revisions r ON r.id = h.revision_id".into(),
        "INSERT INTO doc_revision SELECT 'mem_' || buddy_id || '_' || document_kind, revision, body, reasoning, author_kind,
           provenance_json, sha256, created_at,
           json_object('id', id, 'base_revision_id', base_revision_id, 'requested_by', requested_by)
         FROM old.buddy_memory_revisions".into(),
        // A thread-scoped soul that differs from the buddy's soul head is kept as its own doc and flagged (DESIGN decision 7).
        "INSERT INTO doc (id, buddy_id, workspace_id, scope_kind, scope_id, kind, name, revision, content, updated_at, legacy)
         SELECT k.id, k.buddy_id, k.workspace_id,
           CASE k.scope_kind WHEN 'owner_thread' THEN 'thread' WHEN 'project' THEN 'task' ELSE k.scope_kind END,
           k.scope_id, k.kind, k.name, k.revision, k.content, k.updated_at,
           json_object('source', 'buddy_knowledge', 'scope_kind', k.scope_kind, 'flag',
             CASE WHEN k.kind = 'soul' AND k.content IS NOT (SELECT r.body FROM old.buddy_memory_heads h
               JOIN old.buddy_memory_revisions r ON r.id = h.revision_id WHERE h.buddy_id = k.buddy_id AND h.document_kind = 'soul')
             THEN 'divergent_thread_soul' END)
         FROM old.buddy_knowledge k".into(),
        "INSERT INTO doc_revision SELECT document_id, revision, content, reason, author, provenance, sha256(content), created_at, NULL
         FROM old.buddy_knowledge_revisions".into(),
        "INSERT INTO run (id, input_key, attempt, input_kind, input_id, buddy_id, workspace_id, conversation_id, task_id, task_epoch,
           after_run_id, retry_of, status, lease_token, lease_expires_at, deadline, snapshot, outcome, error_code, error,
           ready_at, created_at, started_at, ended_at, legacy)
         SELECT id, input_key, attempt,
           CASE input_kind WHEN 'message_request' THEN 'post' WHEN 'message_reply' THEN 'reply' ELSE input_kind END,
           input_id, buddy_id, workspace_id, conversation_id, project_id,
           (SELECT json_extract(e.value, '$.epoch') FROM json_each(project_epochs) e WHERE json_extract(e.value, '$.id') = project_id),
           after_run_id, retry_of_run_id, status, claim_token, claim_expires_at, deadline, execution_snapshot, outcome, error_code, error,
           ready_at, created_at, started_at, ended_at,
           json_object('source', 'buddy_runs', 'input_kind', input_kind, 'policy', json(policy), 'root_message_id', root_message_id,
             'project_epochs', json(project_epochs), 'acknowledged_at', acknowledged_at)
         FROM old.buddy_runs".into(),
        "INSERT INTO run (id, input_key, attempt, input_kind, input_id, buddy_id, workspace_id, conversation_id, task_id, status,
           lease_token, lease_expires_at, outcome, error, ready_at, created_at, started_at, ended_at, legacy)
         SELECT ar.id, ar.idempotency_key, 1, 'schedule', ar.automation_id, a.buddy_id, a.workspace_id, ar.conversation_id,
           a.buddy_project_id, ar.status, ar.claim_token, ar.claim_expires_at, ar.outcome, ar.error, ar.scheduled_for, ar.claimed_at,
           ar.started_at, ar.ended_at,
           json_object('source', 'buddy_automation_runs', 'iteration', ar.iteration, 'policy', json((SELECT json_object(
             'max_runtime_seconds', p.max_runtime_seconds, 'max_iterations', p.max_iterations, 'max_tokens', p.max_tokens,
             'max_cost_usd', p.max_cost_usd, 'allowed_operations', json(p.allowed_operations), 'tokens_used', p.tokens_used,
             'cost_usd', p.cost_usd) FROM old.buddy_automation_run_policies p WHERE p.run_id = ar.id)))
         FROM old.buddy_automation_runs ar JOIN old.buddy_automations a ON a.id = ar.automation_id".into(),
        "INSERT INTO conversation SELECT unleashd_conversation_id, buddy_id, workspace_id, buddy_project_id, started_at,
           json_object('link_id', id, 'provider', provider, 'provider_session_id', provider_session_id, 'status', status,
             'last_active_at', last_active_at, 'ended_at', ended_at, 'work_item_id', work_item_id)
         FROM old.conversation_links".into(),
        // Events: audit mutations, command receipts (key + hash, not the cached result) and builder hires, in time order.
        format!(
            "INSERT INTO event (at, actor, workspace_id, buddy_id, task_id, op, payload, idem_key, payload_hash, result_ref, legacy)
             SELECT * FROM (
               SELECT created_at, CASE WHEN operation GLOB 'owner.*' THEN 'owner' ELSE buddy_id END, workspace_id, buddy_id,
                 buddy_project_id, operation, payload, NULL, NULL, NULL, json_object('source', 'buddy_audit_events', 'id', id)
               FROM old.buddy_audit_events WHERE NOT {IS_READ}
               UNION ALL
               SELECT created_at, actor, workspace_id, NULL, NULL, 'receipt', '{{}}', command_key, payload_hash, NULL,
                 json_object('source', 'buddy_command_receipts', 'result_bytes', length(result))
               FROM old.buddy_command_receipts
               UNION ALL
               SELECT created_at, 'owner', workspace_id, buddy_id, NULL, 'buddy.create',
                 json_object('request_fingerprint', request_fingerprint), 'builder:' || conversation_id || ':' || creation_key, NULL,
                 buddy_id, json_object('source', 'buddy_builder_hires')
               FROM old.buddy_builder_hires)
             ORDER BY 1"
        ),
    ]
}

/// (mapping, source count, target count). Every pair must be equal.
fn count_pairs() -> Vec<(&'static str, String, &'static str)> {
    vec![
        ("workspace", "SELECT count(*) FROM old.projects".into(), "SELECT count(*) FROM workspace"),
        ("buddy", "SELECT count(*) FROM old.buddies".into(), "SELECT count(*) FROM buddy"),
        (
            "task",
            "SELECT (SELECT count(*) FROM old.owned_projects) + (SELECT count(*) FROM old.buddy_todos)".into(),
            "SELECT count(*) FROM task",
        ),
        ("channel:public", "SELECT count(*) FROM old.buddy_lists".into(), "SELECT count(*) FROM channel WHERE kind = 'public'"),
        ("channel:direct", "SELECT count(DISTINCT member_key) FROM msg".into(), "SELECT count(*) FROM channel WHERE kind = 'direct'"),
        (
            "channel:task",
            "SELECT count(DISTINCT project_id) FROM old.buddy_task_comments".into(),
            "SELECT count(*) FROM channel WHERE kind = 'task'",
        ),
        ("channel_member", format!("SELECT count(*) FROM ({DM_MEMBERS})"), "SELECT count(*) FROM channel_member"),
        (
            "post:direct (messages + replies)",
            "SELECT (SELECT count(*) FROM old.buddy_messages) + (SELECT count(*) FROM old.buddy_messages WHERE status = 'replied')".into(),
            "SELECT count(*) FROM post p JOIN channel c ON c.id = p.channel_id WHERE c.kind = 'direct'",
        ),
        (
            "post:answered request",
            "SELECT count(*) FROM old.buddy_messages WHERE status = 'replied'".into(),
            "SELECT count(*) FROM post WHERE request = 'answered'",
        ),
        (
            "post:public",
            "SELECT count(*) FROM old.buddy_list_posts".into(),
            "SELECT count(*) FROM post p JOIN channel c ON c.id = p.channel_id WHERE c.kind = 'public'",
        ),
        (
            "post:task",
            "SELECT count(*) FROM old.buddy_task_comments".into(),
            "SELECT count(*) FROM post p JOIN channel c ON c.id = p.channel_id WHERE c.kind = 'task'",
        ),
        ("post_read:buddy", "SELECT count(*) FROM old.buddy_list_reads".into(), "SELECT count(*) FROM post_read WHERE reader != 'owner'"),
        ("post_read:owner", "SELECT count(*) FROM owner_read".into(), "SELECT count(*) FROM post_read WHERE reader = 'owner'"),
        (
            "doc",
            "SELECT (SELECT count(*) FROM old.buddy_memory_heads) + (SELECT count(*) FROM old.buddy_knowledge)".into(),
            "SELECT count(*) FROM doc",
        ),
        (
            "doc_revision",
            "SELECT (SELECT count(*) FROM old.buddy_memory_revisions) + (SELECT count(*) FROM old.buddy_knowledge_revisions)".into(),
            "SELECT count(*) FROM doc_revision",
        ),
        ("schedule", "SELECT count(*) FROM old.buddy_automations".into(), "SELECT count(*) FROM schedule"),
        (
            "run",
            "SELECT (SELECT count(*) FROM old.buddy_runs) + (SELECT count(*) FROM old.buddy_automation_runs)".into(),
            "SELECT count(*) FROM run",
        ),
        ("conversation", "SELECT count(*) FROM old.conversation_links".into(), "SELECT count(*) FROM conversation"),
        (
            "event",
            format!(
                "SELECT (SELECT count(*) FROM old.buddy_audit_events WHERE NOT {IS_READ}) + (SELECT count(*) FROM old.buddy_command_receipts) + (SELECT count(*) FROM old.buddy_builder_hires)"
            ),
            "SELECT count(*) FROM event",
        ),
    ]
}

/// An automation's cadence as cron. Interval schedules convert only when the interval is a
/// whole number of minutes dividing an hour, or of hours dividing a day; anything else is an error.
fn cadence_cron(kind: &str, expression: &str) -> Result<String> {
    let unconvertible = || CoreError::Invalid(format!("schedule {kind} {expression:?} has no exact cron form"));
    match kind {
        "cron" => Ok(expression.to_string()),
        "interval" => {
            let seconds: i64 = expression.parse().map_err(|_| unconvertible())?;
            match (seconds % 60, seconds / 60) {
                (0, m) if m > 0 && m < 60 && 60 % m == 0 => Ok(format!("*/{m} * * * *")),
                (0, m) if m % 60 == 0 && m / 60 > 0 && 24 % (m / 60) == 0 => Ok(format!("0 */{} * * *", m / 60)),
                _ => Err(unconvertible()),
            }
        }
        other => Err(CoreError::Invalid(format!("schedule kind {other:?}"))),
    }
}

fn import_schedules(conn: &Connection, now: &str) -> Result<Vec<Value>> {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    let user_error = |e: CoreError| rusqlite::Error::UserFunctionError(Box::new(e));
    conn.create_scalar_function("cadence_cron", 2, flags, move |ctx| {
        cadence_cron(&ctx.get::<String>(0)?, &ctx.get::<String>(1)?).map_err(user_error)
    })?;
    conn.create_scalar_function("next_slot", 3, flags, move |ctx| {
        next_run(&ctx.get::<String>(0)?, &ctx.get::<String>(1)?, &ctx.get::<String>(2)?).map_err(user_error)
    })?;
    conn.execute(
        "INSERT INTO schedule (id, buddy_id, workspace_id, task_id, name, cron, timezone, prompt, limits, enabled, next_run_at,
           archived_at, created_at, legacy)
         SELECT a.id, a.buddy_id, a.workspace_id, a.buddy_project_id, a.name, cadence_cron(a.schedule_kind, a.schedule_expression),
           a.timezone, json_extract(a.job_payload, '$.prompt'),
           json_object('max_runtime_seconds', p.max_runtime_seconds, 'max_iterations', p.max_iterations, 'max_tokens', p.max_tokens,
             'max_cost_usd', p.max_cost_usd, 'allowed_operations', json(p.allowed_operations)),
           a.enabled, a.next_run_at, a.archived_at, a.created_at,
           json_object('schedule_kind', a.schedule_kind, 'schedule_expression', a.schedule_expression, 'job_kind', a.job_kind,
             'job_payload', json(a.job_payload), 'last_run_at', a.last_run_at, 'updated_at', a.updated_at,
             'policy_created_at', p.created_at, 'policy_updated_at', p.updated_at)
         FROM old.buddy_automations a JOIN old.buddy_automation_policies p ON p.automation_id = a.id",
        [],
    )?;
    // Every imported cadence must be schedulable in its timezone.
    conn.query_row("SELECT count(next_slot(cron, timezone, ?1)) FROM schedule", [now], |r| r.get::<_, i64>(0))?;
    json_rows(
        conn,
        "SELECT json_object('id', id, 'from', json_array(json_extract(legacy, '$.schedule_kind'), json_extract(legacy, '$.schedule_expression')),
           'cron', cron) FROM schedule WHERE json_extract(legacy, '$.schedule_kind') != 'cron'",
    )
}

fn json_rows(conn: &Connection, sql: &str) -> Result<Vec<Value>> {
    let texts: Vec<String> = crate::store::collect(conn.prepare(sql)?.query_map([], |r| r.get(0))?)?;
    texts.iter().map(|t| serde_json::from_str(t).map_err(Into::into)).collect()
}

pub fn import(source: &Path, target: &Path, owner_reads: &Path) -> Result<ImportReport> {
    if target.exists() {
        return Err(CoreError::Invalid(format!("target {} already exists; the import only writes a new file", target.display())));
    }
    let src = open_source(source)?;
    let soul_baseline = soul_files(&src, V33_SOUL_PATHS)?;
    let lists: Vec<String> = crate::store::collect(src.prepare("SELECT id FROM buddy_lists")?.query_map([], |r| r.get(0))?)?;
    drop(src);
    let owner_reads = load_owner_reads(owner_reads)?;

    let conn = schema::open(&target.to_string_lossy())?;
    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    conn.create_scalar_function("sha256", 1, FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC, |ctx| {
        Ok(sha256_hex(ctx.get::<String>(0)?.as_bytes()))
    })?;
    conn.execute("ATTACH DATABASE ?1 AS old", [uri(source)])?;
    let old_version: i64 = conn.query_row("PRAGMA old.user_version", [], |r| r.get(0))?;
    if old_version != SOURCE_VERSION {
        return Err(CoreError::WrongDatabase(format!("attached source has user_version {old_version}")));
    }
    for sql in setup_sql() {
        conn.execute(&sql, [])?;
    }
    for (list, post, at) in owner_reads.cursors(&lists) {
        conn.execute("INSERT INTO owner_read VALUES (?1, ?2, ?3)", [list, post, at])?;
    }
    let violations: Vec<String> = DOMAIN_CHECKS
        .iter()
        .map(|(label, sql)| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).map(|n| (label, n)))
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .filter(|(_, n)| *n > 0)
        .map(|(label, n)| format!("{label}: {n} rows"))
        .collect();
    if !violations.is_empty() {
        return Err(CoreError::Invalid(format!("source values outside the mapping: {}", violations.join("; "))));
    }

    let now = now_iso();
    conn.execute_batch("BEGIN")?;
    for sql in mapping_sql() {
        conn.execute(&sql, [])?;
    }
    conn.execute(
        "INSERT INTO post_read SELECT 'owner', list_id, post_id, created_at, ?1, json_object('source', 'owner-channel-reads.json')
         FROM owner_read",
        [&now],
    )?;
    let converted_schedules = import_schedules(&conn, &now)?;
    let counts: Vec<(String, i64, i64)> = count_pairs()
        .into_iter()
        .map(|(label, old_sql, new_sql)| -> Result<(String, i64, i64)> {
            Ok((label.to_string(), conn.query_row(&old_sql, [], |r| r.get(0))?, conn.query_row(new_sql, [], |r| r.get(0))?))
        })
        .collect::<Result<_>>()?;
    let mismatched: Vec<String> = counts.iter().filter(|(_, a, b)| a != b).map(|(l, a, b)| format!("{l}: {a} → {b}")).collect();
    if !mismatched.is_empty() {
        conn.execute_batch("ROLLBACK")?;
        return Err(CoreError::Invalid(format!("import count mismatch: {}", mismatched.join("; "))));
    }
    let dropped_read_events: i64 =
        conn.query_row(&format!("SELECT count(*) FROM old.buddy_audit_events WHERE {IS_READ}"), [], |r| r.get(0))?;
    let non_home_memberships = json_rows(
        &conn,
        "SELECT json_object('buddy_id', b.id, 'slug', b.slug, 'home_workspace', b.project_id, 'workspace', m.project_id,
           'background_enabled', m.background_enabled, 'dispatch', m.dispatch)
         FROM old.buddy_projects m JOIN old.buddies b ON b.id = m.buddy_id WHERE m.project_id != b.project_id ORDER BY b.slug, m.project_id",
    )?;
    let divergent_thread_souls = json_rows(
        &conn,
        "SELECT json_object('doc_id', d.id, 'buddy_id', d.buddy_id, 'slug', b.slug, 'thread_id', d.scope_id, 'revision', d.revision)
         FROM doc d JOIN buddy b ON b.id = d.buddy_id WHERE json_extract(d.legacy, '$.flag') = 'divergent_thread_soul' ORDER BY b.slug",
    )?;
    let cross_channel_roots: i64 =
        conn.query_row("SELECT count(*) FROM msg a JOIN msg r ON r.id = a.root_message_id WHERE r.member_key != a.member_key", [], |r| {
            r.get(0)
        })?;
    conn.execute_batch("COMMIT")?;
    conn.execute_batch("DROP VIEW msg; DETACH DATABASE old; PRAGMA foreign_keys = ON")?;
    let foreign_key_violations = crate::store::collect(conn.prepare("PRAGMA foreign_key_check")?.query_map([], |r| {
        Ok(serde_json::json!({"table": r.get::<_, String>(0)?, "rowid": r.get::<_, Option<i64>>(1)?, "parent": r.get::<_, String>(2)?}))
    })?)?;
    Ok(ImportReport {
        source: source.display().to_string(),
        target: target.display().to_string(),
        imported_at: now,
        counts,
        dropped_read_events,
        non_home_memberships,
        divergent_thread_souls,
        converted_schedules,
        foreign_key_violations,
        soul_files: soul_baseline,
        cross_channel_roots,
        owner_reads,
    })
}
