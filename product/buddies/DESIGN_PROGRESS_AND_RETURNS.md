# Progress, conversations and worker returns

Design draft, second pass · September 14, 2026 · Buddies Development Lead

Implementation-oriented proposal. Read the owner's
[design philosophy](DESIGN_PHILOSOPHY.md) for intent and history, and the
[core model](CORE_DESIGN.md) for responsibilities and authority boundaries.

The owner’s direction is to compose task comments, useful commits, progress note
files, conversations and Mail, and to let an interrupted worker report back before
its lead decides how to proceed. This document proposes the implementation. It
does not claim these changes are implemented or authorize a release.

The [core design principle](CORE_DESIGN.md#core-design-principle) governs this
proposal and future revisions: files carry collaboration; Buddies, Mail and Tasks
formalize continuity of agents, communication and work. Memory implements Buddy
continuity; it is not a separate core component. The concrete
gap is that a lead needs intelligible, attributable evidence after interruption,
while the current checkpoint path creates a separate reporting surface and still
misses some timeout returns. A transcript alone is available history, not always
a useful account of what was accomplished.

## 1. Keep the primitives complementary

**Files are a first-class part of the model. Buddies, Mail and Tasks provide the
formal continuity around them.** Conversations carry session history; runs are
execution infrastructure. We do not need an application record for every piece
of collaborative work.

The owner clarified three durable responsibilities:

* **Buddies:** persistent agent identity and continuity between context sessions.
  Memory is part of the Buddy implementation and carries what it retains.
* **Mail:** persistent inter-agent communication, including correspondence that
  outlives either participant's current session.
* **Tasks:** persistent identity for a workstream, organizing progress and
  coordinating contributions across agents and sessions.

A Task is valuable even when nobody maintains an exhaustive progress log. Its
stable ID gives a long-running effort an address: conversations, Mail, files,
decisions and changing contributors can keep referring to the same work. Completing
an attempt, changing assignee or starting a new conversation does not replace that
identity. Preserve the Task and its history when it closes. A genuinely different
outcome can have a new Task; do not reuse an old ID just to avoid creating one.

| Primitive | Responsibility | Example |
|---|---|---|
| Buddy | Agent identity and continuity, implemented with memory | Retained role, preferences and useful learning |
| Task and todos | Stable workstream identity, outcome, ownership, criteria and status | “Export reliability,” with bounded implementation steps |
| Task comment | Append a work update, question or decision | “Parser done; encoding test still fails. See commit and note.” |
| Conversation | Working context, discussion and tool history | Worker investigates the encoding failure. |
| Mail | Direct somebody’s attention and receive a reply | Worker asks lead to review the failure and choose scope. |
| File | Collaborative designs, notes, checkpoints, code and deliverables | `agent_notes/export/20260914_encoding.md` |
| Commit | A coherent saved code revision | Repository plus commit SHA, with validation results. |
| Run | Execution ownership, termination reason and enforced limits | Attempt timed out; process drained; work remains incomplete. |

A worker uses whichever surfaces help. It need not write a note, comment, commit
and Mail on every turn. Encourage useful commits during normal implementation;
do not manufacture commits for reporting or implicitly push them. Comments explain
status; only the Task API changes status. Notes preserve reasoning, and can be
linked from multiple places without creating duplicate managed Documents.

Example: save an investigation note, make a coherent implementation commit, append
a short Task comment linking both, and send the lead a question with those same
references. The lead replies and appends its decision to the Task. There is no
requirement that all progress originate in one system.

“Checkpoint” can simply describe a file: what is saved, what was tried, what is
unfinished and where to resume. No special extension, schema, registration or
checkpoint API is required. A worker can link that file in a Task comment,
conversation or Mail. That makes it available evidence, not automatically curated
memory, a notification or a change to Task status.

Keep formal logic where behavior depends on it: memory scope and refresh; Mail
participants, replies and delivery; Task identity, ownership, status and access.
Files use normal filesystem/version-control tools. Conversations and runs retain
their existing persistence and lifecycle logic. Reusing files does not mean
removing those execution guarantees or building a generic resource framework.

## 2. Minimal data additions

Names and signatures below are illustrative proposals, not currently callable
APIs. Reuse existing naming conventions at implementation time.

### Task comments

Product “Task” currently maps to `BuddyWorkProject`, with embedded todos. Keep
those IDs. Add append-only comments scoped to that project, optionally a todo:

```ts
type TaskTarget = { projectId: string; todoId?: string };

type TaskComment = {
  id: string;
  target: TaskTarget;
  author: { kind: 'owner' } | { kind: 'buddy'; buddyId: string };
  createdAt: string;
  body: string;               // Markdown, including ordinary links
  evidence: string[];         // existing work/Mail evidence representation
  runId: string | null;       // host attribution when created during a run
};

appendTaskComment(ctx: Authority, input: {
  target: TaskTarget;
  key: string;
  body: string;
  evidence?: string[];
}): Promise<TaskComment>;

listTaskComments(ctx: Authority, input: {
  target: TaskTarget;
  cursor?: string;
  limit?: number;
}): Promise<Page<TaskComment>>;
```

One new `buddy_task_comments` table: project/todo foreign references, author,
body, evidence JSON, run attribution, creation time and idempotency key. Reuse
existing author identity encoding where available. Validate todo membership.
Unique key is scoped to project and authenticated author; repeated identical
requests return the same comment, different content under the same key conflicts.
Bound body/evidence sizes and page reads. Index by project, creation time and ID.

Author, run and workspace are resolved by the host. Reads and writes check Task
access. A comment has the Task’s audience; linking private material does not make
it shareable. It neither launches work nor changes Task revision/status. Corrections
are new comments. Do not rewrite a growing comments array in the project record.

Suggested adapters: `append_task_comment` / `list_task_comments` in Buddy tools;
GET/POST on the existing project route plus `/comments` for the owner UI. Both
call the same package authority methods. These are information operations; use
existing Mail when someone needs to be notified.

### References, not a new artifact registry

Start with Markdown links and existing `evidence: string[]`. A reference can name
a note path, repository and commit, transcript, Task comment or Mail message.
Include a version/hash when exact bytes matter. Use existing upload/attachment
support where present; do not create a general attachment store just for this work.

The receiver must be able to resolve the reference. Preserve useful files beyond
temporary worktree cleanup. A hash without retained bytes is insufficient. The
host supplies transcript references; an agent-supplied path is not permission to
read it. Reports remain claims until the lead inspects enough evidence.

### Conversation origin and execution mode

Two different branches are needed:

* **Lead review:** inherits the conversation that launched the work.
* **Worker wrap-up:** inherits the worker conversation at interruption.

Use existing conversation creation metadata and transcript persistence to record
the source boundary. A `worker` flag can label a conversation, but cannot encode
which history it inherited, its audience or its runtime limits.

```ts
// Host-created metadata, not an agent-submitted authority grant.
type ConversationOrigin = {
  sourceConversationId: string;
  throughMessageId: string;   // durable cutoff, not “whatever is latest”
};

createConversationBranch(ctx: Authority, input: {
  key: string;
  origin: ConversationOrigin;
  initialMessage: string;    // appended after inherited history
}): Promise<Conversation>;

// Reporting uses an ordinary bounded Mail request and existing run admission.
// Correlate it with the interrupted attempt through host provenance.
// Add a run-input variant only if existing request metadata demonstrably cannot
// express this; a new public WrapUp type is not part of the core model.
```

The cutoff identifies a committed transcript boundary including completed tool
results; incomplete streaming output must be labeled incomplete. Persist the
launch boundary when dispatch occurs. Resolve the original audience from trusted
source metadata and carry it through execution, tools, memory review and storage.
Parentage never expands authority.

Native provider forks may be used only if they preserve that exact history and
audience. Otherwise materialize a bounded transcript handoff through existing
adapters, clearly stating omissions and supplying a full-history reference.
Referencing a mutable source session at review time does not prove a launch-time
fork. Do not add a second transcript database or expose old session credentials.

## 3. Normal work and reports

Normal execution uses existing Task admission and the worker’s conversation.
Progress comments and files survive interruption independently of any final report.
An explicit Mail/question can wake the lead through the existing return route.
Successful completion carries the result and references through that same route.
It does not need another model turn merely to rephrase a sufficient final report.

For a group of related assignments, preserve the existing background return
conversation routing. Seed its history once from the launch that first creates
it. Each later assignment brings its own assignment and bounded launch context;
do not overwrite accumulated management history or silently import later owner
messages. Explicit new owner direction is delivered as new correspondence.

## 4. Timeout and interruption

Proposed sequence:

```text
worker attempt expires
  → runtime terminates and drains the process
  → durable timeout state is immediately visible
  → one bounded wrap-up turn branches the worker history, when permitted
  → report or explicit fallback reaches the lead background conversation
  → lead inspects evidence, records a decision and takes the authorized action
```

The worker’s wrap-up is an ordinary conversation turn with a restricted purpose:
review initial goals and available work, explain accomplishments and remaining
work, identify uncertainty, link notes/commits/transcript, and recommend a next
step. Its output becomes ordinary Mail body/evidence. It is not a new Checkpoint
record and cannot mark the implementation attempt successful.

The host appends an interruption message after inherited history. It states the
actual reason, assignment, current Task state and reporting deadline. The model
receives fresh callable tools; historical tool results remain context. “History
above” refers to inherited history; “references below” refers only to references
actually present in the appended message.

### Compose an ordinary reporting request

Treat “review your interrupted work and report back” as a bounded Mail request
executed in the worker branch, with the lead as its return recipient. Its result
is the ordinary reply. Use existing request identity, reply settlement and failed
delivery handling. Do not add a parallel report lifecycle or a second deadline
service to guarantee a specially assembled report.

The interrupted implementation attempt stays timed out. The reporting request is
separate correspondence referring to that attempt; it cannot consume or overwrite
the original failure. The host records whether the handoff is to a reporting
request or directly to the lead, using existing durable correlation and atomic
settlement. This integration still needs a concrete package diff: “ordinary Mail”
is not proof that all required routing is implemented today.

### Required bounds, existing owners

* Reserve an explicit, finite reporting allowance when admitting work. It is
  visible within the authorized total; exhausting work time cannot mint budget.
  Exact allowance is configuration, not an implicit 600-second default.
* Use existing run admission, leases, process ownership and drain. The wrap-up
  references the source attempt, is idempotently scheduled once, and cannot spawn
  another wrap-up when it fails or times out.
* Reporting tools allow inspection and returning the report. They do not allow
  implementation, new delegation, budget changes or arbitrary mutations. This
  must be enforced by exposed capabilities. If a harness cannot support the
  restriction, use the fallback rather than pretending a prompt restricts tools.
* Timeout status is visible immediately. When admitted, the reporting request's
  normal reply or terminal failure wakes the lead. If reporting cannot be admitted
  within its authorized deadline, deliver the original failure context directly.
  Reuse existing request expiry; do not introduce a separate report-wait timer.
* Fallback includes termination reason, original assignment, current work state,
  latest available progress references and transcript location. Explicitly say
  no wrap-up report was produced. Do not treat the last utterance as a full report.
* Deduplicate scheduling and delivery with existing request keys and settlement
  transactions, including restart recovery. Late replies remain attributable Mail;
  before taking action the lead and work admission check current Task/run state.
  Do not promise exactly-once model decisions or invent a late-report ledger.
* An explicit user stop/cancellation suppresses new automatic wrap-up execution.
  A crash or recoverable interruption may use this path only after execution is
  confirmed stopped. Canceling during wrap-up stops and drains that turn too.

These are assistant-proposed mechanics for the owner-requested handoff. They add
behavior to existing coordination; they do not justify a separate supervisor,
polling service, Worker ledger or generic workflow engine.

## 5. What the lead receives and does

```ts
// Ephemeral assembled input; read authorities, do not persist competing state.
buildLeadReturnContext(ctx: Authority, input: {
  sourceRunId: string;
  reportMessageId?: string;
}): Promise<string>;

// Existing executor owns scheduling; this helper chooses report vs fallback.
settleInterruptedAttempt(ctx: Authority, sourceRunId: string): Promise<void>;
```

Append the event to the lead’s background thread, after inherited/prior history:

1. Actual completion, message or interruption reason and source attempt.
2. Original assignment, current Task criteria/state and enforced remaining limits.
3. Worker report, or explicitly missing report; relevant comments and references.
4. Accessible worker transcript and artifact references for deeper review.
5. Direction to assess the evidence and choose the next action using current tools.

The lead can accept evidenced completion, continue the existing worker, redirect
it, request an authorized budget adjustment, reassign or stop. It records the
decision in a Task comment and sends appropriate direction through existing Mail/
work APIs. Continuing appends to the worker’s execution conversation; the reporting
branch remains a report. A request exceeding the lead’s authority goes to the owner.
The owner’s human conversation remains independently usable throughout.

Do not infer success from a report saying “done,” or safe retry from “no effects.”
Runtime state remains authoritative for termination and budgets; actual artifacts
and external observations establish effects. Preserve existing stale-run and
cancellation fences when admitting any continuation.

## 6. Code boundaries

```text
@nbardy/buddies canonical package source
  store / coordination-work       Task comments: storage, access, append/list
  coordination / background-work  ordinary report-request routing and settlement
  coordination-receipts           retire checkpoint writes; historical reads

shared/src/
  buddy-work.ts                   comment wire schema, reuse evidence strings
  buddy-coordination.ts           reuse request/run types; extend only for a gap
  buddy-observation.ts            remove active checkpoint requirements

server/src/buddies/
  operations / mcp-server /
  mcp-input-schema / routes       thin comment adapters, retire checkpoint tool
  coordination-store.ts          package binding updates
  run-executor.ts                 existing work/report/return dispatch
  return-context.ts (new)         bounded context assembly, no scheduling loop
  knowledge / integration /
  memory-review                  preserve branch audience end to end

server/src/conversations/
  creation-service /
  buddy-creation-service          durable branch origin and idempotent creation
  runtime.ts                     context continuation, actual tool capability set
server/src/adapters/              reuse transcript loading/persistence

client/src/components/buddies/
  BuddyProjectExecution           Task comments and evidence links
  BuddyTaskComments (new)         shared desktop/mobile comment presentation
  BuddyTeamExecution             replace checkpoint controls with reports/history
client/src/atoms/                 derived views and existing actions

workspace files / git            notes, checkpoint files and coherent revisions
existing memory lifecycle        agent continuity; no new progress-memory API
```

These are responsibilities, not a mandate to split every function into a file.
Use the canonical package source and rebuild its artifact/provenance; never treat
an edit inside `node_modules` as delivery. Integrate the accepted isolated Worker
redo with current returns first so the app and package share one baseline.

## 7. What changes and what disappears

| Today | Proposed replacement |
|---|---|
| Explicit `checkpoint` write tool and schema | Ordinary comments, notes, commits and Mail evidence |
| New rows in `buddy_checkpoints` | No new checkpoint writes; existing historical rows remain readable |
| Checkpoint-specific recovery selection | Original attempt + ordinary progress evidence; existing retry authority |
| Prompt injection for selected checkpoint return kinds | One return-context assembler for completion, message and interruption |
| Checkpoint creation/selection UI | Comments, report and transcript links |
| Return thread without launching history | Validated conversation branch with recorded cutoff/audience |
| Bare timeout reply | Bounded worker report or honest context-bearing fallback |

Remove checkpoint creation validation, tool declarations, package write method,
app write adapters, active selectors and special prompt injection once their
consumers are migrated. Keep legacy read types and old migrations while old data
exists. Old checkpoint IDs referenced by historical retries must still resolve;
they are historical evidence, never new retry permission. Retired API calls return
an explicit compatibility error rather than silently losing data.

Keep current Task status/revisions, Mail delivery, run/attempt identity, effect
inspection, limit enforcement, stop/drain and retry checks. No new Worker table,
Report table, Artifact registry, Memory type or universal Message table.

Expected simplification: fewer specialized reporting APIs and fewer places to
assemble return context. Overall line count may grow because comments and exact
context inheritance are new capabilities. Measure deletions/additions separately
for checkpoint retirement, comments and branching; do not call relocation a saving.

## 8. Refactor sequence and proof

1. Establish a reproducible app/package baseline including accepted Worker changes
   and current background returns. Preserve unrelated dirty work.
2. Add Task comments through package authority, API and shared desktop/mobile UI.
   Keep notes/commits/Mail as ordinary complementary surfaces.
3. Add branch origin and audience preservation through creation/runtime/history.
   Test launch cutoff and independent later human/background conversation turns.
4. Unify return-context assembly; cover every terminal timeout variant, including
   managed `message_reply`, plus normal completion and explicit messages.
5. Compose a bounded reporting Mail request in existing coordination with fallback and
   deduplication; preserve cancellation and cumulative bounds.
6. Retire checkpoint writes/active UI after equivalent progress references survive
   interruption and recovery. Preserve historical reads and citations.

Boundary tests must cover concurrent/idempotent comments and access denial;
timeout after saved work; report failure and deadline; restart/duplicate settlement;
late output; explicit stop; missing transcript; audience isolation and tool grants.
Use real package/runtime boundaries rather than assertions on prompt source text.

The decisive live test is: worker saves a note and coherent code change, comments
on its Task, times out, produces a bounded report, and the lead actually reads the
artifact and issues an evidenced continuation or pivot. Verify that direction
reaches the worker and that the human chat stays usable. A model waking up or
printing “continue” is insufficient. Test native fork and transcript fallback
separately; do not claim all-provider support from one provider result.

## 9. Decision history and remaining choices

The September 12 checkpoint decision sought durable evidence of saved effects
after interruption. That need remains. What changed is the owner’s September 14
direction: complementary existing progress surfaces, plus a worker reporting turn.
This proposal moves recovery evidence into those surfaces instead of requiring a
special checkpoint object. It supersedes the assistant’s earlier exclusive-home
alternatives; it does not erase their rationale or historical data.

Historical source bytes, dates and hashes are preserved in the
[source snapshot](../../agent_notes/buddies/20260914_progress-and-returns-sources.json).
That includes the earlier checkpoint decision and the preceding core design.
Owner direction also appears in native note
`2026-09-14T03:43:25.169Z:9c0bca02-70f8-44d9-bc37-b8d18c316022`.
The owner’s latest request adds the worker-conversation reporting fork; reporting
allowance, deduplication mechanics and exact API shapes here are assistant proposals.

Before implementation, resolve exact provider snapshot support, enforceable
reporting capabilities, budget configuration and reuse of existing settlement
metadata. Revisit removal if a concrete machine recovery requirement cannot be
met by retained execution authority and ordinary evidence. Revisit branching if
private context cannot be preserved. Do not recreate checkpoints merely because
an optional progress report is missing.

### Second-pass decision — September 14

Owner clarification: files carry much of collaboration, including informal
checkpoint files. Memory provides continuity of agents across contexts; Mail
provides persistent inter-agent communication; Tasks provide persistent identity
for workstreams, beyond the value of a formal progress log. These are owner
directions. Keeping task comments as subordinate records and composing timeout
reporting as ordinary bounded Mail are assistant implementation recommendations.

This pass replaces the draft's proposed mandatory `WrapUpInput` and special
report-wait/late-report handling with reuse of ordinary requests, replies and
runtime bounds. It retains interruption reporting, context provenance and budget
limits. The first pass is preserved with hashes and full text in the
[second-pass source snapshot](../../agent_notes/buddies/20260914_progress-and-returns-pass2-sources.json).
Revisit these choices if a concrete implementation shows that existing Mail
settlement cannot express the handoff without duplicating lifecycle authority.

### Owner correction — three core components

The owner clarified that the core is **Buddies, Mail and Tasks**. Memory is an
implementation detail of Buddies, not a fourth component. The prior four-component
framing was the assistant’s mistaken interpretation. Files remain the collaboration
foundation; this correction changes the conceptual boundary, not the memory lifecycle.
