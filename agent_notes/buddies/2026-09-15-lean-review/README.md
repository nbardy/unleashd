# Lean Buddies review — September 15, 2026

## Verdict

**Keep four repair/delivery packages. Add no new product concept, MCP tool, table, scheduler or independent state authority for this pass.** The proposed code changes correct existing writes, resource selection and projections; the remaining work qualifies and delivers behavior already implemented.

This is the Lead's completed review and scope recommendation under the owner's lean direction. It is not an assertion that the fixes are implemented or that every proposed cancellation has been applied. Native Task status remains authoritative. Implementation execution stays paused pending selection of the reviewed work; no staff was dispatched.

## Counts and coverage

Fresh native reads covered **73 records: 71 Lead-owned and two supervised UI/release Tasks**. There are **35 open, 37 done and one cancelled**. Full criteria and all comment pages were read for the open set; closed records received inventory/history review, not a fresh completion audit. No other team's workspace-wide census is claimed.

For the **12 new Tasks in today's feedback intake (created after 13:00 UTC)**:

| Disposition | Count |
|---|---:|
| Already complete: assignment model selection | 1 |
| Cut/defer from this pass: research infrastructure, full usage accounting, cross-request batching | 3 |
| Collapse into existing work: incremental reads, recall, identity, stop scope, restart integration, composition acceptance | 6 |
| Retain: bounded reads and one coordinating review parent | 2 |

For the **35 open records**, recommend **6 cuts, 4 deferrals, 19 collapses, four repair/delivery packages plus one review parent, and one separate routing obligation**. That removes 29 standalone items from the selected implementation queue. The four deferred records can remain dormant; historical evidence is retained. The routing obligation does not gate core delivery.

## Four existing packages, in order

| Package / existing Task | Smallest retained work | Acceptance and limits |
|---|---|---|
| 1. Edit and control correctness — `f5e8e43a` | Preserve project/todo evidence when criteria change; align owner identity edits with the soul actually used; make readiness use the actual return route; make run-versus-root stop scope explicit. | Native MCP edit/read regression for self and supervised Tasks, including done→reassessment, explicit evidence replacement and replay. Owner edit→next briefing fixture. Two-sibling stop and busy-owner/background-return fixtures. Change cancellation only if the fixture proves a lineage error. Existing authority and scope checks remain. |
| 2. Existing settings UI — `95592e35` | Preserve unsaved permission drafts across grant refresh; expose saved grants held by inactive grantees for revocation; qualify current hierarchy/badges and the original conversation's history. | Browser interaction on existing desktop/mobile settings paths, revocation without reactivation or widened access, stale-save conflict, target-switch/reset and successful-save behavior. Exact original thread `7d9d117f-7a13-46e2-bf6a-95da591d6e2b` remains an acceptance target. No new settings system. |
| 3. Bounded reads — `075e367e` | Qualify existing work/inbox/team summaries. Bound recall content, including one long match; keep exact expansion via existing document refs or file paths. Clarify current-record filters and stale-page restart. | Retain the four-project ≤15,000-character criterion; measure normalized and full envelopes on an identified build. For recall, Lead proposes a fixed 15,000-character normalized response ceiling with explicit truncation, tested on long/multiple matches; this is a proposed implementation constant, not a new user option or an owner-specified target. Preserve audience and exact expansion. No new relevance engine, filter catalog, index or change feed. |
| 4. One integration/delivery — `a2047be3` | Include only missing final restart corrections; assemble accepted fixes with package provenance; reconcile docs and run the existing meaningful checks plus one representative delegation→artifact→lead-review return. | Identify source/candidate/pushed/loaded separately. Reuse existing config/loader/runtime and Worker/return tests. Keep owner chat usable. Historical failed requests remain failed. No new release program, telemetry dependency or broad cleanup. |

The review parent `6efaffd1` accepts these results. `9ef2b573` separately retains a prepared response whose destination lacks an authorized native route.

## Causes and concrete corrections

### Evidence loss: freshly reproduced, not just a forwarded report

A disposable fixture exercised actual `new_project`, `update_project` and `get_current_work` through the native MCP server. Both self-owned and supervised Tasks retained project/todo evidence after a title-only update. Changing their criteria with evidence omitted erased both arrays.

[Reproduction](reproduce-evidence.ts), [observed result](evidence-reproduction.json). The script exits successfully when it reproduces the defect; this is **not a passing repair regression**. No live Task/database was used by the fixture.

The package's `store.js:updateProject` clears project evidence whenever `criteriaChanged`; its todo update similarly chooses `[]`. The coordinated wrapper preserves the already-cleared result. The driver is conflating invalidation of completion with deletion of historical evidence. Preserve references, use existing status to require reassessment, and retain explicit replacement semantics. **No new evidence ledger or acceptance controller is needed.**

### Identity: resource selection, not proven cache failure

Current `operations.ts` routes scoped soul refs to the knowledge ledger, while unscoped soul refs use the portable identity. `integration.ts` uses `detail.soul` for owner-thread briefings and scoped soul only for shared audiences. The field report's successful scoped owner edit therefore verified a different resource from the next briefing.

Correct the existing edit target and generated guidance; clearly label a scoped publication where it remains supported. Use the existing ref/revision to verify edit→next briefing. Do not silently widen a scoped write into global identity or add another identity/cache subsystem. Runtime reproduction of the exact next-turn flow remains implementation acceptance.

### Readiness and stopping: projections should match existing execution authority

Current `team-readiness.ts` checks `message.parent_conversation_id`; the package's `enqueueMessageReply` chooses `return_policy.return_conversation_id` first. This is a concrete source discrepancy supporting the reported misleading busy-return warning, **not proof that a production callback failed**. Reuse the actual destination selection in readiness and qualify an exact assignment instead of treating an aggregate team result as that assignment's state.

The native stop path already distinguishes `runId` from `rootMessageId`; root stop intentionally cancels siblings sharing the root. Start with accurate labels and an inspection of the existing root/run set. Do not add a third cancellation lifecycle or a generic preview option merely because the field report asked for one.

### Settings: draft lifetime is tied to a server revision

`BuddyTeamConfiguration.tsx` renders uncontrolled permission inputs inside a fieldset keyed by target **and grant revision**. A refreshed revision remounts the inputs with server defaults. Keep the draft tied to the editing target; refresh clean forms deliberately, preserve dirty values, and handle stale save through the existing revision contract. This is a source-supported cause; browser reproduction and a complete small correction remain required. Saved inactive-grantee discovery needs its own route/UI fixture before changing behavior.

### Read size: count bounds do not bound content

`recallKnowledge` currently concatenates full scoped documents and legacy matches, then slices by match count. It has no total content-size cap. Narrow calls help but cannot bound a single large match. Use bounded snippets and existing exact expansion, with a fixed implementation ceiling rather than new caller knobs. Existing summary and paging code already solves most routine work discovery.

### Delivery drift and backlog growth

The final restart closeout already contains provider/audience pairing and inferred-session fixes with 59 recorded boundary passes. Treat it as candidate integration, not a new runtime design. Parallel intake created separate Tasks for shared proof obligations; old schema/quota plans persisted after later delivery. Consolidate execution around changed behavior and reuse one acceptance artifact across the relevant criteria.

## What to leave out

- **Research infrastructure:** GPU leases, external-job ownership, independent heartbeats/stale-run service, automatic artifact verification and workspace-local reporting. Use explicit job/process/log/artifact references and known limitations.
- **Complete billing/usage:** current event contracts do not supply the required counters. Existing durations and explicit null coverage remain useful.
- **Cross-request review batching:** managed parents already coalesce child returns. Ordinary progress belongs in Task comments. A reproduced duplicate should be fixed through existing idempotency, not a new scheduling policy.
- **Durable change feed:** the demonstrated need is bounded current-work discovery. Inclusive timestamps are not synchronization; current work cursors restart when stale and inbox/team offsets retain documented concurrency limits.
- **Old alternate architectures:** hire quotas, another executor, graph/membership tables, universal harness rules and tarball conversion do not follow from these failures.
- **Extra dashboards or a generic status timeline:** correct current receipts/labels using authoritative records.

These are deferrals/rejections of additions, not instructions to remove existing permission checks, stop/drain handling, retry attribution or evidence requirements.

## All open Task dispositions

Full IDs have the `buddy_project_` prefix. “Merge” is the recommended canonical successor, not a claim that unmet criteria are complete.

| Task | Disposition | Successor | Rationale |
|---|---|---|---|
| Apply the Wave_sim coordination-efficiency handoff to existing Buddy APIs (`6efaffd1`, r8) | keep | — | Keep one review/coordination record. Four repair and delivery packages below own execution; this parent accepts their evidence. |
| Review research monitoring proposals against existing Buddy primitives (`8638d8bf`, r4) | cut | — | Drop research infrastructure expansion from this pass: heartbeat service, GPU leases, detached-job ownership, automatic artifact verifier and workspace-local reporting. Existing Tasks, process/log files and explicit unknowns suffice for the reported evidence. Revisit on a demonstrated core workflow failure. |
| Verify and finish compact Buddy work and attention summaries (`075e367e`, r3) | keep | — | Keep one bounded-read package. Qualify existing summaries; absorb recall output bounds and current-record paging semantics without an event feed or new search service. |
| Complete remaining Buddy repairs, reconcile backlog and deliver verified commits (`37f2780f`, r16) | merge | `6efaffd1` | Collapse duplicate coordination/reconciliation into the current review parent. UI, consistency and release criteria retain their respective owners; exhausted historical requests remain failed. |
| Report complete assignment usage and time with coverage (`cdae619b`, r3) | defer | — | Defer complete assignment billing/usage accounting. Provider counters and attribution prerequisites are absent. Keep existing timestamps and explicit null coverage; revisit only for an actual operating decision requiring these totals. |
| Verify the efficiency workflow in UI, MCP and the loaded runtime (`67c0de12`, r3) | merge | `a2047be3` | Fold composition, documentation and one loaded owner-to-worker-to-review acceptance into existing release work. No dashboard redesign or separate efficiency release program. |
| Separate setup, work admission and return diagnostics; resolve authorized workspace names (`19703c1b`, r2) | merge | `f5e8e43a` | Fold exact-target setup/readiness and actual return-destination diagnosis into existing consistency work. Correct projections over the existing authorities; retain privacy and setup checks. |
| Bound Buddy recall discovery without expanding managed knowledge (`556cc4a6`, r2) | merge | `075e367e` | Fold recall into bounded reads. Use existing exact refs/files for expansion, bound returned content including a single long match, and avoid new indexes/filter catalogs. |
| Make the affected scope of stopping Buddy work explicit (`9c34e327`, r2) | merge | `f5e8e43a` | Fold stop-scope clarity into consistency. Existing run and root targets already differ. Show the selected affected scope; change cancellation only if a sibling/lineage fixture demonstrates an actual error. |
| Make identity edits identify the effective next-turn briefing source (`9bae6183`, r2) | merge | `f5e8e43a` | Fold effective-identity selection into consistency. Owner-scoped soul writes and portable owner briefing differ today. Correct selection/guidance through existing refs; retain explicit scope authority without a new identity store. |
| Repair remaining Buddy history, privacy and consistency gaps (`f5e8e43a`, r9) | keep | — | Keep correctness of edits and control receipts. First repair reproduced project/todo evidence erasure, then effective identity and readiness/stop scope. Existing history-browser criterion stays with UI. |
| Coalesce redundant lead review wakeups while retaining every return (`4f875aff`, r2) | defer | — | Defer cross-request review batching. Managed parents already coalesce child returns; Task comments avoid unnecessary Mail. Repair duplicate replay only if reproduced, using existing IDs, without new timing/policy machinery. |
| Add reliable incremental and actionable Buddy reads (`56ced029`, r2) | merge | `075e367e` | Fold current filter/cursor qualification into bounded reads. Use full/focused rereads and explicit stale-scan restart; do not build a durable change feed for this discovery workflow. |
| Integrate the final restart-continuity corrections into the delivery candidate (`62511186`, r2) | merge | `a2047be3` | Fold already-fixed restart correction delivery into existing release work. Compare actual candidate bytes and integrate only missing provider/audience binding and inferred-session fixes. |
| Clarify and verify Buddy blocked-work recovery (`9ef2b573`, r2) | dependency | — | Keep the undelivered response as a separate routing obligation. Implementation already has evidence; unavailable cross-workspace contact is not a reason to add an API or block core fixes. |
| Validate memory curation beyond the September 13 tuning set (`de5267b7`, r2) | defer | — | Defer the broad held-out memory benchmark program from this repair pass. Keep relevant existing memory/scope regressions. Revisit systematic quality evaluation when a specific memory-use failure or tuning decision needs it. |
| Complete owner-to-team setup and operational readiness (`9864f34e`, r20) | merge | `a2047be3` | Fold remaining discovery/replay/receipt and live team acceptance into the same release scenario; preserve earlier setup evidence and original stopped production assignments. |
| Overhanging uncommitted work across three trees — at risk of being destroyed (`5a090ee9`, r2) | merge | `a2047be3` | Fold relevant artifact provenance into release. Historical dirty counts and unnamed stale-session shutdown instructions are obsolete; inspect current bytes, retain unrelated work, and dispose of fake patch evidence explicitly without broad cleanup. |
| Vendoring strategy: give ~/git/buddies a remote, then switch to a submodule (`14923985`, r2) | cut | — | Cut the tarball-to-submodule conversion from current scope. Keep existing vendoring/provenance. Revisit only for a concrete maintenance failure; do not rewrite the dependency format to close an old checklist. |
| Ephemeral sub-agents: collapse to a harness capability, not an operation (`e780d7f1`, r2) | merge | `a2047be3` | Fold useful Worker versus harness-helper wording into the existing documentation check. Drop the universal blocking/Workflow prescription; harness lifecycle remains provider-specific and current Workers reuse ordinary Buddy infrastructure. |
| Finish the composable Buddy system and MCP workflow (`545457c2`, r9) | merge | `a2047be3` | Fold remaining core acceptance into release. External email account integration is outside this repair scope and remains explicitly unconnected; existing mailbox boundary evidence is retained without treating integration as a core completion requirement. |
| Minimal primitives: loops, schedules, goals, message passing — and the one missing wait (`8a1f69b7`, r1) | cut | — | Cut the obsolete alternative loop-as-wait/blocking-send/checkpoint architecture. Typed Mail, bounded managed work and contextual returns already own this workflow. A current scheduler defect may be reproduced separately; the August design is not a feature mandate. |
| The Lead has no memory path, so every journal and curated entry is lost (`31d73904`, r1) | merge | `f5e8e43a` | Supersede obsolete no-memory-path provisioning work with existing identity/memory correctness checks. Native scoped notes and refreshed memory now work. Retain fresh-turn/scope verification; do not recreate legacy profiles or bulk-audit unrelated Buddies. |
| Delegation readiness: the Lead has no manager edge, so every delegate call is refused (`36a70bf6`, r1) | merge | `f5e8e43a` | Supersede no-manager-edge setup blocker with current receipt/gate qualification. Two canonical manager edges and sanctioned dispatch receipts exist. No new hiring quota or team provisioning is needed. |
| Verify and land the @nbardy/buddies store layer for direct reports (`2bce3176`, r1) | merge | `a2047be3` | Fold package provenance and still-valid archive/profile/path invariants into existing release verification. Drop obsolete schema-13 and hire-quota implementation steps; current package generation is different. |
| Work graph: task-to-task links and team membership on projects (`216ae739`, r1) | cut | — | Cut extra graph/membership tables, automatic unblock and todo assignees from this pass. Existing parentProjectId, owned child Tasks and comments express the cited workflow. Revisit a specific dependency or membership failure. |
| Direct reports: deliberately deferred backlog (`b55e2554`, r1) | defer | — | Keep OS containment, cumulative spend enforcement and new quotas outside this pass. Honest limitations remain visible. Existing conversation-bound automation behavior must be qualified before calling it missing; no new safety subsystem selected. |
| AI-OS as the cross-harness workflow layer (`3b1d5297`, r1) | cut | — | Cut the separate AI-OS executor/macro project from Buddy repairs. Existing conversations and runtime own execution; a second orchestrator does not solve a demonstrated gap here. |
| Document the -p orchestration constraint and clean up stale sessions (`7023cc14`, r1) | cut | — | Cut stale universal claude -p guidance and the instruction to stop five August sessions. Current provider boundaries and lifecycle docs are canonical; no current session is stopped based on historical counts. |
| Buddies security fixes that direct reports newly depend on (`743485e9`, r1) | merge | `a2047be3` | Fold still-valid security invariants into release verification: disabled-by-default automation, active/archive checks after awaits, canonical relationship gates and self-dispatch checks. Reopen only a failing current boundary; never drop the guarantees. |
| Sub-buddies test suite: 16 cases on one real fixture (`0334db8e`, r1) | merge | `a2047be3` | Fold relevant relationship/access/replay/profile tests into the existing suite. Drop the fixed sixteen-test quota-era plan, not the underlying valid invariants. |
| Sub-buddies client layer: delete deriveBuddyHierarchy, fix the team badge (`d7c71266`, r1) | merge | `95592e35` | Fold current hierarchy/badge checks into UI acceptance. Remove duplicate client derivation only where current behavior warrants it; do not force obsolete employment-schema changes. |
| Sub-buddies server layer: operations, allowlist sum, profile route (`816d7fa0`, r1) | merge | `a2047be3` | Fold current staff/allowlist/profile authority verification into release. Existing create_buddy/set_relationship contracts replace the old hire-quota plan; no duplicate operations. |
| Expose saved-grant revocation for inactive grantees and preserve permission drafts (`95592e35`, r7) | keep | — | Keep permission-draft preservation, saved inactive-grantee revocation and exact original-thread history checks in the existing UI owner. Small changes in existing shared settings components only. |
| Preserve Buddy implementation and verify integrated delivery (`a2047be3`, r4) | keep | — | Keep one integration/delivery record. Assemble accepted corrections, final restart fixes and current package provenance; run the existing boundary suites and one representative end-to-end acceptance, retaining source/pushed/loaded distinctions. |

## Coverage of the four priorities and eleven supporting requirements

The four priorities are dispositioned above: summaries/current reads retained; assignment selection remains completed with its captured-invocation evidence; usage and independent batching deferred.

| Supporting requirement | Retained coverage |
|---|---|
| Execution, delivery, Task acceptance | Correct existing readiness/receipt labels and verify the one return scenario; no second state machine. |
| Historical failed/cancelled attempts | Preserve original runs and receipts during Task reconciliation and release. |
| Recovery, controllers, limits | Retain current retry/stop/drain and runtime-bound regressions; no renewed allowance. |
| Interrupted result/report | Keep existing bounded report or unavailable fallback; verify through existing Worker tests. |
| Durable correlated delivery | Reuse existing idempotency/delivery/restart checks; fix only a reproduced gap. |
| Scoped oversight | Keep exact-target/audience checks on edits, reads and readiness. |
| Process/GPU truth | Preserve explicit unavailable coverage; no infrastructure subsystem. |
| Memory freshness | Correct effective identity selection; Tasks remain the work authority. |
| Safe partial updates | Fresh evidence-loss reproduction is package 1's first fix. |
| Tool bounds and clarity | Package 3's fixed response bounds and existing expansion; package 1's accurate refs/scope. |
| Source/build identity | Existing release package owns candidate and loaded acceptance. |

## Decision history and evidence limits

Owner chose lean API/MCP/data model and minimal understandable code, and asked for this cut/collapse review. The Lead recommends the exact four-package arrangement and deferrals. Earlier six-child decomposition in the efficiency closeout had distinct proof obligations; that reasoning still helps testing, but the owner's stronger scope constraint and today's source review show those obligations do not require separate implementation programs. Keep the proofs; consolidate their work ownership. Revisit package separation only for a distinct outcome/owner that cannot be managed as an existing todo.

[Task snapshot](task-snapshot.json) preserves all 73 records with revisions and the open-set comment pages. [Source snapshot](source-snapshot.json) preserves 19 source/evidence identities, full inspected source/doc text and SHA-256 hashes; snapshot SHA-256 `3bbcf35217c2b03ebe150a113e8bace9374d3f0cf215873e282a3c69add35c39`. Predecessors include the September 15 task plan, efficiency assessment/closeout, Font Maker field report, restart closeout and current core clarification.

Fresh execution in this review was the isolated evidence-loss reproduction only. Historical suite counts remain attributed to their original reports. UI behavior, live provider returns and the running host's exact source adoption were not newly verified. No production implementation, runtime restart, dispatch, main push or account action occurred.
