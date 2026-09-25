//! The one schema (01-buddies-package.md §6). There are no versions and no migration chain: a
//! database is either empty (and gets this schema) or already carries `APPLICATION_ID`.
//!
//! Deviations from §6, each for a named reason:
//! - every imported table has `legacy TEXT` (JSON of the source columns with no new home; §7.1);
//! - `run.lease_expires_at` (claims need an expiry), no `run.allowed_ops` (02 §8.3: the grant's
//!   role picks the tools; imported op lists stay in `legacy.policy`);
//! - `post_read.last_post_at` (unread counts use the keyset without a join) and `reader` holds
//!   `'owner'` or a buddy id, so owner cursors replace owner-channel-reads.json;
//! - `schedule.name`, `schedule.created_at`;
//! - the optional 12th table `conversation` (§6): 976 conversation↔buddy bindings, 213 of them
//!   with no run, would otherwise be lost.

use crate::error::{CoreError, Result};
use rusqlite::Connection;

/// 'BUDD'. Marks a file as this schema; a v33 file (application_id 0) is refused.
pub const APPLICATION_ID: i64 = 0x4255_4444;

pub const DDL: &str = r#"
CREATE TABLE workspace (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  legacy TEXT) STRICT;

CREATE TABLE buddy (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
  slug TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  manager_id TEXT REFERENCES buddy(id),
  provider TEXT, model TEXT, reasoning_effort TEXT, soul_path TEXT,
  background_enabled INTEGER NOT NULL DEFAULT 0 CHECK(background_enabled IN (0,1)),
  max_active_runs INTEGER NOT NULL DEFAULT 5 CHECK(max_active_runs > 0),
  created_at TEXT NOT NULL, legacy TEXT,
  UNIQUE(workspace_id, slug)) STRICT;
CREATE INDEX buddy_manager ON buddy(manager_id) WHERE manager_id IS NOT NULL;

CREATE TABLE task (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
  owner_id TEXT NOT NULL REFERENCES buddy(id), parent_id TEXT REFERENCES task(id),
  title TEXT NOT NULL, done_criteria TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','in_progress','blocked','review','done','cancelled')),
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)), epoch INTEGER NOT NULL DEFAULT 1,
  next_action TEXT, blocked_reason TEXT, evidence TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, legacy TEXT) STRICT;
CREATE INDEX task_owner ON task(owner_id, updated_at);
CREATE INDEX task_workspace ON task(workspace_id, updated_at);
CREATE INDEX task_parent ON task(parent_id, position) WHERE parent_id IS NOT NULL;

CREATE TABLE channel (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
  name TEXT NOT NULL COLLATE NOCASE, purpose TEXT NOT NULL,
  created_by TEXT REFERENCES buddy(id), created_at TEXT NOT NULL,
  UNIQUE(workspace_id, name)) STRICT;

CREATE TABLE post (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
  author_id TEXT REFERENCES buddy(id),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('buddy','owner','channel','task')),
  target_id TEXT CHECK((target_kind = 'owner') = (target_id IS NULL)),
  root_id TEXT REFERENCES post(id), reply_to_id TEXT REFERENCES post(id),
  task_id TEXT REFERENCES task(id),
  purpose TEXT, body TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]',
  reply_state TEXT CHECK(reply_state IN ('awaiting','replied','cancelled','failed')),
  reply_body TEXT, reply_evidence TEXT, replied_at TEXT,
  conversation_id TEXT, return_conversation_id TEXT, created_at TEXT NOT NULL, legacy TEXT,
  CHECK((reply_state = 'replied') = (reply_body IS NOT NULL AND replied_at IS NOT NULL))) STRICT;
CREATE INDEX post_target ON post(target_kind, target_id, created_at, id);
CREATE INDEX post_root ON post(root_id, created_at, id) WHERE root_id IS NOT NULL;
CREATE INDEX post_author ON post(author_id, created_at, id);
CREATE INDEX post_awaiting_target ON post(target_kind, target_id, created_at) WHERE reply_state = 'awaiting';
CREATE INDEX post_awaiting_author ON post(author_id, created_at) WHERE reply_state = 'awaiting';

CREATE TABLE post_read (
  reader TEXT NOT NULL, channel_id TEXT NOT NULL REFERENCES channel(id),
  last_post_id TEXT NOT NULL, last_post_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(reader, channel_id)) STRICT;

CREATE TABLE doc (
  id TEXT PRIMARY KEY, buddy_id TEXT NOT NULL REFERENCES buddy(id), workspace_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('buddy','workspace','task','thread')), scope_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('soul','working','long_term','note','shared')), name TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL CHECK(revision > 0), content TEXT NOT NULL, updated_at TEXT NOT NULL, legacy TEXT,
  UNIQUE(buddy_id, scope_kind, scope_id, kind, name)) STRICT;
CREATE TABLE doc_revision (
  doc_id TEXT NOT NULL REFERENCES doc(id), revision INTEGER NOT NULL, content TEXT NOT NULL,
  reason TEXT NOT NULL, author TEXT NOT NULL, provenance TEXT NOT NULL DEFAULT '{}',
  sha256 TEXT NOT NULL, created_at TEXT NOT NULL, legacy TEXT,
  PRIMARY KEY(doc_id, revision)) STRICT;

CREATE TABLE schedule (
  id TEXT PRIMARY KEY, buddy_id TEXT NOT NULL REFERENCES buddy(id), workspace_id TEXT NOT NULL,
  task_id TEXT REFERENCES task(id), name TEXT NOT NULL,
  cron TEXT NOT NULL, timezone TEXT NOT NULL, prompt TEXT NOT NULL, limits TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), next_run_at TEXT, archived_at TEXT,
  created_at TEXT NOT NULL, legacy TEXT) STRICT;
CREATE INDEX schedule_due ON schedule(next_run_at) WHERE enabled = 1 AND archived_at IS NULL;
CREATE INDEX schedule_buddy ON schedule(buddy_id);

CREATE TABLE run (
  id TEXT PRIMARY KEY, input_key TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1,
  input_kind TEXT NOT NULL CHECK(input_kind IN ('chat','post','reply','schedule','failure_notice')),
  input_id TEXT NOT NULL, buddy_id TEXT NOT NULL REFERENCES buddy(id), workspace_id TEXT NOT NULL,
  conversation_id TEXT, task_id TEXT, task_epoch INTEGER, after_run_id TEXT, retry_of TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','running','cancel_requested','complete','failed','cancelled')),
  lease_token TEXT, lease_expires_at TEXT, deadline TEXT,
  snapshot TEXT, outcome TEXT, error_code TEXT, error TEXT,
  ready_at TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT, legacy TEXT,
  UNIQUE(input_key, attempt)) STRICT;
CREATE UNIQUE INDEX run_live_input ON run(input_key) WHERE status IN ('queued','running','cancel_requested');
CREATE UNIQUE INDEX run_conversation_slot ON run(conversation_id)
  WHERE conversation_id IS NOT NULL AND status IN ('running','cancel_requested');
CREATE INDEX run_queue ON run(ready_at, created_at) WHERE status = 'queued';
CREATE INDEX run_lease ON run(lease_expires_at) WHERE status IN ('running','cancel_requested');
CREATE INDEX run_buddy ON run(buddy_id, status, created_at);
CREATE INDEX run_conversation ON run(conversation_id, created_at) WHERE conversation_id IS NOT NULL;
CREATE INDEX run_task ON run(task_id, status) WHERE task_id IS NOT NULL;

CREATE TABLE conversation (
  id TEXT PRIMARY KEY, buddy_id TEXT NOT NULL REFERENCES buddy(id), workspace_id TEXT NOT NULL,
  task_id TEXT, created_at TEXT NOT NULL, legacy TEXT) STRICT;
CREATE INDEX conversation_buddy ON conversation(buddy_id, created_at);

CREATE TABLE event (
  seq INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, workspace_id TEXT NOT NULL,
  buddy_id TEXT, task_id TEXT, op TEXT NOT NULL, payload TEXT NOT NULL,
  idem_key TEXT, payload_hash TEXT, result_ref TEXT, legacy TEXT,
  UNIQUE(actor, workspace_id, idem_key)) STRICT;
CREATE INDEX event_at ON event(at);
CREATE INDEX event_buddy ON event(buddy_id, seq) WHERE buddy_id IS NOT NULL;
"#;

fn configure(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
    Ok(())
}

/// Open (or create) a buddies-core database. An existing file must carry `APPLICATION_ID`.
pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    let app_id: i64 = conn.query_row("PRAGMA application_id", [], |r| r.get(0))?;
    let tables: i64 = conn.query_row("SELECT count(*) FROM sqlite_schema WHERE type = 'table'", [], |r| r.get(0))?;
    match (app_id == APPLICATION_ID, tables) {
        (true, _) => Ok(conn),
        (false, 0) => {
            conn.execute_batch(&format!("BEGIN; {DDL} PRAGMA application_id = {APPLICATION_ID}; COMMIT;"))?;
            Ok(conn)
        }
        (false, n) => Err(CoreError::WrongDatabase(format!("{path}: {n} tables, application_id {app_id}"))),
    }
}
