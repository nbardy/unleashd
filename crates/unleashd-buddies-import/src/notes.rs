//! v33 note rows → agent_notes Markdown. Notes are not docs in the lean store: a Buddy keeps
//! detailed notes as `agent_notes/*.md` files like every other agent, and the importer skips
//! `buddy_knowledge` rows of kind `note`. This carries the existing ones across, one file per
//! Buddy per UTC day, under `<workspace root>/agent_notes/buddy-notes/<buddy>/<date>.md`.
//! (1,081 notes on the 2026-09-26 copy; one file each would have put 519 files in one repo.)
//!
//! The memory fold (import.rs `memory_copies`) imports one soul/working/long_term doc per Buddy;
//! every other copy is archived here, one `memory-archive.md` per Buddy, oldest first.

use crate::import::{memory_copies, open_source};
use rusqlite::params;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use unleashd_buddies::error::{CoreError, Result};

/// A v33 note body. Reviewer and Buddy tools stored `{topic, body, evidence}` JSON; an owner
/// edit through the Memory panel stored the text as typed.
#[derive(Debug)]
enum NoteBody {
    Structured(StructuredNote),
    Plain(String),
}

#[derive(Debug, Deserialize)]
struct StructuredNote {
    topic: Option<String>,
    body: String,
    #[serde(default)]
    evidence: Vec<serde_json::Value>,
}

impl NoteBody {
    fn parse(content: &str) -> NoteBody {
        match serde_json::from_str::<StructuredNote>(content) {
            Ok(note) => NoteBody::Structured(note),
            Err(_) => NoteBody::Plain(content.to_string()),
        }
    }

    fn render(&self, time: &str, scope: &str) -> String {
        match self {
            NoteBody::Structured(note) => {
                let topic = note.topic.as_deref().unwrap_or("note");
                let evidence = if note.evidence.is_empty() {
                    String::new()
                } else {
                    format!("\n\nEvidence: `{}`", serde_json::Value::Array(note.evidence.clone()))
                };
                format!("## {time} — {topic}\n_{scope}_\n\n{}{evidence}\n", note.body.trim())
            }
            NoteBody::Plain(text) => format!("## {time}\n_{scope}_\n\n{}\n", text.trim()),
        }
    }
}

/// One output file and the sections (notes or archived memory copies) in it, oldest first.
#[derive(Debug)]
pub struct NoteFile {
    pub path: PathBuf,
    pub buddy_id: String,
    pub sections: usize,
    pub text: String,
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

/// Groups every note row into its file.
pub fn plan(source: &Path) -> Result<Vec<NoteFile>> {
    let conn = open_source(source)?;
    let mut stmt = conn.prepare(
        "SELECT w.root_path, b.id, b.name, k.scope_kind, k.scope_id, k.updated_at, k.content
         FROM buddy_knowledge k JOIN buddies b ON b.id = k.buddy_id JOIN projects w ON w.id = k.workspace_id
         WHERE k.kind = ?1 ORDER BY w.root_path, b.name, k.updated_at, k.id",
    )?;
    let rows = stmt.query_map(params!["note"], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, String>(6)?,
        ))
    })?;
    let mut owners: BTreeMap<PathBuf, String> = BTreeMap::new();
    let mut files: Files = BTreeMap::new();
    for row in rows {
        let (root, buddy_id, name, scope_kind, scope_id, updated_at, content) = row?;
        let folder = buddy_folder(&mut owners, &root, &buddy_id, &name)?;
        let (date, time) = (&updated_at[..10], &updated_at[11..16]);
        let section = NoteBody::parse(&content).render(&format!("{time}Z"), &format!("{scope_kind} {scope_id}"));
        files
            .entry(folder.join(format!("{date}.md")))
            .or_insert_with(|| (buddy_id, format!("# {name} notes, {date}\n\nExported from the Buddies note store.\n"), Vec::new()))
            .2
            .push(section);
    }
    Ok(into_files(files))
}

type Files = BTreeMap<PathBuf, (String, String, Vec<String>)>;

fn into_files(files: Files) -> Vec<NoteFile> {
    files
        .into_iter()
        .map(|(path, (buddy_id, header, sections))| NoteFile {
            path,
            buddy_id,
            sections: sections.len(),
            text: format!("{header}\n{}", sections.join("\n")),
        })
        .collect()
}

/// A Buddy's folder under its workspace. Two Buddies with the same name slug in one workspace
/// would share a folder, so that is an error rather than a merge.
fn buddy_folder(owners: &mut BTreeMap<PathBuf, String>, root: &str, buddy_id: &str, name: &str) -> Result<PathBuf> {
    let folder = Path::new(root).join("agent_notes/buddy-notes").join(slug(name));
    match owners.insert(folder.clone(), buddy_id.to_string()) {
        Some(other) if other != buddy_id => {
            Err(CoreError::Invalid(format!("buddies {other} and {buddy_id} both export to {}", folder.display())))
        }
        _ => Ok(folder),
    }
}

/// Every memory copy the fold did not import (rank > 1), one `memory-archive.md` per Buddy in
/// its home workspace, oldest first. The verifier counts these sections per Buddy.
pub fn archive_plan(source: &Path) -> Result<Vec<NoteFile>> {
    let conn = open_source(source)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT w.root_path, b.id, b.name, c.scope_kind, c.scope_id, c.kind, c.revision, c.updated_at, c.source, c.source_id, c.content
         FROM ({}) c JOIN buddies b ON b.id = c.buddy_id JOIN projects w ON w.id = b.project_id
         WHERE c.rank > 1 ORDER BY w.root_path, b.name, c.updated_at, c.source_id",
        memory_copies("")
    ))?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, i64>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, String>(8)?,
            r.get::<_, String>(9)?,
            r.get::<_, String>(10)?,
        ))
    })?;
    let mut owners: BTreeMap<PathBuf, String> = BTreeMap::new();
    let mut files: Files = BTreeMap::new();
    for row in rows {
        let (root, buddy_id, name, scope_kind, scope_id, kind, revision, updated_at, source, source_id, content) = row?;
        let folder = buddy_folder(&mut owners, &root, &buddy_id, &name)?;
        let section = format!(
            "## {updated_at} — {kind} ({scope_kind} {scope_id})\n_revision {revision}, {source} {source_id}_\n\n{}\n",
            content.trim()
        );
        files
            .entry(folder.join("memory-archive.md"))
            .or_insert_with(|| {
                let header = format!(
                    "# {name} memory archive\n\nMemory copies superseded when the Buddy's memory folded to one doc per kind \
                     (the newest copy was kept). Oldest first.\n"
                );
                (buddy_id, header, Vec::new())
            })
            .2
            .push(section);
    }
    Ok(into_files(files))
}

/// Writes every planned file. Refuses before writing anything if one already exists, so a
/// rerun never overwrites a note a Buddy has since edited.
pub fn write(files: &[NoteFile]) -> Result<()> {
    if let Some(existing) = files.iter().find(|f| f.path.exists()) {
        return Err(CoreError::Invalid(format!("{} already exists", existing.path.display())));
    }
    for file in files {
        std::fs::create_dir_all(file.path.parent().expect("a note file has a folder"))?;
        std::fs::write(&file.path, &file.text)?;
    }
    Ok(())
}
