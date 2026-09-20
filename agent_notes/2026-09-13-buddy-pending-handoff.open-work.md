# Open Buddy work snapshot — 2026-09-13

Companion to [the handoff](2026-09-13-buddy-pending-handoff.md). These are recorded native criteria, not fresh implementation findings or instructions. Native projects remain authoritative. Old quota, schema and tool assumptions require reconciliation before execution. Done/cancelled todos are omitted here and retained in the JSON snapshot.

## Direct reports: deliberately deferred backlog

- Project: `buddy_project_b55e2554-3dae-4b14-8b81-fcd1cfec3531`; revision 1; status **backlog**.
- Owner: Buddies Development Lead.
- Recorded next action: Review after direct reports ships; no action before then

- **open** — Real capability containment: OS-level uid separation plus per-caller identity on /api/buddies/* (hire_quota is a budget, not a gate) (`todo_f047ddc1-a833-4ba2-be96-8d090a51241b`).
- **open** — max_tokens and max_cost_usd are validated, persisted, and NEVER read; the two enforced budgets are per-run not cumulative. Enforce or delete. (`todo_6563759d-fd61-431f-9cce-9f6404fb37e0`).
- **open** — No caps on automations per buddy, outbound delegations, delegation depth, or profiles/ disk (`todo_851d2bd4-38a7-407d-8188-da9071b509c2`).
- **open** — No way to wake an existing conversation on a schedule; needs a conversation_id binding on buddy_automations plus a scheduler resume path (`todo_3c1e58c6-4c9a-4903-b305-e1430c316620`).

## Work graph: task-to-task links and team membership on projects

- Project: `buddy_project_216ae739-a2ae-48a6-ae37-ec5d66b8d226`; revision 1; status **backlog**.
- Owner: Buddies Development Lead.
- Recorded next action: Do not start until direct reports lands; this is adjacent, not required by it

- **open** — buddy_work_links table: kind IN (subtask_of, blocks, relates_to), UNIQUE(from,to,kind), CHECK(from != to) (`todo_8e98b41e-dcb6-4a58-95ab-d697b8659c99`).
- **open** — ONE DIRECTION PER KIND. Never add parent_of alongside subtask_of — the manager/reports_to dual encoding in buddy_relationships is exactly what caused design 8.3 (two rows meaning one thing, overview disagreeing with itself, both buddies vanishing from the directory). Read inverses by query. (`todo_2ab067dd-d3eb-4e54-8341-eecafc53647c`).
- **open** — Cycle rejection in the write path or as a constraint, NOT an assertion in one caller — the relationships route already proved callers get bypassed (`todo_c1d8ad3b-19f7-44b2-952c-82d4dc3aedb7`).
- **open** — Derive status 'blocked' from open blocks edges; completing a blocker auto-unblocks dependents; retire or derive blocked_reason (`todo_d9c5331a-f6f2-4d3f-8115-5fc5ba500147`).
- **open** — buddy_project_members(buddy_project_id, buddy_id, role) with CREATE UNIQUE INDEX one_owner_per_project WHERE role='owner' (same pattern as one_active_sprint_per_project) (`todo_3ab79064-eaad-43d7-9c40-61c8a1b76419`).
- **open** — buddy_todos.assignee_buddy_id nullable — team owns the project, individuals take todos (`todo_16ba55fd-ff2d-47de-b6bb-65f04a7d168a`).
- **open** — getBuddyContext: authorise by membership lookup instead of buddy_id equality; keep the workspace check (`todo_b55e99d4-e82a-42c2-87b0-86baffb2606d`).
- **open** — Constrain members to the project's workspace (projects are workspace-pinned) (`todo_f596ce99-66d7-43dc-954f-5668dae8b852`).
- **open** — Tests: cycle rejection, derived unblocking on blocker completion, contributor read/write, exactly-one-owner enforcement (`todo_feeb7e83-b2b4-4b17-b6e7-4c5f0332b4e2`).

## AI-OS as the cross-harness workflow layer

- Project: `buddy_project_3b1d5297-3db3-4d52-8a33-9c06ec4a8573`; revision 1; status **backlog**.
- Owner: Buddies Development Lead.
- Recorded next action: Pick the canonical repo between ~/git/AI-OS and ~/git/ai-os_2

- **open** — Choose canonical repo: ~/git/AI-OS vs ~/git/ai-os_2 (`todo_b0ee4922-c9e0-4007-a46a-3c9cdf3b0f70`).
- **open** — Decide whether orchestrator.py shells out to the agent-cli binary instead of hand-rolling claude+codex (`todo_037ff747-91e0-4f7b-b872-644653008fe4`).
- **open** — Note that AI-OS has no remote either, same dependency problem as buddies (`todo_a4411cb5-ddc5-4a16-90f9-cc9caa71dac8`).
- **open** — Optional: port the sub-buddies 6-phase pipeline to an AI-OS macro (`todo_457eb6b4-47ab-4129-8ab9-ca4f1fd0f4fa`).

## Sub-buddies test suite: 16 cases on one real fixture

- Project: `buddy_project_0334db8e-2dbc-4f60-891d-f8a3a3216bd7`; revision 1; status **backlog**.
- Owner: Buddies Development Lead.
- Recorded next action: Blocked until store and server layers land

- **open** — Test 4: concurrent hire from two connections, quota 1, exactly one wins (guards B4) (`todo_bc7bf87b-b56c-48b1-a396-305e7a60f529`).
- **open** — Test 6: Owner lowers quota below headcount, replay hire still SUCCEEDS (guards B6) (`todo_96d5be51-ff24-4306-9ae8-b3e1bf2b26d4`).
- **open** — Test 7: hand-built post-crash state (row present, profile absent) — remember throws, held arm re-materializes soul (`todo_36c6caf8-df5a-46df-ada9-d620e3c3e09a`).
- **open** — Test 8: archive a MANAGER with an active report, report still reachable (`todo_7c1a06f7-770a-4628-a62a-85617ff3fc23`).
- **open** — Test 16: buddyCardMetrics team count equals countHeldDirectReports across active/paused/archived (`todo_b434027b-bbe8-4a04-8267-7d2c2cb880fb`).
- **open** — Remaining 11 cases from design section 13 (`todo_7a62dc52-8866-4b50-8d2b-1702b8d00c8b`).
- **open** — Run the server suite and report real pass/fail counts (`todo_8f45a876-70be-4b85-b3d8-9e1bf860dd6c`).

## Ephemeral sub-agents: collapse to a harness capability, not an operation

- Project: `buddy_project_e780d7f1-bb29-4a5d-b7c2-bd9cde212ce7`; revision 2; status **ready**.
- Owner: Buddies Development Lead.
- Recorded next action: Only the exact historical blocking-versus-Workflow documentation criterion remains open. Current vocabulary, read-before Buddy guide entries and parent-identity attribution are documented; do not redesign an ephemeral Buddy operation.

- **open** — Document that harness sub-agents must be BLOCKING calls, never Workflow — fold into the same doc line as the -p constraint rather than writing it twice (`todo_1162c844-13bc-4d6c-953e-661770b2de17`).

## Sub-buddies client layer: delete deriveBuddyHierarchy, fix the team badge

- Project: `buddy_project_d7c71266-2b44-4cd8-805b-cf0de53a6874`; revision 1; status **backlog**.
- Owner: Buddies Development Lead.
- Recorded next action: Blocked until the store layer lands (needs the employment sum in the overview projection)

- **open** — Serve team with status on GET /api/buddies/:id (`todo_a644021b-cbda-4049-b790-cf882e1aa0ad`).
- **open** — Delete deriveBuddyHierarchy whole (both deriveBuddyDirectReports and deriveBuddyManager) (`todo_0632ee00-b899-4375-8e57-f40eee978e5d`).
- **open** — Move the archived filter into buddyCardMetrics so both shells agree (`todo_423bf4a3-44b5-4916-b4d5-6232fa01fa03`).
- **open** — Gate BuddyDirectory badge on metrics.team > 0 to avoid a new '0 team' regression (`todo_2d100836-5e0c-4a16-beb7-8ecf2863e066`).
- **open** — types.ts: add employment sum, delete Buddy.manager_id and EmployeeRecord.manager, add status to directReports (`todo_9f4dc5e3-f231-42c6-baa1-6673566a2f91`).
- **open** — Rename shipped labels from 'sub-buddies' to 'direct reports' (`todo_7d61987a-372b-4454-a5f1-92d3f22a8ef4`).
- **open** — Run tools/check-client-invariants.sh and client typecheck (`todo_062dc59a-06c7-4b25-9f17-7a08270ac393`).

## Vendoring strategy: give ~/git/buddies a remote, then switch to a submodule

- Project: `buddy_project_14923985-6366-4c5a-9d08-855832dcd35c`; revision 2; status **ready**.
- Owner: Buddies Development Lead.
- Recorded next action: Agent-cli-tool origin drift is repaired. The separate Buddies remote/tarball-versus-submodule choice and conversion criterion remain unresolved; coordinate any current package delivery with the release lane.

- **open** — Decide: push ~/git/buddies to a remote (enables submodule) or stay on tarball vendoring (`todo_bbfee6e4-1da4-454d-b1e4-f39c08054ac6`).
- **open** — If switching: convert to submodule, retire tools/vendor-buddies.mjs, update AGENTS.md and docs/architecture.md to one rule (`todo_1979da7b-d88d-469d-a99d-827a4de1e7bb`).

## Sub-buddies server layer: operations, allowlist sum, profile route

- Project: `buddy_project_816d7fa0-ffb5-4b11-aa03-cc8898fcf8f0`; revision 1; status **backlog**.
- Owner: Buddies Development Lead.
- Recorded next action: Blocked until the store layer is reviewed, committed and vendored

- **open** — Register both ops: BuddyOperationName, BuddyOperationInputSchemas, BuddiesStorePort, execute dispatch, createBuddyMcpServer (`todo_f9757ba6-cb63-4b1a-a48c-24426fea9462`).
- **open** — Make allowedOperations a required sum {kind:'unrestricted'}|{kind:'restricted',ops}; update mcp-server.ts, mcp-config.ts, routes.ts delegation and review sites (`todo_6fc0d89b-721b-438b-9d9a-7a7886b4b2a1`).
- **open** — Keep the dispatcher thin: extract handlers rather than adding two more inline bodies (house rule R4) (`todo_453dfa9f-e2ee-448a-b37e-d3c6d62a9f55`).
- **open** — hire_quota on the profile route with non-negative-integer validation (`todo_b92533f8-9efa-43bb-bdaf-1ed20a895f93`).
- **open** — Briefing lines in integration.ts; cap soul length and stamp authored_by/at provenance into BUDDY_SOUL.md (`todo_0a7a6954-5856-4885-a6e6-36d130238886`).
- **open** — Run repo typecheck and confirm green (`todo_321d44f0-621f-485b-a8a6-860311b99bd5`).

## Buddies security fixes that direct reports newly depend on

- Project: `buddy_project_743485e9-ea23-46bc-b537-82f271248745`; revision 1; status **ready**.
- Owner: Buddies Development Lead.
- Recorded next action: Land alongside the server layer

- **open** — routes.ts createAutomation: explicit field pick with enabled:false; flip the store default from enabled=true (`todo_4d3d4911-9756-481a-bd2d-a73b29bd2503`).
- **open** — listDueAutomations: join buddies, require status='active'; re-assert status after createConversation (paused Buddies' automations currently still fire) (`todo_014dc26f-435b-472e-82a2-edfbabb6e7b6`).
- **open** — Delegate gate (isDirectReport) and review gate (manageable): canonical edge, exclude archived (`todo_495a1cec-6a04-4506-82e4-5577bb94eddf`).
- **open** — Move the self-delegation check into prepareDelegation so it holds on the in-process path (`todo_6b89b258-2611-4ad0-a089-b40e23c99c7a`).

## Document the -p orchestration constraint and clean up stale sessions

- Project: `buddy_project_7023cc14-9c47-43bf-a610-b85fb981c067`; revision 1; status **ready**.
- Owner: Buddies Development Lead.
- Recorded next action: Add the lifecycle note to AGENTS.md hard rules

- **open** — AGENTS.md: Buddy turns are claude -p; Workflow cannot survive a turn; use blocking Agent calls or orchestrate externally (`todo_8044bf3e-8e10-47fc-b500-ad1e0abc7afc`).
- **open** — Note the gotchas: spawned sessions need --model pinned (bare default is credit-exhausted); --add-dir is variadic and silently eats a trailing positional prompt (`todo_8c54a178-7512-48c4-b43f-5a07259d9318`).
- **open** — Stop the 5 stale background sessions (3 blocked, 2 done) (`todo_8c72276b-48f4-425d-a7f7-013b6187bb66`).

## The Lead has no memory path, so every journal and curated entry is lost

- Project: `buddy_project_31d73904-2352-44a4-8e3f-8f1f101fc5f3`; revision 1; status **blocked**.
- Owner: Buddies Development Lead.
- Recorded next action: Owner: provision the Lead's profile directory, or confirm which existing profiles/ slug it should bind to
- Recorded blocker: Owner action — provisioning a profile directory is not in the Lead's operation set, and writing it directly on the filesystem would bypass that boundary.

- **blocked** — Provision profiles/<slug>/BUDDY_SOUL.md and memory/ for buddy_d3f11f11 (`todo_0c618ca5-a2b1-41c6-883c-33327e393932`).
- **open** — Verify by writing a journal entry and reading it back in a fresh conversation (`todo_fcb717f4-d69f-4688-87ac-c73814b82eb7`).
- **open** — Make 'no memory path configured' distinguishable from 'memory empty' in the Buddy context block — today both render as 'No curated memory yet', which is a silent fallback (`todo_374e1feb-b311-4c34-a57a-cdf656ca6ca5`).
- **open** — Audit the other 15 buddies for the same gap before hiring adds more (`todo_a48b3d4d-e068-40f1-ab24-d8ddcb004486`).
- **open** — Feed this back into the hire design: hire provisions soul+memory in the txn precisely to prevent this, so the trap is confirmed real rather than theoretical (`todo_8e18abe5-03cb-46a1-8f19-ddaa15c11df0`).

## Minimal primitives: loops, schedules, goals, message passing — and the one missing wait

- Project: `buddy_project_8a1f69b7-7734-47bb-853b-cf36d065e346`; revision 1; status **ready**.
- Owner: Buddies Development Lead.
- Recorded next action: Owner decides Option A (loop-as-wait, free) vs Option B (blocking send). Design doc written 2026-08-21; nothing is implemented.

- **open** — GAP 1 (biggest): iterations are hard-capped at 10 and exhausting them THROWS. store.js:4423 Math.min(DEFAULT_AUTOMATION_MAX_ITERATIONS=10, planned) and the MIN(10,...) at :631; scheduler.ts:364 throws 'did not satisfy its termination condition'. 'Repeat until all tasks are done' on a real backlog fails rather than checkpointing. Make exhaustion a resumable checkpoint outcome, not an error. (`todo_5803566b-7cbe-4514-9713-c6a611cb78c6`).
- **open** — GAP 2: 'done' is self-reported and unverified. scheduler.ts:359 trusts parseAutomationCompletion(outcome).done — a bare boolean the Buddy emits. Unlike complete_assignment it requires no evidence. A Buddy can declare done having produced nothing. (`todo_d4ceb5a9-2b3d-42cc-ab96-db43badd72fc`).
- **open** — GAP 4: amnesia across runs. Within one run the conversation is reused, but scheduler.ts:273 createConversation makes a FRESH conversation per scheduled run. Continuity depends on buddy.remember, which currently throws for this Lead. Overlaps deferred todo_3c1e58c6 (wake an existing conversation) — that item is promoted by this direction, not deferred. (`todo_6d063e5e-1e55-44a8-b4e9-1704b94782d0`).
- **open** — BUG: parseAutomationCompletion (scheduler.ts:34-35) returns done:false when the JSON is malformed. A Buddy that genuinely finished but formatted badly is silently treated as unfinished, redoes the work, burns iterations, then fails the run. That is the silent fallback house rule T4 forbids — make it a typed error. (`todo_0c6afafa-cf38-4ba7-b336-6197c556c95b`).
- **blocked** — Blocked-by: request_review needs a 'reviews' relationship edge (operations.ts:767-773). The Lead has none, so review-before-finish cannot be exercised until buddy_project_36a70bf6 is unblocked. (`todo_8ae98ec2-be03-4c9f-a879-3175d9654d7b`).
- **open** — Confirm with the Owner that goal-scoped workers are ordinary Buddies running a loop automation, NOT a third lifetime between ephemeral and direct report (`todo_2eeb8e45-5cba-4eb8-8397-20f60b05a7e8`).
- **open** — OPTION A (free, today): the loop IS the wait. Request review in iteration N, poll get_inbox for the outcome in N+1, incorporate, continue. Zero new primitives — pure prose in termination.condition. Blocked only by the 10-iteration cap. (`todo_52fbaba5-90ea-408a-aa30-64e556666694`).
- **open** — OPTION B (new primitive): a generic blocking send that returns the reply. Feasible despite -p because MCP tool calls are request/response — the parent stays alive blocked INSIDE a tool call, not on a pending turn. The scheduler already proves the server can await a conversation turn (runBeforeDeadline). (`todo_a85a7708-b31c-473e-96ef-8295e90f38fe`).
- **open** — If Option B: deadlock is the real risk (A waits B waits A). Needs cycle/depth rejection in the write path, not a caller assertion — precedent exists, the store already cycle-walks relationships inside a #tx at store.js:1506. (`todo_02e05d9f-b848-4a80-b7e3-cfb3ee3f05ab`).
- **open** — If Option B: a blocking call must have a deadline, and for automation-driven callers the blocked child time counts against the parent's max_runtime_seconds. Specify both. (`todo_c337c5bb-9ccc-40a8-b56c-a66c98745b3e`).
- **open** — Consolidation candidate: collapse the 6 send/reply operations toward a generic send with an open-ended kind/purpose string. Large refactor — decide whether it precedes or follows the wait primitive; do NOT bundle silently. (`todo_48cb6793-af16-4add-88ab-8872cfd1b9bd`).

## Verify and land the @nbardy/buddies store layer for direct reports

- Project: `buddy_project_2bce3176-5b7c-4d67-982e-128c3d65df63`; revision 1; status **in_progress**.
- Owner: Buddies Development Lead.
- Recorded next action: Review the uncommitted store diff against design sections 5.1, 7.5, 8.1, 8.4, 9.3 — the only unverified gate before commit + vendor

- **in_progress** — Review uncommitted diff vs design: 5.1 pair-derived visibility (archiving a manager must not orphan active reports) (`todo_e53ec1bb-e298-4e9b-a324-e114e0e7a688`).
- **open** — Review: 7.5 countHeldDirectReports uses UNION not UNION ALL, joins buddies, excludes archived only (`todo_a05b8dde-ccef-4c5f-95d3-18caf91c5598`).
- **open** — Review: 8.1 quota assert present in vacant/reactivatable handlers, ABSENT in held (replay must survive lowered quota) (`todo_7a7399ed-bdbf-479f-8a19-97ee6a3a1743`).
- **open** — Review: 8.4 slug regex asserted before any filesystem work (slugify returns empty string for '...') (`todo_63edcdec-cf08-4eee-bbf4-d83f8e8d0c32`).
- **open** — Review: 9.3 held/reactivatable handlers verify and re-materialize a missing soul file (`todo_b170dee2-a4db-4b88-8caf-2a3531896755`).
- **open** — Commit store changes locally in ~/git/buddies (never push) (`todo_f8a84e6f-02f2-426e-b181-4393fb550f48`).
- **open** — Run pnpm vendor:buddies; verify sourceDirty:false and vendored md5 == source md5 (`todo_4fe5f481-87bd-4b86-9e5d-dbcde3942d84`).

## Delegation readiness: the Lead has no manager edge, so every delegate call is refused

- Project: `buddy_project_36a70bf6-8ebd-403f-af7f-99cfa346bd88`; revision 1; status **blocked**.
- Owner: Buddies Development Lead.
- Recorded next action: Owner decision: grant manager edges to existing buddies (unblocks delegation today, zero new code) or wait for the hire feature to land
- Recorded blocker: Requires an Owner action. Creating a manager edge or setting hire_quota is outside the Lead's operation set, and the HTTP/SQLite paths to both are bypasses of that boundary rather than alternatives to it.

- **blocked** — Owner: choose path A (manager edges to existing buddies, works today) or path B (land the hire feature first) (`todo_d04010ad-a29f-4d2b-a0c2-ad36be404ed2`).
- **open** — If path A: pick the working team from the 16 active buddies. Product Development Lead (buddy_e0527b5c) is the natural design/impl partner; Chief Scientist (buddy_b2ff0a7e) for review (`todo_5870ab82-6f8e-4fc4-8ffd-2dd8ab945ccc`).
- **open** — If path A: write ONE direction per edge. Live data already carries the dual encoding — growth-lead has both a 'manager' row to growth-operator and a 'reports_to' row back. Do not add more. (`todo_1650da0d-9d7c-4a02-8886-c7dcb96b16dd`).
- **open** — Fix the gate itself: operations.ts:743 and routes.ts:364 accept EITHER direction, which is what lets the dual encoding survive. Already tracked as a todo in the security-fixes project; note the dependency. (`todo_40a3e623-ac37-44f1-8fa6-a296e6961700`).
- **open** — Re-run the delegate probe after the edge exists and record the delegation id as evidence (`todo_a6a57282-f66d-45ae-bfe6-5fe4f4a80f73`).

## Overhanging uncommitted work across three trees — at risk of being destroyed

- Project: `buddy_project_5a090ee9-d90f-4531-a610-5015f22857fc`; revision 2; status **in_progress**.
- Owner: Buddies Development Lead.
- Recorded next action: Current owner has authorized tasks/background completion and repository preservation. Release child performs attributable current inventory and commits; the historical missing-origin blocker is resolved. Keep remaining artifact dispositions and stale-session proof open until individually evidenced.

- **open** — vendor/agent-cli-tool: 4 dirty harness files = the buddy-MCP boundary work, ~30% done. Blocked by the remote drift below. (`todo_6bbc033b-6a7d-4d69-91f8-397ebe8ac83e`).
- **open** — ~/git/buddies: 1,331 uncommitted lines, schema v13, node --test green (28/0). Commit locally, never push. This is the sprint critical path. (`todo_65873e19-0b73-40d0-b270-e1ce0052fbff`).
- **open** — unleashd: 5 untracked files (SPRINT_HANDOFF_2026-08-20.md, 2 turn-lifecycle docs, buddy-mcp-harness-boundary.md, buddy-mcp-partial.patch) plus 4 new docs written 2026-08-21 (`todo_e8fdfaf4-3a83-49b8-b08d-78c5b14e1688`).
- **open** — agent_notes/2026-08-20_buddy-mcp-partial.patch has NO diff hunks — only a '--- Changes ---' marker. Superseded by the dirty submodule? Reconstruct or delete; do not leave a fake patch on disk. (`todo_9a4e691a-f794-44eb-ab67-76af8f83aec4`).
- **open** — Stop the 5 stale background sessions (3 blocked, 2 done) — duplicated from buddy_project_7023cc14, close in whichever lands first (`todo_bdb6ec0c-b6f8-4d7b-b3d6-b32a4bc89144`).

## Complete remaining Buddy repairs, reconcile backlog and deliver verified commits

- Project: `buddy_project_37f2780f-f766-452b-991c-eb4ca4192a9b`; revision 12; status **blocked**.
- Owner: Buddies Development Lead.
- Recorded next action: Inspect preserved effects and arrange explicitly bounded fresh assignments before resuming the original UI/release work. Preserve historical failures, existing project criteria and stopped-root fences. The old wait-for-reliability-implementation blocker is superseded; do not retry the exhausted original requests.
- Recorded blocker: Historical coordinator and UI/release requests remain failed with max_runtime_timeout. The recovery implementation is now loaded, but native get_team_state on 2026-09-13T03:11:08Z reports no successor and remainingSeconds=0 for all three original work envelopes; retry is unavailable because original managed work limits are exhausted.

- **blocked** — Complete former-lead grant visibility and preserve permission drafts (`todo_9e25e4e6-eba4-45e2-8dfc-e80d6b48d46a`). Acceptance: UI child project completes native HTTP/MCP and browser acceptance, scoped commits and integration handoff.
- **in_progress** — Reconcile stale own projects and history validation (`todo_5e614365-dc9c-4c48-a328-5b00af26fb3e`). Acceptance: Own August and September open criteria compared with current source and dated evidence; revision-checked updates preserve unfulfilled criteria and decision history. Main-thread API history recovery and separate browser evidence are accurately distinguished; remaining exact browser check is performed if needed.
- **blocked** — Preserve and validate repository delivery (`todo_337452eb-c5e4-403e-bf74-0b6b8888b412`). Acceptance: Release child inventories shared/app/submodule/package changes and records attributable commits without destroying concurrent work; integration checks pass on final assembled snapshot; no main push.
- **blocked** — Return final review and evidence to the owner (`todo_f25710d1-9338-4062-963f-22bf4801f1e7`). Acceptance: Every preceding noncancelled todo carries concrete evidence; parent records final commits, behavior, tests and material unresolved limits; runtime delivers final disposition to original owner thread.

## Finish the composable Buddy system and MCP workflow

- Project: `buddy_project_545457c2-3c8a-4bc1-b792-702a6d3ffbb7`; revision 9; status **in_progress**.
- Owner: Buddies Development Lead.
- Recorded next action: Private/shared knowledge and A2/A3 repairs meet source-boundary criteria. Remaining actual work is live-provider setup/follow-up acceptance, the exact main-thread browser check in repair child f5e8e43a/UI child95592e35, and any separately requested external-mail account integration; no production roots revived.

- **open** — Run full checks and a live-provider setup/delegation/follow-up fixture (`todo_6593fd17-1ca3-4dfa-9099-4c8b3698502b`).
- **blocked** — Connect an identified mailbox through the tested effect adapter (`todo_417d60f5-ec35-405d-aba0-454224ff61dc`). Acceptance: An explicitly identified account/provider is registered through the adapter; authenticated production/MCP projections use its ledger and authority; exact demo-gated draft send and inbound/reconciliation are verified without credential bypass.

## Complete owner-to-team setup and operational readiness

- Project: `buddy_project_9864f34e-b435-43b1-80b1-07cc51645fbe`; revision 20; status **in_progress**.
- Owner: Buddies Development Lead.
- Recorded next action: A1–A7 are individually repaired and evidenced. The exact main7d9d117f browser check remains in repair child project f5e8e43a/UI child95592e35. Operational acceptance remains separate; preserve stopped production roots and require authorized live round-trip evidence.

- **blocked** — Validate discovery, idempotent dispatch and receipt inspection (`todo_07cb9fdf-09a9-4d6f-95ae-2e5faa41ceef`). Acceptance: Real MCP/runtime fixtures exercise permitted discovery, denied discovery, dispatch/acknowledgement and stable-key replay. Dated production assignments are rechecked within authorized scope and not recreated.

## Repair remaining Buddy history, privacy and consistency gaps

- Project: `buddy_project_f5e8e43a-9c69-4dd2-82d1-c6c953e3549b`; revision 8; status **in_progress**.
- Owner: Buddies Development Lead.
- Recorded next action: Live API recovery and natural backend adoption are proven by 10:12 API/10:13 browser evidence; perform the remaining read-only main7d9d117f browser criterion through UI child project buddy_project_95592e35-f568-4868-9a93-03c8a8511597, then reconcile this final todo.

- **open** — Verify live history and date after safe idle backend reload (`todo_4dc39b29-9dc8-4154-86d0-c4b999824f5c`). Acceptance: Running normal detail API/UI for conversation7d9d117f includes original Sep9 history and five-bug review, original createdAt, and newer session rows after watcher naturally adopts verified repair; preserve active provider operations.

## Separate setup, work admission and return diagnostics; resolve authorized workspace names

- Project: `buddy_project_19703c1b-e2ad-4499-adf5-7bb16b0b6fa9`; revision 1; status **ready**.
- Owner: Buddies Development Lead.
- Recorded next action: Design an additive diagnostic projection over canonical predicates; preserve privacy and existing payload compatibility. Reproduce Chief's reported ambiguity in isolated fixtures before implementing.

No todos recorded. Project acceptance: Preview and native readiness distinguish can-save configuration, can-start intended work and actual return delivery without unrelated old owner requests or the active human chat appearing as setup blockers. Owner-visible extra workspace prerequisites include authorized human-readable names; employee output never leaks unauthorized workspace metadata. Real boundary fixtures cover multi-workspace manager appointment, missing incoming work, busy background return, owner Mailbox-only return, old owner-directed request and restricted visibility. Current runtime adoption and any production team execution are evidenced separately.


## Expose former-lead grant revocation and preserve permission drafts

- Project: `buddy_project_95592e35-f568-4868-9a93-03c8a8511597`; revision 5; status **blocked**.
- Owner: Buddies UI Engineer.
- Recorded next action: Preserve the existing isolated snapshot. Await supported native timeout recovery from project buddy_project_f24b0cc3-e82e-40ab-b974-5f1bfc469950, then resume this same prepared project in bounded attempts with durable checkpoints before 600 seconds.
- Recorded blocker: Original managed attempt failed with max_runtime_timeout after 600 seconds and closed its request. Inspected native retry of the UI chain was refused with 'Request is no longer open'; all three original receipts are replied/failed. Resume only through a supported native recovery route after the existing reliability lane resolves/dispositions this case. No duplicate work chain created.

- **blocked** — Reproduce and repair saved-grant discovery/revocation for former leads (`todo_f3c4d46b-a43c-4388-a953-fe33d42854ab`). Acceptance: Actual owner route/UI covers archived grantee, detached grantee, and former-target controls; revocation preserves inactive membership and never widens permissions. Preserve generic archive protections outside this precise owner flow.
- **open** — Preserve dirty permission drafts across refetch and revision changes (`todo_32fa48cb-6aaf-467e-a8d6-0abf8da48562`). Acceptance: Browser demonstrates user edits survive background refresh/reconnect, stale submit reports conflict without silent overwrite, target switch/reset is deliberate, successful save reflects authoritative revision.
- **open** — Validate both shells and deliver scoped commits (`todo_5f5674a0-83e5-4aa2-b9f8-ea1b01f2c5eb`). Acceptance: Meaningful boundary tests, client tsc -b, server applicable typecheck and client invariant gates pass; browser evidence with deterministic fixtures; report changed files/commits and integration instructions; no forced restart or main push.
- **open** — Verify the restored original owner thread in the live browser (`todo_92aa7b2e-db85-4781-985d-1d8930b7c0e8`). Acceptance: Read-only browser inspection of http://unleashd.localhost/chat/7d9d117f-7a13-46e2-bf6a-95da591d6e2b confirms original Sep9 discussion/five-defect review plus newest rows, with dated screenshots/DOM observations. Existing main-thread API evidence and different aca48e0e browser evidence are distinguished. No chat input or forced restart.

## Preserve Buddy implementation and verify integrated delivery

- Project: `buddy_project_a2047be3-f8cb-4eed-ac2e-522e3831bee6`; revision 4; status **blocked**.
- Owner: Buddies Release Engineer.
- Recorded next action: Preserve the existing isolated snapshot. Await supported native timeout recovery from project buddy_project_f24b0cc3-e82e-40ab-b974-5f1bfc469950, then resume this same prepared project in bounded attempts with durable checkpoints before 600 seconds.
- Recorded blocker: Original managed attempt failed with max_runtime_timeout after 600 seconds and closed its request. Inspected native retry of the UI chain was refused with 'Request is no longer open'; all three original receipts are replied/failed. Resume only through a supported native recovery route after the existing reliability lane resolves/dispositions this case. No duplicate work chain created.

- **blocked** — Inventory and preserve current app, submodule and packaged source (`todo_620e8f67-c26a-4cc0-ac94-4c1b220dee65`). Acceptance: Record current hashes, branch/diff attribution, package archive/source/installed parity and local commit ancestry. Preserve current disk bytes; no blind git add -A or destructive shared-branch operations.
- **open** — Create attributable implementation commits and integrate repair handoffs (`todo_53e38fb3-f4ec-4fba-b761-6eac4cf6ddc5`). Acceptance: Use isolated branches/worktrees and explicit paths; app, package and agent-cli changes have coherent local commits with tests and preserved rationale. Submodule task branch may be pushed to its existing remote only as required for the documented pointer dance; never push main or publish/deploy. If isolated snapshot includes prior mixed source, label baseline separately from new repair commits.
- **open** — Verify the assembled application and return delivery evidence (`todo_5a8863b6-1ba4-4ab6-9abe-4717d411eb56`). Acceptance: Appropriate full boundary suite, shared/server/client typechecks, client invariant gates and package/build verification pass on the assembled source; exact command results and limitations recorded. Existing live history evidence is reconciled without inventing new production or external mailbox success.


