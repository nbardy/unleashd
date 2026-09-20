# Progress and returns design proposal — 2026-09-14

Status: owner workflow direction; assistant implementation proposal. No runtime change.

Question: how to preserve progress and support useful lead decisions after interruption without a separate checkpoint workflow?

Owner direction: task comments, useful commits, progress notes and relevant references in conversations/Mail/tasks are complementary. A timed-out worker should branch its own context to report to the lead, which decides continuation, budget adjustment or pivot.

Proposal: append-only Task comments; ordinary file/commit/evidence links; exact conversation origins; bounded worker reporting through existing runs; one lead return or fallback; retain runtime authority and historical checkpoint reads. Retire new checkpoint writes and active selectors after boundary proof. This supersedes exclusive-home assistant alternatives, not the requirement to inspect saved effects.

Tradeoffs: new comments/context/reporting may add total code; fewer specialized checkpoint surfaces is not yet a measured net reduction. Reporting requires enforceable capability and budget bounds. Explicit user stop suppresses automatic reporting.

Revisit if ordinary evidence cannot satisfy a demonstrated machine recovery requirement, or source audience/history cannot be preserved.

Historical predecessor bytes: 20260914_progress-and-returns-sources.json. Previous owner direction: native note 2026-09-14T03:43:25.169Z:9c0bca02-70f8-44d9-bc37-b8d18c316022.

Draft path: product/buddies/DESIGN_PROGRESS_AND_RETURNS.md
SHA-256: 42dddc7ddacc4da02f66b4e0ce9cc5b72d538f74ea199361021f188b7e685d5c
Captured at: 2026-09-14T03:54:49.637406+00:00

Preserved complete draft:

# Progress, conversations and worker returns

Design draft · September 14, 2026 · Buddies Development Lead

The owner’s direction is to compose task comments, useful commits, progress note
files, conversations and Mail, and to let an interrupted worker report back before
its lead decides how to proceed. This document proposes the implementation. It
does not claim these changes are implemented or authorize a release.

The [lean core](CORE_DESIGN.md) remains the conceptual entry point. The concrete
gap is that a lead needs intelligible, attributable evidence after interruption,
while the current checkpoint path creates a separate reporting surface and still
misses some timeout returns. A transcript alone is available history, not always
a useful account of what was accomplished.

## 1. Keep the primitives complementary

| Primitive | Responsibility | Example |
|---|---|---|
| Task and todos | Current outcome, ownership, criteria and status | “Implement export; CSV round-trip must pass.” |
| Task comment | Append a work update, question or decision | “Parser done; encoding test still fails. See commit and note.” |
| Conversation | Working context, discussion and tool history | Worker investigates the encoding failure. |
| Mail | Direct somebody’s attention and receive a reply | Worker asks lead to review the failure and choose scope. |
| Note file | Detailed progress, reasoning and handoff material | `agent_notes/export/20260914_encoding.md` |
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

// Extend existing run input metadata; no separate ReportRun table.
type WrapUpInput = {
  kind: 'worker_wrap_up';
  sourceRunId: string;
};
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

### Bounds and failure behavior

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
* Timeout status is visible immediately. The single actionable lead return waits
  only until the report arrives or the reporting deadline expires. Queue delay
  counts toward that deadline. If no allowance, session, admission capacity or
  usable provider exists, send the fallback directly.
* Fallback includes termination reason, original assignment, current work state,
  latest available progress references and transcript location. Explicitly say
  no wrap-up report was produced. Do not treat the last utterance as a full report.
* Deduplicate the lead return by source attempt using existing durable input keys
  and settlement transactions. Recheck after restart. A late report is supplemental
  evidence and must not trigger a second competing continuation decision.
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
  coordination / background-work  wrap-up input, settlement, existing admission
  coordination-receipts           retire checkpoint writes; historical reads

shared/src/
  buddy-work.ts                   comment wire schema, reuse evidence strings
  buddy-coordination.ts           minimal run-input extension
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
5. Add bounded wrap-up scheduling in existing coordination with fallback and
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
