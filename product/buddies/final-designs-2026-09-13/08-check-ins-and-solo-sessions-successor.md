# Frequent check-ins and maximum solo work sessions — successor

September 13, 2026 · Buddies Development Lead · Owner conversation
`89d40447-9d68-4b53-9688-67c154dbfae2`.

## Owner source and attribution

> and os yea maybe its not quiet "budget" but like "time until required report back in or someting? Maxiumu solo work essison, but also we want workers to check in more frequently as well

The owner proposes a supervision framing and requests frequent check-ins as
well as a maximum solo work session. The exact labels, timing mechanics,
notification handling and any example numbers below are assistant recommendations,
not an owner-selected schema or numeric policy. No runtime change is implied.

## Decision and rationale

The earlier [handoff successor](06-handoff-and-limits-successor.md) established
report, lead review, then resume the same Worker, replan/split or stop. The
[Worker successor](07-workers-mail-and-prompt-successor.md) separated Worker
identity from individual tasks and provider processes. Both still hold.

What changed: calling the boundary a budget blurred supervision with resource
consumption, and a single end-of-session report would leave the lead without
updates while work was underway. The consolidated
[policy reference](../BUDGETS_AND_LIMITS.md) now distinguishes a check-in interval
from a maximum solo work session. It retains resource constraints separately.

Assistant recommendation: routine updates allow ongoing work; required review
pauses it until the lead makes an explicit continuation, replan or stop decision.
A progress update cannot reset the session. Report blockers, repeated failures,
material scope growth and completion early. Overdue check-ins should be visible;
runtime observations cannot pretend to be Worker-authored progress. Coalesce
routine notices while retaining decision requests, so frequent reporting does
not require an equally frequent lead model turn.

Illustration only: updates every 5 minutes and required review after 30 minutes.
The numbers are unselected. Exact clock rules, safe reporting around long tools,
overdue escalation and resumption mechanics remain implementation proposals in
the single policy reference; this historical record is not another policy source.

Alternatives: only report at expiry, which delays intervention; pause for every
update, which adds avoidable management waits; or automatically extend on every
update, which allows endless solo work through reassuring messages. Separate
obligations preserve momentum and make required review meaningful. Tradeoff:
reporting has overhead, and clock semantics must remain understandable through
long tools, retries and waits.

Revisit cadence or escalation using evidence of reports interrupting useful work,
late detection of loops, missed updates during legitimate tools, or leads unable
to act on decision reports. A liveness receipt alone cannot settle work quality.

## Pinned predecessor evidence

Uncommitted sources read at `2026-09-13T05:06:44.901605+00:00`; hashes identify
the full versions and the relevant excerpts are preserved here:

| Source | SHA-256 | Relevant preserved excerpt |
|---|---|---|
| BUDGETS_AND_LIMITS.md | `7fef62391c5c0a44a1fb54e107423b58b350009f7d276f33df267a48fb8efd54` | “Give a sub-buddy a clear amount of work before review.”; “an ordinary informational progress report can leave the current slice running.” |
| LATEST_HUMAN_DESIGN.md | `158de5516eb7b9a555ff116433e6678a9611cf0f3a0a153b2636af62b335bddb` | “Its effort boundary and lead response follow the single” (then linked budgets and limits specification). |
| 04-decision-record.md | `5258156ea0dca9188914f83400d4059917a6e5f27284f9f96f2734220db2e598` | “Budget policy stays centralized.” |

Excerpts normalize line wrapping only. The decision record receives an append;
earlier successors remain unchanged. Documentation verification and final hashes
are recorded in the native append-only note. Runtime acceptance is specified in
the consolidated policy and has not been exercised by this documentation change.
