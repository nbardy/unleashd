# T17: Test audit and test typecheck

Branch `chore/test-audit`, based on `lean/integration`. It has not been merged or pushed.

## Commits

| sha | what |
|---|---|
| 117a2e8 | test(server): trim mirrors from config, lifecycle, shutdown and journal tests |
| c57a765 | test(client): run client tests under a tsconfig that includes test/; trim mirrors |
| ab73d8d | test(client): trim Buddy/channel test mirrors; fix fixture type drift |
| 4eae175 | test(server): delete catalog mirrors and a dead live test; fix adapter fixture drift |
| ad471b3 | build: typecheck server and client tests in `pnpm typecheck` |

## Numbers

| | before | after | delta |
|---|---|---|---|
| Lines, server/test/*.test.ts | 31,352 | 30,526 | −826 |
| Lines, client/test/*.test.ts(x) | 6,585 | 6,337 | −248 |
| **Lines, total** | **37,937** | **36,863** | **−1,074** |
| Tests, server (node runner) | 497 (491 pass, 6 skip) | 452 (447 pass, 5 skip) | −45 |
| Tests, client (node runner) | 177 | 160 | −17 |
| Files deleted | | 4 | muse-model, timeout-defaults, tool-integration (server); no client files |

About 19k of the remaining server lines are runtime and Buddy tests owned by T08 and T11. I audited them read-only and did not edit them (verdicts below). The cut in the files I owned is therefore about 1.1k of roughly 18.9k lines. The owned suites were mostly integration tests already; the waste was concentrated in a few catalog and schema mirror files.

The checks were run on a clean tree (`git status --porcelain` empty, so tree == HEAD):
- `pnpm typecheck`: exit 0. It now covers 65 server/test files and 47 client/test files; I confirmed this with `--listFilesOnly`.
- `pnpm test:server`: 452 tests, 0 fail.
- `pnpm test:client`: 160 tests, 0 fail.
- `pnpm check:client-invariants`: all 6 gates pass.
- `pnpm test:dev-supervisor`: 10 pass.

## Test typecheck (deliverable 3)

- **`server/tsconfig.test.json`**: src + test in one program with no emit.
  - `rootDir` is widened to `..` because tests import `../shared/src`. `pnpm build` still enforces `./src`.
  - `server/package.json` `typecheck` now runs `tsc -p tsconfig.test.json`. This replaces `tsc --noEmit`, because it checks a superset.
- **`client/tsconfig.test.json`**: extends the app config, includes `src` + `test`, adds `node` types and turns `erasableSyntaxOnly` off (client tests import server src, which uses parameter properties).
  - It is run as its own step in `tools/dev-supervisor.mjs --task typecheck`.
  - It is deliberately kept out of `tsc -b`, which `vite build` also runs, so a test-only type error fails typecheck and never the build.
- **Fix found along the way:** `tsx --tsconfig client/tsconfig.app.json` never applied to test files. tsx applies a tsconfig only to the files that config includes, and the app config includes only `src`. That is why every .tsx test needed an unused `import React`.
  - `test:client` now uses `client/tsconfig.test.json`.
  - The React imports are deleted.
- **One src change:** `client/src/hooks/useWebSocket.ts` timer refs are now `number` instead of `ReturnType<typeof setTimeout>`. With `@types/node` in scope, that type resolved to `NodeJS.Timeout`, and `window.setTimeout` returns a number.
- **Temporary exclude list** in `server/tsconfig.test.json`: 41 files, grouped by owning task in a comment. The goal is zero.
  - T08: `conversation-runtime`, `buddy-conversation-contract`.
  - T11: every other `buddy-*` file with drift, plus `channel-conversations` and `channel-seat-continuity`.
  - Buddy test files that already typecheck are not excluded.
  - Client tests have no excludes. Every one of my files had its type errors fixed, using the real types and no `as any`.
- **Docs:** `AGENTS.md`/`CLAUDE.md` no longer say client tests are untypechecked; the entry now documents both test tsconfigs and the exclude list. `docs/test-strategy.md` now names the right tsconfig.
- **Main type drift in the T08/T11 files**, for those tasks:
  - `done` missing from `ConversationOptions` fixtures.
  - Provider stub handles no longer fit (`child`/`stop`).
  - `buildFirstTurnCliContent` input missing `swarmDebugPrefix`.
  - Tests use private store members (`.db`, `isCoordinationManager`, `getBackgroundWork`) that `BuddiesStore` does not declare. Tests also run raw SQL through `store.db.prepare(...)` in `buddy-team-permissions` and `buddy-scheduler`; that will break under the 35→10 table rewrite.
  - `McpServerSpec.env` has been removed.
  - `node:sqlite` types are missing.

## Audit table: files I owned (edited)

L = lines, T = tests (`test(`/`it(` calls), before→after.

### server/test

| file | L | T | verdict | reason | bug it catches |
|---|---|---|---|---|---|
| adapter-history | 262 | 3 | KEEP | real adapters and cache on an fs fixture; cited | capped startup losing bound sibling sessions; O(bindings×sources) scan |
| adapter-loader | 244→247 | 7 | KEEP (type fix) | real loader and cache; dated 2026-09-25 regressions | cache pruned after failed discovery; EACCES read as empty |
| application-context | 42→22 | 2→1 | TRIM | dropped a Map get/set mirror | a suppression that never expires swallows every completion notice |
| auth | 363 | 18 | KEEP | real server over HTTP/WS; cited in CLAUDE.md | gate mounted after routes; public WS upgrade; cookie flags; open redirect |
| claude-usage-dedup | 48 | 1 | KEEP | real JSONL; dated regression | usage per content block counted 2.4x |
| codex-buddy-transcript | 178→179 | 3 | KEEP (type fix) | real Codex rollout, loader and cache | setup envelopes shown; stale v5 cache not reparsed |
| codex-session-id | 53→45 | 3→2 | TRIM | 3rd test re-sliced the 1st test's value | rollout prefix not stripped |
| codex-spark-model | 365→58 | 22→4 | TRIM | catalog/enum mirrors; buildCommand cases duplicated in vendor `build.test.ts` | ambiguous legacy composite decode; model inference from provider |
| codex-subagent-parent | 111 | 1 | KEEP | real rollout files | child not linked to its parent |
| codex-tool-history | 109 | 1 | KEEP | real transcript; cited | tool calls dropped or duplicated; stale cache version |
| codex-turn-lifecycle | 249 | 6 | KEEP | lifecycle plus real-file hydration | open turn guessed as aborted; wrong restart classification |
| codex-usage-pricing | 53 | 1 | KEEP | dated regression | cached input priced as fresh input |
| config-service | 403→404 | 8 | KEEP (type fix) | real on-disk store | provider lock/busy rules; stale revision persisted; tombstones rehydrated |
| config-store | 756 | 22 | KEEP | real fs, CAS concurrency, dated guards | lost aliases under concurrent rotation; full scan on lookup miss |
| context-breakdown | 424→410 | 20→19 | TRIM | ceil(chars/4) formula mirror dropped | 1M window metered at 200k; compaction over 100%; 16M aggregate |
| conversation-config-domain | 301→187 | 11→5 | TRIM | 4 schema mirrors; 2 tests duplicated in config-service | catalog relational invariants; half-applied transitions |
| conversation-done | 178 | 2 | KEEP | real WS into a real store | hides lost across rotation or restart |
| conversation-history | 507 | 9 | KEEP | real store, runtime and loader; cited | history rollback; wrong birth dates; poll overwriting an active runtime |
| conversation-serialization | 51→50 | 1 | KEEP (type fix) | | summary carries the full transcript, or trimming mutates live messages |
| default-working-directory | 59 | 5 | KEEP | 2026-08-18 regression | `<repo>/server` used as the workspace |
| error-journal | 208 | 5 | KEEP | real journal plus HTTP | secret leakage; unbounded rotation; no rate limit |
| event-loop-stall | 57 | 1 | KEEP | real stall | wrong drift baseline; every repeat journaled |
| jsonl-title | 54 | 3 | KEEP | real parse | wrong title precedence |
| known-projects | 29→21 | 3→2 | TRIM | happy path covered by path-security | prefix-collision authorizer; cached roots |
| lifecycle | 293→267 | 6→5 | TRIM (type fix) | port-guard mock-then-assert-called test dropped | poller baseline loss; overlapping cycles |
| muse-model | 36→0 | 2→0 | DELETE | catalog constants; replaced by a generic invariant in opencode-model-handling | — |
| opencode-model-handling | 150→102 | 7→4 | TRIM (rewrite) | catalog/builder mirrors replaced by "every listed model validates, exactly one default" across all providers | picker lists a model the validator rejects (6015f54) |
| path-security | 37 | 4 | KEEP | security boundary | traversal or prefix collision; non-loopback default bind |
| session-context | 357 | 11 | KEEP | real harness layouts | summed vs last request; sidechain rows; Codex reset |
| session-history | 99 | 7 | KEEP | cited | lost middle sessions; duplicated inherited rows |
| session-history-rotation | 398→414 | 1 | KEEP (type fix) | full loader, runtime, store and poll across restart; fake handle rebuilt as a typed handle | history truncation across capped startup and restart |
| session-loader-hydration | 639 | 10 | KEEP | cited; each test names an incident. Mock-heavy, but a rewrite is large | one bad record bricks startup; Buddy kind demoted by polling |
| shutdown | 450→413 | 11→9 | TRIM | 2 tests covered by the admitted-mutation drain test | reload kills live turns; hung flush never exits |
| startup | 145 | 3 | KEEP | ordering of the single hydration barrier | ready released before hydration |
| static-client | 34 | 1 | KEEP | real HTTP | missing `/api/*` answered with SPA HTML |
| static-client-cache | 61 | 3 | KEEP | cited in CLAUDE.md | immutable shell pins stale clients |
| subagent-tools | 64→37 | 4→2 | TRIM | label-table and Set-membership mirrors dropped | malformed agents_states kept; cancelled shown as running |
| swarm-read-model-routes | 212→222 | 4 | KEEP (type fix) | cited in `swarm/commands.ts` | path traversal; `execSync` freezing the backend |
| swarm-runtime | 181 | 4 | KEEP | regression a98d3b2e | live workers shown as dead |
| timeout-defaults | 31→0 | 2→0 | DELETE | "constant equals X"; the incident's timer guards live in buddy-coordination and conversation-runtime | — |
| tool-format | 72→48 | 7→4 | TRIM (strengthened) | the positive asserts were tautologies; now asserts the `oompa <sub> ::` marker the client consumes | launch marker missed via env, `sh -c` or chains |
| tool-integration | 118→0 | 1→0 | DELETE | live-only, and could not pass (removed field, wrong project encoding, wrong tool name); `test:live:tools` removed with it | — |
| transcript-tail-poll | 93 | 1 | KEEP | cited | full reparse per poll; half-written record lost |
| turn-attempt-journal | 373→335 | 8→7 | TRIM | logger echo-back test dropped | restart recovery; partial-line corruption |
| usage-context-async-parity | 437 | 1 | KEEP | golden parity through HTTP and fs | chunk-boundary and CRLF bugs in the streaming readers |
| websocket-lifecycle | 238 | 3 | KEEP | real WS; dated regressions | parked command dropped by reload; healthy peer killed during a stall |

### client/test

| file | L | T | verdict | reason | bug it catches |
|---|---|---|---|---|---|
| buddy-archive | 37→31 | 2→1 | TRIM | route-constant mirror dropped | archived Buddy thread resurrected by a late snapshot |
| buddy-background-tasks | 126→98 | 2 | TRIM | `parseEmployeeTab` mirror dropped | running work not listed first; `?workspace=` read as "" |
| buddy-background-visibility | 57 | 1 | KEEP (type fix) | real store | background threads leak into chat lists |
| buddy-builder-kind | 83→58 | 4→2 | TRIM | cited; keeps the legacy-purpose guard and the perf tripwire | Builder records render as general chats |
| buddy-builder-results | 168→166 | 4 | KEEP | cited | archived staff linked; wrong MCP label |
| buddy-conversation-links | 215→202 | 5 | KEEP (type fix) | cited in CLAUDE.md (42dc28a) | dead conversation id rendered as a link |
| buddy-memory | 113→111 | 5 | TRIM | the CAS error test now checks parsed revisions, not wording | legacy payload accepted; scope leaks |
| buddy-messages | 427→425 | 7 | KEEP | cited; 2026-09-24 regression | unloaded and empty rendered the same |
| buddy-project-execution | 109→107 | 3 | KEEP | cited | completed task offers a background run |
| buddy-search | 83→70 | 4→3 | TRIM | placeholder-label test dropped | filter misses role, workspace or reports |
| buddy-sidebar | 313 | 4 | KEEP (type fix) | real store | sidebar rows invented before the roster loads |
| buddy-soul-merge | 67 | 3 | KEEP | three-way merge algorithm | edits silently dropped |
| buddy-task-comments | 41→40 | 2 | TRIM | duplicate label asserts dropped | loading shown as "No comments yet" |
| buddy-team-configuration | 288→303 | 4 | KEEP (type fix) | real render | wrong permission state; former member offered as a report |
| buddy-team-execution | 129→127 | 1 | KEEP | schema-parsed fixture | deleted thread linked; retry offered wrongly |
| channel-browser | 387→419 | 6 | KEEP (type fix) | cited; 2026-09-25 paging regression | instance groups collapse; paging breaks |
| channel-buddy-dm | 35→33 | 1 | KEEP | named regression | rail name links to the Buddy page instead of the DM |
| channel-markdown | 165→163 | 5 | KEEP | three 2026-09-24 incidents | raw tool lines or markers painted |
| channel-outbox | 74→72 | 1 | KEEP | 2026-09-25 guard | optimistic post blinks out or renders twice |
| channel-text | 158 | 8 | KEEP | cited | wrong Buddy woken by a mention |
| chat-message-groups | 665→664 | 10 | KEEP | cited; real atoms, render and Codex adapter | streaming leaks into durable messages |
| client-error-fallback | 45→44 | 2 | KEEP | cited; 2026-09-20 | crash screen drops the message or stack |
| client-error-reporter | 75 | 4 | KEEP | | report storms; tokens serialized |
| composer-submission | 146 | 4 | KEEP | cited; 5c0cec4 | attachment sent twice; draft restored into the wrong thread |
| context-breakdown-meter | 166→150 | 8→5 | TRIM | threshold-constant and copy-text mirrors dropped | meter over 100% after compaction; wrong denominator |
| conversation-event-isolation | 256→255 | 3 | KEEP | cited perf guard | one conversation's events re-render another's |
| conversation-title | 56 | 4 | KEEP | named regression | hidden envelope shown as the sidebar label |
| css-classes | 92→83 | 2→1 | TRIM | the always-empty baseline check dropped; the corpus invariant is not duplicated by G6 | mobile className with no CSS rule (2026-08-18) |
| css-tokens | 104 | 3 | KEEP | invariant over all stylesheets; cited in `mobile-ui.md` | undefined `var(--x)` (2026-08-18 `--accent`) |
| detail-loader | 31 | 1 | KEEP | | stale detail overwrites newer live value |
| failed-refresh-keeps-page | 179 | 2 | KEEP | cited; 2026-09-24 | failed poll blanks a loaded page |
| folder-grouping | 50 | 3 | KEEP | cited in CLAUDE.md | worktrees split sidebar groups |
| markdown-pipeline | 130 | 4 | KEEP | cited; safety boundary | raw HTML or `javascript:` hrefs; unbounded cache |
| message-command-ack | 59→51 | 3 | TRIM (type fix) | cited | composer settles on the wrong ack |
| mobile-channels | 268→266 | 6 | KEEP | desktop-link to mobile round trip | desktop permalinks fail on mobile |
| mobile-queue | 146→85 | 6→2 | TRIM | wire-shape mirrors and a tautology dropped | `queue_updated` not reaching the view |
| mobile-queue-presentation | 33→32 | 1 | KEEP | real render | running message shown as queued |
| pending-creations | 57 | 3 | KEEP | | permanent failures retried |
| resource-cache | 311→297 | 12→11 | TRIM | one test covered by failed-refresh-keeps-page | cross-key reads; LRU; stale-on-failure |
| restart-recovery | 129→106 | 4→3 | TRIM | copy-text mirror dropped | queue mirror lost on restart |
| restore-on-load | 27 | 1 | KEEP | review of 984d00f | saved chat in a later batch never reopened |
| summary-history-refresh | 88 | 1 | KEEP | cited | open external chat never refreshes |
| turn-diagnostics | 292→256 | 13→11 | TRIM | predicate mirrors dropped; assertions merged into the render test | stale attempt shown; heartbeat shown as activity |
| upload-drain-retry | 105→90 | 4→3 | TRIM | cited; duplicate exhaustion test merged | 2026-08-20 drain gives up early |

The named regression guards cited in CLAUDE.md, docs and product docs were all kept. The only citation that changed is the `test:live:tools` script, which pointed at the deleted `tool-integration`.

## Audit table: T08/T11-owned files (verdicts only, not edited)

tsc = type errors, which is why a file is on the exclude list.

| file | L | T | tsc | verdict | reason | bug it catches / to-do for owner |
|---|---|---|---|---|---|---|
| conversation-runtime (T08) | 1388 | 29 | 25 | TRIM | drop 3: "binds server capabilities…" (fixture mirror; keep its rotated-alias assert), "turn activity distinguishes bridge heartbeats…" (deepEqual mirror), "timeout diagnostics classify…" (string restatement) | foreground deadline + joined drain; queue on interrupt; re-brief only on generation change |
| buddy-conversation-contract (T08) | 513 | 6 | 6 | KEEP | real WS creation and hydration; cited in `ws-contract-surprises.md` | replay reports a config mismatch instead of the real failure; briefing injected twice |
| buddies-integration | 59 | 2 | 0 | KEEP | 3,000-char BUDDY OPERATIONS budget (2026-09-21) | owner-thread overflow |
| buddy-archive | 125 | 1 | 0 | KEEP | real store and routes | delete leaves claims behind |
| buddy-assignment-config | 298 | 1 | 1 | KEEP | preview through to the provider request | preview config ≠ launched config |
| buddy-background-return | 555 | 6 | 0 | KEEP | cited | lost or duplicate failure returns |
| buddy-background-routes | 319 | 2 | 2 | KEEP | real HTTP | double queueing |
| buddy-background-runtime | 587 | 5 | 2 | KEEP | dated guards 2026-09-24 | orphaned past-deadline runs; pool of 5 not shared |
| buddy-blocked-recovery | 176 | 1 | 0 | KEEP | cited | blocked work not recoverable |
| buddy-builder-team | 439 | 1 | 5 | KEEP | | Builder starts work early |
| buddy-builder.integration | 604 | 3 | 12 | KEEP | restart, soul size cap | lost hires across restart |
| buddy-change-feed | 99 | 2 | 1 | KEEP | | reads fan out change events |
| buddy-closure | 133 | 2 | 6 | DELETE | duplicated by buddy-integration-closure; move 2 asserts (duplicate settlement is a no-op; `complete` without a result throws) | closure may be dead after 6a60615 |
| buddy-control-server | 85 | 1 | 3 | KEEP | security | control token not rotated |
| buddy-coordination-observation | 398 | 2 | 3 | KEEP | cited | timed-out retry spawns more than one successor |
| buddy-coordination | 862 | 6 | 7 | KEEP | cited by CLAUDE.md and the 2026-09-10 incident | 600s foreground deadline; recovery paging |
| buddy-creation-service | 225 | 2 | 1 | REWRITE-AS-INTEGRATION | 10 faked ports plus FakeConversation | dispatch-once belongs in a real-store test |
| buddy-delete-admission | 188 | 1 | 1 | KEEP | | deleted Buddy still admits turns |
| buddy-direct-reports | 219 | 2 | 0 | KEEP | cited | quotas return; retirement loses memory |
| buddy-dispatch-service | 260 | 3 | 6 | KEEP | | delegated send uses the profile default |
| buddy-efficiency-reads | 249 | 2 | 3 | KEEP | seeds via private `.db` | filters applied after pagination |
| buddy-employee-contracts | 470 | 5 | 3 | KEEP | | directory leaks routes; proposal dispatched twice |
| buddy-evidence-preservation | 235 | 2 | 0 | KEEP | | empty evidence wipes earlier evidence |
| buddy-inactive-access | 208 | 1 | 3 | KEEP | cited | revoked grants survive |
| buddy-inbox-pages | 135 | 1 | 0 | KEEP | cited | inbox unbounded |
| buddy-integration-closure | 204 | 3 | 0 | KEEP | | arbitrary JSON parsed as a review |
| buddy-knowledge-context | 110 | 1 | 0 | KEEP | | private audience leaks |
| buddy-launcher-creation | 188 | 1 | 2 | KEEP | | retried creation duplicated |
| buddy-lean-controls | 249 | 3 | 0 | KEEP | cited `TEAM_OPERATOR_GUIDE.md` | run stop kills siblings |
| buddy-lifecycle-e2e | 266 | 1 | 0 | KEEP | full loop across restart | closure loop regressions |
| buddy-mailing-lists-policy | 150 | 2 | 0 | TRIM | test 1 duplicated by mailing-lists scenario 7 | pre-change snapshot rejects list tools |
| buddy-mailing-lists | 1295 | 13 | 5 | KEEP | 4 dated owner decisions; cited | keyset paging; owner unread separated |
| buddy-mcp-bundle | 106 | 1 | 0 | KEEP | | bundle can't resolve the package |
| buddy-mcp | 480 | 7 | 2 | TRIM | 2 argv/spec deepEqual mirrors | stdio cwd regression; fail-closed providers |
| buddy-memory-capture | 300 | 4 | 2 | KEEP | | multibyte note cap bypass |
| buddy-memory-curation | 282 | 1 | 1 | KEEP | opt-in benchmark; cited by the fixtures README | (benchmark) |
| buddy-memory-review | 843 | 13 | 7 | KEEP | credit fallback ladder (2026-09-16) | silent memory outage |
| buddy-messages | 352 | 3 | 3 | KEEP | | reply-wait not durable |
| buddy-note-contract | 148 | 2 | 0 | KEEP | | byte limits differ between paths; regex injection in recall |
| buddy-operations | 550 | 5 | 3 | TRIM | drop the fake-store memory-v2 test and the delegate/review chain test (deleted in 6a60615) | self-schedule limits (2026-09-24) |
| buddy-owner-authority | 457 | 4 | 5 | KEEP | security | spoofed or foreign owner scope accepted |
| buddy-owner-inputs | 440 | 5 | 2 | KEEP | privilege boundary | queued text gains owner tools |
| buddy-owner-live | 322 | 1 (skip) | 1 | DELETE | opt-in live harness, never runs | — |
| buddy-owner-runtime | 428 | 1 | 2 | KEEP | e2e | worker→lead return needs owner authority |
| buddy-readiness-privacy | 139 | 1 | 3 | KEEP | canary strings | private failures leak |
| buddy-resource-consistency | 377 | 5 | 2 | KEEP | | paging before audience filter |
| buddy-resource-contract | 291 | 1 | 0 | KEEP | | handoff import replay duplicates |
| buddy-routes | 618 | 7 | 0 | TRIM | 2 fake-store pass-throughs; rewrite "detail classifies review…" on a real store | `claim_token` leaks |
| buddy-scheduler | 1098 | 18 | 22 | REWRITE-AS-INTEGRATION | 12 lifecycle tests on a stale fake store; keep the cron math; delete the schema-restating context test | cron OR semantics; overdue coalescing |
| buddy-soul-conflict | 229 | 2 | 2 | KEEP | concurrent CAS in worker threads | lost soul edits |
| buddy-soul | 113 | 1 | 2 | TRIM (merge) | merge into soul-conflict | new conversations miss the edited soul |
| buddy-task-comments | 167 | 1 | 0 | KEEP | | native vs HTTP contract drift |
| buddy-team-access | 362 | 1 | 2 | KEEP | 2026-09-24 decision | own schedule needs no grant; a report's does |
| buddy-team-permissions | 278 | 1 | 1 | KEEP (fix raw SQL) | | independent permissions overwrite each other |
| buddy-team-recovery | 244 | 1 | 7 | KEEP | acceptance test, SHA-pinned in `DESIGN_OWNER_TEAM_SETUP.md` | diagnostics crash on version mismatch |
| buddy-worker-mode | 108 | 1 | 0 | KEEP | | duplicate Worker |
| buddy-worker-return-live | 338 | 1 (skip) | 1 | DELETE | opt-in live harness; its evidence is already in `agent_notes/` | — |
| channel-conversations | 960 | 10 | 2 | KEEP | 6 dated regressions; cited | resumed seat re-sends root; chains stop at three |
| channel-seat-continuity | 385 | 4 | 2 | KEEP | cited as the guard (2026-09-25 audience-hash) | fresh session with 0 replies; owner authority from a Buddy trigger |
| cursor-ephemeral | 24 | 1 | 0 | KEEP | 2026-09-25 | Cursor project dir leaks memory output |

### Guards T08/T11 must carry forward (cited in CLAUDE.md, docs or src)

- **T08 (conversation-runtime):**
  - Foreground Buddy deadline gets `TURN_MAX_RUNTIME_MS`, reports `max_runtime_timeout` and joins the drain. Cited by CLAUDE.md, the 2026-09-10 incident doc, `runtime.ts` and `timeouts.ts`.
  - "interrupt keeps the pending queue…" and "promote moves a pending message first…" (`ws-contract-surprises.md`).
  - Muse→muse fork falls back to string handoff (`architecture.md`).
  - Re-brief only on memory-generation change (5c0cec4).
  - One admission tick per waiting chat.
  - Pending over capacity (2026-09-25).
  - Kind-exclusive first-turn markers (2026-09-07).
- **T11:**
  - buddy-coordination: packaged owner chats keep authority past 10 min; team-chain snapshot; recovery pages live runs only.
  - buddy-conversation-contract: replay reports the real failure.
  - buddies-integration: operations budget.
  - buddy-mcp: MCP starts from a cwd without tooling (`mcp-bundle.ts:19`).
  - buddy-memory-review: fallback ladder with distinct providers.
  - buddy-background-runtime: past-deadline recovery; shared pool of 5.
  - buddy-mailing-lists: scenario 7 policy admission; keyset paging; owner unread.
  - channel-seat-continuity: whole file.
  - channel-conversations: the six dated tests.
  - cursor-ephemeral.
  - buddy-operations and buddy-team-access: self-schedule decision.
  - buddy-team-recovery: SHA-pinned acceptance test.
  - Files cited by path whose citations need updating if they are removed: lean-controls, direct-reports, memory-curation, inbox-pages, blocked-recovery, background-runtime, background-return, coordination-observation.

## Left undone

- `session-loader-hydration.test.ts` (mine) is mock-heavy (`as unknown as` dependency objects). It is kept because every test names an incident and it is cited; converting it to real-boundary tests is a larger rewrite. It is the top REWRITE candidate among the files I owned.
- `client/test/fixtures/{ceo-browser,team-settings-draft}-server.mts` are manual harnesses cited in product docs, not tests. They are excluded from the client test typecheck and still have about 20 type errors each; I left them alone.
