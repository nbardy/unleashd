# Buddies integration handoff

Status checked 2026-09-09. This is the resume point for the Buddies simplification
work and supersedes the completion/packaging status in the
[September 8 implementation record](2026-09-08_buddies-simplification-implementation.md).
Other sessions are actively changing these checkouts; recheck state before editing.

## Current status

The September 8 implementation exists and passed validation at that time. Its
application changes remain mixed with other uncommitted work in the main checkout.
It is not yet a reproducible, committed application delivery.

There has been further progress since the last conversation status report:

- The main checkout now has a cleanly packaged **schema-22** Buddies archive from
  `d5e6b25017fbb6d74089e49dd1a07ee9f874bcb5`. Its SHA-256 matches its provenance;
  `sourceDirty: false` and `releaseReady: true`. The earlier report of dirty
  package provenance applied to a different checkout/snapshot.
- The package source worktree has acquired additional uncommitted changes after
  that package commit. The archive does not establish that those edits are shipped.
- A newer coordination design and implementation are present. Preserve them;
  do not restore the old schema-19 archive just to match the September 8 handoff.
- No tests were rerun while writing this handoff. Current runtime readiness is
  unverified; the old green counts must not be presented as current validation.

## Where the work lives

| Location | Branch / revision | State and purpose |
|---|---|---|
| `/Users/nicholasbardy/git/unleashd` | `refactor/reduce-sprawl-2026-09-06`, HEAD `1187a8b6660b95c0c60bd8fada105f015b98cc39` | Application implementation, docs and tests; extensive mixed tracked/untracked changes |
| `/tmp/unleashd-buddies-simplification` | `codex/buddy-simplification-20260908`, HEAD `3ef5013c52c0928c8c026df2cbcbc2148052f530` | Clean, previously tested schema-19 package baseline |
| `/Users/nicholasbardy/git/.codex-worktrees/buddies/coordination-20260909` | `codex/coordination-20260909`, HEAD `d5e6b25017fbb6d74089e49dd1a07ee9f874bcb5` | Source of current schema-22 archive; further dirty coordination/store/test edits |
| `/Users/nicholasbardy/git/.codex-worktrees/buddies/20260909-message-notifications` | `codex/buddy-message-notifications-20260909`, registered HEAD `d7f4a19bcf0eb3ad66a198168e2571d539eacfcb` | Separate notification work to reconcile; worktree contents not reviewed here |
| `/Users/nicholasbardy/git/buddies` | `main`, HEAD `842631961d7d3c51d3dfdc9cc9ae444532a4b020` | Dirty sibling checkout with additional work and generated notes; do not use as an implicit packaging source |

The application worktree previously inspected at
`/Users/nicholasbardy/git/.codex-worktrees/unleashd/20260909T060132Z-94924`
no longer exists. At the last inspection it had the older application code; it is
not the location of the completed implementation. Use `git worktree list` to
choose a current integration destination.

The old package commits are retained in the Buddies repository:

- `83824784630cbbf626c00f0dd71ac06c3d54caad`: memory, messages and direct-report fixes.
- `9bb66226f9cbc04168a8d5b749015f7771702c35`: pending inbox ordering and expired wait reads.
- `3ef5013c52c0928c8c026df2cbcbc2148052f530`: export/multi-hire integration and schema-19 convergence.

The current package history includes `ae2b28e` (vendored baseline snapshot),
`885ca31`, `b0d2d31` and `d5e6b25` (coordination changes). **`3ef5013` is not an
ancestor of `d5e6b25`.** Compare behavior/source and migration tests; Git ancestry
alone cannot prove the original fixes survived. Inspection of the current archive
confirmed `sendMessage`, `finishConversationMessages`, `listBuddyActivity`,
`summarizeMemoryWrites` and `getBuddyTeamState` are present, but was not a semantic audit.

## What the original implementation delivered

| Workstream | Behavior and main application files |
|---|---|
| Memory | Three tools (`update_memory`, `remember_note`, `recall`); legacy writers removed; shared UTF-8 note cap; useful CAS errors; bounded ripgrep; migration and Markdown-view race fixes. `operations.ts`, `contract.ts`, `shared/src/buddy.ts`, `BuddyMemoryPanel.tsx`, `memory.ts` |
| Briefing | Scoped derived audit activity, compact valid work JSON, full bounded dense memory with revisions. `server/src/buddies/integration.ts` |
| Capture | One closing turn after successful eligible automation work, within the existing permissions/deadline/iteration budget; real write counts audited; work result preserved. `server/src/buddies/scheduler.ts` |
| Coordination | Generic send/reply, owner replies through authenticated HTTP, bounded cancellable waits, durable cycle rejection and inbox ordering. `dispatch-service.ts`, `operations.ts`, `control-server.ts`, `mcp-server.ts`, `routes.ts`, `shared/src/buddy-message.ts` |
| Direct reports | Hire/retire tools, owner quotas, canonical team projection and retirement/claim race protection. `direct-reports.ts`, `shared/src/buddy-team.ts`, desktop/mobile detail/profile views |
| UI | Shared `client/src/components/buddies/BuddyMessages.tsx` and CSS; guarded conversation links; both shells wired; legacy memory callbacks removed |
| Docs | Four concise living contracts, archived handoffs/reviews/sprints, repaired AGENTS/product links |

Read the actual contracts before changing an area:
[primitives](../product/buddies/PLANNING_PRIMITIVES.md),
[memory](../product/buddies/PLANNING_MEMORY.md),
[direct reports](../product/buddies/PLANNING_SUB_BUDDIES.md),
[automation ownership](../product/buddies/AUTOMATION_OWNERSHIP.md).

The original regression files include `server/test/buddy-memory-capture.test.ts`,
`buddy-messages.test.ts`, `buddy-direct-reports.test.ts`, the existing operation,
MCP, route, dispatch and lifecycle tests, and client memory/message tests. Several
are still **untracked**; copying only a tracked diff loses required implementation.

## Newer work that must survive integration

Read [DESIGN_BUDDY_COORDINATION.md](../product/buddies/DESIGN_BUDDY_COORDINATION.md),
especially sections 10–11. It extends the baseline with queued run inputs, atomic
reply return, delayed self-send, project execution gates, ownership transfer and
scoped approvals. Its header still says implementation/live validation pending,
while substantial code is now present; resolve readiness from tests and code.

New files include `server/src/buddies/{coordination-store,run-executor}.ts`,
`shared/src/buddy-coordination.ts`, `BuddyCoordination.tsx`/CSS, and
`server/test/buddy-coordination.test.ts`. Package implementation now also lives in
`src/coordination.js`, `src/coordination-work.js` and `src/coordination-approvals.js`.

Other overlapping changes include Builder teams, soul editing/conflict handling,
message notifications, Buddy archive/visibility/settings/sidebar behavior, and
provider/conversation-config/runtime refactors. The newer direct-report doc changes
archived-report visibility from the original implementation. Do not overwrite
whole files with September 8 copies or treat every dirty file as part of this task.
The dirty `vendor/agent-cli-tool` submodule is separate work.

## Validation evidence and its limits

The September 8 integrated snapshot passed:

- Package: **61 tests**, including upgrades from both schema-18 variants to 19,
  preserved data, foreign keys and idempotent reopen.
- Server: **249 passed, 1 opt-in live test skipped**.
- Client: **51 passed**, plus all six invariant gates.
- Client `tsc -b`, server compilation, Vite production build and compiled stdio MCP
  launched from `/` with note write/recall against an isolated database.

Historical logs still present at this check:
`/tmp/unleashd-buddies-server-combined-final.log`,
`/tmp/unleashd-buddies-client-combined-final.log`,
`/tmp/unleashd-buddies-vite-combined-final.log`.
They are evidence for that snapshot, not the current schema-22 app or newer dirty edits.
No live Buddies database was used for those fixture tests.

## Ordered wrap-up

1. **Freeze a reviewable snapshot.** Inventory both repositories and relevant
   worktrees again. Save the tracked changes and relevant untracked files before
   moving work. Use raw Git/subprocess bytes for patches; RTK summaries are not
   patch data. Preserve concurrent work; do not stage the entire dirty tree.
2. **Consolidate the application on an integration branch.** Include the original
   implementation and its dependencies, reconcile newer coordination/notification
   and UI work deliberately, and retain the tests/docs. Verify the server
   composition, shared schemas, both shells and migrations together. Commit the
   resulting coherent application changes so another worktree can reproduce them.
3. **Choose the final package source explicitly.** Start from the current
   coordination worktree and review its post-`d5e6b25` edits. Compare against the
   old regression baseline where needed. Test and commit the intended package
   changes. Preserve forward migration from schemas 18/19 through the current
   version; never downgrade a database or restore schema 19 over later work.
4. **Vendor only the selected clean source.** `tools/vendor-buddies.mjs` defaults
   to the dirty sibling if `BUDDIES_SOURCE_DIR` is omitted. Set it explicitly.
   Do not use `--allow-uncommitted` for the final artifact. Confirm archive hash,
   provenance commit, manifest, `sourceDirty: false` and `releaseReady: true`.
   Update the lockfile and verify the package actually installed in `node_modules`.
5. **Validate the final snapshot, then record exact commits/results.** Run the
   package suite, server/client tests, typechecks, invariants, build and real MCP
   launch. Exercise the newer coordination scenario family from design section 11
   if it is included in the final delivery. Fix real failures without weakening
   contracts to make counts green. Do not substitute the old 361-test claim.

Useful commands, from the appropriate final checkouts:

```sh
# Selected Buddies source, after reconciliation:
npm test
npm run check

# Application; substitute the final clean package source if its location changes:
BUDDIES_SOURCE_DIR=/Users/nicholasbardy/git/.codex-worktrees/buddies/coordination-20260909 pnpm vendor:buddies
pnpm update @nbardy/buddies --offline
pnpm install --force --offline --frozen-lockfile --ignore-scripts
pnpm test:server
pnpm test:client
bash tools/check-client-invariants.sh
pnpm -C client exec tsc -b
pnpm -C server exec tsc --noEmit
pnpm build
```

Packaging pitfalls observed: the same-version local `.tgz` sometimes stayed stale
until forced installation. Coordinate that refresh with other sessions: a shared
watcher once emitted `any` declarations while dependencies were temporarily absent.
Regenerate shared ESM/CJS declarations before rerunning dependent checks if that
happens; do not paper over the resulting TypeScript errors. When the dev-supervisor
owns the build lock, do not replace/stop it just to test. Use direct typechecks and
temporary output directories for build verification.

No push was performed by this task. Do not push main without the user's request.
Package `releaseReady` records packaging checks; it does not certify the application.

## Explicit limits and completion bar

Selective memory capture quality has not been evaluated with live models. A run
without permission or spare budget skips capture. Provider token/cost metering
and transparent crash adoption were outside the original implementation. Do not
claim those capabilities or silently expand this handoff into new features.

The wrap-up is complete when the chosen branch contains all intended app files,
its exact package source is committed and reproducible, schema transitions and
runtime boundaries pass on that snapshot, and the final record distinguishes
mechanical validation from any still-unrun live-model trial. The newer coordination
design separately requires a small owner-authorized live trial for its release claim.

Resume instruction: **Finish integration and validation from this handoff. Preserve
newer coordination and concurrent work, recover all required untracked files, use
an explicit clean package source, and report actual final commits and checks.**
