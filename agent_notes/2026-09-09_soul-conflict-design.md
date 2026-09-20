# Soul edit conflicts: decision and implementation plan

## Problem and invariants

Two owner chats or browser tabs can start from revision 4 and both change the
soul. Saving the second draft against revision 5 must never overwrite the first
writer without reconciliation. The existing store already uses a short SQLite
`BEGIN IMMEDIATE` transaction, checks the revision, appends a revision, and
conditionally advances the head. The file is a projection of the committed head.
The current UI handles rejection by asking someone to copy and reload their draft.

The database remains authoritative. A conflict must leave both the ledger and
file untouched. No lock may span editing, model generation, or a network request.
Every eventual write, including a resolved merge, supplies the revision actually
reviewed. A second intervening writer must produce another conflict. Failed
requests and malformed errors must not discard drafts.

## Three options

### 1. Pessimistic edit leases

Acquire a lease when the editor opens or a Buddy begins an edit; block other
editors until save/cancel. Short database locks still protect the final commit.
This avoids most simultaneous edits, but needs lease ownership, expiry, renewal,
crash recovery, and a takeover UI. A stale owner can still submit after expiry,
so revision checks remain necessary. Long-running chats and idle tabs make this
a poor fit for a small document. A database transaction held while editing would
also obstruct unrelated writers. Reject for this use case.

### 2. Optimistic revision checks plus three-way reconciliation — selected

Keep the write API unchanged: full content, baseVersion, reasoning. Any stale
write returns HTTP 409 / MCP MEMORY_STALE with the current content and revision.
The editor retains its exact original base and draft. A three-way merge compares
base → draft with base → saved. Non-overlapping line edits combine automatically;
different edits of the same region require a choice or custom replacement.

Use node-diff3's structured blocks, with explicit line arrays so whitespace is
preserved. Do not run git, shell out, use fuzzy patch offsets, or require a Git
checkout. A two-way patch alone cannot distinguish another writer's intent from
context drift. The original revision remains the essential third input.

Refinement after considering prose: a textually clean merge does not prove
semantic consistency. Build a reviewable draft, never silently save the merge.
After resolving blocks, continue editing the combined document and save normally
against the displayed saved revision. Separate edits are preserved even when
the user chooses their own text for an overlapping block. No global force-save.

The same server CAS protects UI, Builder, and Buddy MCP callers. Models already
have get_soul and full-document update; on MEMORY_STALE they must reconcile their
intended edit with current_content and retry using current_version. A normal
read/modify/write capability needs no additional append or patch tool.

### 3. Append-only soul instructions

Appending events avoids physical overwrite, but “prefer short answers” followed
by “prefer detailed answers” still needs semantic arbitration. Deleting outdated
instructions becomes a tombstone/override language, and eventual compaction
reintroduces the same concurrency problem. Keep immutable revisions for audit
and append-only notes for observations; retain one current soul document.

## Implementation sequence

1. Define the existing stale-soul response in the shared schema and validate it
   before using it in the UI. Preserve its HTTP/MCP error code compatibility.
2. Keep an immutable base alongside draft content. Add a structured three-way
   merge helper and a shared desktop/mobile recovery panel with original, mine,
   and saved snippets, per-region resolution, and a complete merge preview.
3. Preserve the draft on cancel, errors, and repeated conflicts. Replace the
   destructive reload affordance while a draft is present. Enforce the existing
   document cap on the final combined content, including over-limit merges.
4. Verify both transports reject competing writes, with exactly one winning
   revision and an unchanged file after rejection. Exercise independent edits,
   overlap, deletion, identical edits, same-position inserts, and repeated races.
5. Test actual browser interactions and mobile layout against disposable state;
   run the relevant integration suite, typechecks, and client invariants.

## Boundaries

This change does not add revision history, restore, active-chat prompt refresh,
real-time collaborative cursors, or durable browser drafts across navigation.
Those are separate features. It does not change operational permissions or make
model interpretation of owner intent an independent authorization signal.

## Primary references

- [SQLite transaction semantics](https://www.sqlite.org/lang_transaction.html):
  write transactions serialize writers; BEGIN IMMEDIATE may report SQLITE_BUSY.
- [node-diff3 API](https://github.com/bhousel/node-diff3): three input buffers,
  structured ok/conflict blocks, and array input to avoid default whitespace
  splitting.

## Verification results

Implemented in the shared soul error schema, existing CAS service, shared soul
editor, and new `BuddySoulConflict` / `soul-merge` modules. Both desktop and mobile
shells load the conflict styles. node-diff3 3.2.1 is pinned in the client; no Git
runtime or database schema change was needed.

- All 72 Buddy server tests pass. The new integration tests race two worker
  threads with independent SQLite connections and prove exactly one committed
  winner, then exercise real HTTP and MCP callers through two successive stale
  revisions. Rejected writes leave the file projection unchanged.
- All 10 targeted client checks pass: merge cases, existing memory rendering,
  and CSS tokens. Cases include independent edits, deletion, empty documents,
  identical edits, same-position insert conflicts, custom resolution, and
  Markdown/CRLF preservation. Both typechecks and all six UI invariant gates pass.
- The production client build passes, written to
  `/tmp/unleashd-soul-conflict-build` so the normal application build is untouched.
  Vite reports the existing large application chunk advisory. Targeted Biome
  checks and `git diff --check` pass.
- Chrome checks against a disposable database verified clean merge preview
  without automatic persistence, per-region mine/saved/custom choices, keeping
  unrelated changes, Back retaining the original draft and reason, a third
  writer during review, malformed 409 and network failures, and oversized merge
  recovery without truncating the draft. Reviewed merges persisted successfully.
- Mobile at 390x844 has no horizontal overflow; conflict buttons are at least
  44px high. Screenshots: `/tmp/soul-conflict-desktop.png` and
  `/tmp/soul-conflict-mobile.png`.

The test loop caught a missing shared export and a component-level CSS import
that broke server-rendered client tests. Both were corrected; styles now follow
the existing shell-import pattern. The temporary UI fixture and browser session
were removed after QA. No live Buddy data was changed by these tests.

Changes remain local and uncommitted in the existing shared checkout. The earlier
unrelated edits and development vendor package were preserved. No production
restart, push, or release was performed.
