# Buddy coordination primitives

Current contract · updated 2026-09-13

For the full setup-to-result workflow, start with the
[team operator guide](TEAM_OPERATOR_GUIDE.md).

| Capability | Implementation |
|---|---|
| Native send variants and revisioned work resources | `shared/src/buddy-resources.ts`, `buddy-work.ts` |
| Durable requests, returns, claims and bounded work chains | Package coordination/background-work store |
| Shared creation and input admission | `creation-service.ts`, `run-executor.ts`, `dispatch-service.ts` |
| MCP and owner HTTP access | `mcp-server.ts`, `owner-resources.ts`, `routes.ts` |
| Inbox, replies and project execution in both shells | Shared Buddy components and mobile shell |
| Scheduling and cancellation | [Ownership contract](AUTOMATION_OWNERSHIP.md) |

Buddy messages use the local durable message store. They do not require an
external email account. External mailbox integration is a separate adapter and
authorized effect scope.

## Send and reply

Native `send` requires `key`, `to`, `purpose`, `body` and `delivery`. Optional outer
fields are `evidence`, `workspaceId` and `notBefore`. The sender identity, source
run and original callback conversation come from trusted host context. The stable
key makes retries idempotent; retry the same intended send with the same key.

`delivery` selects exactly one variant:

| Kind | Fields inside delivery | Behavior |
|---|---|---|
| `inform` | optional `projectId`, `inReplyTo` | Information with no reply obligation |
| `request` | optional `projectId`, `continueFrom` | Request one durable response |
| `work` | required `projectId`; optional `maxRuns`, `maxDurationSeconds` | Continue recipient-owned work until evidence-backed completion or a terminal disposition |

```json
{"key":"finding-1","to":"buddy-recipient","purpose":"inform","body":"The export fixture passes.","evidence":["test:export"],"delivery":{"kind":"inform"}}
```

```json
{"key":"review-1","to":"buddy-recipient","purpose":"review","body":"Review the export and return evidence.","delivery":{"kind":"request"}}
```

```json
{"key":"export-work-1","to":"buddy-recipient","purpose":"implementation","body":"Complete the project criteria and record the evidence.","delivery":{"kind":"work","projectId":"buddy-project-recipient-owned","maxRuns":3,"maxDurationSeconds":900}}
```

Create recipient-owned work first with `new_project`, a stable key, concrete
`definitionOfDone` and bounded todos. Then send its project ID with `delivery.kind`
`work`. A reporting line authorizes ordinary supervision; a project reference
alone does not grant dispatch, membership or private-content access. Self-owned
background work uses `to: "self"` and the same work variant.

Defaults, maxima, clock meanings and enforcement limits are defined once in
[budgets and limits — implemented behavior](BUDGETS_AND_LIMITS.md#implemented-behavior).
The example above selects explicit bounds; it is not a default policy.

`continueFrom` identifies an earlier message from the same sender to the same
recipient in that workspace, retaining its destination. `inReplyTo` is an
informational return from the original recipient to the original sender in the
source workspace. These are message IDs, not caller-selected conversation IDs.
Stopped roots and missing destinations require explicit inspection and repair;
repeating a send does not authorize revival of stopped work.

`reply({messageId, outcome, body, evidence})` records the addressed recipient's
response. Purposes and outcomes are open strings. Only the owner can answer
owner-directed messages. Sending an approval request does not grant permission;
the exact action requires an explicit owner response.

## Admission, continuation and completion

A successful send returns durable message and execution receipts. It does not
prove that a provider has started. Use `get_message`, `get_runs` and
`get_capabilities` to inspect actual admission, blockers, acknowledgment and
completion evidence. Readiness settings are prerequisites, not a process
heartbeat. Message receipts are constrained by the current conversation audience;
participating in private mail under the same identity does not publish it to an
unrelated team turn.

Fresh recipient work uses inert shared conversation creation and linking, then
claimed input admission. Creation itself does not execute a prompt. Requests
with valid background continuation routes reuse their established destinations.
Human chats (`placement: default`) are owner control points. Replies, failure
notices and informational returns addressed there remain in the durable mailbox;
delivery settles as `mailbox_only` without provider admission or transcript
injection. Work requests and schedules require a background destination. The
runtime enforces this boundary again immediately before automated input.
The routed Mailbox tab (`/buddies/:buddyId/mailbox`) exposes messages, replies,
evidence and owner decisions in both shells. Source
restrictions narrow the host's `MESSAGE_BUDDY_OPERATIONS` policy. Team tools can
be present while particular actions remain denied: creation requires staffing
authority, attaching existing identities requires relationship authority, and
private documents have separate scope checks. There is no hiring quota or blanket
recipient hiring prohibition.

For managed work, the recipient reads `get_current_work` and `get_inbox` on each
attempt and accepts work with a revision-checked `update_project`. Record progress,
blockers and evidence on the project and its todos. Every non-cancelled todo must
be done with evidence before the project is complete. A manual final reply cannot
complete unfinished managed work; the runtime returns the final disposition to
the original requester.

The native send call returns a receipt without synchronously waiting for the
recipient to finish. Outstanding child requests suspend a managed parent work
chain; replies allow the existing runtime to reconcile and continue it within the
original limits. Do not schedule a parallel self-successor for managed work.
Failure, cancellation, a terminal blocker or exhausted limits remain visible;
late replies do not revive terminal runs. `stop` fences authority and drains owned
provider work. `retry_run` requires inspecting effects, an explicit reason and a
stable key.

A persistent Buddy has its own identity and durable work. Harness sub-agents are
turn-scoped provider capabilities under the parent's identity. They introduce no
additional employee type or public coordination operation.

## Observation and recovery

Native `get_inbox({limit,cursor})` returns compact summaries in the current audience.
Follow `nextCursor`; expand an exact body/evidence with `get_message({messageId})`
and project criteria with `get_current_work({projectId})`. Previews are bounded,
not complete work instructions. Audience filtering precedes message pagination.
The legacy full service response remains available to existing HTTP consumers.

`get_team_state` provides authorized execution metadata, current project snapshots,
published checkpoints, effective limits and recovery controllers. Optional `runId`,
`rootMessageId`, `targetBuddyId`, `offset` and `limit` narrow the page. Checkpoint
and delivery histories have independent offsets/limits and next-page fields.
Structured deliveries retain run IDs, admission timestamps and retry ancestry.
Recorded execution configuration takes precedence over policy estimates; a missing
historical snapshot remains explicit. Neither delivery completion nor a current
project's acceptance proves consumer review of a particular artifact/version.

Save files before `checkpoint({key,artifacts,effects,resume,visibility})`. A
team-visible checkpoint shares its complete payload with authorized observers;
it attests saved references, not current file existence. Recover only after
inspecting effects, using `retry_run({runId,key,reason,checkpointId?})`. A historical
closed timeout can create one linked successor within the original envelope;
its old failure stays recorded. Controller identity is not tied to the old
conversation, but current audience, membership, supervision and stopped/deleted
fences still apply. See the [CEO workflow simulation](wave-sim-second-pass-2026-09-13/02-workflow-simulation.md)
and [second-pass decision](wave-sim-second-pass-2026-09-13/03-second-pass-decision.md).

## Historical contract

The earlier synchronous `wait` / `timeoutSeconds`, `expectsReply` and `execution`
arguments are compatibility/service inputs, not fields in the current native
send schema. Do not copy those examples into native MCP calls. The September 8
version of this document is preserved at commit
`4c6835b53190a64650c8948ac67f7fd6badbf1ed`; it stated “Waiting is part of send” and
incorrectly described all recipient hiring as excluded. The current typed
resource contract supersedes those claims without deleting the earlier design
history. See the [historical wait design](../../agent_notes/2026-08-21_primitives-and-the-wait-design.md)
and the [September 12 note/contract repair successor](IMPLEMENTATION_NOTE_CONTRACT_2026-09-12.md)
for the rationale.
