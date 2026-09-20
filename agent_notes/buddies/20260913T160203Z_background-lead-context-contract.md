# Background lead context contract

Owner clarification; design recorded by Buddies Development Lead. No runtime
implementation or deployment is claimed by this note.

## Question and accepted product direction

The owner asked what a saved checkpoint means and whether the returning worker
result resumes the launching conversation's context. The owner described a
background branch of the conversation that launched agents, with the worker
report, initial assignment, on-disk conversation reference, correct event/state,
and available tools injected, so the lead can decide to continue, stop, redirect
or assign another worker. The clean contract is now in CORE_DESIGN.md under
“A background lead reviews a worker return.”

A checkpoint is an optional explicit record of saved artifact references,
performed effects and resume instructions. It is not the worker transcript or
the launching conversation. The returning reviewer is the lead Buddy; the
worker's execution thread is a distinct conversation. Current code creates an
independent lead return thread and reuses it for later returns, but does not
inherit launch-chat history.

## Motivation and successor relationship

This clarifies the context required by the already accepted separate-background
return design. The earlier choice to pass only assignment/report/checkpoint was
an assistant implementation choice to preserve the then-current audience boundary;
it was not proof that the lead retained the owner's motivating discussion.
The concrete gap is lost management context, including owner constraints that
were never repeated in the assignment. Human/background separation, existing
Task/Mail authority, reusable workers, and scoped memory still hold.

Prior evidence: agent_notes/buddies/20260913_background-returns-inline-links.md
and its evidence.json; agent_notes/buddies/20260913T1540Z_ceo-workflow-code-review.md
and its evidence.json. The review's reproduced checkpoint omission is a separate,
narrower defect; fixing it alone would not implement inherited lead context.

## Implementation constraints and open choices

Owner requested branching context; this note's details about a launch-boundary
snapshot and explicit later-owner handoffs are the assistant's interpretation
of that requirement. Native session fork versus explicit transcript handoff
remains open. Preserve private source audience through background execution and
memory review. Current knowledgeAuthority derives non-chat runs as workspace or
project scope; copying the full private transcript into that audience would be
incorrect. Fresh tools/policies must be injected independently from historical
context. Owner-control credentials must not be replayed. Provider differences,
missing source/transcript files and truncation must be explicit.

Reuse the run executor's existing return prompt assembly and conversation
creation/resumption. This replaces its assignment-only review context; no new
review supervisor, Worker table, separate memory store or task authority is
justified. Continuing managed work must use current recovery/assignment tools
within current limits; receiving a timeout does not grant a fresh budget.

## Acceptance examples

- An owner constraint appears only in the launch discussion. The background
  lead receives it and uses it to evaluate the worker's artifact.
- Completion, final managed timeout, recoverable timeout and informational
  return each carry the correct event and available evidence; missing checkpoint
  or transcript is explicit, not a fabricated path or a failed wake.
- A second return resumes prior background review context. Continuing the
  existing worker preserves its context where the native continuation supports it.
- Worker claims are checked against actual artifacts/transcript. The lead records
  a decision and performs an allowed next action, or reports the concrete blocker.
- Concurrent human discussion stays independent. Background private context is
  not curated into workspace/project memory or shared with another employee.
- Tool definitions/responses are current and actually callable; copied historical
  calls do not acquire authority. Stop fences and original limits still apply.

Revisit the transport choice when a real provider cannot preserve the required
context or a measured context-size problem justifies a bounded handoff. Do not
weaken the product requirement silently to accommodate the transport.
