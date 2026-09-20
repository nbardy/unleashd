# Coordination reliability: implementation and verification

September 13, 2026 local / September 12 UTC. Implemented under the selected [existing-resources design](01-existing-resources.md), [comparison decision](04-decision.md), and [explicit closed-timeout successor](05-closed-timeout-successor.md). The three alternatives were completed and committed before implementation. The successor preserves the original decision and explains the newer native evidence.

## Delivered behavior

- **Return identity and delivery:** repeated linking of the same immutable Buddy/workspace/project/conversation binding returns its existing row, including after native session binding. Conflicting bindings remain errors. Replies and failure notices have separate durable delivery attempts. Known failures before input admission retry at most three attempts using stable keys; admitted/uncertain provider work does not automatically replay. Busy conversations wait, and a readiness race does not stop a newly active owner turn.
- **Attribution:** request acknowledgment comes from actual attempt admission or an explicit reply. Project acceptance/status/evidence appears only as a separately revisioned current snapshot. Cancelling an unadmitted request cannot gain acknowledgment from later project activity. Reply persistence, delivery admission, provider completion and consumer review remain distinct.
- **Recovery:** original senders and root requesters may recover their branches across conversations within current audience, membership, supervision, execution epoch and original budgets. Stable commands prevent duplicate successors. Managed timeout with remaining budget stays recoverable. For historical `replied/failed` timeouts, explicit retry creates a linked successor request while preserving the original message and reply. All admitted attempts consume the same original run/time envelope. Explicit attempt caps stay unchanged; omitted legacy caps resolve within that envelope under the new managed default.
- **MCP and API:** new `get_team_state` and `checkpoint` operations; exact-payload `send` preview; extended `retry_run`; recipient/audience-based reply handling. Native and authenticated owner observations use one scoped service. The native observer sees authorized descendant execution metadata and explicitly published checkpoints, not private bodies, memory or transcripts. Informs default to no project binding; an explicit contextual project must be readable by both participants.
- **Team UI:** a Team route in both shells shows actual attempts, saved references/effects, reply delivery, recovery controllers, effective deadlines, remaining budgets and admitted provider/model/effort. Checkpoints page three at a time by default, with explicit counts and older-page controls. Deleted/unavailable conversations are not linked. Closed failures use the **Recover closed timeout** label and explain the successor.
- **Memory freshness:** the existing restricted reviewer receives a bounded, scoped current-work observation with revisions and evidence references. Its tool set remains memory/notes only. It can reconcile stale claims against current evidence without copying task status into memory. No production memory was rewritten based solely on the consumer report.

The additive durable schema is **27**. Team and resource contracts are **2026-09-12.2**. No second scheduler, workflow engine, WebSocket bridge or provider authority was introduced.

## Source and package provenance

Host implementation commit: `cb01fce`, branch `codex/coordination-reliability-20260912`. The isolated host baseline is `3ea36ad97dbfed535b0da9841519222040b074bc`, which preserved the initial dirty checkout. Design commit: `5e9480e`. Canonical package source is in `/Users/nicholasbardy/git/.codex-worktrees/buddies/coordination-reliability-20260912`, final commit `90831e14c855b68bcbaafabe70a417b45b45bf5a`, based on `fd9f0a85d4f6882954c86b32e5aceec3e0cedb5d`.

The vendored archive is reproducible from clean committed package source; SHA256 is `db8ec5149a7968a3d57ee33da8bcafeee0b52a6564f1f4d5e44f5dec8b42d637`. The archive, provenance and lockfile are synchronized. No branch was pushed, and the harness submodule was not changed by this work.

Forty-four implementation/design files were applied to `/Users/nicholasbardy/git/unleashd` after comparing every current file against the saved baseline. Two files required clean three-way integration: `server/src/buddies/routes.ts` and `shared/src/index.ts`; both retain the concurrent workspace-activity feature. The [integration receipt](verification/integration.json) records before/after hashes. Subsequent verification found no changed implementation files relative to that receipt. The shared branch's unrelated changes remain intact and uncommitted.

## Verification receipts

| Boundary | Result | Evidence |
|---|---|---|
| Canonical package | 97 passed | [Package suite](verification/package.txt) |
| Isolated host server | 347 passed, 3 opt-in skipped | [Server suite](verification/server.txt) |
| Integrated shared checkout server | 348 passed, 3 opt-in skipped | [Integrated server suite](verification/integrated-server.txt) |
| Integrated shared checkout client | 80 passed | [Integrated client suite](verification/integrated-client.txt) |
| Integrated native/runtime/memory boundaries | 15 passed, 1 opt-in skipped | [Boundary suite](verification/integrated-boundaries.txt) |
| Shared ESM and CommonJS; server; client | Builds/typechecks passed (`tsc -b` for client) | [Server typecheck](verification/integrated-server-typecheck.txt), [client typecheck](verification/integrated-client-typecheck.txt), [client build](verification/integrated-client-build.txt) |
| Client state/mobile/CSS invariants | All six passed | [Invariant gates](verification/integrated-invariants.txt) |
| Real provider round trip | Passed: 2 owner setup turns, 1 worker turn, 1 return turn; all complete | [Live provider receipt](verification/live-provider.txt) |
| Browser against real HTTP routes and isolated store | Desktop and 390px phone view; ordinary retry and closed-timeout successor; checkpoint paging; no page errors; width 390/390 | [Desktop](verification/coordination-team-successor-desktop.png), [phone](verification/coordination-team-successor-mobile.png) |

The runtime regression uses real configuration, creation and linking services, two workers, aggregation, a transient return readiness failure, and a destination becoming busy during readiness. It verifies one admitted final return and preserved failure history. The historical recovery fixtures invoke the prior runtime's actual settlement method, then recover over native MCP and verify unchanged old receipts, original deadline/permissions, duplicate prevention, cumulative budget exhaustion and stopped-root rejection. Privacy tests cover private checkpoint exclusion before paging and an unrelated project audience.

The bounded live test ran in a temporary workspace, with one isolated worker and its lead, before the additive historical-successor extension. Its successful path used package `a6cfb65`; the final successor extension was then verified through packaged-store, native MCP, real HTTP/browser and broad integrated regression boundaries. The live fixture's `contract: 2026-09-10.4` output is its older hardcoded owner-setup label, not the new team/resource version. Production Wave_sim attempts were not resumed by this test.

One initial live run failed at a version guard because only shared ESM had been rebuilt; CommonJS was stale. Rebuilding both formats resolved it. During shared-checkout integration, ordinary `pnpm install` reused the old same-path local archive. `pnpm install --force --offline --ignore-scripts` refreshed it; a fresh in-memory package probe then returned contract `.2` and callable checkpoint/preview methods, and integrated tests passed. These failed setup attempts are not counted as successful verification.

Checksummed logs, screenshots and integration evidence are in [the verification manifest](verification/manifest.json). The seven original historical source hashes still match [the source manifest](source-manifest.json).

## Live adoption and remaining product boundaries

Source, archive, installed dependencies and both shared build formats are integrated. No production provider was stopped and no old request was replayed. The existing native session's capability read (audit `audit_fc0936ee-49b4-4697-a305-951c709f7039`) still reported loaded contract `2026-09-12.1`. That is not evidence of live `.2` adoption. Allow active turns to drain under the existing reload mechanism, then verify `.2` in a fresh native session and inspect the original failed messages before any explicit production recovery. Keep stopped roots and deleted destinations fenced.

GPU reservations still are not host leases; per-assignment model overrides, independent process heartbeats, token/cost enforcement without meters and automatic filesystem artifact discovery are unavailable. The Team view states these limits. Checkpoints attest producer-saved references and versions; they do not prove current file availability or authorize repeating external effects. These are explicit boundaries of the selected design, not silently claimed implementations.

Automatic approval review rejected deletion of the temporary browser harness files (`client/.coordination-qa-entry.tsx` and `client/.coordination-qa-server.mts`) in the isolated worktree because it classified `Path.unlink()` as destructive. They remain untracked there, were not copied into the shared checkout, and the isolated browser/server were stopped. No production data was used by that harness.
