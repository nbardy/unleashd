# Resource consistency repair — 2026-09-12

The five original defects and both adjacent variants now have passing desired-behavior regressions. The owner requested repairs and simplification; the existing resource-consolidation design remains in place.

- Message detail, inbox and run projections share the active audience predicate. Associating a private message with a project does not publish it. Unreadable execution objects are omitted in full; supervised raw provider output remains private.
- Work and run authorization is applied before paging. The run store evaluates the supplied visibility predicate while scanning, stopping after a full authorized page.
- The scoped knowledge ledger resolves effective memory for the composer, reviewer and current document tools. The first owner-thread read snapshots authorized owner defaults atomically; project/workspace turns cannot inherit them. Legacy global tools remain at the compatibility boundary.
- Continuity keys derive access state and retraction revisions from the existing immutable ledger. Ordinary learning and additions to published documents do not reset the provider; removing published content or narrowing access does. No new table or coordinator was introduced.
- Creation and continuation use the same readiness/link-repair function. A runtime in the registry does not prove linking completed. Retries keep their original creation command, reject tombstones, and stay inside the run deadline.
- Both shells share one Memory controller and an explicit audience selector. Document reads, CAS edits, notes and recall use that audience. Published references are discoverable, and a Buddy can publish work authored inside its current shared audience. Private imports and portable role changes remain owner-controlled. Shared/note refs require a name and audience.
- Buddy mail remains local durable send/reply. The nine-turn runtime test reopens the on-disk store and verifies the saved messages and replies. External email integration is outside the owner’s corrected scope.

## Verification

302 tests passed: 139 Buddy/runtime tests, 76 client tests, and 87 package tests. Two existing opt-in live tests were skipped. Shared, server and client `tsc -b`, client build, six client invariants, and whitespace checks passed. Focused Biome checks have no errors (one existing parameter-assignment warning remains).

The runtime journey exercises a lead, two returning children, another engineer assignment, memory review between turns, and the return to the original owner conversation. Separate tests cover private/published content, pagination, the HTTP Memory view, stale writes, and failures before persistence, after persistence, after registration, and after deletion. Provider events are controlled fixtures; this is not a new production team launch or live provider acceptance run.

## Simplification and delivery

The two shell files lost 216 lines of duplicated Memory orchestration. The shared controller replaces both. Across the measured application/package source changes, net line count is **+180**, including the added scope UI and regression fixes; this is a reduction in duplicate implementations, not a net code-size reduction. Tests and this report are additional.

Package source: `135aafa6ecfbf26dd17c269e2818d5db80c2f15a` on `codex/resource-repair-20260912`; archive SHA-256 `54fc8e53846dbc1fb66f101ecbc963c8dee9e442b89cbb1b797a2a88f4c9059a`. The reproducible archive and lockfile are updated. No branch was pushed. Unleashd’s existing mixed working tree remains uncommitted, with unrelated changes preserved.

[Evidence and source hashes](IMPLEMENTATION_RESOURCE_REPAIR_2026-09-12.evidence.json) identify this implementation. It succeeds the [September 11 review](REVIEW_RESOURCE_CONSOLIDATION_2026-09-11.md), whose preserved SHA-256 is `ae10cedce4bfbab0e202c44987864bda09697a4821fb6f0a86d424e2e8c9733c`. The earlier diagnostic files intentionally assert historical bugs; they remain historical evidence, while the acceptance tests live under `server/test/`.

An optional cleanup of the disconnected external-mail experiment was blocked by the destructive-command guard. Those unused files remain unchanged; no provider integration or account setup was performed.
