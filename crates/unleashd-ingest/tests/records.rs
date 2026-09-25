//! Conversation records (T23a): compare-and-set under a real two-writer race, the zero-loss
//! importer and verifier on a fixture holding every kind of bad file, the query-plan guard, and
//! the two behaviours config-store.ts carried incident comments for.

use rusqlite::Connection;
use serde_json::{Value, json};
use std::path::Path;
use std::sync::{Arc, Barrier};
use unleashd_ingest::model::Provider;
use unleashd_ingest::records::import::{RejectReason, encode_id, import, verify};
use unleashd_ingest::records::*;

const T0: i64 = 1_790_000_000_000;

fn config(model: &str) -> ConversationConfig {
    ConversationConfig {
        provider: Provider::Codex,
        model: ModelSelection::Explicit { model_id: model.into() },
        reasoning: ReasoningSelection::Default,
    }
}

fn resolved(model: &str) -> ResolvedExecutionConfig {
    ResolvedExecutionConfig { provider: Provider::Codex, model_id: model.into(), reasoning_effort: Some("high".into()) }
}

fn binding(session: &str) -> SessionBinding {
    SessionBinding { provider: Provider::Codex, session_id: session.into(), buddy_audience_key: None, latest_usage: None }
}

fn new_record(id: &str) -> NewRecord {
    NewRecord {
        conversation_id: id.into(),
        session_bindings: vec![],
        current_session: Some(binding(&format!("{id}-s1"))),
        working_directory: Some("/work".into()),
        creation: None,
        config: config("gpt-a"),
        last_resolved_config: Some(resolved("gpt-a")),
        provenance: Provenance::User,
    }
}

fn set(id: &str, expected: i64, model: &str) -> SetConfig {
    SetConfig {
        conversation_id: id.into(),
        expected_config_revision: expected,
        config: config(model),
        last_resolved_config: resolved(model),
    }
}

#[test]
fn set_config_is_compare_and_set_across_two_racing_writers() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("records.sqlite");
    let mut a = Records::open(&db).unwrap();
    assert!(matches!(a.create(new_record("c1"), T0).unwrap(), CreateOutcome::Created { .. }));

    // Two connections (the shape of two processes), released together on the same revision.
    let rounds = 40;
    let b = Arc::new(std::sync::Mutex::new(Records::open(&db).unwrap()));
    let a = Arc::new(std::sync::Mutex::new(a));
    for round in 0..rounds {
        let barrier = Arc::new(Barrier::new(2));
        let spawn = |records: Arc<std::sync::Mutex<Records>>, model: &'static str| {
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut records = records.lock().unwrap();
                barrier.wait();
                records.set_config(set("c1", round, model), T0 + round).unwrap()
            })
        };
        let (x, y) = (spawn(a.clone(), "gpt-x"), spawn(b.clone(), "gpt-y"));
        let outcomes = [x.join().unwrap(), y.join().unwrap()];
        let committed: Vec<_> =
            outcomes.iter().filter_map(|o| if let SetConfigOutcome::Committed { record } = o { Some(record) } else { None }).collect();
        let conflicts: Vec<_> = outcomes
            .iter()
            .filter_map(|o| if let SetConfigOutcome::RevisionConflict { current } = o { Some(current) } else { None })
            .collect();
        assert_eq!((committed.len(), conflicts.len()), (1, 1), "round {round}: exactly one writer wins: {outcomes:?}");
        // The loser is handed the winner's record, not a stale read.
        assert_eq!(conflicts[0], committed[0]);
        assert_eq!(committed[0].config_revision, round + 1);
    }
    let reader = Records::open(&db).unwrap();
    let last = reader.get("c1").unwrap().unwrap();
    assert_eq!((last.config_revision, last.record_revision), (rounds, rounds));

    // A stale expectation, a tombstone and a missing id are typed outcomes, not errors.
    let mut w = b.lock().unwrap();
    assert!(
        matches!(w.set_config(set("c1", 0, "gpt-z"), T0).unwrap(), SetConfigOutcome::RevisionConflict { current } if current.config_revision == rounds)
    );
    assert!(w.mark_deleted("c1", T0).unwrap());
    assert!(matches!(w.set_config(set("c1", rounds, "gpt-z"), T0).unwrap(), SetConfigOutcome::Tombstoned { .. }));
    assert!(matches!(w.set_config(set("nope", 0, "gpt-z"), T0).unwrap(), SetConfigOutcome::Missing));
    assert!(matches!(w.create(new_record("c1"), T0).unwrap(), CreateOutcome::Exists { .. }));
}

#[test]
fn rebinding_the_same_session_keeps_its_usage_and_a_new_session_starts_fresh() {
    // config-store.ts: "Re-binding the SAME session (an audience-key change) must not discard its
    // measured usage" — the context meter would drop to zero on every Buddy audience change.
    let dir = tempfile::tempdir().unwrap();
    let mut r = Records::open(&dir.path().join("r.sqlite")).unwrap();
    r.create(new_record("c1"), T0).unwrap();
    let usage = ProviderTurnUsage {
        context_tokens: 1000,
        output_tokens: 10,
        cached_input_tokens: None,
        cache_write_tokens: None,
        context_window: None,
        observed_at: "2026-09-25T10:00:00.000Z".into(),
    };
    r.set_current_session_usage("c1", "c1-s1", usage.clone(), T0).unwrap();
    // A late usage write for a session that is not current is dropped.
    let late = r.set_current_session_usage("c1", "other", usage.clone(), T0).unwrap().unwrap();
    assert_eq!(late.current_session.as_ref().unwrap().session_id, "c1-s1");

    let rebound = SessionBinding { buddy_audience_key: Some("aud-2".into()), ..binding("c1-s1") };
    let same = r.set_current_session("c1", rebound, T0).unwrap().unwrap();
    assert_eq!(same.current_session.as_ref().unwrap().latest_usage, Some(usage));
    assert_eq!(same.current_session.as_ref().unwrap().buddy_audience_key.as_deref(), Some("aud-2"));

    let moved = r.set_current_session("c1", binding("c1-s2"), T0).unwrap().unwrap();
    assert_eq!(moved.current_session.as_ref().unwrap().latest_usage, None);
    assert_eq!(moved.session_bindings.iter().map(|b| b.session_id.as_str()).collect::<Vec<_>>(), ["c1-s1"]);
    // Both sessions resolve to the conversation through the index.
    for s in ["c1-s1", "c1-s2"] {
        assert_eq!(r.find_by_session(Provider::Codex, s).unwrap().unwrap().conversation_id, "c1");
    }
}

#[test]
fn the_first_message_lease_is_exclusive_for_fifteen_seconds() {
    // Two dispatchers must not both deliver a creation message; a crashed one must not strand it.
    let dir = tempfile::tempdir().unwrap();
    let mut r = Records::open(&dir.path().join("r.sqlite")).unwrap();
    let input = NewRecord {
        creation: Some(ConversationCreation { initial_message: Some("hello".into()), ..Default::default() }),
        ..new_record("c1")
    };
    r.create(input, T0).unwrap();
    assert!(r.claim_initial_message_dispatch("c1", "tok-a", T0).unwrap().is_some());
    assert!(r.claim_initial_message_dispatch("c1", "tok-b", T0 + 14_999).unwrap().is_none(), "lease held");
    assert!(r.claim_initial_message_dispatch("c1", "tok-b", T0 + 15_000).unwrap().is_some(), "an expired lease is re-claimable");
    assert!(r.complete_initial_message_dispatch("c1", "tok-a", T0 + 15_001).unwrap().is_none(), "the old holder lost it");
    let done = r.complete_initial_message_dispatch("c1", "tok-b", T0 + 15_002).unwrap().unwrap();
    let creation = done.creation.unwrap();
    assert_eq!(creation.initial_message_dispatched_at.as_deref(), Some("2026-09-21T14:13:35.002Z"), "formatted as Date.toISOString");
    assert_eq!((creation.initial_message_dispatch_claim_token, creation.initial_message_dispatch_claimed_at), (None, None));
    assert!(r.claim_initial_message_dispatch("c1", "tok-c", T0 + 99_999).unwrap().is_none(), "delivered once");
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn pretty(v: &Value) -> String {
    format!("{}\n", serde_json::to_string_pretty(v).unwrap())
}

fn record_json(id: &str, sessions: &[&str]) -> Value {
    json!({
        "version": 1,
        "conversationId": id,
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
        "commandId": "cmd", "fingerprint": "fp", "placement": "background",
        "branch": { "sourceConversationId": "src", "throughMessageId": "m1", "audience": { "kind": "project", "projectId": "p" },
                    "handoff": "h", "launches": { "zz": "later", "aa": "earlier" } },
        "buddyContext": { "buddyId": "b1", "workspaceId": "w1", "buddyProjectId": null, "automationRunId": "run",
                          "knowledgeScope": { "kind": "owner_thread", "conversationId": "o" }, "allowedBuddyOperations": ["buddy.post"] }
    });
    put_record(&root, "buddy-1", &buddy);
    put_index(&root, "claude", "s-old", "buddy-1");
    put_index(&root, "claude", "s-cur", "buddy-1");

    // A legacy file without status / done / recordRevision.
    let mut legacy = record_json("legacy-1", &["s-leg"]);
    for key in ["status", "done", "recordRevision"] {
        legacy.as_object_mut().unwrap().remove(key);
    }
    put_record(&root, "legacy-1", &legacy);

    // Bad files, one of each kind.
    write(&root.join("by-conversation").join(format!("{}.json", encode_id("torn"))), "{\"version\": 1, \"conversa");
    let mut unknown_key = record_json("extra-1", &[]);
    unknown_key["surprise"] = json!(true);
    put_record(&root, "extra-1", &unknown_key);
    let mut empty_session = record_json("empty-1", &[""]);
    empty_session["sessionBindings"][0]["sessionId"] = json!("");
    put_record(&root, "empty-1", &empty_session);
    let mut future = record_json("future-1", &[]);
    future["version"] = json!(2);
    put_record(&root, "future-1", &future);
    write(&root.join("by-conversation").join("copy-of-legacy.json"), &pretty(&record_json("legacy-1", &[])));
    write(&root.join("by-conversation").join(".abc.json.123.uuid.tmp"), "{");
    write(&root.join("quarantine").join("old-2026-08-01T00-00-00.000Z.json"), "not json");
    put_index(&root, "claude", "s-gone", "no-such-conversation");
    put_index(&root, "claude", "s-leg-not-bound", "legacy-1");
    write(&root.join("by-session").join("claude").join(".x.json.1.tmp"), "{}");

    let db = dir.path().join("records.sqlite");
    let report = import(&root, &db).unwrap();
    assert_eq!((report.record_files, report.imported), (8, 2));
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
    assert_eq!(b.kind, KindTag::Buddy { buddy_id: "b1".into() });
    assert_eq!(b.sessions.len(), 2);
    let ctx = records.get("buddy-1").unwrap().unwrap().creation.unwrap().buddy_context.unwrap();
    assert_eq!((ctx.buddy_project_id, ctx.legacy_work_item_id), (Some(None), None));
    drop(records);

    let checked = verify(&root, &db).unwrap();
    assert!(checked.ok, "{checked:#?}");
    assert_eq!((checked.records_compared, checked.record_hash_matches), (2, 2));
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
}

#[test]
fn no_record_read_or_write_scans_a_table() {
    // Pattern: fix-guards (docs/patterns.md#fix-guards). config-store.ts read all ~7,800 files
    // (42 MB, ~3.2 s) on a lookup miss; a by-session lookup that scans would bring that back.
    let dir = tempfile::tempdir().unwrap();
    let mut r = Records::open(&dir.path().join("r.sqlite")).unwrap();
    for i in 0..50 {
        r.create(new_record(&format!("c{i}")), T0).unwrap();
    }
    Connection::open(dir.path().join("r.sqlite")).unwrap().execute_batch("ANALYZE").unwrap();
    for (query, plan) in r.plans().unwrap() {
        for step in &plan {
            assert!(!step.starts_with("SCAN"), "full scan in `{query}`: {plan:?}");
        }
    }
}

#[test]
fn records_and_the_ingest_store_share_one_file_without_interfering() {
    // T23b may keep one file for backups; both schemas must open in either order and keep their data.
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("unleashd.sqlite");
    let mut records = Records::open(&db).unwrap();
    records.create(new_record("c1"), T0).unwrap();
    let writer = unleashd_ingest::store::Writer::open(&db).unwrap();
    assert_eq!(writer.rev().unwrap(), 0);
    drop(writer);
    let reopened = Records::open(&db).unwrap();
    assert_eq!(reopened.get("c1").unwrap().unwrap().conversation_id, "c1");
    assert!(unleashd_ingest::store::Reader::open(&db).unwrap().list_sessions(0).unwrap().1.is_empty());
}
