# Second-pass decision

September 13, 2026 local. Decision-maker: Buddies Development Lead, implementation
choice under the owner's explicit request to simulate, reassess and finish a
second code pass. This is a successor to the accepted existing-resource design;
the [pinned predecessor](sources/05-04-decision.md) preserves its rationale.

## What changed

The full CEO simulation exposes three remaining information/recovery defects:
inbox filtering after a fixed cap and excessive payloads; flattened return
receipts; and Team detail/page state persisting into the wrong scope. These are
consumer-path defects, even though the earlier creation/retry tests passed.

## Choice and alternatives

Keep projects, messages, attempts and checkpoints as the authorities. Add a compact
native inbox projection with bounded pages and full `get_message` expansion.
Apply audience filtering inside the canonical store iteration before the page
bound, and retain the legacy full service response for existing HTTP consumers.
Expose paginated structured delivery records in the shared Team observation and
both shells. Scope UI paging state to Buddy/workspace, with explicit per-run
checkpoint and delivery navigation.

Do not introduce a workflow engine, independent handoff ledger, global permission
grant, automatic artifact crawl, heartbeat protocol or GPU lease in this pass.
An explicit review request/reply already captures producer, consumer, artifact
version and verdict. A dedicated handoff entity should be reconsidered only when
real repeated queries cannot be served by those existing records. Host resource
leases and dollar meters require their own accountable integrations; displaying
invented values would weaken this workflow.

The separate former-lead permission-editor and historical repository cleanup
projects retain their existing criteria and ownership. They are not silently
closed by this CEO coordination pass. No external messages, production retries,
staff changes or GPU campaigns are implied by the simulation.

## Acceptance before claiming completion

- Native MCP: more than 200 unreadable messages cannot hide readable older work;
  pages are complete, bounded and compact; full expansion still returns the exact
  authorized body/evidence; legacy callers retain their response contract.
- Real store + MCP: failed return then retry keeps IDs, failure, acknowledgment,
  ancestry and pages; descendant metadata does not disclose private error text.
- Shared UI: rendered delivery history distinguishes failure/admission/completion;
  browser scope changes reset pages, detail navigation works, and a selected
  checkpoint survives a failed recovery submission.
- Existing real creation, two-worker aggregate-return, timeout, stopped-root,
  tombstone and bounded live-provider fixtures remain valid. Build both shared
  formats, server and client; run `tsc -b` and the client invariant gates.

Historical sources are pinned in `source-manifest.json`; inherited working source
was captured separately in local snapshot commit `8712f93` and dependency cleanup
`dc3c296`. New implementation is attributed separately. These local snapshots
are preservation evidence, not claims to authorship of inherited changes.

## Browser-discovered successor, 17:05 UTC

The real browser fixture displayed return attempt 3 before attempt 4 because both
were created in the same millisecond and SQL used random UUIDs as the tie-break.
Checkpoint versions had the same ambiguity. Preserve timestamp ordering and use
the durable insertion order for ties in attempts, deliveries and checkpoints.
A frozen-clock store regression must verify twelve sequential versions/retries.
This is an implementation correction under the same decision, not a new ledger.

## Final disclosure refinement

Recorded execution snapshots take precedence over calculated policy caps; absent
historical snapshots must be labeled as estimates. Browser inspection also led to
collapsing long return history by default while keeping persistence/count visible.
These preserve the original choice: expose existing receipts faithfully without
creating a second authority for completion or runtime configuration.
