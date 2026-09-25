//! Zero-loss verification of an import (01 §7.3 checks 1–4), both databases read-only.
//!
//! 1–2. Per class, rows are grouped by a per-buddy key on both sides and serialized with the same
//!      canonical serializer (SQLite `json_array` over identical columns); each group's row count
//!      and sha256 over its sorted lines must match.
//! 3.   Per doc, the set of (revision, sha256(content)) must match; stored sha256 values must equal
//!      the content hash (memory: source hash = imported hash); the head is the last revision.
//! 4.   Soul files are re-hashed against the import baseline and classified against the new soul
//!      docs the way `tools/soul-check.mjs` does.

use crate::error::Result;
use crate::import::{SoulFile, SoulFileState, open_source, soul_files, uri};
use crate::store::{collect, sha256_hex};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// (class, v33 query, new query). Each query yields (group key, canonical line).
const CLASSES: &[(&str, &str, &str)] = &[
    (
        "messages_by_sender",
        "SELECT from_buddy_id, json_array(id, created_at, body, evidence) FROM buddy_messages",
        "SELECT coalesce(author_id, 'owner'), json_array(id, created_at, body, evidence) FROM post WHERE target_kind IN ('buddy','owner')",
    ),
    (
        "messages_by_recipient_with_replies",
        "SELECT coalesce(to_buddy_id, 'owner'), json_array(id, created_at, body, evidence, reply_body, reply_evidence, replied_at) FROM buddy_messages",
        "SELECT coalesce(target_id, 'owner'), json_array(id, created_at, body, evidence, reply_body, reply_evidence, replied_at)
         FROM post WHERE target_kind IN ('buddy','owner')",
    ),
    (
        "channel_posts_by_author",
        "SELECT coalesce(from_buddy_id, 'owner'), json_array(id, created_at, body, evidence) FROM buddy_list_posts",
        "SELECT coalesce(author_id, 'owner'), json_array(id, created_at, body, evidence) FROM post WHERE target_kind = 'channel'",
    ),
    (
        "channel_posts_by_channel_and_author",
        "SELECT list_id || '/' || coalesce(from_buddy_id, 'owner'), json_array(id, thread_root_id) FROM buddy_list_posts",
        "SELECT target_id || '/' || coalesce(author_id, 'owner'), json_array(id, root_id) FROM post WHERE target_kind = 'channel'",
    ),
    (
        "task_comments_by_task",
        "SELECT project_id, json_array(id, author, created_at, body, evidence) FROM buddy_task_comments",
        "SELECT target_id, json_array(id, coalesce(author_id, 'owner'), created_at, body, evidence) FROM post WHERE target_kind = 'task'",
    ),
    (
        "memory_revisions_by_buddy_kind",
        "SELECT buddy_id || '/' || document_kind, json_array(revision, body) FROM buddy_memory_revisions",
        "SELECT coalesce(d.buddy_id || '/' || d.kind, 'orphan:' || r.doc_id), json_array(r.revision, r.content)
         FROM doc_revision r LEFT JOIN doc d ON d.id = r.doc_id WHERE r.doc_id GLOB 'mem_*'",
    ),
    (
        "memory_heads_by_buddy_kind",
        "SELECT h.buddy_id || '/' || h.document_kind, json_array(r.revision, r.body) FROM buddy_memory_heads h
         JOIN buddy_memory_revisions r ON r.id = h.revision_id",
        "SELECT buddy_id || '/' || kind, json_array(revision, content) FROM doc WHERE scope_kind = 'buddy'",
    ),
    (
        "knowledge_docs_by_buddy_scope_kind",
        "SELECT buddy_id || '/' || CASE scope_kind WHEN 'owner_thread' THEN 'thread' WHEN 'project' THEN 'task' ELSE scope_kind END
           || '/' || kind, json_array(id, scope_id, name, revision, content) FROM buddy_knowledge",
        "SELECT buddy_id || '/' || scope_kind || '/' || kind, json_array(id, scope_id, name, revision, content) FROM doc WHERE scope_kind != 'buddy'",
    ),
    (
        "knowledge_revisions_by_buddy_scope_kind",
        "SELECT coalesce(k.buddy_id || '/' || CASE k.scope_kind WHEN 'owner_thread' THEN 'thread' WHEN 'project' THEN 'task'
           ELSE k.scope_kind END || '/' || k.kind, 'orphan:' || r.document_id), json_array(r.document_id, r.revision, r.content)
         FROM buddy_knowledge_revisions r LEFT JOIN buddy_knowledge k ON k.id = r.document_id",
        "SELECT coalesce(d.buddy_id || '/' || d.scope_kind || '/' || d.kind, 'orphan:' || r.doc_id), json_array(r.doc_id, r.revision, r.content)
         FROM doc_revision r LEFT JOIN doc d ON d.id = r.doc_id WHERE r.doc_id NOT GLOB 'mem_*'",
    ),
];

#[derive(Debug, Serialize)]
pub struct GroupDiff {
    pub key: String,
    pub old_rows: usize,
    pub new_rows: usize,
}

#[derive(Debug, Serialize)]
pub struct ClassCheck {
    pub class: String,
    pub ok: bool,
    pub rows_old: usize,
    pub rows_new: usize,
    pub groups: usize,
    pub hash_matches: usize,
    /// Groups whose count or content hash differ (count equal = content changed).
    pub mismatches: Vec<GroupDiff>,
}

#[derive(Debug, Serialize)]
pub struct ChainCheck {
    pub ok: bool,
    pub docs: usize,
    pub revisions: usize,
    pub mismatches: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SoulCheck {
    pub ok: bool,
    pub files_unchanged: usize,
    pub files_changed: Vec<String>,
    /// soul-check.mjs categories against the new DB's soul docs.
    pub split: BTreeMap<String, usize>,
    pub differ: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct VerifyReport {
    pub ok: bool,
    pub classes: Vec<ClassCheck>,
    pub revision_chains: ChainCheck,
    pub soul: SoulCheck,
}

fn open_new(path: &Path) -> Result<Connection> {
    Ok(Connection::open_with_flags(uri(path), OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI)?)
}

fn groups(conn: &Connection, sql: &str) -> Result<BTreeMap<String, Vec<String>>> {
    let rows: Vec<(String, String)> = collect(conn.prepare(sql)?.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?)?;
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (key, line) in rows {
        out.entry(key).or_default().push(line);
    }
    out.values_mut().for_each(|lines| lines.sort());
    Ok(out)
}

fn digest(lines: &[String]) -> String {
    sha256_hex(lines.join("\n").as_bytes())
}

fn check_class(old: &Connection, new: &Connection, (class, old_sql, new_sql): &(&str, &str, &str)) -> Result<ClassCheck> {
    let (a, b) = (groups(old, old_sql)?, groups(new, new_sql)?);
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    let empty = Vec::new();
    let mut mismatches = Vec::new();
    let mut hash_matches = 0;
    for key in &keys {
        let (x, y) = (a.get(*key).unwrap_or(&empty), b.get(*key).unwrap_or(&empty));
        match digest(x) == digest(y) {
            true => hash_matches += 1,
            false => mismatches.push(GroupDiff { key: (*key).clone(), old_rows: x.len(), new_rows: y.len() }),
        }
    }
    Ok(ClassCheck {
        class: class.to_string(),
        ok: mismatches.is_empty(),
        rows_old: a.values().map(Vec::len).sum(),
        rows_new: b.values().map(Vec::len).sum(),
        groups: keys.len(),
        hash_matches,
        mismatches,
    })
}

type Chains = BTreeMap<String, BTreeSet<(i64, String)>>;

fn chains(conn: &Connection, sql: &str, mismatches: &mut Vec<String>) -> Result<Chains> {
    let rows: Vec<(String, i64, String, Option<String>)> =
        collect(conn.prepare(sql)?.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?)?;
    let mut out = Chains::new();
    for (doc, revision, content, stored) in rows {
        let hash = sha256_hex(content.as_bytes());
        if stored.as_ref().is_some_and(|s| *s != hash) {
            mismatches.push(format!("{doc} r{revision}: stored sha256 differs from content"));
        }
        out.entry(doc).or_default().insert((revision, hash));
    }
    Ok(out)
}

fn check_chains(old: &Connection, new: &Connection) -> Result<ChainCheck> {
    let mut mismatches = Vec::new();
    let a = chains(
        old,
        "SELECT 'mem_' || buddy_id || '_' || document_kind, revision, body, sha256 FROM buddy_memory_revisions
         UNION ALL SELECT document_id, revision, content, NULL FROM buddy_knowledge_revisions",
        &mut mismatches,
    )?;
    let b = chains(new, "SELECT doc_id, revision, content, sha256 FROM doc_revision", &mut mismatches)?;
    for doc in a.keys().chain(b.keys()).collect::<BTreeSet<_>>() {
        if a.get(doc) != b.get(doc) {
            mismatches.push(format!("{doc}: revision set differs"));
        }
    }
    // Stored hashes equal content hashes on both sides and the sets match, so memory's source
    // sha256 equals the imported one.
    let stale_heads: Vec<String> = collect(
        new.prepare(
            "SELECT d.id FROM doc d LEFT JOIN doc_revision r ON r.doc_id = d.id AND r.revision = d.revision
             WHERE r.content IS NOT d.content OR d.revision != (SELECT max(revision) FROM doc_revision x WHERE x.doc_id = d.id)",
        )?
        .query_map([], |r| r.get(0))?,
    )?;
    mismatches.extend(stale_heads.into_iter().map(|d| format!("{d}: head is not its last revision")));
    Ok(ChainCheck { ok: mismatches.is_empty(), docs: b.len(), revisions: b.values().map(BTreeSet::len).sum(), mismatches })
}

/// Front matter written by the v33 soul renderer: `---\nversion: N\nupdated: …\ndocument: soul\n---\n\n`.
fn strip_front_matter(raw: &str) -> (Option<i64>, &str) {
    let parsed = raw.strip_prefix("---\nversion: ").and_then(|rest| {
        let (version, rest) = rest.split_once('\n')?;
        let rest = rest.strip_prefix("updated: ")?.split_once('\n')?.1;
        let body = rest.strip_prefix("document: soul\n---\n\n")?;
        Some((version.parse().ok()?, body))
    });
    match parsed {
        Some((version, body)) => (Some(version), body),
        None => (None, raw),
    }
}

fn check_soul(new: &Connection, baseline: &[SoulFile]) -> Result<SoulCheck> {
    let current = soul_files(
        new,
        "SELECT b.id, b.slug, b.soul_path, w.root_path FROM buddy b JOIN workspace w ON w.id = b.workspace_id ORDER BY b.slug",
    )?;
    let before: BTreeMap<&str, &SoulFile> = baseline.iter().map(|s| (s.buddy_id.as_str(), s)).collect();
    let files_changed: Vec<String> =
        current.iter().filter(|s| before.get(s.buddy_id.as_str()) != Some(s)).map(|s| s.slug.clone()).collect();
    let mut split = BTreeMap::new();
    let mut differ = Vec::new();
    for file in &current {
        let (content, revision): (String, i64) = new.query_row(
            "SELECT content, revision FROM doc WHERE buddy_id = ?1 AND scope_kind = 'buddy' AND scope_id = ?1 AND kind = 'soul' AND name = ''",
            [&file.buddy_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let verdict = match &file.state {
            SoulFileState::NoPath if content.is_empty() => "no_path_empty",
            SoulFileState::NoPath => "no_path_db_only",
            SoulFileState::Missing { .. } => "file_missing",
            SoulFileState::Present { path, .. } => {
                let raw = std::fs::read_to_string(path)?;
                let (version, body) = strip_front_matter(&raw);
                match (body.trim_end() == content.trim_end(), version) {
                    (true, Some(v)) if v == revision => "match",
                    (true, Some(_)) => "match_body_version_differs",
                    (true, None) => "match_no_header",
                    (false, _) => "differ",
                }
            }
        };
        if matches!(verdict, "differ" | "file_missing") {
            differ.push(format!("{}: {verdict}", file.slug));
        }
        *split.entry(verdict.to_string()).or_insert(0) += 1;
    }
    Ok(SoulCheck {
        ok: files_changed.is_empty() && differ.is_empty() && current.len() == baseline.len(),
        files_unchanged: current.len() - files_changed.len(),
        files_changed,
        split,
        differ,
    })
}

pub fn verify(source: &Path, target: &Path, soul_baseline: &[SoulFile]) -> Result<VerifyReport> {
    let old = open_source(source)?;
    let new = open_new(target)?;
    let classes = CLASSES.iter().map(|c| check_class(&old, &new, c)).collect::<Result<Vec<_>>>()?;
    let revision_chains = check_chains(&old, &new)?;
    let soul = check_soul(&new, soul_baseline)?;
    Ok(VerifyReport { ok: classes.iter().all(|c| c.ok) && revision_chains.ok && soul.ok, classes, revision_chains, soul })
}
