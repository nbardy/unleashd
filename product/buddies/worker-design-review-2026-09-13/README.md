# Buddies and Workers: current design and decision history

September 13, 2026. Prepared for the owner by Buddies Development Lead.

**Start with [the integrated final design](07-final-design.md).** It incorporates
ordinary note files, lean directed Mail, common Buddy/Worker memory, four core
objects and the complete execution/supervision proposal. No historical addendum
is needed to interpret it. The [meta-reflection](11-meta-reflection.md) records
what remains weak or unproven.

The owner selected the information simplification and shared context convention.
Exact execution mechanisms, timings and further deletion candidates remain
assistant recommendations. Runtime implementation has not begun in this task.
V1, v2 and the owner correction remain unchanged historical artifacts.

| Artifact | Purpose |
|---|---|
| [Final design](07-final-design.md) | Self-contained current architecture, files/Mail/memory, lifetimes, reporting, review, limits and migration |
| [Final MCP contract](08-final-mcp.md) | Complete 21-tool union, 8/14 profiles, exact Prompt/Report and Mail attention semantics, privileged/internal surfaces |
| [Final implementation/removal map](09-final-implementation.md) | Full package/server/client/context/memory touchpoints, explicit deletions and delivery gates |
| [Shared context](10-shared-context.md) | Exact common notes/lean-Mail block, activation placement and behavioral cases |
| [Meta-reflection](11-meta-reflection.md) | Whole-system critique, corrections, unresolved implementation evidence and next simplification candidates |
| [Owner correction](06-files-mail-memory.md) | Historical acceptance of four-tool deletion, ordinary notes and common Worker memory |
| [V1](01-v1.md) | First complete pass, preserved unchanged before reflection |
| [Reflection](02-reflection.md) | Twelve concrete problems and the changes required of v2 |
| [V2](03-v2.md) | Five product objects, Worker differences, execution/report/review lifecycle, limits, UI and acceptance |
| [V2 MCP contract](04-mcp-contract.md) | Historical 25-tool contract; retained execution/report semantics, superseded knowledge tools and counts |
| [V2 code and removal map](05-code-and-removal-map.md) | Historical implementation proposal before the file/Mail simplification |
| [Source index](source-index.md) | Clickable source references with preserved historical excerpts and hashes |
| [Initial evidence](source-evidence.json), [addendum](source-addendum.json) | Dated source/catalog/package observations, independent of future edits |
| [V2 verification](verification.json) | Historical artifact consistency/link checks and their limits |
| [V2 artifact manifest](artifact-manifest.json) | Historical v2 document hashes, including the previous README, and frozen-v1 verification |
| [Correction verification](files-mail-verification.json) | Historical correction checks and hashes, including previous entry points |
| [Pre-correction snapshot](files-mail-before.json) | Previous current-design entry points and hashes, preserving the superseded description |
| [Final source evidence](final-source-evidence.json) | New context, reviewer, readiness and package inspection with dated hashes/excerpts |
| [Closeout source evidence](final-closeout-source-evidence.json) | Concurrent package/runtime changes observed during final verification; original captures remain intact |
| [Frozen review input](final-review-input.json) | Full integrated design before meta-reflection fixes; previous entry points preserved |
| [Final verification](final-verification.json) | Current artifact hashes, counts/links/context consistency and preserved history checks |

The central changes are one execution command (`prompt`), one atomic reporting
command (`report`), Task-owned completion, Worker-owned identity/context, and
host-owned supervision. The new protocol stops using an open message as the
execution and accounting root. Internal request/session/account state remains
explicit; no new Assignment, Batch, Report or Review product is needed.

The revised employee union has 21 tools: Worker 8, lead 14, and 7 additional
administrative/diagnostic tools. V1 had 30; v2 had 25. The four-tool deletion is
owner-selected; the retained tool shapes and privileged authorization proposal
remain assistant recommendations. Counts do not establish measured savings.

The original review used package source commit
`b70c0def1373034aeff56e409adb97d66ff6d7f7`. At closeout the installed package had
advanced to `03638bdbcf778a63de22b227aa76099b0f1c8761`; all 13 installed source
files match its vendored archive. Foreground-capacity separation is now visible
in that source. The original baseline and excerpts remain historical evidence;
the [implementation map](09-final-implementation.md) records the changed baseline
without claiming loaded-runtime adoption or a test pass in this design task.
No live database was opened, staff dispatched, schedules enabled, runtime source
changed, tests represented as run, commits created or deployment performed.

Native project `buddy_project_98f532e7-27b7-4260-8243-56fdeda3eac9` owns this
design work's criteria and evidence. Prior owner direction is preserved in the
existing final-design successors and the scoped append-only decision notes.
