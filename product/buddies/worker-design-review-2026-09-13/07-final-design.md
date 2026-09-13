# Buddies and Workers — integrated final design

September 13, 2026. Design revision 3, prepared by Buddies Development Lead.

This is the complete current design; no earlier design or correction is required
to interpret it. The [MCP contract](08-final-mcp.md), [implementation/removal map](09-final-implementation.md)
and [shared context](10-shared-context.md) specify its interfaces and delivery.
The [meta-reflection](11-meta-reflection.md) assesses its remaining weaknesses.

Owner-selected direction: simple composable primitives; parent-owned temporary
Workers carrying related tasks; human conversations independent of background
capacity; ordinary `agent_notes` files plus directed Mail; the common Buddy
memory system for Workers; shared instructions for notes and lean Mail that
points to detailed files. Exact schemas, default timings, admission mechanics
and the resolutions below remain assistant design choices until accepted or
validated. This document is not evidence of implementation.

## 1. Four objects and ordinary files

| Object | Responsibility | Existing foundation |
|---|---|---|
| Buddy | Identity, role, model preference, relationships, memory lifecycle | Ordinary Buddy |
| Task | Outcome, accountable owner, criteria, progress, blockers and acceptance evidence | Owned project plus embedded checklist/todos; preserve IDs |
| Mail | Directed correspondence, threads and delivery history | Durable Buddy messages |
| Conversation | A human's interaction with a Buddy and its saved discussion | Existing conversation/config/runtime |

A Worker is an ordinary Buddy in temporary Worker mode, attached to one parent
through the canonical manager relationship. It is not owned by one Task. A
Worker can finish Task A, continue related Task B, receive feedback and retain
useful context. Existing standing colleagues stay ordinary Buddies. Workers
appear under their parent and Tasks, without independent roster clutter.

There is no managed Document object. Designs, briefs and deliverables are normal
files. Detailed knowledge uses the existing convention:

```text
agent_notes/{optional_group}/{datetime}_{topic}.md
```

Agents create, read and search files with normal harness tools. No note ID,
registration, publication transaction, custom retrieval API or mandatory metadata
schema. Keep current status and assignments on Tasks; use notes for reasoning,
decisions, discoveries and useful evidence. Material decision notes preserve
who decided, why, alternatives, evidence and whether the choice is accepted or
proposed. Add a successor when that decision changes.

## 2. Common context and memory

Every ordinary Buddy and Worker receives the same [notes/Mail context block](10-shared-context.md).
It tells them where notes live, when to write or search, how to reference files,
and how to send a concise, actionable Mail. Put this once in the common composer,
not separately in each Buddy soul or task prompt. Refresh it on subsequent turns.

Host-provided context identifies the workspace root and the actual shared notes
root. Worktrees use the workspace's stable notes directory, not a temporary
iteration directory. A reference includes enough path/workspace information for
the recipient to find it. Use a commit or content hash when an exact version
matters. Preserve a deliverable beyond worktree deletion before reporting it as
ready; a hash cannot recover a deleted uncommitted file.

Workers use ordinary Buddy memory initialization, compact-context injection,
background review and next-turn refresh. They keep their own learning across
related tasks. Common implementation does not mean cloning a parent's private
conversation or memory into the Worker. A parent shares relevant context through
the brief, accessible files and Mail.

The existing background reviewer curates compact memory. Detailed evidence
converges on the same ordinary note files; no separate Worker reviewer or note
collection. Agents can save important evidence during long work instead of
depending on the reviewer's bounded conversation tail. The reviewer reuses
existing notes and preserves exact paths in compact memory.

Keep the reviewer's current maintenance mandate, successful-turn admission,
serialization, model/effort and compact-memory revision checks. Adapting note I/O
is an explicit integration change, with the existing curation benchmark as its
control. Ordinary employees have no compact-memory maintenance API. Reviewer
file access must remain restricted to its authorized evidence and notes; do not
give it a general shell or action tools to replace two note operations.

## 3. Mail carries attention; files carry detail

A useful Mail contains the outcome or request, the essential fact needed to
route it, and a path/section for detail. Save the file before sending. A short
self-contained question or answer can stay in Mail; do not create a document
for every message. Avoid sending only a path with no explanation or pasting an
entire design into every thread. Receipt means delivery, not agreement or Task
acceptance. Replies use `replyTo` on the same Mail operation.

**Attention rule selected for this design:** ordinary directed Mail makes the
recipient eligible for one bounded response through the existing background
input path. An active recipient consumes Mail at the next safe input boundary;
an idle permitted recipient gets a coalesced response turn. An active Worker
uses its one work lane, never a second mailbox executor. A held, exhausted,
stopped or retired Worker receives durable Mail without automatically resuming
work. The receipt exposes delivered, queued or held attention and its reason.

This resolves the earlier passive-inbox proposal's conflict with immediacy.
It is an assistant mechanism for the owner's behavior, not a promise of instant
provider execution. Delivery and attention intent commit together and replay
once. Required parent reviews take priority over ordinary correspondence.
Automatic routine check-ins deliver progress without waking the parent each
time; blockers, ready results and session expiry require parent attention.
Coalesce only inputs compatible with the same recipient context, audience and
authorization account. Do not merge unrelated private messages or charge one
work root for another root's required review.

The host uses the recipient's existing permitted response policy for ordinary
Mail, or the existing work root for required Task/report attention. Mail creates
no new allowance. If neither route is authorized, it remains visibly held.
Do not send a second Prompt just to make the same Mail visible. A response need
not send a reply when there is no useful information or decision to return.
Bounded response turns and coalesced inputs prevent independent response lanes;
effort limits remain enforceable even if agents exchange excessive messages.

`prompt` remains the explicit command for starting work, adding work direction,
continuing after required review or recovering an inspected failure. Mail can
ask a question or carry feedback; it cannot assign authority, renew a solo
session, revive stopped work or complete a Task. Host-generated Mail attention
uses that same execution request machinery internally.

## 4. One Worker, one active work executor

The Worker mode requires exactly one canonical parent edge; creation and the
edge commit together. Task reassignment does not change parentage. A Worker
has one active work executor across all saved contexts and Tasks. Keep that
ownership until provider exit and event drain, including cancellation.

A compatible context binds Buddy identity, authorized audience, provider/config,
related Task refs and the current execution authorization/session. Related work
can reuse it. Incompatible audiences/configuration use a separate saved context,
serially. Never choose the first Task's audience or union private conversations.
Revoked disclosure or incompatible configuration invalidates reuse; ordinary
learning does not needlessly discard useful history. Provider values pass
through verbatim through the canonical configuration resolver.

Leads use bounded background turns to review, organize and dispatch. Substantial
autonomous implementation belongs to Workers. A Worker explicitly granted a
lead role coordinates within its same lane. A lead waiting for a result returns
its turn and releases capacity; later Mail/results bring it back.

Human conversation remains independent of background admission and quotas.
Owner instructions that change a running Worker's work queue into its existing
lane or an explicit stop/handoff. Human inspection does not acquire a second
work writer. Actual host/provider failures remain visible errors.

## 5. Task outcome and atomic reports

Task is the new name for existing owned work resources, not for the repository
Workspace. Embedded checklist entries have no independent executor. Parent-task
links support decomposition without a new Assignment, Batch or dependency system.

The Worker updates permitted progress and submits an exact candidate for parent
review. It cannot rewrite assigned criteria, remove required review, transfer
ownership or approve its own result. The parent accepts the exact candidate,
criteria and evidence versions through `update_task`. Existing assignment
`accepted_by` fields keep their old meaning; candidate acceptance is distinct.

`report` commits the checkpoint, supplied Task changes and any required Mail and
attention intent together. A stale revision or permission failure commits none.

| Kind | Saved result | Attention and execution |
|---|---|---|
| `checkpoint` | Saved artifacts, effects, uncertainty and resume instructions | Continue; no Mail |
| `progress` | Checkpoint and short parent Mail | Continue; no routine parent wake |
| `blocked` | Checkpoint and affected Task blockers, Mail | Parent attention; other runnable Tasks can continue |
| `ready` | Checkpoint and exact candidate, Tasks in review, Mail | Parent attention; other runnable Tasks can continue |

Files are saved before this transaction. The transaction records references and
effects; it cannot make filesystem writes atomic with the database or prove an
artifact correct. Validate the saved candidate through real evidence. If the
report fails, reuse the existing saved file and retry the same report intent
after resolving the actual conflict. Do not recreate side effects blindly.

Task acceptance does not retire the Worker or renew its solo session. All Tasks
accepted means idle until explicit further related work or retirement.

## 6. Automatic reporting and required review

The host periodically captures a timestamped, parent-permitted snapshot: event
watermark, Task revisions, latest checkpoint and previous report watermark.
A fresh restricted reporter describes changes, evidence, blockers and the
Worker's last recorded intent. It has no employee/action tools, shell, file
mutation, staffing, renewal or recipient choice. The host validates and delivers
the result to the fixed parent, rechecking recipient access and cancellation.

A native provider fork is an optional optimization only after a real boundary
test proves snapshot stability and replacement of inherited capabilities. The
saved-snapshot path is the baseline. Reuse the existing maintenance runner's
exit/drain pattern, with a separate reporting mandate. Reporters do not get Buddy
identities or recursively trigger memory review/reporting.

Allow one reporter per Worker. Coalesce missed intervals to the newest snapshot;
record overdue/failure truthfully. Generation and delivery have separate receipts
so delivery retries do not rerun the model. Pending tools and truncated evidence
remain explicit. A reporter's narrative is supervision evidence, not validation.

## 7. Time, limits and continuation

The host owns clocks and one canonical resolved policy. Solo time counts admitted
Worker execution including tools, across provider turns, retries and Task switches.
Queue time and drained waits pause it; they do not reset it. An optional calendar
deadline keeps advancing. Persist admission segments and accrued usage; crashes
retain uncertain reservations until conservative settlement.

Suggested evaluation preset: check in every 5 minutes, require review after
30 solo minutes, cap a reporter at 60 seconds and a lead coordination turn at
120 seconds. These are assistant recommendations, not owner-selected defaults
or measured optima. Foreground `TURN_MAX_RUNTIME_MS` remains explicit and separate.

At solo-session expiry, the host marks held, saves a required-review cause,
fences and drains work. It does so even if the Worker never cooperatively reports.
Keep the last checkpoint and real `max_runtime_timeout`/expiry cause; never label
automatic expiry as a user stop or invent a final Worker report.

The parent reviews evidence, then continues the same Worker with a bounded next
session, redirects/splits the work or stops it. Continuation names the held
session revision, reviewed causes and exact Task versions. Authority, remaining
allocation, cancellation and drain checks occur in the same transaction that
saves the decision and next request. Duplicate commands allocate once; new causes
remain pending. Recovery preserves the current session clock; an exhausted session
still requires explicit review/continuation.

Track cumulative active-provider wall time across Worker work, descendants,
reporting and associated parent review. It is an enforceable effort unit, not
dollars or productivity. Reserve required review/report overhead before granting
work. `consumed + outstanding reservations <= authorized total`. Settle after
drain and release only demonstrably unused reservations. Memory maintenance is
separately visible host usage under its existing mandate. Account for harness
helpers or disable unbounded helper paths in a hard-limited profile.

Configured background capacity reserves room for required coordination. With one
slot, a drained Worker gives required review priority over new work; reporters
may be overdue while it is occupied. Foreground does not consume this background
quota. The UI shows resolved check-in/session/account state and exact hold reasons.

## 8. Retirement, cancellation and history

Stop/revocation fences operations immediately, cancels queued descendants in
scope and retains executor ownership through drain. New keys, Mail and recovery
cannot bypass a stopped root. Handoff is explicit and revisioned; it drains the
old writer before the next begins.

Retire a Worker only after owned work is resolved or explicitly transferred,
actionable inputs are settled and work/reviewer processes have drained. Ordinary
informational Mail does not hold retirement indefinitely. Preserve notes,
Task evidence and authorized execution history. Late Mail stays visible without
reviving the Worker. Parent archival holds its Workers for owner disposition;
it does not promote them into standing colleagues.

`retire_buddy` reuses ordinary archival with the appropriate Worker versus
standing-staff authority. Existing direct reports are not automatically converted.

## 9. Tools, context and UI

The [complete employee union](08-final-mcp.md) has 21 tools: Worker 8, lead 14,
with 7 additional administration/diagnostic tools. Delete `remember_note`,
`recall`, `get_document` and `update_document` from every employee profile and
remove their instructions/aliases. Normal filesystem tools come from the
harness. A profile is filtered by real turn authority; it does not grant access.

Startup supplies identity/role, parent and peer summaries, compact memory,
workspace/notes roots, Task criteria and refs, pending inputs, checkpoint and
resolved limits. Keep the common notes/Mail block outside truncatable historical
content. Historical notes and memory are evidence, not current tool instructions.
Do not blanket-rewrite souls or old notes to deploy a common instruction change.

Desktop and mobile reuse the same data and routes. Parent inspection shows
Workers, Tasks, reports, transcript history and session/hold state. Mail displays
the short body and usable file references with missing-file status where known.
Existing file opening/preview is sufficient; no new Documents tab or editor.
The existing memory panel can inspect compact memory. Human conversation routes,
Back/reload behavior, one WS bridge and per-conversation subscriptions remain.

## 10. Supporting state, migration and proof

These internal records are necessary for distinct lifetimes, not additional
user-authored products: workspace grants, compatible context binding, durable
execution request, solo session, attempt/receipt, effort account, checkpoint,
pending attention/delivery intent and existing schedule occurrence. Keep their
authority in the canonical package and run providers through the existing executor.

Schedules enqueue saved authorized coordination or Task/Worker inputs through
the same request path. External email remains its existing separately authorized
effect adapter. Owner team setup and identity editing retain their dedicated
flows. Saved owner policy supplies work bounds without repeated approval prompts;
the proposed owner-only authorization command is outside employee MCP.

Implement from the verified packaged baseline or a verified successor, preserving
current unrelated work. First integrate common file/context/memory behavior and
remove employee knowledge operations; then deliver one Worker/two Tasks through
start, report, required review and continuation; then automatic reporting and both
UI shells. New work moves to the one request controller. Drain legacy requests,
retain their original units/history and delete the obsolete write controller.

Export existing shared notes to ordinary files without publishing private memory
or legacy owner notes into a shared repository. Keep old private history through
its existing authorized owner view until an appropriate export is selected.
The archive reader is not a reason to retain employee knowledge tools.

Required real-boundary proof: note discovery/file handoff, common Worker memory
review, correct lean-Mail use, Mail attention under idle/busy/held conditions,
two Tasks sharing one Worker, expiry without cooperative reporting, exact parent
acceptance, duplicate/stale commands, restart/uncertain effects, cancellation and
drain, foreground independence, reporter restrictions and private-content access.
The [implementation map](09-final-implementation.md) assigns these boundaries.

This design has been reviewed as documentation. Runtime and provider behavior,
timing presets and any savings require measured execution; no implementation
success is implied by the smaller catalog.
