# Final approval proposal: dependable returns within the existing Buddy system

2026-09-22 · Buddies Development Lead · **Proposed; awaiting owner approval.**

## Decision requested

Approve one bounded repair: reproduce and correct return-context discontinuity,
improve the existing return briefing, and clarify two existing MCP descriptions
and the operator guide. Preserve the current Buddies, Mail, Tasks, Conversations
and Runs model. No new orchestration system or product concept is proposed.

The owner requested this final proposal and explicitly prioritized simplicity.
That is an accepted scope constraint, not approval to implement these changes.

## What has already changed

The preceding work produced two review/proposal files and append-only native
evidence/decision notes. This turn adds this proposal and its decision note.
No runtime implementation, database schema, MCP signature or response shape,
Buddy soul, staffing, production configuration or work execution was changed
by these review turns. No implementation commit, deployment or restart occurred.

The checkout baseline remains `7d66807ba687423b0116feea223bd12b3d35c123`.
Before this file was written, git status listed only the two untracked review
documents. This describes this work, not every historical change in the product.

## Data model: no change

| Existing authority | Continues to own |
|---|---|
| Buddy | Identity and role |
| Task/project and todos | Outcome, accountable owner, acceptance criteria, evidence, next action and blockers |
| Mail | Assignment/reply correlation and existing actor/approval provenance |
| Conversation | Launch context, authorized audience and accumulated review history |
| Run / managed request | Execution, waits, limits and continuation |

No new entities, tables, columns, required JSON fields, statuses or migrations.
No persisted integration-owner, outcome-summary, stalled flag or Decision object.
The proposed briefing is rendered from existing accessible records at return
time; it is not another mutable source of task state.

Existing explicit links identify the parent/source project. Missing links remain
missing and are stated in the briefing; do not guess from titles or add a linking
subsystem. An engineer must establish whether the existing metadata suffices for
the reproduced restoration defect. If a schema/contract expansion is needed,
return that finding for review rather than silently expanding this approval.

## MCP: existing tools, unchanged schemas and results

No tools added or removed. No argument or return-shape changes. Permissions,
admission, preview/idempotency, evidence requirements and execution semantics stay
with their existing authorities. Edit explanatory wording in exactly two tools:

**`send`: put the existing delivery distinction first**, using this wording:

> Use `work` for a recipient-owned Task that should continue across attempts within
> explicit bounds; `request` asks for one response; `inform` has no reply obligation.
> For a delivery outcome, include integration and acceptance in the responsible
> lead's Task. A standalone return review does not inherit the worker's execution
> allowance. An already managed lead continues through its existing request;
> do not launch a parallel successor.

Retain the current scope, recovery, configuration and authority explanations;
replace overlapping wording rather than duplicating it. No-reply is not a new
promise that informs cause no execution.

**`update_project`: replace its final blocking guidance** with:

> Block the affected todo when independent authorized work remains. Mark the
> whole project blocked only when no useful authorized progress is possible;
> this causes its current managed-work request to settle as blocked. A resolved
> terminal block uses the existing fresh bounded work-send path after effects
> inspection. A failed acceptance check normally creates repair work.

This explains current behavior. It adds no validation gate, confirmation modal,
new status, automatic restart or additional required parameter.

## Systems design: two changes in the existing return path

### 1. Preserve the authorized review conversation

**Before:** the incident records show the same return creation command opening a
new conversation without its earlier saved branch/handoff and review history.
The cause is not yet established.

**After:** valid return routing restores/reuses its existing management context
through the current conversation infrastructure. Supported restart/configuration
paths preserve the authorized history. If context is genuinely unavailable,
the existing return briefing explicitly says what is missing and supplies only
the context recoverable within current access.

Use existing creation, persistence, admission and audience rules. A changed scope
must not force reuse of private history; a restored history must not replay old
grants, change current model configuration or extend limits. No second context
store, new scheduler, automatic retry loop or private-chat mirroring.

Required engineering evidence: reproduce the discontinuity and identify its
cause before claiming a fix. A plausible refactor without a failing case does
not satisfy this item. If it cannot be reproduced, return the bounded evidence
and open question; do not replace the return architecture speculatively.

### 2. Put current responsibility before detailed return evidence

**Before:** the callback foregrounds the child assignment/report and generic
continue/redirect/stop guidance; the incident's final prompt was 52,826 characters.

**After:** the same callback starts with a compact briefing drawn from current,
accessible records:

1. Review mode: standalone turn or existing managed work, plus that request's
   current limits/wait state when known. Never substitute the child's allowance.
2. Explicitly linked parent outcome: Task ID/revision, owner, remaining criteria,
   todo status and recorded next action. State when the parent is unavailable.
3. Child result: what returned, evidence references and reported limitations.
4. Relevant restriction provenance: exact accessible decision/message actor and
   approval record. A worker's claim of an owner decision is not verification;
   when its source cannot be read, label the attribution unverified and retain
   the constraint pending clarification rather than treating absence as permission.
5. Action instruction: inspect the result and take the next authorized action on
   the remaining outcome, or identify the specific unavailable prerequisite.

This is an internal prompt projection, not an MCP response contract. Separate
recorded facts from worker claims. Preserve ordinary artifact access and full
evidence references; remove duplicate boilerplate/transcript copies where those
references are available. The incident fixture's new prompt should be smaller
than the baseline, not a new block appended to an already large prompt.

The lead still makes the work decision. The host does not decide that a failed
test authorizes more work, interpret prose as permission, or renew execution.
No new automatic continuation behavior is proposed.

## Operating guidance: use what already exists

Update the existing operator guide's launch/return section, without introducing
a new mandatory skill or workflow object:

- One existing lead-owned Task carries the integrated deliverable and combined
  acceptance criteria. Send bounded managed work on that Task when execution is
  requested and authorized; creating/updating the Task alone does not launch it.
- Keep specialist assignments small enough for that lead to consume. A child
  may correctly finish while its parent's integration remains unfinished.
- Keep an external publishing blocker on the affected work while permitted local
  work proceeds. Workers respect manager constraints; the responsible manager
  revises its plan within actual authority or seeks the exact missing decision.
- A review ends with an actual authorized action or a precise justified stop,
  not merely a promise to continue. Genuine waiting, explicit stops and exhausted
  limits remain valid stopping conditions.

## Evidence required for acceptance

1. **Continuity:** a real conversation/return boundary regression reproduces the
   defect, then passes with the fix. Exercise supported restoration and config
   changes; verify correlation, authorized history and no duplicate review run.
2. **Context:** verify the actual constructed provider input contains the current
   linked parent criteria and correct mode/actor/limits, labels unavailable data,
   and preserves audience boundaries. Do not assert against implementation text.
3. **Follow-through:** a small isolated local Git fixture returns code with a
   combined check still failing. The lead consumes the return, integrates or
   assigns the authorized integration, corrects/dispatches the failure and retests.
   The parent is completed only after its criteria pass. Publishing remains held.
4. **Controls:** genuine complete work, human stop, exhausted allowance, missing
   authority, unavailable external dependency and inaccessible parent/history
   must not cause duplicate work, invented approval or unauthorized resumption.
5. **Claims:** scripted tests establish mechanics; a bounded real-agent replay
   establishes observed model behavior. Define and report replay limits/cost
   under existing authorization before running it; no open-ended campaign is
   included. Repeated small cases are useful but do not prove a success rate.

Verify the delivered commit independently of unrelated dirty-tree changes.
Provide the exact commit(s), before/after evidence and remaining limitations.
No production restart/deployment or Wave Sim team activation is included.

## Explicitly outside this proposal

Dashboard/idle-state additions, soul edits, notification/wakeup policy changes,
new budget behavior, mandatory report formats, PR/release graphs, autonomous
stalled-work restarters, extra agents and broad refactoring. These are excluded
to keep this patch focused; earlier ranked ideas are not a bundled authorization.

If approved, record the owner decision and create one authoritative implementation
Task with the criteria above. The engineer determines the minimal source changes;
the lead owns review and acceptance through completion of this bounded repair.

## Evidence and history

This narrows [the ranked recommendations](2026-09-22_completion_updates_ranked.md)
at SHA-256 `953e6308aba0526b51a83e7559a47a136121fe8751141540a834c68a3b4af6ae`;
it does not erase their reasoning. Native predecessor note:
`2026-09-22T11:57:44.528Z:6e3e2683-63ea-4ec7-a144-c516a2f8033d`.

The [disk case study](/Users/nicholasbardy/.codex/artifacts/wave-sim-closeout-20260922/CASE_STUDY.md)
is pinned at SHA-256
`7f92168e6524817f6e06e5123c9f2b41657386274732d9dea6006182bc1dee68`,
captured September 22. Preserved finding: the same return command used a new
conversation without the earlier branch/handoff metadata; this establishes
discontinuity, not its cause or that history alone would ensure completion.

The accepted [lean core](CORE_DESIGN.md) at source baseline
`7d66807ba687423b0116feea223bd12b3d35c123` remains the governing model.
Reason for choosing this scope: repair observed continuity and make existing
responsibility/authority usable without introducing competing state or execution.
Reconsider broader changes only after this repair is evaluated and a remaining
workflow failure cannot be addressed through the existing primitives.
