//! The watcher end to end: a real FSEvents + kqueue watch on a temp root, appends timed from the
//! write to the committed `Changes` event.

mod common;

use common::*;
use serde_json::json;
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};
use unleashd_ingest::model::{Format, Root};
use unleashd_ingest::watch::{self, IngestEvent};

fn user(text: &str) -> String {
    format!("{}\n", json!({ "type": "user", "timestamp": "2026-09-22T00:00:00.000Z", "cwd": "/w", "message": { "content": text } }))
}

/// Regression guard for the fixed 50 ms settle window (T12: append → onChange p50 68–74 ms, every
/// append waited the window out) and for FSEvents-only watching (~10–20 ms before the batch even
/// starts). A growing file is watched directly and a batch closes 2 ms after its last event, so the
/// median stays in single-digit milliseconds; the bound leaves room for a loaded machine.
#[test]
fn appends_reach_on_change_within_single_digit_ms() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("claude");
    let file = root.join("-w").join("s.jsonl");
    write(&file, &user("first"));
    let (tx, rx) = channel();
    let (handle, _) = watch::start(
        vec![Root { format: Format::Claude, path: root.to_string_lossy().into_owned() }],
        dir.path().join("ingest.sqlite"),
        move |e| {
            if let IngestEvent::Changes(c) = e
                && !c.session_ids.is_empty()
            {
                let _ = tx.send(Instant::now());
            }
        },
    )
    .unwrap();
    while rx.recv_timeout(Duration::from_millis(200)).is_ok() {} // the initial scan's commits
    let mut latencies = Vec::new();
    for n in 0..9 {
        let wrote = Instant::now();
        append(&file, &user(&format!("append {n}")));
        let seen = rx.recv_timeout(Duration::from_secs(5)).expect("append delivered");
        latencies.push(seen.duration_since(wrote));
        // Let the FSEvents copy of this write arrive and find the file unchanged.
        std::thread::sleep(Duration::from_millis(60));
        while rx.try_recv().is_ok() {}
    }
    handle.stop();
    latencies.sort();
    let median = latencies[latencies.len() / 2];
    eprintln!("append → onChange: {latencies:?}");
    assert!(median < Duration::from_millis(30), "append → onChange median {median:?} (all {latencies:?})");
}
