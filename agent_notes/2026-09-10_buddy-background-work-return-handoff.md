# Buddy background work — implementation and usage handoff

September 10, 2026. Extends the existing team coordination contract with task-driven
background execution. API/MCP contract `2026-09-10.3`; package schema 24.

## What a lead or owner does

Keep the deliverables and completion criteria in a project and its tasks. Start that
project using the existing `send` tool with an execution policy. No `start_task` tool or
second goal record is needed. In the owner UI, open the Buddy's Work page, edit task
criteria and choose **Run in background**. Desktop and mobile use the same controls.

Example MCP composition (substitute returned IDs; these are separate calls):

```js
get_capabilities({targetBuddyId: SPECIALIST_ID})
new_project({
  key: "wave-demo:project:v1",
  ownerId: SPECIALIST_ID,
  title: "Create the wave-pool demo",
  definitionOfDone: "A reproducible demo video and its tested configuration are linked.",
  todos: [
    {title: "Validate the demo configuration", definitionOfDone: "The selected configuration runs successfully and its validation output is saved."},
    {title: "Record the demo", definitionOfDone: "A playable video demonstrates the agreed wave-pool scenario."}
  ]
})
send({
  key: "wave-demo:work:v1",
  to: SPECIALIST_ID,
  projectId: PROJECT_ID,
  purpose: "deliver",
  body: "Work through this project's tasks, checking their criteria and recording evidence. Report any blocker.",
  expectsReply: true,
  execution: {mode: "until_done", maxRuns: 20, maxDurationSeconds: 3600}
})
```

For self-assigned work, omit `ownerId` on project creation and send to the current Buddy's
ID. The worker gets a separate transcript, leaving the original chat available. A lead
can inspect current work, steer criteria through revision-checked updates and read
`get_message({messageId})`. The original message ID remains stable across attempts.
Repeated project/send keys resume the same effects. A different simultaneous start for
an already-running project is rejected.

Incoming work must already be enabled for the recipient. Reporting relationships allow
project management; profile/private-memory edits retain explicit grants. Execution does
not authorize training, purchases, spending or external contact. In particular, the
wave demo example does not authorize outbound email.

## What the worker records

Read `get_current_work` and `get_inbox` at each attempt. Write the current revision:

```js
update_project({
  key: "wave-demo:validation-result:v1",
  projectId: PROJECT_ID,
  baseRevision: CURRENT_REVISION,
  todoOperations: [{
    operation: "update",
    todoId: VALIDATION_TASK_ID,
    status: "done",
    evidence: ["artifacts/validation.txt: observed successful demo run"]
  }]
})
```

Read results use `definition_of_done` and `completion_evidence`; mutation arguments are
`definitionOfDone` and `evidence`. Each required done task needs its own criteria and
evidence. Finally mark the project done with project-level evidence. Changing criteria
or adding work invalidates stale completion. Provider prose alone does not satisfy this
contract, and recorded evidence is not an independent correctness verdict.

After the provider drains, the runtime either starts one next attempt, waits for child
requests, holds for admission, or returns done/blocked/failed/cancelled/limit_reached.
Use ordinary `send` for child assignments; replies coalesce into the parent's next
attempt. Child work does not automatically inherit the parent's until-done policy.
There is no need to poll by sending repeated self messages.

If every remaining task is blocked, report concrete task blockers. New child results
receive a chance to be consumed before blocked work is settled. An unsuccessful attempt
is not silently replayed. To resume after fixing a failure, blocker or limit, use the same
project and a new stable send key with a new explicit budget. `retry_run` does not reopen
a terminal managed request.

## Inspection, limits and stopping

`get_message` includes `execution.background`: disposition, admitted attempts, limits,
first start, deadline and outstanding child message IDs. Receipt state and task state are
separate: a provider turn ending is not evidence that the task is done. The owner panel
shows the task disposition, blocker/remedy, evidence and available worker transcript.

The default is 20 attempts over one hour; callers may set 1–100 attempts and 1–86,400
seconds. Child waiting counts against elapsed duration. Existing per-attempt deadlines
and workspace admission remain enforced. These are run/time limits, not a new cumulative
cost meter.

The existing `stop({rootMessageId, key, reason})` stops the entire delegation chain,
including related child work; it does not merely stop the displayed attempt. The UI names
this **Stop this work chain**. Project pause/cancel controls retain their existing scope.

Owner HTTP composition:

- `GET /api/buddies/projects/:id/execution`: project, message and attempts.
- `POST /api/buddies/projects/:id/run`: stable key, optional limits and validated return chat.
- Existing `PATCH /api/buddies/projects/:id`: criteria, evidence and task edits.

A Work-page start requires no chat and retains the result on the task. A chat start routes
one final result back to its original chat. Missing/blocked delivery is inspection state;
it must not replay completed work.

## Release evidence and operational limit

The design and transition rules are in
[DESIGN_BACKGROUND_TASK_EXECUTION.md](../product/buddies/DESIGN_BACKGROUND_TASK_EXECUTION.md).
The dated rationale is native note `01M257VHPHV5PCN6D7G0DCHX4T`.

Final package/build/test evidence is appended below after final verification. Tests use
real SQLite, MCP, HTTP and conversation-runtime boundaries with controlled provider
events; they do not establish a live specialist's behavior or independently verify its
research. The active native session reported contract `.2` at 08:42 UTC. After active work
drains, the server must load `.3` and MCP must reconnect before these new arguments are
available. Check `get_capabilities` for matching app/package `.3`; do not re-create or
re-send previously queued specialist tasks merely to refresh the tools.

## Final local verification

- Clean package source commit: `4b7fb017dc1e278c853f9ab3922a7ff50c703b2a`.
- Archive SHA256: `a6220445cbc071d1ed87d0ea3c5fc053168412c1daaa97a5bbc810602011b93b`.
- Official vendor script reports release-ready; root/server installed package source and declarations match the archive byte-for-byte.
- Package: 75 tests pass, including persistence/restart, evidence invalidation, delegated reply ordering, all-blocked work, queue pressure and return-delivery recovery.
- Buddy server: 91 pass, one optional provider-parser test skipped. Includes real owner HTTP start/hold/release/stop and self-work runtime continuation returning once.
- Deadline regressions: foreground and background tests both pass with `max_runtime_timeout` and settlement after provider drain.
- Client: 69 tests pass; project panel covers limit disposition rather than misleading transport completion. Shared/server builds, server and client typechecks, client production build and all six client invariant gates pass.
- No production specialist tasks were started, no external contacts made, and no claim of live `.3` session activation is made. Source integration is complete; activation requires the cooperative reload described above.

Local logs: `/tmp/buddy-background-package-final-20260910.log`,
`/tmp/buddy-background-final-server.log`, `/tmp/buddy-background-final-deadlines.log`,
`/tmp/buddy-background-client-validation.log`.
