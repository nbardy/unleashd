# Workers that last for an assignment: identity, memory and lifecycle

September 13, 2026 · Handoff 4, read alongside delegation and autonomous continuation.
This document proposes a workflow built from ordinary Buddies; it does not claim that a
complete lightweight worker lifecycle is already implemented or verified.

## 1. The need hidden inside “sub-buddy”

The owner wants to delegate work to a lightweight worker that can learn, stop consuming an
execution process, receive feedback later and continue with the knowledge it accumulated.
The employee may be useful for one assignment rather than permanently. That requirement is
about durable responsibility and addressability across runs.

The earlier answer framed the options as persistent employees versus ephemeral helpers.
Handoff 4 correctly identifies the missing middle in the workflow: an ordinary persistent
identity can have a deliberately short employment period. Persistence does not imply an
always-running process, a permanent place on the main roster or a global memory shared with
every conversation.

This is a product distinction worth making even if the storage model does not add a new
type. “Delegate this task” can make the necessary ordinary Buddy, work, context and return
route feel lightweight. The user should not have to understand profile provisioning and
coordination claims to get a worker that remembers what it did yesterday.

## 2. Vocabulary and independent lifetimes

| Concept | Meaning | Lifetime and authority |
|---|---|---|
| Buddy | Persistent employee identity and message address | Survives processes; employment status and grants are separate |
| Manager relationship | Supervision relationship between identities | Durable relationship; does not imply every private-content permission |
| Project/todo | Canonical work and completion criteria | Can outlive an attempt, conversation or worker assignment |
| Work request | A particular obligation delivered to a recipient | Retains its own receipt, return route and bounded execution history |
| Conversation | Application transcript and interaction destination | May bind several native sessions; not a permanent execution token |
| Attempt/run | Bounded execution under a claim and policy | Ends after completion/failure/cancellation/drain |
| Native session | Provider-specific context continuity | May rotate without deleting Buddy or application history |
| Memory document/note | Learning and evidence in a defined audience | Versioned or append-only; not the authoritative task tracker |
| Harness helper | Turn-local delegated computation | No independent Buddy identity; behavior depends on the harness |

An assignment worker combines the first several rows. It should not merge them. The worker
can be idle while the project is in review; the project can be transferred while the worker
retains historical evidence; a process can fail while the assignment remains unfinished.

The current contract says a direct report is an ordinary persistent Buddy with one manager,
and there is no third Buddy lifetime. The historical project records the owner's preference
to keep ephemeral helpers a harness capability. The proposed assignment workflow preserves
both principles if it uses ordinary identity and existing work records. [S03](08-source-evidence.md#s03),
[S10](08-source-evidence.md#s10), [intake](01-handoff-inventory-and-history.md)

## 3. When to create a child and when to reuse an employee

A new child is justified when work needs an independently addressable owner, accumulated
assignment-specific learning and later follow-up. It is not justified merely because a
process starts in the background.

| Situation | Recommended composition | Why |
|---|---|---|
| One quick investigation inside an active turn | Harness helper if useful and supported | No durable employee address is needed |
| Routine self-owned scheduled summary | Existing Buddy plus schedule/run | Same responsibility and useful continuing knowledge |
| A second independent project for an established engineer | Existing Buddy with project-scoped context | Identity reuse is valuable; tasks already separate work |
| An isolated delegated assignment requiring days of follow-up | Ordinary child Buddy associated with that assignment | Clear owner/address and focused accumulated knowledge |
| Retry after a failed attempt on that assignment | Same Buddy/project, explicit linked recovery | Failure does not create a new employee |
| Review requests or user feedback | Message the responsible existing worker | Preserve context and original artifact lineage |
| Every timer tick, continuation or budget tranche | No new Buddy | Otherwise memory fragments and the roster grows with execution count |

There is no universal rule that every independent project must have a new worker. Specialism,
continuing relationships and reusable knowledge may favor a standing engineer. Assignment
workers should be a deliberate option, not automatic multiplication of identities.

Reusing an existing worker also needs care. Name matching is not identity resolution, and
replaying creation must use stable keys. A previous “Export Engineer” may be archived, belong
to another workspace or retain an unrelated assignment. A UI can suggest reuse based on
authorized metadata, but it must not reactivate or repurpose an employee silently.

## 4. One complete proposed journey

Consider “repair the export pipeline,” requiring investigation today and owner review
tomorrow. The following describes target behavior, with present gaps called out separately:

1. The lead identifies canonical criteria and checks existing work to avoid duplication.
2. It selects an existing employee or creates an ordinary child under authorized staffing.
3. The project belongs to the executing recipient, with concrete todos and evidence criteria.
4. The lead publishes a bounded brief into a readable project/workspace audience and sends
   a work obligation through the existing durable message path.
5. The worker accepts current criteria, investigates, saves files and records checkpoint refs.
6. It submits an artifact for review and ends its execution attempt. The claim drains; no
   provider process stays alive merely to wait for tomorrow's response.
7. The project remains unfinished or in review, with its current owner and evidence visible.
8. Later feedback arrives at the same address and identifies the exact artifact/criteria.
9. If the obligation is still eligible, the existing managed runtime continues it. If its
   original envelope has expired, a supported renewal/new-assignment contract is required;
   a message address alone does not revive terminal authority.
10. The worker revises and returns evidence; the appropriate reviewer records acceptance.
11. Once obligations are settled, the worker can remain idle, be reused deliberately or be
    archived under an explicit policy. The result remains discoverable independently.

Today's components cover identity, work, scoped knowledge, messages, bounded attempts and
some recovery. The frictionless composition, renewable multi-day envelope and accessible
archival journey are not established by merely listing those components.

## 5. “Sleep” should usually be a projection of no active work

The phrase “sleeping worker” is helpful product language, but it does not necessarily require
a new persisted employment state. An active ordinary Buddy with no executing attempt already
has an identity without a live provider process. Its projects and messages can explain why
it is idle or waiting.

Recommended presentation distinguishes:

- idle and available for appropriate new work;
- waiting for a named dependency or review on an open obligation;
- queued and eligible for execution capacity;
- held by explicit policy or missing readiness;
- unable to continue because the original envelope ended;
- archived and unavailable for ordinary new work.

These labels should derive from canonical identity, project, request and run state. Creating
a second `sleep_state` that independently decides whether messages execute would repeat the
multi-authority problem the August lifecycle design corrected. Add persistent state only
for a concrete fact the existing resources cannot represent, such as a selected retention
policy with its own version.

Waiting also requires clear ownership. A parent waiting on children must release its active
slot after drain, or a team can occupy all capacity with managers waiting for workers that
cannot start. Child replies should wake the existing eligible parent chain, not spawn an
unrelated parallel coordinator. [S06](08-source-evidence.md#s06), [S17](08-source-evidence.md#s17)

## 6. Memory continuity is explicit about audience

“The worker has its own memory” does not mean every conversation sees one global bag of
knowledge. Current documents distinguish owner-thread, project and workspace audiences.
Working and long-term memory remain author-private within the relevant audience; published
work is a separate sharing decision. Team turns do not inherit global private owner memory.
[S04](08-source-evidence.md#s04)

For an assignment worker, the default useful continuity is the relevant assignment audience.
The first handoff supplies authorized context; later work reads current project criteria and
the same permitted documents. A manager may inspect authorized coordination metadata and
published checkpoints without being entitled to private worker memory or raw transcripts.
Explicit private-document grants do not erase audience constraints.

This yields several design rules:

1. Choose the audience at creation/admission using trusted scope, not the worker's proposed
   file path or a memory note's instruction.
2. Keep task state in project/todo records. Memory captures hypotheses, lessons and pointers.
3. Publish the information another employee needs instead of copying private memory by default.
4. Save detailed rationale and attempts in append-only evidence; keep dense documents bounded.
5. Use revision-checked updates and reconcile concurrent writes rather than overwriting a
   reviewer or another conversation's learning.

The independent successful-turn memory reviewer is an existing maintenance mechanism, not
a new worker or a continuation planner. Its own process has memory-only authority and cannot
send work or extend the assignment. A worker about to run a long risky command still needs
an explicit checkpoint; automatic post-success memory review will not rescue a failed turn
that never saved its effects. [S05](08-source-evidence.md#s05), [S36](08-source-evidence.md#s36)

A concurrent September 13 guide update makes active memory curation more explicit: existing
correction notes, duplicates and expired transient detail can justify cleanup even without a
new fact. Attribution and exact native references should survive that cleanup. The update
retains the successful-turn and audience boundaries; it is not an automatic failure-recovery
mechanism. This later source is pinned in [S37](08-source-evidence.md#s37).

## 7. Context continuity and history continuity are different promises

The worker's knowledge can survive even when a provider session cannot safely resume.
Ordinary memory updates should refresh the briefing without resetting same-audience
continuity. Access changes or retraction of previously disclosed content can require a new
native session. A restart with unverified context can conservatively start fresh.

The application should still preserve the visible history and artifact lineage. The September
history incident involved stored transcripts being omitted from the UI when only the latest
native session was hydrated. Its repair and live follow-up are historical evidence for the
importance of separating these two promises. They are not a guarantee of crash-transparent
provider continuation for every future worker. [S22](08-source-evidence.md#s22)

If tomorrow's worker starts a fresh session, it should be able to reconstruct sufficient
authorized context from criteria, checkpoints, saved documents and messages. Replaying every
old transcript can reintroduce revoked content and unnecessary token cost. The continuity
contract should say which durable inputs are provided and when additional evidence is fetched.

Changing models or providers is another possible session boundary. The same worker identity
and project can survive it, but the execution snapshot must identify the new configuration.
Creating a new Buddy just to change models would fragment responsibility; assuming the same
native session is compatible with every new provider would be equally incorrect.

## 8. Archive is not sleep, and retention is not discoverability

Current retirement/archive behavior disables schedules, cancels outstanding coordination
work and preserves stored history. Open work must be completed or explicitly transferred
under the applicable checks. Active occurrences must be cancelled and drained. Public
projections hide archived reports and their usual navigation; archived Buddy detail routes
return 404. [S03](08-source-evidence.md#s03)

This creates an important difference between three promises:

| Promise | Current ingredients | Remaining product question |
|---|---|---|
| Data survives archival | History and identity records are retained | Which retained artifacts are durable and independently verifiable? |
| A reviewer can find old work | Project evidence and historical refs can exist | How is it opened when normal Buddy navigation is hidden? |
| A worker can answer again later | Non-archived identity can receive eligible work | Is reactivation supported, who authorizes it and what policies are restored? |

Recommendation: keep a worker non-archived while feedback or review is expected. Use an
assignment/project view to reduce roster clutter. Archive only after the lifecycle policy
allows it and outstanding obligations are resolved. Before offering automatic archive, make
completed-work discovery independent of the active Buddy directory.

Do not silently reactivate an archived identity on a send retry. The owner may have archived
it precisely to stop future execution. If the product later adds reactivation, require an
explicit state transition that rechecks scope and readiness, preserves historical policy
changes and does not re-enable old schedules by accident.

## 9. Staffing, hierarchy and work graphs

The owner removed hiring quotas; that does not remove staffing or execution permissions.
Creation and reporting changes require the applicable owner grants. A reporting line gives
supervision, while private document/profile changes have their own permissions. Restricted
runs can use available staffing atoms only when both current grants and their saved operation
policy permit them. Older compatibility hire/retire tool restrictions should not be mistaken
for a blanket ban on all current creation paths. [S03](08-source-evidence.md#s03)

The delegation graph, organization chart and work dependency graph are different. One manager
relationship does not imply one project forever. A temporary child can be responsible for a
project within a larger initiative, while a standing engineer participates in several.
Adding task-to-task dependencies or project team membership should be evaluated against
their own canonical work design, not hidden inside a new child-worker feature.

If many assignment workers become common, define how to find them by parent and project
without creating a new hierarchy authority in the client. Current server employment/team
projections should remain canonical. Directory visibility is a presentation choice; hiding
a child from the top-level roster should not hide a failed obligation from its supervisor.

These scope controls govern sanctioned Buddy operations. Existing local agents execute as
the owner's operating-system user; identity separation inside the Buddy store is not OS
isolation for arbitrary shell activity. This is an existing architectural limitation, not a
reason to add a hypothetical permission checklist to every ordinary delegation.

## 10. Failure and edge cases

Creation can partially fail after profile persistence but before conversation linking.
Replay must repair the existing intended identity/work rather than multiply employees.
Use stable keys and the shared creation readiness path. A name match is not replay evidence.

A late reply can arrive after a parent was cancelled or its envelope expired. Preserve the
result, but do not revive the terminal run. A worker may finish after its manager's identity
changes; result delivery and supervision must use durable IDs and current authority rather
than display names. An artifact may disappear between checkpoint and resume; the checkpoint
attests what was saved, so the worker must verify the current file before using it.

Two owner conversations can ask the same Buddy to address different assignments. Scope
documents and canonical work prevent ordinary context mixing, but private information must
also be filtered from receipts, readiness, error text and pagination. The recent resource
repair reports provide predecessor evidence; scale should preserve those negative tests.
[S20](08-source-evidence.md#s20), [S35](08-source-evidence.md#s35)

A completed project can later need revisions. Do not overwrite the old success as though
the new criteria existed then. Use the existing revisioned work semantics and a clear new
obligation or criteria change, preserving the artifact/version that was previously accepted.

## 11. Acceptance criteria for the proposed workflow

The core integration scenario is multi-run continuity: create or attach an ordinary worker,
assign one project, save useful learning and artifact refs, drain execution, reopen the store,
deliver feedback and continue with the same identity and correct audience. Observe no idle
provider process, duplicate Buddy or second active obligation. Test with changed criteria,
missing artifacts and a failed attempt before completion.

Additional boundaries include staffing denial without side effects, idempotent creation,
workspace membership checks, private-memory exclusion, CAS conflicts, cancelled roots,
expired envelopes, model/provider changes and manager replacement. Archive must drain,
preserve historical evidence and not silently reactivate. The UI should make unfinished
work and completed artifacts discoverable through the intended assignment view.

The successful product story is “the same responsible worker can continue tomorrow with
the right knowledge.” It is not “the same process never ended,” nor does it require a new
kind of employee in the database.
