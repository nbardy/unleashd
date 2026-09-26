//! End to end: a small v33 fixture (the real v33 schema, `tests/fixtures/v33-schema.sql`, dumped
//! from the 2026-09-25 DB copy) is imported and verified; then the verifier must catch tampering.

use rusqlite::Connection;
use rusqlite::functions::FunctionFlags;
use std::path::Path;
use unleashd_buddies::store::sha256_hex;
use unleashd_buddies_import::import::{DirectReads, ImportOptions, OwnerReads, SoulFileState, import};
use unleashd_buddies_import::verify::verify;

const SEED: &str = r#"
INSERT INTO projects VALUES ('p1','main','Main','{ROOT}','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z'),
                            ('p2','side','Side','{ROOT}/side','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z');
INSERT INTO buddies (id, project_id, slug, name, role, status, soul_path, created_at, updated_at) VALUES
  ('b1','p1','lead','Lead','lead','active','lead/SOUL.md','2026-07-01T00:00:00.000Z','2026-07-02T00:00:00.000Z'),
  ('b2','p1','worker','Worker','eng','active',NULL,'2026-07-01T00:00:00.000Z','2026-07-02T00:00:00.000Z'),
  ('b3','p1','old','Old','eng','archived',NULL,'2026-07-01T00:00:00.000Z','2026-07-02T00:00:00.000Z');
INSERT INTO buddy_projects (buddy_id, project_id, created_at, background_enabled, max_active_runs) VALUES
  ('b1','p1','2026-07-01T00:00:00.000Z',1,3), ('b2','p1','2026-07-01T00:00:00.000Z',0,2),
  ('b3','p1','2026-07-01T00:00:00.000Z',0,2), ('b2','p2','2026-07-01T00:00:00.000Z',0,2);
INSERT INTO buddy_relationships VALUES ('r1','b1','b2','manager','2026-07-01T00:00:00.000Z'),
                                       ('r2','b2','b1','consults','2026-07-01T00:00:00.000Z');
INSERT INTO owned_projects (id, workspace_id, buddy_id, title, definition_of_done, status, created_at, updated_at, execution_state, execution_epoch, priority)
  VALUES ('t1','p1','b2','Ship it','tests pass','backlog','2026-07-03T00:00:00.000Z','2026-07-03T00:00:00.000Z','paused',3,7);
INSERT INTO buddy_todos (id, buddy_project_id, title, status, position, created_at, updated_at)
  VALUES ('td1','t1','step one','open',0,'2026-07-03T00:00:00.000Z','2026-07-03T00:00:00.000Z');
INSERT INTO buddy_task_comments VALUES ('c1','t1','b2','started','["log.txt"]','2026-07-03T01:00:00.000Z'),
                                       ('c2','t1','owner','looks good','[]','2026-07-03T02:00:00.000Z');
INSERT INTO buddy_messages (id, from_buddy_id, to_buddy_id, workspace_id, buddy_project_id, purpose, body, evidence, status, reply_body,
    reply_evidence, wait_status, created_at, updated_at, replied_at, expects_reply, return_policy, command_key, root_message_id, in_reply_to_id)
  VALUES ('m1','b1','b2','p1','t1','ask','please build','[]','replied','built','["pr/1"]','none','2026-07-04T00:00:00.000Z','2026-07-04T01:00:00.000Z','2026-07-04T01:00:00.000Z',1,'{"return_conversation_id":"conv-b1"}','key-1','m1',NULL),
         ('m2','b2',NULL,'p1',NULL,'fyi','for the owner','[]','pending',NULL,'[]','none','2026-07-04T02:00:00.000Z','2026-07-04T02:00:00.000Z',NULL,1,'{}',NULL,'m2',NULL),
         ('m3','b1','b2','p1',NULL,'note','no reply needed','[]','active',NULL,'[]','none','2026-07-04T03:00:00.000Z','2026-07-04T03:00:00.000Z',NULL,0,'{}',NULL,'m1',NULL),
         ('m4','b2','b1','p1',NULL,'follow-up','on it','[]','active',NULL,'[]','none','2026-07-04T04:00:00.000Z','2026-07-04T04:00:00.000Z',NULL,0,'{}',NULL,'m1','m1'),
         ('m5','b2','b2','p1',NULL,'note','note to self','[]','replied','noted','[]','none','2026-07-04T05:00:00.000Z','2026-07-04T05:30:00.000Z','2026-07-04T05:30:00.000Z',1,'{}',NULL,'m1',NULL);
INSERT INTO buddy_lists VALUES ('l1','p1','general','chat','owner',NULL,'2026-07-05T00:00:00.000Z'),
                               ('l2','p1','random','misc','buddy','b1','2026-07-05T00:00:00.000Z');
INSERT INTO buddy_list_posts VALUES
  ('lp1','l1','p1','owner',NULL,NULL,'post','hello team','[]',NULL,NULL,NULL,'2026-07-05T01:00:00.000Z'),
  ('lp2','l1','p1','buddy','b2','lp1','post','hi','[]','t1','conv-b2','run-x','2026-07-05T02:00:00.000Z');
INSERT INTO buddy_list_reads VALUES ('b1','l1','lp2','2026-07-05T02:00:00.000Z','2026-07-05T03:00:00.000Z');
INSERT INTO buddy_memory_revisions VALUES
  ('mr1','b1','soul',1,NULL,'I lead.','seed','migration',NULL,'{}',sha256('I lead.'),'2026-07-01T00:00:00.000Z'),
  ('mr2','b1','soul',2,'mr1','I lead the team.','owner edit','owner','owner','{"via":"ui"}',sha256('I lead the team.'),'2026-07-02T00:00:00.000Z'),
  ('mr3','b1','working',1,NULL,'todo: plan','seed','migration',NULL,'{}',sha256('todo: plan'),'2026-07-01T00:00:00.000Z'),
  ('mr4','b2','soul',1,NULL,'','seed','migration',NULL,'{}',sha256(''),'2026-07-01T00:00:00.000Z'),
  ('mr5','b3','soul',1,NULL,'','seed','migration',NULL,'{}',sha256(''),'2026-07-01T00:00:00.000Z');
INSERT INTO buddy_memory_heads VALUES ('b1','soul','mr2',2,'2026-07-02T00:00:00.000Z'), ('b1','working','mr3',1,'2026-07-01T00:00:00.000Z'),
  ('b2','soul','mr4',1,'2026-07-01T00:00:00.000Z'), ('b3','soul','mr5',1,'2026-07-01T00:00:00.000Z');
INSERT INTO buddy_knowledge VALUES
  ('k1','b1','p1','owner_thread','thread-9','soul','',2,'I lead, in this thread only.','2026-07-06T00:00:00.000Z'),
  ('k2','b2','p1','project','t1','note','design',1,'use sqlite','2026-07-06T00:00:00.000Z'),
  ('k3','b2','p1','workspace','p1','long_term','',1,'repo facts','2026-07-06T00:00:00.000Z');
INSERT INTO buddy_knowledge_revisions VALUES
  ('k1',1,'I lead the team.','seed','b1','{}','2026-07-06T00:00:00.000Z'),
  ('k1',2,'I lead, in this thread only.','edit','b1','{}','2026-07-06T00:00:00.000Z'),
  ('k2',1,'use sqlite','note','b2','{}','2026-07-06T00:00:00.000Z'),
  ('k3',1,'repo facts','note','b2','{}','2026-07-06T00:00:00.000Z');
INSERT INTO buddy_automations (id, buddy_id, workspace_id, name, schedule_kind, schedule_expression, timezone, job_kind, job_payload, enabled, next_run_at, created_at, updated_at)
  VALUES ('a1','b2','p1','poll','interval','1800','UTC','prompt','{"prompt":"check the queue"}',0,NULL,'2026-07-07T00:00:00.000Z','2026-07-07T00:00:00.000Z');
INSERT INTO buddy_automation_policies VALUES ('a1',1800,1,50000,2.0,'["buddy.get_inbox"]','2026-07-07T00:00:00.000Z','2026-07-07T00:00:00.000Z');
INSERT INTO buddy_automation_runs (id, automation_id, scheduled_for, idempotency_key, status, claimed_at)
  VALUES ('ar1','a1','2026-07-07T01:00:00.000Z','a1:2026-07-07T01:00:00.000Z','complete','2026-07-07T01:00:01.000Z');
INSERT INTO buddy_automation_run_policies (run_id, max_runtime_seconds, max_iterations, max_tokens, max_cost_usd, allowed_operations)
  VALUES ('ar1',1800,1,50000,2.0,'[]');
INSERT INTO buddy_runs (id, input_key, input_kind, input_id, buddy_id, workspace_id, conversation_id, project_id, ready_at, status, policy, created_at, project_epochs)
  VALUES ('run1','chat:u1','chat','chat:u1','b1','p1','conv-b1',NULL,'2026-07-08T00:00:00.000Z','complete','{"allowed_operations":["buddy.post"]}','2026-07-08T00:00:00.000Z','[]'),
         ('run2','message:m1:request','message_request','m1','b2','p1','conv-b2','t1','2026-07-04T00:00:00.000Z','queued','{"allowed_operations":[]}','2026-07-04T00:00:00.000Z','[{"id":"t1","epoch":3}]');
INSERT INTO conversation_links (id, buddy_id, provider, unleashd_conversation_id, status, started_at, last_active_at, workspace_id)
  VALUES ('link1','b1','claude','conv-b1','active','2026-07-08T00:00:00.000Z','2026-07-08T00:00:00.000Z','p1');
INSERT INTO buddy_audit_events VALUES ('e1','b1','p1',NULL,'buddy.get_inbox','{}','2026-07-09T00:00:00.000Z'),
  ('e2','b1','p1',NULL,'buddy.post','{"body":"hello"}','2026-07-09T00:01:00.000Z'),
  ('e3','b1','p1',NULL,'owner.update_profile','{}','2026-07-09T00:02:00.000Z');
INSERT INTO buddy_command_receipts VALUES ('b1','p1','key-1','hash-1','{"id":"m1"}','2026-07-04T00:00:00.000Z');
INSERT INTO buddy_builder_hires VALUES ('conv-builder','default','b2','p1','fp','2026-07-01T00:00:00.000Z');
PRAGMA user_version = 33;
"#;

fn fixture(root: &Path) -> std::path::PathBuf {
    let path = root.join("v33.sqlite");
    let conn = Connection::open(&path).unwrap();
    conn.create_scalar_function("sha256", 1, FunctionFlags::SQLITE_UTF8, |ctx| Ok(sha256_hex(ctx.get::<String>(0)?.as_bytes()))).unwrap();
    conn.execute_batch(include_str!("fixtures/v33-schema.sql")).unwrap();
    conn.execute_batch(&SEED.replace("{ROOT}", &root.to_string_lossy())).unwrap();
    std::fs::create_dir_all(root.join("lead")).unwrap();
    std::fs::write(root.join("lead/SOUL.md"), "---\nversion: 2\nupdated: 2026-07-02\ndocument: soul\n---\n\nI lead the team.\n").unwrap();
    std::fs::write(root.join("owner-channel-reads.json"), OWNER_READS).unwrap();
    path
}

/// The shape `server/src/buddies/owner-channel-reads.ts` writes: l1 was read, l2 never opened.
const OWNER_READS: &str = r#"{"version": 1, "baselineAt": "2026-07-05T00:30:00.000Z", "marks": {"l1": {"postId": "lp1", "createdAt": "2026-07-05T01:00:00.000Z"}}}"#;

#[test]
fn import_then_verify_then_catch_tampering() {
    let dir = tempfile::tempdir().unwrap();
    let old = fixture(dir.path());
    let new = dir.path().join("new.sqlite");
    let owner_reads = dir.path().join("owner-channel-reads.json");
    let report = import(&old, &new, &owner_reads, ImportOptions::default()).unwrap();

    assert_eq!(report.dropped_read_events, 1, "buddy.get_inbox is a read");
    assert_eq!(report.non_home_memberships.len(), 1);
    // k1, Lead's thread soul, is newer than the soul head: the fold imports it as Lead's one soul.
    assert_eq!(report.memory_fold_winners[0]["doc_id"], "mem_b1_soul");
    assert_eq!(report.memory_fold_winners[0]["source_id"], "k1");
    assert_eq!(report.folded_copies, 1, "Lead's soul head is archived, not imported");
    assert_eq!(report.converted_schedules[0]["cron"], "*/30 * * * *");
    assert!(matches!(report.soul_files.iter().find(|s| s.slug == "lead").unwrap().state, SoulFileState::Present { .. }));
    assert!(import(&old, &new, &owner_reads, ImportOptions::default()).is_err(), "an existing target is never overwritten");
    assert_eq!(report.cross_channel_roots, 1, "m5's delegation root is in another channel");
    let without =
        import(&old, &dir.path().join("no-reads.sqlite"), &dir.path().join("absent.json"), ImportOptions { mark_direct_read: false })
            .unwrap();
    assert!(matches!(without.owner_reads, OwnerReads::Absent { .. }), "no owner file: skipped and recorded, not an error");

    let ok = verify(&old, &new, &report.soul_files, &report.owner_reads, &report.direct_reads).unwrap();
    assert!(ok.ok, "{}", serde_json::to_string_pretty(&ok).unwrap());
    assert!(ok.ordering.ok && ok.ordering.mismatches.is_empty());
    assert_eq!(ok.soul.split.get("match"), Some(&1));
    assert_eq!(ok.soul.split.get("no_path_empty"), Some(&2));
    assert_eq!(ok.soul.folded, ["lead"], "the soul file mirrors the v33 head; the imported soul is the newer thread copy");

    // The imported rows carry their meaning, not just their bytes.
    let conn = Connection::open(&new).unwrap();
    let row = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, String>(0)).unwrap();
    assert_eq!(row("SELECT manager_id FROM buddy WHERE id = 'b2'"), "b1");
    assert_eq!(row("SELECT request FROM post WHERE id = 'm2'"), "awaiting");
    assert_eq!(row("SELECT coalesce(request, 'none') FROM post WHERE id = 'm3'"), "none", "expects_reply = 0 owes nothing");
    assert_eq!(
        row("SELECT group_concat(member_key, ' ') FROM (SELECT member_key FROM channel WHERE kind = 'direct' ORDER BY 1)"),
        "b1,b2 b2 b2,owner"
    );
    // An inline reply is now its own post: the recipient's, in the request's channel and thread.
    assert_eq!(
        row("SELECT a.body || '/' || a.author_id || '/' || a.created_at || '/' || (a.channel_id = q.channel_id) || '/' || a.root_id || '/' || a.evidence
             FROM post q JOIN post a ON a.id = q.answer_id WHERE q.id = 'm1' AND q.request = 'answered' AND a.reply_to_id = 'm1'"),
        "built/b2/2026-07-04T01:00:00.000Z/1/m1/[\"pr/1\"]"
    );
    assert_eq!(row("SELECT root_id FROM post WHERE id = 'm3'"), "m1", "a same-channel v33 root is the thread");
    assert_eq!(row("SELECT root_id || '/' || reply_to_id FROM post WHERE id = 'm4'"), "m1/m1");
    assert_eq!(
        row("SELECT coalesce(root_id, 'top') || '/' || json_extract(legacy, '$.root_message_id') FROM post WHERE id = 'm5'"),
        "top/m1"
    );
    assert_eq!(
        row("SELECT group_concat(channel_id || '=' || last_post_id || '@' || last_post_at, ' ') FROM post_read
             WHERE reader = 'owner' AND json_extract(legacy, '$.source') IS NOT 'import:direct-read'"),
        "l1=lp1@2026-07-05T01:00:00.000Z l2=@2026-07-05T00:30:00.000Z",
        "a mark, and the baseline for a list the owner never opened"
    );
    // Imported DMs are read through their newest post, for the owner and every member (owner
    // decision, T11): v33 had no DM read state, so without this every DM post is unread.
    assert!(matches!(report.direct_reads, DirectReads::Marked { cursors: 7 }), "{:?}", report.direct_reads);
    assert_eq!(
        row("SELECT group_concat(reader || '@' || c.member_key, ' ') FROM (SELECT r.reader, c.member_key FROM post_read r
             JOIN channel c ON c.id = r.channel_id WHERE c.kind = 'direct' ORDER BY 1, 2) r JOIN channel c ON c.member_key = r.member_key"),
        "b1@b1,b2 b2@b1,b2 b2@b2 b2@b2,owner owner@b1,b2 owner@b2 owner@b2,owner"
    );
    assert_eq!(row("SELECT CAST(count(*) AS TEXT) FROM post_read r JOIN channel c ON c.id = r.channel_id WHERE c.kind = 'direct'
                     AND r.last_post_id != (SELECT p.id FROM post p WHERE p.channel_id = c.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1)"), "0");
    assert!(matches!(without.direct_reads, DirectReads::NotMarked));
    assert_eq!(
        json_row(
            &dir.path().join("no-reads.sqlite"),
            "SELECT count(*) FROM post_read r JOIN channel c ON c.id = r.channel_id WHERE c.kind = 'direct'"
        ),
        0
    );
    assert_eq!(row("SELECT json_extract(legacy, '$.priority') || '/' || status || '/' || paused FROM task WHERE id = 't1'"), "7/open/1");
    assert_eq!(row("SELECT input_kind || '/' || task_epoch FROM run WHERE id = 'run2'"), "post/3");
    drop(conn);

    // Tampering with one message body, one revision or the soul file must fail verification.
    let conn = Connection::open(&new).unwrap();
    conn.execute("UPDATE post SET body = 'please build!' WHERE id = 'm1'", []).unwrap();
    conn.execute("UPDATE post SET body = 'built!' WHERE id = 'reply_m1'", []).unwrap();
    conn.execute("UPDATE post SET root_id = NULL WHERE id = 'm3'", []).unwrap();
    // k3 (Worker's only long_term copy) is the winner imported as mem_b2_long_term.
    conn.execute("UPDATE doc_revision SET content = 'repo lies' WHERE doc_id = 'mem_b2_long_term'", []).unwrap();
    // An ordered id that is not a UUIDv7 (it would sort after every real post).
    conn.execute("UPDATE post SET ord = 'x' || ord WHERE id = 'm1'", []).unwrap();
    conn.execute("DELETE FROM post_read WHERE reader = 'b1' AND json_extract(legacy, '$.source') = 'import:direct-read'", []).unwrap();
    drop(conn);
    std::fs::write(dir.path().join("lead/SOUL.md"), "rewritten").unwrap();
    std::fs::write(&owner_reads, OWNER_READS.replace("lp1", "lp2")).unwrap();
    let bad = verify(&old, &new, &report.soul_files, &report.owner_reads, &report.direct_reads).unwrap();
    assert!(!bad.ok);
    let failed: Vec<&str> = bad.classes.iter().filter(|c| !c.ok).map(|c| c.class.as_str()).collect();
    assert!(failed.contains(&"messages_by_sender"), "{failed:?}");
    assert!(bad.revision_chains.mismatches.iter().any(|m| m.starts_with("mem_b2_long_term")), "{:?}", bad.revision_chains.mismatches);
    assert_eq!(bad.answers.mismatches, ["m1"], "the answer text must be byte-identical to the v33 reply");
    assert_eq!(bad.links.mismatches, ["m3: same-channel v33 root lost"]);
    assert!(!bad.read_cursors.ok, "owner-channel-reads.json changed since the import");
    assert!(bad.read_cursors.mismatches.iter().any(|m| m.contains("b1/")), "a lost direct cursor: {:?}", bad.read_cursors.mismatches);
    assert!(!bad.revision_chains.ok && !bad.soul.ok);
    assert!(!bad.ordering.ok, "an ordered id that is not a UUIDv7 is caught");
    assert_eq!(bad.soul.files_changed, ["lead"]);
}

/// The memory fold (lean memory design, "Migration"): every v33 copy of a Buddy's memory kind
/// competes, the newest becomes its one doc with its own chain renumbered 1..n, and every other
/// copy lands in the Buddy's memory-archive.md. A copy that is neither imported nor archived is
/// memory silently lost; the verifier's archive count is the tripwire.
#[test]
fn memory_folds_to_the_newest_copy_and_archives_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let old = fixture(dir.path());
    Connection::open(&old)
        .unwrap()
        .execute_batch(
            "INSERT INTO buddy_memory_revisions VALUES
               ('mr6','b2','working',1,NULL,'head plan','seed','migration',NULL,'{}','x','2026-07-01T00:00:00.000Z');
             INSERT INTO buddy_memory_heads VALUES ('b2','working','mr6',1,'2026-07-01T00:00:00.000Z');
             INSERT INTO buddy_knowledge VALUES
               ('k5','b2','p1','owner_thread','conv-1','working','',1,'thread one','2026-07-02T00:00:00.000Z'),
               ('k6','b2','p1','owner_thread','conv-2','working','',3,'thread two, newest','2026-07-09T00:00:00.000Z'),
               ('k7','b2','p1','project','t1','working','',1,'task copy','2026-07-05T00:00:00.000Z');
             INSERT INTO buddy_knowledge_revisions VALUES
               ('k5',1,'thread one','seed','b2','{}','2026-07-02T00:00:00.000Z'),
               ('k6',1,'thread two','seed','b2','{}','2026-07-08T00:00:00.000Z'),
               ('k6',3,'thread two, newest','edit','b2','{}','2026-07-09T00:00:00.000Z'),
               ('k7',1,'task copy','seed','b2','{}','2026-07-05T00:00:00.000Z');",
        )
        .unwrap();
    // The stored hash must be the content's, as v33 wrote it.
    Connection::open(&old)
        .unwrap()
        .execute("UPDATE buddy_memory_revisions SET sha256 = ?1 WHERE id = 'mr6'", [sha256_hex(b"head plan")])
        .unwrap();
    let new = dir.path().join("new.sqlite");
    let report = import(&old, &new, &dir.path().join("owner-channel-reads.json"), ImportOptions::default()).unwrap();
    let conn = Connection::open(&new).unwrap();
    let row = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, String>(0)).unwrap();
    assert_eq!(row("SELECT CAST(count(*) AS TEXT) FROM doc WHERE buddy_id = 'b2' AND kind = 'working'"), "1");
    assert_eq!(
        row("SELECT id || '|' || scope_kind || '|' || revision || '|' || content || '|' || json_extract(legacy, '$.source_id') FROM doc
             WHERE buddy_id = 'b2' AND kind = 'working'"),
        "mem_b2_working|buddy|2|thread two, newest|k6",
        "the gap in k6's chain (1, 3) is renumbered so the head is revision 2"
    );
    assert_eq!(
        row(
            "SELECT group_concat(revision || '=' || json_extract(legacy, '$.source_revision'), ' ') FROM doc_revision WHERE doc_id = 'mem_b2_working'"
        ),
        "1=1 2=3"
    );
    assert_eq!(report.folded_copies, 4, "Lead's soul head + Worker's head, k5 and k7");

    let archive = unleashd_buddies_import::notes::archive_plan(&old).unwrap();
    let worker = archive.iter().find(|f| f.buddy_id == "b2").unwrap();
    assert_eq!(worker.path, dir.path().join("agent_notes/buddy-notes/worker/memory-archive.md"));
    assert_eq!(worker.sections, 3);
    let (head, thread, task) =
        (worker.text.find("head plan").unwrap(), worker.text.find("thread one").unwrap(), worker.text.find("task copy").unwrap());
    assert!(head < thread && thread < task, "oldest first");
    assert!(worker.text.contains("working (project t1)") && !worker.text.contains("thread two"));

    let ok = verify(&old, &new, &report.soul_files, &report.owner_reads, &report.direct_reads).unwrap();
    assert!(ok.ok, "{}", serde_json::to_string_pretty(&ok).unwrap());
    // Dropping a folded copy from the import without archiving it must fail.
    conn.execute("DELETE FROM doc_revision WHERE doc_id = 'mem_b2_working'", []).unwrap();
    conn.execute("DELETE FROM doc WHERE id = 'mem_b2_working'", []).unwrap();
    let bad = verify(&old, &new, &report.soul_files, &report.owner_reads, &report.direct_reads).unwrap();
    assert_eq!(bad.memory_archive.mismatches, ["b2"]);
    assert!(!bad.ok);
}

fn json_row(path: &std::path::Path, sql: &str) -> i64 {
    Connection::open(path).unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
}

/// Notes leave the store as agent_notes Markdown, never as docs: a Buddy keeps notes as files
/// (2026-09-26). If the importer copied them again, `doc` would carry kind 'note', which the
/// lean schema's CHECK rejects and the verifier's class counts would no longer balance.
#[test]
fn notes_leave_as_agent_notes_files() {
    let dir = tempfile::tempdir().unwrap();
    let old = fixture(dir.path());
    Connection::open(&old)
        .unwrap()
        .execute_batch(
            r#"INSERT INTO buddy_knowledge VALUES ('k4','b2','p1','owner_thread','conv-9','note','2026-07-06T09:00:00.000Z:x',1,
                 '{"topic":"Queue choice","body":"Chose sqlite over redis: one file, no daemon.","evidence":["agent_notes/queue.md"]}',
                 '2026-07-06T09:00:00.000Z');"#,
        )
        .unwrap();
    let new = dir.path().join("new.sqlite");
    let report = import(&old, &new, &dir.path().join("owner-channel-reads.json"), ImportOptions::default()).unwrap();
    let notes_in_store: i64 =
        Connection::open(&new).unwrap().query_row("SELECT count(*) FROM doc WHERE kind = 'note'", [], |r| r.get(0)).unwrap();
    assert_eq!(notes_in_store, 0);
    assert!(verify(&old, &new, &report.soul_files, &report.owner_reads, &report.direct_reads).unwrap().ok);

    let files = unleashd_buddies_import::notes::plan(&old).unwrap();
    assert_eq!(files.len(), 1, "both of Worker's notes are from one day");
    assert_eq!(files[0].path, dir.path().join("agent_notes/buddy-notes/worker/2026-07-06.md"));
    assert_eq!(files[0].sections, 2);
    let text = &files[0].text;
    assert!(text.contains("use sqlite"), "a plain owner note is kept as typed");
    assert!(text.contains("09:00Z — Queue choice") && text.contains("Chose sqlite over redis"));
    assert!(text.contains("agent_notes/queue.md"), "evidence pointers survive");
    unleashd_buddies_import::notes::write(&files).unwrap();
    assert!(unleashd_buddies_import::notes::write(&files).is_err(), "a rerun never overwrites a note file");
}

/// The 11 v33 tables DESIGN.md deletes outright are not imported; their rows live only in the v33
/// backup. The report must count every one, so the owner sees exactly what the swap leaves behind
/// (final review, 2026-09-26: they were missing from the report). A table dropped from this list
/// without being imported would silently vanish from the owner's view of what stays behind.
#[test]
fn report_counts_every_dropped_table() {
    let dir = tempfile::tempdir().unwrap();
    let old = fixture(dir.path());
    Connection::open(&old)
        .unwrap()
        .execute_batch(
            "INSERT INTO sprints VALUES ('s1','p1','S1',NULL,'completed',NULL,NULL,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z'),
                                        ('s2','p1','S2',NULL,'planned',NULL,NULL,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z');
             INSERT INTO buddy_skills VALUES ('sk1','b1','review','skills/review.md','always','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z');",
        )
        .unwrap();
    let new = dir.path().join("new.sqlite");
    let report = import(&old, &new, &dir.path().join("owner-channel-reads.json"), ImportOptions::default()).unwrap();
    let counts: Vec<(&str, i64)> = report.dropped_tables.iter().map(|d| (d.table.as_str(), d.rows)).collect();
    assert_eq!(
        counts,
        [
            ("sprints", 2),
            ("work_items", 0),
            ("buddy_skills", 1),
            ("buddy_delegations", 0),
            ("buddy_reviews", 0),
            ("buddy_approval_requests", 0),
            ("buddy_builder_creations", 0),
            ("buddy_access_grants", 0),
            ("buddy_mail_effects", 0),
            ("buddy_mail_inbound", 0),
            ("buddy_checkpoints", 0),
        ]
    );
    assert!(verify(&old, &new, &report.soul_files, &report.owner_reads, &report.direct_reads).unwrap().ok);
}

/// A Buddy with no soul memory head is legitimate (3 builder Buddies on the 2026-09-26 snapshot).
/// Verify used to abort (exit 2, QueryReturnedNoRows) on it, blocking the swap. "No soul in the
/// source" must equal "no soul in the target", while a soul lost or invented still fails.
#[test]
fn a_buddy_without_a_soul_verifies_but_a_lost_soul_fails() {
    let dir = tempfile::tempdir().unwrap();
    let old = fixture(dir.path());
    Connection::open(&old)
        .unwrap()
        .execute_batch(
            "INSERT INTO buddies (id, project_id, slug, name, role, status, soul_path, created_at, updated_at)
               VALUES ('b4','p1','builder','Builder','eng','active',NULL,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z');
             INSERT INTO buddy_projects (buddy_id, project_id, created_at, background_enabled, max_active_runs)
               VALUES ('b4','p1','2026-07-01T00:00:00.000Z',0,2);",
        )
        .unwrap();
    let new = dir.path().join("new.sqlite");
    let report = import(&old, &new, &dir.path().join("owner-channel-reads.json"), ImportOptions::default()).unwrap();
    let run = || verify(&old, &new, &report.soul_files, &report.owner_reads, &report.direct_reads).unwrap();
    let ok = run();
    assert!(ok.ok, "{}", serde_json::to_string_pretty(&ok.soul).unwrap());
    assert_eq!(ok.soul.split.get("no_soul"), Some(&1));

    // Invented: the target has a soul the source never had.
    let conn = Connection::open(&new).unwrap();
    conn.execute(
        "INSERT INTO doc (id, buddy_id, workspace_id, scope_kind, scope_id, kind, name, revision, content, updated_at)
         SELECT 'mem_b4_soul', 'b4', workspace_id, 'buddy', 'b4', 'soul', '', 1, 'made up', updated_at FROM doc WHERE buddy_id = 'b1' AND kind = 'soul' AND scope_kind = 'buddy'",
        [],
    )
    .unwrap();
    let invented = run();
    assert!(!invented.ok && !invented.soul.ok);
    assert_eq!(invented.soul.differ, ["builder: doc_invented"]);

    // Lost: the source had a soul, the target has none.
    conn.execute("DELETE FROM doc WHERE buddy_id = 'b4'", []).unwrap();
    conn.execute(
        "DELETE FROM doc_revision WHERE doc_id IN (SELECT id FROM doc WHERE buddy_id = 'b1' AND kind = 'soul' AND scope_kind = 'buddy')",
        [],
    )
    .unwrap();
    conn.execute("DELETE FROM doc WHERE buddy_id = 'b1' AND kind = 'soul' AND scope_kind = 'buddy'", []).unwrap();
    let lost = run();
    assert!(!lost.ok && !lost.soul.ok);
    assert_eq!(lost.soul.differ, ["lead: doc_lost"]);
}
