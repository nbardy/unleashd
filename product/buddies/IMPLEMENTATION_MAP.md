# Buddies: minimal implementation map

September 14, 2026 · assistant recommendation for the owner's review.

Ready to implement a bounded slice. The [core design](CORE_DESIGN.md) is the
behavioral contract. This map narrows the earlier
[implementation draft](DESIGN_PROGRESS_AND_RETURNS.md); its illustrative APIs and
file splits are not additional requirements. No runtime changes are made here.

Ship this workflow: agent launches a reusable Worker; Worker saves work and
responds to the originating request; the lead receives launch context, reads the
result, and acts. Timeout adds one bounded worker reporting turn or a fallback.
The human conversation remains available. Task comments support shared progress.

## Keep, remove, add

| Keep | Remove or replace | Add only for the missing behavior |
|---|---|---|
| Ordinary Buddy identity, manager edge and memory lifecycle | Any task-owned Worker path when integrating the lean Worker change | Existing lean Worker mode change; no Worker table or separate executor |
| `BuddyWorkProject`, todos, revisions and evidence-backed status | No project/task rename or second assignment ledger | Append/list Task comments |
| Mail request ID, reply body/evidence, child/parent conversation IDs | Disconnected return messages and failure-only checkpoint injection | Frozen launch reference and one consistent return-context assembler |
| `BuddyRunExecutor`, scheduler, claims, deadlines, stop/drain, recovery | Dedicated checkpoint writes and active checkpoint UI | Bounded interruption report through ordinary Mail/run admission |
| Existing conversation creation, adapters and saved history | Return conversation created without launch context | Optional branch metadata on existing creation record |
| Ordinary files and git | Ordinary collaboration through managed knowledge CRUD | File references in existing body/evidence fields; no file registry |

Do not delete old checkpoint rows, referenced checkpoint IDs, historical notes,
or migrations needed to read them. Retire new writes after the replacement works.
Keep identity/memory maintenance and its access checks; removing ordinary
knowledge CRUD is not permission to delete `knowledge.ts` or the memory reviewer.
Separate that tool-surface cleanup from the worker-return slice.

## Types: extend existing records

These are proposed shapes, not declarations of currently available APIs. Use the
existing schema and naming conventions when implementing. Package code remains
JavaScript plus its existing `.d.ts`; shared wire types remain Zod-derived.

```ts
// Existing ConversationCreationMetadata: add optional branch metadata.
type ConversationBranch = {
  sourceConversationId: string;
  throughMessageId: string; // persisted cutoff, never "latest at review time"
  audience: BuddyKnowledgeScope; // host-derived; checked against source authority
};
// creation.branch?: ConversationBranch

// Extend the existing Mail return_policy JSON; keep return_conversation_id.
// parent_conversation_id already identifies the launching conversation.
type LaunchReference = {
  throughMessageId: string;
  toolCallId?: string; // only when the host can verifiably bind a provider call
};
// return_policy.launch?: LaunchReference
// Mail.id is the durable request/response correlation key on every provider.

// One new persistent subordinate record, stored under the existing project.
type BuddyTaskComment = {
  id: string;
  project_id: string;
  author: string; // existing authenticated actor encoding
  body: string;
  evidence: string[];
  created_at: string;
};

// Internal assembled view only: no table, status machine or public report API.
type WorkerReturnContext = {
  request: BuddyMessage;
  sourceRun: BuddyRun | null;
  project: BuddyWorkProject | null;
  report: Pick<BuddyMessage, 'reply_body' | 'reply_evidence'>;
  transcriptReference: string | null;
};
```

Keep outcome/error on the existing Mail/run authorities. No duplicated
`isComplete`, Worker status ledger, artifact-acceptance state or new return enum.
Comments initially target the Task/project; optional todo threading is unnecessary
for the requested workflow. A single comments table needs an actor-scoped command
key and ordering index internally; author/time/ID are never agent-submitted.

The host must capture the launch boundary at dispatch. A provider call may still
be pending then: preserve it as pending, and deliver the later response as a new
correlated event. Never invent a completed historical tool result. If exact native
snapshotting is unavailable, persist a bounded transcript handoff with explicit
omissions and a retained full-history reference. Do not introduce another
transcript store. Tool-call-ID availability needs verification at the bridge;
the current MCP registration does not itself establish provider call identity.

## Functions: change the existing path

`Authority` below means the package's existing actor/workspace/run authority
arguments, not a new authorization framework. `Page<T>` denotes its existing
bounded pagination convention. Signatures are a proposed contract sketch.

```ts
// Package project authority: the only new public work operations.
appendTaskComment(
  input: { projectId: string; key: string; body: string; evidence?: string[] },
  authority: Authority,
): BuddyTaskComment;
listTaskComments(
  input: { projectId: string; limit?: number; cursor?: string },
  authority: Authority,
): Page<BuddyTaskComment>;

// Extend CreateServerBuddyConversationInput with branch?: ConversationBranch.
// Reuse this function; no separate createWorker/createReview/createWrapUp API.
createServerBuddyConversation(
  input: CreateServerBuddyConversationInput,
): Promise<ConversationRuntime>;

// Host-local helpers inside the existing executor unless size warrants extraction.
loadWorkerReturnContext(run: PrivateBuddyRun): Promise<WorkerReturnContext>;
formatWorkerReturn(context: WorkerReturnContext): string;

// Package-internal helper called from existing terminal settlement/reconciliation.
// Returns the ordinary reporting request, or null when no report can be admitted.
ensureInterruptionReport(sourceRunId: string): BuddyMessage | null;
```

Extend `sendCoordinatedMessage`'s existing trusted authority argument to carry the
launch reference alongside `returnConversationId`. Keep `send`, `reply`, project
updates and continuation operations; do not add a parallel `spawn_worker` API.
Worker creation/reuse uses the accepted Buddy/manager mechanism.

`ensureInterruptionReport` uses a stable key derived from the source attempt,
ordinary request/reply state and an explicit reporting allowance. It runs only
after drain, never recursively for a reporting attempt, never after explicit
user stop. Existing reconciliation observes its reply/failure/deadline and sends
one final lead return. Report failure yields a truthful fallback. Source timeout
remains visible immediately. No additional poller, timer owner or Report table.
Select the reporting allowance in implementation, not a new budget taxonomy.

`loadWorkerReturnContext` resolves both `message_reply` and `failure_notice`
through the original request and attempt, including terminal managed replies.
Missing history/report is explicit. It must not select a newer unrelated attempt.
The lead's first background review inherits the launching history; subsequent
reviews reuse that conversation and add the current request/result context.

Extend `knowledgeAuthority` and the briefing/reviewer callers to resolve the
branch's persisted, validated audience. Today non-chat coordinated runs select a
project/workspace audience. Passing private launch history into that unchanged
path would violate the design. Parentage alone cannot supply audience authority.

## Concrete edit and deletion boundaries

* Package `coordination-work.js`: Task comment storage/access/append/list.
* Package `coordination.js` and `background-work.js`: retain launch metadata,
  compose the reporting request and final return through existing settlement.
* App `dispatch-service.ts`: capture launch reference at authorized dispatch.
* `conversation-config.ts`, `creation-service.ts`, `buddy-creation-service.ts`:
  persist branch origin and seed the existing conversation path.
* `run-executor.ts`: replace its inline return-prefix and failure-only checkpoint
  block with the common return context; pass branch metadata at first creation.
* `knowledge.ts`, briefing and memory-review integration: preserve branch audience.
* `operations.ts`, `mcp-server.ts`, shared schemas and project routes: thin comment
  adapters; remove `buddy.checkpoint` registration/input/write handling once ready.
* Package `coordination-receipts.js`: retire `checkpointBuddyRun` new writes.
  Retain historical checkpoint reads and old retry-reference resolution.
* Client Task view: comments and existing file/transcript links. Remove checkpoint
  creation controls and active selection workflow; keep historical evidence readable.

Do not split files just to match this list. Do not rename all `project` identifiers
to `task`, rewrite the scheduler, expand staffing/work graphs, or redesign memory.

## Implementation order and completion evidence

1. Reconcile the app/package baseline and integrate the existing lean Worker
   change. Current archive provenance names dirty source based on `03638bd`, not
   the lean Worker commit `6276968`; `~/git/buddies/src` does not match the installed
   package layout. Locate its actual source/worktree and reproduce the archive.
   Never implement inside `node_modules` or mix unrelated dirty app changes.
2. Make normal launch → worker reply → contextual lead review work through the
   existing path, including audience and durable request correlation.
3. Add Task comments and bounded interruption reporting, then delete checkpoint
   write/UI paths as their replacements land. No duplicate steady-state writers.

Use a real package/runtime boundary to verify correlated normal and timeout
returns, restart deduplication, report failure, explicit stop/drain and audience
isolation. Test comment append/access/idempotency through its real boundary.
One bounded live workflow must show the Worker saving a file and the lead reading
it and actually continuing, redirecting or accepting the work while human chat
remains usable. Run repo-required typechecks/invariant gates for touched code.
One provider passing is not all-provider proof.

This is enough design to start. Resolve bridge snapshot/call-ID support and the
reporting allowance with the first implementation; do not start another general
planning round or manufacture new product objects to answer them.

## Delivered evidence — September 14, 2026

The owner subsequently authorized this slice and four implementation sub-agents.
The [implementation record](../../agent_notes/buddies/20260914_lean-workers-implementation.md)
maps the delivered behavior, actual API choices, deletions, package provenance,
passing tests and normal/timeout live proof. The proposal text above is retained
as historical planning evidence; use the dated implementation record for what
was built and its remaining limits.

## Owner clarification and local closeout — September 14, 2026

Checkpoint-history preservation and backward compatibility are not requirements;
this supersedes the earlier assistant-selected preservation constraint above.
The verified delivery retired checkpoint writes/UI but still contains historical
readers and a rejecting compatibility adapter. See the
[dated closeout](../../agent_notes/buddies/20260914_delivery-closeout/README.md)
for the exact delivered boundary, fresh checks and local source preservation.
