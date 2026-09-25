#![allow(dead_code)]

use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use unleashd_ingest::model::{Format, Message};
use unleashd_ingest::paths::ProjectDirResolver;
use unleashd_ingest::read::{Apply, Outcome, RowData, read_source};

pub fn jsonl(rows: &[Value]) -> String {
    rows.iter().map(|r| format!("{r}\n")).collect()
}

pub fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

pub fn append(path: &Path, text: &str) {
    let mut f = std::fs::OpenOptions::new().append(true).open(path).unwrap();
    f.write_all(text.as_bytes()).unwrap();
}

pub fn read(format: Format, path: &Path, prior: Option<&Outcome>) -> Outcome {
    let resolver = ProjectDirResolver::default();
    let (stamp, checkpoint) = match prior {
        Some(o) => (Some(o.stamp), o.checkpoint.as_ref().map(|c| serde_json::from_slice(&serde_json::to_vec(c).unwrap()).unwrap())),
        None => (None, None),
    };
    read_source(format, path, &resolver, stamp, checkpoint).unwrap()
}

/// A full read of a file: its visible history and row.
pub fn parse(format: Format, path: &Path) -> (Vec<Message>, Option<RowData>) {
    let o = read(format, path, None);
    (o.messages, o.row)
}

pub fn contents(messages: &[Message]) -> Vec<&str> {
    messages.iter().map(|m| m.content.as_str()).collect()
}

/// The resume contract: for every line boundary k, reading lines [0, k) and then resuming over
/// the rest yields exactly what one full read of the whole file yields. Checkpoints go through
/// serde, as they do through the store.
pub fn assert_resume_equals_full(format: Format, dir: &Path, name: &str, text: &str) {
    let path: PathBuf = dir.join(name);
    write(&path, text);
    let (whole, _) = parse(format, &path);
    // Every proper prefix; the whole file would be an unchanged re-read.
    let boundaries: Vec<usize> = text.match_indices('\n').map(|(i, _)| i + 1).filter(|&k| k < text.len()).collect();
    for &k in &boundaries {
        write(&path, &text[..k]);
        let first = read(format, &path, None);
        let mut history = first.messages.clone();
        // Distinct mtime is not needed: the size moves.
        write(&path, text);
        let second = read(format, &path, Some(&first));
        apply(&mut history, &second);
        // Usage turns: appended in file order on a resume, all replaced on a full read.
        let mut turns = first.turns.clone();
        if second.apply == Apply::Replace {
            turns.clear();
        } else {
            assert_eq!(second.first_turn as usize, turns.len(), "{name}: turn numbering after byte {k}");
        }
        turns.extend(second.turns.clone());
        assert_eq!(turns, read(format, &path, None).turns, "{name}: usage turns after split at byte {k}");
        assert_eq!(contents(&history), contents(&whole), "{name}: split after byte {k}, taken {:?}", second.taken);
        assert_eq!(history, whole, "{name}: split after byte {k}");
        // Compared against a full read of the same final bytes (Cursor rows carry the file mtime).
        let (_, whole_row) = parse(format, &path);
        assert_eq!(second.row, whole_row, "{name}: row after split at byte {k}");
    }
}

/// What the store does with an outcome, on an in-memory history.
pub fn apply(history: &mut Vec<Message>, outcome: &Outcome) {
    match &outcome.apply {
        Apply::Append => {}
        Apply::Replace => history.clear(),
        Apply::Withdraw(seqs) => {
            history.retain(|m| seqs.binary_search(&m.seq).is_err());
            for m in history.iter_mut() {
                m.seq -= seqs.partition_point(|&s| s < m.seq) as u32;
            }
        }
    }
    history.extend(outcome.messages.clone());
}
