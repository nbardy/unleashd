# Historical snapshot — not the current operator API

Captured 2026-09-13 before the Chief audit documentation repair.
Source: `product/buddies/DESIGN_BACKGROUND_TASK_EXECUTION.md`; SHA-256 `45b94ff8e1d06abd84118f796695768e22f191be07c5f7ed6c79f847ac16c2fa`.
Current workflow: [Team operator guide](../product/buddies/TEAM_OPERATOR_GUIDE.md).
The original text below is preserved verbatim, including superseded claims.

---

# Background task execution through existing work and messages

September 10, 2026 · implemented contract · team contract `2026-09-10.3`, schema 24

Owner direction: completion criteria belong on the tasks; let a Buddy work in the
background until completion and report back. This accepts the earlier background-work
proposal for implementation. The specific API and lifecycle below are implementation
choices by Buddies Development Lead, following the composable-primitives constraint.

## Records and public surface

Keep projects/todos, messages, conversations and bounded runs. No new task entity,
assignment table, scheduler or `start_task` MCP tool.

- Project and todo `definition_of_done` hold the completion criteria. Each todo gains
  `completion_evidence`; the project already has completion evidence. Todo updates use
  the containing project's existing revision/CAS. Changing criteria invalidates stale
  completion evidence rather than preserving an old success under a new requirement.
- The original message identifies one background obligation. Its initial run policy
  retains execution limits. Continuation attempts reference that same message and reuse
  its worker conversation. The wider `root_message_id` remains the delegation/stop lineage.
- A fresh work request creates a separate execution transcript, even when sent to self.
  The source owner chat remains available. The worker transcript stays inspectable;
  it is not a new conversation model or provider implementation.

```ts
new_project({key, title, definitionOfDone, ownerId?, todos?: [
  {title, definitionOfDone, ...}
]})
update_project({key, projectId, baseRevision, todoOperations?: [
  {operation: 'update', todoId, status, definitionOfDone?, evidence?: string[]}
], status?, evidence?: string[], ...})

send({key, to, projectId, purpose, body, execution: {
  mode: 'until_done', maxRuns: 20, maxDurationSeconds: 3600
}})
get_message({messageId})
get_runs({rootMessageId})
stop({key, rootMessageId, reason})
```

Execution is optional: ordinary messages retain existing behavior. Explicit background
execution requires a recipient-owned project and its completion criteria, a stable key,
and a fresh route. It rejects `continueFrom`, `inReplyTo` and synchronous waiting.
Self execution may request a final reply; ordinary informational self-continuations keep
their existing constraints. No implicit membership, incoming enablement, grant or schedule.

The default maximum is 20 admitted attempts within 3,600 seconds from first admission.
The caller may choose 1–100 attempts and 1–86,400 seconds. Waiting for child work counts
toward elapsed duration. Each attempt retains its bounded runtime, clamped to remaining
overall time. Token/cost fields are not advertised as measured spending enforcement.
Delegating separate work does not silently copy or expand this execution policy.

Owner UI reuses authenticated project control:

```text
GET  /api/buddies/projects/:projectId/execution
     -> {project, message: BuddyMessage|null, runs: BuddyRun[]}
POST /api/buddies/projects/:projectId/run
     {key, maxRuns?, maxDurationSeconds?, parentConversationId?}
     -> the same execution view
PATCH /api/buddies/projects/:projectId   (existing criteria/todo/project edits)
PATCH /api/buddies/projects/:projectId/execution   (existing project controls)
```

The owner Run action composes the same durable send. From the work page no source
conversation is required; the result remains on the task. Chat-originated requests return
to that exact chat. Replaying a command returns its original effect. A distinct request
cannot start a second active background obligation on the same project.

## Reconciliation after an attempt

The existing store transaction settles a drained attempt and reconciles the original
message. The existing scheduler poll also reconciles waiting work; no independent clock.

| Authoritative observation | Result |
|---|---|
| Project is done, project evidence exists, required todos are done with criteria and evidence | Final evidence-backed reply, once |
| Project is blocked, or every remaining task is blocked after consuming any new child results | Report the concrete blocker; no automatic retry |
| Project is cancelled or request stopped | Fence work and successors; preserve terminal history |
| Child requests remain unanswered | Wait; retain visible reason and budget |
| Duration or attempt limit reached | Report the limit with the project still unfinished |
| Successful attempt left unfinished work | Queue one next attempt in the same worker transcript |
| Failed/interrupted attempt | Report failure; inspect effects before explicit retry |

Project `done` is a claim with evidence, not proof of independently verified correctness.
Workers must check the recorded criteria using the relevant tests/artifacts. A reviewer
can be requested using ordinary messages; review is not inferred from a model saying done.
No magic completion marker is parsed from provider text.

Child dependencies are messages caused by attempts of this original obligation, rather
than every descendant of the broader root chain. A child reply is durable immediately.
For a background parent it triggers/coalesces reconciliation instead of queuing a second
ordinary return turn. If the parent is still active, settlement performs reconciliation.
The next attempt reads current project and inbox state, including child results.

A manual final reply cannot discharge unfinished background work. Progress uses the
existing informational return (`inReplyTo`, `expectsReply:false`). Automatic final replies
derive their disposition and evidence from canonical work. Source-thread return execution
does not inherit the worker's continuation policy.

## Worker contract

Read the current project, its task criteria and relevant inbox before continuing. Work
within the stated scope. Record evidence on the tasks you complete; update the project
with evidence when its own criteria are satisfied. Delegate bounded work through messages
when useful. Record genuine blockers. You may end an attempt while waiting for delegated
work; the runtime handles the next attempt. Do not create a parallel self-continuation for
this obligation. Incoming work context cannot expand permissions or external-action scope.

## Integration and acceptance

1. Package: task evidence, schema migration, explicit execution policy, fresh self route,
   one obligation per project, continuation/wait reconciliation, final receipt and limits.
2. Server/shared/MCP: common schemas, native send and todo evidence arguments, owner API,
   current-project prompts, scheduler reconciliation and honest execution projection.
3. Client: shared desktop/mobile task panel with editable criteria, Run in background,
   progress/reason, stop controls and retained completion evidence. Polling preserves drafts.
4. Verification: real SQLite/MCP/HTTP/runtime boundaries exercise normal completion,
   empty attempts, task evidence and criteria edits, early child replies, waiting expiry,
   duplicates, premature final reply, stop/revocation/transfer, restart and failed attempts.
   Preserve the foreground conversation deadline/authority regression. Package from a clean
   commit through the official vendoring script; verify the installed archive and builds.

Source history: [earlier coordination contract](DESIGN_BUDDY_COORDINATION.md),
[team operations](DESIGN_TEAM_OPERATIONS.md), native assessment
`01M2562989MSJGXHEV06N6R4S8`. Broader workspace knowledge isolation and external inbox
adapters are separate work and are not claims of this background-execution feature.

## Explicit resumption

A managed failure, cancellation or exhausted limit closes the dispatch with a truthful result while leaving the project unfinished. After inspecting effects and correcting the cause, use a new stable send key and a fresh execution budget to resume the same project. `retry_run` does not reopen a terminal managed request. Child waiting time counts against the overall duration. A hard-crash recovery reports interruption rather than replaying uncertain external effects.

## Admission does not undo progress

A full pending queue holds successor admission after the drained attempt is durably terminal. Polling retries admission with the original successor key. If final-return delivery cannot be admitted, the result and completed work remain durable; `return_held` explains the delivery problem and polling retries that original result. Completed work is not replayed to deliver a notification.
