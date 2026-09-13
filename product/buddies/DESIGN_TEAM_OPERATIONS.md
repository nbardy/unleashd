# Buddy team operations

Current contract entry point · updated 2026-09-13

Start with the [team operator guide](TEAM_OPERATOR_GUIDE.md) for native setup,
assignment and result verification. `unleashd_owner.configure_team` is implemented;
Builder, owner chat and Team settings use the same preview/apply composition.
Production team status belongs in native projects and original message receipts.

| Capability | Implementation |
|---|---|
| Owner setup, exact effects and plan-hash apply | `owner-team-configuration.ts`, `owner-mcp.ts`; package team configuration service |
| Grants, relationships and target permissions | `team-access.ts`; package team-access store |
| Team and original-message readiness | `team-readiness.ts` |
| Native resources and compact capability projection | `resources.ts`, `mcp-server.ts`; shared resource schemas |
| Work and delivery | [Coordination contract](PLANNING_PRIMITIVES.md) |
| Document audiences and revisioned edits | [Memory contract](PLANNING_MEMORY.md) |
| Run authority, cancellation and maintenance | [Automation ownership](AUTOMATION_OWNERSHIP.md) |

## Authority and setup

A Buddy is an ordinary persistent identity. Keep workspace memberships, reporting
relationships, exact-target access grants, projects/todos, documents/notes,
messages, conversations, runs and schedules as the authoritative records. There
is no hiring quota, special Lead type or separate assignment entity.

A reporting line authorizes work supervision. Owner grants separately authorize
staffing, relationship changes, profile access, private soul/memory access,
incoming-work management and schedules. Attaching an existing ID preserves its
identity, documents and projects. The manager must belong to every report workspace;
configuration must explicitly resolve additional membership before appointment.

Owner setup previews exact identities, changes, prerequisites and the existing
queue. Apply uses the same stable key/configuration and returned plan hash. A
configuration receipt is evidence of saved settings, not worker execution. Replay
does not restore revoked grants or reactivate archived staff. Enabling incoming
work can release already held requests. Required imports and queue review precede
activation; schedule activation remains separate.

Employee tools do not issue grants or accept a caller-supplied owner identity.
Current grants intersect each run's immutable operation policy. Membership or a
project reference does not publish private messages or grant document access.
Owner control is host-issued for the current owner input; historical messages,
quoted instructions and document text cannot confer it.

## Current native entry points

- Inspect: `get_inbox`, `get_current_work`, `list_buddies`, `get_capabilities` with
  an intent and original message IDs. A missing owner adapter differs from a
  denied employee operation; check the returned contract and owner-control status.
- Configure: owner `configure_team`; granted employee `create_buddy`,
  `set_relationship`, `get_profile` and revision-checked `update_profile`.
- Read/edit documents: `get_document` → preview/apply `update_document`, with
  the returned ref, opaque revision, stable key, complete content and reason.
  `recall` accepts one literal substring. See the memory guide for compatibility
  capability labels and the separate private reviewer API.
- Assign: stable-key `new_project` owned by the recipient, then `send` with
  `delivery: {kind: "work", projectId, maxRuns, maxDurationSeconds}`. One-response
  requests and information use the other typed delivery variants.
- Verify: `get_message`, `get_runs` and `get_team_state`; record project/todo
  acceptance and evidence with revision-checked `update_project`. Human-chat
  returns settle in the Mailbox without automatic model execution. Background
  parent work resumes through the existing runtime within its original limits.

Use the native schemas for exact fields and the operator guide for runnable
argument examples. The retired raw access PUT is not an onboarding path; its
GET remains diagnostic. Team settings uses canonical configuration preview/apply.
Application scoping is trusted-local control, not isolation from same-user shell
access or erasure of information previously delivered to a provider.

## History and evidence

The full September 10 `.2` text, including its obsolete public API listing and
September 12 banner, is preserved in the [pre-repair snapshot](../../agent_notes/2026-09-13_team-operations-before-operator-guide.md)
with its content hash. Its claims that setup and scoped knowledge were unfinished
are historical. Their successors are the [owner setup design](DESIGN_OWNER_TEAM_SETUP.md),
[resource repairs](IMPLEMENTATION_RESOURCE_REPAIR_2026-09-12.md) and
[Team settings implementation](IMPLEMENTATION_TEAM_SETTINGS_2026-09-12.md).

Implementation and fixture passes do not establish production onboarding, actual
artifact review or an external mailbox account. Local Buddy messaging requires
no external email account. External mailbox integration and effects require their
own configured adapter and operational evidence.
