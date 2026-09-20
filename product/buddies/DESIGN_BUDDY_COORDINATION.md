# Buddy coordination: composable primitives and implementation contract

2026-09-09 design · September 10 review: core implementation is present; integration gaps
and live validation remain. See the [current system review](REVIEW_SYSTEM_SURFACE_2026-09-10.md)
for tested behavior and differences from this intended contract.

This replaces the exploratory briefs and consolidated recommendation written in the earlier
Codex worktrees. It specifies intended changes, not a claim that they are already shipped.
The current baseline is [coordination](PLANNING_PRIMITIVES.md),
[execution ownership](AUTOMATION_OWNERSHIP.md), [staffing](PLANNING_SUB_BUDDIES.md), and
[memory](PLANNING_MEMORY.md). Existing working changes must be reconciled before implementation.

## 1. The design in one page

Keep three coordination primitives:

1. **Send a message** to a Buddy or the owner, now or later.
2. **Reply to a request**, with an outcome and evidence.
3. **Repeat a message on a schedule.**

Compose these with existing **projects/todos** for commitments and **Buddy identity/memory**
for responsibility and learning. A conversation holds context. A run executes one input under
bounded authority. The inbox is a query. A queue consists of runs awaiting admission.

| Behavior | Composition |
|---|---|
| Chief delegates to lead; lead delegates to engineers | Repeated send |
| Ask a question or request review | Send with an open-text purpose |
| Continue unfinished solo work | Delayed send to self in the current conversation |
| Resume when engineers finish | Replies queue execution back in the originating conversation |
| Request revisions | Send referencing the earlier recipient conversation |
| Periodic management | Schedule repeats a check-in message |
| Parallel work / collecting results | Several sends / query their replies |
| Long project / cross-workspace program | Parent/child projects, each with an owner and workspace |
| Pause, stop, or hand off a project | Change project control/ownership; apply its gate to associated execution |
| Ask for approval | Send to owner; authenticated decision authorizes only the specified action |

There is no Chief runtime type, reviewer type, work graph executor, exchange table, separate
delivery engine, generic subscription language, or new agent lifetime. More sophisticated
management comes from choosing messages and inspecting work, not adding workflow variants.

### Corrections from the earlier iterations

- A lead ending its turn while awaiting engineers is healthy. It does not fail the request.
- Reply delivery is independent of a sender's old deadline. A new run handles it under new,
  restricted authority; the old run is never revived.
- A Buddy can have concurrent independent conversations. Serialize each conversation, not
  every conversation belonging to the identity. Use CAS for shared state.
- Reuse the current request/reply record. Do not replace it with both envelopes and exchanges.
- Queue execution in run records. Do not put competing delivery states on both messages and
  a continuation table.
- Delayed self-messages supply continuation. No separate resume-goal primitive is needed.
- Project gates and ownership handle project stop/handoff. Message lineage alone cannot.

## 2. Scope and intentional boundaries

Included: one Chief conversation; organization discovery; scoped reads/dispatch across
workspaces; existing-lead reparenting; persistent staffing; delegation; private questions;
review/revision; delayed self-continuation; scheduled checks in an existing conversation;
project pause/cancel/resume/handoff; pending approvals; observable interruption and retry.

Group chat is composed as separate addressed messages in v1, not shared transcript semantics.
Dependencies are decisions made by project owners, not machine-enforced DAG edges. External
webhooks may later authenticate and call the same send service; no connector is supplied by
this design. Execution requires a running server. Transparent crash adoption, guaranteed
arbitrary-tool live steering, OS isolation, and measured dollar-budget enforcement are outside
this release. These exclusions do not block the Chief/lead/engineer workflow.

## 3. Durable model: one authority for each fact

Use existing tables where possible. Fields below are semantic requirements, not a demand to
rename SQL tables. IDs/timestamps and existing audit metadata are omitted for readability.

### Buddy and workspace access

Retain identity, provider profile, soul/memory, active/paused/archived status, one manager,
and memberships. Hiring quotas were removed by the owner correction on September 9;
see the [Builder contract](DESIGN_BUILDER_TEAM_SETUP.md). Add owner-configured membership settings:

```text
read_all_work: boolean
dispatch: boolean
background_enabled: boolean
max_active_runs, max_background_runs_per_hour, max_sends_per_hour, max_pending_runs
background_paused_reason: nullable string
```

Directory access follows workspace membership. Default work reads remain self/direct reports;
`read_all_work` adds all projects in that workspace. None grants private transcript access.
Existing project owners may inspect their descendants for supervision, but only in workspaces
where they also hold membership. Keep grants as explicit fields, not an extensible ACL DSL.

### Project and todo

Retain owner, workspace, objective, definition of done, status, blockers, next action, todos,
and evidence. Add where absent:

```text
parent_project_id?, revision,
execution_state: enabled | paused | draining | cancelled,
execution_epoch: integer,
pending_owner_id?             # only during a durable ownership transition
```

Project status answers “how is the work going?” Execution state answers “may it run?” These
are different facts. A paused in-progress project is valid. A completed/cancelled project
cannot admit new work until explicitly reopened. Evidence is required to mark done.

The parent hierarchy is acyclic. Cross-workspace children are permitted only when the creator
and accountable parent owner belong to both workspaces and the new owner belongs to the child
workspace. Parent membership is not a grant to read arbitrary sibling work. This is a program
rollup, not a dependency graph. Child completion never automatically completes its parent.

An assignment is a project owned by its assignee. The sender creates or selects that project
before sending work. A message may omit a project for an ad-hoc question. Under a project-bound
run, outgoing work must retain that project or select a descendant; it cannot strip association
to escape cancellation. The same rule applies to delayed self-messages and drafted schedules.

### Message

Extend the existing message record; keep its request and final reply together:

```text
from_buddy_id / authenticated owner origin, to_buddy_id / owner destination,
workspace_id, project_id?, project_epoch?,
source_conversation_id, source_project_id?, target_conversation_id?,
purpose, body, evidence[], expects_reply,
continue_from_message_id?, root_message_id, caused_by_run_id?,
not_before?, after_run_id?, idempotency_key, payload_hash,
request_state: open | replied | cancelled | superseded,
outcome?, reply_body?, reply_evidence[], replied_at?,
superseded_by_message_id?, root_stopped_at?
```

The request is immutable except cancellation/supersession. The reply is a one-time atomic
settlement. Preserve current wait metadata for bounded waits. `expects_reply=false` creates
information/continuation messages that do not appear as outstanding obligations; handling
them is visible through runs. `reply` on those messages is rejected to avoid accidental loops.

Progress is an ordinary informational send (`expectsReply:false`) back to the sender, using
the validated reply route. No progress/final reply state machine is necessary. `reply` remains
final and evidence-backed. A free-text outcome can be success, refusal, findings, or blockers;
no outcome string changes authority or automatically completes a project.

Lineage is server-owned. Replies/follow-ups retain the referenced request's root. Otherwise
sends inherit the active input's root. New human inputs and independent schedule occurrences
establish roots. Root stop state prevents fresh descendants after cancellation. Project
association supplies a separate gate across several roots and independent schedules.

### Run: execution and its durable queue

```text
input: chat-message-ref | message-request-ref | message-reply-ref |
       schedule-occurrence-ref | failed-run-notice-ref,
input_key, attempt, buddy_id, conversation_id?, workspace_id,
project_id?, project_epoch?, root_message_id?,
ready_at, after_run_id?,
status: queued | claimed | running | cancel_requested | complete | failed | cancelled,
claim_token?, claim_expires_at?, deadline?, policy_snapshot?,
started_at?, ended_at?, error_code?, outcome?, retry_of_run_id?
```

Unique `(input_key, attempt)` and at most one nonterminal attempt per input. One active run per
conversation. Stable keys include `message:id:request`, `message:id:reply`, and
`schedule:id:due_at`. A successful tool insertion replay returns the existing record. Request
insert and queued run insert are one transaction; reply settlement and reply-run insert are
another. There is no vulnerable post-commit “wake sender” step.

Conversation IDs are reserved before provider dispatch through the current idempotent creation
path. Chat transcript content remains authoritative; a queued run stores its reference, not an
editable second copy. A schedule occurrence freezes its prompt/scope in its run input. Private
claims never appear in prompts, argv, UI, or public API results.

### Schedule

Reuse automation definitions: Buddy/workspace, target conversation, optional project/epoch,
prompt, cron/interval expression, timezone, enabled, next due, policy, and archive state.
One-off timing belongs to `send(notBefore)`, not a second timer type. Repeat timing belongs to
the existing schedule parser. Definition deletion archives; occurrence history stays.

## 4. Routing and one execution path

```text
Human chat / send / reply / due schedule
                 |
          atomic queued run
                 |
    scope + project/root gates + limits + conversation slot
                 |
       current conversation/provider runtime
                 |
       tool actions + streamed transcript
                 |
       process/event/persistence drain
                 |
          terminal run settlement
```

Routing is explicit and deterministic:

- New send to another Buddy: create a fresh restricted recipient conversation in the selected
  workspace. Do not silently choose that Buddy's most recent private chat.
- Follow-up: `continueFrom` reuses the earlier request's recipient conversation; only its sender
  or an explicitly authorized owner can choose it.
- Reply: return to the stored source conversation. Never take a caller-supplied return identity.
- Informational return: `inReplyTo` uses that same return route without settling the request.
  `continueFrom` and `inReplyTo` are mutually exclusive.
- Self-send: default to the current conversation. It queues behind the current run, and admits
  only after that run completes successfully. Failure/cancellation leaves it visibly held for
  explicit retry/recovery; it cannot automatically continue uncertain effects.
- Schedule: use its configured conversation. Each occurrence gets a new claim and deadline.

A queued reply is eligible after the previous source turn drains, regardless of the old turn's
expired deadline. Its tool policy is the restricted background policy intersected with current
grants. Reusing an owner conversation does not grant owner-only tools. A subsequent human turn
resolves its own policy. Input provenance must survive native-session reuse and MCP callbacks.

Reply execution belongs to the source conversation's project, recorded as `source_project_id`,
not the recipient's completed assignment. A request from lead project Q about engineer project R
therefore returns execution to Q. Source and destination project/workspace associations are
server-stamped independently and validated at admission. If Q is paused, the reply remains
stored and visible while its return run is held.

Marking R done prevents new work runs on R; it does not revoke the already-admitted run's right
to publish its final reply or complete its drain. Completion does not increment the cancellation
epoch. After done, that run may read, reply and capture permitted memory; other work mutations
require explicit reopen. Pause/cancel/revocation still fence every scoped write, including reply.

Do not inject full incoming requests into a running owner-privileged turn. Existing active-chat
notification work can surface bounded headers through Buddy MCP result boundaries, without
claiming the dedicated queued run is handled or widening its permissions. Full background work
executes at the next idle boundary. A header handoff is not proof of model reading or completion.
No interception of arbitrary provider-native tools is promised.

Select oldest eligible queued work; allow up to three consecutive owner inputs before one
waiting background input. No preemption except explicit stop. Project/memory CAS protects
shared records across conversations. Coding assignments use isolated worktrees when they can
edit concurrently; a database revision does not serialize filesystem writes.

## 5. State transitions and long-running work

| Event | Durable result |
|---|---|
| Send committed | Open request (or informational message) plus queued request run |
| Claim | Validate gates; reserve limits/slot; snapshot policy; start deadline |
| Dispatch | Running under private claim; provider creation counts against deadline |
| Successful drain | Run complete; request stays open unless explicitly replied |
| Reply committed | Request replied; queued reply run; bounded waiter can observe settlement |
| Deadline/explicit stop | Revoke immediately, drain, terminal failed/cancelled run |
| Uncertain crash | Visible interrupted attempt; no automatic replay |
| Explicit retry | New attempt after old executor is known stopped; all gates rechecked |

**Healthy waiting:** lead receives M, sends N, ends its turn. M remains open. N's reply wakes
the lead, which can reply to M from the same bound conversation under a new valid claim.
Remove the current behavior that terminalizes every unanswered message on normal turn end.

**Solo continuation:** before ending, save durable work progress and call
`send(to:self, notBefore, expectsReply:false, body:"Continue project P from ...")`.
Its queued run has `after_run_id=currentRun`. A successful exit releases it; a crash does not.
Only one pending self-successor per run is permitted. Continuations use the same rate limits,
project gate, lineage, and current policy; they are not extensions of an expired run.

**Timeout:** a sender's bounded wait may time out while the recipient continues under its own
claim. A later reply from a valid recipient run is accepted. Calls from an expired recipient
claim are rejected, including reply. Completing that obligation needs a new authorized run;
“late reply allowed” never means “expired tools allowed.”

Bounded `send(wait:true)` remains compatible (1–600 seconds, default 120), cancellable, and
subject to current deadline and store-level wait-cycle rejection. For this compatibility path,
the reply still queues its normal return input even when the waiter receives it. This can
produce a redundant subsequent turn, explicitly labeled with the same request/reply identity;
it cannot create a second request or second final reply. Do not invent an unreliable model-read
acknowledgment to suppress it. Asynchronous composition is the default. Optimizing the duplicate
wake is deferred until measured, without weakening durable delivery.

## 6. Project control and handoff

These are changes to an existing owned object, not additional coordination primitives.

### Pause/cancel/resume

The owner or authorized project supervisor updates execution state with a base revision.
Pause/cancel first fences the selected project subtree transactionally: increment the gate's
epoch, block new child creation/dispatch, revoke affected active claims, then drain. Claims and
scoped writes check all ancestor gates and recorded epochs. Runs also retain the relevant
ancestor-epoch snapshot so pause/resume cannot make an old child input eligible again.

Pause preserves requests and schedules but leaves old queued work held as stale. Resume enables
new work; it does not replay stale inputs. The caller explicitly retries selected inputs after
inspection, which records new epochs. Cancel additionally cancels pending runs/requests and
disables schedules in the subtree. Projects/history are retained. Failure to drain remains a
visible draining transition, not successful stop. No new owner starts until drain is confirmed.

All project-associated work is included even if started by different message roots. Root-only
stop remains available for an ad-hoc conversation chain and does not change project status.

### Ownership transfer

`update_project(ownerId=..., baseRevision=...)` applies only to the selected project; explicitly
owned child projects retain their owners. Validate target membership and authority first.
Persist `pending_owner_id`, enter draining, fence that project's execution, and drain its active
runs. Block the subtree during transition so new child links cannot race the handoff.

For handoff, drain the entire affected subtree before changing owner; this supplies a clean
boundary for ancestor scope changes. After confirmed drain, one transaction changes the owner
and revision, supersedes unresolved
requests addressed to the old owner for this project, and creates replacements for the new
owner. Each replacement preserves original request content, source/return route, root, and an
audited `supersedes` reference, with a server-authored handoff annotation. It is an authorized
reassignment, not caller-controlled sender impersonation. Reply to a superseded request fails
with its replacement ID. Completed replies and private old transcripts remain unchanged.

Restore descendant admission after transition; retain child owners. Never auto-replay a child
run interrupted by the handoff. Queued inputs proven never dispatched can be revalidated and
restamped with current ancestor epochs by the transition transaction. Interrupted inputs remain
held for explicit retry after inspection by the new supervisor. Persist that distinction in
run history; do not infer it from a lease. Descendant work may therefore need deliberate recovery,
but cannot be silently duplicated or stranded without a visible reason.
Project-owned schedules are disabled for inspection under the new owner; they do not silently
start with different authority. New owner receives current work, shared request/reply history,
and evidence, and starts a fresh conversation with its own identity/memory. Retirement is
blocked until these transfers or explicit cancellations complete. A failed transition is
durable and resumable by control logic only after verifying old processes have stopped.

## 7. Permissions and concrete defaults

| Operation | Authority |
|---|---|
| Directory | Membership in requested workspace |
| Read work | Self, current direct reports, authorized descendants, or `read_all_work` in that workspace |
| Send | Sender dispatch grant and recipient membership in destination workspace; restricted policy must include send |
| Follow-up/read message | Follow-up by original sender; read by original sender/recipient in their bound scopes; owner can inspect |
| Informational return (`inReplyTo`) | Original recipient only, to the requester's recorded source route |
| Reply | Assigned recipient and conversation, open request, valid current run claim |
| Create work for self | Membership plus operation grant, including delegated contexts |
| Assign work to another | Owner or that Buddy's direct manager; both must belong to workspace |
| Change project content/control | Owner, accountable project owner, or explicit ancestor supervisor with workspace membership |
| Hire/retire | Direct owner conversation, direct-report rules and funded quota; never background |
| Reparent existing staff | Owner only; validate acyclic single-manager edge and new manager quota |
| Draft/disable schedule | Self or direct manager in workspace; enabled definitions must first be disabled to edit |
| Enable schedule/background, edit grants/limits | Owner only |
| Retry/stop chain | Owner or original requester supervising that chain, within its visible scope |

Cross-workspace send takes explicit `workspaceId`, checked against sender dispatch grants. The
recipient executes there; reply returns to the source conversation's home scope under its
own fresh restricted policy. No recipient credentials or unrelated transcript access travel
with it. An authorized parent-project reference gives bounded supervision access, not blanket
workspace read. Retrieved evidence is checked again when opened.

Starting defaults (owner-editable): background disabled; 600-second run deadline; two active
runs per Buddy; eight active runs globally; 30 background activations/hour/Buddy; 100 sends/hour/
Buddy; 100 pending runs/Buddy. Enforce a rolling UTC-hour window from persisted records and
reserve limits atomically. At the activation/send cap, latch background paused until explicit
owner resume; show the reason. Owner interactive access remains available subject to active
slots. Pending-cap errors reject before insertion; accepted messages are never dropped.

Schedules coalesce missed ticks into at most one outstanding occurrence and advance the cursor
atomically. Current ownership requires one active occurrence per schedule. A timer or self-send
cannot reset an hourly allowance. Token/cost fields remain compatibility data until measured
enforcement exists. Scope controls bound sanctioned tool use, not arbitrary shell access as
the owner's OS user.

### Approval without another workflow engine

Request approval with send-to-owner, referencing the exact registered operation, canonical
arguments/hash, project revision, and expiry when an executable grant is needed. Store these
as the existing approval record linked to the message; do not infer them from a purpose string.
Owner-authenticated resolution atomically records the decision and queues a reply input.

An approved action is executable once by a fresh valid run before expiry, only if the operation,
arguments, project revision, and all other gates match. Consumption and the registered store
mutation are atomic; external effects require their own idempotency boundary. An arbitrary
shell command is not made safely exactly-once by this grant. Unsupported external actions
remain owner-executed. Rejection/expiry leaves work blocked and visible. No old run resumes.

## 8. MCP and HTTP surface

All signatures below are the intended surface. Adapt existing names instead of duplicating
services. Identity, return route, lineage, delivery/claim state and capability fields are
server-owned. Mutation keys are required and bounded; identical replay returns the previous
result, changed payload conflicts. HTTP uses `Idempotency-Key` for the same command key.

```text
send({to, purpose, body, evidence?, projectId?, workspaceId?,
      continueFrom?, inReplyTo?, notBefore?, expectsReply=true,
      wait=false, timeoutSeconds?, key})
reply({messageId, outcome, body, evidence, approvalId?, key})
get_message({messageId})
get_inbox({state?, conversationId?, cursor?, limit?})

list_buddies({workspaceId?, query?, cursor?, limit?})
get_current_work({workspaceId?, buddyId?, projectId?, includeClosed?, cursor?, limit?})
new_project({ownerId?, workspaceId?, parentProjectId?, title, objective,
             definitionOfDone, todos?, key})
update_project({projectId, baseRevision, title?, objective?, definitionOfDone?,
                status?, executionState?, ownerId?, blockedReason?, nextAction?,
                todoOperations?, evidence?, approvalId?, key})

set_automation({action:create|update|disable, id?, targetBuddyId?, conversationId?,
                projectId?, name?, scheduleKind?, scheduleExpression?, timezone?,
                prompt?, baseRevision?, key})
get_automations({targetBuddyId?, cursor?, limit?})
get_runs({messageId?, projectId?, includeDescendants?, rootMessageId?, cursor?, limit?})
stop({runId}|{rootMessageId}, reason, key)
retry_run({runId, reason, key})
```

Create/update/disable are a discriminated union: create requires name/timing/prompt and defaults
to current conversation; update requires ID/base revision and a bounded patch; disable requires
ID only. New definitions are disabled. A schedule cannot target another identity's private
conversation merely because its ID is supplied; manager-created schedules provision a target
Buddy conversation through the normal creation service.

Reuse routes for messages, projects, automations and run controls; add directory/read-detail
where needed. Owner-only HTTP/UI adds activation/limits, schedule enable, reparent, approval
resolution and destination repair. Repairs validate identity/scope, affect only explicitly
selected pending inputs, and never silently replay completed runs. Return 202 plus durable
transition state for stop/handoff requiring drain; expose final outcome through project/run
reads. Use shared Zod schemas and one service implementation behind MCP/HTTP.

Preserve existing soul/memory and hire/retire tooling. No review, Chief, escalate, join, or
continue-goal tool is introduced. Page sizes default to 20, max 100. Retain existing body and
evidence size limits. Errors distinguish scope denied, revision conflict, duplicate-key
conflict, already replied, superseded, paused/cancelled project, stopped root, limits paused,
destination missing, and interrupted execution.

## 9. Composition trace: the whole Chief workflow

```text
Owner -> Chief conversation C: "Ship account export across the two services."
Chief: list_buddies -> get_current_work
Chief: new_project(P, owner=Chief)
Chief: new_project(Q, parent=P, owner=Lead, workspace=serviceA)
Chief: send(Lead, project=Q, workspace=serviceA) -> request M, thread L
Chief: repeat for serviceB -> request M2. Chief turn ends; requests stay open.

Lead in L: new_project(R, parent=Q, owner=Engineer)
Lead: send(Engineer, project=R) -> N, thread E. Lead ends turn; M stays open.
Engineer in E: implement a bounded portion -> update_project(R, nextAction)
Engineer: send(self, project=R, expectsReply=false, notBefore=now, body=checkpoint)
  -> admitted only after successful current-run drain
Engineer next run: finish -> update_project(R, done, evidence) -> reply(N, evidence)

Lead wakes in L: send(Reviewer, purpose="review", evidence) -> V
Reviewer: reply(V, outcome="changes requested", evidence)
Lead wakes: update_project(R, reopen) -> send(Engineer, continueFrom=N, project=R)
Engineer resumes E: revise -> update_project(R, done) -> reply(revision request)
Lead: validate -> update_project(Q, done) -> reply(M, evidence)
Chief wakes in C: get_inbox/get_current_work; wait for M2 if still open
Chief: validate both -> update_project(P, done, evidence) -> report to owner
```

An engineer's completed project must be explicitly reopened before revisions admit new work.
A reviewer may receive an ad-hoc request attached to the lead's project; it can read the shared
evidence without owning or mutating that project. Ownership governs modification, not the
ability to request advice. The same primitives cover refusal, clarification, and escalation.

Chief check-in: draft schedule targeting C, owner enables once, each occurrence queries all
authorized projects and unanswered requests. It sends follow-ups only when needed and reports
material changes. No separate event subscriptions or completion scanner is required: explicit
replies are immediate return inputs; the timer catches omissions. Model silence is an open
obligation, not fabricated success or automatic failure.

Handoff: owner transfers Q to another lead; gate/drain, new owner, superseded outstanding M and
replacement to the new lead. R's engineer ownership remains. New lead reads shared Q/R work and
evidence and requests updates; old lead's soul/private session is not impersonated. Project
cancel covers Q/R even if several independent request roots or schedules exist.

## 10. Failure contracts and implementation map

| Failure/race | Required result |
|---|---|
| Request/reply committed before dispatcher crash | Durable queued run remains discoverable |
| Crash after unknown external effect | Interrupted run; explicit retry only after process shutdown is established |
| Duplicate send/reply | Same key returns original; conflicting key/payload or second final reply fails |
| Reply after sender timeout | Persist reply; fresh queued return run, no old authority |
| Expired recipient replies | Reject; a valid new run may later settle the open request |
| Final reply then provider error | Preserve reply and independently display run failure |
| Reply arrives during owner turn | Queue until drain; no overlapping turn or broader tools |
| Grant removed while queued/running | Revalidate on claim and every scoped mutation; reject revoked use |
| Stop while creating child | Transactional root/project gate prevents post-stop admission |
| CAS conflict | Return current revision; caller re-reads and reconciles |
| Missing/deleted conversation | Hold input visibly, disable affected schedule; explicit destination repair |
| Paused/archived Buddy | No new execution; obligations stay visible until transferred/cancelled |

Failure notices use one queued input referencing the failed run, without settling the request.
Only request-processing failures generate notices; notice failure does not recursively notify.
Actual success requires provider process, events and session persistence to drain. Preserve
existing reload admission and terminal claim rules. No silent recovery by expiring a lease.

| Component | Responsibility |
|---|---|
| Buddies package/store | Message/reply/queue transactions, revisions/gates, staffing transitions, audits/receipts |
| Shared schemas | One public command/result schema; provenance and credential-free run projections |
| Buddy operations/control/MCP/routes | One scoped service behind authenticated adapters |
| Dispatch service | Stable routing and input persistence, not a second provider runner |
| Scheduler | Due occurrence production plus shared queued-run admission; existing deadlines/fencing |
| Conversation creation/runtime | Identity/session routing, per-input policy, process/event/persistence drain |
| Existing client atoms/WS bridge | Derived inbox/work/run views and streaming; no second bridge |
| Desktop/mobile Buddy views | Directory/team, project controls, inbox, schedule preview, stop/retry/approval |

UI shows unanswered requests separately from running turns, queued inputs and failures. Owner
setup previews schedule prompt/destination/timing/limits, staffing and workspace rights.
Background entries identify their origin. Conversation links check availability. Memory holds
lessons, not copied task status. Existing conversation snapshots remain stable; fresh work
reads and explicit recall provide current facts. Provider harness code remains thin.

## 11. Migration and completion criteria

The main checkout already has generic send/reply, bounded wait, staffing and hardened automation
ownership. An isolated worktree also has active-chat notification changes. Inventory commits
and package provenance before integrating; neither newer source nor historical docs should
be overwritten wholesale. Keep legacy API/history adapters until readers migrate.

Implementation order:

1. Add queued run inputs and durable reply-return insertion; fix healthy waiting and later-run
   reply authority. Prove request → response → original conversation through the real runtime.
2. Add explicit follow-up routing, self-send delay/after-run admission, and schedule inputs.
   Retained sequence/loop automations use the same claim/slot/deadline during migration.
3. Add membership reads/dispatch, assigned child projects, ancestor gates and project control.
4. Add durable ownership transfer/reparenting and exact-action approval continuation.
5. Expose shared behavior in both shells; integrate compatible notification work; run live trial.

Use a real temporary store, private authenticated control path and actual conversation runtime
with a deterministic provider fixture. One scenario family must exercise:

- Full Chief/lead/two-engineer/review/revision chain returning to C across two workspaces.
- Lead turn ending with an open request; later-run final reply, without false failure.
- Solo self-successor admitted after success and held after crash/cancel.
- Busy owner conversation, restricted background policy, bounded-wait/queued-return race.
- Duplicate input, crash at persistence/dispatch/drain boundaries, stale claims and explicit retry.
- Cross-root project stop, concurrent child creation, pause/resume epoch rejection.
- Mid-flight handoff with superseded requests, preserved child ownership and private identities.
- Approval decision with stale project revision, expiry, duplicate consumption and valid new run.
- Schedule downtime coalescing, rate-cap latch, missing destination, archival and repair.

Assertions concern observable durable state and runtime boundaries, never TSX/CSS source.
Then run an owner-authorized small live-provider project to measure reply compliance, evidence
quality, duplicate assignments and unnecessary wakeups. Mechanical correctness and management
judgment are separate acceptance criteria. This document closes the design decisions for the
stated scope; passing those checks, not the document itself, establishes implementation readiness
for release.
