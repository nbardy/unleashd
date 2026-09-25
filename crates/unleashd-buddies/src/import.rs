//! One-time import of a v33 `@nbardy/buddies` database into the new schema (01 §7.1).
//!
//! The source is opened read-only (`mode=ro`) and the target must be a NEW file. Every source
//! column without a home in the new schema is kept in the row's `legacy` JSON. Soul files are
//! hashed (baseline for the verifier) and never written. Any source value outside the mapped
//! domains aborts the import with a typed error before anything is written.

use crate::error::{CoreError, Result};
use crate::runs::next_run;
use crate::schema;
use crate::store::{now_iso, sha256_hex};
use rusqlite::functions::FunctionFlags;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
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
        "INSERT INTO channel SELECT id, workspace_id, name, purpose, created_by_buddy_id, created_at FROM old.buddy_lists".into(),
        "INSERT INTO post (id, workspace_id, author_id, target_kind, target_id, root_id, reply_to_id, task_id, purpose, body, evidence,
           reply_state, reply_body, reply_evidence, replied_at, conversation_id, return_conversation_id, created_at, legacy)
         SELECT id, workspace_id, from_buddy_id, CASE WHEN to_buddy_id IS NULL THEN 'owner' ELSE 'buddy' END, to_buddy_id,
           root_message_id, in_reply_to_id, buddy_project_id, purpose, body, evidence,
           CASE WHEN status = 'replied' THEN 'replied' WHEN expects_reply = 0 THEN NULL
                WHEN status IN ('pending','active') THEN 'awaiting' ELSE status END,
           reply_body, reply_evidence, replied_at, child_conversation_id, json_extract(return_policy, '$.return_conversation_id'), created_at,
           json_object('source', 'buddy_messages', 'status', status, 'expects_reply', expects_reply, 'outcome', outcome,
             'replied_by', replied_by, 'parent_conversation_id', parent_conversation_id, 'wait_until', wait_until,
             'wait_status', wait_status, 'updated_at', updated_at, 'notification_pending', notification_pending,
             'source_project_id', source_project_id, 'source_workspace_id', source_workspace_id, 'caused_by_run_id', caused_by_run_id,
             'not_before', not_before, 'after_run_id', after_run_id, 'continue_from_message_id', continue_from_message_id,
             'superseded_by_message_id', superseded_by_message_id, 'root_stopped_at', root_stopped_at, 'command_key', command_key,
             'payload_hash', payload_hash, 'return_policy', json(return_policy), 'visibility', visibility)
         FROM old.buddy_messages".into(),
        "INSERT INTO post (id, workspace_id, author_id, target_kind, target_id, root_id, task_id, purpose, body, evidence,
           return_conversation_id, created_at, legacy)
         SELECT id, workspace_id, from_buddy_id, 'channel', list_id, thread_root_id, buddy_project_id, purpose, body, evidence,
           sender_conversation_id, created_at,
           json_object('source', 'buddy_list_posts', 'sender_conversation_id', sender_conversation_id, 'sender_run_id', sender_run_id)
         FROM old.buddy_list_posts".into(),
        "INSERT INTO post (id, workspace_id, author_id, target_kind, target_id, task_id, body, evidence, created_at, legacy)
         SELECT c.id, p.workspace_id, CASE WHEN c.author = 'owner' THEN NULL ELSE c.author END, 'task', c.project_id, c.project_id,
           c.body, c.evidence, c.created_at, json_object('source', 'buddy_task_comments')
         FROM old.buddy_task_comments c JOIN old.owned_projects p ON p.id = c.project_id".into(),
        "INSERT INTO post_read SELECT buddy_id, list_id, last_post_id, last_post_created_at, updated_at FROM old.buddy_list_reads".into(),
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
        ("channel", "SELECT count(*) FROM old.buddy_lists".into(), "SELECT count(*) FROM channel"),
        (
            "post:message",
            "SELECT count(*) FROM old.buddy_messages".into(),
            "SELECT count(*) FROM post WHERE target_kind IN ('buddy','owner')",
        ),
        ("post:channel", "SELECT count(*) FROM old.buddy_list_posts".into(), "SELECT count(*) FROM post WHERE target_kind = 'channel'"),
        (
            "post:task_comment",
            "SELECT count(*) FROM old.buddy_task_comments".into(),
            "SELECT count(*) FROM post WHERE target_kind = 'task'",
        ),
        ("post_read", "SELECT count(*) FROM old.buddy_list_reads".into(), "SELECT count(*) FROM post_read"),
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

pub fn import(source: &Path, target: &Path) -> Result<ImportReport> {
    if target.exists() {
        return Err(CoreError::Invalid(format!("target {} already exists; the import only writes a new file", target.display())));
    }
    let src = open_source(source)?;
    let soul_baseline = soul_files(&src, V33_SOUL_PATHS)?;
    drop(src);

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
    conn.execute_batch("COMMIT")?;
    conn.execute_batch("DETACH DATABASE old; PRAGMA foreign_keys = ON")?;
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
    })
}
