# Team settings completion review — September 12, 2026

Owner request: “done? review work”. Scope: the latest permission-editor consolidation,
identified from native project `buddy_project_d5172569-a7bd-4e9c-be5e-5eb9b8e56b82`,
its completed criteria and the September 12 implementation record.

## Verdict

Local implementation meets the recorded criteria. Independent client and server/package
reviews found no confirmed regression or new blocking defect in this consolidation.
Application delivery and running-process adoption remain incomplete/unverified.
This review does not close the wider Buddies programme or its open projects.

Reviewed behavior: independent permission bits including write-only states; exact expiry
preservation and explicit clearing; staffing dependencies; stale revision rejection;
archived/detached target revocation; canonical preview/apply; receipt replay after
revocation; removal of the old raw PUT mutation; desktop/mobile shared integration.

## Remaining limitations

- Pre-existing owner UI gap: an archived **grantee/lead** receives 404 from the generic
  guard before the access diagnostic handler (`server/src/buddies/routes.ts:207`).
  A lead removed from a workspace also loses that workspace's settings entry because
  `BuddyCoordination` renders current memberships. Store-level revocation supports
  these grants, but the UI does not expose them. The implemented former-**target**
  revocation path is covered by the passing HTTP test. Review recommendation: cover
  former leads in a separately scoped owner grant-discovery improvement.
  **Resolved 2026-09-24:** the workspace page (`/buddies/workspaces/:id`, both shells)
  lists "Access held outside the team" from the read-only
  `GET /api/buddies/workspaces/:workspaceId/inactive-access` (grants whose grantee or
  target is archived or detached). Each row opens the ordinary `BuddyTeamSettings` for
  that pair, so revocation is the unchanged preview/apply. Parties carry `standing`, not
  `status`, because the route guard's `visibleBuddyPayload` drops any record with
  `status: 'archived'`. Guard: `server/test/buddy-inactive-access.test.ts`.
- Browser evidence uses `BuddyTeamSetup` with deterministic HTTP fixtures. The fetching
  wrapper's visibility/reconnect/refetch interaction was not exercised in a fresh
  browser run during this review. A newer grant revision remounts permission controls
  (`BuddyTeamConfiguration.tsx:635`) and can discard unsaved edits. Revision checking
  protects persisted permissions; draft preservation deserves interaction coverage.
- No running application reload, production permission change, dispatch or live
  adoption check occurred during this review.

## Fresh verification

130 tests passed, with no failures, skips or cancellations:

- Package: 93, running `node --test --test-reporter=spec` in the verified resource-repair
  worktree (all 16 package test files).
- HTTP/MCP: 7 across `buddy-team-permissions`, `buddy-team-recovery`, `buddy-team-access`
  and `buddy-owner-authority`.
- Runtime: 26 across `conversation-runtime`, `buddy-owner-runtime` and
  `buddy-background-runtime`, including the foreground timeout budget and joined drain.
- Client: 4 `buddy-team-configuration` render tests, with the client TSX configuration.

Client `pnpm -C client exec tsc -b`, server `pnpm -C server exec tsc --noEmit`, and all
six `check-client-invariants.sh` gates passed. Builds and browser screenshots are
earlier evidence; they were not regenerated for this review. The current runtime suite
has 26 tests; the prior report recorded 25 at its earlier observation.

## Delivery and evidence correction

Package worktree `~/git/.codex-worktrees/buddies/resource-repair-20260912` is clean at
`fd9f0a85d4f6882954c86b32e5aceec3e0cedb5d`. It has no configured remote. Archive SHA256
`5f03a4051256e682d89413212a08da3b97f74fbc5eda0cbe06b1d06d0b72c28f` matches provenance,
and the lockfile SHA512 matches the archive. All 25 archive files match the committed
source and the installed root/server package copies. This proves the installed files;
it does not establish which package an already-running process loaded.

All 19 entries in the implementation evidence file match current files/absence.
The application changes remain uncommitted with nothing staged. Review-only work did
not commit, push, rebuild the archive or edit implementation source.

The native completion record and notes `b6a47d28`/`8013c6ad` incorrectly identified
the implementation report with the browser observations hash. Preserve those historical
records and append this correction:

- `IMPLEMENTATION_TEAM_SETTINGS_2026-09-12.md`: SHA256
  `499830fa63077aea02f2b5681e1db465c7979368d3dfd0047cc7bd189ab93072`.
- `IMPLEMENTATION_TEAM_SETTINGS_2026-09-12.evidence.json`: SHA256
  `8935d9194ba4f76f27fe5848e2efc9768ca5a08d47178e85e89620a57895c022`.
- `output/playwright/team-settings-2026-09-12/observations.json`: SHA256
  `16d51624cc9c467ac6b93078a5add5ed2701505854910e60ca2819446a164397`.

Historical report excerpt: “The application changes remain uncommitted alongside the
pre-existing working tree.” Its local-completion scope still holds. No owner product
decision was reopened or replaced by this review.
