# Proposed MCP contract for v2

September 13, 2026. **Design specification, not currently callable tools.**
Current source is pinned by [S01/C01 in the evidence](source-index.md). The normal
resource catalog currently has 25 tools. Legacy completion tools, Builder and
owner-control MCP are separate surfaces; they are not hidden inside that count.

## Role catalogs

The target employee union is exactly **25 tools**. This is the whole union, not
an assertion that every role may call every operation.

| Profile | Tools | Count |
|---|---|---|
| Worker/basic work | `get_current_work`, `update_task`, `get_inbox`, `get_message`, `mail`, `get_document`, `update_document`, `recall`, `remember_note`, `report`, `get_team_state`, `stop` | 12 |
| Lead coordination | Worker/basic tools plus `new_task`, `list_buddies`, `get_capabilities`, `create_worker`, `prompt`, `retire_buddy` | 18 total |
| Granted administration/diagnostics | Additional `get_runs`, `get_profile`, `update_profile`, `create_buddy`, `set_relationship`, `get_automations`, `set_automation` | 7 additional; union 25 |

Profiles are host-selected for the turn, then intersected with the source policy,
current grants, audience and target lifecycle. Restricted policies can expose
fewer tools. A granted Worker lead receives the lead profile in its same work lane.
Optional administration profiles do not require a new per-action approval if
authorization already exists. Selecting a profile cannot expand a saved run's
policy, and tool presence is not proof of mutation authority.

Normal execution uses the chosen provider's coding/browser tools as separately
authorized by the assignment. Buddy MCP does not pretend to be an OS sandbox.
The automatic reporter is a different no-action execution with **zero employee
MCP tools**; the host supplies its snapshot and delivers its result.

## Shared input and result conventions

- Bound identity, originating owner input/run, claim credentials and current
  audience come from the host, never from model arguments. Task/authorization
  IDs are references to inspect, not authority supplied by the caller.
- Each new mutation has `key` and optional `preview`. Preview checks the same
  payload and authority without committing state or dispatch. Apply rechecks.
  Documents retain their existing required explicit `preview` field.
- Replay with the same key and identical payload returns the same receipt;
  different payload is `key_conflict`. Authorization is rechecked before replay
  can disclose protected results. Revisioned mutations require current revisions.
- List responses are bounded `{items,nextCursor}`. Exact reads expand by opaque
  reference. Filtering/authorization happen before pagination. No secret-bearing
  claims or complete private transcripts appear in summary projections.
- Mutation results use `{ok, contractVersion, receiptId, data}`. Data includes
  resulting revisions, saved/delivered/queued state and related references. Errors
  use `{ok:false, code, reason, remedy, resolvableBy, current?}`; `current` is
  permission-filtered. A saved receipt is not a claim that the provider started.
- Expected conditions include `revision_conflict`, `scope_denied`,
  `incompatible_context`, `review_required`, `capacity_wait`,
  `authority_exhausted`, `effects_unsettled`, `root_stopped`, and
  `worker_retired`. Held execution is normally a durable accepted request with a
  reason, not an instruction to retry with a fresh key.

These are conceptual TypeScript signatures. Existing bounded evidence, provider
selection and document-reference schemas are reused rather than independently
redefined for each tool. The implementation must publish one strict Zod schema
per input variant and test the real MCP-to-store boundary.

## All 25 tools

| # | Tool and significant inputs | When used; result and side effect |
|---|---|---|
| 1 | `get_current_work({taskId?, targetBuddyId?, includeClosed?, cursor?, limit?})` | Read Tasks/criteria and their canonical execution summary. A Task detail includes candidate/acceptance, current binding/session, pending causes, latest checkpoint and related request references. No mutation. |
| 2 | `update_task({key, taskId, baseRevision, changes, preview?})` | Update owned/supervised Task criteria, evidence, checklist or status. Parent/owner-only candidate acceptance and ownership handoff are verified. Returns new Task revision. It cannot create an execution allocation. |
| 3 | `get_inbox({cursor?, limit?})` | Read bounded Mail and actionable cause summaries in the current audience. Reading is not acknowledgement of a required decision. |
| 4 | `get_message({messageId})` | Expand an authorized Mail body, permitted evidence, thread and delivery references. Execution detail is linked; Mail state is not Task state. |
| 5 | `mail({key, to, purpose, body, evidence?, taskRefs?, replyTo?, preview?})` | Deliver internal correspondence or a threaded reply. Returns Mail/delivery receipt. No execution, no budget and no continuation implied. |
| 6 | `get_document({ref})` | Read exact authorized content and opaque revision. Ref includes kind, target and audience; a caller-selected audience cannot widen access. |
| 7 | `update_document({key, ref, revision, content, reason, preview})` | Versioned full replacement or shared-document creation from revision zero where allowed. Notes are create-only; soul/private team edits retain their existing explicit grants. Returns revision and preview/diff. |
| 8 | `recall({pattern, kinds?, scope?, since?, cursor?, limit?})` | Literal bounded discovery across authorized scoped knowledge. Preserve current matches by default; kinds narrows them. Returns refs, revisions and bounded snippets, not a broad private-memory search. |
| 9 | `remember_note({key, topic, kind?, body, evidence?, scope?, preview?})` | Append one durable evidence/decision note. Stable key prevents duplicate intent; host-generated name prevents collisions. Never overwrites an old note. |
| 10 | `report({key, kind, taskUpdates?, checkpoint, preview?})` | Atomically save checkpoint, relevant Task updates and the delivery/wake effects selected by kind. Fixed parent routing; cannot choose a new recipient or grant effort. Details below. |
| 11 | `get_team_state({targetBuddyId?, cursor?, limit?})` | Read permitted peer/child work, Worker lifecycle, pending decisions and resolved limits. Include useful current task/model/wait summaries without private memory/chat bodies. Explicit scoped historical inspection retains retired Worker evidence. |
| 12 | `stop({key, target, reason, preview?})` | Terminally stop an owned/supervised request, Worker work binding or authorized root. Fence effects, cancel queued descendants in scope and drain. Returns stop/drain receipt. Worker default scope is its own work, never siblings or its parent. |
| 13 | `new_task({key, title, definitionOfDone, ownerId?, parentTaskId?, objective?, checklist?, evidence?, preview?})` | Create one inert Task with criteria. Owner must be self or a permitted supervised Buddy. Workspace is host-resolved; parent linkage does not grant dispatch. Returns Task ID/revision. |
| 14 | `list_buddies({query?, scope?, cursor?, limit?})` | Discover permitted ordinary colleagues and routes. Workers appear only through authorized parent/team inspection, not as standalone global contacts. Returns scoped contact summaries. |
| 15 | `get_capabilities({targetBuddyIds?, intent?, requestRefs?})` | Inspect exact prerequisites, available authorized role profiles, candidate audiences/policy references and controllers. No intent means no action readiness claim. Mutations still recheck. |
| 16 | `create_worker({key, name, role, brief, config?, preview?})` | Atomically create ordinary Buddy identity in Worker mode, current-parent edge, scoped brief and inherited permitted membership under the staffing grant. No Task execution, schedule or new root allowance. Returns Worker ID/revision and compatible scope references. |
| 17 | `prompt({key, command, preview?})` | Single execution entry: `start`, `turn`, `continue`, `recover`. Returns durable request/admission receipt. Each variant has an explicit effect and permission check below. |
| 18 | `retire_buddy({key, buddyId, baseRevision, reason, preview?})` | Retire a settled Worker under its parent's granted management authority or an ordinary report under explicit profile/execution grants. Reject unresolved work/inputs/drain. Preserve history; never implicitly transfer Tasks. |
| 19 | `get_runs({requestId?, taskId?, targetBuddyId?, cursor?, limit?})` | Expand permitted attempt/admission/recovery diagnostics and historical execution settings. No claim credentials. Normally attached for diagnosis rather than ordinary work. |
| 20 | `get_profile({targetBuddyId?})` | Exact profile/configuration revision under current target grants. |
| 21 | `update_profile({key, targetBuddyId, baseRevision, changes, reason, preview?})` | Change an authorized ordinary profile; configuration changes affect subsequent compatible execution. Staffing mode/parentage and allowance are not arbitrary profile fields. |
| 22 | `create_buddy({key, name, role, soul, config?, preview?})` | Create ordinary standing staff under a staffing grant. Retains inert creation and the established team setup path. Use `create_worker` for temporary parent-owned work. |
| 23 | `set_relationship({key, fromBuddyId, toBuddyId, kind, present?, preview?})` | Attach/detach ordinary manager or consults relationships under explicit grants. Existing cycle/membership checks apply. Cannot mutate a Worker's parent binding into another live relationship. |
| 24 | `get_automations({targetBuddyId?})` | Read authorized saved schedule definitions and status. Definitions do not establish current execution authority. |
| 25 | `set_automation({command})` | Preserve typed create/update/enable/disable, stable keys/revisions and explicit scheduling grants. New definitions use authorized input/templates, not a new Worker renewal mechanism. No implicit enable or new authority. |

## `prompt`: four precise input variants

The target is a permitted Buddy/Worker identity plus a host-resolved scope/binding.
Do not expose arbitrary conversation IDs, claim tokens or provider-session IDs as
execution selectors. Current canonical config fields remain provider-owned
strings and selection modes.

```ts
type TaskVersion = { taskId: string; revision: number };
type PromptCommand =
  | {
      kind: 'start';
      workerId: string;
      taskRefs: TaskVersion[];
      audienceRef: AudienceRef;
      authorizationRef: string;
      instructions: string;
      session?: { checkInSeconds?: number; soloSeconds?: number };
    }
  | {
      kind: 'turn';
      buddyId: string;
      audienceRef: AudienceRef;
      instructions: string;
      inputRefs?: string[];
      binding?: {
        id: string;
        revision: number;
        addTaskRefs?: TaskVersion[];
      };
    }
  | {
      kind: 'continue';
      workerId: string;
      sessionId: string;
      baseRevision: number;
      reviewedCauseIds: string[];
      taskRefs: TaskVersion[];
      decision: string;
      instructions: string;
      soloSeconds: number;
      inspectedEffects?: EffectsInspection;
    }
  | {
      kind: 'recover';
      failedRunId: string;
      sessionId: string;
      baseRevision: number;
      inspectedEffects: EffectsInspection;
      instructions: string;
    };
```

- **Start:** Tasks must already belong to that Worker and fit one audience and
  authorization. Ownership changes use `update_task`; Prompt never transfers a
  Task as a surprising side effect. Reject an already active binding. Reserve a
  feasible first session and its coordination overhead; record one eligible input.
- **Turn:** a short coordination input for an ordinary Buddy, or a serialized
  follow-up in the Worker's existing lane. It creates no new Worker solo allowance.
  Adding related Tasks requires the binding revision, permitted existing ownership
  and the same authorization/audience. If the Worker's session is held for review,
  retain the input held; do not run it under a new “message” allowance. An ordinary
  coordination turn is charged to its host-resolved source root/authorized policy.
  No admissible account means a reasoned hold, not unmetered execution.
- **Continue:** parent/authorized supervisor only. Consume current held session
  revision and inspected causes; save decision, next allocation and one request
  atomically. Requires full old-executor drain. If a failure left uncertain effects,
  inspection is mandatory. New cause revisions or cancellation win over stale input.
- **Recover:** recover a failed attempt only after inspecting effects. Keep the
  same session clock, original resource account and immutable failed receipt. If
  required solo review is due, return `review_required`; use explicit Continue.

`EffectsInspection` names the relevant checkpoint/failed attempt, records what is
confirmed completed versus uncertain, and explains which next effects are safe to
attempt. Text is an attestation; unresolved reservations or host-observed active
effects cannot be cleared by persuasive prose.

No variant allows the Worker to renew itself. An owner-authorized fresh assignment
uses a genuinely new authorization, not a new key on an exhausted old request.
Receipts expose request/attempt/session distinctions and latest hold/stop reasons.

MCP does not block on a long-running Prompt. UI/CLI observation can subscribe or
poll the existing request projection. Ending observation does not cancel it. The
existing provider runner and single WS spine provide events; no extra transport
or model-facing `wait` tool is added.

## `report`: exact atomic composition

```ts
type Report = {
  key: string;
  kind: 'checkpoint' | 'progress' | 'blocked' | 'ready';
  taskUpdates?: Array<{
    taskId: string;
    baseRevision: number;
    evidence: EvidenceRef[];
    checklistUpdates?: ChecklistEvidenceUpdate[];
    reason?: string;
  }>;
  checkpoint: {
    artifacts: Array<{ ref: string; version: string; sha256?: string }>;
    effects: Array<{ description: string; state: 'confirmed' | 'uncertain' }>;
    resume: string;
    summary: string;
  };
  preview?: boolean;
};
```

`checkpoint` saves recovery facts without Mail. `progress` additionally sends
parent Mail. `blocked` requires affected Task IDs and a concrete reason; it records
those blockers and queues parent attention. `ready` requires affected Task IDs,
completed checklist evidence and versioned candidate artifacts; it moves those
Tasks to review and queues parent attention. None accepts a Task as done.

Apply only supplied authorized Task updates; other Tasks do not change. Failure of
one revision rejects the whole transaction. Kind-specific required fields are
strict schema refinements. Empty/missing evidence stays explicit and cannot pass
ready validation. Producer checkpoints remain attestations, not host verification.

The parent recipient and default disclosure audience come from the actual binding.
The checkpoint-only variant can retain participant-private material; any
Mail-producing variant must save a distinct parent-shareable checkpoint projection
and reject content references that the parent cannot read. Opaque or unstructured
text still depends on permitted context construction and cannot be magically
declassified by a tool schema.

The host produces automatic progress and expiry/failure notices with a distinct
system origin. It reuses the same transaction/delivery code, not the live Worker's
revoked claim. Model reports and runtime observations remain visibly attributed.

## Task acceptance

`update_task` preserves one strict resource patch with revision, criteria,
checklist/evidence, owner and status changes. It adds:

```ts
acceptance: {
  candidateRevision: number;
  criteriaRevision: number;
  artifactRefs: EvidenceRef[];
  observation: string;
}
```

Worker-owned review-required Tasks can enter done only through their parent or
the owner accepting the exact recorded candidate. Completion checks all
non-cancelled checklist items and their evidence in that transaction. Acceptance
does not allocate a new solo session. A changed candidate or criteria returns a
revision conflict. Unrelated task metadata changes still require reconciling the
current Task revision; the acceptance receipt keeps the exact candidate identity.

Workers can update progress/checklist evidence on their own Tasks, but cannot
remove the parent-review requirement, transfer ownership, rewrite assigned
criteria, clear an owner pause or change grants. Blockers/review transitions that
owe parent attention go through `report`; the underlying update service generates
the same durable cause when an authorized UI/admin patch makes that transition.

## Privileged and internal surfaces

**Owner MCP today:** `configure_team` and owner-scoped `get_profile`,
`update_profile`, `get_document`, `update_document`, `new_project`,
`update_project`, `get_current_work`. V2 preserves that boundary, with task-name
aliases matching the new resource contract. Its authority comes from the actual
current owner input. Workers never receive it.

V2 additionally proposes one explicit owner-only `authorize_work({key, rootTaskId,
policyRef, bounds?, baseRevision?, preview})` operation/owner UI action. It records
the root's total active-provider allowance and optional calendar expiry under an
existing owner-approved policy or exact current owner direction. It cannot be
called from a Buddy claim. Saved owner defaults can satisfy the policy requirement
without repeatedly asking the person; if none exists, make the missing work
authorization visible. An update can grant new bounds under actual owner authority
and retains consumed usage/history. This is **one added privileged operation**,
outside the unchanged 25-tool employee union. It makes previously proposed
aggregate authorization explicit rather than hiding it in Mail or staffing.

**Builder MCP today:** `get_soul`, `update_soul`, `update_profile`,
`list_workspaces`, `list_buddies`, `list_created_buddies`, `set_relationship`,
`new_project`, `create_buddy`. Keep its provisioning scope and bridge to canonical
owner resources. Rename its Task surface when migrating the same protocol; do
not turn the Builder into a Worker controller or maintain a second schema for
profile/document mutation. Existing soul aliases can retire when Builder callers
use the same document contract.

**Memory reviewer:** keep its existing memory-only MCP and policy. It is neither a
Buddy employee turn nor a reporter. **Automatic reporter:** zero action MCP tools;
host-provided snapshot, bounded output and fixed-host delivery. **Executor:**
private claim/reconciliation methods only, never user-supplied secrets or public
`claim/start/finish` tools.

## Current employee catalog → v2

| Current tool | Target |
|---|---|
| `get_current_work` | Keep; Task vocabulary and execution summary |
| `new_project`, `update_project` | `new_task`, `update_task`; existing IDs/resources |
| `get_inbox`, `get_message` | Keep; remove execution authority from new Mail semantics |
| `send`, `reply` | `mail`; execution moves to `prompt`; threaded replies use `replyTo` |
| `checkpoint` | `report(kind:"checkpoint")` |
| `retry_run` | `prompt(command.kind:"recover")` |
| `retire_direct_report` | `retire_buddy`, explicit Worker/standing-staff rules |
| `get_document`, `update_document`, `remember_note` | Keep; scope/revisions/append-only notes |
| `recall` | Keep existing scoped Document search; describe it accurately and add public kind filters/cursors |
| `get_capabilities`, `list_buddies`, `get_team_state`, `stop` | Keep with explicit Worker policy and scoped projections |
| `get_runs`, `get_profile`, `update_profile`, `create_buddy`, `set_relationship`, `get_automations`, `set_automation` | Keep in appropriate diagnostic/administrative profile |
| No current equivalent | `create_worker`; `prompt` also covers new bounded continuation |

Counting method: replace Send with Mail, replace Checkpoint with Report, replace
Retry with Prompt, rename work/retirement tools, remove Reply, add Create Worker.
The employee union remains 25. The design's value is the protocol and lifecycle
reduction; no tool-count saving is claimed versus the current union.
