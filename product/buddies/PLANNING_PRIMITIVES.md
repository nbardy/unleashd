# PLANNING_BUDDY_PRIMITIVES.md — minimal primitives for Buddy coordination

*Date: 2026-08-21 · Status: intent locked, mechanism proposed · Owner: repo owner*
*Companions: `agent_notes/2026-08-21_primitives-and-the-wait-design.md` (design),*
*`agent_notes/2026-08-21_buddy-automations-reference.md` (as-built reference)*

## 1. Goal

Buddies coordinate through a **small, open-ended** set of primitives. Anything specific — a
review, an approval, a sign-off, a QA pass — is expressed by *composing* those primitives and
naming the intent in prose, never by adding a type, an operation, or an enum variant.

## 2. The primitive set

| primitive | status today |
|---|---|
| **Schedules** (`cron`, `interval`) | ships |
| **Loops** (`job_kind: loop`) | ships in code; **never run in production** |
| **Goals** (`termination.condition`, free text) | ships |
| **Message passing** (async: dispatch, reply lands in an inbox) | ships |
| **The wait** (send and block for the reply) | **missing — the one real gap** |

## 3. Decisions (locked)

| Topic | Decision |
|---|---|
| **No review type** | "Review" is a category/description, open-ended. It must never appear as a variant in a sum, an enum, or a dedicated termination kind. A proposal to add `{kind:'review_passed'}` was made and **withdrawn** on 2026-08-21. |
| **Categories pass through** | Intent travels as an open-ended string, consistent with the existing hard rule that provider-bespoke values pass through verbatim as `z.string()` with no shared enums. |
| **Sub-agents are a harness capability** | A Buddy asks for them in prose; `claude`/`codex` spawn them. No operation, no schema, no depth rule, no quota. Two caveats: they must be **blocking** calls (`Workflow` dies at turn end), and they act with the **parent Buddy's identity**, so audit attribution is coarse. |
| **No third Buddy type** | Goal-scoped workers are ordinary Buddies running a `loop` automation. Do not invent a lifetime between "ephemeral sub-agent" and "direct report". |
| **Reviewer identity is already solved** | `delegate` creates a fresh conversation for a real Buddy with its own soul and memory. "Reviewer with personality, memory, and fresh context" needs no new work — only the wait. |
| **Hiring is not required for review** | The reviewer is an existing Buddy. This whole line of work is independent of `hire_direct_report`. |

## 4. Non-goals

* A review workflow engine, a state machine, or reviewer-assignment logic.
* A generic RPC layer between Buddies. The wait is one primitive, not a framework.
* Bundling the operation-surface consolidation (6 send/reply ops → ~2 generic ones) with the
  wait. Related, separately decided.

## 5. Why this is lean

The specific capability the Owner asked for — *"run a sub buddy and wait; we just want a review
with a fresh context; nice if the reviewer has a personality and memory"* — decomposes entirely
into things that already exist **plus one wait**:

* fresh context → `delegate` already creates a new conversation
* personality + memory → the target is a real Buddy with a soul and `memory/`
* repeat-until-done → `job_kind: loop` with a goal
* on a schedule → `schedule_kind`
* **wait for the reply → missing**

No new noun. No new table. No new lifetime.

## 6. Known gaps this direction inherits

* **Iterations cap at 10 and *throw* on exhaustion**, so "repeat until all tasks are done" fails
  rather than checkpointing. Must become a resumable checkpoint.
* **`done` is self-reported** with no evidence requirement, unlike `complete_assignment`.
* **Malformed completion output silently reads as `done:false`** — a silent fallback that makes a
  finished Buddy redo its work.
* **No continuity across scheduled runs** — each run gets a fresh conversation, so memory is the
  only carrier, and provisioning it is currently broken on the Lead itself.
* **Spend is not enforced.** `tokens_used`/`cost_usd` are zero across all 22 historical runs.

## 7. Blocked on the Owner

Nothing here is exercisable until relationship edges exist. `delegate` requires a
`manager`/`reports_to` edge; `request_review` requires a `reviews` edge. The Buddies Development
Lead has **zero** rows in `buddy_relationships`, so every dispatch is refused.
