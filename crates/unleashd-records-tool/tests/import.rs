//! The zero-loss records importer and verifier on a fixture holding every kind of bad file
//! (moved from unleashd-ingest/tests/records.rs with the importer, S12).

use rusqlite::Connection;
use serde_json::{Value, json};
use std::path::Path;
use unleashd_ingest::records::*;
use unleashd_records_tool::{RejectReason, encode_id, import, verify};

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn pretty(v: &Value) -> String {
    format!("{}\n", serde_json::to_string_pretty(v).unwrap())
}

fn record_json(id: &str, sessions: &[&str]) -> Value {
    json!({
        "version": 2,
        "conversationId": id,
        "kind": { "t": "chat" },
        "sessionBindings": sessions.iter().map(|s| json!({ "provider": "claude", "sessionId": s })).collect::<Vec<_>>(),
        "status": "active",
        "done": false,
        "config": { "provider": "claude", "model": { "mode": "default" }, "reasoning": { "mode": "default" } },
        "recordRevision": 0,
        "configRevision": 0,
        "provenance": "external_discovered",
        "createdAt": "2026-08-01T00:00:00.000Z",
        "updatedAt": "2026-08-01T00:00:00.000Z"
    })
}

fn put_record(root: &Path, id: &str, v: &Value) {
    write(&root.join("by-conversation").join(format!("{}.json", encode_id(id))), &pretty(v));
}

fn put_index(root: &Path, provider: &str, session: &str, id: &str) {
    write(
        &root.join("by-session").join(provider).join(format!("{}.json", encode_id(session))),
        &pretty(&json!({ "version": 1, "conversationId": id })),
    );
}

#[test]
fn import_keeps_every_file_and_verify_proves_it_by_hash() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("v1");

    // A full Buddy record: nullish fields both null and absent, a branch with launches, usage.
    let mut buddy = record_json("buddy-1", &["s-old"]);
    buddy["currentSession"] = json!({ "provider": "claude", "sessionId": "s-cur", "buddyAudienceKey": "aud",
        "latestUsage": { "contextTokens": 5, "outputTokens": 1, "cachedInputTokens": 0, "observedAt": "2026-09-01T00:00:00.123Z" } });
    buddy["provenance"] = json!("user");
    buddy["workingDirectory"] = json!("/w");
    buddy["lastResolvedConfig"] = json!({ "provider": "claude", "modelId": "opus", "reasoningEffort": "high" });
    buddy["creation"] = json!({
        "commandId": "cmd", "fingerprint": "fp",
        "branch": { "sourceConversationId": "src", "throughMessageId": "m1", "audience": { "kind": "project", "projectId": "p" },
                    "handoff": "h", "launches": { "zz": "later", "aa": "earlier" } }
    });
    buddy["kind"] = json!({ "t": "buddy", "visibility": "background",
        "context": { "buddyId": "b1", "workspaceId": "w1", "buddyProjectId": null, "automationRunId": "run",
                     "knowledgeScope": { "kind": "owner_thread", "conversationId": "o" }, "allowedBuddyOperations": ["buddy.post"] } });
    put_record(&root, "buddy-1", &buddy);
    put_index(&root, "claude", "s-old", "buddy-1");
    put_index(&root, "claude", "s-cur", "buddy-1");

    // A worker: nullable ids stay null, not absent.
    let mut worker = record_json("worker-1", &[]);
    worker["kind"] = json!({ "t": "worker", "swarmId": "sw", "workerId": null, "role": null });
    put_record(&root, "worker-1", &worker);

    // A legacy file without status / done / recordRevision.
    let mut legacy = record_json("legacy-1", &["s-leg"]);
    for key in ["status", "done", "recordRevision"] {
        legacy.as_object_mut().unwrap().remove(key);
    }
    put_record(&root, "legacy-1", &legacy);

    // Bad files, one of each kind.
    write(&root.join("by-conversation").join(format!("{}.json", encode_id("torn"))), "{\"version\": 2, \"conversa");
    let mut unknown_key = record_json("extra-1", &[]);
    unknown_key["surprise"] = json!(true);
    put_record(&root, "extra-1", &unknown_key);
    let mut empty_session = record_json("empty-1", &[""]);
    empty_session["sessionBindings"][0]["sessionId"] = json!("");
    put_record(&root, "empty-1", &empty_session);
    let mut future = record_json("future-1", &[]);
    future["version"] = json!(3);
    put_record(&root, "future-1", &future);
    write(&root.join("by-conversation").join("copy-of-legacy.json"), &pretty(&record_json("legacy-1", &[])));
    write(&root.join("by-conversation").join(".abc.json.123.uuid.tmp"), "{");
    write(&root.join("quarantine").join("old-2026-08-01T00-00-00.000Z.json"), "not json");
    put_index(&root, "claude", "s-gone", "no-such-conversation");
    put_index(&root, "claude", "s-leg-not-bound", "legacy-1");
    write(&root.join("by-session").join("claude").join(".x.json.1.tmp"), "{}");

    let db = dir.path().join("records.sqlite");
    let report = import(&root, &db).unwrap();
    assert_eq!((report.record_files, report.imported), (9, 3));
    let reasons: Vec<RejectReason> = report.rejected.iter().map(|r| r.reason).collect();
    for expected in [
        RejectReason::CorruptJson,
        RejectReason::InvalidRecord,
        RejectReason::FutureVersion,
        RejectReason::DuplicateId,
        RejectReason::NotARecordFile,
        RejectReason::Quarantined,
        RejectReason::OrphanSessionIndex,
        RejectReason::StaleSessionIndex,
        RejectReason::CorruptSessionIndex,
    ] {
        assert!(reasons.contains(&expected), "{expected:?} missing from {reasons:?}");
    }
    assert_eq!(reasons.iter().filter(|r| **r == RejectReason::InvalidRecord).count(), 2, "unknown key and empty sessionId");
    assert_eq!(report.misnamed.len(), 0, "the duplicate is rejected before its name is checked");
    assert_eq!(report.defaulted.values().sum::<usize>(), 3);
    assert_eq!(report.session_index.unindexed_bindings, 1, "legacy-1's s-leg had no by-session file");

    // Canonical values came through: defaults applied, the kind derived, nullish kept distinct.
    let records = Records::open(&db).unwrap();
    let legacy = records.get("legacy-1").unwrap().unwrap();
    assert_eq!((legacy.status, legacy.done, legacy.record_revision), (RecordStatus::Active, false, 0));
    let summaries = records.list_summaries().unwrap();
    let b = summaries.iter().find(|s| s.conversation_id == "buddy-1").unwrap();
    let ConversationKind::Buddy { context: ctx, visibility } = &b.kind else { panic!("buddy-1 kind {:?}", b.kind) };
    assert_eq!(*visibility, BuddyVisibility::Background);
    assert_eq!(b.sessions.len(), 2);
    assert_eq!((ctx.buddy_project_id.clone(), ctx.legacy_work_item_id.clone()), (Some(None), None));
    drop(records);

    let checked = verify(&root, &db).unwrap();
    assert!(checked.ok, "{checked:#?}");
    assert_eq!((checked.records_compared, checked.record_hash_matches), (3, 3));
    assert_eq!(checked.rejects_compared, report.rejected.len());

    // The verifier is not vacuous: change one stored field and it fails on that record.
    Connection::open(&db)
        .unwrap()
        .execute("UPDATE conversation_record SET working_directory = '/elsewhere' WHERE conversation_id = 'buddy-1'", [])
        .unwrap();
    let tampered = verify(&root, &db).unwrap();
    assert!(!tampered.ok);
    assert_eq!(tampered.mismatches.len(), 1);
    assert!(tampered.mismatches[0].path.ends_with(&format!("{}.json", encode_id("buddy-1"))));

    // A second import into the same file is refused rather than merged.
    assert!(import(&root, &db).is_err());

    // A v1 file left behind (record-migration.ts not run) stops the import outright: a v1 reject
    // row would still verify ok=true and silently drop that conversation.
    let mut v1 = record_json("v1-1", &[]);
    v1["version"] = json!(1);
    v1.as_object_mut().unwrap().remove("kind");
    put_record(&root, "v1-1", &v1);
    let err = import(&root, &dir.path().join("fresh.sqlite")).unwrap_err().to_string();
    assert!(err.contains("record-migration"), "{err}");
}
