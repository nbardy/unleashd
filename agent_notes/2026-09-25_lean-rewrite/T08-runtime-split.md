# T08 — Detangle `runtime.ts` (report, 2026-09-25)

Branch `refactor/runtime-split` (worktree `.claude/worktrees/agent-af139a719a16dea6b`), branched from
`lean/integration` @ 4db9a1c. `lean/integration` @ 5b0dffb (T17 + the patterns doc) is merged in. The branch is
not merged back into lean/integration and not pushed. Tree is clean at HEAD `d7613fd`.

## Commits (oldest first)

| SHA | Step | What |
|---|---|---|
| 4a4bb1b | S1 | Fold `UnifiedAgentEvent` directly; delete `ProviderEvent` (providers/index.ts) and `handleOutput`'s second switch |
| 17fd196 | S2 | One turn-request shape for every harness (the 3-branch provider ternary is gone) |
| af0fc27 | S3 | Sub-agent folds chosen once per turn from a harness table; codex collab handling moves into the codex fold; dead `_pendingTaskTools` deleted |
| 1cc8405 | S4 | `TurnQueue`, a queue state machine with no I/O; turn input types in `turns/input.ts` |
| 9b4bdf7 | S5 | `TurnWatchdog` (bridge / provider-idle / max runtime, with budgets passed in explicitly) |
| d862940 | S6 | One async `SwarmObserver` per folder replaces the per-conversation 2 s sync poller; `readLatestSwarmRuntime` is async |
| 3065185 | S7 | Buddy behavior becomes `TurnPolicy`, chosen once by kind: `ChatTurnPolicy` (no-op), `BuddyTurnPolicy`, `BuddyBuilderTurnPolicy` |
| 6919aec | — | Merge `lean/integration` (5b0dffb) |
| 3957592 | T17 follow-up | `conversation-runtime` and `buddy-conversation-contract` now typecheck and are off the exclude list; the 3 mirror tests are trimmed |
| 4512e4c | S8 | `TurnRunner` + `EventFold` extracted; Conversation = record + queue + runner + policy |
| d7613fd | docs | Pattern tags; architecture / agent_client_spec / ws-contract / pass-through docs updated |

Each code commit passed `pnpm typecheck` and `pnpm test:server`.

## Module map (lines, `wc -l` at HEAD)

| Module | Lines | Job | 05 budget |
|---|---:|---|---:|
| `conversations/runtime.ts` | **1,086** (was **3,395**) | record, queue ops, input admission (gate, Chat Fork, preflight), config, `policyFor`, toJSON; also serves as the runner's host | 250 (`conversation.ts`) |
| `turns/runner.ts` | 1,052 | spawn through agent-cli, `EventFold` (one handler per event type), drain paths, stop/reset/timeout, attempt records | 450 (+150 `record.ts`) |
| `turns/queue.ts` | 141 | `TurnQueue`: transitions with no I/O | 200 |
| `turns/watchdog.ts` | 225 | `TurnWatchdog` + timeout description + activity classification | 120 |
| `turns/policy.ts` | 181 | `TurnPolicy` interface + `ChatTurnPolicy` | 60 |
| `turns/subagents.ts` | 281 | sub-agent folds + the `SUB_AGENT_FOLDS` harness table | (in runner) |
| `turns/input.ts` | 33 | `TurnInput`, `SessionRelativePrompt` | — |
| `buddies/turn-policy.ts` | 1,022 | Buddy + Builder policies, memory snapshots, first-turn encoders, admission tick | B scope (T11) |
| `swarm/observer.ts` | 178 | per-folder async observer + swarm sub-agent rows | 700 (swarm total) |
| **New modules total** | **3,113** | | |

**Against budget.** The Conversation core fell from 3,395 lines to 1,086 (−68%), but it is still 4× its 250-line
budget. The turn modules total about 1,900 lines against about 830 budgeted. Code moved more than it was cut:
runtime.ts plus the new modules come to 4,199 lines, against 3,395 + 58 before, because of explicit interfaces
(host/ports/policy) and moved comments. The budgets also assume three things that belong to other tasks:
- About 1.2k lines of incident comments move to docs (T14). Most of the runner's and policy's bulk is these carried comments.
- The Buddy policy's 1,022 lines are replaced on the Rust core (T11).
- `ConversationRuntime`, the options and the dependency interfaces (~250 lines of runtime.ts) shrink with the sum-typed Conversation and wire (T09).

## Checklist against the task

- `ProviderEvent` is deleted and events are typed once. `git grep ProviderEvent HEAD -- server` finds only docs.
- The provider ternary is one expression. The only cast left covers agent-cli's `reasoningEffort?: never` on the
  harnesses without effort; agent-cli already maps effort only for claude, codex and muse (execute.ts:235).
- There is no `this.provider === 'codex'` in the core. The codex collab handling is the codex entry of
  `SUB_AGENT_FOLDS`. I did not switch the server to agent-cli's existing `subagent.state` event, because that
  would change the description and toolUses the UI shows. The fold ignores it explicitly (documented). The
  submodule was not touched.
- Buddy code moved intact into `BuddyTurnPolicy`; nothing was redesigned. The policy is selected in one
  dispatcher (`policyFor`, over `matchConversationKind`). Setting `kind` re-selects it, because the session
  loader can promote a general conversation to a Buddy kind.
- The dependency bag is split: `ConversationRuntimeDependencies extends BuddyTurnPolicyDependencies`. The
  factory signature is unchanged, so `server.ts` and all tests still build it as before.
- The wire schema is unchanged.

## Invariants preserved (reason comment + guard test)

| Invariant | Lives in | Guard test |
|---|---|---|
| Foreground Buddy deadline = `TURN_MAX_RUNTIME_MS`; expiry is `max_runtime_timeout`, never `user_stop`; ownership waits for the joined drain | `buddies/turn-policy.ts` `admitForegroundChatRun` / `ownForegroundRun`, `turns/watchdog.ts` | `foreground Buddy deadline uses the conversation budget and reports timeout after joined drain`, `background deadline uses timeout classification and waits for provider drain`, buddy-coordination |
| Bridge, provider-idle and max runtime are separate clocks; a timer heartbeat cannot mask provider idleness | `turns/watchdog.ts` | `timer-only heartbeats cannot mask provider idleness, while native advancement can`, `bridge watchdog terminates a turn when neither unified events nor heartbeats arrive` |
| Interrupt keeps the queue; `retireInFlightHead`; promote interrupts | `turns/queue.ts` | `interrupt keeps the pending queue and sends the new message first`, `interrupt with no active turn sends ahead of the queue`, `promote moves a pending message first and interrupts the turn` |
| Completion waits for event drain + session persist (one joined terminal path) | `turns/runner.ts` `start` | `provider completion waits for the normalized event stream and session persistence`, `event-stream failure after turn.complete fails automation after joined drain` |
| Re-brief only when the memory generation changes (2026-09-24, 44 copies / 835k chars) | `BuddyTurnPolicy.prepare` | `resumed Buddy turns re-brief only when the memory generation changes` |
| Audience continuity (contained → resume) | `BuddyTurnPolicy.admitAudience` | channel-seat-continuity, `retained Buddy display history stays out of fresh provider context across audience resets` |
| `buddy_post` never carries owner authority (B1); queue text is never provenance | `turns/input.ts`, `ownerControls` | buddy-owner-inputs (`Builder unknown and restored queue inputs…`, adapted to enqueue without owner input) |
| Buddy grant issued before the owner grant, because `issue()` revokes previous grants (found during the move; now commented) | `BuddyTurnPolicy.startTurn` | buddy-owner-inputs (owner + buddy servers share the token) |
| One shared admission tick; waiting stays pending; stop drops the waiter | `buddies/turn-policy.ts` | `waiting Buddy chats share one admission tick…`, `a foreground Buddy turn over capacity waits pending…`, `stopping a turn that waits for a run slot…` |
| Muse→muse fork falls back to string handoff (capability, not provider equality) | `chatForkSource` | `same-provider fork on a fork-incapable harness falls back to string handoff`, the two other fork tests |
| Kind-exclusive first-turn markers | `buildFirstTurnCliContent` (dispatcher over 3 encoders) | `first-turn markers are kind-exclusive: builder, buddy, general` |
| Effort reaches argv for claude/codex/muse | runner request | **new** `every harness receives its resolved effort in one request shape` |
| Codex collab rows are native; parent completion does not settle them | `turns/subagents.ts` | **new** `codex collab threads become native sub-agents that parent completion leaves alone`, `a Task tool starts a generic sub-agent that parent completion settles` (both also pass against the pre-S3 code) |
| Swarm: one poller per folder, async fs, UI rows still appear/complete | `swarm/observer.ts`, `swarm/runtime.ts` | **new** swarm-observer.test.ts: `turns in one folder share one swarm poller`, `a swarm launched during a turn becomes a sub-agent row that completes when it stops`, `a swarm runtime read never touches synchronous fs` |
| Stall monitor stays wired | `noteActivity` labels `timer swarm-observer`, `timer turn-watchdog <kind>`, `timer buddy-chat-admission` | event-loop-stall.test.ts |

Pattern tags added: `pure-core` (TurnQueue), `sum-types` (TurnPolicy, `policyFor`), `wake-on-write` (admission
tick, SwarmObservers), `table-driven` (SUB_AGENT_FOLDS), `fix-guards` (TurnWatchdog). The deleted ProviderEvent
layer is already listed under `deep-modules`. `docs/patterns.md` "Here:" entries are updated.

## Test changes

- The three T17-listed mirrors in conversation-runtime are removed. "binds server capabilities" keeps its one real
  assertion as `a session reset rotates the provider session and re-registers its alias`.
- `test/fixtures/fake-turn.ts` (`FakeTurn` / `fakeExecuteTurn`) types scripted turns against the fields the runtime
  reads. It replaces 14 casts.
- Three fork tests monkey-patched the private `spawnForMessage`. After S8 moved it, they spawned **real**
  providers: one muse turn ran for 123 s inside the test suite. They now capture at the `executeTurn` boundary
  (`captureSpawns`).
- Oompa stubs are `async` in 15 suites, matching the async read.

## Verification (at HEAD, clean tree)

```
pnpm typecheck      exit 0   (includes server/tsconfig.test.json; the T08 excludes are removed)
pnpm test:server    tests 456 · pass 451 · fail 0 · skipped 5
biome check         clean on every touched file
```

Load average was 135–207 during the runs. One full run on the merged tree failed two timing tests I did not touch
(`swarm context runs oompa without blocking…`, `liveness terminates a half-open peer…`). Both passed alone and in
the final full run. `pnpm test:client` was not run because the client is untouched.

## Follow-ups (not done here)

- The runner and policy carry ~40% comments (incident stories). T14 moves them to docs and leaves one-line pointers.
- Fold agent-cli's `subagent.state` and delete the codex fold. This is a UI-visible change (description and toolUses), so it needs a decision.
- The swarm routes' `oompa-config` and `swarm-reviews` handlers still use sync fs (T10).
- `TurnQueue` mutates its own entries rather than being `(state, event) → (state, effects)`. It is pure in the
  no-I/O sense only; the `pure-core` entry in docs/patterns.md describes it that way.
