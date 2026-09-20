# LATEST_HUMAN_DESIGN

Start with [the canonical lean core](CORE_DESIGN.md) for the model, motivating
cases and rationale, including the later lean redo's narrower implementation.
This document preserves owner direction and the earlier proposal history.

September 13, 2026 · Owner direction, formalized by Buddies Development Lead.

This records the design the owner described in conversation
`89d40447-9d68-4b53-9688-67c154dbfae2`. It is a product direction, not a claim
that the runtime implements it. The owner's wording is preserved in the
[source statement](final-designs-2026-09-13/00-owner-statement.md). Assistant
clarifications and alternatives are kept in the [three designs](final-designs-2026-09-13/02-three-final-designs.md).
The [later Worker and messaging clarification](final-designs-2026-09-13/07-workers-mail-and-prompt-successor.md)
records the owner's preferred Worker name, parent ownership and reuse across
related tasks, plus the tentative split between correspondence and execution.
The [files, Mail and memory correction](worker-design-review-2026-09-13/06-files-mail-memory.md)
records the owner's subsequent removal of the managed Document model and four
employee knowledge tools, and reuse of ordinary Buddy memory for Workers.
The [integrated final design](worker-design-review-2026-09-13/07-final-design.md)
now incorporates these decisions, with the [shared context block](worker-design-review-2026-09-13/10-shared-context.md)
and [meta-reflection](worker-design-review-2026-09-13/11-meta-reflection.md).

## Purpose

Build an employee system from a few simple primitives. Minimize both the number
of objects people must understand and the responsibilities carried by each object.
The system's power should come from how those primitives compose.

Humans converse with Buddies. Buddies organize persistent work as tasks, assign
it to teammates, receive reports, review results and keep collaborating without
requiring a human to drive every step.

## Conversations

Conversations are what humans do with Buddies. They are human initiated and
never spawn autonomously. Human conversations never get blocked on resources.
Background work must remain outside the human conversation's execution path.

Leads use conversations for discussion with the owner, and focus their own work
on planning, organization, delegation and review. Long-running implementation
should become a task assigned to a teammate.

The phrase “never get blocked on resources” is the owner's requirement. The
implementation interpretation—background admission independence, foreground
headroom and honest handling of actual host/provider failure—is proposed
separately, rather than silently weakening this statement.

## Tasks

Tasks pass around, organize and persist work. They describe what needs to be
achieved and give a Buddy an enduring responsibility beyond a single model turn.
For substantial work, a lead creates a task and gives it to a team member.

A Worker can carry several related tasks in one coherent batch of work. For
example, one design Worker can handle budget design and Worker/sub-buddy design
and the related implementation tasks where that shared context is useful. Task
boundaries do not dictate Worker lifetime. It continues its assigned work within
scope and its solo session; progress, communication and task changes bring the lead back
to review or respond. Each task still has its own outcome and evidence.

The owner has not specified a new Project/Task/Todo schema, exact completion
states or the closure-versus-review transaction. Those are design refinements,
not implied owner decisions.

<a id="sub-buddies"></a>

## Workers

**Worker** is the owner's preferred name for a sub-buddy. A Worker is an ordinary
Buddy using the same identity, memory, inbox, context and execution infrastructure,
tied to one parent Buddy. It is a temporary, committed helper for a coherent
body of work, which may contain many tasks. The owner rejects task-owned workers
whose lifetime is tied to an individual task.

Workers are invisible as standalone Buddies in the ordinary roster. The proposed
presentation makes them inspectable under their parent and assigned work, so the
lead can manage their identity, progress and history without roster clutter.
This is a visibility/lifecycle policy on Buddy infrastructure, not a separate
Worker service. Existing standing direct reports are not automatically converted.

A Worker receives related tasks and a model selection. It has a `report` tool to mark
progress. Its check-in cadence, maximum solo session and lead response follow the
single [check-ins and limits specification](BUDGETS_AND_LIMITS.md).

Workers can see the other Workers on their team and what they are doing.
This supports collaboration among peers while keeping accountability visible.

Workers do not have a second, independent background message-response
execution thread. Their task execution handles their incoming communication.
If they have a useful parallel slice, they may use harness sub-agents sparingly.
Otherwise they message the lead, who can create or assign another coworker.

“Temporary” is interpreted as a bounded work relationship: the same Worker
survives pauses, process exits, related tasks and feedback until that work is
finished. Exact retirement timing, reuse after retirement and context-selection
rules remain proposals to settle; a Worker is distinct from a turn-scoped harness
sub-agent. No new permanent employee is required for every small task.

The owner's earlier statement “all background runs or processes are sub buddies” has an
explicit exception below for the main Buddy's message-response execution. Its
application to internal system maintenance is left open here.

## Correspondence and execution

The owner proposes separating email-like asynchronous messages from sending a
prompt for execution in context. **Mail** and **Prompt** are the assistant's
proposed names for these two meanings; the split is tentative owner direction,
not a selected native API.

Mail delivers durable correspondence to an inbox. Prompt requests a model turn
in a selected authorized context and has an execution receipt. Waiting or
streaming for the result is a caller interaction choice, separate from the
operation's meaning: execution can still queue while a recipient is busy.

Reports can compose saved Mail with lead review through the existing
report/wake mechanism. The integrated design proposes one bounded attention turn
for ordinary directed Mail under existing recipient authority; active Workers
handle it in their existing lane. Mail cannot grant effort or renew held work.
Automatic lead responses use background context, never a human Conversation.
This attention mechanism is an assistant resolution of the owner's immediacy
requirement, superseding the earlier passive-Mail proposal. See the historical
[semantic proposal](final-designs-2026-09-13/07-workers-mail-and-prompt-successor.md#mail-and-prompt)
for busy-context, scope and delivery distinctions.

## Files, notes and memory

Mail carries directed information with immediacy. Markdown notes leave durable
knowledge that agents can discover later. Reuse
`agent_notes/{optional_group}/{datetime}_{topic}.md` with ordinary file creation,
reading and search. Briefs and deliverables are ordinary files too; Mail and Task
evidence can reference them directly. Writing a note does not itself send Mail.

Remove **Document** as a core managed object and remove `remember_note`, `recall`,
`get_document` and `update_document` from the employee tool surface. Do not retain
an optional recall tool or replace these with renamed file wrappers.

Workers inherit the same memory system as ordinary Buddies: initialization,
injected compact memory, background review and refresh on later turns. The
existing background process handles curation. Workers can write useful detailed
notes through their normal file tools; they do not need a separate memory API.
Tasks remain authoritative for current work state.

The owner now asks for this convention in common Buddy/Worker prompt/context so
all participants know how to use notes. Mail should stay lean and preferably
point to detailed files. The shared block supplies the notes location, selective
writing/search guidance, and a short outcome/ask plus a usable reference. Simple
messages can remain self-contained. This is a common context change, not an
instruction to edit every Buddy soul or make a document for every message.

This owner correction supersedes the earlier Document inventory. Its
[decision record](../../agent_notes/buddies/20260913T063400Z_files-mail-memory-simplification.md)
preserves the rejected recommendation and versioned prior description.

## Main Buddy message-response execution

A main Buddy can execute background message-response turns without a human in
the loop. These do not need to become sub-buddies. They exist to read messages,
respond, review progress and results, organize work and delegate follow-up.

This execution needs a good name. **Desk turns** is the assistant's proposed
name; it is not yet an owner-selected term.

Worker reports, replies and task-state updates should trigger this main Buddy
interaction. The result is a collaborating web: workers do work, leads review
and steer, and further messages or assignments continue the work without
waiting for the owner to type again.

This mechanism must remain distinct from human Conversations. Waking a lead
does not mean inventing a human conversation or injecting an autonomous turn
into one.

<a id="budgets"></a>

<a id="budgets-and-limits"></a>

## Check-ins and maximum solo work sessions

The [single check-ins and limits specification](BUDGETS_AND_LIMITS.md) owns this
part of the design. The owner now frames the control as time until required
report-back: a maximum solo work session, with more frequent check-ins as well.
At required review, the main Buddy examines the evidence, then resumes the same
Worker, replans/splits the task, or stops. A routine progress update can let work
continue within the current session; it does not grant another session.
The [check-in successor](final-designs-2026-09-13/08-check-ins-and-solo-sessions-successor.md)
preserves this clarification. Cadence values and clock mechanics remain proposed.

The [dated successor](final-designs-2026-09-13/06-handoff-and-limits-successor.md)
also incorporates the pending delivery handoff and preserves the owner's wording.

## Models and context

Leads should write sufficiently detailed implementation documents and pass
workers a lean context for a cleanly planned slice. Use the more expensive,
capable models for planning, design, review and organization, and economical
models for well-specified implementation.

The owner's specific preferences are:

| Work | Preferred model and effort |
|---|---|
| Planning, design, review and organization | `gpt-6-astra`; effort not specified |
| Clearly planned implementation | `gpt-5.6-sol`, `medium` |
| Suitable bounded implementation slices | `gpt-5.6-luna`, `low` or `high` |

Workers must be spawnable with a different model from the Buddy's default.
They should also be encouraged to isolate clear slices and use cheaper models
themselves where supported, while using sub-agents sparingly.

The preference is a strategy to evaluate against complete delivered work. It
does not claim a measured saving from current usage, prescribe every task's
model, or replace the named models with different ones.

## Explicitly unresolved in the owner's notes

- Exact Worker retirement/reuse rules and how a batch selects compatible context
  across its tasks. Ordinary Buddy infrastructure, one parent, multiple related
  tasks and the Worker name are now owner-stated direction.
- Exact Mail/Prompt operations, context selection and result-wait behavior; the
  semantic split is an owner proposal, with names supplied by the assistant.
- Whether a Buddy may lead a small team while itself reporting to another lead;
  how this interacts with the one-execution-thread rule.
- Exact `report` semantics: what is saved, which changes wake whom, and how the
  lead's review is recorded without duplicate completion state.
- How short lead responses stay short without becoming hidden long-running work.
- The implementation choices listed in [budgets and limits](BUDGETS_AND_LIMITS.md#accounting-proposal-and-unresolved-values);
  the owner has now specified the review/resume/replan flow.
- Treatment of schedules, external effects, sensitive context and resource leases.
  Note discovery uses ordinary files; Workers share the existing Buddy memory
  reviewer lifecycle, as selected in the later correction.

These gaps invite precise composition rules. They do not by themselves require
a different product philosophy.

## Relationship to earlier decisions

This owner statement succeeds the September 13 system review's suggestion that
self-owned long background implementation and teammate assignment be equally
normal options. Here, teammate-owned work is the preferred enduring execution
pattern; the main Buddy's exception is message handling and coordination.

The prior commitments to durable identity, authoritative work, scoped knowledge,
human-chat isolation, immutable execution history and one execution owner remain
compatible. The [decision record](final-designs-2026-09-13/04-decision-record.md)
preserves the rationale, alternatives and versioned predecessor evidence.
