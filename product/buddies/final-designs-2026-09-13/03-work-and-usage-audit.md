# Work, usage and coverage audit

September 13, 2026 · Dated observations, not a replacement work tracker.
The [native snapshot](native-observations.json) retains exact project IDs,
revisions, criteria, checklist states, audit IDs and execution receipts.
The earlier [pending delivery handoff](../../../agent_notes/2026-09-13-buddy-pending-handoff.md),
its [95-item appendix](../../../agent_notes/2026-09-13-buddy-pending-handoff.open-work.md)
and [evidence snapshot](../../../agent_notes/2026-09-13-buddy-pending-handoff.evidence.json)
are incorporated through the [successor mapping](06-handoff-and-limits-successor.md).

## Scope and counts

Read the current inbox, all paginated work returned for Buddies Development Lead
and its two direct reports in `unleashd`, capabilities, team execution metadata,
their automations and the Lead's available run history. Work/inbox/team pages
returned no next cursor/offset. The Lead run request returned 97 records against
a limit of 100. Reviewed current schemas and the versioned design/repair reports.
This was not a reread of every historical provider transcript or every unrelated
team/workspace, and it does not establish production Font Maker/Wave_sim state.

Before creating this documentation task, the snapshot contained **45 projects:
23 open, 22 closed, with 95 unfinished checklist items on open projects**. The
previous handoff's 22-open count predates the new memory-reviewer evaluation
project, which has no checklist rows. This review project is excluded from those
baseline counts. Several August projects contain superseded requirements and
duplicated checks; 95 unfinished rows is not 95 reproduced current defects.

## Work that still needs attention

| Work | Native observation | What remains |
|---|---|---|
| UI repair, `95592e35` | Blocked, revision 5, four unfinished todos | Former-lead saved grant discovery/revocation; preservation of unsaved permission drafts; both-shell validation; exact original-history browser check |
| Release integration, `a2047be3` | Blocked, revision 4, three unfinished todos | Attribute/preserve mixed work, assemble repairs and verify final integrated delivery |
| Repair delivery parent, `37f2780f` | Blocked, revision 13 | UI/release completion, historical backlog reconciliation and final evidenced return |
| Readiness diagnostics, `19703c1b` | Ready, revision 1 | Separate configuration, admission and delivery questions; show authorized readable workspace names |
| Memory reviewer curation, `6003ef3a` | In progress, revision 1 | Complete the ten-category evaluation and record final validation; source/docs already contain revised curation guidance |
| History/privacy repair, `f5e8e43a` | In progress, revision 8; one remaining todo | Browser acceptance for original conversation `7d9d117f-7a13-46e2-bf6a-95da591d6e2b` |
| Owner/team readiness, `9864f34e` | In progress, revision 20; one remaining todo | Operational discovery/dispatch/receipt acceptance against original assignments |
| Composable-system project, `545457c2` | In progress, revision 9; two remaining todos | Reconcile live setup/follow-up evidence and separately identify any real external mailbox integration |
| Repository preservation, `5a090ee9` | In progress, revision 2 | Give each mixed historical artifact an attributable disposition |
| Buddies vendoring, `14923985` | Ready, revision 2 | Choose continued tarball vendoring versus a remote/submodule; no migration implied |
| Harness-helper documentation, `e780d7f1` | Ready, revision 2; one remaining todo | Reconcile exact old blocking/Workflow criterion with supported harness lifetimes |

Short IDs above are reading aids only; use full IDs from the snapshot in native
operations. The later appendix lists every open project, including old backlog.

### The original engineering requests are not running

The UI, release and coordinator attempts failed after **600 seconds** on September
12. At the September 13 observation all three have `successorRunId: null`,
`remainingSeconds: 0`, and `canRetry: false` because their original overall
envelopes are exhausted. Their return-delivery attempts are complete. That means
the failure messages were handled; it does not mean the engineering was completed.

The children still say “await supported timeout recovery.” That diagnosis is
stale: the reliability project `f24b0cc3` is now **done at revision 4**, and
current team metadata offers linked-successor recovery where original allowance
remains. These particular requests have none left. Resumption needs a fresh,
explicitly bounded assignment after effects inspection, not another replay of an
exhausted request. This audit did not restart them or allocate new work budgets.

The current timer definitions now live in [budgets and limits](../BUDGETS_AND_LIMITS.md#implemented-behavior).
The incident values above remain historical observations. The
[pinned sources](05-source-evidence.md) preserve the package/executor and prior
handoff evidence; no timers changed in this review.

### The foreground/return conflict is still concrete

Native capabilities returned `ready: false` with `returnPath.admission /
active_run_limit`. Both observed running Lead records are human `chat` inputs.
The installed package's admission code still compares all active records against
the global/per-Buddy background counts. Source and live readiness therefore
support the current coupling; no new foreground failure was deliberately induced.

The proposed Desk route must solve this deliberately. A lead needs background
review capacity while human chats remain independently available. Simply saying
“wake the lead” or raising `max_active_runs` does not establish that composition.

## What prior work already established

Resource consolidation, scoped knowledge, return receipts, timeout-successor
recovery and shared Team observation have substantial later implementation and
verification evidence. The September 11 five-defect note in compact memory is a
historical reopening, not the current final status of all five defects.

The September 12/13 second-pass report records package 99 passing tests, server
349 passing with three opt-in skips, client 80 passing, builds/invariants and a
separate isolated real-provider round trip. These are **historical reported
results**, not tests rerun here. They establish more than a paper design but do
not establish completion of the original UI/release assignments or full
production team adoption. The native resource version is now `2026-09-13.1`;
the owner/team contract is `2026-09-12.2`.

The native capability response now contains `documentOperationMapping`, which
narrows the older “mapping adoption unverified” caveat. That verifies this field
on the current response, not every loaded path. The revised curation prompt is
present in source while its evaluation project remains open; do not mark it
complete from the documentation wording alone.

## Usage we can actually report

| Observation | Value | Limit |
|---|---|---|
| Lead runs in available native history | 97, September 9–13 | Scoped history, not whole-product usage |
| Run outcomes | 78 complete, 9 failed, 8 cancelled, 2 running | Run completion does not imply task acceptance |
| Input kinds | 93 chat, 1 message request, 3 message replies | This sample cannot establish a background fleet's economics |
| Supervised coordination rows | 6: three failed work attempts and three completed return deliveries | Some Lead rows overlap the 97; do not sum them |
| Automations for Lead/UI/Release in scope | No definitions returned | Not a claim that the whole app has no schedules |
| Independent process heartbeat | Unavailable in team observation | `running` is a durable claim, not proof of a live process |
| Metered token/cost enforcement | Explicitly unavailable | No measured-dollar saving can be calculated here |
| Per-assignment model override | Explicitly unavailable; absent from strict native send schema | Creation accepts a model, but job-specific selection is still a feature gap |

The central usage lesson is operational: past work reached an attempt cutoff,
then spent its remaining calendar envelope without completing the assignment.
The data supports separating active effort, waiting and reliable review. It does
not prove that another model would have finished faster or cost less.

To evaluate the proposed model strategy, compare accepted deliverables using
the owner's named profiles. Include lead planning, brief construction, worker
attempts, revision cycles, review and maintenance. Record actual model snapshots,
latency, known usage and unknown usage separately. The run sample is heavily
human-chat weighted, so it cannot validate worker cost estimates by extrapolation.

## Coverage of the new owner design

| Case | Covered by owner notes? | Necessary refinement |
|---|---|---|
| Persistent long task and teammate identity | Yes | Identity survives execution and can be reused |
| Cheap implementation and capable lead review | Yes | Assignment override, scope-safe brief, actual execution snapshot |
| Reports wake the lead | Yes | Atomic message intent, durable Desk route, acknowledgment and reserved allowance |
| Sub-buddy reads peers and messages | Yes | One worker lane, authorized team view, no private-memory leakage |
| Human chat during background work | Yes | Independent admission and visible accepted input |
| Stop, crash and retries | Not specified | Preserve fences, effects inspection and terminal history |
| Task done versus result accepted | Not specified | Pinned review verdict and one task completion authority |
| Overnight waiting and effort renewal | Partly | Active effort versus deadline; explicit renewal within cumulative authority |
| Schedules and maintenance reviewer | Not specified | Schedule is an input producer; restricted maintenance is an explicit exception |
| Nested leads, retirement and reassignment | Partly | Ordinary relationships; one autonomous lane for nested worker-lead; drain before transfer |
| External outreach, GPU/training, publication | Not specified | Existing effect authority and real resource adapters remain necessary |
| Shared research and private knowledge | Partly | Published versioned briefs; current audience-scoped retrieval |

These are implementation contracts around the proposed primitives, not evidence
that the core design is wrong. Shared rooms and a workflow engine remain optional
alternatives without a demonstrated need in this latest brief.

## Backlog reconciliation

August tasks referring to hiring quotas, absent manager edges, missing memory
provisioning, a six-operation message API or design-only background work cannot
be read literally as current defects. Quotas were removed, the Lead has two
manager edges, scoped memory exists, and typed send/background work shipped.
Their broader criteria may still include unverified tests or delivery work.
Reconcile each criterion and record cancellation of superseded requirements;
do not bulk-close entire projects from these observations.

The foreground repair is documented in a dedicated handoff, but this inspected
native project list has no clearly titled foreground-capacity implementation
project. Treat that as a tracking gap to reconcile, not proof no other authorized
session is working on it. Per-assignment models and aggregate accounting are
likewise design gaps, not implemented capabilities hidden by different names.

## Complete open-project index at observation

This index is generated from the saved native observation. Re-read its full ID and revision through native tools before changing work.

| Project | State / revision | Unfinished todos | Full native ID |
|---|---|---:|---|
| Direct reports: deliberately deferred backlog | backlog / 1 | 4 | `buddy_project_b55e2554-3dae-4b14-8b81-fcd1cfec3531` |
| Work graph: task-to-task links and team membership on projects | backlog / 1 | 9 | `buddy_project_216ae739-a2ae-48a6-ae37-ec5d66b8d226` |
| AI-OS as the cross-harness workflow layer | backlog / 1 | 4 | `buddy_project_3b1d5297-3db3-4d52-8a33-9c06ec4a8573` |
| Sub-buddies test suite: 16 cases on one real fixture | backlog / 1 | 7 | `buddy_project_0334db8e-2dbc-4f60-891d-f8a3a3216bd7` |
| Ephemeral sub-agents: collapse to a harness capability, not an operation | ready / 2 | 1 | `buddy_project_e780d7f1-bb29-4a5d-b7c2-bd9cde212ce7` |
| Sub-buddies client layer: delete deriveBuddyHierarchy, fix the team badge | backlog / 1 | 7 | `buddy_project_d7c71266-2b44-4cd8-805b-cf0de53a6874` |
| Vendoring strategy: give ~/git/buddies a remote, then switch to a submodule | ready / 2 | 2 | `buddy_project_14923985-6366-4c5a-9d08-855832dcd35c` |
| Sub-buddies server layer: operations, allowlist sum, profile route | backlog / 1 | 6 | `buddy_project_816d7fa0-ffb5-4b11-aa03-cc8898fcf8f0` |
| Buddies security fixes that direct reports newly depend on | ready / 1 | 4 | `buddy_project_743485e9-ea23-46bc-b537-82f271248745` |
| Document the -p orchestration constraint and clean up stale sessions | ready / 1 | 3 | `buddy_project_7023cc14-9c47-43bf-a610-b85fb981c067` |
| The Lead has no memory path, so every journal and curated entry is lost | blocked / 1 | 5 | `buddy_project_31d73904-2352-44a4-8e3f-8f1f101fc5f3` |
| Minimal primitives: loops, schedules, goals, message passing — and the one missing wait | ready / 1 | 11 | `buddy_project_8a1f69b7-7734-47bb-853b-cf36d065e346` |
| Verify and land the @nbardy/buddies store layer for direct reports | in_progress / 1 | 7 | `buddy_project_2bce3176-5b7c-4d67-982e-128c3d65df63` |
| Delegation readiness: the Lead has no manager edge, so every delegate call is refused | blocked / 1 | 5 | `buddy_project_36a70bf6-8ebd-403f-af7f-99cfa346bd88` |
| Overhanging uncommitted work across three trees — at risk of being destroyed | in_progress / 2 | 5 | `buddy_project_5a090ee9-d90f-4531-a610-5015f22857fc` |
| Complete remaining Buddy repairs, reconcile backlog and deliver verified commits | blocked / 13 | 4 | `buddy_project_37f2780f-f766-452b-991c-eb4ca4192a9b` |
| Install and evaluate memory reviewer curation prompt | in_progress / 1 | 0 | `buddy_project_6003ef3a-c0e2-4661-ab7c-dfc9af8e6de6` |
| Finish the composable Buddy system and MCP workflow | in_progress / 9 | 2 | `buddy_project_545457c2-3c8a-4bc1-b792-702a6d3ffbb7` |
| Complete owner-to-team setup and operational readiness | in_progress / 20 | 1 | `buddy_project_9864f34e-b435-43b1-80b1-07cc51645fbe` |
| Repair remaining Buddy history, privacy and consistency gaps | in_progress / 8 | 1 | `buddy_project_f5e8e43a-9c69-4dd2-82d1-c6c953e3549b` |
| Separate setup, work admission and return diagnostics; resolve authorized workspace names | ready / 1 | 0 | `buddy_project_19703c1b-e2ad-4499-adf5-7bb16b0b6fa9` |
| Expose former-lead grant revocation and preserve permission drafts | blocked / 5 | 4 | `buddy_project_95592e35-f568-4868-9a93-03c8a8511597` |
| Preserve Buddy implementation and verify integrated delivery | blocked / 4 | 3 | `buddy_project_a2047be3-f8cb-4eed-ac2e-522e3831bee6` |
