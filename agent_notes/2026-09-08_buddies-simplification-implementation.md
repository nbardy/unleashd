# Buddies simplification implementation

> Historical implementation/validation snapshot. For current checkout locations,
> newer schema-22 coordination work and the remaining integration steps, start at
> [the September 9 handoff](2026-09-09_buddies-integration-handoff.md).

Implemented 2026-09-08 following the design/memory critique. The principle is one
authority per fact: projects own work, SQLite revisions own dense memory, notes
own detailed evidence, and message rows own coordination outcomes.

## Delivered

1. Scoped audit activity is queried before LIMIT and injected without raw payloads
   or a calendar cutoff. Compact work records remain valid JSON; dense memory and
   operating instructions are complete. Memory versions appear in the briefing.
2. Successful automation runs use one remaining permitted turn for selective
   capture. It consumes the existing runtime/iteration budget and retains the
   work result. Capture status and actual memory-write counts are audited;
   cancellation still revokes authority and drains the provider.
3. Legacy remember/compact writers and UI are removed. Three memory verbs remain:
   update_memory, remember_note, recall. CAS errors return the current body and
   revision. UTF-8 note limits share one exported constant. Recall uses bounded
   ripgrep instead of synchronous JavaScript regex. Legacy migration preserves
   same-day notes from different Buddies and oversized/archived journals.
4. Markdown views materialize the latest SQLite head under a short transaction;
   an older delayed writer cannot replace a newer view. Builder note names are
   readable while full Buddy IDs remain the identity.
5. New coordination uses send/reply with open purpose/outcome strings, concrete
   evidence and one message table. Historical category records and explicitly
   scoped completion tools remain available; creation routes adapt to messages.
   Owner replies stay on the authenticated host boundary.
6. Optional waits cover creation, dispatch and reply, share the run deadline, and
   react to cancellation. Durable edges reject cycles. Late-created dormant
   children cannot enqueue after revocation. Expired waits read accurately after
   process death; outstanding messages sort ahead of settled history.
7. Direct-report store behavior is wired through tools, quota controls and the
   canonical team projection in both shells. Retirement waits for active automation
   cancellation; claims and retirement serialize through the store transaction.
8. Four living contracts remain in product/buddies. Historical plans, reviews and
   sprint handoffs are archived in agent_notes and entry-point links are repaired.

## Source and packaging

Package source is isolated from the dirty sibling checkout in
`/tmp/unleashd-buddies-simplification`, on local branch
`codex/buddy-simplification-20260908` in `~/git/buddies`.

- `83824784630cbbf626c00f0dd71ac06c3d54caad`: implementation and regression tests.
- `9bb66226f9cbc04168a8d5b749015f7771702c35`: pending-message ordering and expired reads.
- `3ef5013c52c0928c8c026df2cbcbc2148052f530`: integrates concurrent export and
  multi-hire Builder changes; schema 19 converges from either schema-18 variant.

The vendored archive and pnpm lockfile reference the final clean source commit;
packaging verified byte-for-byte reproducibility and excluded runtime memory.
No push was made. Application changes remain in the shared working tree, alongside
pre-existing and concurrent work. Concurrent soul-editing changes are separate
from this implementation and were preserved during integration. Future vendoring
must retain the combined source: the sibling working tree alone does not include
the simplification commits. During validation, another session replaced the
archive with that older API; the final combined archive restores all required
APIs while preserving its Builder/export changes.

## Validation

- Package: 61 tests passed, syntax and whitespace checks passed. Real databases
  from both schema-18 branches upgrade to 19 with memory revisions, messages and
  Builder hires preserved; foreign keys and idempotent reopen were verified.
- Server suite: 249 passed, 1 opt-in live test skipped.
- Client suite: 51 passed; all six client invariant gates passed.
- Server typecheck and client `tsc -b` passed.
- Server compilation and Vite production build passed using temporary output
  directories because the existing dev supervisor owns the normal build task.
- Compiled stdio MCP launched from `/`, advertised canonical tools, wrote a note
  and recalled it successfully against an isolated database.

The integration tests cover capture save/NONE/failure/cancellation/budget cases,
CAS conflicts, Unicode caps, long briefings, cross-connection memory ordering,
retirement/claim races, owner replies, wait cycles/revocation, and pending inbox
visibility. Test fixtures did not use the live Buddies database.

## Deliberate limits

Capture quality has not been evaluated with live models. Its audit counts enable
a pilot that checks whether saved material is useful, not merely whether a tool ran.
Capture is skipped when the original policy lacks permission or spare budget.
Token/cost metering remains unavailable across providers; only runtime and
iteration limits are enforced. Loop exhaustion remains an explicit failure, and
malformed completion now fails immediately instead of silently repeating work.
Historical coordination allowlists are not widened automatically to generic send;
the owner must update those automation policies. Hard-crash provider adoption and
automatic continuation of terminal runs remain outside this design.
