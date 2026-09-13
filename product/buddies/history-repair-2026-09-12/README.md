# History repair evidence — September 12, 2026

Start with [the repair report](../IMPLEMENTATION_HISTORY_REPAIR_2026-09-12.md). The earlier [audit](../AUDIT_HISTORY_AND_RESOURCES_2026-09-12.md) and its bug-asserting diagnostics remain historical evidence.

| Evidence | Artifact |
|---|---|
| Final real-thread recovery through actual adapter/runtime/config/loader | [Result with source hashes](real-history-verification.json), [replay script](real-history-verification.ts) |
| Nine independent desired-behavior history cases | [Result and raw output](acceptance-test-result.json), [tests](../../../server/test/conversation-history.test.ts) |
| Runtime session stability after unrelated changes | [Result](continuity-verification.json), [replay script](continuity-verification.ts) |
| Package tests and red/green checks | [Results and timestamp limits](package-test-results.json), [91-test terminal summary](package-tests.log), [baseline/repair excerpts](package-knowledge-red-green.log) |
| Final server tests, build and package smoke | [Commands/results](final-checks.json), [server tests](server-tests-final.log), [server build](server-build-final.log), [client build](client-build.log), [package smoke](package-smoke-built.log) |
| Client tests, all typechecks and invariants | [Commands/results](checks.json), [client tests](client-tests.log), [typechecks](typechecks.log), [invariants](client-invariants.log) |
| Initial package smoke stopped by existing dev lock | [Unmodified failure log](package-smoke.log) |
| Running backend before safe idle reload | [Bounded live observation](live-before-reload.json) |
| Historical source identity and relevant code excerpts | [Repair manifest](repair-manifest.json) |

The real-transcript script reads the specified production config/native paths, verifies temporary copies, and removes those copies. It does not run a provider, edit production state or restart the server. The continuity script uses an isolated in-memory store and controlled provider events.

```sh
pnpm exec tsx --test server/test/conversation-history.test.ts server/test/session-history.test.ts server/test/adapter-history.test.ts server/test/lifecycle.test.ts
pnpm exec tsx product/buddies/history-repair-2026-09-12/real-history-verification.ts
pnpm exec tsx product/buddies/history-repair-2026-09-12/continuity-verification.ts
```

These Markdown and evidence files are saved on disk. Product documents are covered by the repository's existing ignore rules; no automatic commit is implied.
