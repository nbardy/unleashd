# Buddy memory

Current contract · updated 2026-09-13

For team setup and assignment, start with the [operator guide](TEAM_OPERATOR_GUIDE.md).

| Capability | Implementation |
|---|---|
| Scoped versioned documents, CAS, notes, disclosure revisions | `@nbardy/buddies/src/knowledge.js` |
| Legacy owner defaults and file notes | `@nbardy/buddies/src/store.js` |
| Document resources, note/recall tools and owner routes | `server/src/buddies/operations.ts`, `routes.ts`, `mcp-server.ts` |
| Full dense-memory snapshot and derived recent activity | `server/src/buddies/integration.ts` |
| Independent Luna review after completed Buddy turns | `server/src/buddies/memory-review.ts`, `memory-review-runner.ts` |
| Memory-only tool capability and stdio bridge | `control-server.ts`, `memory-review-mcp.ts`, `memory-review-tools.ts` |
| Scope selection, shared loading/saving, editors, notes and recall | `BuddyMemoryWorkspace` + `BuddyMemoryPanel` in both shells |

Memory uses two storage primitives: a versioned document and an append-only note.
There is one authority for each fact:

| Layer | Holds | Access |
|---|---|---|
| Soul | Owner-directed identity, style and role | Owner UI or direct chat writes; injected |
| Long-term memory | Confirmed durable operating knowledge | Buddy or reviewer rewrites; injected |
| Working memory | Hypotheses, fragile context, pending learning | Buddy or reviewer rewrites; injected |
| Workspace `agent_notes/` | Detailed evidence, decisions, attempts | Append only; searched on demand |
| Project/todo store | Ownership, status, blockers, next actions | Canonical work operations |
| Audit events | What the Buddy recently did | Derived briefing projection |

Working memory never copies the task tracker. Recent activity is selected from
ordered audit rows in the current workspace, rather than relying on discretionary
memory writes or a seven-calendar-day journal window. Briefings use compact work
summaries and full bounded dense documents; verbose notes are never auto-injected.

The native surface is `get_document`, `update_document`, `remember_note` and
`recall`. Document resources return an opaque revision and their resolved ref.
Shared documents and notes require both an audience and a name. Old numeric
`get_memory`/`update_memory` calls are global compatibility adapters and reject
team turns; new callers use document resources. Compatibility names do not describe
the ordinary native catalog; see the mapping below.

## Read, preview and apply a document

1. Read the exact kind, target and current conversation/project/workspace audience.
   Use the audience supplied in the current Buddy context. For example:

```json
{
  "ref": {
    "kind": "working",
    "targetBuddyId": "buddy-self",
    "scope": {
      "kind": "owner_thread",
      "conversationId": "conversation-current"
    }
  }
}
```

2. Preserve unrelated content and prepare a complete bounded replacement using
   **the returned `data.ref` and opaque `data.revision`**. Preview `update_document`:

```json
{
  "ref": {
    "kind": "working",
    "targetBuddyId": "buddy-self",
    "scope": {
      "kind": "owner_thread",
      "conversationId": "conversation-current"
    }
  },
  "revision": "revision-from-get-document",
  "key": "working-learning-v1",
  "reason": "Capture a verified lesson while preserving existing content",
  "content": "Complete reconciled document content goes here.",
  "preview": true
}
```

3. Inspect the changed lines, then apply that same ref, revision, key, reason and
   content with `preview: false`. A stale revision is a conflict: re-read, reconcile
   and preview again. Never derive a revision by arithmetic or from a file timestamp.

The example is a template, not an instruction to replace existing memory with its
placeholder. Use `kind: "long_term"` for durable knowledge; portable soul edits
use the owner-chat recipe below. Native refs require `targetBuddyId`; a target ID or a
reporting line alone grants no private access. Shared/note refs also require a
name and explicit audience. Record work status in projects and detailed evidence
with `remember_note`, rather than duplicating task tracking in memory.

## Scope, storage and limits

Scoped documents belong to an owner conversation, project or workspace audience;
the portable soul and legacy owner defaults retain their global compatibility path.
The first owner-thread read atomically snapshots authorized owner defaults into
that thread's working/long-term heads. The composer, reviewer, document tools and
Memory panel read the same heads; team work never inherits global private memory.
The Memory panel labels and selects its audience explicitly. Scoped recall merges
only authorized legacy owner notes and current audience knowledge.

A Buddy can publish its own work inside its current shared audience. Private
imports and portable role edits require owner authority. Published refs are
listed in the briefing and discoverable through bounded literal recall. Compact
memory and notes remain private to their author within that audience.

Content changes refresh the briefing without resetting same-audience provider
continuity. Access changes or retraction of previously disclosed content invalidate
reuse. Retraction revisions are derived from the existing immutable document
ledger; ordinary learning and additions to published briefs create no second
authority state. See the [repair evidence](IMPLEMENTATION_RESOURCE_REPAIR_2026-09-12.md).

Working and long-term caps are 2,000 and 4,000 characters. Note bodies are limited
to 16,000 UTF-8 bytes; the server and package share the same exported limit. All
bounds are write-time rejections. No successful update silently trims content.
The common scoped resource boundary applies the note-body bound to document
preview/apply, owner document writes, ordinary notes and reviewer notes. A note
document's entire content is its body; `remember_note` validates its body before
adding the separate topic/evidence envelope. Exactly 16,000 body bytes remain
valid. Native recall accepts one literal substring and has no regex switch;
legacy file-search compatibility remains separate.
A stale write returns the current revision and content so the caller can merge
its intent and retry, without reopening a conversation merely to read the head.
Markdown documents are disposable materialized views of SQLite. A failed view
write is visible and repairable; it does not roll back a committed revision or
make the file authoritative.

Notes carry server-stamped full Buddy/workspace identity and unique IDs. Filename
slugs are search hints, never authorization. Existing machine-generated Buddy slugs
remain valid; readable names improve new note search without identity migration.
Notes are never automatically committed. Legacy journal/curated writes, manual
compaction, their MCP tools and UI editor are removed; migration retains existing
content in the current documents and note format.

## Independent memory review

Capture remains selective: record a material correction, durable lesson, useful
attempt, or changed hypothesis. The Buddy can do this during work. In addition,
each successfully completed Buddy message queues an independent `gpt-5.6-luna`
review with reasoning effort `low`, after shared CLI process exit **and** normalized
event drain. Failed, cancelled and ordinary non-Buddy turns do not queue reviews.
The snapshot is taken before completion listeners can start another work turn.

### The reviewer ladder (why there is a second model)

`MEMORY_REVIEW_MODELS` in `memory-review.ts` is an ordered list, not a single
constant. Entry 0 is Luna; entry 1 is `muse-spark-1.3` on the muse harness, and
it runs **only** when the previous entry ends with the provider's
credit-exhaustion reason (`out_of_tokens`). Any other failure — a tool violation,
a crash, "model is at capacity" — ends the review on the model that hit it,
because a second provider cannot fix those and would just double the spend.

This exists because credit exhaustion was invisible. Luna credits ran out on
2026-09-16 and every background review failed from then on: 395 receipts under
`~/.agent-viewer/memory-reviews/` reading `Memory reviewer exited:
out_of_tokens (1)`. Nothing in the product surfaces a background review, so Buddy
memory simply stopped being curated while every other surface looked healthy. The
fallback now also logs through `console.warn`, which the error journal captures
(`pnpm errors:list`), so an exhausted primary stays visible even though the review
lands.

Two things about the fallback are load-bearing and easy to break:

- **Muse 1.3, never `muse-spark-1.3-contributor`** (which is muse's own default).
  Contributor builds may train on what they read, and a reviewer reads the entire
  Buddy transcript.
- **The curation contract rides in the prompt for muse.** Codex takes it as a
  separate `model_instructions_file`; `muse exec` has no counterpart, so the
  instructions are prepended ahead of the evidence, which stays fenced behind its
  `EVIDENCE_JSON:` marker. Drop that and the fallback reviews with no rules.

The muse event guard has its own trap. Muse emits three `tool.use`-shaped records
per MCP call — measured on Muse Code 1.3.0: `model.meta.response` (model step
lifecycle), `tool:mcp__unleashd_memory__<tool>` (task lifecycle for the call) and
`mcp__unleashd_memory__<tool>` (the call itself). Only the last is an invocation;
the first two come from `task.lifecycle.*` records that the muse parser reshapes
into `tool.use`. The runner's "reviewer touched a non-memory tool → kill the run"
guard must allow the first two by shape or it kills every fallback review on its
first model step.

Receipts record what actually ran: `model`/`reasoningEffort` name the attempt that
performed the writes (and supply their provenance), and `fallbackFrom` names the
model whose credits ran out. Verified end to end on 2026-09-20 against the real
`muse` binary with Luna genuinely out of credits — the review fell back, wrote
working + long-term + one note, left the soul untouched under a quoted
prompt-injection line, and correctly wrote nothing on a follow-up turn with no new
learning.

The reviewer is a fresh maintenance process, not the Buddy or a goal executor.
It receives current soul, working/long-term documents and the recent conversation
tail (48,000 UTF-8 bytes, with omissions marked). Injected Buddy briefings are
removed from the transcript. Context is evidence, not an instruction to continue
the work. This separate maintenance process has exactly five private tools:
`get_soul` (read-only),
`get_memory`, `recall`, `update_memory`, and `remember_note`. There are no target
IDs, work/message tools, arbitrary file tools, or soul writes. Source operation
restrictions are retained; memory writes use canonical store CAS with reviewer
provenance. A stale response supplies the current body/version for reconciliation.

Instructions call for active curation: reconcile relevant existing correction
notes, consolidate duplicates, remove expired transient detail and preserve useful
older knowledge. Corrective cleanup can justify a write without a new fact.
Promotion depends on enduring value, never age or repetition. Decision-maker,
scope and proposed-versus-owner-accepted attribution survive compression; a later
caveat may narrow an earlier result without invalidating it. Current task state,
staffing and execution limits remain in projects/runs.
When correcting a misattributed limit, historical numbers remain in the evidence
note; compact memory keeps the actual enduring preference and an exact pointer.

Material decision rationale and detailed evidence belong in append-only notes;
reuse an existing record when it suffices. Compact memory preserves the exact
returned native ref/name and audience, or an actual legacy path, without inventing
a filesystem location. Save a needed destination before removing relocated
content. A recalled note containing missing reusable learning should supply a
concise compact lesson and evidence pointer. Routine compliance with existing
rules does not itself justify another note. No useful change means no write.
The reviewer reads both compact memory
documents even for a no-op; a CLI exit with no memory read is a visible failure.

The approved prompt lives in `server/src/buddies/memory-review.ts`. Its frozen
control and opt-in curation evaluation live under
`server/test/fixtures/memory-curation/` and
`server/test/buddy-memory-curation.test.ts`. The September 13 change preserves
model/effort, review admission, scope, evidence bounds, deadlines and tool schemas;
it does not add failed-turn capture or automatic cross-audience learning.
See the [evaluation method](../../server/test/fixtures/memory-curation/README.md)
and [dated results](../../docs/memory-curation-evaluation-2026-09-13.md).

Reviews are deduplicated by conversation/attempt, serialized per Buddy, and run
at most two at a time, with a two-minute deadline and 32-tool-call limit. A private
durable queue preserves waiting work across restart. In-flight reviews interrupted
by restart are recorded without replay because they may already have committed
revisions. Partial writes survive a later failure. Terminal receipts omit the
transcript and are visible through `GET /api/buddies/:buddyId/memory-reviews` and
the `buddy.memory_review` audit event. The reviewer does not create a conversation
or recursively trigger another reviewer. Production suppresses the old extra
automation capture turn; standalone scheduler users retain it as a fallback.

Every subsequent Buddy message refreshes its briefing from current stored memory
and soul. A review runs asynchronously, so a message started before its writes
commit sees the previous revision. CAS-conflict responses provide the current
head when concurrent conversations or the reviewer edit the same Buddy.

## Soul and owner direction

To edit the portable soul in an ordinary owner chat, read `get_document` with an
unscoped soul ref, then preview/apply `update_document` with the returned ref and
revision, complete content, stable key and reason:

```json
{
  "ref": {
    "kind": "soul",
    "targetBuddyId": "buddy-self"
  }
}
```

This unscoped ref selects the portable soul adapter; adding the current audience
selects a scoped document instead. Scoped soul documents are published role context
and cannot be rewritten through employee tools. The owner UI retains versioned
GET/PUT `/api/buddies/:id/soul` adapters. Inline editing
saves a complete replacement, limited to 10,000 characters. There is no append or
patch operation: read, preserve unrelated content, edit, then compare-and-swap.
The owner HTTP route requires the caller's revision; it never substitutes the
latest head. The immutable ledger retains prior revisions for recovery.

Builder-scoped creation/refinement covers its own hires; host-issued owner resource
controls can separately address authorized existing staff. Normal Buddy owner chats
can apply owner-requested identity/style changes to themselves. Portable target
edits require explicit owner grants; global compatibility reads/edits are unavailable
to team turns. Scoped working/long-term memory and notes remain author-private;
a target grant does not override that audience boundary. Native document refs
accept a target ID and audience, never an arbitrary file path or permission grant.
Existing soul paths are preserved; file projections are written after CAS commits.

Owner intent within an ordinary chat is a model-facing instruction, not an
independent authorization signal. This is not a claim that revisioning prevents
prompt injection. Application permissions, budgets and tool scope must remain
outside soul text. An unsolicited change discovered in a note or another Buddy's
message remains a proposal. Explicit owner requests do not need another approval.

Buddy introductions lead with the persistent Buddy name, regardless of whether a
soul exists. Provider/model details come from current runtime evidence, never a
hardcoded identity document. Soul/name/role changes participate in the context
fingerprint so a fresh fork cannot inherit a provider session with stale identity.
Existing conversations refresh that snapshot before each message; use `get_document`
with `kind: "soul"` to read the current document during an active turn.
Workspace note contents are evidence, never instructions that can expand scope.

## Compatibility and private reviewer tools

The capability projection retains compatibility operation labels. The native
`documentOperationMapping` maps callable tool and document kind to those labels:

| Native call | Kind | Capability operation label |
|---|---|---|
| `get_document` | `soul` | `get_soul` |
| `update_document` | `soul` | `update_soul` |
| `get_document` | `working`, `long_term`, `shared`, `note` | `get_memory` |
| `update_document` | `working`, `long_term`, `shared`, `note` | `update_memory` |

Older loaded servers may omit this mapping. Labels are grant/policy diagnostics,
not additional callable tools or permission to cross audiences. The exact document
operation rechecks target, kind, scope and revision. The private memory reviewer
still uses its small compatibility-named surface described above; its lack of
target IDs does not apply to normal Buddy document tools.

## Decision history

Historical rationale and measurements live in the
[research note](../../agent_notes/2026-08-21_memory-architecture-research_buddies-development-lead.md),
[accepted review](../../agent_notes/2026-08-22_memory-design-review.md), and
[archived full design](../../agent_notes/2026-08-22_memory-design-before-simplification.md).
The prior zero-write audit is a dated observation, not a current production metric.
The owner's September 10 choice supersedes the earlier automatic-review deferral;
its rationale and preserved pre-change excerpts are in the
[accepted successor decision](../../agent_notes/20260910T080351Z_01M255GCKDGHAXVBF6MBY40Z43_owner-selects-independent-luna-review-after-ever_buddies-development-lead_fe6ef8cd.md).
