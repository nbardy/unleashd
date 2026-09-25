//! Regression guards for differences the parity run against the TS parsers found (2026-09-25)
//! and for the checkpoint-size decision.

mod common;

use common::*;
use serde_json::{Value, json};
use unleashd_ingest::model::Format;

fn codex_event(payload: Value) -> Value {
    json!({ "timestamp": "2026-09-10T07:00:00.000Z", "type": "event_msg", "payload": payload })
}

fn muse_event(us: u64, event: Value) -> Value {
    json!({ "stream": { "kind": "session", "id": "01a0-muse" }, "recorded_at": us, "payload_type": "runtime.session", "payload": { "kind": "run", "event": event } })
}

#[test]
fn a_raw_line_separator_inside_a_record_does_not_split_it() {
    // Node readline ends lines at U+2028/U+2029 too, so the TS Codex/Cursor/Muse parsers cut such
    // a record in two and dropped it as malformed (3 real sessions in the parity run).
    let dir = tempfile::tempdir().unwrap();
    let text = jsonl(&[
        codex_event(json!({ "type": "user_message", "message": "before\u{2028}after\u{2029}end" })),
        codex_event(json!({ "type": "agent_message", "message": "ok" })),
    ]);
    assert!(text.contains('\u{2028}'), "serde_json writes the separator raw, as Codex does");
    let path = dir.path().join("rollout-ls.jsonl");
    write(&path, &text);
    let (messages, _) = parse(Format::Codex, &path);
    assert_eq!(contents(&messages), ["before\u{2028}after\u{2029}end", "ok"]);
}

#[test]
fn muse_microsecond_times_truncate_to_the_js_millisecond() {
    // `new Date(us / 1000)` drops the fraction. Keeping it put every Muse time off by <1 ms and
    // reordered records within one millisecond (208 sessions in the parity run).
    let dir = tempfile::tempdir().unwrap();
    let text = jsonl(&[
        muse_event(1_000_000_900, json!({ "kind": "started", "prompt": "first" })),
        muse_event(1_000_000_100, json!({ "kind": "assistant_message_committed", "text": "same ms, later line" })),
    ]);
    let path = dir.path().join("01a0-muse").join("session.jsonl");
    write(&path, &text);
    let (messages, _) = parse(Format::Muse, &path);
    assert_eq!(contents(&messages), ["first", "same ms, later line"]);
    assert_eq!(messages[0].at, Some(1_000_000.0));
}

#[test]
fn checkpoints_stay_small_for_huge_prompts_and_replies() {
    // A checkpoint is rewritten on every append; it holds digests and a label prefix, not text
    // (the largest real ones were 0.5–1 MB before).
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("-w").join("s.jsonl");
    let huge = "x".repeat(1 << 20);
    let user = |text: &str| json!({ "type": "user", "timestamp": "2026-09-22T00:00:00.000Z", "cwd": "/w", "message": { "content": text } });
    write(&path, &jsonl(&[user(&huge), user(&format!("{huge}y"))]));
    let outcome = read(Format::Claude, &path, None);
    let size = serde_json::to_vec(outcome.checkpoint.as_ref().unwrap()).unwrap().len();
    assert!(size < 16 * 1024, "checkpoint is {size} bytes");
    assert_eq!(outcome.row.unwrap().label.chars().count(), 60);
}

#[test]
fn codex_call_id_digests_cost_about_eleven_bytes_each_in_the_checkpoint() {
    // The digest set was a JSON number array: 176 KB of the 934 MB rollout's 188 KB checkpoint,
    // re-decoded and re-encoded on every append (T13a). Guard: one base64 string, ~11 bytes/id.
    let dir = tempfile::tempdir().unwrap();
    let calls: Vec<Value> = (0..2000)
        .map(|i| {
            json!({ "timestamp": "2026-09-10T07:00:00.000Z", "type": "response_item",
                    "payload": { "type": "function_call", "name": "shell", "call_id": format!("call_{i:024}"), "arguments": "{}" } })
        })
        .collect();
    let path = dir.path().join("rollout-calls.jsonl");
    write(&path, &jsonl(&calls));
    let outcome = read(Format::Codex, &path, None);
    let size = serde_json::to_vec(outcome.checkpoint.as_ref().unwrap()).unwrap().len();
    assert!(size < 2000 * 12 + 4096, "checkpoint is {size} bytes for 2000 call ids");
    // It still dedupes after a round trip through the stored encoding.
    append(&path, &jsonl(&calls[..1]));
    let again = read(Format::Codex, &path, Some(&outcome));
    assert!(again.messages.is_empty(), "a repeated call id is shown once");
}
