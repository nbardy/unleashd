# Buddy teams: complete setup through the owner conversation

Design revision 2 · September 10, 2026 · implementation of the owner-approved setup direction.

**Operator entry point:** [Team operator guide](TEAM_OPERATOR_GUIDE.md). This file
preserves dated design decisions and acceptance plans; use the guide and native
schemas for current calls. Production readiness comes from native work and receipts.

**September 12 successor:** permission consolidation uses contract
`2026-09-12.1`, with the same schema 25 and saved permission model. See section 13 for
the owner-approved replacement of the separate access editor and mutation endpoint.

**September 10 status:** contract `.4` / schema 25 implemented in source and the integrated package.
The owner requested implementation after revision 1. Automated boundary validation and
activation evidence are tracked in the [implementation handoff](../../agent_notes/2026-09-10_owner-team-setup-implementation-handoff.md).
This document describes behavior; production team status remains in native projects and
receipts. Implementing setup does not itself configure the owner's existing staff.

## 1. The problem we are actually solving

An owner should be able to say, in a conversation with a lead:

> Make Pixel and Path my research team, reconcile the handoffs I authorized, and start
> their existing bounded audits. No training or paid compute.

The system should resolve those identities, apply the authorized configuration, and show
the original requests progressing. The owner should not need to learn permission strings,
find another settings screen, enable each member, or relay permission requests back to
the same conversation. New and existing employees must follow the same setup path.

Our earlier design implemented the individual controls but omitted this complete path.
The recovery test makes three separate owner HTTP changes before testing the lead. It
therefore proves the mechanisms while skipping the failure the owner experiences.

The repeated `owner_grant_required` result is consistent with the current authority model.
The missing feature is an owner-scoped setup composition reachable from this conversation.
A more detailed denial, another grant checkbox or an employee self-grant tool would not
complete that path.

Two details in the latest handoff illustrate why callers should not assemble grants:

- In package `.3`, setting Chief as the manager does not require Chief to grant itself
  `relationship.write`; the actor-as-manager endpoint is exempt. Other affected endpoints
  and a report's other workspaces still require checks.
- Changing only `backgroundEnabled` requires `profile.read` and `execution.manage`.
  `profile.write` is required when profile fields are also changed. It is not a prerequisite
  for that execution-only patch.

The setup compiler must derive these prerequisites from the same checks used by mutation.
It must not copy a lead's guessed permission list into broad grants.

## 2. Keep the atoms; finish the composition

Keep the existing Buddy, membership, relationship, access grant, project/todo,
document/note, message, run, schedule and command receipt. A Chief or Lead remains an
ordinary Buddy. There is no new Team, Assignment, Goal, onboarding state machine or queue.

Add **one owner operation, `configure_team`**, which prepares and applies a bounded batch
of existing configuration changes. Builder, owner chat and Settings call the same service.
The operation has a reviewable plan and an atomic configuration commit. Its result links
existing messages and their run state; execution continues through the existing scheduler.

Separate two principals, without introducing two kinds of employee:

| Principal for this turn | Authority |
| --- | --- |
| Owner assistant handling an authenticated owner input | Owner control operations in the host-selected scope, used within the owner's instructions |
| Buddy handling a message, continuation, delegation, schedule or memory review | Current persisted employee grants intersected with the run's immutable policy |

Talking to Chief does not require making Chief a permanent owner. The owner assistant can
configure Chief's team on the owner's behalf, then Chief operates through its saved grants.
Receiving a result in that same visible thread does not receive the previous owner turn's
authority. Authority belongs to the admitted turn, not the conversation title or history.

```mermaid
flowchart LR
  O[Owner asks in lead chat or Builder] --> P[Resolve identities and prepare exact setup]
  P --> C[Owner-scoped configuration commit]
  C --> R[Existing relationships, memberships and grants]
  R --> L[Lead creates or selects bounded work]
  L --> M[Existing send and durable run queue]
  M --> E[Employee records evidence and replies]
  E --> F[Restricted follow-up in lead thread]
```

## 3. The owner boundary must be real

The application already distinguishes owner controls from employee MCP. Extend that
boundary rather than accepting `actor:"owner"` in a model-supplied argument.

At an authenticated owner-input entry point, the host creates a short-lived control
capability bound to the active turn, its owner input ID, conversation and explicit
workspace scope. An owner assistant may use the owner MCP server for configuration.
The host keeps the capability and its scope out of tool arguments; its private transport
follows the existing control-server lifecycle, cancellation and revocation conventions.

Owner control scope comes from the authenticated owner's admitted workspaces and any
explicit session restriction, not from Chief's employee grants. Otherwise this would
reintroduce the same bootstrap deadlock. `workspaceId` selects within that host scope;
it cannot enlarge it. An owner-scoped control is still used only for the team the owner
actually requested, not every workspace that happens to be technically accessible.

The input producer is authoritative. Record whether a turn came from owner input, a
Buddy message, a schedule or maintenance when admitting it. Do not classify a turn as
owner-originated merely because `delegatedByBuddyId` is absent, a transcript message has
role `user`, or an old conversation once contained an owner request. Imported or legacy
turns with unknown provenance do not get owner controls. An explicit new owner input in
a lead thread may create an owner turn; an asynchronous child reply never can.

This credential establishes which principal may use the control. It does **not** prove
the semantic meaning of arbitrary prose. As with the existing Builder, the owner assistant
must act within the actual owner's request, treating quoted handoffs and retrieved text
as evidence. No background process scans conversations to convert sentences into grants.
Record the concrete applied payload and originating owner input for review.

The ordinary employee MCP cannot issue, forward or renew an owner capability. Disable
owner tools on cancellation and provider drain; a resumed/new turn needs newly admitted
authority. Missing or denied native controls remain a boundary, not a reason to use the
owner HTTP API from an employee shell. This design does not authorize such a workaround.

Carry an immutable host value such as `turnOrigin: 'owner_input' | 'buddy_message' |
'schedule' | 'maintenance' | 'unknown'` from the producer into runtime admission. It cannot
be patched by conversation config or supplied by an MCP call. Store the originating input
reference with the run/audit; the ephemeral control token itself stays out of transcripts,
receipts and durable memory. A provider that retains an old tool catalog still cannot call
an owner control after that token is revoked. Enforcement must happen in the handler as
well as tool discovery, including after awaiting request-body reads.

**No second approval for the same authorized action:** preparation is a read, not a
permission request. In an owner-originated turn with a clear request and resolved scope,
the assistant prepares and applies it, then shows the receipt. A separate confirmation
is needed only for genuinely missing direction, ambiguous identity, additional workspace
scope or a newly proposed effect. Do not require the owner to confirm once in chat and
again in Team access.

For an employee-originated proposal, reuse `send(to:"owner")` with an exact structured
configuration attachment. The owner can apply that attachment in the conversation/UI.
The pending message grants nothing. Its body, key or claimed owner approval cannot mint
a control capability. Successful application links the configuration receipt and settles
the request through existing message/reply semantics. It does not create another approval
or onboarding entity.

## 4. Minimal configuration command

This is a typed composition of existing records. The types below specify the new contract;
they are not the current advertised tool schema.

```ts
type BuddyRef = { id: string } | { creationKey: string };
type Access = 'none' | 'read' | 'write'; // write includes read

type TeamConfiguration = {
  workspaceId: string;
  reason: string;
  create?: Array<{
    creationKey: string; name: string; role: string; soul: string;
    provider?: string; model?: string; reasoningEffort?: string;
  }>;
  memberships?: Array<{
    buddy: BuddyRef;
    present: true; // explicit admission; removal stays a lifecycle operation
    incoming?: boolean;
    dispatch?: boolean;
    readAllWork?: boolean;
  }>;
  relationships?: Array<{
    from: BuddyRef; to: BuddyRef;
    kind: 'manager' | 'consults'; present: boolean;
  }>;
  access?: Array<{
    grantee: BuddyRef; target: BuddyRef;
    relationships?: boolean;
    profile?: Access;
    soul?: Access;
    memory?: Access;
    incoming?: boolean;
    schedules?: boolean;
  }>;
  staffing?: Array<{
    grantee: BuddyRef; enabled: boolean;
    createdBuddyIncoming?: boolean; // default false; explicit future-hire mandate
  }>;
};

type ConfigureTeamInput = {
  key: string;
  configuration: TeamConfiguration;
  preview: boolean;
  expectedPlanHash?: string; // required for apply, from preview
};

type SetupBlocker = {
  code: string;
  path: string; // precise configuration field or message ID
  reason: string;
  resolvableBy: 'owner' | 'lead' | 'runtime';
  remedy: string;
};

type TeamSetupResult = {
  contractVersion: string;
  key: string;
  planHash: string;
  canApply: boolean;
  blockers: SetupBlocker[];
  effects: Array<{
    resource: 'buddy' | 'membership' | 'relationship' | 'grant';
    id: string; before: unknown; after: unknown;
  }>;
  resolvedBuddies: Array<{ ref: BuddyRef; id: string | null; name: string }>;
  affectedWork: Array<{
    messageId: string; runId: string | null;
    recipientId: string; state: string; code: string | null;
  }>;
  receipt: null | { auditId: string; appliedAt: string; replayed: boolean };
  readiness: TeamReadiness;
};
```

Wire schemas use the actual discriminated resource types instead of the abbreviated
`unknown` shown for before/after above. Bounds: at most 32 identities, 64 edges, 128 access
entries, one workspace per command, 256 KiB total. Larger setups use independent batches
and report their receipts separately; they must not claim cross-batch atomicity.

Minimum model changes are the immutable turn-origin/input provenance and the optional
future-hire incoming setting on a staffing grant described below. Preparation is a value;
committed setup is an existing command receipt. Do not add a mutable team manifest, approval
table, setup status column or separately stored capability projection. The configuration
payload composes existing record types; it is not a new enduring resource.

`creationKey` refers only to a creation declared in this payload. Resolve it against the
existing creation receipt mechanism in a stable owner/workspace namespace, shared across
Builder and owner chat; the same key never creates another identity when the conversation
or setup command key changes. Changed creation arguments conflict. A new key is an explicit
new identity request, not a rename or a retry. It is not a name lookup. A preview reports
`id:null` for a genuinely new identity and keys its effects by creationKey; commit allocates
the ID and stores the mapping. The plan hash binds creation keys, not invented future IDs.
Unknown, archived, duplicate, contradictory or ambiguous references
reject preparation with all discoverable problems. Do not reactivate, merge identities,
change another workspace or grant access by matching a role name.

Omitted fields preserve existing state. `false`/`none` explicitly remove the corresponding
permission. Duplicate settings for the same target reject rather than depending on order.
Normalize write access to read+write. `incoming:true` access expands to `execution.manage`
plus the profile read needed by the current control; it does not grant profile write.
Contradictory requests such as `profile:'none'` together with `incoming:true` reject with
the dependency explained rather than silently overriding an explicit denial.
The independent membership `incoming:true` enables that recipient now. Granting a lead
the right to enable it and actually enabling it are different effects, both visible.

`relationships:true` is a convenience spelling for the existing exact-target capability,
not a dynamic subtree grant. A manager already has ordinary work supervision. A preset
for maintaining a roster adds the exact affected endpoints needed by existing checks.
Compiler output explicitly shows every grant and retains unrelated existing capabilities.

Presets are pure UI/model helpers expanding to this schema, not persistent roles. Suggested
choices are **Coordinate work**, **Maintain profiles**, **Maintain private documents**, and
**Manage recurring schedules**. Basic work coordination includes the requested reporting
edges, dispatcher membership, incoming work for the participants, and work visibility. It
does not grant private memory simply because someone is a manager.

The owner's Font Maker request includes document reconciliation, so its concrete plan
includes those named targets' authorized soul/memory access. An ordinary "work with these
people" request does not. Profiles and private documents remain global to the Buddy in
this release; the preview must say which other workspaces are affected.

### Scope and graph invariants

- Global manager edges retain one manager and cycle rejection. Check the complete proposed
  graph, not a sequence of intermediate trees. Expose prior managers and affected workspaces.
- Manager appointment currently requires membership in every report workspace. A plan
  cannot silently add a manager to another workspace. Return that exact scope dependency;
  an owner can admit it explicitly in a separate scoped command, then replay preparation.
- A root Chief's request to see all workspace work can explicitly set its existing
  `readAllWork` membership. This exposes work metadata, not private messages/documents.
  It is workspace-wide, not a promise of private team-only visibility. Otherwise leads
  supervise direct reports and obtain deeper work through their leads/shared projects.
- A consults edge creates neither a second manager nor document access. Staff hidden from
  the top-level directory remain discoverable within authorized scope; hiding is navigation.
- Report movement does not carry grants, credentials, projects or pending work to the new
  manager. The preview enumerates former-manager grants and offers explicit revocation.
  Reorganization applies those selected revocations with the new appointment. Omitting
  them preserves them and visibly reports that access remains.

### Why documents and tasks are outside this command

Configuration commits identity/roster/authority/incoming settings. Handoff content import
then uses existing revision-checked document operations. Initial projects and dispatch
use existing work/message operations. The owner-visible workflow follows those steps and
their receipts, but does not pretend that file import, model execution or external actions
are part of a single database transaction.

When the request is "onboard, then start," there are two configuration commits within
one owner-authorized workflow. First attach/grant while preserving the currently held
incoming settings; import and verify documents; then enable incoming work using a second
stable command key. An unconfigured new hire stays held until import completes. No extra
owner approval is needed for these already authorized phases. On failure, report the exact
phase and leave queued work held; retry resumes from the saved receipts/revisions.

If a recipient already has active work and the requested import must precede further
execution, use the existing project pause/drain controls on the affected work first.
Disabling new admission alone does not stop an active provider. Do not stop unrelated work
merely to make an onboarding test pass. Surface that concrete conflict to the owner if its
resolution goes beyond their instruction. For a new team whose complete initial souls are
created in the configuration transaction, immediate incoming activation can share that
commit. Profile import is never claimed complete merely because a grant was saved.

For new staff, initial soul is part of existing identity creation; all existing documents
are preserved. Importing working/long-term memory is the same later step for new and
existing identities. Preserve historical notes and evidence; never treat task status in a
handoff as the current work ledger. Initial profile files use the package's staged atomic
creation, cleanup and projection recovery, not app-side direct file writes.

## 5. Prepare, commit, recover

`prepareTeamConfiguration` is a read-only service. It resolves references, expands presets
and capability prerequisites, computes a proposed graph, reads revisions, and returns
every applicable blocker. An incompatible runtime is reported as unknown capability,
not a fabricated empty team. Inaccessible resources do not leak through error details.

The `planHash` binds the normalized intent, resolved identities, contract version, relevant
configuration revisions/current field values and complete affected grant rows. It excludes
live progress timestamps, which would make an otherwise valid plan immediately stale.
The inventory of pending work released by enabling incoming work is part of the plan;
new queued inputs before commit require a fresh preview, so the stated release set stays
reviewable. The flag explicitly also authorizes future permitted incoming work.

Apply requires a current owner control capability and the prepared hash. In one store
transaction, re-evaluate all admission/configuration invariants, create any new identities,
write memberships/relationships/grants, record audit provenance and save the existing
command receipt. A stale plan returns all changed resources and mutates nothing. The
assistant may reprepare harmless races within the same owner instruction; changed scope
or new effects must be assessed against that instruction, not silently accepted.

Reuse `coordinationCommand`/the existing command receipt table for atomicity and replay.
The receipt key is scoped by owner + workspace + operation + stable setup key. Include the
operation name in the normalized payload to prevent collisions with other owner commands.
Nested writes use deterministic child keys and the same transaction. No network or provider
await is permitted inside the commit. Reuse/stage the existing identity file effects before
database publication; a projection failure is explicit and repairable, never a false rollback.

The durable receipt records applied effects, input hash, entity mappings and audit IDs,
not live task progress. Same key + same request returns that receipt, even if its base
revisions are now stale; it does not reapply revoked access or overwrite subsequent edits.
Same key + different configuration conflicts. Hash the semantic configuration independently
of `preview` and `expectedPlanHash`; those are read/CAS controls, not a new logical command.
After verifying the caller's authority, look up a committed receipt before comparing the
old expected plan hash. Otherwise a successful command could not be recovered after a lost
response. Re-check current read authority before returning
sensitive receipt fields, and compute current readiness separately. A lost HTTP/MCP reply
after commit is recovered by repeating the original request, not by choosing a new key.

After commit, wake the existing queue poller. The poller is already durable: a crash between
commit and wake is recovered by polling. Apply never creates replacement task messages or
retries failed/interrupted provider runs. Existing queued obligations keep their IDs, task
bounds, source thread and original policies. Repeating setup creates no additional runs.

The HTTP/MCP configuration response does not wait indefinitely for model work. Return the
receipt and current readiness immediately. The existing message/run views and inline card
observe later admission, acknowledgment and completion. An observation timeout means
"not yet observed," not provider failure and not permission to resend the task.

Incoming work is a recipient-wide setting today. Enabling it may release multiple eligible
requests, not just the two named in a handoff. Preview the complete affected queue and
run limits. If the owner intends only selected requests, preserve the disabled recipient
until other queued obligations are explicitly resolved; do not invent a per-message
authorization flag in this feature. Disabling incoming work stops new admission; stopping
already running work uses existing `stop`, with its drain semantics.

## 6. API and MCP surface

One canonical preparation/apply service and schema serve all entry points:

```ts
// New, host-authorized owner operation. Authority is not an input argument.
unleashd_owner.configure_team(ConfigureTeamInput): TeamSetupResult;

// Owner HTTP, through the existing authentication and reload mutation gates.
POST /api/buddies/team-configuration // ConfigureTeamInput; preview or apply

// Existing employee tools gain bounded read-only inspection; no employee grant writer.
list_buddies({
  workspaceId?, scope?: 'current' | 'permitted', query?, limit?, cursor?
});
get_capabilities({
  workspaceId?, targetBuddyId?,
  targetBuddyIds?, messageIds?,
  intent?: 'coordinate' | 'maintain_profiles' | 'maintain_documents' | 'schedule'
});
```

Keep legacy single-target capability fields and directory offset inputs during migration.
Reject conflicting pagination/selectors. `targetBuddyIds`/`messageIds` are bounded at 32;
`targetBuddyId` is mutually exclusive with the plural selector. An intent is a read-only
diagnostic recipe, not a permission or mutation. Precise edits are validated against their
actual fields again by preparation/apply. Workspace overrides require actor membership.

`scope:"permitted"` means the union of workspaces already visible to this principal,
stable ordering by identity and workspace, opaque continuation cursor and bounded results.
It returns contact metadata and the possible route, not memory, projects or private logs.
Unknown and inaccessible IDs are indistinguishable. A discovered contact cannot be sent
work without a separately valid route. No global directory or address-book table is added.

`unleashd_owner` is a host control adapter available only on owner-originated turns, not a
new kind of Buddy. Builder and a lead's owner conversation expose the same operation.
Builder's existing per-record helpers remain compatible but use this preparation logic
for team setup; its created-in-this-conversation restriction must not be bypassed through
the employee server. Adoption happens explicitly through the new owner boundary.

Capability inspection also reports whether this turn has owner controls and whether the
loaded owner/employee tool contracts match. A missing owner adapter has a runtime remedy,
not a recommendation to grant the employee owner access. For the owner this renders as
"Team setup controls need the matching runtime"; private capability tokens never appear.

For an employee proposal, extend the existing owner message attachment allowlist with a
typed `team_configuration` payload. Validate its size/schema and accessible identities.
This can be rendered by the owner UI and applied using owner authority; it is never
executed because of its purpose string or because a message was marked read. A successful
apply receipt, not arbitrary reply text, is the configuration evidence.

Retain `create_buddy`, `set_relationship`, profile/document operations, `new_project`,
`update_project`, `send`, `reply`, run inspection, cancellation and scheduling as ordinary
employee atoms. Their grants and run policies continue to be checked at mutation time.
There is no new employee `start_task`, `assign`, `start_conversation`, `hire_team`, `grant`
or `unblock` tool. `configure_team` is the one new owner composition that closes setup.

### Accurate advertised schemas are a release requirement

Fix `set_automation` registration so real MCP `listTools` describes its create/update/
enable/disable inputs. Keep canonical discriminated validation; flatten only the transport
schema if a provider requires it, and reject invalid combinations in the same handler.
Generate the transport shape from the canonical schemas instead of maintaining a second
handwritten argument list. Test both discovery and calls through an actual MCP client.

Document preview must return only the requested document, base revision and focused diff.
A preview needs read permission; commit needs read+write, a current revision, reason and
stable key. It does not include an unrelated long-term memory envelope. Stale conflicts
must respect current read authority before returning the current body.

## 7. Readiness is a projection of the whole round trip

```ts
type TeamReadiness = {
  checkedAt: string;
  configuration: 'ready' | 'blocked' | 'unknown';
  blockers: SetupBlocker[];
  participants: Array<{
    buddyId: string;
    canReceive: boolean | null;
    canReturn: boolean | null;
    operations: Record<string, {
      allowed: boolean | null; blockers: SetupBlocker[];
    }>;
  }>;
  work: Array<{
    messageId: string; runId: string | null;
    state: string; code: string | null;
    acknowledgedAt: string | null;
    projectId: string | null; completionEvidence: string[];
  }>;
};
```

Use the same pure predicates for inspection and commit, returning an array of failures
rather than only the first. Check the sender, recipient **and return path**: workspace
admission, reporting scope for requested work, grants/read dependencies, active identities,
run tool policy, incoming work, paused memberships/projects, quotas on execution (not
hiring), provider availability, runtime compatibility and source-thread availability.

The Chief also needs incoming work enabled to receive asynchronous specialist replies.
Checking only Pixel/Path would leave another half-working team. The plan covers the
lead's return path explicitly. A worker completing while its parent is busy produces a
queued return, not a lost response or automatic owner authority.

Distinguish configured, queued, held, running, acknowledged and completed. Configuration
can succeed while execution is waiting for a slot. A claimed run is not acknowledgment;
an exited provider is not project completion. Require recipient acceptance/reply and
task/project evidence. Show a runtime blocker and its responsible component rather than
asking for another grant when the issue is a stopped scheduler or unavailable provider.

This is computed from existing records. Do not persist `teamReady:true`, cached permissions,
another copy of task status or a background poller dedicated to team setup. Poll normal
receipts through the existing UI data mechanism; update the same inline setup card.

## 8. Complete flows

### Font Maker: recover Chief, Pixel and Path

1. Resolve the exact active IDs and the two existing message IDs from the handoff. Inspect
   runtime, memberships, current manager edges, document revisions and original receipts.
2. In the owner turn, prepare Chief → Pixel/Path and selected management/document access.
   Include a later activation phase for Chief and both leads. Preserve original task
   restrictions and keep existing held audits held until the required imports finish.
3. Show the full configuration diff and affected queue in one inline result. Apply under
   the existing clear owner instruction, recording its input ID and exact effects. Do
   not send the same owner another bootstrap request.
4. Chief reads and reconciles authorized handoff documents with existing document tools.
   Edits require current revisions; completing setup alone does not count as import. Then
   apply the already authorized incoming-work phase and inspect the whole return path.
5. Observe the original two runs. Their task restrictions already permit bounded audits;
   no duplicate sends, dummy training task, paid GPU run or unrequested schedule is needed.
6. Record acknowledgment, deliverable evidence and return to Chief. Any later write rejected
   by an immutable old run policy reports that policy blocker; granting a capability does
   not silently broaden a previously admitted run. Finish/stop it and explicitly dispatch
   a newly authorized task when that genuinely is the intended new work.

The known IDs are in the dated source handoff, not hardcoded product configuration. This
document does not establish that those operations have happened on the live team.

### wave_sim: create or adopt the business team

Resolve existing matches first; create only missing identities using stable creation keys.
Apply the eight-person tree in one owner composition:

```text
Project Lead
├── Go to Market Lead
│   └── Market Researcher
├── Product Lead
│   ├── Product Engineer
│   └── Product Designer
├── Wave Simulation Lead
└── Frontier Research Lead
```

Product consults the one Market Researcher. Leads coordinate their reports; no second
research identity or second manager. Include return-path incoming work throughout the tree.
The owner-requested working team can receive work; merely creating it invents no task run.

Create projects/todos with criteria for wave pool, surfboard, boat hull, hydrofoil and
coastal engineering use cases. Preserve "coastal is the biggest market" as the owner's
hypothesis for research. Product Designer tests usability and challenges scope. Frontier
Research hands evidence-backed theoretical results to Wave Simulation through a new
recipient-owned project and existing send. GTM and Market Research prepare use cases and
interview lists; outreach remains blocked on demo evidence and a configured inbox.

Starting work is the existing `new_project`/`update_project` → keyed
`send(execution:{mode:"until_done"})` composition. Reports break down work and reply with
evidence. `get_message` and project criteria determine completion. Setup replay recovers
saved IDs and configuration; project/send keys recover the later steps independently.

### Basketball: discovery, four existing leads, one import

Search the permitted directory for the appropriate contact/route. Contact discovery grants
no access to another workspace. An owner-scoped setup can adopt four exact identities and
create the missing specialist in one batch, while private imports remain explicit later
document operations. Existing held assignments keep their original IDs. Post-setup
inspection answers what can be managed and what is actually executing in one view.

### Chief wakeups and continuing management

Ordinary replies already wake the lead through the original message return route. A
recurring schedule is optional, uses `set_automation`, and needs separately requested
schedule authority. Background tasks keep completion criteria on projects/todos, bounded
run policies and separate worker transcripts. A lead can end its turn while reports work.

Standing profile/document/relationship grants enable later authorized maintenance without
another owner setup. Exact-target grants do not automatically include newly discovered
employees. For explicitly authorized autonomous staff creation, the existing `staff.create`
grant continues to admit routine configuration of the newly created identity. Extend that
same creation receipt to cover the explicitly requested initial incoming setting and its
creator's `execution.manage`; otherwise a fresh hire repeats the current trap. This is a
named consequence of granting working-team staffing, visible in the owner plan, not an
implicit privilege acquired by adding a manager edge. No schedule or onward staffing grant
is created. Existing staff creation grants retain their old effects until explicitly
upgraded; a new optional grant constraint `createdBuddyIncoming` records this choice.
Store it on the existing workspace `staff.create` grant, default false on migration;
reject it on target-specific grants and without `staff.create`. Include it in revision,
preview, audit and capability output. When true, `create_buddy` may explicitly request
initial incoming work and gains execution management on that new identity only. Old
grant-edit clients preserve this constraint unless they explicitly change it; revoking
staff creation also clears it. Initial activation still creates no message or run.

## 9. Lifecycle and privacy cases we must not miss

| Case | Defined behavior |
| --- | --- |
| Same owner setup retried after response loss | Return original receipt and current readiness; no new identities/grants/runs |
| New key with same desired state | No-op resource writes; preserve revisions where unchanged; no new task dispatch |
| Replay after access revoked or member reparented | Return historical receipt, flag current drift; do not restore permissions |
| Grant expires while preview is open | Apply rechecks; return a precise stale/expired blocker, no partial configuration |
| One invalid member in a batch | No configuration committed; report all safe-to-disclose blockers |
| Interrupted setup while files are staged | Recover via existing creation receipt/projection cleanup; no half-published roster |
| New work queues between preview and apply | Reprepare the affected queue inventory; never claim only two tasks were released if more were |
| Return path disabled, parent busy or source thread gone | Inspect before launch; distinguish held return, queued return and missing destination; preserve result |
| Reporting change would affect other workspaces | Explain exact memberships/scope changes; no implicit cross-workspace admission |
| Owner types into a worker thread | Host records the new input's origin; do not relabel the existing worker claim as an owner claim |
| Child reply resumes an old owner thread | Fresh restricted turn; owner capability cannot be inherited from history or environment |
| Stop while applying configuration | Check capability/cancellation immediately before the synchronous commit; after commit report applied, then stop execution separately |
| Employee gains grants but old run lacks the tool | Live grants intersect immutable run policy; never rewrite that policy to make a tool succeed |
| Former manager still has document access | Explicitly display/revoke exact grants; relationship removal alone does not promise revocation |
| Read private handoff for one specialist | Requested document only; no workspace directory crawl or unrelated memory in preview |
| Worker has already seen confidential data | Revocation prevents future access, not erasure of provider history; privacy isolation remains separate work |
| App/package/tool schemas mismatch | Read-only diagnostics stay available; configuration/worker start reports runtime incompatibility |

Owner-private context isolation and the external email boundary are still required for
the broader business-team vision. Team setup cannot honestly solve them with permission
labels. Dense memory currently belongs to the whole Buddy; an owner conversation must
not be reused as a worker's private-context isolation boundary. Use separate worker
transcripts as implemented, then finish audience-aware context assembly before claiming
owner-confidential information cannot reach restricted runs. Returning a result to an
owner thread must not give a restricted follow-up unrestricted history by accident.

Email needs the actual mailbox, a send-time demo prerequisite check, authorized external
action scope and durable effect receipts/ambiguous-send recovery. Training and paid compute
likewise keep their own action boundaries. Plain soul instructions and team configuration
cannot enforce those guarantees against general same-user shell access. The deployment
remains trusted-local; stronger OS isolation is not delivered by this design.

## 10. Implementation and acceptance gate

Implement in dependency order as one user-facing feature, not several independent repairs:

1. **Authority and contract:** persist trusted turn origin; add short-lived owner control
   exposure and denial tests for message/schedule/reviewer/imported/continued turns.
2. **Store composition:** typed configuration preparation, shared predicates, atomic writes,
   command receipts, exact grant expansion, queue inventory and reorganization checks.
3. **Entry points:** the owner MCP and HTTP call that service. Builder/new and existing
   staff share it. Employee proposals produce the same typed owner attachment.
4. **Usable surface:** replace the primary checkbox setup with an inline team configuration
   card and readiness/results. Keep individual controls as advanced overrides. Use the
   existing WS event spine and abortable data loads on both desktop and mobile.
5. **Complete the loops:** permitted contact search, focused document previews, real MCP
   automation schemas, turn-policy explanations and both outbound/return readiness.
6. **Package and activation:** update the coordinated package/app contract, generated types
   and archive provenance together; preserve foreground deadline regression tests. Publish
   a return handoff containing the loaded contract and actual team evidence.

Source ownership for implementation:

| Layer | Change location |
| --- | --- |
| Canonical store/transaction | Buddies package `src/team-access.js`, existing coordination command/creation receipts, declarations and migration for the optional staffing constraint |
| Shared contract | `shared/src/buddy-access.ts` plus a focused team-configuration schema; one definition consumed by API/MCP/UI |
| Trusted input and owner transport | Owner input producers and `server/src/conversations/runtime.ts`; `server/src/buddies/control-server.ts` and MCP launch/registration |
| Team preparation and predicates | `server/src/buddies/team-access.ts` adapter over package predicates; remove duplicated heuristic prerequisite logic |
| Owner API/Builder | `server/src/buddies/routes.ts`, `builder.ts`, `builder-mcp-server.ts`; one configuration service |
| Employee diagnostics/contracts | `operations.ts`, `mcp-server.ts`; existing directory/document/automation schemas |
| UI composition | Shared `client/src/components/buddies/` setup card, current Team access advanced controls, owner message attachment renderer; desktop/mobile use the same component |
| Acceptance | Extend `server/test/buddy-team-recovery.test.ts` through trusted owner input/control and actual MCP; add crash/policy/return-path coverage to existing runtime tests |

Required tests begin with an empty grant set and disabled incoming work. Only the initial
authenticated owner input may be preconfigured. Test bodies must not manually seed grants,
manager edges or execution settings to get past the setup under test.

| Boundary scenario | Required evidence |
| --- | --- |
| Owner chat → Font Maker setup → actual MCP lead actions | Both existing specialists manageable; original message/run IDs preserved; no per-target owner repair calls |
| Delegated turn calls owner setup or replays an owner token | Rejected before any grant/configuration mutation |
| Buddy reply arrives in former owner thread | Ordinary restricted MCP only; no retained owner credential |
| Mixed new/existing wave_sim setup twice, then process restart | Eight identities, seven manager edges, one consults edge; same IDs; no automatic work launch |
| Private documents omitted, then explicitly authorized | Denied initially; granted reads and revision-checked diffs succeed only for exact targets |
| Profile/relationship prerequisites | Preparation and real calls agree; no unnecessary self-grant or profile-write request |
| All blockers present simultaneously | One response shows config, policy and runtime blockers for recipients and returning lead |
| Required handoff import fails or conflicts | Existing queued audits remain held; retry continues import before activation |
| New autonomous hire under an old versus upgraded staffing grant | Old grant never enables incoming work implicitly; upgraded grant configures only the new identity and gives no onward staffing/schedule authority |
| Crash before/after configuration commit, and lost response | All-or-none database state; exact replay receipt; queue recovers without duplicate dispatch |
| Stale plan, invalid/cyclic graph, foreign membership and archived duplicate | No partial mutation; exact safe blockers; original identities preserved |
| Reparent/revoke and replay old setup | Old permissions are not resurrected; remaining access is visible |
| Discovery and document preview through real MCP transport | Stable bounded results; no inaccessible contact or unrelated document leakage |
| Automation discovery through real MCP listTools and calls | Accurate fields and rejection of invalid action combinations |
| Lead → specialist → continuation → evidence → lead follow-up | Actual acknowledgment, task criteria/evidence and restricted return-run receipt |
| Setup and coordination only | No new schedule, external send, training or paid infrastructure action |

Deterministic provider fixtures establish mechanical behavior. A separate live natural-
language trial must then perform setup, dispatch, acknowledgment, evidence-backed completion
and follow-up without developer database seeding or manual settings repair. Use bounded
repository-local audit work, not a dummy paid run. Keep live IDs and failures in native
work records. Do not call the feature operational merely because the settings were saved.

## 11. Decision history and alternatives

What changed: real owner-to-lead trials repeatedly stop before the first worker starts,
despite passing component/recovery tests. The earlier design assumed separate owner
controls were a sufficient product workflow. They were not.

What stays: ordinary identities, exact-target grants, revision-checked documents, task
criteria, durable messages/runs, owner/employee separation and distinct external-action
authority. These were motivated by durable identity, predictable revocation and preventing
delegated text from authorizing access to other employees' private data. That rationale
still holds.

Alternatives rejected in this revision:

- **Remove grant checks:** makes a manager title sufficient to read private memory or
  admit execution, and does not solve missing memberships or runtime failures.
- **More employee grant tools:** lets the blocked principal expand its own authority.
- **Infer grants from arbitrary chat text in the server:** confuses quoted feedback,
  assistant recommendations and authenticated owner direction.
- **More manual setup instructions:** preserves the failure experienced by Font Maker.
- **A generic workflow/Team/Assignment engine:** duplicates existing state and creates a
  second place to recover configuration and work.
- **An endlessly reconciled desired-team document:** can recreate revoked permissions or
  retired employees. One-shot receipt replay is safer and simpler.

Tradeoff: a scoped owner-control surface is a real addition. It is justified because the
missing authority transition cannot be supplied by another employee prompt. Configuration
is atomic; document/work/model effects remain explicit independent steps. Exact-target
grants require updating a roster when staff change, but the owner composition does that
without exposing raw permission assembly to the user.

Revisit if named teams need an independent lifetime, people require different managers per
workspace, delegation must cross independently administered owners, or real workloads
require selective admission of pending requests. Do not pre-build those new authorities
into this recovery feature.

### Historical source anchors

The following are September 10, 2026 snapshots. Repository HEAD at review was
`1187a8b6660b95c0c60bd8fada105f015b98cc39`; the files are working-tree material, so
that commit alone does not identify their contents. Hashes below refer to pre-successor
contents. Relevant excerpts are preserved here to explain the changed decision.

| Source | SHA-256 |
| --- | --- |
| `product/buddies/DESIGN_TEAM_OPERATIONS.md` | `3e1e8a0a7b3f0343ab9173884d52d6b7940d827dabb2c5248b302b3e39dd2de3` |
| `product/buddies/DESIGN_BUILDER_TEAM_SETUP.md` | `9294a9c0530f0c033140256a09b5272b75ba1fb8d084d00e482a56dc375e9177` |
| `server/test/buddy-team-recovery.test.ts` | `56844bcce2463e41f05c6a06021a2e374b5babf9d524fce908fb82fb6abda00b` |
| `client/src/components/buddies/BuddyTeamAccess.tsx` | `2e1f05a1dbc76c1244fb45b8ce793d4f31289d8e1128541e82af39b0b7178bf5` |
| Font Maker `CHIEF_SCIENTIST/2026-09-10_research_team_setup_and_review.md` | `f04d1558ad4b97fd80d43cbe191a873597ee8cd631d388919324071ee4eb5f2d` |

Earlier design excerpt:

> Owner HTTP/UI can issue/revoke bounded grants and appoint existing staff. Builder retains
> its setup scope over identities it created; existing-team management uses a lead's granted
> MCP context.

That last step presupposed the very grants missing in the owner conversation.

Recovery-test excerpt, the manual setup before the assertion:

```ts
await request(`/api/buddies/${target.id}/reparent`, 'POST', attach);
await request(`/api/buddies/${chief.id}/access/${workspace.id}`, 'PUT', grant);
await request(`/api/buddies/${target.id}/memberships/${workspace.id}`, 'PATCH', {
  background_enabled: true,
});
```

Font Maker excerpt:

> A direct native `set_relationship` call for Chief → existing Pixel lead returned
> `owner_grant_required`: `No owner grant for relationship.write on this target.`

Package authority evidence: `src/team-access.js` at package commit
`4b7fb017dc1e278c853f9ab3922a7ff50c703b2a`, especially `setTeamRelationship` and
`updateTeamProfile`. Those checks support the two prerequisite corrections in section 1.

This successor preserves earlier implementation evidence while replacing the incomplete
onboarding recommendation. The implementation work record must remain open until the
owner-input acceptance path above actually passes.

## 12. Implementation decisions and exact recovery behavior

The owner accepted implementation with “implement it fully” after revision 1. The
following details resolve integration findings without adding new domain objects:

- `unleashd_owner.configure_team` uses an active, host-issued owner-input capability.
  Owner input IDs and content hashes are recorded through the existing audit log.
  Owner commands, queued owner commands, employee messages, schedules and unknown
  restored inputs have explicit source handling. Unknown inputs receive no owner tools.
  Credentials are not persisted; a restart revokes them. In-memory queued owner source
  is preserved through a recoverable preflight failure; a restored legacy queue requires
  a fresh owner input instead of reconstructing authority from transcript text.
- Settings uses the same preparation/application service with an owner input ID and a
  null conversation ID. Proposals are strict typed attachments in ordinary owner-directed
  messages, exposed as `team_configuration` in the UI. The attachment grants nothing.
  Apply reads the saved proposal; a successful configuration receipt precedes the ordinary
  reply. A retry repairs a lost acknowledgement without reapplying configuration. A
  declined or cancelled proposal cannot be applied.
- Existing Builder tools are routed through the active owner capability too. The private
  Builder endpoint requires host-identified Builder mode and the owner's registered
  workspace scope. It checks revocation again after asynchronous reads before executing
  synchronously. A stale Builder process cannot keep creating or editing staff. A Builder
  can register a workspace during the current owner input; the host refreshes the owner's
  registered workspace scope without accepting any scope from model arguments.
- Builder creates missing identities with incoming disabled, so its existing identity/soul
  tools can finish their initial documents. `configure_team` then adopts those exact IDs
  for roster/access, followed by ordinary initial projects and explicit activation. For
  already-existing staff, configuration reuses IDs and the receipt offers **Talk** with the
  lead; that lead's owner conversation performs authorized private imports and project
  maintenance. Builder does not acquire unrelated private-document access merely by
  discovering an identity. Such imports keep the setup incomplete until verified.
- Optional `expiresAt: null | ISO timestamp` on access and staffing makes renewal explicit.
  Omitted expiry preserves it. Changing permissions alone never silently renews an expired
  grant. Reparenting does not erase separately granted private access, including grants in
  another workspace; revoke those explicitly in that workspace when requested.
- Configuration receipts retain the requested state even when it required no initial
  writes. Polling can therefore report later drift after a no-op setup. Replay returns
  current readiness and never restores revoked grants or altered incoming settings.
- The committed database is authoritative for new profiles. If filesystem projection
  fails afterward, the receipt survives and reports repair required. Replaying the same
  key repairs the projection; it does not create another identity.

The implementation adds no Team, Assignment, Goal, background-job or approval queue.
Work remains projects/todos plus messages/runs. Time-based work remains automations.
Successful provider exit is not proof of task completion; authoritative criteria and
evidence still determine the bounded execution disposition.

## 13. September 12 successor: one team settings flow

The owner approved the recommendation to keep one saved permission model and its server
checks, consolidate permission editing into team settings, and retire the separate raw
editor/API after equivalent editing and revocation were available. This follows the
September 12 duplicate-control cleanup; it does not change managers' automatic authority.

Team settings now offers roster/responsibility changes and individual permissions within
one form and the existing configuration preview/apply/receipt flow. The separate
`BuddyTeamAccess` editor and `PUT /api/buddies/:buddyId/access/:workspaceId` are removed.
The diagnostic GET remains to populate the same settings. Internal persistence helpers
and operation-specific permission enforcement remain the sole saved authority model.

Contract `2026-09-12.1` adds `write_only` to profile/soul/memory selections and optional
`baseRevision` to access and staffing entries. `write` still means read plus write;
`write_only` preserves independent edit permission when read permission is revoked.
An explicit `profile: 'none'` or `'write_only'` with `incoming: true` is now represented
faithfully; the actual execution-setting operation still requires profile read access.
When profile is omitted, the existing incoming-work convenience still includes it.
These rules supersede the combined-read requirement in the September 10 section 4 sketch.

The settings form sends the revision it displayed. A stale permission form is rejected
before preparation can overwrite a newer edit; returning to editing reloads current
settings. The plan hash still detects changes after preview. Permission edits retain the
exact saved expiry unless changed explicitly, support clearing expiry, and retain the
new-hire incoming setting while hiring remains permitted. Full revocation clears both
permissions and their dependent settings. Expired grants require explicit renewal or full
revocation before other edits can apply.

Saved grants remain discoverable after a target is archived or leaves the workspace.
Those targets are excluded from roster setup and can only have their saved grant fully
revoked through this flow. Revocation does not reactivate, readmit, or launch them.

Alternatives: deleting the grant store would change private access policy; retaining the
raw editor would preserve duplicate mutation behavior; keeping only none/read/write would
silently widen a write-only grant. This consolidation instead extends the existing typed
composition only where exact editing required it. Revisit the independent permission
representation only after an explicit owner decision about the resulting access policy.

Historical anchors: predecessor note
`2026-09-12T14:01:14.287Z:8c21ffe3-a8da-4c9b-aba7-014386393039`; this document before the
successor had SHA256 `268207019f847e0d0df38f9d8bb8d0feae32675227fe6f12c76a157233f59271`.
Its prior rule was “Keep individual controls as advanced overrides.” The replaced editor
had SHA256 `8abf6d5d4c1a5cdd14ecc4a861c3da1603d6ec973b76fad431b2c549abcf9bd9` and
submitted a separate PUT with `capabilities`, `baseRevision`, `key`, and `reason`.
Those excerpts preserve why the successor removes another mutation path without removing
the underlying checks. Verification and delivery evidence belong to the dated implementation
record and the native project; this design statement does not claim live adoption.
