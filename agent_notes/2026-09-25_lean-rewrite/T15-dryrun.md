# T15 dry run (2026-09-26 ~02:47 local; lean/integration f6f629b; worktree .claude/worktrees/lane-t15, branch ops/t15-dryrun)
Snapshots in `db/t15-dryrun/`: `.backup` of buddies.sqlite (v33, 98 MB), APFS clones of conversation-config, owner-channel-reads.json, 49 soul files (`souls/<abs path>`). No live file written; no transcripts copied.

**Buddies import 2.6 s, verify EXIT 0, ok=true.** Counts equal on every table: buddy 52, workspace 16, task 1615, channels 34 public / 66 direct / 180 task, members 127, posts: direct 882, answered request 269, public 489, task 968; post_read 61+34; doc 1735, doc_revision 2803, schedule 16, run 2776, conversation 1045, event 22109.
Byte/hash checks all ok: messages (613 rows; by sender 25/25, recipient 36/36, channel 66/66 groups), answers 269/269 identical, channel posts 489 (19/19, 89/89), task comments 968 (261/261), memory revisions 241 + heads 156/156, knowledge docs 1579 / revisions 2562 (185/185), links 706, read cursors 283, ordering 2622, revision chains 2803/1735. Soul files: 52 unchanged (45 match, 4 match without header, 3 with no path).
**Records**: v1->v2 migration 8,180/8,180, 0 failures (chat 6450, buddy 1178, builder 55, worker 497), 9 s. Import 8,180/8,180 in 1.5 s, 1 reject (a stray by-session `.tmp`, the same as T23b). Verify **ok=true**: 8,180 hash-equal, rejects 1/1 byte-equal, index 9,120/9,120.
No importer bugs found.

**Blockers for the live swap (runbook step 0):**
1. The main checkout has uncommitted edits in 38 of the files the merge changes. `git merge` will refuse, and stashing is forbidden. Those edits must be committed first.
2. `git merge-tree feat/channels-project-view-2026-09-22 origin/lean/integration` gives 2 conflicts: `client/src/mobile/channels/ChannelsMobile.tsx` (content) and `server/test/channel-conversations.test.ts` (modified on feat, deleted on lean). The feat branch has 3 commits that lean lacks: 92e8692, 6535b62, a2e4135.

**Queued runs: 20 (0 running).** 19 belong to buddies with background work on and start when the runner wakes. 1 is held (background off). On first start, `recoverRuns` has no running rows to interrupt, and the runner takes the queued ones subject to each buddy's `max_active_runs` of 5. Basketball PM alone has 8.
- A. 12 failure notices, 0.2-10 d old. CANCEL.
  - 6 report v33 `Parent Buddy conversation does not match the delegating Buddy scope` failures inside the basketball team.
  - 5 are "Interruption report unavailable: active-run limit / 8 machine slots" (held capacity cancels) for the basketball PM and managing-partner.
  - 1 (builder-f231) is a notice about a run that COMPLETED, which is suspicious: v33 queued a failure notice for a successful run.
  - Running them spends 12 turns reporting old failures.
- B. 2 requests. CANCEL.
  - fa2b "Acceptance/refusal of Product geometry handoff" (12.3 d; CEO coordination, stale).
  - d1c6 svg "path lane status + SFT readiness" (5.2 d, held because background is off; it would never start anyway).
- C. 4 replies to the basketball PM, "Season Readiness W2/W3/W4" ownership, 1.1 d old. OWNER CALL: run if Season Readiness 2026-27 is still the plan, otherwise cancel.
- D. 2 replies, 0.3 d old: fa2b "W2-E SceneRenderer redesign" (owner-approved) and 8f4d "Execute speed project on Opus 5.5" (owner directive). RUN.

Runbook step 6 has a copy-paste cancel for each group. It is the same UPDATE that `cancel_run` does for a queued run.
Runbook: `T15-RUNBOOK.md`. Build note: `lane-t15/crates/target` (private, not the shared target) still exists: deleting it was blocked by the dcg guard and cargo clean is barred by the coordinator. Owner: remove it by hand.
