# Thread closeout handoff — 2026-09-22 (owner thread 83839595)

Owner asked to close out this thread: record incomplete work, insights to disc,
task comments, and channel posts for parties that benefit. This file is the
durable disc record; Task records remain authoritative for status.

## 1. Incomplete / impartial work (all open items preserved, none completed here)

Active Lead-owned (from `get_current_work` full read 2026-09-22T07:18Z, rev-checked):

- `6efaffd1` Deliver lean Buddy repairs (in_progress, rev12) — 2 OPEN:
  `Implement and verify justified API/runtime improvements`,
  `Record delivery evidence and remaining limitations`.
  Next: on correlated UI/Release returns inspect artifacts before acceptance;
  Release must remove the extra project-evidence validator (Lead packaged
  acceptance rejection); after evidence fix passes complete `f5e8e43a`, then
  close superseded ancestors `9864f34e` and `37f2780f`. New surface needs
  manual owner review; recall deferred.
- `40cf0d8d` Correct inform delivery to background-disabled recipients
  (in_progress, rev4) — todo0 done (repro + triage accepted), todo1
  in_progress (preview-only fix), todo2 open (delivery evidence).
  Finding: real send already decouples plain inform (`informDelivered` skips
  enqueue; receipt delivered/complete); only preview couples inform to the
  execution gate via `previewCoordinatedMessage` with no runId
  (vendored `coordination.js:529/550`, Release triage `35a5833f` comments
  `c9f7d4ae`+`915df903`). Fix is preview-returns-allowed when the existing
  `informDelivered` predicate holds, else existing call. Config-carrying /
  deferred / self / continuation informs keep gates per `21810ca`.
  Needs: before/after preview receipts + regression holding work/request
  blocked, typecheck + relevant tests. Contract expansion needs owner review
  per 2026-09-16 no-growth rule.
- `d157d274` Rename mailing lists to channels (backlog, rev2) — 4 OPEN
  awaiting owner: rename scope (display-only vs full tool/table/route),
  implement chosen scope + successor to 2026-09-21 decision, archivable
  semantics (who archives, read/write after archive, retention), unified MCP
  shape (send targets channel, inbox covers channels, three-way rule).
- `f5e8e43a` Correct Buddy edits/identity/diagnostics (in_progress, rev14,
  child of `9864f34e`) — A1–A7 + evidence-preservation todo done
  (`7966f22048da` pushed: `dropEmptyEvidenceArrays` at three server funnels;
  `buddy-evidence-preservation.test.ts` 2 pass; cause: explicit `[]` wipe at
  store merge, omitted already preserved; `server/dist` predates fix, refreshes
  on next build). Exact history browser acceptance stays with UI Task.
- Superseded ancestors still `enabled` only until children finish, then cancel
  (cancellation fences descendants): `37f2780f` (rev18), `9864f34e` (rev21).
- `9ef2b573` Blocked-work recovery (blocked, rev2) — implementation +
  verification complete (`14465ac`, 25 tests + typecheck), response prepared
  at `agent_notes/buddies/20260914_wave-recovery/ceo-response.md`, but
  UNDELIVERABLE: native permitted directory exposes no Wave_sim CEO contact
  or dispatch route. Next: owner provides authorized route, then send.
- Deferred backlog (paused, not lost): `b55e2554` (4 open, OS containment /
  cumulative spend / quotas / schedule-wake binding), `de5267b7` memory
  curation pilot (4 open), `cdae619b` usage reporting (4 open — premise
  correction 2026-09-20: codex counters EXIST in `usage-routes.ts`; missing
  piece was ATTRIBUTION, fixed in `bacc578` session-id join; re-scope on
  revisit), `4f875aff` wakeup coalescing (3 open), `556cc4a6` recall bounds
  (2 open), `814f77fd` worker model-key discoverability (3 open, needs owner
  manual review before any new surface).

Supervised / blocked (from inbox + team-state 2026-09-22):

- UI `95592e35` (blocked, rev15): authorized UI/settings/hierarchy/history
  slices complete; only owner approval for bounded saved-grant inventory
  remains. Awaiting owner reply to `message_66ec2c6a` (status pending since
  2026-09-16). If approved, implement only the reviewed bounded read, reuse
  preview/apply; else retain known-pair support + document limit.
- Mailing lists `ee12e5dd` (blocked, rev10): implementation + substantive
  verification complete; blocked on foreign PID 6688
  (`node tools/dev-supervisor.mjs`) owning the shared dev-supervisor task —
  rerun `pnpm test:package` only after its owner releases it; do not alter
  mailing-list commits unless that test shows a real defect.
- Pending approval `message_66ec2c6a` (pending, owner_reply): manual review
  before any implementation — UI 95592e35 blocked on inactive-grantee
  discoverability.
- Team-state 2026-09-22T07:19Z summary: ZERO running assignments. Standing
  UI/Release "are running" phrasing in parent next_action is stale
  (from 2026-09-16). Exhausted roots (`8a569e04` limits exhausted,
  `63f53187` limits exhausted, `9a988692` limits exhausted) are NOT retried.
  Retryable: `f4681f2e` (600s timeout), `783bd5c2` (held/cancelled),
  `0c330b0c`/`d688b3a6`/`3d8dc807` (release follow-ups) — no retry taken here.

## 2. Insights recorded (no new implementation in this turn)

- Inform triage changes the fix shape: preview-only, not send-path. Real-send
  decoupling already correct; do not "fix" the send path and risk widening
  the contract. Regression must hold work/request blocked.
- Evidence-loss cause corrected: rev5→6 wipe was explicit `evidence:[]`, not
  omission (Release diagnosis `message_296d562b`, `store.js` merge). Omitted
  already preserved; fix drops empty arrays at three funnels. `server/dist`
  staleness is expected (untracked build output).
- Commit-not-tree verification rule adopted as review checklist (from
  context-meter handoff `message_f0c90705`): verify the COMMIT with
  `git grep <symbol> HEAD` before calling delivery verified (lesson
  `48724f4`/`afbcff3`). Applies to pending UI/Release/mailing-list acceptance.
- Context-meter handoff (Claude Opus work, `buddy_project_3d52671d`, 6 commits
  on `refactor/reduce-sprawl-2026-09-06`) received but not acted on here: two
  defects touch Lead area — read `message_f0c90705` + linked
  `agent_notes/20260920T074430Z_context-meter-provider-truth-session-file-half_*`
  before next planning. Partial-staging guard adopted as checklist only.
- Usage-reporting premise half-corrected (`cdae619b` evidence 2026-09-20):
  codex token counters existed; attribution fixed by `bacc578`. Revisit = join
  usage to conversations, not obtain counters.
- Channel semantics live: `buddies-dev` (`list_4bd52262`) open; usage guide at
  `agent_notes/buddies/20260922_channels-run-projects-and-use-channels.md`
  (three-way Mail/Task/Channel rule, cursor rule, idempotent post keys).
  Prior 2026-09-21 decision rejected "Channels" as a NEW primitive, so rename
  is display-vs-full — owner to choose (tracked on `d157d274`).

## 3. Where this closeout is communicated

- Task comments: `6efaffd1` (closeout pointer + stale-team-state correction),
  `40cf0d8d` (triage→fix handoff for implementer), `d157d274` (owner decisions
  needed), `9ef2b573` (blocked-delivery restatement). Discussion about a Task
  stays on the Task.
- Channel: one `handoff` post on `buddies-dev` linking this file + affected
  Task IDs. Posts wake nobody; action still via send/update_project.
- Memory: one durable note with decision evidence pointers (identity lessons
  only; status stays in Tasks).

## 4. Re-entry pointers (next session)

1. `get_current_work` + `get_inbox` first; Tasks own status.
2. Inform fix: implement preview-only change on `40cf0d8d`, attach before/after
   preview receipts + work/request-still-blocked regression.
3. Channels rename: owner picks scope; then implement + successor note.
4. Wave_sim CEO response: needs authorized route before send.
5. Mailing-list `test:package`: only after PID 6688 released by its owner.
6. Do not retry exhausted roots; do not push main without explicit ask.

## 5. Addendum 2026-09-22T07:20Z (second closeout pass, owner thread 6975f9e7)

- Two closeout passes ran concurrently for the same owner ask (turn inputs at
  07:18:30Z and 07:18:35Z). Both wrote disc records, Task comments and one
  `handoff` post each on `buddies-dev`; nothing conflicted. Records:
  this file, `20260922_thread-closeout-channels-mail-unification.md`,
  `20260922_channels-run-projects-and-use-channels.md`. All three committed
  together so concurrent sessions cannot drop them.
- `pnpm test:package` rerun at 07:20Z: PID 6688 is gone, but the test still
  fails before `npm pack`. Cause is structural: `npm pack` → prepack
  `pnpm build` → `tools/dev-supervisor.mjs --task build`, which refuses while
  ANY dev runtime owns this checkout (today PID 76118, task `dev`, since
  06:55:26Z). So `ee12e5dd` is blocked on "no dev runtime in this checkout",
  not on one foreign PID. Options: run when dev is down, run from a separate
  worktree, or owner-approved `pnpm dev:replace`. Not replaced here.
- Decision-note citation check: `get_document` on note
  `2026-09-22T05:55:30.018Z:150f2788-…` returned an empty body while `recall`
  finds the same proposal only via the disc files. Treat the DISC files and
  Task `d157d274` as the authoritative record of the owner's channels
  proposal (rename for sure + archivable + unified send/read surface, all
  PROPOSED, none accepted). Revision `:0` means the note was never written
  (a real note, `…37d4b2c9`, reads back at `:1` with content). Replacement
  decision note: `2026-09-22T07:22:16.233Z:8cd1c0f6-002f-4641-8d96-bd9b129814c0`.
  Closeout lessons note: `2026-09-22T07:22:30.034Z:0ac8d072-2681-4c4f-8ce1-a0144b857020`.
  Rule going forward: read a note id back with `get_document` (revision > 0)
  before citing it in a decision record; `recall` cannot catch an empty note.
