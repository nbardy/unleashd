//! Tail-read edge cases: what the driver does when a file grows by a partial line, shrinks, is
//! replaced by another file, is rewritten in place, or grows by a line that changes history.

mod common;

use common::*;
use serde_json::json;
use unleashd_ingest::model::Format;
use unleashd_ingest::read::{Apply, FullReason, Taken};

fn user(text: &str) -> String {
    format!("{}\n", json!({ "type": "user", "timestamp": "2026-09-22T00:00:00.000Z", "cwd": "/w", "message": { "content": text } }))
}

#[test]
fn a_partial_last_line_is_left_for_the_next_read() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("-w").join("s.jsonl");
    let third = user("three");
    write(&path, &format!("{}{}{}", user("one"), user("two"), &third[..20]));
    let first = read(Format::Claude, &path, None);
    assert_eq!(contents(&first.messages), ["one", "two"]);
    let offset = first.checkpoint.as_ref().unwrap().offset;
    assert_eq!(offset as usize, user("one").len() + user("two").len(), "stops before the fragment");

    append(&path, &third[20..]);
    let second = read(Format::Claude, &path, Some(&first));
    assert_eq!(second.taken, Taken::Resumed);
    assert_eq!(contents(&second.messages), ["three"]);
    assert_eq!(second.messages[0].seq, 2);
}

#[test]
fn a_complete_record_without_its_newline_is_taken_once() {
    // Claude Code can be read between writing a record and writing its newline.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("-w").join("s.jsonl");
    let one = user("one");
    write(&path, one.trim_end());
    let first = read(Format::Claude, &path, None);
    assert_eq!(contents(&first.messages), ["one"]);
    append(&path, &format!("\n{}", user("two")));
    let second = read(Format::Claude, &path, Some(&first));
    assert_eq!(second.taken, Taken::Resumed);
    assert_eq!(contents(&second.messages), ["two"]);
}

#[test]
fn truncation_rereads_and_replaces_history() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("-w").join("s.jsonl");
    write(&path, &format!("{}{}", user("one"), user("two")));
    let first = read(Format::Claude, &path, None);
    write(&path, &user("new"));
    let second = read(Format::Claude, &path, Some(&first));
    assert_eq!(second.taken, Taken::Full(FullReason::Shrank));
    assert_eq!(second.apply, Apply::Replace);
    assert_eq!(contents(&second.messages), ["new"]);
}

#[test]
fn rotation_to_a_new_inode_rereads() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("-w").join("s.jsonl");
    write(&path, &user("old"));
    let first = read(Format::Claude, &path, None);
    std::fs::rename(&path, dir.path().join("rotated.jsonl")).unwrap();
    write(&path, &format!("{}{}", user("fresh"), user("more")));
    let second = read(Format::Claude, &path, Some(&first));
    assert_eq!(second.taken, Taken::Full(FullReason::Replaced));
    assert_eq!(contents(&second.messages), ["fresh", "more"]);
}

#[test]
fn an_in_place_rewrite_past_the_old_length_is_caught_by_the_fingerprint() {
    // Same inode, larger size: only the bytes before the old offset reveal the rewrite.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("-w").join("s.jsonl");
    write(&path, &user("aaaa"));
    let first = read(Format::Claude, &path, None);
    write(&path, &format!("{}{}", user("bbbb"), user("cccc")));
    let second = read(Format::Claude, &path, Some(&first));
    assert_eq!(second.taken, Taken::Full(FullReason::Rewritten));
    assert_eq!(contents(&second.messages), ["bbbb", "cccc"]);
}

/// Regression guard: an event message after shown response-item messages re-read the file from
/// byte 0 (`Rebuild::EventMode`, 1.7–3.5 s on the 891 MB rollout for one appended line). It must
/// resume: read only the appended bytes and withdraw what event mode never shows.
#[test]
fn codex_switch_to_event_mode_withdraws_without_a_reread() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rollout.jsonl");
    let row = |kind: &str, payload: serde_json::Value| {
        format!("{}\n", json!({ "timestamp": "2026-09-10T07:00:00.000Z", "type": kind, "payload": payload }))
    };
    write(
        &path,
        &row("response_item", json!({ "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "<bundle>" }] })),
    );
    append(&path, &row("response_item", json!({ "type": "function_call", "name": "shell", "call_id": "c1", "arguments": "{}" })));
    append(
        &path,
        &row("response_item", json!({ "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": "reply" }] })),
    );
    let first = read(Format::Codex, &path, None);
    assert_eq!(first.messages.len(), 3);
    let mut history = first.messages.clone();
    let size_before = std::fs::metadata(&path).unwrap().len();
    append(&path, &row("event_msg", json!({ "type": "user_message", "message": "the real prompt" })));
    let second = read(Format::Codex, &path, Some(&first));
    assert_eq!(second.taken, Taken::Resumed, "a mode switch must not re-read the file");
    assert_eq!(second.bytes_read, std::fs::metadata(&path).unwrap().len() - size_before);
    assert_eq!(second.apply, Apply::Withdraw(vec![0, 2]), "both response-item messages are withdrawn");
    apply(&mut history, &second);
    let (whole, whole_row) = parse(Format::Codex, &path);
    assert_eq!(history, whole, "withdraw + append equals a full read");
    assert_eq!(second.row, whole_row);
    assert_eq!(whole.iter().map(|m| (m.seq, m.content.as_str())).next_back(), Some((1, "the real prompt")));
    // Later appends resume in event mode.
    append(&path, &row("event_msg", json!({ "type": "agent_message", "message": "ok" })));
    let third = read(Format::Codex, &path, Some(&second));
    assert_eq!((third.taken, third.apply), (Taken::Resumed, Apply::Append));
    assert_eq!(contents(&third.messages), ["ok"]);
}

#[test]
fn an_unchanged_stamp_is_not_read() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("-w").join("s.jsonl");
    write(&path, &user("one"));
    let first = read(Format::Claude, &path, None);
    let again = read(Format::Claude, &path, Some(&first));
    assert_eq!(again.taken, Taken::Unchanged);
    assert!(again.messages.is_empty());
}
