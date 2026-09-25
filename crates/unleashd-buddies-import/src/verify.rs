//! Zero-loss verification of an import (01 §7.3 checks 1–4), both databases read-only.
//!
//! 1–2. Per class, rows are grouped by a per-buddy key on both sides and serialized with the same
//!      canonical serializer (SQLite `json_array` over identical columns); each group's row count
//!      and sha256 over its sorted lines must match.
//! 3.   Per doc, the set of (revision, sha256(content)) must match; stored sha256 values must equal
//!      the content hash (memory: source hash = imported hash); the head is the last revision.
//! 4.   Soul files are re-hashed against the import baseline and classified against the new soul
//!      docs the way `tools/soul-check.mjs` does.
//!
//! Posts (T06b, everything is a post in a channel) add three checks:
//! - answers: every v33 inline reply is byte-identical to the body of the post that answers its
//!   request, written by the recipient, in the request's channel and thread;
//! - links: every `reply_to_id` and `root_id` resolves inside its own channel, a reply sits in its
//!   parent's thread, and a message whose v33 root is in the same channel is threaded under it;
//! - read cursors: `post_read` equals buddy_list_reads plus the owner's cursors from
//!   owner-channel-reads.json, re-read now and required to be unchanged since the import.

use crate::import::{
    CURSOR_ORD, DIRECT_READ_CURSORS, DM_KEY, DirectReads, OwnerReads, SoulFile, SoulFileState, load_owner_reads, open_source, soul_files,
    uri,
};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use unleashd_buddies::error::Result;
use unleashd_buddies::store::{collect, sha256_hex};

/// Imported messages, as the direct-channel posts that answer nothing. `recipient` is the other
/// member of the channel, or the author in a channel of one.
const MESSAGES: &str = "SELECT p.*, c.member_key, coalesce(p.author_id, 'owner') AS sender,
      coalesce((SELECT m.member FROM channel_member m WHERE m.channel_id = p.channel_id AND m.member != coalesce(p.author_id, 'owner')),
               coalesce(p.author_id, 'owner')) AS recipient
    FROM post p JOIN channel c ON c.id = p.channel_id
    WHERE c.kind = 'direct' AND NOT EXISTS (SELECT 1 FROM post q WHERE q.answer_id = p.id)";

/// The request state a v33 message maps to (01 §7.1).
const V33_REQUEST: &str = "CASE WHEN status = 'replied' THEN 'answered' WHEN expects_reply = 0 THEN NULL
    WHEN status IN ('pending','active') THEN 'awaiting' ELSE status END";

/// (class, v33 query, new query). Each query yields (group key, canonical line).
fn classes() -> Vec<(&'static str, String, String)> {
    vec![
        (
            "messages_by_sender",
            "SELECT from_buddy_id, json_array(id, created_at, body, evidence) FROM buddy_messages".into(),
            format!("SELECT sender, json_array(id, created_at, body, evidence) FROM ({MESSAGES})"),
        ),
        (
            "messages_by_recipient_with_request_state",
            format!("SELECT coalesce(to_buddy_id, 'owner'), json_array(id, created_at, body, evidence, {V33_REQUEST}) FROM buddy_messages"),
            format!("SELECT recipient, json_array(id, created_at, body, evidence, request) FROM ({MESSAGES})"),
        ),
        (
            "messages_by_channel_with_links",
            format!(
                "SELECT {DM_KEY}, json_array(id, created_at, body, evidence, purpose, in_reply_to_id, root_message_id, buddy_project_id)
                 FROM buddy_messages"
            ),
            format!(
                "SELECT member_key, json_array(id, created_at, body, evidence, purpose, reply_to_id, json_extract(legacy, '$.root_message_id'),
                   task_id) FROM ({MESSAGES})"
            ),
        ),
        (
            "answers_by_channel_and_author",
            format!(
                "SELECT {DM_KEY} || '/' || coalesce(to_buddy_id, 'owner'), json_array(id, reply_body, reply_evidence, replied_at)
                 FROM buddy_messages WHERE status = 'replied'"
            ),
            "SELECT c.member_key || '/' || coalesce(a.author_id, 'owner'), json_array(q.id, a.body, a.evidence, a.created_at)
             FROM post q JOIN post a ON a.id = q.answer_id JOIN channel c ON c.id = a.channel_id"
                .into(),
        ),
        (
            "channel_posts_by_author",
            "SELECT coalesce(from_buddy_id, 'owner'), json_array(id, created_at, body, evidence) FROM buddy_list_posts".into(),
            "SELECT coalesce(p.author_id, 'owner'), json_array(p.id, p.created_at, p.body, p.evidence)
             FROM post p JOIN channel c ON c.id = p.channel_id WHERE c.kind = 'public'"
                .into(),
        ),
        (
            "channel_posts_by_channel_and_author",
            "SELECT list_id || '/' || coalesce(from_buddy_id, 'owner'), json_array(id, created_at, body, evidence, thread_root_id)
             FROM buddy_list_posts"
                .into(),
            "SELECT p.channel_id || '/' || coalesce(p.author_id, 'owner'), json_array(p.id, p.created_at, p.body, p.evidence, p.root_id)
             FROM post p JOIN channel c ON c.id = p.channel_id WHERE c.kind = 'public'"
                .into(),
        ),
        (
            "task_comments_by_task_and_author",
            "SELECT project_id || '/' || author, json_array(id, created_at, body, evidence) FROM buddy_task_comments".into(),
            "SELECT c.task_id || '/' || coalesce(p.author_id, 'owner'), json_array(p.id, p.created_at, p.body, p.evidence)
             FROM post p JOIN channel c ON c.id = p.channel_id WHERE c.kind = 'task'"
                .into(),
        ),
        (
            "memory_revisions_by_buddy_kind",
            "SELECT buddy_id || '/' || document_kind, json_array(revision, body) FROM buddy_memory_revisions".into(),
            "SELECT coalesce(d.buddy_id || '/' || d.kind, 'orphan:' || r.doc_id), json_array(r.revision, r.content)
             FROM doc_revision r LEFT JOIN doc d ON d.id = r.doc_id WHERE r.doc_id GLOB 'mem_*'"
                .into(),
        ),
        (
            "memory_heads_by_buddy_kind",
            "SELECT h.buddy_id || '/' || h.document_kind, json_array(r.revision, r.body) FROM buddy_memory_heads h
             JOIN buddy_memory_revisions r ON r.id = h.revision_id"
                .into(),
            "SELECT buddy_id || '/' || kind, json_array(revision, content) FROM doc WHERE scope_kind = 'buddy'".into(),
        ),
        (
            "knowledge_docs_by_buddy_scope_kind",
            "SELECT buddy_id || '/' || CASE scope_kind WHEN 'owner_thread' THEN 'thread' WHEN 'project' THEN 'task' ELSE scope_kind END
               || '/' || kind, json_array(id, scope_id, name, revision, content) FROM buddy_knowledge"
                .into(),
            "SELECT buddy_id || '/' || scope_kind || '/' || kind, json_array(id, scope_id, name, revision, content) FROM doc WHERE scope_kind != 'buddy'"
                .into(),
        ),
        (
            "knowledge_revisions_by_buddy_scope_kind",
            "SELECT coalesce(k.buddy_id || '/' || CASE k.scope_kind WHEN 'owner_thread' THEN 'thread' WHEN 'project' THEN 'task'
               ELSE k.scope_kind END || '/' || k.kind, 'orphan:' || r.document_id), json_array(r.document_id, r.revision, r.content)
             FROM buddy_knowledge_revisions r LEFT JOIN buddy_knowledge k ON k.id = r.document_id"
                .into(),
            "SELECT coalesce(d.buddy_id || '/' || d.scope_kind || '/' || d.kind, 'orphan:' || r.doc_id), json_array(r.doc_id, r.revision, r.content)
             FROM doc_revision r LEFT JOIN doc d ON d.id = r.doc_id WHERE r.doc_id NOT GLOB 'mem_*'"
                .into(),
        ),
    ]
}

/// Posts that break a thread or reply link: (post id, what is wrong).
const BROKEN_LINKS: &str = "
    SELECT p.id, 'reply_to outside the channel or thread' FROM post p LEFT JOIN post q ON q.id = p.reply_to_id
    WHERE p.reply_to_id IS NOT NULL AND (q.id IS NULL OR q.channel_id != p.channel_id OR p.root_id IS NOT coalesce(q.root_id, q.id))
    UNION ALL
    SELECT p.id, 'root outside the channel or not a root' FROM post p LEFT JOIN post r ON r.id = p.root_id
    WHERE p.root_id IS NOT NULL AND (r.id IS NULL OR r.channel_id != p.channel_id OR r.root_id IS NOT NULL)
    UNION ALL
    SELECT p.id, 'same-channel v33 root lost' FROM post p JOIN post r ON r.id = json_extract(p.legacy, '$.root_message_id')
    WHERE r.id != p.id AND r.channel_id = p.channel_id AND p.reply_to_id IS NULL AND p.root_id IS NOT r.id
    UNION ALL
    SELECT q.id, 'answer is not a reply to its request' FROM post q JOIN post a ON a.id = q.answer_id
    WHERE a.reply_to_id IS NOT q.id OR a.channel_id != q.channel_id";

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

/// One v33 row per request (or cursor) compared to its new row, exactly.
#[derive(Debug, Serialize)]
pub struct RowCheck {
    pub ok: bool,
    pub rows_old: usize,
    pub rows_new: usize,
    pub identical: usize,
    pub mismatches: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct VerifyReport {
    pub ok: bool,
    pub classes: Vec<ClassCheck>,
    /// Every inline reply, byte for byte, against its answer post.
    pub answers: RowCheck,
    pub links: RowCheck,
    pub read_cursors: RowCheck,
    /// Ordered ids: every post's `ord` is a UUIDv7, a channel's posts in `ord` order never go back
    /// in time, and every read cursor's `last_ord` is its post's (or its instant's ceiling).
    pub ordering: RowCheck,
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

fn check_class(old: &Connection, new: &Connection, (class, old_sql, new_sql): &(&str, String, String)) -> Result<ClassCheck> {
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

type Rows = BTreeMap<String, String>;

fn rows(conn: &Connection, sql: &str) -> Result<Rows> {
    Ok(collect(conn.prepare(sql)?.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?)?.into_iter().collect())
}

/// Row-by-row equality of two id → value maps.
fn compare(old: &Rows, new: &Rows) -> RowCheck {
    let ids: BTreeSet<&String> = old.keys().chain(new.keys()).collect();
    let mismatches: Vec<String> = ids.into_iter().filter(|id| old.get(*id) != new.get(*id)).map(|id| id.to_string()).collect();
    let identical = old.iter().filter(|(id, v)| new.get(*id) == Some(v)).count();
    RowCheck { ok: mismatches.is_empty(), rows_old: old.len(), rows_new: new.len(), identical, mismatches }
}

/// The answer post's body compared as bytes (a BLOB cast), with its author, time and thread.
fn check_answers(old: &Connection, new: &Connection) -> Result<RowCheck> {
    let a = rows(
        old,
        "SELECT id, hex(CAST(reply_body AS BLOB)) || '|' || coalesce(to_buddy_id, 'owner') || '|' || replied_at FROM buddy_messages
         WHERE status = 'replied'",
    )?;
    let b = rows(
        new,
        "SELECT q.id, hex(CAST(a.body AS BLOB)) || '|' || coalesce(a.author_id, 'owner') || '|' || a.created_at
         FROM post q JOIN post a ON a.id = q.answer_id AND a.reply_to_id = q.id AND a.root_id IS coalesce(q.root_id, q.id)",
    )?;
    Ok(compare(&a, &b))
}

fn check_links(new: &Connection) -> Result<RowCheck> {
    let broken = rows(new, BROKEN_LINKS)?;
    let linked: usize =
        new.query_row("SELECT count(*) FROM post WHERE reply_to_id IS NOT NULL OR root_id IS NOT NULL", [], |r| r.get(0))?;
    Ok(RowCheck {
        ok: broken.is_empty(),
        rows_old: linked,
        rows_new: linked,
        identical: linked - broken.len(),
        mismatches: broken.into_iter().map(|(id, why)| format!("{id}: {why}")).collect(),
    })
}

fn check_ordering(new: &Connection) -> Result<RowCheck> {
    crate::import::register_ord_ceiling(new)?;
    let mut broken =
        rows(new, "SELECT id, 'ord is not a UUIDv7' FROM post WHERE ord NOT GLOB '????????-????-7???-[89ab]???-????????????'")?;
    broken.extend(rows(
        new,
        "SELECT id, 'reads before an older post of its channel' FROM (SELECT id, created_at,
           lag(created_at) OVER (PARTITION BY channel_id ORDER BY ord) AS previous FROM post) WHERE previous > created_at",
    )?);
    broken.extend(rows(
        new,
        &format!(
            "SELECT reader || '/' || channel_id, 'cursor ord disagrees with its post' FROM post_read WHERE last_ord != {}",
            CURSOR_ORD.replace("{post}", "last_post_id").replace("{at}", "last_post_at")
        ),
    )?);
    let checked: usize = new.query_row("SELECT (SELECT count(*) FROM post) + (SELECT count(*) FROM post_read)", [], |r| r.get(0))?;
    Ok(RowCheck {
        ok: broken.is_empty(),
        rows_old: checked,
        rows_new: checked,
        identical: checked - broken.len(),
        mismatches: broken.into_iter().map(|(id, why)| format!("{id}: {why}")).collect(),
    })
}

/// buddy_list_reads plus the owner's cursors from owner-channel-reads.json, which must read the
/// same now as at import (it is live server state).
fn check_reads(old: &Connection, new: &Connection, imported: &OwnerReads, direct: &DirectReads) -> Result<RowCheck> {
    let path = match imported {
        OwnerReads::Absent { path } | OwnerReads::Loaded { path, .. } => Path::new(path),
    };
    let now = load_owner_reads(path)?;
    let lists: Vec<String> = collect(old.prepare("SELECT id FROM buddy_lists")?.query_map([], |r| r.get(0))?)?;
    let mut a = rows(old, "SELECT buddy_id || '/' || list_id, last_post_id || '@' || last_post_created_at FROM buddy_list_reads")?;
    a.extend(now.cursors(&lists).into_iter().map(|(list, post, at)| (format!("owner/{list}"), format!("{post}@{at}"))));
    // Direct cursors are derived from the imported posts, which the classes above verify.
    match direct {
        DirectReads::NotMarked => {}
        DirectReads::Marked { .. } => {
            a.extend(rows(new, &format!("SELECT reader || '/' || channel_id, post_id || '@' || post_at FROM ({DIRECT_READ_CURSORS})"))?)
        }
    }
    let b = rows(new, "SELECT reader || '/' || channel_id, last_post_id || '@' || last_post_at FROM post_read")?;
    let mut check = compare(&a, &b);
    if &now != imported {
        check.ok = false;
        check.mismatches.push(format!("{}: changed since the import", path.display()));
    }
    Ok(check)
}

pub fn verify(
    source: &Path,
    target: &Path,
    soul_baseline: &[SoulFile],
    owner_reads: &OwnerReads,
    direct_reads: &DirectReads,
) -> Result<VerifyReport> {
    let old = open_source(source)?;
    let new = open_new(target)?;
    let classes = classes().iter().map(|c| check_class(&old, &new, c)).collect::<Result<Vec<_>>>()?;
    let answers = check_answers(&old, &new)?;
    let links = check_links(&new)?;
    let read_cursors = check_reads(&old, &new, owner_reads, direct_reads)?;
    let ordering = check_ordering(&new)?;
    let revision_chains = check_chains(&old, &new)?;
    let soul = check_soul(&new, soul_baseline)?;
    let ok = classes.iter().all(|c| c.ok) && answers.ok && links.ok && read_cursors.ok && ordering.ok && revision_chains.ok && soul.ok;
    Ok(VerifyReport { ok, classes, answers, links, read_cursors, ordering, revision_chains, soul })
}
