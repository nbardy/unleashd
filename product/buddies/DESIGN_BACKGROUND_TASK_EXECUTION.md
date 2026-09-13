# Background task execution

Current contract · updated 2026-09-13

Use the [team operator guide](TEAM_OPERATOR_GUIDE.md) for setup through verified
return delivery, and [coordination](PLANNING_PRIMITIVES.md) for all native send
variants. Managed work reuses projects/todos, messages, conversations and bounded
runs. There is no separate task entity, scheduler or `start_task` tool.

| Capability | Implementation |
|---|---|
| Completion criteria and evidence | Project/todo store; shared `buddy-work.ts` |
| Typed native delivery | Shared `buddy-resources.ts`, server `mcp-server.ts` |
| Durable attempts and reconciliation | Package background-work/coordination store |
| Shared creation and execution admission | `creation-service.ts`, `run-executor.ts`, `dispatch-service.ts` |
| Owner project controls | `routes.ts`, shared desktop/mobile work panels |

## Assign and accept work

Create recipient-owned work first. Native write fields are `definitionOfDone`
and `evidence`; read records use `definition_of_done` and `completion_evidence`.
Todo edits share their project's revision check. Changing criteria invalidates
stale completion evidence.

```json
{
  "key": "fixture-project-v1",
  "ownerId": "buddy-worker",
  "title": "Verify export fixture",
  "definitionOfDone": "Record the export check with an artifact reference and observed result.",
  "todos": [
    {
      "title": "Inspect export",
      "definitionOfDone": "Open the SVG fixture and record the result and artifact."
    }
  ]
}
```

Use the returned project ID inside **delivery**, and a separate stable send key:

```json
{
  "key": "fixture-work-v1",
  "to": "buddy-worker",
  "purpose": "verification",
  "body": "Complete the project's recorded criteria and attach the inspected artifact and results.",
  "delivery": {
    "kind": "work",
    "projectId": "buddy-project-worker-owned",
    "maxRuns": 3,
    "maxDurationSeconds": 900
  }
}
```

`delivery` is required. Use `request` for one response and `inform` for information;
`work` rejects follow-up/return fields and requires a recipient-owned project.
Self work uses `to: "self"` with the same work variant and a fresh background
transcript. Creating or sending work grants no membership or incoming enablement.
A distinct request cannot create a second active managed obligation on one project.

Defaults, maxima and clock semantics live in
[budgets and limits — implemented behavior](BUDGETS_AND_LIMITS.md#implemented-behavior).
The worker reads inbox/project criteria on each attempt and accepts with a
stable-key, revision-checked `update_project` setting `status: "in_progress"`.

## Completion and returns

The store reconciles the original obligation after a drained attempt; the existing
scheduler also reconciles waiting work. No provider-text completion marker is parsed.

| Authoritative observation | Result |
|---|---|
| Project and all non-cancelled todos are done with criteria and evidence | One final evidence-backed reply |
| Project blocked, or every remaining task blocked after consuming child results | Concrete terminal blocker |
| Project cancelled or request stopped | Fence successors and preserve history |
| Child requests unanswered | Wait visibly within the original budget |
| Duration or attempt limit exhausted | Report the limit with work unfinished |
| Successful attempt left work unfinished | Queue the next bounded attempt in the same worker transcript |
| Failed/interrupted attempt | Report failure; inspect effects before explicit recovery |

A manual final reply cannot discharge incomplete managed work. Optional progress
uses `send` with `delivery: {kind: "inform", inReplyTo: "message-original"}` and a
stable key. The runtime derives the final disposition from project/todo evidence.
A done status is an evidence-backed claim; inspect the actual artifacts to verify it.

Outstanding child requests suspend the managed parent. Child returns reconcile
that obligation instead of creating a parallel return turn. Do not schedule a
self-successor; the existing runtime continues unfinished work within its limits.

Chat-originated results retain the original callback identity. For a human chat,
the result settles in the Mailbox with an explicit `mailboxOnly` delivery receipt;
it does not execute a model or inject chat transcript text. A background lead
needs incoming work and an available background route to continue on child results.
A held return preserves completed work; delivery retry does not replay that work.
See `get_message` and `get_team_state` for delivery history and acceptance metadata.

## Recovery

Save artifacts, then use `checkpoint` to record versioned refs, effects and resume
instructions before long commands. Checkpoints attest saved references; verify
current contents when resuming. Inspect `get_team_state` recovery metadata and
original effects before `retry_run({runId, key, reason, checkpointId?})`.

Supported historical closed timeouts can create a linked successor while retaining
the old failure and original remaining budget/policy. Stopped roots cannot resume;
zero remaining budget cannot be repaired by replay. If further work is authorized,
use a new stable send key and explicit fresh bounds for the existing unfinished
project. Do not blindly replace a held request or restart already completed work.
A hard crash reports interruption instead of silently replaying uncertain effects.

## History and verification

The [pre-repair September 10 design](../../agent_notes/2026-09-13_background-execution-before-operator-guide.md)
preserves the old service-level `execution.mode` example and former terminal-retry
rule with a content hash. Those fields are not the native send contract. Current
recovery evidence is in [coordination reliability](coordination-reliability-2026-09-12/06-implementation-and-verification.md)
and the [September 13 workflow simulation](wave-sim-second-pass-2026-09-13/02-workflow-simulation.md).

Boundary verification covers SQLite/MCP/runtime completion, evidence/criteria
edits, early child replies, waiting expiry, replay, stop/revocation, restart and
failed attempts. Preserve foreground deadline/authority regression tests when
changing timers. Production readiness additionally requires original receipts,
inspected artifacts and actual result delivery from the loaded runtime.
