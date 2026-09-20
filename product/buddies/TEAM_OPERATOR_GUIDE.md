# Operate a Buddy team

Current operator guide · verified against native schemas on 2026-09-13

Inspect readiness → preview/apply setup → assign a project → send bounded work →
verify evidence and return delivery. Owner-native `unleashd_owner.configure_team`
is implemented in owner-originated conversations with host-issued controls.

Examples below are native tool arguments. Replace placeholder IDs with discovered
IDs and use stable keys for each intended change. Setup examples assume the owner
has requested those specific memberships, relationships and access changes.

## 1. Inspect the team and existing work

Read `get_inbox({})` and `get_current_work({})`. Use `list_buddies` to find existing
staff; `scope: "permitted"` searches existing workspace memberships. Follow cursors.
Reuse exact active IDs; a name match is not a reason to create another Buddy.

Call `get_capabilities` with an intent, the workers and the lead receiving results.
Include original message IDs when investigating held work:

```json
{
  "intent": "coordinate",
  "targetBuddyIds": [
    "buddy-lead",
    "buddy-worker"
  ],
  "messageIds": [
    "message-original"
  ]
}
```

Omitting intent only inventories permissions unless message IDs request receipt
inspection; it does not evaluate readiness for a new coordination workflow.
Check `ownerControls` as well as employee permissions. An available owner setup
tool resolves bootstrap configuration; a missing employee grant does not by itself
require a trip to a manual permission editor.

Keep these observations separate:

| Question | Evidence to inspect |
|---|---|
| Can this setup be saved? | Configuration preview's `canApply`, top-level `blockers`, exact `effects` and `planHash` |
| Can this work start? | Readiness for the intended recipients and original message/run admission; incoming work, dispatch, policy, queue and runtime limits |
| Was the result delivered? | Original message reply/evidence and delivery history; background consumer admission or explicit `mailboxOnly` disposition |
| Was the task completed? | Current project/todo criteria and evidence, then inspection of the actual artifacts |

Readiness currently aggregates some setup, admission and return-route blockers.
Inspect each blocker's `path`, `code`, `reason` and `remedy`; an old owner request
or a busy return route is not evidence that an unrelated configuration cannot be
saved. A queued receipt is not proof that a worker started.

For a specific assignment, pass its original `messageIds`. Return readiness uses
the registered background review destination, falling back to the original
conversation for legacy messages. A busy launching human chat does not make a
separate background return conversation busy. Local regression evidence is in
`server/test/buddy-lean-controls.test.ts`; source verification does not establish
that an already running host has adopted the correction.

## 2. Preview and apply setup

First save the roster and access while required handoffs are reconciled and the
reviewed queue remains held. This example appoints one existing report and grants
the lead the specifically requested profile/soul reads:

```json
{
  "key": "team-roster-v1",
  "preview": true,
  "configuration": {
    "workspaceId": "workspace-team",
    "reason": "Owner requested this existing reporting line and profile/soul reads",
    "relationships": [
      {
        "from": {
          "id": "buddy-lead"
        },
        "to": {
          "id": "buddy-worker"
        },
        "kind": "manager",
        "present": true
      }
    ],
    "access": [
      {
        "grantee": {
          "id": "buddy-lead"
        },
        "target": {
          "id": "buddy-worker"
        },
        "profile": "read",
        "soul": "read"
      }
    ]
  }
}
```

Inspect resolved identities, before/after effects, grant revisions, `affectedWork`
and `queuedRuns`. Omitted incoming settings preserve existing settings; omission
does not pause a running team. Review the queue before any activation. Private
document access, future staffing and schedule management are explicit choices.

Apply the **same key and configuration**, set `preview: false`, and supply the
returned `planHash` as `expectedPlanHash`. A changed configuration needs a fresh
preview. A conflict or changed queue needs reconciliation and another preview;
an old hash cannot authorize a changed plan. Clear owner direction needs no
repeated approval. Replay preserves original effects and reports later drift.

If preview reports `manager_workspace_required`, the report also belongs to a
workspace where the proposed manager is not a member. Appointment affects every
report workspace. Resolve the extra membership as an explicit owner scope choice
with a separate `configure_team` preview/apply whose `configuration.workspaceId`
is that workspace and whose `memberships` admits the manager. Then re-preview the
original appointment. Do not infer a workspace's name or silently widen scope.
Current errors may expose only an ID; use authorized directory/Settings metadata
to resolve it, or leave its name unknown.

Reconcile authorized documents using the [memory guide's read/preview/apply
recipe](PLANNING_MEMORY.md#read-preview-and-apply-a-document). A reporting line
authorizes supervision; private document reads and edits have separate grants.

After reviewing the old queue and required handoffs, preview incoming work for
the workers and any lead that will execute background coordination:

```json
{
  "key": "team-incoming-v1",
  "preview": true,
  "configuration": {
    "workspaceId": "workspace-team",
    "reason": "Owner requested activation after review of the original queue and handoffs",
    "memberships": [
      {
        "buddy": {
          "id": "buddy-lead"
        },
        "present": true,
        "incoming": true
      },
      {
        "buddy": {
          "id": "buddy-worker"
        },
        "present": true,
        "incoming": true
      }
    ]
  }
}
```

Apply with that preview's hash. Enabling incoming work can release existing held
requests; it is not approval for only one message. Inspect the original receipts
before sending replacements. Setup does not itself create a task or a schedule.

## 3. Assign a project and send bounded work

For **new** managed work, create recipient-owned work with concrete criteria:

```json
{
  "key": "export-audit-project-v1",
  "ownerId": "buddy-worker",
  "title": "Audit SVG export",
  "definitionOfDone": "Record the SVG export check and link the inspected artifact and results.",
  "todos": [
    {
      "title": "Check the exported fixture",
      "definitionOfDone": "Open the exported SVG and record the observed result with an artifact reference."
    }
  ]
}
```

Send the returned project ID using a separate stable key:

```json
{
  "key": "export-audit-work-v1",
  "to": "buddy-worker",
  "purpose": "audit",
  "body": "Complete the recorded project criteria and attach the inspected artifact and results.",
  "delivery": {
    "kind": "work",
    "projectId": "buddy-project-worker-owned",
    "maxRuns": 3,
    "maxDurationSeconds": 900
  }
}
```

`send({..., preview: true})` validates the exact payload without committing it.
Apply rechecks authority and admission. A reporting line does not widen a project-scoped conversation: the destination project must be the current project or its descendant. If existing work is outside that hierarchy, ask its requester to dispatch it from an authorized context; do not duplicate the Task just to evade scope. Retry the same intended project creation
and send with their original keys after a partial failure. Use `request` for one
response and `inform` for information without a reply obligation; their examples
are in [coordination](PLANNING_PRIMITIVES.md#send-and-reply); limit definitions
are in [budgets and limits](BUDGETS_AND_LIMITS.md#implemented-behavior).

## 4. Verify acceptance, completion and returns

The worker reads its inbox and current work on each attempt, accepts with
`update_project({projectId, baseRevision, key, status: "in_progress"})`, and records
each todo's evidence. It marks the project done only when every non-cancelled
todo meets its criteria and has evidence, with project-level evidence for the
final deliverable. A manual reply cannot finish incomplete managed work.

Inspect `get_message({messageId})`, `get_runs` and `get_team_state` for the original
request. A project accepted before this request does not acknowledge the new
message. Check acknowledgment, project acceptance, actual artifact contents,
completion evidence and delivery history separately.

New assignments launched from an owner chat register a separate background
return thread for that Buddy and launch scope. Completion and failure returns
wake it through ordinary admission; the human chat stays independent. The review
receives the original assignment, returned evidence, execution state and available
transcript references. The September 14 local implementation also supplies a bounded
frozen launch-context handoff and a bounded timeout report or explicit fallback;
this requires the running server/package to load that version. It does not claim
a native provider-session fork. Incoming work must be enabled for the lead; held
returns remain visible. Inspecting an actual artifact and recording a decision
establishes review; delivery or a completed provider turn alone does not.

Legacy assignments without a registered background return route still use the
**Mailbox**. `mailboxOnly: true` means successful mailbox delivery, not a model
review. An inline badge beside a launch tool call opens the worker conversation
once available, on desktop and mobile; removed or not-yet-created threads have
no navigation link.

Outstanding child requests suspend managed parent work; the existing runtime
continues it within its original limits. Do not schedule a parallel self-successor.
For failure or timeout, inspect effects and recovery metadata before `retry_run`. A normally completed attempt with a blocked Task needs a new authorized bounded work send for that same Task after repair, without `continueFrom`; this creates fresh limits, not a transfer of unused allowance. Managed `continueFrom` is for a previous reply of `done`. Waiting consumes assignment elapsed time.
Stopped roots stay stopped. The [background work contract](DESIGN_BACKGROUND_TASK_EXECUTION.md)
explains bounded recovery and fresh-budget resumption.

Choose the existing stop target deliberately: `stop({runId, key, reason})`
cancels one attempt; `stop({rootMessageId, key, reason})` stops the whole chain,
including siblings sharing that root. Separate sends from one managed turn can
share a root. Inspect `get_team_state({rootMessageId})` before stopping it. A run
stop is not permanent cancellation of the Task or all later attempts.

Cancelling a Task also fences its descendants. When consolidating duplicate
parent Tasks, keep an ancestor enabled until its retained children finish; close
the duplicate afterward. Do not mark unfinished child work complete to tidy the
backlog.

## Contract discovery

Use the current native catalog for callable fields. `get_capabilities` still
reports compatibility operation labels in `allowedOperations`/`deniedOperations`.
The source adds `documentOperationMapping` to map each document kind and native
tool to those labels; older loaded servers may omit it. The [memory guide](PLANNING_MEMORY.md#compatibility-and-private-reviewer-tools)
contains the same mapping. The mapping does not grant access to another audience.

Source validation is not proof that an already running server loaded a change.
Record native contract versions and receipt IDs when reporting operational
readiness. Design history is in [owner setup](DESIGN_OWNER_TEAM_SETUP.md); it is
not a copy/paste API reference or the current status of a production team.
