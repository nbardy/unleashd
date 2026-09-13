# Workers, Mail and Prompt — owner clarification

September 13, 2026 · Successor to the [original decision](04-decision-record.md)
and [handoff/limits successor](06-handoff-and-limits-successor.md).
Conversation: `89d40447-9d68-4b53-9688-67c154dbfae2`.
Design documentation only; no runtime or native API change is claimed.

## Question and owner source

What does Document mean, should correspondence and prompt execution be separate,
and what owns a Worker when related work spans several tasks?

Exact owner wording, excluding injected context:

```text
Andwhat is the" "Dcoument" in the objcet investory?

Also I feel like we might want to split up "Message" async vs sync where one is like the email system and another is sending and eecuting a pormpt in context.

And i dont like "task owned workers" because one worker could have many sub stasks if they make sense to do in a bathc of work, like for example here its a "design" that covers many differnet tasks like " fix budgets" impiment sub buddies

I alos like "Workers" as a better name for sub buddies, but do think they should reuse all the "buddy" infra so we dont have many code paths and act as invisible buddies tied to a single buddy still so a worke ris a like a emphermal commmited, sub buddy.
```

| Decision | Decision-maker and status |
|---|---|
| Prefer the name Workers for sub-buddies | Owner-stated preference, adopted in the current design |
| One parent Buddy; ordinary Buddy infrastructure; hidden standalone identity | Owner-stated direction |
| One Worker may handle a coherent batch of related tasks | Owner-stated direction; rejects Design 2's per-task lifetime binding |
| Separate email-like communication from executing a prompt in context | Tentative owner proposal, endorsed by the assistant |
| Names Mail and Prompt; precise execution/wait semantics | Assistant proposal |
| Inspect Workers under their parent; keep identity through pauses and feedback; retire after obligations settle | Assistant interpretation/refinement of “ephemeral committed”; timing remains unresolved |
| Document as versioned content/reference family | Explanation of the earlier assistant inventory, not a new owner requirement |

## Document

Document means content that can be named and read at a known version: a design
brief, shared spec, memory page or decision note. For example, the design brief
for a Worker is a Document; “fix budgets” is a Task; progress sent to the lead is
Mail; asking the Worker to revise the brief in its context is a Prompt.

Reuse existing content storage, revision checks and references. Keep the distinct
rules for editable bounded memory, append-only notes and explicitly published
briefs. An artifact can be a link to a code commit, file hash or other versioned
external content. Current task status stays in Task records. This vocabulary
does not prescribe another editor, a Documents tab, copying every artifact into
a database, or converting external skill files into Buddy-owned documents.

## Parent-owned Workers, multiple tasks

A Worker is an ordinary Buddy serving as a temporary committed helper of exactly
one parent Buddy. Its responsibility is a coherent body of work. Multiple Tasks
can be assigned to it, and an existing parent Task can group them when useful.
“Batch” describes this grouping; it does not require a new Batch object or make
the grouping Task own the Worker's lifetime.

Example: Buddies Development Lead has a design Worker with shared design context.
It can clarify budgets, revise Worker lifecycle and prepare or implement related
sub-buddy changes when those activities fit its assignment. Each task retains
its own criteria, evidence and review. Finishing the first task does not retire
the Worker or require another identity for the next related task.

Proposed lifecycle: assign related work → execute in bounded attempts → pause,
report and receive feedback → continue the same Worker → settle remaining
obligations → retire with history retained. “Ephemeral” describes a temporary
work relationship, not loss of identity whenever a provider process exits.
Exact retirement timing and reopening policy remain unsettled. Existing standing
direct reports are not automatically converted or retired.

Reuse the Buddy identity, parent relation, scoped memory, inbox, session binding,
task resources, executor, checkpoints, limits and cancellation machinery. A
Worker mode needs explicit visibility/lifecycle policy, not another worker store,
memory implementation or executor. Hide standalone roster entries; make Workers
inspectable under their parent and assigned work. UI hiding is not access control.

One active autonomous lane may advance several related tasks as a batch. It does
not mean one concurrent provider writer per task or a separate message-response
lane. Context reuse is appropriate only for compatible provider/audience scopes;
the same identity can need separate scoped contexts. Further parallel work uses
another permitted coworker or a bounded harness helper. The parent's private
conversation/memory is not implicitly copied into a Worker.

Task ownership and Worker parentage remain independent: moving a task does not
reparent its former Worker. New tasks must fit the actual assignment and resource
authority. [Budgets and limits](../BUDGETS_AND_LIMITS.md) remains the single policy
reference; neither batching nor changing Worker identity grants fresh allowance.

<a id="mail-and-prompt"></a>

## Mail and Prompt

Proposed meanings, not callable native signatures:

| Operation | Immediate result | Later result |
|---|---|---|
| Mail: deliver correspondence to a recipient's inbox | Durable delivery receipt | It may be read, handled or replied to later |
| Prompt: request execution in an authorized context | Accepted/queued/held/rejected execution receipt | Model response and attempt outcome; optionally streamed or waited for |

The useful split is delivery versus execution. “Sync” can describe waiting for
the Prompt result, but is not an execution guarantee: busy contexts, admission
and provider failure remain real states. A caller may submit a Prompt and return
immediately, or wait for its result. Ending a wait does not imply the work stopped;
cancellation remains an explicit operation.

Mail by itself need not invoke a model. An authorized mailbox policy or report
composition can save Mail and enqueue a linked review Prompt. The message is the
communication evidence; the Prompt is the execution request; the attempt receipt
records what ran. Reuse durable inputs, receipts, deduplication and executor
infrastructure while keeping those facts separately observable.

For example: Worker saves a report → Mail is delivered to the lead → one linked
lead-review Prompt becomes eligible → the lead reviews → a continuation Prompt
returns to the same Worker's compatible context. The existing report/wake design
can implement this composition without a second mailbox or runner. A plain note
can remain unread Mail without claiming a completed review.

Prompts must select an authorized context explicitly or through a host-resolved
destination; a caller-supplied context ID is not permission. Serialize prompts
to a busy Worker at a safe boundary in its existing lane. Automatic lead reviews
use a background context, never inject into or create a human Conversation.
Synchronous observation must not hold a provider slot while waiting for another
Worker's result. Queue/wait behavior should expose a receipt rather than hang a
caller indefinitely. Exact operation names, context selector and wait API remain
open; today's native `send` still uses `inform`, `request` and `work` variants.

## Why this succeeds the earlier design

The earlier inventory already separated Buddy identity from Task completion, and
Design 1 kept ordinary Buddy infrastructure. That reasoning still holds. Design 2
coupled a Worker to one task to simplify navigation and context isolation. The
owner's batch example supplies the missing counterexample: closely related work
benefits from one retained context across several outcomes. One-task coupling
would force needless identities or an artificially oversized task.

The new direction also narrows “reusable teammate” from the earlier Design 1:
Workers are temporary helpers under one parent, not automatically a permanent
staff roster. Reuse is valuable through the coherent work and review cycle;
indefinite reuse for unrelated future work is not selected. Mail/Prompt makes
delivery and execution explicit while preserving the shared runtime foundation.

Tradeoffs: batch context can grow or mix unrelated concerns; hidden Workers need
parent-level inspection; temporary identity needs clear retirement behavior; and
delivery/wake composition must survive failure without losing or duplicating
attention. These are explicit design boundaries, not reasons to introduce a
parallel employee system.

Revisit batching if context mixing or incompatible tasks outweigh continuity;
retirement rules if expected follow-up loses context; visibility if work becomes
unfindable; or Mail/Prompt if users cannot predict whether an action executes or
merely delivers. Use observed workflows and boundary evidence, not object count
alone. No model-cost claim or blanket approval of prior candidate mechanics is
inferred from this clarification.

## Historical versions and validation

[workers-mail-before.json](workers-mail-before.json) preserves six full source
versions captured at `2026-09-13T04:58:53.279774+00:00`, with SHA-256 per source.
These were uncommitted versions in a shared worktree; a mutable path alone is not
the historical citation. Relevant preserved excerpts:

| Prior source and SHA-256 | Preserved excerpt |
|---|---|
| Object inventory · `3fbe870cacf23b9e6eaeefcf956184fd5e270547d56617d67f9c773541f4dbaf` | “Document: What knowledge/artifact content exists at a named revision?” (table punctuation normalized); “Ordinary Buddy + manager edge + task ownership” |
| Candidate designs · `ece836c81ed85494a69096e8813179cacf12c23325590426083b686f70d8a6b7` | “Every executable Task gets one attached sub-buddy”; “The additional rule is a unique task-to-worker lifecycle binding.” |
| Latest human design · `c49fea013949e5d54eb25ce39536b270988c93c34c70b07c92874c0eec4d0820` | “Whether ‘sub-buddy’ is a role of the ordinary Buddy object” (quote marks normalized), previously listed as unresolved |
| Decision record · `926c69b1311ea2d6ba2032599d8c09df2b4237e8f1cf8b3993e579375e6fb7e2` | “Design 2 binds workers to individual Tasks.” |

The decision record receives an append; the earlier candidate body remains
unchanged under a historical-status notice. The earlier original owner statement
and handoff successor remain preserved. [Verification](workers-mail-verification.json)
records local link/anchor checks, snapshot hashes and preservation checks. These
checks validate documentation only; Worker lifecycle, Mail/Prompt and the complete
automatic lead-review journey have not been implemented or tested by this change.
