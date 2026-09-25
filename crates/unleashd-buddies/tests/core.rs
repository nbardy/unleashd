mod common;

use common::{WS, buddy, fixture};
use std::sync::{Arc, Barrier};
use unleashd_buddies::types::*;
use unleashd_buddies::{CoreError, Store};

fn soul(buddy_id: &str) -> DocRef {
    DocRef { buddy_id: buddy_id.into(), scope: DocScope::Buddy, kind: DocKind::Working, name: String::new() }
}

fn write(buddy_id: &str, content: &str, base: i64, key: &str) -> DocWrite {
    DocWrite { doc: soul(buddy_id), content: content.into(), base_revision: base, reason: "test".into(), key: key.into() }
}

fn request(to: &str, body: &str, key: &str) -> PostInput {
    PostInput {
        target: Target::Buddy { id: to.into() },
        kind: PostKind::Request,
        body: body.into(),
        purpose: None,
        evidence: vec![],
        reply_to_id: None,
        task_id: None,
        from_conversation_id: Some("conv-sender".into()),
        key: key.into(),
    }
}

fn chat(buddy_id: &str, turn: &str, conversation: &str) -> EnqueueInput {
    EnqueueInput {
        buddy_id: buddy_id.into(),
        input: RunInput::Chat { turn_id: turn.into() },
        conversation_id: Some(conversation.into()),
        task_id: None,
        after_run_id: None,
        deadline: None,
    }
}

#[test]
fn authorize_is_owner_self_or_transitive_manager() {
    let f = fixture();
    let s = &f.store;
    let on = |id: &str| Subject::Buddy { id: id.into() };
    let allowed = |actor: &Actor, op: Op, subject: &Subject| s.authorize(actor, op, subject).unwrap() == Decision::Allowed;

    assert!(allowed(&Actor::Owner, Op::Admin, &Subject::Owner));
    assert!(allowed(&buddy("ic"), Op::WriteDoc, &on("ic")), "self");
    assert!(allowed(&buddy("lead"), Op::WriteDoc, &on("ic")), "manager of a manager");
    assert!(!allowed(&buddy("ic"), Op::WriteDoc, &on("lead")), "reports do not manage upward");
    assert!(!allowed(&buddy("peer"), Op::WriteDoc, &on("mid")), "peers are not managers");
    assert!(allowed(&buddy("peer"), Op::Post, &on("mid")), "anyone may post to anyone");
    assert!(!allowed(&buddy("lead"), Op::Admin, &Subject::Owner), "admin is owner only");
    assert!(!allowed(&buddy("gone"), Op::Post, &on("gone")), "archived buddies are denied");
    assert!(!allowed(&buddy("mid"), Op::WriteDoc, &Subject::Owner));
}

#[test]
fn functions_enforce_authorize() {
    let mut f = fixture();
    let err = f.store.write_doc(&buddy("peer"), write("mid", "x", 0, "k")).unwrap_err();
    assert!(matches!(err, CoreError::Denied(_)), "{err}");
    f.store.write_doc(&buddy("lead"), write("ic", "from my manager's manager", 0, "k")).unwrap();
}

#[test]
fn write_doc_is_compare_and_swap_and_keeps_every_revision() {
    let mut f = fixture();
    let s = &mut f.store;
    let first = s.write_doc(&buddy("ic"), write("ic", "one", 0, "a")).unwrap();
    assert_eq!(first.revision, 1);
    let stale = s.write_doc(&buddy("ic"), write("ic", "lost update", 0, "b")).unwrap_err();
    assert!(matches!(stale, CoreError::RevisionConflict { expected: 0, current: 1 }), "{stale}");
    let second = s.write_doc(&buddy("ic"), write("ic", "two", 1, "c")).unwrap();
    assert_eq!((second.revision, second.content.as_str()), (2, "two"));

    let revisions = s.doc_revisions(&buddy("ic"), &second.id).unwrap();
    assert_eq!(revisions.iter().map(|r| r.content.as_str()).collect::<Vec<_>>(), ["one", "two"]);
    for r in &revisions {
        assert_eq!(r.sha256, unleashd_buddies::store::sha256_hex(r.content.as_bytes()));
    }
}

#[test]
fn upsert_task_is_compare_and_swap() {
    let mut f = fixture();
    let s = &mut f.store;
    let task = s
        .upsert_task(
            &buddy("mid"),
            TaskWrite::Create { owner_id: "ic".into(), parent_id: None, title: "t".into(), done_criteria: "d".into(), key: "c".into() },
        )
        .unwrap();
    let update = |base: i64, key: &str| TaskWrite::Update {
        task_id: task.id.clone(),
        base_revision: base,
        key: key.into(),
        changes: TaskChanges { status: Some(TaskStatus::InProgress), ..Default::default() },
    };
    assert_eq!(s.upsert_task(&buddy("ic"), update(1, "u1")).unwrap().revision, 2);
    let stale = s.upsert_task(&buddy("ic"), update(1, "u2")).unwrap_err();
    assert!(matches!(stale, CoreError::RevisionConflict { expected: 1, current: 2 }), "{stale}");
    let blocked = TaskWrite::Update {
        task_id: task.id.clone(),
        base_revision: 2,
        key: "u3".into(),
        changes: TaskChanges { status: Some(TaskStatus::Blocked), ..Default::default() },
    };
    assert!(matches!(s.upsert_task(&buddy("ic"), blocked).unwrap_err(), CoreError::Invalid(_)), "blocked needs a reason");
}

#[test]
fn idempotency_key_replays_and_rejects_a_changed_payload() {
    let mut f = fixture();
    let s = &mut f.store;
    let a = s.post(&buddy("peer"), request("mid", "hello", "k1")).unwrap();
    let again = s.post(&buddy("peer"), request("mid", "hello", "k1")).unwrap();
    assert_eq!(a.id, again.id, "a replay returns the first result");
    let page = s.list_posts(PostQuery::To { target: Target::Buddy { id: "mid".into() } }, None, 10).unwrap();
    assert_eq!(page.posts.len(), 1, "a replay writes nothing");
    assert_eq!(s.list_runs(RunQuery::Buddy { buddy_id: "mid".into() }, 10).unwrap().len(), 1, "and queues no second run");
    let changed = s.post(&buddy("peer"), request("mid", "a different body", "k1")).unwrap_err();
    assert!(matches!(changed, CoreError::IdempotencyConflict(_)), "{changed}");
}

#[test]
fn two_claimers_one_winner() {
    let f = fixture();
    let path = f.path.to_str().unwrap().to_string();
    let mut setup = Store::open(&path).unwrap();
    for round in 0..25 {
        setup.enqueue_run(&Actor::Owner, chat("peer", &format!("turn-{round}"), &format!("conv-{round}"))).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let winners: Vec<Option<Claim>> = (0..2)
            .map(|_| {
                let (barrier, path) = (barrier.clone(), path.clone());
                std::thread::spawn(move || {
                    let mut store = Store::open(&path).unwrap();
                    barrier.wait();
                    store.claim_run(60_000).unwrap()
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect();
        let won: Vec<&Claim> = winners.iter().flatten().collect();
        assert_eq!(won.len(), 1, "round {round}: exactly one claimer wins");
        setup.settle_run(&won[0].run.id, &won[0].lease_token, Outcome::Complete { text: "ok".into() }).unwrap();
    }
}

#[test]
fn a_lease_is_the_only_way_to_settle_and_it_expires() {
    let mut f = fixture();
    let s = &mut f.store;
    s.enqueue_run(&Actor::Owner, chat("peer", "t1", "c1")).unwrap();
    let claim = s.claim_run_at("2099-01-01T00:00:00.000Z", 1_000).unwrap().unwrap();
    let wrong = s.settle_run(&claim.run.id, "not-the-token", Outcome::Complete { text: "x".into() }).unwrap_err();
    assert!(matches!(wrong, CoreError::LeaseLost(_)));
    // The next claim after expiry fails the abandoned run instead of leaving it running forever.
    assert!(s.claim_run_at("2099-01-01T00:00:05.000Z", 1_000).unwrap().is_none());
    let expired = s.get_run(&claim.run.id).unwrap();
    assert_eq!((expired.status, expired.error_code.as_deref()), (RunStatus::Failed, Some("lease_expired")));
    assert!(matches!(
        s.settle_run(&claim.run.id, &claim.lease_token, Outcome::Complete { text: "late".into() }),
        Err(CoreError::LeaseLost(_))
    ));
}

#[test]
fn one_running_run_per_conversation() {
    let mut f = fixture();
    let s = &mut f.store;
    s.enqueue_run(&Actor::Owner, chat("peer", "t1", "same")).unwrap();
    s.enqueue_run(&Actor::Owner, chat("peer", "t2", "same")).unwrap();
    let first = s.claim_run(60_000).unwrap().unwrap();
    assert!(s.claim_run(60_000).unwrap().is_none(), "the conversation is busy");
    s.settle_run(&first.run.id, &first.lease_token, Outcome::Complete { text: "done".into() }).unwrap();
    assert_eq!(s.claim_run(60_000).unwrap().unwrap().run.input, RunInput::Chat { turn_id: "t2".into() });
}

#[test]
fn request_reply_round_trip_and_failure_notice() {
    let mut f = fixture();
    let s = &mut f.store;
    let asked = s.post(&buddy("mid"), request("ic", "please do X", "r1")).unwrap();
    assert_eq!(asked.reply, Reply::Awaiting);
    assert_eq!(s.inbox(&buddy("ic"), WS).unwrap().requests.len(), 1);
    assert_eq!(s.inbox(&buddy("mid"), WS).unwrap().waiting_on.len(), 1);

    let claim = s.claim_run(60_000).unwrap().unwrap();
    assert_eq!((claim.run.buddy_id.as_str(), &claim.run.input), ("ic", &RunInput::Post { post_id: asked.id.clone() }));
    let replied = s
        .reply(
            &buddy("ic"),
            ReplyInput { post_id: asked.id.clone(), body: "done".into(), evidence: vec!["a.md".into()], key: "rep".into() },
        )
        .unwrap();
    assert!(matches!(replied.reply, Reply::Replied { ref body, .. } if body == "done"));
    s.settle_run(&claim.run.id, &claim.lease_token, Outcome::Complete { text: "ok".into() }).unwrap();
    let back = s.claim_run(60_000).unwrap().unwrap();
    assert_eq!((back.run.buddy_id.as_str(), back.run.conversation_id.as_deref()), ("mid", Some("conv-sender")));
    assert_eq!(back.run.input, RunInput::Reply { post_id: asked.id.clone() });
    s.settle_run(&back.run.id, &back.lease_token, Outcome::Complete { text: "read".into() }).unwrap();

    s.post(&buddy("mid"), request("ic", "will fail", "r2")).unwrap();
    let claim = s.claim_run(60_000).unwrap().unwrap();
    s.settle_run(&claim.run.id, &claim.lease_token, Outcome::Failed { code: "provider_error".into(), error: "boom".into() }).unwrap();
    assert_eq!(s.list_posts(PostQuery::From { author: buddy("mid") }, None, 10).unwrap().posts[0].reply, Reply::Failed);
    let notice = s.claim_run(60_000).unwrap().unwrap();
    assert_eq!((notice.run.buddy_id.as_str(), notice.run.input), ("mid", RunInput::FailureNotice { run_id: claim.run.id }));
}

#[test]
fn pausing_a_task_cancels_its_queued_runs() {
    let mut f = fixture();
    let s = &mut f.store;
    let task = s
        .upsert_task(
            &buddy("ic"),
            TaskWrite::Create { owner_id: "ic".into(), parent_id: None, title: "t".into(), done_criteria: "d".into(), key: "c".into() },
        )
        .unwrap();
    let run = s.enqueue_run(&buddy("ic"), EnqueueInput { task_id: Some(task.id.clone()), ..chat("ic", "t1", "c1") }).unwrap();
    s.upsert_task(
        &buddy("ic"),
        TaskWrite::Update {
            task_id: task.id.clone(),
            base_revision: 1,
            key: "p".into(),
            changes: TaskChanges { paused: Some(true), ..Default::default() },
        },
    )
    .unwrap();
    let run = s.get_run(&run.id).unwrap();
    assert_eq!((run.status, run.error_code.as_deref()), (RunStatus::Cancelled, Some("task_epoch_stale")));
}

#[test]
fn due_schedules_enqueue_once_per_slot() {
    let mut f = fixture();
    let s = &mut f.store;
    let schedule = s
        .put_schedule(
            &buddy("ic"),
            ScheduleInput {
                id: None,
                buddy_id: "ic".into(),
                task_id: None,
                name: "hourly".into(),
                cron: "0 * * * *".into(),
                timezone: "Asia/Seoul".into(),
                prompt: "check".into(),
                limits: "{}".into(),
                enabled: true,
                key: "s".into(),
            },
        )
        .unwrap();
    let slot = schedule.next_run_at.clone().unwrap();
    assert!(slot.ends_with(":00:00.000Z"), "{slot}");
    let later = "2099-01-01T00:30:00.000Z";
    let runs = s.due_schedules(later).unwrap();
    assert_eq!(runs.len(), 1, "missed slots collapse into one run");
    assert_eq!(runs[0].input, RunInput::Schedule { schedule_id: schedule.id.clone(), slot });
    assert!(s.due_schedules(later).unwrap().is_empty(), "the schedule advanced past now");
    assert_eq!(s.list_schedules("ic").unwrap()[0].next_run_at.as_deref(), Some("2099-01-01T01:00:00.000Z"));
}

#[test]
fn events_prune_by_age() {
    let mut f = fixture();
    let s = &mut f.store;
    let input = |key: &str| EventInput {
        workspace_id: WS.into(),
        op: "memory.review".into(),
        payload: "{}".into(),
        key: Some(key.into()),
        buddy_id: Some("ic".into()),
        task_id: None,
    };
    let first = s.append_event(&buddy("ic"), input("e1")).unwrap();
    assert_eq!(s.append_event(&buddy("ic"), input("e1")).unwrap().seq, first.seq, "same key, same event");
    assert_eq!(s.prune_events("2000-01-01T00:00:00.000Z").unwrap(), 0);
    assert_eq!(s.prune_events("2999-01-01T00:00:00.000Z").unwrap(), 1);
}
