# Handoff inventory, evidence and decision history

Review date: September 13, 2026. Author: Buddies Development Lead.

This document preserves the content and implications of all five labeled handoffs supplied
by the owner. It is an analytical intake, not a verbatim transcript archive. Quoted fragments
are retained where wording determines the decision; tool-call scaffolding is summarized.
The original prompt remains the source for discussions whose native notes are not visible
in this audience. The numbered topic documents develop the fixes; the
[meta synthesis](06-meta-synthesis.md) evaluates them together.

## 1. Scope and authority of this review

The owner's current request is to review the overlapping design discussions, write large
Markdown notes covering the issues, fixes and features, then write a meta file reflecting
on the whole collection. That authorizes this documentation work. It does not itself select
a new admission policy implementation, raise live limits, grant staffing, launch workers,
change a saved model, resume stopped requests, or deploy a package.

The supplied handoffs contain earlier owner directions and assistant recommendations.
We preserve that distinction. A proposal appearing in several assistant summaries does not
become an owner decision through repetition. Conversely, an earlier implementation detail
must not be treated as an immutable owner preference when the evidence identifies it as an
assistant choice.

The main evidence categories used throughout this dossier are:

| Category | What it establishes | What it does not establish |
|---|---|---|
| Supplied handoff | What this conversation asks us to consider; reported earlier findings and choices | Independent verification of every embedded claim |
| Native historical work record | A dated, revisioned record of an earlier decision or work criterion | The original owner transcript or fresh proof of current runtime behavior |
| Current local contract/schema | The intended and accepted local API surface at inspection | That an already running provider/backend loaded the same files |
| Source inspection | A concrete code path or guard in the captured file | Full end-to-end behavior under a real incident |
| Prior implementation report | Historical tests, repair scope and evidence claimed by that report | Tests rerun during this documentation task |
| Dated source snapshot | Exact file hash and preserved relevant text | Truth of every assertion inside that source |

Source versions are pinned in [08 — Source evidence](08-source-evidence.md). Reading a
historical design as current instructions is a known failure mode in this project.

## 2. Complete intake table

| Handoff | Primary subject | Owner direction as reported | Assistant recommendation | Main unresolved boundary |
|---|---|---|---|---|
| H1 | Foreground chats blocked by background capacity | Background execution limits must not prevent direct owner conversations from starting | Separate foreground entitlement; remove capacity failure polling; make waiting explicit | Real host exhaustion and fairness across admission classes |
| H2 | Lead/worker model separation | A lead should be able to plan/review with one model while workers execute with another; exact originating owner text is absent | Per-job execution profile; bounded compact handoff; configurable global concurrency | Permitted overrides, immutable resolution, provider sessions and aggregate accounting |
| H3 | No content | None available | None available | Missing material; do not infer its subject |
| H4 | Lightweight persistent workers | Exploration of workers retaining memory and a message address between runs | Ordinary child Buddy per independent ongoing assignment, with lightweight creation/retirement | Complete lifecycle is not proven; current archive visibility conflicts with follow-up |
| H5 | Bounded allowance and unnecessary human stops | Keep controls, but hard work should not routinely wait for a human to approve more time | Renewable task allocations inside an owner-controlled aggregate ceiling | Aggregate meter, delegated renewal authority and cancellation-preserving continuation |

The source is four substantive discussions, not five independent feature requests. Several
claims are shared observations or variations of the same principle. We should not produce
five schedulers, five kinds of task, or five duplicate work records in response.

## 3. Handoff 1: foreground capacity incident

The handoff's strongest requirement is explicit: “execution limits may throttle
autonomous/background work, but must never prevent a foreground owner conversation from
starting.” This is presented as owner direction. It is narrower than “all work requested
by an owner has unlimited resources”: a direct chat and an autonomous descendant are
different execution classes.

The reported incident concerns Buddies Development Lead in the unleashd workspace, with
`max_active_runs = 2` and `max_pending_runs = 100`. Two active runs occupied the shared
capacity. A new owner message entered the queue; a subsequently created conversation
claimed a freed slot ahead of it. The handoff reports hundreds of failed start attempts
without provider execution, disappearing input, a fallback title and generic “queued”
presentation. It identifies the conversation inbox display limit of 50 as unrelated.

The exact UTC timeline is preserved in [S01](08-source-evidence.md#s01). It includes the
older waiting conversation `89d40447-9d68-4b53-9688-67c154dbfae2`, creation at
03:28:15.562, and 458 attempt records by 03:36:16.049. The dossier does not query the live
database or re-run the incident to turn that historical report into a fresh observation.

Current source inspection corroborates the mechanism: `coordinationActiveCounts()` returns
Buddy IDs across active coordination and automation rows; `inspectBuddyAdmission()` applies
the active-run limit even to a run with `policy.foreground`; `beginBuddyChatRun()` turns a
failed claim into the generic “Conversation execution slot is unavailable” error. Runtime
code catches it, ends the start as failed, removes the last user message and restores a
queue attempt for retry. [S25](08-source-evidence.md#s25), [S28](08-source-evidence.md#s28)

The handoff proposes a package change, server cleanup, clearer desktop/mobile waiting
presentation, real-boundary tests and package provenance checks. All remain proposals in
this review. One requirement needs refinement: universal FIFO is incompatible with giving
foreground access precedence over saturated background work. Deterministic ordering must
be defined within admission classes, with any cross-class priority explicit.

## 4. Handoff 2: cross-model delegation

This discussion proposes an operating pattern: a capable lead plans and reviews, a cheaper
worker receives a compact task packet, and the worker returns artifacts and evidence. It
distinguishes three mechanisms:

1. Persistent worker Buddies can carry their own saved provider/model/reasoning settings.
2. Harness helpers can be turn-scoped and may support alternate models and bounded context.
3. Durable work sent to the same Buddy currently lacks a per-job model override and inherits
   saved recipient configuration through the existing creation path.

The native schema confirms the concrete gap: `delivery.kind = work` contains `projectId`,
`maxRuns` and `maxDurationSeconds`, with strict object validation. It contains no model or
reasoning field. The example adding those fields in the handoff is a design sketch, not a
valid present-day call. The adapter also maps only the current execution bounds. [S23](08-source-evidence.md#s23)

The handoff suggests permitted models, provider-native strings, immutable run configuration
and a configurable global ceiling, mentioning 16 or 24 as possible choices above 8. Those
numbers have no supporting load study in the supplied material. They are not selected limits.
Likewise, “cheap worker” describes a desired economic role, not a measured saving established
in this review. Coordination, retries, large handoffs and lead review can erase the saving.

Two related gaps emerge only when this is read alongside the other handoffs. First, changing
the model does not create a new worker identity or a new memory audience. Second, returning
to the lead's owner chat delivers into the Mailbox; it does not automatically start the lead
to review. An autonomous lead/worker/review loop needs an admitted background lead and a
proper return route. [S02](08-source-evidence.md#s02), [S07](08-source-evidence.md#s07)

## 5. Handoff 3: explicitly missing

The source includes the label `HANDOFF 3` and blank space. There is no issue, decision,
feature or evidence to reconstruct. This review reserves the label and records the omission.
It does not treat nearby subject matter as the lost content. Later material can be added as
a dated supplement and incorporated by linking a successor synthesis.

## 6. Handoff 4: workers whose identity survives execution

This discussion corrects an overly binary framing of permanent employees versus temporary
harness helpers. Existing direct reports are ordinary Buddies with a manager, memory,
messages, projects and automations. “Persistent” describes durable identity, not a requirement
to retain the person forever or keep a process running continuously.

The proposed sequence is assignment creation, investigation, saved learning, process exit,
review feedback to the same worker, resumed execution and eventual archive. The important
property is continuity of responsibility and knowledge across runs. One child per independent
ongoing assignment is proposed; one child per attempt, timer tick or routine self-action is
explicitly discouraged.

The earlier “no third Buddy lifetime” language is in the current direct-report contract.
This can be read consistently with assignment-lived ordinary Buddies: no new resource type
is required merely because an ordinary identity has a shorter useful life. It cannot be
used to claim that the desired creation/sleep/wake/archive workflow is already smooth.
[S03](08-source-evidence.md#s03)

The native historical project `buddy_project_e780d7f1-bb29-4a5d-b7c2-bd9cde212ce7`, revision 2,
records an August 21 owner decision to keep ephemeral sub-agents a harness capability. It
also records coarse attribution through the parent identity and a historical harness
lifetime constraint. This is evidence about that decision, not a universal assertion about
every current provider's helper implementation. A new persistent child is justified by
durable independent ownership, not by redefining the harness helper.

The archive path is a significant unresolved product conflict. Current archival preserves
stored history but omits archived Buddies from normal navigation and makes detail URLs
return 404. “Archive while retaining evidence” therefore needs a discoverable evidence path;
“message the worker tomorrow” needs a non-archived idle state or an explicitly designed
reactivation policy. These outcomes must not be conflated.

## 7. Handoff 5: allowance history and continuation

The supplied discussion traces “bounded allowance” from early runtime/iteration controls
through hourly coordination caps to managed work's fixed attempts and elapsed duration.
It preserves the owner's stated preference: controls are useful, but genuinely difficult
work should not routinely require human approval for more time.

The evidence distinguishes the motivation from the chosen mechanism. By August 21, time,
iteration and nominal token fields existed. August 24 hardened single execution ownership
after stale executors and transcripts could retain or regain authority. September 9's
coordination design explicitly latched background work paused until owner resume at hourly
caps and kept interactive access subject to active slots. September 10's background-work
document attributed “until completion and report back” to the owner, while attributing the
specific API and lifecycle to Buddies Development Lead. [S12–S16](08-source-evidence.md#s12)

The proposal is a renewable task allocation inside a hard aggregate owner-controlled
ceiling. A manager can authorize another bounded tranche using progress evidence, a changed
approach and value of the next step. Unproductive repetition calls for intervention. Routine
capacity/rate waiting resumes when eligible; a genuine hard ceiling or separately protected
action remains a distinct decision.

Current contracts do not supply measured dollar enforcement or this renewable aggregate
allocator. Managed work already continues successful unfinished attempts within its fixed
envelope; child waiting consumes elapsed duration; failed/uncertain attempts require effects
inspection; retry does not refund time. The desired behavior must be implemented through
an explicit successor policy, not by having agents send new requests to evade exhausted
limits. [S05](08-source-evidence.md#s05), [S06](08-source-evidence.md#s06), [S18](08-source-evidence.md#s18)

## 8. Chronological decision map

| Date | Evidence-backed historical position | Still useful | What later material challenges |
|---|---|---|---|
| August 19–20 | Sub-buddy/direct report uses ordinary Buddy identity and one manager; historical quota design | One identity model, atomic creation/linking, no dual hierarchy | Quotas were later removed; old “not built” status is stale |
| August 21 | Ephemeral helpers belong to the harness; early automation budgets already exist | Avoid a new employee type for a turn-local helper | Assignment continuity exceeds a helper's lifetime |
| August 24 | One durable execution owner; terminal authority does not revive; drain before release | Essential for every proposed continuation mechanism | It does not require a human approval for every planned next tranche |
| September 9 | Hourly caps latch pause; foreground shares active slots; recurring-Chief proposal uses “bounded allowance” | Persisted controls and honest limits | Foreground blockage and routine human-resume bottlenecks |
| September 10 | Complete task criteria in background and return; explicit foreground deadline; independent memory reviewer | Work/evidence authority, foreground timing distinction, maintenance separation | Fixed estimates are insufficient as long-work policy |
| September 11 | Resource consolidation accepted | Reuse projects/messages/runs/documents and shared creation | New invariants must be explicit; consolidation alone is not reliability proof |
| September 12–13 | Resource/privacy/history/coordination repairs and current operator contract | Audience boundaries, result receipts, checkpoints, linked timeout recovery | Some earlier memory says defects remain open; newer reports narrow that claim |
| September 13 handoffs | Foreground entitlement, per-job models, assignment continuity, renewable allocations | A cohesive direction can be formed | Detailed combined design is not yet accepted or implemented |

## 9. Corrections and evidence limitations found during this review

The five resource-consolidation defects in older Buddy memory must not be repeated as five
currently unfixed bugs without qualification. The September 12 report records desired-behavior
regressions for them, and subsequent documents describe more precise privacy, history and
receipt repairs. Those reports do not prove every live workflow is fixed, but they do mean
the September 11 diagnosis is a predecessor, not the only current evidence. [S20](08-source-evidence.md#s20),
[S22](08-source-evidence.md#s22), [S35](08-source-evidence.md#s35)

One historical code lookup path, `server/src/buddies/creation-service.ts`, is absent in the
current checkout. The shared creation implementation is
`server/src/conversations/creation-service.ts`. This is a citation correction, not a design
change. Source inspection also shows that the active-count query drops workspace and
foreground classification; a workspace membership value is compared against a Buddy-wide
count. The unit of concurrency is therefore another explicit design question.

Native reads at approximately 03:57 UTC used the scoped inbox and current-work tools.
Relevant receipt IDs: `audit_e63b11dc-3745-4da8-a168-c88ded5b2bdc` for inbox;
`audit_07fceae0-7b50-450d-880b-b18bc3d31c93` for the exact ephemeral-helper project read.
They provide orientation, not new instructions to resume older failed work. Native recall
for “Bounded allowance” and “task-lived” returned no matches in this audience, with audits
`audit_8dbffa01-ee48-4036-bf90-57541887aabc` and
`audit_644cb179-05ac-4a17-91f3-2cb2b2f02eca`. The user-supplied H4/H5 text is therefore the
evidence for those discussions here; this review does not claim to have reopened their
private original note records.

The source manifest captures local files at 03:59:42 UTC, repository HEAD
`1187a8b6660b95c0c60bd8fada105f015b98cc39`. The vendored package provenance names source commit
`b70c0def1373034aeff56e409adb97d66ff6d7f7`; all 26 archive files matched installed bytes.
The many unrelated working-tree changes remain outside this review. No provider scenario,
load test or runtime regression suite was run for these Markdown additions.

During final verification, the Memory guide changed concurrently. The later observation is
preserved as [S37](08-source-evidence.md#s37), alongside the original S04 snapshot. It describes
active curation of existing corrections and duplicates, preservation of decision attribution,
and reading both compact memory documents even for a no-op. It explicitly retains review
admission/scope and does not add failed-turn capture or automatic cross-audience learning.
This narrows the maintenance description without changing the dossier's worker-continuity or
authority conclusions. The separate prompt/evaluation change was not tested in this review.

## 10. How later decisions should use this intake

Use the topic documents to evaluate concrete behavior, then choose the smallest coherent
set of changes in the synthesis. Preserve owner direction and predecessor rationale;
record accepted detailed choices separately. Do not create operational tasks merely by
copying the section headings. Some are defects with direct fixes, some are unselected
features, some are constraints, and some are evidence gaps. That distinction is the
foundation for an implementation plan that does not duplicate the work already done.
