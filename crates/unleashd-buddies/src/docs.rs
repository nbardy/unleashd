//! Docs: soul, working and long-term memory, notes and scoped knowledge in one revisioned store.
//! Writes are compare-and-swap on the revision the writer read; every revision is kept with its
//! sha256. Soul files on disk are never written here.

use crate::error::{CoreError, Result};
use crate::store::{Mutation, Store, collect, corrupt, get_buddy, idempotent, new_id, now_iso, require, sha256_hex};
use crate::types::*;
use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};
use serde_json::json;

const DOC_COLS: &str = "id, buddy_id, workspace_id, scope_kind, scope_id, kind, name, revision, content, updated_at";

fn doc_row(r: &Row) -> rusqlite::Result<Doc> {
    Ok(Doc {
        id: r.get(0)?,
        buddy_id: r.get(1)?,
        workspace_id: r.get(2)?,
        scope: DocScope::from_columns(&r.get::<_, String>(3)?, r.get(4)?).map_err(corrupt)?,
        kind: r.get(5)?,
        name: r.get(6)?,
        revision: r.get(7)?,
        content: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

fn find(conn: &Connection, doc: &DocRef) -> Result<Option<Doc>> {
    let (scope_kind, scope_id) = doc.scope.columns(&doc.buddy_id);
    let sql = format!("SELECT {DOC_COLS} FROM doc WHERE buddy_id = ?1 AND scope_kind = ?2 AND scope_id = ?3 AND kind = ?4 AND name = ?5");
    Ok(conn.prepare_cached(&sql)?.query_row(params![doc.buddy_id, scope_kind, scope_id, doc.kind, doc.name], doc_row).optional()?)
}

/// A doc lives in its buddy's workspace, except workspace- and task-scoped docs.
fn doc_workspace(tx: &Connection, doc: &DocRef) -> Result<String> {
    match &doc.scope {
        DocScope::Buddy | DocScope::Thread { .. } => Ok(get_buddy(tx, &doc.buddy_id)?.workspace_id),
        DocScope::Workspace { workspace_id } => Ok(workspace_id.clone()),
        DocScope::Task { task_id } => tx
            .prepare_cached("SELECT workspace_id FROM task WHERE id = ?1")?
            .query_row([task_id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| CoreError::not_found("task", task_id)),
    }
}

impl Store {
    /// The current doc, or None when it was never written.
    pub fn read_doc(&self, actor: &Actor, doc: DocRef) -> Result<Option<Doc>> {
        require(&self.conn, actor, Op::ReadDoc, &Subject::Buddy { id: doc.buddy_id.clone() })?;
        find(&self.conn, &doc)
    }

    pub fn write_doc(&mut self, actor: &Actor, input: DocWrite) -> Result<Doc> {
        self.write(|tx| {
            require(tx, actor, Op::WriteDoc, &Subject::Buddy { id: input.doc.buddy_id.clone() })?;
            let workspace_id = doc_workspace(tx, &input.doc)?;
            let (scope_kind, scope_id) = input.doc.scope.columns(&input.doc.buddy_id);
            let m = Mutation {
                actor,
                workspace_id: &workspace_id,
                buddy_id: Some(&input.doc.buddy_id),
                task_id: None,
                op: "doc.write",
                payload: json!({"doc": [scope_kind, scope_id, input.doc.kind.as_str(), input.doc.name],
                    "base": input.base_revision, "sha256": sha256_hex(input.content.as_bytes()), "reason": input.reason}),
                key: Some(&input.key),
            };
            let id = idempotent(tx, &m, |tx| cas_write(tx, actor, &workspace_id, &input))?;
            Ok(tx.query_row(&format!("SELECT {DOC_COLS} FROM doc WHERE id = ?1"), [id], doc_row)?)
        })
    }

    /// A buddy's docs of one kind across every scope.
    pub fn list_docs(&self, actor: &Actor, buddy_id: &str, kind: DocKind) -> Result<Vec<Doc>> {
        require(&self.conn, actor, Op::ReadDoc, &Subject::Buddy { id: buddy_id.to_string() })?;
        let sql = format!("SELECT {DOC_COLS} FROM doc WHERE buddy_id = ?1 AND kind = ?2 ORDER BY updated_at DESC");
        collect(self.conn.prepare_cached(&sql)?.query_map(params![buddy_id, kind], doc_row)?)
    }

    pub fn doc_revisions(&self, actor: &Actor, doc_id: &str) -> Result<Vec<DocRevision>> {
        let buddy_id: String = self
            .conn
            .prepare_cached("SELECT buddy_id FROM doc WHERE id = ?1")?
            .query_row([doc_id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| CoreError::not_found("doc", doc_id))?;
        require(&self.conn, actor, Op::ReadDoc, &Subject::Buddy { id: buddy_id })?;
        let mut stmt = self.conn.prepare_cached(
            "SELECT doc_id, revision, content, reason, author, provenance, sha256, created_at FROM doc_revision
             WHERE doc_id = ?1 ORDER BY revision",
        )?;
        collect(stmt.query_map([doc_id], |r| {
            Ok(DocRevision {
                doc_id: r.get(0)?,
                revision: r.get(1)?,
                content: r.get(2)?,
                reason: r.get(3)?,
                author: r.get(4)?,
                provenance: r.get(5)?,
                sha256: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?)
    }
}

fn cas_write(tx: &Transaction, actor: &Actor, workspace_id: &str, input: &DocWrite) -> Result<String> {
    let current = find(tx, &input.doc)?;
    let current_revision = current.as_ref().map_or(0, |d| d.revision);
    if current_revision != input.base_revision {
        return Err(CoreError::RevisionConflict { expected: input.base_revision, current: current_revision });
    }
    let now = now_iso();
    let revision = current_revision + 1;
    let id = current.map_or_else(|| new_id("doc"), |d| d.id);
    let (scope_kind, scope_id) = input.doc.scope.columns(&input.doc.buddy_id);
    tx.execute(
        "INSERT INTO doc (id, buddy_id, workspace_id, scope_kind, scope_id, kind, name, revision, content, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, content = excluded.content, updated_at = excluded.updated_at",
        params![id, input.doc.buddy_id, workspace_id, scope_kind, scope_id, input.doc.kind, input.doc.name, revision, input.content, now],
    )?;
    tx.execute(
        "INSERT INTO doc_revision (doc_id, revision, content, reason, author, sha256, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, revision, input.content, input.reason, actor.key(), sha256_hex(input.content.as_bytes()), now],
    )?;
    Ok(id)
}
