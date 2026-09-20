# Worker return live proof — 2026-09-14

Independent integration review requested as the fourth implementation sub-agent.
These are isolated implementation observations, not new product requirements.

The opt-in test is `server/test/buddy-worker-return-live.test.ts`. It uses the real
Buddies package, app dispatch/creation/runtime/control/executor path, and actual
Codex `gpt-5.6-sol` with medium effort. Every run creates its own temporary
workspace/database and local control server; it never restarts the production
server or accesses production Buddy data. Fixture files/databases are removed
after the test. Provider-native transcripts can remain in the provider's normal
history. Saved evidence strips private run claim tokens.

## Passing evidence

- `normal.json`: passed in 134.5 seconds. Lead invoked native `send`, Worker
  copied a file, lead's separate background return read the artifact with a tool
  and wrote an acceptance file. A human follow-up completed while Worker was
  running. Four real provider turns. Source and artifact SHA-256 both
  `d987ca9ef1390561cd4d9ae5f527624402b4bc877f3c31e5628abe84f7e418fd`.
- `timeout.json`: passed in 134.8 seconds. The fixture called the runtime's typed
  expiry path immediately after the Worker saved its file (about 25 seconds),
  while the requested sleep was pending. The original execution remained failed
  with `max_runtime_timeout`. After drain, a separate reporting turn completed
  in 29.9 seconds; only then did the lead receive the failure notice with the
  report, read the artifact, and write acceptance. Human follow-up remained
  available. Five real provider turns. Source and artifact SHA-256 both
  `a5d5acc15e7f2561188f7a36909da52f77c6fb550affb44c12fe4af7f8a32ffd`.

The secret file content existed only on disk; acceptance assertions check those
bytes, and the lead provider trace records actual tool use on `artifact.txt`.
The late human follow-up is absent from both frozen launch prompts. Task status
is not inferred from acceptance: this fixture has no Task to complete.

Normal used the installed package based on `c89d69a`; later package changes were
confined to interrupted reporting/queue behavior. Its loaded `coordination.js`
SHA-256 was `a95f3a35281a2572263c1f8f1405974cad9d7d2f08bb15be1e4282148331b9fa`,
and `background-work.js` was
`053215c0af3f1d43af726bdf30efa5e8244aee74e267bf6d298d75622a820a18`.
Timeout used package `aed8badae7fdaa0763145bcc32df629fecbc10dc` and archive
`0b202eafb108cee332cf65804fa5495c2b573a313946e52e03c976c3d27e4b93`.
`timeout-source-hashes.json` freezes loaded package/app/test source hashes before
that final run.

## Defects found and fixed during verification

1. Briefing additions exceeded the existing composition budget and prevented
   provider launch. The implementation agent shortened the instructions while
   retaining the existing bound.
2. Runtime-origin expiry was converted to `execution_failed` by the executor,
   because only the executor's local timer flag selected `max_runtime_timeout`.
   The runtime now passes its typed terminal cause through the drained completion
   callback; the executor persists that cause.
3. The package's ordinary failure path passed the pre-settlement run object to
   failure-notice creation. Its stale null error code skipped interruption
   reporting even when settlement had saved `max_runtime_timeout`. The package
   now reloads the settled run before deciding the return path.

`timeout-before-terminal-cause-fix.json` preserves the second defect. That test
also had an overly strict whitespace assertion on the acceptance prefix, which
was relaxed; the saved source `execution_failed` and absent report were separate
product defects. An earlier unarchived fixture allowed the Worker to recreate
text and add a newline; the lead correctly refused byte equality. The final
fixture requests a byte-for-byte copy explicitly.

Independent deterministic checks also passed all five tests in
`buddy-background-return.test.ts`, `buddy-knowledge-context.test.ts`, and
`buddy-dispatch-service.test.ts`. The root implementation run records the wider
suite and package checks separately.

## Rerun and limits

```sh
UNLEASHD_LIVE_WORKER_RETURN=1 UNLEASHD_LIVE_EVIDENCE_PATH=/tmp/normal.json pnpm exec tsx --test server/test/buddy-worker-return-live.test.ts
UNLEASHD_LIVE_WORKER_RETURN=timeout UNLEASHD_LIVE_EVIDENCE_PATH=/tmp/timeout.json pnpm exec tsx --test server/test/buddy-worker-return-live.test.ts
```

These are opt-in real-model tests with a 300-second total bound and 100-second
provider-turn bound. They prove one provider and the explicit runtime-expiry
path. They do not prove all providers or waiting for the full production deadline.
Transcript references are application `/chat/...` routes, not proof that a model
can resolve those routes as filesystem transcripts. Artifact access is proved
separately by actual file reads. No main merge, push, or production deployment was
performed by this verification task.

Evidence SHA-256:

- normal.json: `48cb3c77d84e15f38941c3db4e0162918d3e93b03266d8fc2c73490b2d18a40c`
- timeout.json: `7aea92a5b3a4ff91f04fd2e913084ee43d64d5db042a2f22e974c836764fcdef`
- timeout-before-terminal-cause-fix.json: `6ca7c8be03b89df24f7a6e03f5a71b117a44cb07e81233bf733705d2f3779e8b`
