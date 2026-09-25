//! Query-plan guard. Regression class: the 2026-09-25 tick incident (00-reconcile-fix.md), where a
//! 1 s timer ran full-table scans and took 0.6–20 s per tick. Every statement a workload of every
//! public function executes is traced, then `EXPLAIN QUERY PLAN`ned; a plain `SCAN <table>` fails.
//! An index scan (`SCAN t USING INDEX`) is fine; so is a CTE scan and the one list-everything read.

mod common;

use common::{WS, buddy, fixture};
use rusqlite::Connection;
use std::collections::BTreeSet;
use std::sync::Mutex;
use unleashd_buddies::types::*;

static TRACED: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn record(sql: &str) {
    TRACED.lock().unwrap().push(sql.to_string());
}

/// Reads whose job is to return every row of a small table.
const WHOLE_TABLE_BY_DESIGN: &[&str] = &["SCAN workspace"];
/// Plan lines that scan no table: the manager-walk CTE and its constant seed row.
const NOT_TABLES: &[&str] = &["SCAN up", "SCAN CONSTANT ROW"];

fn workload(s: &mut unleashd_buddies::Store) {
    let ic = buddy("ic");
    let mid = buddy("mid");
    let owner = Actor::Owner;
    s.authorize(&mid, Op::WriteDoc, &Subject::Buddy { id: "lead".into() }).unwrap();
    s.authorize(&buddy("lead"), Op::WriteDoc, &Subject::Buddy { id: "ic".into() }).unwrap();
    let channel = s
        .create_channel(&owner, ChannelInput { workspace_id: WS.into(), name: "general".into(), purpose: "p".into(), key: "ch".into() })
        .unwrap();
    let top = s
        .post(
            &owner,
            PostInput {
                target: Target::Channel { id: channel.id.clone() },
                kind: PostKind::Inform,
                body: "hi".into(),
                purpose: None,
                evidence: vec![],
                reply_to_id: None,
                task_id: None,
                from_conversation_id: None,
                key: "p1".into(),
            },
        )
        .unwrap();
    s.post(
        &ic,
        PostInput {
            target: Target::Channel { id: channel.id.clone() },
            kind: PostKind::Inform,
            body: "reply".into(),
            purpose: None,
            evidence: vec![],
            reply_to_id: Some(top.id.clone()),
            task_id: None,
            from_conversation_id: None,
            key: "p2".into(),
        },
    )
    .unwrap();
    let ask = s
        .post(
            &mid,
            PostInput {
                target: Target::Buddy { id: "ic".into() },
                kind: PostKind::Request,
                body: "do".into(),
                purpose: None,
                evidence: vec![],
                reply_to_id: None,
                task_id: None,
                from_conversation_id: Some("c-mid".into()),
                key: "p3".into(),
            },
        )
        .unwrap();
    let cursor = Some(Cursor { created_at: "2999-01-01T00:00:00.000Z".into(), id: "z".into() });
    for q in [
        PostQuery::Channel { channel_id: channel.id.clone() },
        PostQuery::Thread { root_id: top.id.clone() },
        PostQuery::Task { task_id: "none".into() },
        PostQuery::To { target: Target::Owner },
        PostQuery::To { target: Target::Buddy { id: "ic".into() } },
        PostQuery::From { author: mid.clone() },
        PostQuery::From { author: owner.clone() },
    ] {
        s.list_posts(q.clone(), None, 5).unwrap();
        s.list_posts(q, cursor.clone(), 5).unwrap();
    }
    s.inbox(&ic, WS).unwrap();
    s.inbox(&owner, WS).unwrap();
    s.mark_read(&ic, &channel.id, &top.id).unwrap();
    s.list_channels(WS).unwrap();

    let claim = s.claim_run(60_000).unwrap().unwrap();
    s.bind_run(&claim.run.id, &claim.lease_token, "c-ic").unwrap();
    s.reply(&ic, ReplyInput { post_id: ask.id.clone(), body: "done".into(), evidence: vec![], key: "r".into() }).unwrap();
    s.settle_run(&claim.run.id, &claim.lease_token, Outcome::Failed { code: "x".into(), error: "y".into() }).unwrap();

    let doc = DocRef { buddy_id: "ic".into(), scope: DocScope::Buddy, kind: DocKind::Working, name: String::new() };
    let written = s
        .write_doc(&mid, DocWrite { doc: doc.clone(), content: "m".into(), base_revision: 0, reason: "r".into(), key: "d".into() })
        .unwrap();
    let task_doc = DocRef { scope: DocScope::Task { task_id: "none".into() }, ..doc.clone() };
    s.read_doc(&ic, doc).unwrap();
    s.read_doc(&ic, task_doc).unwrap();
    s.list_docs(&ic, "ic", DocKind::Working).unwrap();
    s.doc_revisions(&ic, &written.id).unwrap();

    let parent = s
        .upsert_task(
            &mid,
            TaskWrite::Create { owner_id: "ic".into(), parent_id: None, title: "t".into(), done_criteria: "d".into(), key: "t1".into() },
        )
        .unwrap();
    s.upsert_task(
        &ic,
        TaskWrite::Create {
            owner_id: "ic".into(),
            parent_id: Some(parent.id.clone()),
            title: "c".into(),
            done_criteria: "d".into(),
            key: "t2".into(),
        },
    )
    .unwrap();
    s.enqueue_run(
        &ic,
        EnqueueInput {
            buddy_id: "ic".into(),
            input: RunInput::Chat { turn_id: "u1".into() },
            conversation_id: Some("c-ic".into()),
            task_id: Some(parent.id.clone()),
            after_run_id: Some(claim.run.id.clone()),
            deadline: None,
        },
    )
    .unwrap();
    s.upsert_task(
        &ic,
        TaskWrite::Update {
            task_id: parent.id.clone(),
            base_revision: 1,
            key: "t3".into(),
            changes: TaskChanges { paused: Some(true), ..Default::default() },
        },
    )
    .unwrap();
    for q in [
        TaskQuery::Owner { buddy_id: "ic".into() },
        TaskQuery::Workspace { workspace_id: WS.into() },
        TaskQuery::Children { parent_id: parent.id.clone() },
    ] {
        s.list_tasks(q).unwrap();
    }
    s.get_task(&parent.id).unwrap();

    let run = s
        .enqueue_run(
            &owner,
            EnqueueInput {
                buddy_id: "peer".into(),
                input: RunInput::Chat { turn_id: "u2".into() },
                conversation_id: None,
                task_id: None,
                after_run_id: None,
                deadline: None,
            },
        )
        .unwrap();
    s.cancel_run(&owner, &run.id).unwrap();
    for q in [
        RunQuery::Buddy { buddy_id: "ic".into() },
        RunQuery::Conversation { conversation_id: "c-ic".into() },
        RunQuery::Task { task_id: parent.id.clone() },
        RunQuery::Queued,
    ] {
        s.list_runs(q, 10).unwrap();
    }
    s.put_schedule(
        &ic,
        ScheduleInput {
            id: None,
            buddy_id: "ic".into(),
            task_id: None,
            name: "n".into(),
            cron: "0 * * * *".into(),
            timezone: "UTC".into(),
            prompt: "p".into(),
            limits: "{}".into(),
            enabled: true,
            key: "s".into(),
        },
    )
    .unwrap();
    s.list_schedules("ic").unwrap();
    s.due_schedules("2999-01-01T00:00:00.000Z").unwrap();
    s.append_event(
        &ic,
        EventInput {
            workspace_id: WS.into(),
            op: "x".into(),
            payload: "{}".into(),
            key: Some("e".into()),
            buddy_id: Some("ic".into()),
            task_id: None,
        },
    )
    .unwrap();
    s.list_events("ic", i64::MAX, 10).unwrap();
    s.prune_events("2000-01-01T00:00:00.000Z").unwrap();
    s.list_workspaces().unwrap();
    s.get_buddy("ic").unwrap();
    s.list_buddies(WS).unwrap();
    s.bind_conversation(&owner, ConversationInput { id: "c-new".into(), buddy_id: "ic".into(), task_id: None }).unwrap();
    s.get_conversation("c-new").unwrap();
}

#[test]
fn every_statement_uses_an_index() {
    let mut f = fixture();
    f.store.trace(Some(record));
    workload(&mut f.store);
    f.store.trace(None);

    let statements: BTreeSet<String> = TRACED
        .lock()
        .unwrap()
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !(s.starts_with("BEGIN") || s.starts_with("COMMIT") || s.starts_with("ROLLBACK") || s.starts_with("PRAGMA")))
        .collect();
    assert!(statements.len() > 40, "the workload should exercise many statements, saw {}", statements.len());

    let conn = Connection::open(&f.path).unwrap();
    let table_scans = |sql: &str| -> Vec<String> {
        let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        let plan: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(3)).unwrap().map(Result::unwrap).collect();
        plan.into_iter()
            .filter(|line| line.starts_with("SCAN ") && !line.contains("USING"))
            .filter(|line| !WHOLE_TABLE_BY_DESIGN.contains(&line.as_str()) && !NOT_TABLES.contains(&line.as_str()))
            .collect()
    };
    // The detector itself must see a scan, or a changed SQLite plan format would pass everything.
    assert_eq!(table_scans("SELECT * FROM post WHERE body = 'x'"), ["SCAN post"]);
    let scans: Vec<String> =
        statements.iter().flat_map(|sql| table_scans(sql).into_iter().map(move |line| format!("{line}\n    in: {sql}"))).collect();
    assert!(scans.is_empty(), "full table scans:\n{}", scans.join("\n"));
}
