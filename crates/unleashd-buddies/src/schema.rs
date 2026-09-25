//! The one schema (01-buddies-package.md §6). There are no versions and no migration chain: a
//! database is either empty (and gets this schema) or already carries `APPLICATION_ID`.
//!
//! Deviations from §6, each for a named reason:
//! - every imported table has `legacy TEXT` (JSON of the source columns with no new home; §7.1);
//! - `run.lease_expires_at` (claims need an expiry), no `run.allowed_ops` (02 §8.3: the grant's
//!   role picks the tools; imported op lists stay in `legacy.policy`);
//! - messages, channel posts and task comments are ONE kind of row: a post in a channel (owner
//!   decision 2026-09-25, T06b). A channel is `public` (name, purpose), `direct` (a member set,
//!   one channel per set: `member_key` is the sorted member keys joined by ',', and
//!   `channel_member` indexes it by member) or `task` (one per task). A reply is its own post
//!   (`reply_to_id`, same thread); a request carries `request` and, once answered, `answer_id`;
//! - `post.ord` is the post's ordered id: a time-ordered UUIDv7 from the crate's one monotonic
//!   generator (ids.rs). Threads, pages and read cursors order by it, never by `created_at` ties.
//!   A new post's id is `post_<ord>`; an imported post keeps its v33 id (runs, conversation links
//!   and client permalinks name it) and gets an `ord` issued at its source write time, in source
//!   order, so all history reads in true write order and every later post sorts after it;
//! - `post_read` covers every channel kind. `reader` is `'owner'` or a buddy id; the cursor is
//!   `last_ord` (with `last_post_id`/`last_post_at` for the record). Owner cursors replace
//!   owner-channel-reads.json, whose baseline imports as the ceiling id of baselineAt ("read
//!   through that instant", post id '');
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
  kind TEXT NOT NULL CHECK(kind IN ('public','direct','task')),
  name TEXT COLLATE NOCASE, purpose TEXT, member_key TEXT UNIQUE, task_id TEXT UNIQUE REFERENCES task(id),
  created_by TEXT REFERENCES buddy(id), created_at TEXT NOT NULL,
  CHECK((kind = 'public') = (name IS NOT NULL AND purpose IS NOT NULL)),
  CHECK((kind = 'direct') = (member_key IS NOT NULL)),
  CHECK((kind = 'task') = (task_id IS NOT NULL)),
  UNIQUE(workspace_id, name)) STRICT;
CREATE TABLE channel_member (
  channel_id TEXT NOT NULL REFERENCES channel(id), member TEXT NOT NULL,
  PRIMARY KEY(channel_id, member)) STRICT, WITHOUT ROWID;
CREATE INDEX channel_member_by_member ON channel_member(member, channel_id);

CREATE TABLE post (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channel(id),
  author_id TEXT REFERENCES buddy(id),
  root_id TEXT REFERENCES post(id), reply_to_id TEXT REFERENCES post(id),
  task_id TEXT REFERENCES task(id),
  purpose TEXT, body TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]',
  request TEXT CHECK(request IN ('awaiting','answered','cancelled','failed')),
  answer_id TEXT REFERENCES post(id),
  conversation_id TEXT, return_conversation_id TEXT, created_at TEXT NOT NULL, legacy TEXT,
  ord TEXT NOT NULL UNIQUE,
  CHECK((request IS 'answered') = (answer_id IS NOT NULL))) STRICT;
CREATE INDEX post_channel ON post(channel_id, ord);
CREATE INDEX post_root ON post(root_id, ord) WHERE root_id IS NOT NULL;
CREATE INDEX post_awaiting ON post(channel_id, created_at) WHERE request = 'awaiting';
CREATE INDEX post_awaiting_author ON post(author_id, created_at) WHERE request = 'awaiting';

CREATE TABLE post_read (
  reader TEXT NOT NULL, channel_id TEXT NOT NULL REFERENCES channel(id),
  last_post_id TEXT NOT NULL, last_post_at TEXT NOT NULL, last_ord TEXT NOT NULL,
  updated_at TEXT NOT NULL, legacy TEXT,
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
CREATE INDEX run_queue ON run(ready_at, id) WHERE status = 'queued';
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

/// Full-text search over post bodies: an external-content FTS5 index kept in step by triggers.
/// Added after the T06b schema, so `open` creates it on a file that lacks it (and fills it once).
const POST_SEARCH: &str = r#"
CREATE VIRTUAL TABLE post_search USING fts5(body, content='post', content_rowid='rowid');
CREATE TRIGGER post_search_insert AFTER INSERT ON post BEGIN
  INSERT INTO post_search(rowid, body) VALUES (new.rowid, new.body);
END;
CREATE TRIGGER post_search_delete AFTER DELETE ON post BEGIN
  INSERT INTO post_search(post_search, rowid, body) VALUES ('delete', old.rowid, old.body);
END;
CREATE TRIGGER post_search_update AFTER UPDATE OF body ON post BEGIN
  INSERT INTO post_search(post_search, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO post_search(rowid, body) VALUES (new.rowid, new.body);
END;
INSERT INTO post_search(post_search) VALUES ('rebuild');
"#;

/// `post_task` serves the Task filter (T22); without it the filter walked every post in ord order.
/// Indexes for the self-references of `post`. With the search triggers in place SQLite plans the
/// foreign-key parent checks of every post insert, and without these they are full scans of
/// `post` (the query-plan guard caught it). Added after T06b, so created on open when missing.
const POST_REFERENCE_INDEXES: &str = "
CREATE INDEX IF NOT EXISTS post_reply_to ON post(reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS post_answer ON post(answer_id) WHERE answer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS post_task ON post(task_id, ord) WHERE task_id IS NOT NULL;";

/// A file imported before ordered ids has no `post.ord`: it cannot be ordered correctly, so it is
/// refused with the fix (re-import), never opened half-working. No live file predates it (T15).
fn require_ordered_ids(conn: &Connection, path: &str) -> Result<()> {
    let has_ord: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('post') WHERE name = 'ord')", [], |r| r.get(0))?;
    match has_ord {
        true => Ok(()),
        false => Err(CoreError::WrongDatabase(format!("{path}: imported before ordered ids (no post.ord); re-import it"))),
    }
}

fn ensure_post_search(conn: &Connection) -> Result<()> {
    conn.execute_batch(POST_REFERENCE_INDEXES)?;
    let present: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = 'post_search')", [], |r| r.get(0))?;
    match present {
        true => Ok(()),
        false => Ok(conn.execute_batch(&format!("BEGIN; {POST_SEARCH} COMMIT;"))?),
    }
}

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
        (true, _) => {
            require_ordered_ids(&conn, path)?;
            ensure_post_search(&conn)?;
            Ok(conn)
        }
        (false, 0) => {
            conn.execute_batch(&format!("BEGIN; {DDL} PRAGMA application_id = {APPLICATION_ID}; COMMIT;"))?;
            ensure_post_search(&conn)?;
            Ok(conn)
        }
        (false, n) => Err(CoreError::WrongDatabase(format!("{path}: {n} tables, application_id {app_id}"))),
    }
}
