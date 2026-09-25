//! Pattern: one-write-path (docs/patterns.md#one-write-path) — `Writer::apply` is the only
//! write; every row a reader sees came through it.
//!
//! Only this crate may open the file. A second SQLite library in the same process (node:sqlite)
//! breaks locking: POSIX locks are per process, so closing that copy's descriptor drops this
//! copy's locks, and it may then truncate the WAL index this copy has mapped. The parity harness
//! did exactly that and died with SIGBUS (2026-09-25; sqlite.org/howtocorrupt.html §2.2.1).
//! Other processes (the sqlite3 CLI) are safe.
//!
//! The SQLite store. Written only by the ingest thread (one connection); read through a second
//! connection so a query never waits behind a long ingest transaction (WAL).
//!
//! Tables: `source` (one per file/directory: its stamp and resume checkpoint), `session` (one
//! list row per source that holds a session), `message` (the visible history, keyed by source
//! and seq) and `removed` (tombstones so `listSessions({ since })` can page deletions too).

use crate::model::{Cwd, Format, Identity, Message, Provider, Role, SessionRow, SubAgent, TimeFrom, ToolCall, Usage};
use crate::read::{Checkpoint, Outcome, RowData, Stamp};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::HashMap;
use std::path::Path;

pub const SCHEMA_VERSION: i64 = 1;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS source (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  stamp TEXT NOT NULL,
  checkpoint BLOB
);
CREATE TABLE IF NOT EXISTS session (
  source_id INTEGER PRIMARY KEY REFERENCES source(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  format TEXT NOT NULL,
  source_path TEXT NOT NULL,
  cwd TEXT NOT NULL,
  observed_model TEXT,
  title TEXT,
  label TEXT NOT NULL,
  created_at REAL NOT NULL,
  activity_at REAL NOT NULL,
  time_from TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  parent_session_id TEXT,
  identity TEXT NOT NULL,
  listed INTEGER NOT NULL,
  swarm_debug_prefix TEXT,
  resumed_from TEXT,
  usage TEXT,
  sub_agents TEXT NOT NULL,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_by_rev ON session(rev);
CREATE INDEX IF NOT EXISTS session_by_id ON session(session_id, activity_at);
CREATE TABLE IF NOT EXISTS message (
  source_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  at REAL,
  completed_at REAL,
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  PRIMARY KEY (source_id, seq)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS removed (
  source_path TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  rev INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS removed_by_rev ON removed(rev);
";

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("corrupt row: {0}")]
    Corrupt(String),
    #[error("{0} is an ingest store of schema {1}; this build reads schema {SCHEMA_VERSION}")]
    Schema(String, i64),
}

pub type Result<T> = std::result::Result<T, StoreError>;

fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // The provider files are the source of truth; a lost last transaction is re-read on start.
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

/// The stored state of a source, without its (possibly large) checkpoint.
#[derive(Debug, Clone)]
pub struct Known {
    pub id: i64,
    pub format: Format,
    pub stamp: Stamp,
}

/// What one committed batch changed, for `onChange`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Committed {
    pub rev: i64,
    pub session_ids: Vec<String>,
    pub removed: Vec<String>,
    pub messages_written: u64,
    /// Source path → row id, for every source this batch wrote.
    pub sources: Vec<(String, i64)>,
}

pub struct Writer {
    conn: Connection,
}

impl Writer {
    pub fn open(path: &Path) -> Result<Writer> {
        let conn = open(path)?;
        conn.execute_batch(SCHEMA)?;
        let version: Option<i64> = conn.query_row("SELECT value FROM meta WHERE key = 'schema'", [], |r| r.get(0)).optional()?;
        match version {
            None => {
                conn.execute("INSERT INTO meta (key, value) VALUES ('schema', ?1), ('rev', 0)", [SCHEMA_VERSION])?;
            }
            Some(SCHEMA_VERSION) => {}
            Some(other) => return Err(StoreError::Schema(path.display().to_string(), other)),
        }
        Ok(Writer { conn })
    }

    /// Every source's stamp. The one whole-table read, done once at start.
    pub fn known(&self) -> Result<HashMap<String, Known>> {
        let mut stmt = self.conn.prepare("SELECT id, path, format, stamp FROM source")?;
        let rows =
            stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))?;
        let mut out = HashMap::new();
        for row in rows {
            let (id, path, format, stamp) = row?;
            let format = Format::parse(&format).ok_or_else(|| StoreError::Corrupt(format!("format {format}")))?;
            let stamp: Stamp = serde_json::from_str(&stamp).map_err(|e| StoreError::Corrupt(format!("stamp of {path}: {e}")))?;
            out.insert(path, Known { id, format, stamp });
        }
        Ok(out)
    }

    pub fn checkpoint(&self, id: i64) -> Result<Option<Checkpoint>> {
        let blob: Option<Vec<u8>> =
            self.conn.query_row("SELECT checkpoint FROM source WHERE id = ?1", [id], |r| r.get(0)).optional()?.flatten();
        // A checkpoint this build cannot decode (an older fold shape) is not an error: the source
        // is read from byte 0, as for an unseen file.
        Ok(blob.and_then(|b| serde_json::from_slice(&b).ok()))
    }

    /// Apply read outcomes and removals in one transaction under one new revision.
    pub fn apply(&mut self, outcomes: Vec<(String, Format, Outcome)>, removed_paths: &[String]) -> Result<Committed> {
        let tx = self.conn.transaction()?;
        let rev: i64 = tx.query_row("UPDATE meta SET value = value + 1 WHERE key = 'rev' RETURNING value", [], |r| r.get(0))?;
        let mut committed = Committed { rev, ..Default::default() };
        {
            let mut upsert_source = tx.prepare_cached(
                "INSERT INTO source (path, format, stamp, checkpoint) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(path) DO UPDATE SET format = excluded.format, stamp = excluded.stamp, checkpoint = excluded.checkpoint
                 RETURNING id",
            )?;
            let mut clear_messages = tx.prepare_cached("DELETE FROM message WHERE source_id = ?1")?;
            let mut insert_message = tx.prepare_cached(
                "INSERT OR REPLACE INTO message (source_id, seq, role, at, completed_at, content, tool_name, tool_input) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            let mut old_row = tx.prepare_cached("SELECT session_id, listed FROM session WHERE source_id = ?1")?;
            let mut delete_row = tx.prepare_cached("DELETE FROM session WHERE source_id = ?1")?;
            let mut tombstone = tx.prepare_cached("INSERT OR REPLACE INTO removed (source_path, session_id, rev) VALUES (?1, ?2, ?3)")?;
            let mut untombstone = tx.prepare_cached("DELETE FROM removed WHERE source_path = ?1")?;
            let mut upsert_row = tx.prepare_cached(
                "INSERT OR REPLACE INTO session (source_id, session_id, provider, format, source_path, cwd, observed_model, title, label,
                   created_at, activity_at, time_from, message_count, parent_session_id, identity, listed, swarm_debug_prefix,
                   resumed_from, usage, sub_agents, rev)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
            )?;
            for (path, format, outcome) in outcomes {
                let checkpoint = outcome.checkpoint.as_ref().map(|c| serde_json::to_vec(c).expect("checkpoint serializes"));
                let stamp = serde_json::to_string(&outcome.stamp).expect("stamp serializes");
                let id: i64 = upsert_source.query_row(params![path, format.as_str(), stamp, checkpoint], |r| r.get(0))?;
                committed.sources.push((path.clone(), id));
                if outcome.replace {
                    clear_messages.execute([id])?;
                }
                for m in &outcome.messages {
                    let (tool_name, tool_input) = match &m.tool_call {
                        Some(call) => (Some(call.name.as_str()), call.input.as_deref()),
                        None => (None, None),
                    };
                    insert_message.execute(params![id, m.seq, m.role.as_str(), m.at, m.completed_at, m.content, tool_name, tool_input])?;
                }
                committed.messages_written += outcome.messages.len() as u64;
                let previous: Option<(String, bool)> = old_row.query_row([id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
                match (&outcome.row, previous) {
                    (None, None) => {}
                    (None, Some((session_id, listed))) => {
                        delete_row.execute([id])?;
                        if listed {
                            tombstone.execute(params![path, session_id, rev])?;
                            committed.removed.push(session_id);
                        }
                    }
                    (Some(row), previous) => {
                        let listed = !row.hidden && row.message_count > 0;
                        write_row(&mut upsert_row, id, &path, format, row, listed, rev)?;
                        if listed {
                            untombstone.execute([&path])?;
                            committed.session_ids.push(row.facts.session_id.clone());
                        } else if let Some((old_id, true)) = previous {
                            tombstone.execute(params![path, old_id, rev])?;
                            committed.removed.push(old_id);
                        }
                    }
                }
            }
            let mut find = tx.prepare_cached("SELECT id FROM source WHERE path = ?1")?;
            let mut delete_source = tx.prepare_cached("DELETE FROM source WHERE id = ?1")?;
            for path in removed_paths {
                let Some(id): Option<i64> = find.query_row([path], |r| r.get(0)).optional()? else { continue };
                if let Some((session_id, listed)) =
                    old_row.query_row([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?))).optional()?
                    && listed
                {
                    tombstone.execute(params![path, session_id, rev])?;
                    committed.removed.push(session_id);
                }
                clear_messages.execute([id])?;
                delete_row.execute([id])?;
                delete_source.execute([id])?;
            }
        }
        tx.commit()?;
        Ok(committed)
    }

    /// Record a source's new stamp when nothing it shows changed (a touch, a partial line).
    pub fn restamp(&self, path: &str, outcome: &Outcome) -> Result<()> {
        let checkpoint = outcome.checkpoint.as_ref().map(|c| serde_json::to_vec(c).expect("checkpoint serializes"));
        let stamp = serde_json::to_string(&outcome.stamp).expect("stamp serializes");
        self.conn.execute("UPDATE source SET stamp = ?2, checkpoint = ?3 WHERE path = ?1", params![path, stamp, checkpoint])?;
        Ok(())
    }

    pub fn rev(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT value FROM meta WHERE key = 'rev'", [], |r| r.get(0))?)
    }

    /// The stored row of a source, for "did this read change what is shown?".
    pub fn row_of(&self, path: &str) -> Result<Option<SessionRow>> {
        let mut stmt = self.conn.prepare_cached(&format!("{ROW_SELECT} WHERE source_id = (SELECT id FROM source WHERE path = ?1)"))?;
        stmt.query_row([path], decode_row).optional()?.transpose()
    }
}

fn write_row(
    stmt: &mut rusqlite::CachedStatement<'_>,
    id: i64,
    path: &str,
    format: Format,
    row: &RowData,
    listed: bool,
    rev: i64,
) -> Result<()> {
    let f = &row.facts;
    stmt.execute(params![
        id,
        f.session_id,
        f.provider.as_str(),
        format.as_str(),
        path,
        serde_json::to_string(&f.cwd).expect("cwd serializes"),
        f.model,
        f.title,
        row.label,
        row.created_at,
        row.activity_at,
        row.time_from.as_str(),
        row.message_count,
        f.parent_session_id,
        serde_json::to_string(&row.identity).expect("identity serializes"),
        listed,
        row.swarm_debug_prefix,
        row.resumed_from,
        f.usage.as_ref().map(|u| serde_json::to_string(u).expect("usage serializes")),
        serde_json::to_string(&f.sub_agents).expect("sub-agents serialize"),
        rev,
    ])?;
    Ok(())
}

const ROW_SELECT: &str = "SELECT session_id, provider, format, source_path, cwd, observed_model, title, label, created_at, activity_at,
  time_from, message_count, parent_session_id, identity, swarm_debug_prefix, resumed_from, usage, sub_agents, rev FROM session";

fn corrupt<E: std::fmt::Display>(what: &str) -> impl Fn(E) -> StoreError + '_ {
    move |e| StoreError::Corrupt(format!("{what}: {e}"))
}

fn decode_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Result<SessionRow>> {
    let provider: String = r.get(1)?;
    let format: String = r.get(2)?;
    let cwd: String = r.get(4)?;
    let time_from: String = r.get(10)?;
    let identity: String = r.get(13)?;
    let usage: Option<String> = r.get(16)?;
    let sub_agents: String = r.get(17)?;
    let decoded = (|| -> Result<SessionRow> {
        Ok(SessionRow {
            session_id: r.get(0)?,
            provider: Provider::parse(&provider).ok_or_else(|| StoreError::Corrupt(format!("provider {provider}")))?,
            format: Format::parse(&format).ok_or_else(|| StoreError::Corrupt(format!("format {format}")))?,
            source_path: r.get(3)?,
            cwd: serde_json::from_str::<Cwd>(&cwd).map_err(corrupt("cwd"))?,
            observed_model: r.get(5)?,
            title: r.get(6)?,
            label: r.get(7)?,
            created_at: r.get(8)?,
            activity_at: r.get(9)?,
            time_from: TimeFrom::parse(&time_from).ok_or_else(|| StoreError::Corrupt(format!("time_from {time_from}")))?,
            message_count: r.get(11)?,
            parent_session_id: r.get(12)?,
            identity: serde_json::from_str::<Identity>(&identity).map_err(corrupt("identity"))?,
            swarm_debug_prefix: r.get(14)?,
            resumed_from_conversation_id: r.get(15)?,
            usage: usage.map(|u| serde_json::from_str::<Usage>(&u)).transpose().map_err(corrupt("usage"))?,
            sub_agents: serde_json::from_str::<Vec<SubAgent>>(&sub_agents).map_err(corrupt("sub_agents"))?,
            rev: r.get(18)?,
        })
    })();
    Ok(decoded)
}

/// A session that left the list (its file was deleted, or it became hidden or empty).
#[derive(Debug, Clone, PartialEq)]
pub struct Removed {
    pub session_id: String,
    pub source_path: String,
    pub rev: i64,
}

pub struct Reader {
    conn: Connection,
}

impl Reader {
    pub fn open(path: &Path) -> Result<Reader> {
        let conn = open(path)?;
        conn.pragma_update(None, "query_only", "ON")?;
        Ok(Reader { conn })
    }

    pub fn rev(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT value FROM meta WHERE key = 'rev'", [], |r| r.get(0))?)
    }

    /// Listed rows changed after `since`, oldest change first, and removals after `since`.
    pub fn list_sessions(&self, since: i64) -> Result<(i64, Vec<SessionRow>, Vec<Removed>)> {
        // Read the revision and the rows in one snapshot so a concurrent ingest commit cannot
        // slip between them (its rows would be skipped by the next `since`).
        let tx = self.conn.unchecked_transaction()?;
        let rev: i64 = tx.query_row("SELECT value FROM meta WHERE key = 'rev'", [], |r| r.get(0))?;
        let rows = {
            let mut stmt = tx.prepare_cached(&format!("{ROW_SELECT} WHERE rev > ?1 AND listed = 1 ORDER BY rev"))?;
            stmt.query_map([since], decode_row)?.map(|r| r?).collect::<Result<Vec<_>>>()?
        };
        let removed = {
            let mut stmt = tx.prepare_cached("SELECT session_id, source_path, rev FROM removed WHERE rev > ?1 ORDER BY rev")?;
            stmt.query_map([since], |r| Ok(Removed { session_id: r.get(0)?, source_path: r.get(1)?, rev: r.get(2)? }))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        tx.commit()?;
        Ok((rev, rows, removed))
    }

    /// The listed row for a native session id. Two files can hold the same id (a transcript
    /// copied between project directories); the most recently active one is the session.
    pub fn session(&self, session_id: &str) -> Result<Option<SessionRow>> {
        let mut stmt =
            self.conn.prepare_cached(&format!("{ROW_SELECT} WHERE session_id = ?1 AND listed = 1 ORDER BY activity_at DESC LIMIT 1"))?;
        stmt.query_row([session_id], decode_row).optional()?.transpose()
    }

    pub fn messages(&self, session_id: &str, after_seq: i64, limit: u32) -> Result<Vec<Message>> {
        let source: Option<i64> = self
            .conn
            .prepare_cached("SELECT source_id FROM session WHERE session_id = ?1 AND listed = 1 ORDER BY activity_at DESC LIMIT 1")?
            .query_row([session_id], |r| r.get(0))
            .optional()?;
        let Some(source) = source else { return Ok(Vec::new()) };
        let mut stmt = self.conn.prepare_cached(
            "SELECT seq, role, at, completed_at, content, tool_name, tool_input FROM message WHERE source_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![source, after_seq, limit], |r| {
            let role: String = r.get(1)?;
            let tool_name: Option<String> = r.get(5)?;
            Ok((r.get::<_, u32>(0)?, role, r.get(2)?, r.get(3)?, r.get::<_, String>(4)?, tool_name, r.get::<_, Option<String>>(6)?))
        })?;
        rows.map(|row| {
            let (seq, role, at, completed_at, content, tool_name, tool_input) = row?;
            Ok(Message {
                seq,
                role: Role::parse(&role).ok_or_else(|| StoreError::Corrupt(format!("role {role}")))?,
                at,
                completed_at,
                content,
                tool_call: tool_name.map(|name| ToolCall { name, input: tool_input }),
            })
        })
        .collect()
    }

    /// `EXPLAIN QUERY PLAN` of every read this type runs; used by the query-plan guard.
    pub fn plans(&self) -> Result<Vec<(String, Vec<String>)>> {
        let queries = [
            format!("{ROW_SELECT} WHERE rev > 0 AND listed = 1 ORDER BY rev"),
            "SELECT session_id, source_path, rev FROM removed WHERE rev > 0 ORDER BY rev".to_string(),
            format!("{ROW_SELECT} WHERE session_id = 'x' AND listed = 1 ORDER BY activity_at DESC LIMIT 1"),
            "SELECT source_id FROM session WHERE session_id = 'x' AND listed = 1 ORDER BY activity_at DESC LIMIT 1".to_string(),
            "SELECT seq, role, at, completed_at, content, tool_name, tool_input FROM message WHERE source_id = 1 AND seq > -1 ORDER BY seq LIMIT 10".to_string(),
            format!("{ROW_SELECT} WHERE source_id = (SELECT id FROM source WHERE path = 'x')"),
            "SELECT checkpoint FROM source WHERE id = 1".to_string(),
            "SELECT id FROM source WHERE path = 'x'".to_string(),
            "SELECT session_id, listed FROM session WHERE source_id = 1".to_string(),
            "DELETE FROM message WHERE source_id = 1".to_string(),
            "SELECT value FROM meta WHERE key = 'rev'".to_string(),
        ];
        queries
            .into_iter()
            .map(|q| {
                let mut stmt = self.conn.prepare(&format!("EXPLAIN QUERY PLAN {q}"))?;
                let details = stmt.query_map([], |r| r.get::<_, String>(3))?.collect::<rusqlite::Result<Vec<_>>>()?;
                Ok((q, details))
            })
            .collect()
    }
}
