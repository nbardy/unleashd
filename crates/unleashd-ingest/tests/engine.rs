//! The engine end to end on a temp root: scan, append, delete, restart. Plus the query-plan
//! guard: every read the store serves must use an index (no full-table SCAN).

mod common;

use common::*;
use serde_json::json;
use std::path::Path;
use unleashd_ingest::engine::Engine;
use unleashd_ingest::model::{Format, Root};
use unleashd_ingest::store::{Committed, Reader};

fn user(text: &str) -> String {
    format!("{}\n", json!({ "type": "user", "timestamp": "2026-09-22T00:00:00.000Z", "cwd": "/w", "message": { "content": text } }))
}

fn roots(base: &Path) -> Vec<Root> {
    vec![Root { format: Format::Claude, path: base.join("claude").to_string_lossy().into_owned() }]
}

#[test]
fn scan_append_delete_and_warm_restart() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("claude/-w/a.jsonl");
    let b = dir.path().join("claude/-w/b.jsonl");
    write(&a, &format!("{}{}", user("a1"), user("a2")));
    write(&b, &user("b1"));
    let db = dir.path().join("ingest.sqlite");
    let mut commits: Vec<Committed> = Vec::new();

    let mut engine = Engine::open(roots(dir.path()), &db).unwrap();
    let report = engine.scan(&mut |c| commits.push(c.clone()));
    assert_eq!((report.full, report.messages_written), (2, 3));
    let reader = Reader::open(&db).unwrap();
    let (rev, rows, _) = reader.list_sessions(0).unwrap();
    assert_eq!(rows.len(), 2);

    // Append: only the new message is written, with the next seq.
    append(&a, &user("a3"));
    let report = engine.changed([a.clone()].into(), &mut |c| commits.push(c.clone()));
    assert_eq!((report.resumed, report.messages_written), (1, 1));
    assert_eq!(commits.last().unwrap().session_ids, ["a"]);
    let (rev2, changed, _) = reader.list_sessions(rev).unwrap();
    assert_eq!(changed.iter().map(|r| (r.session_id.as_str(), r.message_count)).collect::<Vec<_>>(), [("a", 3)]);
    let tail = reader.messages("a", 1, 10).unwrap();
    assert_eq!(contents(&tail), ["a3"]);
    assert_eq!(tail[0].seq, 2);

    // Delete: a tombstone pages out through `since`.
    std::fs::remove_file(&b).unwrap();
    engine.changed([b.clone()].into(), &mut |c| commits.push(c.clone()));
    let (_, _, removed) = reader.list_sessions(rev2).unwrap();
    assert_eq!(removed.iter().map(|r| r.session_id.as_str()).collect::<Vec<_>>(), ["b"]);
    assert!(reader.session("b").unwrap().is_none());
    drop(engine);

    // Warm restart: the store is reopened, every source is unchanged, nothing is parsed.
    let mut engine = Engine::open(roots(dir.path()), &db).unwrap();
    let report = engine.scan(&mut |_| panic!("an unchanged restart commits nothing"));
    assert_eq!((report.unchanged, report.full, report.resumed, report.messages_written), (1, 0, 0, 0));

    // And a restart after an append resumes from the stored checkpoint.
    drop(engine);
    append(&a, &user("a4"));
    let mut engine = Engine::open(roots(dir.path()), &db).unwrap();
    let report = engine.scan(&mut |_| {});
    assert_eq!((report.resumed, report.full, report.messages_written), (1, 0, 1));
}

#[test]
fn every_store_read_uses_an_index() {
    let dir = tempfile::tempdir().unwrap();
    write(&dir.path().join("claude/-w/a.jsonl"), &user("a1"));
    let db = dir.path().join("ingest.sqlite");
    Engine::open(roots(dir.path()), &db).unwrap().scan(&mut |_| {});
    let reader = Reader::open(&db).unwrap();
    for (query, plan) in reader.plans().unwrap() {
        for line in plan {
            // `SCAN t USING INDEX` / `USING COVERING INDEX` walks an index; a bare `SCAN t` reads
            // the whole table.
            let full_scan = line.starts_with("SCAN ") && !line.contains("USING");
            assert!(!full_scan, "full table scan in {query}: {line}");
        }
    }
}
