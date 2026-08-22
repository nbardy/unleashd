# Sprint Board — 2026-08-21 — product / design / engineering

*Branch: `mobile-fixes-and-audit-2026-08-18` · Prepared by: Buddies Development Lead*
*Supersedes the lane table in `product/SPRINT_HANDOFF_2026-08-20.md` §4 (that doc's §5-§9 remain
current and are not duplicated here).*
*Authoritative state lives in Buddy projects — **14 projects**, workspace `unleashd`. This file
is the human-readable split, not a second source of truth.*

---

## 0. What changed on 2026-08-21

Four claims in the 2026-08-20 handoff were **verified false** against the working tree. The
store layer is far more advanced than that document says:

| 2026-08-20 claim | 2026-08-21 reality |
|---|---|
| "0 matches for `hireDirectReport`" | **28 hits** in `~/git/buddies/src/store.js` (`:3767`, `:4130`, `:1456`, `:3679`) |
| "vendor tests red, 24/3" | **28 pass, 0 fail** |
| "B2 open — nested txn unsolved" | **closed** — `#tx` with depth-named SAVEPOINTs, `store.js:949`, 8 call sites |
| "schema 13 vs 12 is a discrepancy" | **not drift** — `fc7751a` shipped v12 with a nullable `hire_quota`; v13 is the correction rung. Field DB confirms: `user_version=12`, 16/16 NULL. |

Root cause of all four: reading committed `fc7751a` instead of the **working tree**, where
1,331 uncommitted lines live. *Always `git status` + `git diff --stat` in `~/git/buddies` before
claiming anything is unimplemented.*

---

## 1. PRODUCT — decisions only the Owner can make

None of these are code. All of them change how the other two columns execute.

| Project | Decision needed | Blocking |
|---|---|---|
| Delegation readiness | Grant `manager`/`reports_to` edges to a working team, **or** wait for hiring to land. The Lead has **zero** relationship rows, so every `delegate` and `request_review` is refused. Verified by probe. | Everything involving more than one Buddy |
| Lead memory path | Provision `profiles/<slug>/BUDDY_SOUL.md` + `memory/`. `buddy.remember` throws `Buddy has no configured memory path`. | Cross-run continuity; all durable handoff |
| Vendoring strategy | Give `~/git/buddies` a remote (→ submodule) or stay on tarball vendoring. Drives the cost of every store change. | Store lane ergonomics |
| Wait primitive | Option A (loop-as-wait, free) or Option B (blocking send, new primitive). | Design lane |
| Operation consolidation | Collapse the 6 send/reply ops toward a generic send with an open-ended purpose string — before the wait, after it, or never. | Design lane |
| AI-OS | Pick the canonical repo; decide whether it shells out to `agent-cli`. | Nothing — parked |
| Deferred backlog | Triage 4 items: capability containment, spend enforcement, resource caps, conversation wake. | Nothing — but **conversation wake is promoted** by the goal-loop direction |

**Recommended order:** relationship edges first. They cost one decision and unblock the largest
number of downstream items.

---

## 2. DESIGN — specified, not yet code

| Project | State | Next |
|---|---|---|
| Minimal primitives + the wait | Principle locked, mechanism proposed | Choose Option A or B (product decision above) |
| Ephemeral sub-agents | **Collapsed** — 4 of 6 todos cancelled. Sub-agents are a harness capability; no op, no schema, no depth rule. | Write ~2 paragraphs into `PLANNING_SUB_BUDDIES.md` |
| Work graph (task links, team membership) | Designed in the DoD, deliberately parked | Do not start until direct reports lands |

Design output from this session:

* `agent_notes/2026-08-21_buddy-automations-reference.md` — the automation system as built
* `agent_notes/2026-08-21_primitives-and-the-wait-design.md` — the wait, Options A/B
* `product/PLANNING_BUDDY_PRIMITIVES.md` — intent + locked decisions

---

## 3. ENGINEERING — ready to write code

**Critical path (one item, gates three lanes):**

| Project | State |
|---|---|
| Verify + land the store layer | `in_progress`. Tests green, B2 closed, schema explained. **Remaining: five design-section reviews (§5.1, 7.5, 8.1, 8.4, 9.3), then commit + `pnpm vendor:buddies`.** |

**Parallel, unblocked:**

| Project | Todos |
|---|---|
| Security fixes direct reports depend on | 4 |
| Document the `-p` orchestration constraint | 3 (fold in the sub-agent blocking + attribution notes — one doc line, not three) |

**Blocked behind the store layer:**

| Project | Todos |
|---|---|
| Server layer: ops, allowlist sum, profile route | 6 |
| Client layer: delete `deriveBuddyHierarchy` | 7 |
| Test suite: 16 cases, one fixture | 7 |

---

## 4. OVERHANGING ENGINEERING — uncommitted work from earlier sessions

This is the part most at risk. Concurrent sessions in this repo have destroyed uncommitted work
before, and **none of the following is committed anywhere.**

| # | Where | What | Risk |
|---|---|---|---|
| 1 | `vendor/agent-cli-tool` | **4 modified files** (`src/harnesses/{claude,codex,opencode}.ts`, `src/types.ts`) — this is the buddy-MCP harness-boundary work, *"~30% done, uncommitted"*. Fixes a real bug: a `muse` buddy had the context header but **no `unleashd_buddy` tools** and silently shelled out to the CLI. | High — submodule rule says commit inside first, then bump the pointer |
| 2 | `~/git/buddies` | **1,331 uncommitted lines** implementing direct reports, schema v13. Tests green. | High — the entire store lane |
| 3 | `unleashd` working tree | 5 untracked files: `SPRINT_HANDOFF_2026-08-20.md`, 2 turn-lifecycle docs, `buddy-mcp-harness-boundary.md`, `buddy-mcp-partial.patch` | Medium |
| 4 | — | **Resolved 2026-08-22:** `agent_notes/2026-08-20_buddy-mcp-partial.patch` had no diff hunks, was superseded by the dirty submodule, and was removed | Closed |
| 5 | — | **5 stale background sessions** (3 blocked, 2 done) never stopped | Low |
| 6 | `.gitmodules` | Remote drift: says `nbardy/agent-cli.git`, but the checkout has only `legacy-origin -> nbardy/nbardy-agent-cli.git`, no `origin` | Blocks item 1's push step |

**Nothing here has been committed, because the Owner has not asked.** Item 6 blocks item 1;
item 2 is the critical path's final step.

---

## 5. First moves

1. **Owner:** grant relationship edges (§1) — one decision, largest unblock
2. **Eng:** the five store-layer design-section reviews, then commit + vendor
3. **Eng, parallel:** security fixes; fold the `-p` + sub-agent constraints into one doc line
4. **Overhang:** decide the fate of §4 items 1-6 before another session overwrites them
