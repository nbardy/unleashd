# Buddies pending-work handoff — 2026-09-13

Prepared by Buddies Development Lead for the owner, around 04:01 UTC / 12:01 Asia/Makassar.

This is a dated handoff and evidence snapshot. Native projects, todos and receipts remain authoritative; re-read them before acting. Scope: every currently open project readable for this Lead (20), both engineering-report projects (2), and related unresolved findings in the inspected handoffs. This is not an inventory of every employee or workspace. The [full open-work appendix](2026-09-13-buddy-pending-handoff.open-work.md) preserves all 22 project IDs/revisions and 95 unfinished checklist items. The [evidence snapshot](2026-09-13-buddy-pending-handoff.evidence.json) preserves their complete returned criteria, evidence, audit references and source hashes.

## Current assessment and correction

Overall delivery remains blocked. UI fixes, exact original-thread browser acceptance, and assembled repository delivery are unfinished. The original coordinator and two engineer attempts failed after 600 seconds; no successor exists, and all three original work windows have expired.

**The reliability implementation itself is complete according to the latest parent revision 12**, updated 2026-09-13T03:56:05.687Z. Its “Verify and integrate reliable team returns and recovery” todo is now done. This supersedes the earlier status answer's overly broad wording that a successful return round trip was still unverified. There is versioned isolated real-provider owner → worker → lead evidence; a production round trip for the original UI/release or stopped Wave_sim work remains unproven.

The reliability project `buddy_project_f24b0cc3-e82e-40ab-b974-5f1bfc469950` was not returned by a direct scoped read in this turn. Its reported revision-4 completion is sourced from readable parent revision 12 and the versioned implementation report, not an invented fresh direct read. The recovery implementation must not be rebuilt merely because the old child blocker text still says “await recovery.”

## What the 600-second timeout means

It is an **absolute runtime deadline for one background attempt**, not a provider-idle limit. A tool call, a long build, active model reasoning or heartbeat does not extend it. Expiry revokes turn authority and goes through `max_runtime_timeout`; it must not masquerade as a user stop.

There are separate clocks:

| Clock / path | Current inspected behavior | Consequence |
| --- | --- | --- |
| Foreground owner chat | `TURN_MAX_RUNTIME_MS`, default 24 hours; configurable with `CWV_TURN_MAX_RUNTIME_MS` | The September 10 accidental foreground inheritance of 600 seconds was repaired. |
| Plain background claim with no explicit budget | `claimBuddyRun(... maxRuntimeSeconds = 600)` | The generic ten-minute fallback still exists. The executor also falls back to 600 for policies without a cap. |
| Fresh managed `delivery.kind:"work"` | Package seeds `max_runtime_seconds = min(3600, explicit/inherited policy cap OR execution.maxDurationSeconds)` | With a four- or six-hour work window and no smaller inherited cap, a new attempt gets **one hour**, not ten minutes. Explicit smaller caps still win. |
| Background attempt ceiling | 3,600 seconds in package validation and executor | A larger overall assignment window does not allow a single background attempt over one hour. |
| Overall managed-work window | Starts at first admission; separate `maxDurationSeconds` and `maxRuns`; default one hour / 20 runs | The wall clock continues while waiting or failed. Remaining attempts do not refund elapsed time. |
| Scheduled automation policy | Store/scheduler default runtime remains 600 seconds | Managed-work default changes do not silently change every existing automation. |
| Provider inactivity / event bridge | Defaults: one hour without provider activity; two minutes without bridge liveness | Separate failure modes. Changing these does not cure an earlier absolute deadline. |

Effective managed attempt deadline is the earlier of **attempt start + attempt cap** and **the original assignment deadline**.

Source anchors, preserved with hashes in the evidence snapshot:

- `server/src/constants/timeouts.ts:31` and `:44`: provider-idle and foreground runtime defaults.
- `node_modules/@nbardy/buddies/src/coordination.js:281`: current managed-work budget derivation.
- Same installed file `:493`, `:509` and `:514`: generic 600-second fallback, background ceiling and deadline clamp.
- `server/src/buddies/run-executor.ts:215` and `:373`: executor cap; its execution snapshot records `attempt_cap` versus `managed_envelope`.
- `node_modules/@nbardy/buddies/src/background-work.js`: first-admission wall-clock window and shared recovery budget.
- [Foreground incident](../docs/incident-2026-09-10-buddy-chat-timeout.md).
- [Closed-timeout recovery decision](../product/buddies/coordination-reliability-2026-09-12/05-closed-timeout-successor.md).

The three historical runs inherited the old ten-minute attempt behavior despite longer overall assignments. Current native observation still shows their 600-second limits, `max_runtime_timeout`, no successor, `remainingSeconds:0`, and “Original managed work limits are exhausted.” That is historical assigned policy, not proof that a fresh work request would still receive ten minutes.

| Historical attempt | Run ID | Overall assignment |
| --- | --- | --- |
| Lead coordinator | `buddy_run_c9bb49a7-f98d-4bbe-ae51-6b1f1a0b3ffd` | 6 hours, 30 runs |
| UI Engineer | `buddy_run_aedf24d1-3a9d-4fc1-b5af-81304ae74773` | 4 hours, 20 runs |
| Release Engineer | `buddy_run_a2f53fd2-bc3a-4538-9d7a-a0c77b310fa6` | 4 hours, 20 runs |

### Judgment and decision history

Owner asked whether ten minutes is the default and said it feels very low. **Assistant recommendation:** ten minutes is too short as a general engineering-attempt default when meaningful inspection, builds and browser verification can exceed it. The current one-hour managed-work cap is a better starting point. Make the resolved cap and overall deadline explicit before dispatch, preserve checkpoints, and expose which limit ended a run. Do not solve this by making every watchdog unlimited or by merely raising provider-idle timeouts.

This is a recommendation, not an owner-selected new numeric policy. No evidence was found establishing why the original author chose exactly 600 rather than another number. No timeout setting was changed by this handoff. Revisit the one-hour choice if real engineering attempts repeatedly hit it while making progress; distinguish that from stalled providers and exhausted whole-assignment budgets.

The September 12 recovery successor decision still holds: preserve historical failures and old replies, stopped roots, original permissions and elapsed budgets. What changed is the implementation's fresh-work budget derivation and the availability of explicit recovery. The three exhausted assignments need separately bounded fresh work, not repeated retries of expired receipts.

## Pending delivery work, in suggested order

### 1. Foreground capacity and misleading queue/failure state

Existing [capacity handoff](2026-09-13-foreground-buddy-capacity-handoff.md) documents owner input disappearing during capacity denial, one-second retry attempts labeled `spawn_failed`, generic “queued” UI and non-FIFO admission. Its recorded incident counted 457 failed attempt entries while no provider started. This is a separate issue from the 600-second termination.

Current installed `coordination.js:476–478` still applies the same active-run check to foreground chats: global active count 8 and membership `max_active_runs` (2 for the observed Lead). The inspected source confirms the coupling; this turn did not reproduce the full UI incident live.

Next implementation: distinguish foreground entitlement from background quotas; retain same-conversation serialization and authority checks; preserve submitted input; represent legitimate capacity waiting durably with a reason and event-driven wakeup rather than failure polling. Test saturated background capacity + foreground start, continued background limits, visible owner input, deterministic ordering and both shells. Treat the linked document's product semantics as its author's proposal unless supported by the current owner's instruction.

Ownership gap: no separate capacity project appears in this Lead's 20 open records. Check whether another owner already has it; then link or create one authoritative work record before implementation. Do not silently turn the diagnostic project below into an unrelated runtime rewrite.

### 2. Resume the prepared UI repair project

Owner: **Buddies UI Engineer**. Project `buddy_project_95592e35-f568-4868-9a93-03c8a8511597`, revision 5, blocked.

Deliver all four criteria:

1. Owner can discover and revoke saved grants held by an archived or detached **grantee/former lead**, without reactivating them, widening grants or weakening general archive guards. Former-target revocation was already covered; do not confuse it with this remaining former-grantee path.
2. Unsaved permission changes survive visibility/reconnect/refetch and grant revision changes. Stale save reports conflict while retaining the draft. Successful save uses authoritative revision; target switch/reset remains deliberate.
3. Validate desktop and mobile through the shared settings path, meaningful HTTP/MCP boundaries, real browser interactions, client `tsc -b`, relevant server checks and client invariant gates; return attributable commits.
4. Inspect the exact original owner thread read-only: `http://unleashd.localhost/chat/7d9d117f-7a13-46e2-bf6a-95da591d6e2b`. Verify the original September 9 discussion/five-defect review and newest rows with dated browser evidence. Earlier API evidence for this thread and browser evidence from `aca48e0e...` are different acceptance artifacts.

Preserved snapshot, attested in project evidence: `/Users/nicholasbardy/git/.codex-worktrees/unleashd/team-settings-ui-20260913`, branch `codex/team-settings-ui-20260913`, commit `743379dc8d607d6825f5080f41739a491e9bffb4`. This handoff does not certify its current disk cleanliness. Inspect it before reuse and preserve concurrent bytes. Snapshot existence is not completed repair evidence.

### 3. Reconcile history and stale work records

Owner: **Buddies Development Lead**.

- History repair `buddy_project_f5e8e43a-9c69-4dd2-82d1-c6c953e3549b`, revision 8: A1–A7 are done; only exact original-thread browser acceptance remains. Do not reopen the repaired privacy, note-size, recall or context-continuity defects.
- Delivery parent `buddy_project_37f2780f-f766-452b-991c-eb4ca4192a9b`, revision 12: keep blocked until UI/release completion; reconcile the history todo from actual browser evidence, then final review.
- Current child blockers still refer to “await recovery implementation” / “Request is no longer open.” Parent revision 12 supersedes that diagnosis: recovery exists, but the original envelopes are exhausted. Refresh child blockers through revision-checked native updates when arranging resumption.
- August entries mix superseded quota/schema/tool designs with potentially unfinished deliverables. The appendix deliberately preserves their wording as historical recorded criteria. Reconcile each against current implementation before marking done, cancelling superseded criteria, or coding anything.

### 4. Separate setup, admission and return diagnostics

Owner: **Buddies Development Lead**. Project `buddy_project_19703c1b-e2ad-4499-adf5-7bb16b0b6fa9`, revision 1, ready; no implementation/evidence recorded.

Expose distinct answers for “can save configuration,” “can start this intended work,” and “where/how did the result return.” Old owner requests or an active human chat must not appear as unrelated setup blockers. Resolve permitted workspace names for owners without leaking unauthorized workspace metadata to employees.

Use canonical predicates and additive diagnostic output. Required real-boundary fixtures: multi-workspace manager appointment; missing incoming work; busy background return; owner Mailbox-only return; old owner-directed request; restricted visibility. Keep configuration success, execution admission and actual return proof separate.

### 5. Preserve, assemble and verify repository delivery

Owner: **Buddies Release Engineer**. Project `buddy_project_a2047be3-f8cb-4eed-ac2e-522e3831bee6`, revision 4, blocked.

Inventory app/submodule/package changes, ancestry and provenance; preserve inherited work separately from new fixes; integrate returned UI repairs; produce attributable task-branch commits and verify the assembled application. The shared app remains heavily dirty and includes unrelated concurrent changes. Never stage it wholesale.

Preserved snapshot, from project evidence: `/Users/nicholasbardy/git/.codex-worktrees/unleashd/buddy-release-integration-20260913`, branch `codex/buddy-release-integration-20260913`, commit `551db45df46b9cac89b26538ea220aa67392cffe`, parent `10605c93b37b3237c46af947bf871ed159a69e5e`. Re-inspect current effects before use.

Current inspected app HEAD: `1187a8b6660b95c0c60bd8fada105f015b98cc39`; this HEAD does not include the dirty working tree. Vendored package provenance points at clean source `b70c0def1373034aeff56e409adb97d66ff6d7f7`, archive SHA256 `76fda9860849fe0e95d2655426c74dbe440718dc2691342e1e192dcc26be43cd`. Installed coordination source matches the archive. This handoff does not assert all installed files or the loaded process match merely from that one-file comparison.

Verified package source for that version is `/Users/nicholasbardy/git/.codex-worktrees/buddies/wave-sim-ceo-second-pass-20260913`; do not repackage stale dirty `~/git/buddies` by default. Follow the existing submodule commit/push-inside-before-pointer rule; no main push. Final evidence needs exact source hashes, commit list, package parity, applicable full boundaries, shared/server/client typechecks, invariant gates and build/package checks. Record live adoption separately.

### 6. Operational acceptance and external dependencies

Parents `buddy_project_545457c2-3c8a-4bc1-b792-702a6d3ffbb7` (revision 9) and `buddy_project_9864f34e-b435-43b1-80b1-07cc51645fbe` (revision 20) remain in progress.

There is successful **isolated** real-provider setup/worker/return evidence. What is still missing is applicable production acceptance for the actual team/task being claimed, exact original-thread browser acceptance, and reconciliation of those project criteria against the later isolated evidence. Do not repeat “no live-provider flow has ever passed.”

Production Font Maker/Wave_sim operation is not established by this turn. Historical stopped production roots stay stopped; this handoff does not restart them. For a future authorized bounded round trip, retain setup receipt, actual admission, recipient acceptance, artifact, completion evidence and return receipt. A queued message or completed return-delivery run alone does not establish task correctness.

Connecting a real mailbox remains blocked on an identified account/provider and authorized effect scope. The generic adapter's tests are not a connected inbox. External outreach prerequisites and any GPU experiments belong to their own projects/permissions.

## Remaining August backlog and disposition

These 15 older open records remain on the board; full IDs and exact unfinished tasks are in the appendix:

| Area | Pending disposition |
| --- | --- |
| Deferred direct-report backlog | Reconcile containment and budget enforcement, automation/delegation/storage limits, scheduled conversation continuity. |
| Work graph / project team membership | Separate feature backlog: task links, cycle/visibility rules, canonical membership and completion behavior. |
| AI-OS cross-harness workflow | Canonical repo/remote choice and optional integration; not required for this repair delivery. |
| Historical 16-case direct-report suite | Map old quota/schema expectations onto current grant model; retain meaningful unproven boundaries. |
| Ephemeral helpers | One exact blocking-versus-Workflow documentation criterion remains; no new Buddy lifetime. |
| Historical client layer | Hierarchy removal/team badges/labels and checks need current-source reconciliation. |
| Vendoring choice | Remote and tarball-versus-submodule decision unresolved; old agent-cli missing-origin item is done. |
| Historical server layer | Old operation/allowlist/profile/grant criteria need disposition against current contracts. |
| Security-fix list | Recheck automation enablement, archive, delegation and self-send gates; old record is not fresh vulnerability proof. |
| `-p` and stale sessions | Update only valid current harness guidance; identify original sessions before any cleanup. Old IDs/counts are not current process evidence. |
| Lead memory-path blocker | Descriptive state appears stale given working native memory; verify original criteria, then reconcile. |
| Minimal primitives / wait | Older alternatives are historical, not accepted new APIs; compare with current typed send, runs and recovery. |
| Store-layer delivery | Reconcile old schema/quota review and local commit/package criteria with current implementations. |
| Lead manager-edge blocker | Current context has two report edges; verify/disposition old evidence rather than requesting redundant grants. |
| Uncommitted work across three trees | Exact artifact attribution, package/source preservation and stale-session evidence remain release concerns. |

Open-record counts overstate new engineering work because parent/child criteria overlap and August records preserve superseded concepts.

## Resume protocol for the next engineer or lead

1. Read native inbox, relevant projects/revisions and team state; inspect capabilities before managing staff. Respect the current audience and existing stopped-root fences.
2. Inspect the preserved worktrees and current disk effects. Reuse the existing UI/release projects; avoid duplicate open assignments and concurrent writes.
3. For any authorized fresh assignment, specify a bounded work window/run count, inspect the effective attempt cap in the receipt/execution snapshot, and verify actual admission. Old exhausted requests cannot be made live by repeatedly calling retry.
4. Save versioned checkpoints before long commands. On failure, inspect effects, elapsed budget and return state before retry.
5. Keep canonical todo evidence current. Close only criteria actually verified; do not call the whole product complete from tests for one lane.
6. Return the exact commits, tested behavior, browser artifacts and limits to the owner. Do not publish/deploy, push main, send external messages or revive stopped production work as an incidental handoff action.

## Verification performed for this handoff

Native reads: inbox, all 20 open Lead projects with no next cursor, both direct-report projects, and six visible historical team runs with no next offset. No new work was dispatched.

Inspected current timer/admission/recovery source and package provenance; verified the installed coordination file equals the archived file. Source hashes and preserved excerpts are in the evidence snapshot. Broad historical test counts are version-specific evidence in [second-pass verification](../product/buddies/wave-sim-second-pass-2026-09-13/05-verification.md), not fresh claims for this dirty tree.

Fresh focused verification: `pnpm exec tsx --test server/test/buddy-coordination.test.ts server/test/buddy-coordination-observation.test.ts server/test/timeout-defaults.test.ts` passed **8/8**, with no failures or skips (exit 0). These use packaged/native/runtime fixtures, not new production work. No application source, timeout configuration, active run or staff setting was changed for this document.
