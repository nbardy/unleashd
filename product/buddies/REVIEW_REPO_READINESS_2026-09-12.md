# Repository and Buddy readiness review — 2026-09-12

Observed at 2026-09-12 13:30:32 UTC. Requested by the owner in conversation `7d9d117f-7a13-46e2-bf6a-95da591d6e2b`. Review by Buddies Development Lead with independent git, documentation and runtime-test reviewers. This is a dated evidence snapshot; native projects and receipts remain authoritative for work status.

## Assessment

The core Buddy system is implemented and has substantial boundary-test evidence. It is not fully committed, the remaining privacy/consistency audit is open, and production Wave_sim has not completed a successful lead round trip. The apparent contradiction between “implemented” and “not built” comes partly from stale documentation and August work records.

There is no evidence-based reason here to start another architecture redesign. The recommended sequence is to close the remaining defects, reconcile delivery evidence and current guidance, preserve the work in attributable commits, then prove one bounded production round trip before substantive Wave_sim work resumes. These are assistant recommendations, not a newly accepted owner decision.

## Review coverage

Inventory: 218 local repository Markdown files, 32,173 lines: root 4; docs 35; product 28; agent_notes 144; client 1; oompa 6. Excludes dependencies, build output, vendored documentation, cache material, worktrees and private identity/memory snapshots.

All categories were inventoried and status/header/checkbox statements scanned. Current Buddy contracts, implementation/audit successors and relevant September 10–12 decision notes received detailed review, with selected source comparisons. This is not a claim that every historical document received a complete line-by-line implementation audit. The three REDESIGN documents and unselected REFLECTION alternatives are historical evidence, not three additional pending builds.

## Git and package delivery

Counts below precede this review artifact.

| Tree | Commit | Uncommitted state | Remote status |
| --- | --- | --- | --- |
| unleashd, refactor/reduce-sprawl-2026-09-06 | 1187a8b6660b95c0c60bd8fada105f015b98cc39, September 9 | 116 modified; 9 deleted; 225 untracked; nothing staged | 3 ahead of locally recorded upstream |
| vendor/agent-cli-tool, main | 3135ac5 | 9 modified; 4 untracked; nothing staged | 1 ahead of locally recorded origin/main |
| Packaged Buddies source, codex/resource-repair-20260912 | 234ff0f681d3f8ede511f048f74d632f23a3f49d | Clean | No remote; 18 commits beyond local main |
| ~/git/buddies, main | 8426319 | 8 modified; 6 untracked | No remote |

No fetch was performed, so ahead counts use local remote-tracking refs. The app's tracked changes alone span 125 paths and include substantial source/test work: team setup, coordination, background execution, scoped memory, reviewer integration, resource consolidation, history recovery, prompt fixes and both UI shells. An outer commit cannot capture uncommitted submodule contents. The outer pointer already equals 3135ac5.

The installed package is internally consistent: all 25 archive files match clean source commit 234ff0f in `/Users/nicholasbardy/git/.codex-worktrees/buddies/resource-repair-20260912`, and installed package bytes match the archive. Archive SHA256: `2cbb98805d5281fa08d7a5d07bcb8599f0773c38f0fe11aa10bc87099cde07ba`. The outer archive/provenance/lockfile are uncommitted.

The default vendoring source still points at old dirty `~/git/buddies`; use the verified source worktree explicitly when packaging. Do not bypass the dirty-source guard.

## What remains

The Lead's native board contained 31 projects before this audit record: 13 done and 18 open (6 backlog, 5 ready, 3 blocked, 4 in progress). Most older direct-report/store/client/security entries date to August and mix superseded quota assumptions with work now implemented. They require reconciliation against current evidence; the raw open-project count is not an estimate of unfinished engineering.

Current repair project: `buddy_project_f5e8e43a-9c69-4dd2-82d1-c6c953e3549b`.

| Finding | Evidence-based status |
| --- | --- |
| A1, rotated display history/date | Implemented and regression-tested; live recovery acceptance remains separately open |
| A2, private execution errors in capability/readiness receipts | Open, highest-priority remaining defect; source remains identical to the audited version |
| A3, unrelated changes rotating provider context | Implemented in package 234ff0f with runtime and authority tests |
| A4, deletion during asynchronous linking/admission | Open provisional finding; combined production-path reproduction/disposition still needed |
| A5, different note-size enforcement paths | Open |
| A6, advertised regex recall unsupported in scoped implementation | Open |
| A7, current send/wait documentation uses obsolete arguments | Open |
| Live reload/adoption and normal UI history | Not established by source/package tests |

The original R1–R5 resource findings and two earlier adjacent variants have dedicated repair evidence. Their historical reports must not be mistaken for current unfixed defects. Mailbox integration remains separately blocked on an identified account/provider and an authorized effect scope. The tested generic adapter is not a connected customer inbox.

## Leader autonomy

Implemented behavior: a reporting line grants ordinary work supervision. Workspace `staff.create` grants allow creation; exact-target `relationship.write` grants allow attaching/reparenting existing staff. No hiring quota remains. `createdBuddyIncoming:true` on staffing permits a new hire to receive work and its creator to manage that hire's execution. New hires do not automatically receive onward staffing or schedule authority. Private documents are independently authorized.

The owner-native configure_team surface is available in this conversation and reports contract 2026-09-10.4. A preview can inspect exact proposed changes without committing them.

A concrete preview for the Wave_sim CEO, Project Lead, Product Lead, Go to Market Lead, Wave Simulation Lead and Frontier Research Lead found all six workspace staffing grants absent (`before:null`). Thus creation autonomy is supported by code but not currently configured for those leaders. Preview key `wave-leaders-staffing-20260912-v1` proposes six `staff.create` grants with `createdBuddyIncoming:true`; it was not applied. Exact-target access for reorganizing existing staff must also be inspected when choosing that concrete roster. This review did not create or reparent employees.

## Live Wave_sim evidence

Read through native owner tools in workspace `project_88cdc98e-13d1-426a-9544-7e7830a2b5c6`. Employee discovery in the Unleashd scope does not list Wave_sim; owner-scoped reads do. No HTTP/database/CLI bypass was used.

CEO and all five leads are active with incoming work and dispatch enabled. A no-change membership preview returns zero effects and no queued runs for the inspected participants. This establishes configuration, not a process heartbeat.

The five original assignment receipts remain terminal: one cancelled Project Lead retry and four failed functional-lead starts. Every receipt has null acknowledgment/acceptance and no completion evidence. The original creation error is empty `creation.initialMessage`; the cancelled retry records a missing destination conversation. These are old attempt outcomes, not a fresh reproduction against the latest source.

CEO recovery project `buddy_project_ea92d9ed-f5e3-4f93-b1f9-d9fad54ebbc4` remains blocked by the owner's earlier stop on patching and live probes. Board-report project `buddy_project_0844a2d3-eebe-4051-9c5e-95023235c902` remains blocked until native team execution is verified. This review issued no work messages, retries or launches and did not revive stopped roots.

The saved work is concrete:

- Product: make the editor trustworthy, establish source identity and select a truthful demo.
- GTM: five-market research, prospect qualification and unsent interview drafts.
- Simulation: reconcile engine/source evidence and specify one bounded numerical next step.
- Frontier: select one physically explicit hypothesis and the cheapest falsifier.
- Dependent work: authored-pool simulation and theory integration remain gated on actual assets, selected numerical baseline and evidence.
- Outreach: reviewed demo videos and an identified usable inbox are still missing prerequisites.

The next useful production acceptance is one newly authorized repository-only lead → worker → evidence → lead round trip through the real creation boundary, preserving old stopped attempts. Only actual admission, acknowledgment, deliverable and return receipts justify saying the team has started. A request to clarify whether this turn should lift the prior probe hold remains separate from the read-only audit.

## Documentation contradictions to reconcile

- `product/README.md`: owner setup “not yet shipped,” despite its implementation contract.
- `DESIGN_TEAM_OPERATIONS.md`: unshipped-successor wording and older schema/tool/memory descriptions.
- `DESIGN_BUILDER_TEAM_SETUP.md`: owner setup “not yet implemented.”
- `REVIEW_SYSTEM_SURFACE_2026-09-10.md`: introductory unshipped-owner-controls claim needs a dated successor pointer.
- `PLANNING_PRIMITIVES.md`: old send/wait shape and blanket recipient hiring prohibition; current code uses stable keys, typed delivery and grant-checked creation/relationships.
- `PLANNING_MEMORY.md`: older soul-tool section conflicts with its newer document-resource introduction.

Preserve historical bodies and decisions. Update living entry points and append explicit successor links; do not erase older evidence or treat unselected proposals as delivery commitments.

## Fresh verification and limits

14/14 existing focused boundary tests passed across team access, Builder Wave_sim setup, owner authority, owner runtime, held-run recovery, background runtime and resource consistency. They cover configure → worker continuation → evidence-backed completion → restricted lead return. Providers in these tests are fixtures; no new live-provider claim is made.

No source repair, configuration apply, commit, push, forced restart, employee dispatch or external action was performed in this audit. Previous broad-suite counts are historical evidence, not rerun results.

## Historical source anchors

The sibling evidence JSON records hashes of current reports, source and this report, plus the exact live receipts and preview decisions. Important prior sources:

- [Owner setup implementation](../../agent_notes/2026-09-10_owner-team-setup-implementation-handoff.md).
- [Shared-resource implementation](IMPLEMENTATION_RESOURCE_CONSOLIDATION_2026-09-11.md).
- [Resource repair](IMPLEMENTATION_RESOURCE_REPAIR_2026-09-12.md).
- [Seven-finding audit](AUDIT_HISTORY_AND_RESOURCES_2026-09-12.md).
- [History/continuity repair](IMPLEMENTATION_HISTORY_REPAIR_2026-09-12.md).
- [Prompt-placement repair](AUDIT_PROMPT_PLACEMENT_2026-09-12.md).
- [Wave_sim creation incident](REVIEW_WAVE_SIM_CREATION_FAILURE_2026-09-11.md).

