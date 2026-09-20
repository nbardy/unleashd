# Buddy permission settings consolidation — September 12, 2026

The owner approved the preceding recommendation to keep one saved permission model,
move permission editing into team settings, and remove the separate raw editor/API
after equivalent editing and revocation were available. The prior recommendation is
preserved in run `buddy_run_f80e3aac-eef2-477b-bd7b-899103d24f85` and note
`2026-09-12T14:01:14.287Z:8c21ffe3-a8da-4c9b-aba7-014386393039`. The current owner
acceptance was “Okay sounds good, do it” in conversation
`7d9d117f-7a13-46e2-bf6a-95da591d6e2b`.

## Resulting behavior

- **Team settings** contains roster/responsibility setup and permission editing. Both
  use the existing canonical preview, apply and durable receipt. The separate
  `BuddyTeamAccess.tsx` and its direct PUT request are removed.
- `POST /api/buddies/team-configuration` is the owner mutation path. The obsolete
  `PUT /api/buddies/:buddyId/access/:workspaceId` and its request schema are removed.
  The diagnostic GET populates settings, including saved grants for former members.
- All existing permission bits remain independent. `write_only` preserves editing
  permission when the owner removes reading permission. The actual operation checks
  continue to require their existing prerequisites.
- Permission forms include the revision they displayed. Preview rejects stale forms;
  apply still checks the prepared plan hash. Editing again refreshes the read model.
- Expiry is preserved exactly unless edited, can be cleared explicitly, and never
  renews silently. Hiring permission retains the new-hire incoming setting while
  enabled; revocation clears dependent settings.
- Former members appear for full revocation only. They cannot be selected for roster
  setup through those saved grants, and revocation does not reactivate them.

The database representation and server authority checks remain in place. This removes
a duplicate mutation flow; it does not replace permissions with automatic manager
authority. Contract `2026-09-12.1` coordinates the shared schema and packaged behavior,
with no database schema migration.

## Decision and tradeoff

Accepted owner choice: consolidate the surrounding settings machinery while retaining
the permission model. Implementation details chosen by the assistant: a fourth access
selector value for existing write-only states, optional grant revision checks, and a
narrow full-revocation exception for existing grants whose participants left the team.

Keeping only none/read/write would widen saved write-only access. Removing the store
would change private-data authority. Keeping the old editor would retain a separate
save/retry path. The chosen implementation extends the existing composition where
needed and removes the old writer. Additional UI fields expose expiry and hiring
options already supported by the saved model; fewer mutation paths does not mean
fewer total lines of code.

Independent review identified and corrected inactive targets in roster selection,
dependent hiring flags when hiring is revoked, and browser normalization of local
expiry timestamps. Browser validation uses isolated fixture data and HTTP responses;
server integration tests exercise the real registered routes and packaged store.

## Historical sources

- Prior editor SHA256:
  `8abf6d5d4c1a5cdd14ecc4a861c3da1603d6ec973b76fad431b2c549abcf9bd9`.
  Preserved behavior: a separate PUT submitted `capabilities`, `baseRevision`, `key`
  and `reason` from the “Individual permissions” form.
- Prior owner setup design SHA256:
  `268207019f847e0d0df38f9d8bb8d0feae32675227fe6f12c76a157233f59271`.
  Preserved rule: “Keep individual controls as advanced overrides.” Its section 13
  now records this dated successor without erasing the earlier rationale.
- Prior package source: `234ff0f681d3f8ede511f048f74d632f23a3f49d`.
  Existing exact-target grants and operation checks continue to determine employee
  authority. Later delivery and file hashes are recorded with the validation evidence.
- Prior team operations design SHA256:
  `ee9bab69ff85a8b060d03d7aa003714da0cd6e466c3fe0f963471ab0901e0bf5`.
  Its old raw PUT documentation remains labeled historical beneath a current successor
  pointer, rather than being presented as the active API.

## Validation and delivery

Passed 129 automated tests: 93 package tests; 7 server HTTP/MCP tests across
`buddy-team-permissions`, `buddy-team-recovery`, `buddy-team-access`, and
`buddy-owner-authority`; 25 runtime tests across `conversation-runtime`,
`buddy-owner-runtime`, and `buddy-background-runtime`; and 4 client team configuration
render tests. Runtime coverage includes the explicit foreground deadline budget,
`max_runtime_timeout` classification, joined provider drain, and restricted worker return.
Shared ESM/CJS builds, server typecheck/compile, client `tsc -b`, all six client invariant
gates, and focused Biome checks passed.

Isolated Playwright verification exercised target switching, write-only preservation,
expiry precision, staffing options, full revocation, stale/blocked preview behavior,
and apply receipt gating. Desktop and 390/320 px layouts were inspected; narrow form
overflow was fixed. At 320 px the native date input crops later display segments, while
retaining its complete value and picker. [Observations](../../output/playwright/team-settings-2026-09-12/observations.json)
and [captured requests](../../output/playwright/team-settings-2026-09-12/captured-requests.json)
record the fixture behavior. [Desktop](../../output/playwright/team-settings-2026-09-12/desktop-permissions.png)
and [320 px](../../output/playwright/team-settings-2026-09-12/mobile-320.png) screenshots
show the final layout.

Package source is clean at local commit `fd9f0a85d4f6882954c86b32e5aceec3e0cedb5d` in
the verified resource-repair worktree. The reproducible archive is installed, with
provenance and lockfile updated. Archive SHA256:
`5f03a4051256e682d89413212a08da3b97f74fbc5eda0cbe06b1d06d0b72c28f`.
The application changes remain uncommitted alongside the pre-existing working tree.
No push, forced reload, live permission change, or production work dispatch occurred.
Live adoption remains unverified.

The isolated browser and fixture server were stopped. Automatic approval review rejected
recursive deletion of the temporary fixture as destructive; it remains inactive under
the system temporary directory. This does not affect the implemented settings or checks.
