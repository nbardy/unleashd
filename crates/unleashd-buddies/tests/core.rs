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

fn dm(a: &str, b: &str) -> ChannelRef {
    ChannelRef::Direct { members: vec![buddy(a), buddy(b)] }
}

fn request(body: &str, key: &str) -> PostInput {
    PostInput {
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
    assert!(!allowed(&buddy("peer"), Op::Post, &on("mid")), "posts go to channels, not to buddies");
    assert!(!allowed(&buddy("lead"), Op::Admin, &Subject::Owner), "admin is owner only");
    assert!(!allowed(&buddy("gone"), Op::CreateChannel, &Subject::Owner), "archived buddies are denied");
    assert!(!allowed(&buddy("mid"), Op::WriteDoc, &Subject::Owner));
}

#[test]
fn channel_access_is_membership_for_direct_and_open_for_public_and_task() {
    let mut f = fixture();
    let s = &mut f.store;
    let direct = s.open_channel(&buddy("mid"), dm("mid", "ic")).unwrap();
    let public = s
        .create_channel(
            &buddy("ic"),
            ChannelInput { workspace_id: WS.into(), name: "general".into(), purpose: "p".into(), key: "c".into() },
        )
        .unwrap();
    let task = s
        .upsert_task(
            &buddy("ic"),
            TaskWrite::Create { owner_id: "ic".into(), parent_id: None, title: "t".into(), done_criteria: "d".into(), key: "t".into() },
        )
        .unwrap();
    let task = s.open_channel(&buddy("peer"), ChannelRef::Task { task_id: task.id }).unwrap();
    let allowed = |s: &Store, actor: &Actor, op: Op, channel: &Channel| {
        s.authorize(actor, op, &Subject::Channel { id: channel.id.clone() }).unwrap() == Decision::Allowed
    };
    for op in [Op::Post, Op::ReadChannel] {
        assert!(allowed(s, &buddy("ic"), op, &direct) && allowed(s, &Actor::Owner, op, &direct));
        assert!(!allowed(s, &buddy("lead"), op, &direct), "a manager is not a member of its reports' direct channels");
        assert!(allowed(s, &buddy("peer"), op, &public) && allowed(s, &buddy("peer"), op, &task));
        assert!(!allowed(s, &buddy("gone"), op, &public), "archived buddies are denied");
    }
    let read = s.list_posts(&buddy("peer"), PostQuery::Channel { channel_id: direct.id.clone() }, None, 10).unwrap_err();
    assert!(matches!(read, CoreError::Denied(_)), "{read}");
    let wrote = s.post(&buddy("peer"), ChannelRef::Id { id: direct.id.clone() }, request("hi", "k")).unwrap_err();
    assert!(matches!(wrote, CoreError::Denied(_)), "{wrote}");
    // Opening someone else's direct channel is denied, and the attempt leaves no channel behind.
    let opened = s.post(&buddy("peer"), dm("lead", "ic"), request("hi", "k2")).unwrap_err();
    assert!(matches!(opened, CoreError::Denied(_)), "{opened}");
    let conn = rusqlite::Connection::open(&f.path).unwrap();
    assert_eq!(conn.query_row("SELECT count(*) FROM channel WHERE kind = 'direct'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
}

#[test]
fn one_direct_channel_per_member_set_even_under_a_race() {
    let f = fixture();
    let path = f.path.to_str().unwrap().to_string();
    let mut s = Store::open(&path).unwrap();
    let a = s.open_channel(&buddy("mid"), dm("mid", "ic")).unwrap();
    let members = ChannelRef::Direct { members: vec![buddy("ic"), buddy("mid"), buddy("ic")] };
    assert_eq!(s.open_channel(&buddy("ic"), members).unwrap().id, a.id, "order and duplicates do not make a new channel");
    assert_ne!(s.open_channel(&Actor::Owner, ChannelRef::Direct { members: vec![Actor::Owner, buddy("ic")] }).unwrap().id, a.id);

    for round in 0..10 {
        let pair = ["lead", "peer"];
        let barrier = Arc::new(Barrier::new(2));
        let posts: Vec<Post> = (0..2)
            .map(|i| {
                let (barrier, path) = (barrier.clone(), path.clone());
                std::thread::spawn(move || {
                    let mut store = Store::open(&path).unwrap();
                    barrier.wait();
                    let input = PostInput { kind: PostKind::Inform, ..request("hi", &format!("race-{round}-{i}")) };
                    store.post(&buddy(pair[i]), dm(pair[0], pair[1]), input).unwrap()
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect();
        assert_eq!(posts[0].channel_id, posts[1].channel_id, "round {round}: both posts land in one channel");
    }
    let conn = rusqlite::Connection::open(&f.path).unwrap();
    let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
    assert_eq!(count("SELECT count(*) FROM channel WHERE kind = 'direct' AND member_key = 'lead,peer'"), 1);
    assert_eq!(count("SELECT count(*) FROM channel_member WHERE channel_id = (SELECT id FROM channel WHERE member_key = 'lead,peer')"), 2);
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
    let a = s.post(&buddy("peer"), dm("peer", "mid"), request("hello", "k1")).unwrap();
    let again = s.post(&buddy("peer"), dm("peer", "mid"), request("hello", "k1")).unwrap();
    assert_eq!(a.id, again.id, "a replay returns the first result");
    let page = s.list_posts(&buddy("mid"), PostQuery::Channel { channel_id: a.channel_id.clone() }, None, 10).unwrap();
    assert_eq!(page.posts.len(), 1, "a replay writes nothing");
    assert_eq!(s.list_runs(RunQuery::Buddy { buddy_id: "mid".into() }, 10).unwrap().len(), 1, "and queues no second run");
    let changed = s.post(&buddy("peer"), dm("peer", "mid"), request("a different body", "k1")).unwrap_err();
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
fn request_answer_round_trip_and_failure_notice() {
    let mut f = fixture();
    let s = &mut f.store;
    let asked = s.post(&buddy("mid"), dm("mid", "ic"), request("please do X", "r1")).unwrap();
    assert_eq!(asked.request, RequestState::Awaiting);
    assert_eq!(s.inbox(&buddy("ic"), WS).unwrap().requests.len(), 1);
    assert_eq!(s.inbox(&buddy("mid"), WS).unwrap().requests.len(), 0, "the asker owes nothing");
    assert_eq!(s.inbox(&buddy("mid"), WS).unwrap().waiting_on.len(), 1);
    let unread = |s: &Store, who: &str| s.inbox(&buddy(who), WS).unwrap().channels.iter().map(|c| c.unread).sum::<i64>();
    assert_eq!((unread(s, "ic"), unread(s, "mid")), (1, 0), "a direct channel has read cursors like any channel");

    let claim = s.claim_run(60_000).unwrap().unwrap();
    assert_eq!((claim.run.buddy_id.as_str(), &claim.run.input), ("ic", &RunInput::Post { post_id: asked.id.clone() }));
    let answer = s
        .answer(
            &buddy("ic"),
            AnswerInput { request_id: asked.id.clone(), body: "done".into(), evidence: vec!["a.md".into()], key: "rep".into() },
        )
        .unwrap();
    assert_eq!(
        (answer.channel_id.as_str(), answer.reply_to_id.as_deref(), answer.root_id.as_deref(), &answer.author),
        (asked.channel_id.as_str(), Some(asked.id.as_str()), Some(asked.id.as_str()), &buddy("ic")),
        "the answer is a reply post in the request's thread"
    );
    assert_eq!(s.get_post(&buddy("mid"), &asked.id).unwrap().request, RequestState::Answered { answer_id: answer.id.clone() });
    let again =
        s.answer(&buddy("ic"), AnswerInput { request_id: asked.id.clone(), body: "twice".into(), evidence: vec![], key: "rep2".into() });
    assert!(matches!(again, Err(CoreError::Invalid(_))), "a request is answered once");
    s.settle_run(&claim.run.id, &claim.lease_token, Outcome::Complete { text: "ok".into() }).unwrap();
    let back = s.claim_run(60_000).unwrap().unwrap();
    assert_eq!((back.run.buddy_id.as_str(), back.run.conversation_id.as_deref()), ("mid", Some("conv-sender")));
    assert_eq!(back.run.input, RunInput::Reply { post_id: asked.id.clone() });
    s.settle_run(&back.run.id, &back.lease_token, Outcome::Complete { text: "read".into() }).unwrap();

    s.mark_read(&buddy("ic"), &asked.channel_id, &answer.id).unwrap();
    s.mark_read(&buddy("ic"), &asked.channel_id, &asked.id).unwrap();
    assert_eq!(unread(s, "ic"), 0, "a cursor only moves forward");

    let failing = s.post(&buddy("mid"), dm("mid", "ic"), request("will fail", "r2")).unwrap();
    let claim = s.claim_run(60_000).unwrap().unwrap();
    s.settle_run(&claim.run.id, &claim.lease_token, Outcome::Failed { code: "provider_error".into(), error: "boom".into() }).unwrap();
    assert_eq!(s.get_post(&buddy("mid"), &failing.id).unwrap().request, RequestState::Failed);
    let notice = s.claim_run(60_000).unwrap().unwrap();
    assert_eq!((notice.run.buddy_id.as_str(), notice.run.input), ("mid", RunInput::FailureNotice { run_id: claim.run.id }));
}

#[test]
fn two_answerers_race_and_exactly_one_answer_lands() {
    let f = fixture();
    let path = f.path.to_str().unwrap().to_string();
    let mut s = Store::open(&path).unwrap();
    for round in 0..10 {
        let asked = s.post(&buddy("mid"), dm("mid", "ic"), request("which?", &format!("ask-{round}"))).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let results: Vec<Result<Post, CoreError>> = [buddy("ic"), Actor::Owner]
            .into_iter()
            .map(|who| {
                let (barrier, path, id) = (barrier.clone(), path.clone(), asked.id.clone());
                std::thread::spawn(move || {
                    let mut store = Store::open(&path).unwrap();
                    barrier.wait();
                    store
                        .answer(&who, AnswerInput { request_id: id, body: format!("{who:?}"), evidence: vec![], key: format!("a-{round}") })
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect();
        let won: Vec<&Post> = results.iter().flatten().collect();
        assert_eq!(won.len(), 1, "round {round}: {results:?}");
        let thread = s.list_posts(&Actor::Owner, PostQuery::Thread { root_id: asked.id.clone() }, None, 10).unwrap();
        assert_eq!(thread.posts.iter().map(|p| &p.id).collect::<Vec<_>>(), [&won[0].id], "round {round}: no orphan answer post");
        assert_eq!(s.get_post(&Actor::Owner, &asked.id).unwrap().request, RequestState::Answered { answer_id: won[0].id.clone() });
    }
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

#[test]
fn team_admin_is_owner_only_and_refuses_a_reporting_cycle() {
    let mut f = fixture();
    let s = &mut f.store;
    let hire = |key: &str| BuddyCreate {
        workspace_id: WS.into(),
        slug: key.into(),
        name: key.into(),
        role: "r".into(),
        manager: ManagerRef::Buddy { id: "lead".into() },
        provider: Some("codex".into()),
        model: None,
        reasoning_effort: None,
        key: key.into(),
    };
    let folder = WorkspaceInput { name: "Docs".into(), root_path: "/tmp/docs".into() };
    assert!(matches!(s.create_workspace(&buddy("lead"), folder.clone()), Err(CoreError::Denied(_))));
    let docs = s.create_workspace(&Actor::Owner, folder.clone()).unwrap();
    assert_eq!(s.create_workspace(&Actor::Owner, folder).unwrap().id, docs.id, "one workspace per folder");
    // A manager is not the owner: team edits stay owner-only (02 §8.3 team_admin).
    assert!(matches!(s.create_buddy(&buddy("lead"), hire("x")), Err(CoreError::Denied(_))));
    let new = s.create_buddy(&Actor::Owner, hire("x")).unwrap();
    assert_eq!(new.manager_id.as_deref(), Some("lead"));
    let cycle = |manager: &str| BuddyUpdate {
        buddy_id: "lead".into(),
        changes: BuddyChanges { manager: Some(ManagerRef::Buddy { id: manager.into() }), ..BuddyChanges::default() },
        key: format!("cycle-{manager}"),
    };
    assert!(matches!(s.update_buddy(&Actor::Owner, cycle("ic")), Err(CoreError::Invalid(_))), "ic reports (via mid) to lead");
    assert!(matches!(s.update_buddy(&Actor::Owner, cycle("lead")), Err(CoreError::Invalid(_))), "nobody manages themselves");
    let top = BuddyUpdate {
        buddy_id: "mid".into(),
        changes: BuddyChanges { manager: Some(ManagerRef::Nobody), name: Some("Mid".into()), ..BuddyChanges::default() },
        key: "top".into(),
    };
    let mid = s.update_buddy(&Actor::Owner, top).unwrap();
    assert_eq!((mid.manager_id, mid.name.as_str(), mid.role.as_str()), (None, "Mid", "role"), "absent fields are unchanged");

    // Archiving cancels the buddy's queued runs: an archived buddy is never claimed again.
    let queued = s.enqueue_run(&Actor::Owner, chat("peer", "t1", "c-peer")).unwrap();
    let archive = BuddyUpdate {
        buddy_id: "peer".into(),
        changes: BuddyChanges { status: Some(BuddyStatus::Archived), ..BuddyChanges::default() },
        key: "archive".into(),
    };
    s.update_buddy(&Actor::Owner, archive).unwrap();
    assert_eq!(s.get_run(&queued.id).unwrap().status, RunStatus::Cancelled);
}

#[test]
fn startup_recovery_ends_runs_a_dead_host_held() {
    let mut f = fixture();
    let s = &mut f.store;
    // A request whose recipient was mid-run when the host died must stop awaiting and tell its
    // sender, exactly as a failed settle would; otherwise it waits out a 24 h foreground lease.
    let ask = s.post(&buddy("mid"), dm("mid", "ic"), request("build it", "ask")).unwrap();
    let claim = s.claim_run(86_400_000).unwrap().unwrap();
    assert_eq!(claim.run.input, RunInput::Post { post_id: ask.id.clone() });
    let waiting_chat = s.enqueue_run(&Actor::Owner, chat("lead", "turn", "c-lead")).unwrap();

    let recovery = s.recover_runs().unwrap();
    assert_eq!(recovery, Recovery { interrupted: 1, abandoned_chats: 1 });
    let run = s.get_run(&claim.run.id).unwrap();
    assert_eq!((run.status, run.error_code.as_deref()), (RunStatus::Failed, Some("interrupted")));
    assert_eq!(s.get_run(&waiting_chat.id).unwrap().status, RunStatus::Cancelled);
    assert!(matches!(s.get_post(&Actor::Owner, &ask.id).unwrap().request, RequestState::Failed));
    let notice = s.list_runs(RunQuery::Buddy { buddy_id: "mid".into() }, 5).unwrap();
    assert!(notice.iter().any(|r| r.input == RunInput::FailureNotice { run_id: claim.run.id.clone() }));
    assert_eq!(
        s.settle_run(&claim.run.id, &claim.lease_token, Outcome::Complete { text: "late".into() }).unwrap_err().code(),
        "lease_lost"
    );
}
