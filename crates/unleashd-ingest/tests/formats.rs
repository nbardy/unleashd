//! One golden test per provider format, ported from the server/test parser fixtures, plus the
//! resume contract (resume at any line boundary == one full read) over each fixture.

mod common;

use common::*;
use serde_json::{Value, json};
use unleashd_ingest::model::{Cwd, Format, Identity, Role, ToolCall, Usage};

fn codex_row(kind: &str, payload: Value) -> Value {
    json!({ "timestamp": "2026-09-10T07:00:00.000Z", "type": kind, "payload": payload })
}

fn codex_message(role: &str, text: &str) -> Value {
    codex_row("response_item", json!({ "type": "message", "role": role, "content": [{ "type": "input_text", "text": text }] }))
}

/// Port of server/test/codex-tool-history.test.ts.
fn codex_tool_history(with_events: bool) -> String {
    let tool = codex_row(
        "response_item",
        json!({ "type": "custom_tool_call", "name": "exec", "call_id": "exec-1", "input": "await tools.exec_command({cmd: \"pwd\"})" }),
    );
    let mut rows =
        vec![codex_row("session_meta", json!({ "id": "session", "cwd": "/work" })), codex_message("user", "Inspect the project")];
    if with_events {
        rows.push(codex_row("event_msg", json!({ "type": "user_message", "message": "Inspect the project" })));
    }
    rows.extend([
        codex_row(
            "response_item",
            json!({ "type": "function_call", "name": "exec_command", "call_id": "shell-1", "arguments": "{\"cmd\":\"pwd\"}" }),
        ),
        codex_row("response_item", json!({ "type": "function_call_output", "call_id": "shell-1", "output": "RAW TOOL OUTPUT" })),
        tool.clone(),
        // Duplicate delivery of one call is ignored; separate identical calls survive.
        tool.clone(),
        codex_row(
            "response_item",
            json!({ "type": "custom_tool_call", "name": "exec", "call_id": "exec-2", "input": "await tools.exec_command({cmd: \"pwd\"})" }),
        ),
        codex_row("response_item", json!({ "type": "function_call", "name": "get_inbox", "call_id": "inbox", "arguments": "{" })),
    ]);
    if with_events {
        rows.push(codex_row("event_msg", json!({ "type": "agent_message", "message": "Inspection complete" })));
    }
    rows.push(codex_message("assistant", "Inspection complete"));
    rows.push(codex_row("event_msg", json!({ "type": "task_complete", "turn_id": "turn-1" })));
    jsonl(&rows)
}

#[test]
fn codex_history_keeps_tool_calls_in_event_and_response_modes() {
    let dir = tempfile::tempdir().unwrap();
    for with_events in [true, false] {
        let path = dir.path().join(format!("rollout-2026-09-10T07-00-00-{with_events}.jsonl"));
        write(&path, &codex_tool_history(with_events));
        let (messages, row) = parse(Format::Codex, &path);
        assert_eq!(
            contents(&messages),
            ["Inspect the project", "⚡ shell pwd", "🔧 exec", "🔧 exec", "🔧 get_inbox", "Inspection complete"]
        );
        assert_eq!(messages[1].tool_call, Some(ToolCall { name: "exec_command".into(), input: Some("{\n  \"cmd\": \"pwd\"\n}".into()) }));
        assert_eq!(messages[4].tool_call.as_ref().unwrap().input.as_deref(), Some("{"), "unparseable arguments stay inspectable");
        let row = row.unwrap();
        assert_eq!(row.facts.session_id, "session");
        assert_eq!(row.facts.cwd, Cwd::Transcript { path: "/work".into() });
    }
}

#[test]
fn codex_resume_equals_full_read_including_the_event_mode_switch() {
    // With events the first prompt arrives twice: as a response item, then as an event. A resume
    // that already showed the response item must re-read (Rebuild::EventMode).
    let dir = tempfile::tempdir().unwrap();
    assert_resume_equals_full(Format::Codex, dir.path(), "events.jsonl", &codex_tool_history(true));
    assert_resume_equals_full(Format::Codex, dir.path(), "responses.jsonl", &codex_tool_history(false));
}

#[test]
fn codex_aborted_turns_become_sorted_notices_and_usage_is_the_last_total() {
    let dir = tempfile::tempdir().unwrap();
    let at = |t: &str, kind: &str, payload: Value| json!({ "timestamp": t, "type": kind, "payload": payload });
    let text = jsonl(&[
        at(
            "2026-09-10T07:00:00.000Z",
            "session_meta",
            json!({ "id": "s", "cwd": "/w", "source": { "subagent": { "thread_spawn": { "parent_thread_id": "parent-1" } } } }),
        ),
        at("2026-09-10T07:00:01.000Z", "event_msg", json!({ "type": "task_started", "turn_id": "t1" })),
        at("2026-09-10T07:00:02.000Z", "event_msg", json!({ "type": "user_message", "message": "go" })),
        at(
            "2026-09-10T07:00:03.000Z",
            "event_msg",
            json!({ "type": "token_count", "info": { "total_token_usage": { "input_tokens": 100, "cached_input_tokens": 60, "output_tokens": 7 } } }),
        ),
        at("2026-09-10T07:00:05.000Z", "event_msg", json!({ "type": "agent_message", "message": "working" })),
        // Logged after the prompt and the reply but completed (epoch seconds, 07:00:01) before
        // both: it sorts first. (A reply sorts by its start, the time of the message before it.)
        at(
            "2026-09-10T07:00:06.000Z",
            "event_msg",
            json!({ "type": "turn_aborted", "turn_id": "t1", "reason": "interrupted", "completed_at": 1789023601 }),
        ),
        at(
            "2026-09-10T07:00:07.000Z",
            "event_msg",
            json!({ "type": "token_count", "info": { "total_token_usage": { "input_tokens": 300, "cached_input_tokens": 200, "output_tokens": 9 } } }),
        ),
        at("2026-09-10T07:00:08.000Z", "event_msg", json!({ "type": "user_message", "message": "again" })),
    ]);
    let path = dir.path().join("rollout-x.jsonl");
    write(&path, &text);
    let (messages, row) = parse(Format::Codex, &path);
    assert_eq!(contents(&messages), ["Turn interrupted.", "go", "working", "again"]);
    assert_eq!(messages[0].role, Role::System);
    let row = row.unwrap();
    assert_eq!(row.facts.usage, Some(Usage { input: 100.0, output: 9.0, cache_read: 200.0, cache_write: 0.0 }));
    assert_eq!(row.facts.parent_session_id.as_deref(), Some("parent-1"));
    assert_resume_equals_full(Format::Codex, dir.path(), "rollout-y.jsonl", &text);
}

fn claude_user(text: &str, t: &str) -> Value {
    json!({ "type": "user", "timestamp": t, "cwd": "/tmp/work", "message": { "role": "user", "content": text } })
}

fn claude_assistant(id: &str, blocks: Value, t: &str) -> Value {
    let usage = json!({ "input_tokens": 10, "output_tokens": 200, "cache_read_input_tokens": 40000, "cache_creation_input_tokens": 3000 });
    json!({ "type": "assistant", "timestamp": t, "message": { "id": id, "model": "claude-opus-5-5", "usage": usage, "content": blocks } })
}

/// Ports of jsonl-title.test.ts and claude-usage-dedup.test.ts, plus receipts and reply timing.
#[test]
fn claude_titles_usage_receipts_and_reply_times() {
    let dir = tempfile::tempdir().unwrap();
    let receipt = json!({ "buddyWorkerThread": { "conversationId": "c1", "buddyId": "b1", "label": "Fix it" } });
    let text = jsonl(&[
        claude_user("hello", "2026-09-22T00:00:00.000Z"),
        json!({ "type": "ai-title", "aiTitle": "Auto label" }),
        claude_assistant("msg_a", json!([{ "type": "thinking", "thinking": "..." }]), "2026-09-22T00:00:01.000Z"),
        claude_assistant("msg_a", json!([{ "type": "text", "text": "Reading" }]), "2026-09-22T00:00:02.000Z"),
        claude_assistant(
            "msg_a",
            json!([{ "type": "tool_use", "id": "tu1", "name": "Read", "input": { "file_path": "/a.rs" } }]),
            "2026-09-22T00:00:03.000Z",
        ),
        json!({ "type": "user", "timestamp": "2026-09-22T00:00:04.000Z", "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "tu1", "content": receipt.to_string() }] } }),
        json!({ "type": "custom-title", "customTitle": "My demo thread" }),
        json!({ "type": "ai-title", "aiTitle": "Auto label v2" }),
        claude_assistant("msg_b", json!([{ "type": "text", "text": "Done" }]), "2026-09-22T00:00:05.000Z"),
    ]);
    let path = dir.path().join("-tmp-work").join("abc.jsonl");
    write(&path, &text);
    let (messages, row) = parse(Format::Claude, &path);
    assert_eq!(contents(&messages)[..3], ["hello", "Reading", "📖 Read /a.rs"]);
    assert!(messages[3].content.starts_with("<!--buddy_worker_thread:"));
    assert_eq!(messages[4].content, "Done");
    // A reply starts when the message before it did; its completion is its own line's time.
    assert_eq!(messages[1].at, messages[0].at);
    assert_eq!(messages[1].completed_at, Some(unleashd_ingest::parsers::parse_iso("2026-09-22T00:00:02.000Z").unwrap()));
    let row = row.unwrap();
    assert_eq!(row.facts.title.as_deref(), Some("My demo thread"), "custom-title wins, last observation wins");
    // Three content-block lines of msg_a carry one request's usage: counted once.
    assert_eq!(row.facts.usage, Some(Usage { input: 20.0, output: 400.0, cache_read: 80000.0, cache_write: 6000.0 }));
    assert_eq!(row.facts.session_id, "abc");
    assert_resume_equals_full(Format::Claude, dir.path(), "resume.jsonl", &text);
}

#[test]
fn claude_without_cwd_falls_back_to_the_project_directory_name_as_a_guess() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("-nowhere-that-exists").join("s.jsonl");
    write(&path, &jsonl(&[json!({ "type": "user", "timestamp": "2026-09-22T00:00:00.000Z", "message": { "content": "hi" } })]));
    let (_, row) = parse(Format::Claude, &path);
    assert_eq!(row.unwrap().facts.cwd, Cwd::Decoded { path: "/nowhere/that/exists".into() });
}

#[test]
fn buddy_and_oompa_markers_are_stripped_and_become_identity() {
    use base64::Engine;
    let dir = tempfile::tempdir().unwrap();
    let context = r#"{"buddyId":"b7","workspaceId":"w1"}"#;
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(context);
    let briefing = "You are Buddy b7.";
    let envelope =
        format!("<!-- unleashd:buddy-context-v2 {b64} {} -->\n{briefing}\n<!-- /unleashd:buddy-context-v2 -->\n\nShip it", briefing.len());
    let path = dir.path().join("-w").join("buddy.jsonl");
    write(&path, &jsonl(&[claude_user(&envelope, "2026-09-22T00:00:00.000Z")]));
    let (messages, row) = parse(Format::Claude, &path);
    assert_eq!(contents(&messages), ["Ship it"]);
    assert!(matches!(row.unwrap().identity, Identity::Buddy { ref buddy_id, .. } if buddy_id == "b7"));

    let path = dir.path().join("-w").join("worker.jsonl");
    write(
        &path,
        &jsonl(&[claude_user("[oompa:swarm-1:w3] Review this. VERDICT: APPROVED or VERDICT: NEEDS_CHANGES", "2026-09-22T00:00:00.000Z")]),
    );
    let (messages, row) = parse(Format::Claude, &path);
    assert!(messages[0].content.starts_with("Review this."));
    assert!(matches!(row.unwrap().identity, Identity::Worker { ref swarm_id, .. } if swarm_id.as_deref() == Some("swarm-1")));
}

#[test]
fn cursor_messages_have_no_invented_times() {
    let dir = tempfile::tempdir().unwrap();
    let text = jsonl(&[
        json!({ "role": "user", "message": { "content": [{ "type": "text", "text": "<timestamp>2026-09-01T10:00:00Z</timestamp> fix the bug" }] } }),
        json!({ "role": "assistant", "message": { "content": [{ "type": "text", "text": "On it" }, { "type": "tool_use", "name": "Grep", "input": { "pattern": "bug" } }] } }),
        json!({ "type": "turn_ended", "status": "success" }),
        json!({ "role": "assistant", "message": { "content": [{ "type": "text", "text": "On it" }, { "type": "tool_use", "name": "Grep", "input": { "pattern": "bug" } }] } }),
    ]);
    let path = dir.path().join("Users-nobody-proj").join("agent-transcripts").join("sid").join("sid.jsonl");
    write(&path, &text);
    let (messages, row) = parse(Format::Cursor, &path);
    assert_eq!(contents(&messages), ["<timestamp>2026-09-01T10:00:00Z</timestamp> fix the bug", "On it\n🔍 Grep bug"]);
    assert!(messages.iter().all(|m| m.at.is_none()));
    let row = row.unwrap();
    assert_eq!(row.created_at, unleashd_ingest::parsers::parse_iso("2026-09-01T10:00:00Z").unwrap());
    assert_eq!(row.facts.cwd, Cwd::Decoded { path: "/Users/nobody/proj".into() });
    assert_resume_equals_full(Format::Cursor, dir.path(), "resume.jsonl", &text);
}

fn muse_event(us: u64, event: Value) -> Value {
    json!({ "stream": { "kind": "session", "id": "01a0-muse" }, "recorded_at": us, "payload_type": "runtime.session", "payload": { "kind": "run", "event": event } })
}

#[test]
fn muse_sorts_by_record_time_and_reads_durable_identity() {
    let dir = tempfile::tempdir().unwrap();
    let text = jsonl(&[
        json!({ "recorded_at": 1_000_000u64, "payload_type": "runtime.session.route_facts", "payload": { "record": { "cwd": "/m" } } }),
        json!({ "recorded_at": 1_000_000u64, "payload_type": "run.model.configured", "payload": { "record": { "model_id": "muse-spark-1.3" } } }),
        muse_event(2_000_000, json!({ "kind": "started", "prompt": "  hi  " })),
        muse_event(4_000_000, json!({ "kind": "assistant_message_committed", "text": "second" })),
        // Recorded earlier than the line before it: sorted before it.
        muse_event(
            3_000_000,
            json!({ "kind": "assistant_tool_calls_committed", "tool_calls": [{ "name": "Read", "args": "{\"file_path\":\"/x\"}" }] }),
        ),
        json!({ "recorded_at": 5_000_000u64, "payload_type": "record.creation", "payload": { "record": { "kind": { "kind": "buddy_builder" } } } }),
        json!({ "retained_marker": "omitted_live_only" }),
    ]);
    let path = dir.path().join("01a0-muse").join("session.jsonl");
    write(&path, &text);
    let (messages, row) = parse(Format::Muse, &path);
    assert_eq!(contents(&messages), ["hi", "📖 Read /x", "second"]);
    let row = row.unwrap();
    assert_eq!(row.facts.model.as_deref(), Some("muse-spark-1.3"));
    assert_eq!(row.identity, Identity::Builder);
    assert_eq!(row.facts.cwd, Cwd::Transcript { path: "/m".into() });
    assert_eq!(row.facts.session_id, "01a0-muse");
    assert_resume_equals_full(Format::Muse, dir.path(), "resume.jsonl", &text);
}

#[test]
fn gemini_document_with_tool_calls_and_sub_agents() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("hash1");
    write(&project.join(".project_root"), "/g/project\n");
    let doc = json!({
        "sessionId": "gem-1",
        "startTime": "2026-09-01T00:00:00.000Z",
        "lastUpdated": "2026-09-01T00:05:00.000Z",
        "messages": [
            { "type": "user", "content": [{ "text": "find " }, { "text": "it" }] },
            { "type": "gemini", "content": "Looking", "model": "gemini-3-pro", "toolCalls": [
                { "id": "c1", "name": "codebase_investigator", "args": { "objective": "map it" } },
                { "name": "read_file", "args": { "file_path": "/g/a" } }
            ] }
        ]
    });
    let path = project.join("chats").join("session-2026-gem1.json");
    write(&path, &doc.to_string());
    let (messages, row) = parse(Format::Gemini, &path);
    assert_eq!(contents(&messages), ["find it", "Looking\n🔧 codebase_investigator\n📖 read_file /g/a"]);
    let row = row.unwrap();
    assert_eq!(row.facts.cwd, Cwd::Transcript { path: "/g/project".into() });
    assert_eq!(row.facts.sub_agents.len(), 1);
    assert_eq!(row.facts.sub_agents[0].description, "[Codebase Investigator Agent] map it");
    assert_eq!(row.facts.sub_agents[0].tool_uses, 1);
}

#[test]
fn opencode_session_directory_with_parts_metadata_and_usage() {
    let dir = tempfile::tempdir().unwrap();
    let storage = dir.path().join("storage");
    let session = storage.join("message").join("ses_1");
    write(&session.join("msg_1.json"), &json!({ "id": "msg_1", "sessionID": "ses_1", "role": "user", "time": { "created": 1000 }, "model": { "providerID": "opencode", "modelID": "big-pickle" } }).to_string());
    write(&session.join("msg_2.json"), &json!({ "id": "msg_2", "sessionID": "ses_1", "role": "assistant", "time": { "created": 2000 }, "providerID": "opencode", "modelID": "big-pickle", "tokens": { "input": 5, "output": 6, "cache": { "read": 7, "write": 8 } } }).to_string());
    write(&storage.join("part").join("msg_1").join("p1.json"), &json!({ "type": "text", "text": "\"quoted prompt\"" }).to_string());
    write(
        &storage.join("part").join("msg_2").join("p1.json"),
        &json!({ "type": "text", "text": "Patched", "time": { "start": 1 } }).to_string(),
    );
    write(
        &storage.join("part").join("msg_2").join("p2.json"),
        &json!({ "type": "patch", "files": ["a", "b"], "time": { "start": 2 } }).to_string(),
    );
    write(
        &storage.join("session").join("proj").join("ses_1.json"),
        &json!({ "directory": "/oc/dir", "time": { "created": 500, "updated": 2500 } }).to_string(),
    );
    let (messages, row) = parse(Format::Opencode, &session);
    assert_eq!(contents(&messages), ["quoted prompt", "Patched\n[Patch: 2 files]"]);
    let row = row.unwrap();
    assert_eq!(row.facts.cwd, Cwd::Transcript { path: "/oc/dir".into() });
    assert_eq!(row.facts.model.as_deref(), Some("opencode/big-pickle"));
    assert_eq!((row.created_at, row.activity_at), (500.0, 2500.0));
    assert_eq!(row.facts.usage, Some(Usage { input: 5.0, output: 6.0, cache_read: 7.0, cache_write: 8.0 }));
}
