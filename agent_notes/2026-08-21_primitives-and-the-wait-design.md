# Design: minimal primitives, and the one missing wait

**Date:** 2026-08-21 · **Status:** design proposed, NOT implemented, NOT accepted
**Decision owner:** repo owner · **Prepared by:** Buddies Development Lead
**Companions:** `agent_notes/2026-08-21_buddy-automations-reference.md` (how the system works
today), `product/buddies/PLANNING_PRIMITIVES.md` (product intent + locked decisions)

---

## 1. The principle (Owner, 2026-08-21)

> Do not build a specific "review type." Review is a **category / description**, open-ended.
> We want loops, crons, goals, and message passing. Specific things sit **on top of** minimal
> tools.

This reverses a proposal made earlier the same day in this thread. That proposal was:

```ts
termination: {kind:'self_reported'} | {kind:'review_passed', reviewerBuddyId}
```

**Withdrawn.** Baking `review` into the type invites `approval_passed`, `tests_passed`,
`owner_signed_off`, and so on forever — a sum that grows without bound, which is a god-switch
wearing a type. The branching it encodes is *policy*, and policy is data.

The repo already had this rule and the buddy layer was violating it. From the hard rules:

> Provider-bespoke values (effort levels etc.) pass through verbatim as `z.string()`; no shared
> enums, no value translation, server-side defaults.

## 2. The operation surface is a shared enum wearing six function names

14 buddy operations exist. **Six of them are one shape** — *send to a party, get a reply later* —
split by hardcoded category:

| category | send | reply | close |
|---|---|---|---|
| delegation | `delegate` | `complete_assignment` | `complete_delegation` |
| review | `request_review` | `submit_review` | — |
| approval | `request_human_approval` | *(human)* | — |

Under the principle in §1 this should trend toward a generic send with an **open-ended
`purpose`/`kind` string**, with "review" appearing nowhere in a type.

**This is a large refactor and is deliberately NOT bundled with the wait primitive below.**
Sequencing is an open decision (§7).

## 3. What already exists (do not rebuild it)

`delegate` **already** provisions exactly the reviewer the Owner described — *"a sub buddy where
the reviewer has a personality and memory"*, with fresh context:

`routes.ts:419-444` calls `createConversation` for the target `buddyId` — a real Buddy, with its
own `BUDDY_SOUL.md` and `memory/` — on a **new** conversation with a clean initial message.

So "reviewer with personality, memory, and fresh context" is not a feature to design. It ships.

## 4. The gap: nothing in the system blocks

`routes.ts:445-449` binds the child conversation and immediately returns `201`:

```ts
const active = buddies.bindDelegationConversation(delegation.id, {...});
res.status(201).json({ delegation: active, conversation: conversation.toJSON() });
```

It never awaits completion. Every inter-Buddy path is an **async mailbox**; results surface
later through `get_inbox` (`delegationOutcomes`, `reviewOutcomes`). There is no send-and-wait
anywhere.

That single missing primitive — the **wait** — is the whole feature.

## 5. Two ways to get it

### Option A — the loop IS the wait (free, zero new code)

A goal loop already re-enters. Iteration *N* dispatches and asks for a reply; iteration *N+1*
reads `get_inbox`, finds the outcome, incorporates it, continues. The polling **is** the
blocking.

* No new primitive, no new type, nothing named "review" in code — purely prose in
  `termination.condition`.
* Composes exactly as §1 demands.
* **Cost:** each wait burns an iteration, and iterations are capped at 10 and *throw* on
  exhaustion (see reference doc §7). Option A is not viable until that cap is fixed — but that
  fix is needed regardless.

### Option B — a generic blocking send (new primitive)

Make the send not return until the child reaches a terminal state, returning its reply.

**Feasible despite `-p`.** MCP tool calls are request/response, so the parent stays alive
*blocked inside a tool call* — not on a pending turn, which is the thing `-p` terminates. The
server already awaits conversation turns (`runBeforeDeadline` in the scheduler), so the
machinery exists.

Two things must be specified before building it:

1. **Deadlock.** A waits on B waits on A. Rejection belongs in the write path or as a
   constraint, **not** a caller-side assertion — the relationships route already proved callers
   get bypassed. Precedent exists: the store cycle-walks relationships inside a `#tx`
   (`store.js:1506`, "the cycle walk and the insert are one write").
2. **Deadlines.** A blocking call needs its own deadline, and for automation-driven callers the
   blocked child's elapsed time must count against the parent's `max_runtime_seconds`. The
   harness may also impose a shorter tool timeout — that ceiling has not been measured.

## 6. Recommendation

**Do Option A first.** It costs nothing, and it answers the question Option B cannot answer in
the abstract: *is poll-granularity waiting actually annoying in practice?* If it is, Option B
becomes a small, well-scoped addition informed by real ergonomics rather than a guess.

This also keeps the §2 consolidation a separate decision instead of getting smuggled in.

Caveat carried from the reference doc: `loop` has **never run in production** (10/10 live
automations are `cron` + `prompt`). Option A would be its first real exercise, so run it on
something small and disposable.

## 7. Open decisions for the Owner

| # | Decision |
|---|---|
| 1 | Option A first, or go straight to the blocking primitive? |
| 2 | Does the 6→2 operation consolidation precede the wait, follow it, or not happen? |
| 3 | Relationship edges. `delegate` needs a `manager`/`reports_to` edge (`operations.ts:743`) and `request_review` needs a `reviews` edge (`operations.ts:767-773`). The Lead has **zero** rows in `buddy_relationships`, so none of this is exercisable today. |

## 8. Related, deliberately separate

* **Ephemeral sub-agents are a harness capability, not an operation.** A Buddy asks in prose
  ("use sub agents") and the harness spawns them. No op, no schema, no depth rule, no quota.
  Two caveats only: they must be **blocking** calls (`Workflow` is killed at turn end), and they
  act with the **parent Buddy's identity**, so audit attribution is coarse. That is an
  *attribution* limit, not privilege escalation.
* **Goal-scoped workers are not a third Buddy type.** They are ordinary Buddies running a `loop`
  automation. Do not add a lifetime between "ephemeral sub-agent" and "direct report."
* **Waking an existing conversation on a schedule** (previously deferred) is **promoted** by this
  direction: `scheduler.ts:273` creates a fresh conversation per run, so "repeat until done"
  loses context across run boundaries.
