# Owner team setup implementation and return handoff

September 10, 2026. Implements the owner-approved direction in
[the owner setup design](../product/buddies/DESIGN_OWNER_TEAM_SETUP.md).

## What changed

A lead's owner conversation now gets `unleashd_owner.configure_team`. It converts one
bounded roster/access request into a reviewable plan and an atomic configuration receipt.
The lead keeps ordinary employee tools for documents, projects, messages and execution.
It no longer needs to ask the owner to manually save each missing permission.

This adds one domain operation and reuses identities, memberships, relationships, grants,
command receipts, messages and runs. No Team, Assignment, Goal or onboarding queue was added.

- `configure_team({key, configuration, preview:true})` returns exact effects, a plan hash,
  all discovered blockers, existing queued inputs and resolved identities.
- Apply the same key/configuration with `preview:false, expectedPlanHash` from the preview.
  A changed plan fails before writes; refresh the preview. Reuse the same key after a lost
  response. Replays preserve later revocations/settings and report current drift/readiness.
- Settings and typed owner-inbox proposals use this same service. Their receipt cards keep
  polling original runs, acknowledgements, accepted projects and completion evidence.
- `list_buddies({scope:"permitted",query,limit,cursor})` searches contact metadata across
  the caller's permitted workspaces. Discovery never grants dispatch or private access.
- `get_capabilities` supports multiple target/message IDs and an intent, reports runtime,
  operation and return-path prerequisites together, and identifies the owner control path.
- Memory/soul previews return the requested revision and a focused diff. Automation tools
  advertise their actual create/update/enable/disable arguments through real MCP schemas.

Exact schema: [shared configuration types](../shared/src/buddy-team-configuration.ts).
Owner input provenance is host-supplied and recorded through the audit log. Owner controls
are revoked when the turn stops, drains or is replaced. A specialist reply that resumes an
old owner thread receives employee tools only. Legacy Builder tools also execute through
that revocable owner control; retaining an old MCP process does not retain its authority.

## What Chief should do

Start with a fresh owner message in Chief's conversation after the matching server/MCP
contract is active. A suitable instruction is:

> Attach the existing Pixel and Path leads to Chief, reconcile the handoffs and private
> documents I authorized, and resume the original bounded audits. Use the owner setup
> tool to save the required scoped access. Keep incoming work held until imports finish,
> then enable both workers and Chief's reply path. Reuse existing identities, projects and
> message IDs. Verify acknowledgements and completion evidence. No training, paid compute,
> schedules or external actions are authorized by this setup.

The sequence is:

1. Inspect current capabilities, identities and original messages.
2. Preview/apply roster and explicitly authorized document/execution grants. Preserve held
   incoming settings during import. No self relationship grant is needed for actor-as-manager;
   no profile.write grant is needed for an execution-only change.
3. Read each current document/revision; preview and apply the authorized import through
   existing document tools. Record completion evidence on work.
4. Use a second stable configuration key to enable incoming work for workers and Chief.
   Its preview lists the queued messages/runs that this will admit.
5. Inspect the original messages/runs. Do not resend them. For newly assigned ongoing work,
   use project criteria/todos and `send({execution:{mode:"until_done"}, ...})` with a stable
   key and recipient-owned project. Run completion and task completion are distinct.

Historical Font Maker references, to recheck rather than recreate:

| Item | ID |
| --- | --- |
| Workspace | `project_2f0a65f3-42a0-4527-92bf-686c29ed037a` |
| Chief | `buddy_b2ff0a7e-591c-4e76-9cc1-0cda8d171ec3` |
| Pixel | `buddy_f4940aaa-059d-4105-aa0c-0eb1fd4de3b5` |
| Path | `buddy_ef2ab261-bb31-4ed0-a3d9-4d5d9bd28bd2` |
| Pixel original message | `message_367bfbfb-e28e-426c-9206-a39b99fdb887` |
| Path original message | `message_3157688f-d3f0-4f96-b8d0-02f52d50c73c` |

## Builder and wave_sim

For a new team, Builder creates only missing identities with incoming work held, completes
initial souls, then configures the recovered exact IDs, grants and reporting graph through
`configure_team`. It saves ordinary initial projects and activates only after prerequisites
are complete. The new configuration operation also accepts stable creation references for
atomic creation when Builder-specific initial project tools are not needed.

Existing identities are adopted, not recreated. Builder's private-document tools remain
limited to its own created identities. For adopted staff, the receipt's Talk action opens
the lead's owner conversation for granted imports and project maintenance. Keep incoming
held until that step is done; a roster receipt does not claim private imports happened.

The wave_sim eight-person hierarchy, five target markets and demo-before-outreach direction
remain unchanged. This feature does not implement the external email/inbox adapter or
confidential provider-context isolation; those remain separate authoritative work.

## API and recovery

- `POST /api/buddies/team-configuration`: same preview/apply input as owner MCP.
- `GET /api/buddies/team-configuration?workspaceId=...&key=...`: saved receipt plus current
  drift/readiness; it never reapplies configuration.
- `POST /api/buddies/messages/:messageId/team-configuration`: `{preview,expectedPlanHash?}`;
  reads the saved typed proposal. Apply settles it with the existing owner-reply mechanism.
  Repeating repairs a lost acknowledgement. Declined/cancelled requests cannot apply.
- Employee `send` can attach `teamConfiguration:{key,configuration}` to an ordinary
  owner-directed message. Its encoded total is limited to 32 KiB. A proposal is data only.
- Optional `expiresAt:null|ISO` renews a grant explicitly. Omission preserves expiry.
- Reparenting preserves separately granted access, including grants from other workspaces.
  Revocation must be explicit and scoped to the relevant workspace.

Newly created profile projection failures retain the committed configuration receipt and
report a repair blocker. Replaying the same key repairs projections without creating staff.
Old unknown/restored queued inputs never gain owner authority from transcript role or text;
a fresh owner input supplies new authority. Existing task and worker policy snapshots remain.

## Implementation evidence

Package commit: `55c7681f1e4b19664c116308f2329445e4df70e2`, contract `2026-09-10.4`,
schema `25`. Vendored archive SHA256:
`7530924391d9e06c41bbd5fb8b91375b42cf12ce129fc0364ee9dca471ecda2f`.

- Package: 85 tests pass, including unconfigured team setup, whole-graph validation,
  atomic failure, preserved queued input IDs, stale plans, no-op drift, revoked/expired
  grants, explicit future-hire incoming mandates and projection crash recovery.
- Runtime fixture uses actual owner MCP transport/control and the real store. It starts
  without staff configuration, imports memory with a revision, releases the original
  task, completes two bounded worker turns and returns one reply to the original lead
  thread without owner tools. A deterministic provider fixture drives this regression.
- Real MCP tests cover discovery, schemas, scoped previews, all prerequisites and typed
  proposals. HTTP/control tests cover missing/foreign/revoked authority, Settings,
  cancellation across awaits and post-commit acknowledgement recovery.
- Final full server suite: **292 passed, 0 failed, 3 opt-in tests skipped** (295 total).
- Final full client suite: **74 passed, 0 failed**. Shared/server builds, server typecheck,
  client `tsc -b`, client production build and all six client invariant gates passed.
- Bounded live Codex provider check: **passed** in 278 seconds, using an isolated temporary
  SQLite store and actual stdio MCP servers. Two owner turns configured and activated the
  team; one specialist turn recorded task/project evidence; one reply turn resumed the
  original lead thread. No duplicate dispatch or owner authority on the return turn.
  Test: `server/test/buddy-owner-live.test.ts`, opt-in `UNLEASHD_LIVE_OWNER_TEAM=1`.
  Evidence message `message_91bf9382-90bf-4655-a89c-8ec6c103fd5f`, project
  `buddy_project_c550f5a6-fd07-4312-a03e-b83fc45f0876`; saved evidence was direct arithmetic
  verification of 2 + 2 = 4. These IDs belong to the deleted isolated fixture, not production.
  Provider sessions: owner `01a08ba0-c691-7d13-a27f-c564f714011d`, specialist
  `01a08ba3-9162-7e92-a9d3-1488053fc669`. Raw test output: `/tmp/buddy-owner-live.log`.

No production Font Maker or wave_sim configuration was changed during implementation.
This handoff has not been sent to other employees. Final native inspection in this active
conversation still reports `.3`; the newly built and live-tested source is `.4`. The dev
watcher uses cooperative idle reload and cannot replace the backend while this turn owns
an active provider. After reload/reconnection, a fresh owner input should expose
`unleashd_owner.configure_team`, and native capabilities must report matching `.4`. Do not
claim Pixel/Path activation until their existing receipts are checked in that owner scope.

## Decision history

Revision 1 design was preserved by SHA256
`b693e4a691ffea3cc156fe378b6654b8db4a29ad9b13762c1fa28ff0edd02b41` and its prior
[design handoff](2026-09-10_owner-team-setup-design-handoff.md). The owner then requested
full implementation. The chosen composition fixes the bootstrap journey that pre-granted
fixtures had skipped, while preserving explicit private/external authority boundaries.
The implementation decision is not a grant for any live employee or task.
