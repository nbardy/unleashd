# Second-pass verification and delivery

September 13, 2026 local (September 12 UTC). This record covers the CEO coordination
simulation and its scoped implementation. It does not close Wave_sim product work
or the separate historical UI/release backlogs.

## Sources and code attribution

The six original documents are preserved byte-for-byte under `sources/`, with
original paths, capture time and SHA256 in [source-manifest.json](source-manifest.json).
The CEO report hash is
`2d331058b5be73d1a158afdd7ccbbdaa8ad1cf3588c376402a96cdf7132f96e0`.
The original report is evidence of historical observations, not a current runtime
receipt or authorization to restart its stopped production requests.

- Host implementation: `b24eb74d70b437d4e8ca746961434e4c2b4c2141`, local branch
  `codex/wave-sim-ceo-second-pass-20260913` in
  `/Users/nicholasbardy/git/.codex-worktrees/unleashd/wave-sim-ceo-second-pass-20260913`.
- Package implementation: `1e4e62b1448ea199011e7f8432168fc124adceae` then
  `b70c0def1373034aeff56e409adb97d66ff6d7f7`, based on the prior verified
  `90831e14c855b68bcbaafabe70a417b45b45bf5a`, in
  `/Users/nicholasbardy/git/.codex-worktrees/buddies/wave-sim-ceo-second-pass-20260913`.
- Vendored archive SHA256:
  `76fda9860849fe0e95d2655426c74dbe440718dc2691342e1e192dcc26be43cd`.
  `vendor/nbardy-buddies-0.1.0.provenance.json` points to the clean final package
  commit. Repack from that source; the older dirty `~/git/buddies` checkout was
  inspected and preserved, not overwritten or treated as this release's source.
- Native resource contract `2026-09-13.1`; durable team contract `2026-09-12.2`,
  schema 27. No migration or new durable handoff entity.

The host started from a large shared dirty tree. Snapshot `8712f93` preserves that
inherited source; `dc3c296` and `844e63b` remove accidentally captured dependency
symlinks. **Use `844e63b..b24eb74` to review this implementation.** The preservation
commits do not attribute the inherited work to this pass. The `agent-cli-tool`
submodule's existing source and pointer were preserved; this pass did not commit
or push that submodule. No branch was pushed.

## Final automated checks

| Boundary | Result | Evidence |
|---|---|---|
| Final package full suite | 99 passed; no failures or skips | [package log](verification/package.txt) |
| Host full server suite on final package | 349 passed; 3 opt-in tests skipped; 352 total | [server log](verification/server.txt) |
| Client rendered/behavior suite after final UI edit | 80 passed | [client log](verification/client.txt) |
| Shared ESM and CJS builds | passed | [shared build](verification/shared-build.txt) |
| Server TypeScript build | passed | [server build](verification/server-build.txt) |
| Client `tsc -b` and Vite production build | passed | [client build](verification/client-build.txt) |
| All six client invariant gates | passed | [gates](verification/invariants.txt) |
| Final isolated real-provider owner → worker → lead flow | passed: 2 setup owner turns, 1 worker turn, 1 return turn | [live log](verification/live.txt) |

The opt-in live test was run explicitly as well as its normal skip in the server
suite. Its final receipt is project
`buddy_project_4b4310a4-05e9-45ce-9de1-e2a996ca32fb`, message
`message_1e1baa07-32dd-41d5-8a1d-9858983335ed`, worker run
`buddy_run_fc8d1b58-c514-4f5f-b578-a2d5e4247545`. It records both current contract
versions and a persisted arithmetic audit result. This used temporary isolated
staff/workspaces and real native tools, not Wave_sim production employees.
The first package also passed the live flow; its separate historical log retains
an old hardcoded contract label. The final fixture logs actual constants instead.

The new inbox regression places 205 inaccessible messages before readable ones.
A real store and native MCP client verify complete disjoint authorized pages,
compact output under 5,000 characters despite 32KB evidence, exact full expansion,
legacy compatibility and cursor validation. Coordination tests exercise failed
returns, retry ancestry, independent pages, private-error redaction and the
recorded 90-second cap outranking a larger policy estimate. A frozen-clock package
regression orders twelve successive checkpoints and returns in the same millisecond.
Existing aggregate-return, real creation/link repair, timeout, stopped-root and
deleted-destination coverage remains in the passing server/package suites.

## Browser evidence

The checked-in `client/test/fixtures/ceo-browser-server.mts` serves the actual Team
component and HTTP routes over a temporary real store. It provides two workspaces,
more than one execution page, saved versioned files, older checkpoints, failed
return attempts and a once-failing recovery HTTP response. It launches no provider.
Run it with `pnpm exec tsx client/test/fixtures/ceo-browser-server.mts` from the host
root and open its printed local URL. It is a manual browser fixture, not production
seed data or a mocked replacement for the store.

[Browser evidence](../../../output/playwright/wave-ceo-second-pass/interaction-evidence.json)
records these exercised results:

- Older checkpoint and delivery pages keep independent offsets and select one run.
- Failed recovery HTTP submission preserves both reason and selected checkpoint.
  A subsequent successful submission creates a visible successor, retaining the
  old failed input and its original limits.
- Returning to the execution list restores the list. Switching workspace clears
  old offsets/detail/error state and disables Previous on the first page.
- The final package's HTTP observation orders return attempts 4, 3, 2 and checkpoint
  versions v4, v3, v2. [Exact response](../../../output/playwright/wave-ceo-second-pass/final-package-http.json).
- Return details expand on demand. Desktop 1440px and mobile 390px screenshots
  were visually inspected; measured document widths were 1432px and 382px, with
  no horizontal overflow. Execution paging is absent in single-run detail.

Screenshots: [desktop](../../../output/playwright/wave-ceo-second-pass/desktop.png),
[mobile](../../../output/playwright/wave-ceo-second-pass/mobile.png),
[expanded mobile history](../../../output/playwright/wave-ceo-second-pass/mobile-history.png).
The mobile measurement uses the same shared component; this does not claim a
separate end-to-end traversal of the entire mobile shell.

## Corrections during verification

The browser exposed a real chronology defect: random UUID tie-breaking put return
attempt 3 before attempt 4. That led to the durable insertion-order fix and frozen
clock regression before repackaging and rerunning the full suites/live flow.
Recorded caps and missing historical snapshot labels were also corrected. The last
UI pass collapsed lengthy return details while preserving the receipt summary.

Initial test setup needed a reporting relationship and an exact normalized body
expectation; a store fixture redundantly bound a conversation after claim already
bound it. These fixture errors were corrected before the recorded passing runs.
Refreshing a same-path tarball required a forced offline install. One browser
fixture start overlapped shared build's temporary removal of `dist` and was
restarted after the build completed. These are not counted as passing runs.
Final logs are retained; not every intermediate terminal output is preserved.

## Integration and adoption

The twenty implementation files were copied into `/Users/nicholasbardy/git/unleashd`
only after each destination matched the SHA256 captured before this pass. The
[integration receipt](verification/integration.json) preserves each before/after
hash and source commit. Unrelated shared changes were preserved. Dependencies
were refreshed offline from the final archive.

After integration, shared ESM/CJS, server TypeScript, and client `tsc -b`/Vite
builds all passed again, as did all six client gates and the 16 scoped native
MCP/coordination/runtime boundary tests. Logs: [shared](verification/integrated-shared-build.txt),
[server](verification/integrated-server-build.txt), [client](verification/integrated-client-build.txt),
[gates](verification/integrated-invariants.txt), [boundaries](verification/integrated-boundaries.txt),
[dependency refresh](verification/integrated-install.txt).

Build success and the isolated real-provider flow establish this source/package's
behavior. This turn did not force-restart the shared application, retry production
Wave_sim roots, change staff settings, launch GPU work or send external messages.
Loaded production adoption must be confirmed on the next normal server start/drain
and one authorized bounded round trip. The next-wave instruction in the CEO reply
makes that check explicit before larger execution.

The existing Vite chunk-size warning remains; package install reported an existing
deprecated transitive dependency. Neither caused a failed check. This pass adds no
GPU host lease, independent process heartbeat, token/dollar meter or per-assignment
model override. Consumer acceptance is still an explicit evidenced project/reply
decision; delivery completion does not establish artifact correctness.
