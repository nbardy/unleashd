# Architecture in One Page

Moved out of AGENTS.md (startup-context size limit). File-level roles live in
the AGENTS.md code tree map; this doc is the why behind the layout.

## 1) Provider abstraction is the integration seam

Provider-specific CLI details are expressed through a shared contract, split
between the build-time contract in `agent-cli-tool` (harnesses + builder +
types), the server provider runtime (`server/src/providers/*`), and shared
provider IDs/catalog schemas in `shared/src/provider-catalog.ts` (re-exported
through `shared/src/index.ts`). Selection intent, patches, and resolution share
`shared/src/conversation-config.ts`; see [pass-through pattern](pass-through-pattern.md).

## 1.5) Shared agent CLI stays a thin wrapper

The `vendor/agent-cli-tool` submodule is deliberately small. Its job is:

1. take one canonical request shape
2. map that request into harness-specific argv
3. run the real CLI process
4. parse harness-specific stdout/stderr
5. emit one unified event stream

The submodule implementation lives in `src/build.ts`, `src/process-runner.ts`,
`src/parsers/`, `src/execute.ts`, and `src/runtime-types.ts`.

### Core rules for `vendor/agent-cli-tool`

1. **One input model, one output model.**
   Callers should pass one canonical request object. Harnesses may have
   different raw JSON/event formats, but the submodule emits one shared event
   union (`session.started`, `turn.started`, `text.delta`, `tool.use`,
   `progress`, `stderr`, `error`, `out_of_tokens`, `turn.complete`).

2. **Harness-specific differences belong at the edges.**
   Harness config owns argv syntax. Harness parsers own raw-output translation.
   Do not spread provider conditionals through the generic executor.

3. **The submodule is not an app runtime.**
   No conversation model, no merge/swarm orchestration, no sidebar/UI state, no
   product-specific subagent data model. The submodule only reports normalized
   runtime facts.

4. **Per-harness JSON in, unified JSON out.**
   Think of each parser as:
   `raw harness JSON/events -> unified events`
   The parser may keep small local state when the provider protocol requires
   it (for example streamed tool-call reconstruction), but that state must stay
   parser-local.

5. **Session helpers are separate from parsing.**
   Resume/fork/session-id capture are executor/session concerns, not parser
   concerns. Keep filesystem/session emulation out of harness config except as
   explicit helper hooks.

6. **When adding a harness, prefer extension over branching.**
   Usually this means:
   - add/update harness config in `src/harnesses/*`
   - add/update one parser in `src/parsers/*`
   - add a focused session helper only if the harness truly needs one
   Avoid growing `execute.ts` into another monolith.

7. **Test the contract, not implementation trivia.** Build-command contract
   tests, shim-CLI integration tests, and opt-in captures under
   `manual_tests/` (for studying harness drift — not every live-debug script
   becomes an automated test).

## 2) Registry-first persistence

Persisted sessions are loaded through the adapter registry
(`server/src/adapters/{registry,disk-adapter,loader}.ts`).

Adding a provider means adding:
- a harness,
- a server provider,
- a disk adapter (if persisted artifacts are needed).

Startup imports use `ConversationConfigStore.withSessionLookupIndex` to scan
saved configuration identities once. Without it, every unfamiliar native session
can trigger two full record scans, even when its transcript hits the session cache.
The temporary index maps session IDs to conversation IDs; every hit still reads
the authoritative record, and store writes update the index during the import.
The index is released on completion or failure. Normal lookup and index repair
resume afterward; unindexed writes from another process are discovered then.
This optimization preserves the existing hydration/readiness barrier.

### 2.1) Rehydration: the durable record owns Buddy identity

Two independent stores describe a Buddy conversation, and only one of them is
rebuilt on restart:

| Surface | Source | Survives restart |
|---|---|---|
| Buddies page conversation list | `conversation_links` rows in the Buddies SQLite, written once at creation | yes, unconditionally |
| Sidebar "Buddies" group | live runtime `kind` (`isBuddyConversation`) | only if rehydration recovers it |

`sessionToConversation` (`disk-adapter.ts`) **never returns a nullish `kind`** —
it falls back to `{kind:'general'}` when the transcript carries no
`<!-- unleashd:buddy-context-v2 -->` marker. So in `session-loader.ts` any
`source.kind ?? durableFallback` chain is a bug: the `general` default
short-circuits it and the durable fallback becomes dead code. Resolve kind by
**first specific candidate wins**, never first non-null.

This bit Chat "Fork". A fork inherits its buddy identity server-side from
`resumedFromConversationId` (`conversation-websocket.ts`) and persists it to
`creation.buddyContext`, but the marker is only injected on a first turn that
has a briefing (`runtime.ts`), and forks are created without one — so a fork's
transcript never carries the marker. Before the fix, every restart rehydrated
forks as `general`: they vanished from the sidebar's Buddies group and lost
buddy MCP scoping while their link row stayed live. The visible symptom was
"N conversations on the Buddies page, N-1 in the sidebar".

Regression guard: `server/test/session-loader-hydration.test.ts`.

Related: link rows are never deleted — deletion only flips status to `cancelled`
(`transport/conversation-websocket.ts`), which is also what a stopped or killed turn writes
(`runtime.ts`). **Never filter the Buddies page on link status** — it would hide
live conversations. `GET /api/buddies/:buddyId` instead asks the config store
for a tombstone (`isConversationDeleted`), the only unambiguous "this is gone"
signal. Links carrying only a `provider_session_id` are kept: there is no
conversation record to tombstone them against.

## 3) Conversation lifecycle and state authority

The `Conversation` class is created by `createConversationRuntime` in
`server/src/conversations/runtime.ts`. `server/src/server.ts` composes its
dependencies and registers `server/src/transport/conversation-websocket.ts`.
Durable config and revision checks belong to `conversations/config-service.ts`
and `conversations/config-store.ts`.

Flow is:
1. Client sends creation intent with stable command and conversation IDs.
2. Server validates and persists config, materializes the runtime, and acknowledges creation.
3. Sending a message (including an initial message) resolves an execution snapshot and spawns the provider.
4. Events update runtime state and stream to the client; completion reconciles and broadcasts authoritative snapshots.

`server` state remains authoritative while the provider process is active.
Poller/loader merges skip active in-memory IDs.

### Two things are called "fork"

| | Chat "Fork" (soft handoff) | Merge session-fork |
|---|---|---|
| Trigger | Fork button (`atoms/fork-actions.ts`) | `POST /api/conversations/merge` |
| Carries | transcript as draft text | the native CLI session |
| Provider gate | none — any provider, any pair | `FORK_CAPABLE_PROVIDERS` |

Chat Fork **opportunistically upgrades** to session inheritance on its first
send when the source is the same provider *and* that provider is fork-capable
(`runtime.ts` `sendMessage`). Everything else stays string handoff. That upgrade
must never reject the send.

It did once: the branch checked only `source.provider === this.provider`, so a
muse -> muse fork handed a session id to a harness with neither
`sessionForkFlags` nor `emulateFork` and the turn died with `Harness "muse"
does not support fork.` (`vendor/agent-cli-tool/src/session.ts`). muse -> claude
and claude -> muse worked, which made it look provider-pair specific — it was
capability, not pairing. Same latent bug applied to cursor -> cursor. The gate
is now `providerSupportsFork(this.provider)`; guard:
`server/test/conversation-runtime.test.ts`.

### Backend reload, drain, and the dev watcher (liveness rules)

`server/src/lifecycle/shutdown.ts` is the only mutation-admission and
process-lifecycle authority. States: `starting → idle`, and `starting|idle →
reloading → exiting`.

**`reloading` is absorbing — so a source reload must not enter it while work is
active.** A reload request remains pending while the old backend retains sole
ownership of every provider stream and automation wrapper. Its current admission
policy stays in effect: `idle` accepts mutations; `starting` admits only WebSocket
`create_conversation`. Other WS commands await the startup barrier, and HTTP
mutations (including New Buddy's builder request) receive `503 server_starting`
until `idle`. At an observed idle boundary the controller pauses the scheduler,
synchronously rechecks all work counters, and
only then enters `reloading` and exits. If work appeared, it resumes the
scheduler and keeps waiting. Hot reload has no force/quiesce deadline: such a
deadline must either kill admitted work or strand the app read-only. Provider
watchdogs bound provider turns; SIGINT/SIGTERM are the explicit bounded operator
recovery paths. The alternatives and tradeoffs are recorded in
`agent_notes/2026-08-24_automation-execution-ownership-design.md`.

The remaining hard bounds are specific to explicit shutdown and final flushing:

| Bound | Constant | Protects against |
|---|---|---|
| shutdown drain | `HOT_RELOAD_FORCE_EXIT_GRACE_MS` (3s) | work `interrupt()` cannot clear |
| flush watchdog | `SHUTDOWN_FLUSH_GRACE_MS` (5s) | `exiting` wedged by a hung flush |

The flush watchdog is the subtle one: `exitOnce()` calls `clearTimers()` *before*
awaiting `flushState()`, so without it a `turnAttemptJournal.flush()` that never
settles leaves the process alive in `exiting` with nothing armed to rescue it —
the same user-visible error, but permanent. It is armed after `clearTimers()`
deliberately. Force-drain also resets its counters *before* calling `interrupt()`,
because the explicit-shutdown force timer is one-shot and a throw there would
strand `shutting_down`.

The startup barrier (`initialLoadComplete`) means "startup is no longer in
progress", **not** "startup succeeded". A reload arriving mid-startup makes
`completeStartup()` return false; every terminal outcome must still resolve the
barrier (see the `.finally` in `server.ts`) or non-create WS commands await it
forever with no reply. Recovery of durable records is per-record fault-isolated
for the same reason — it runs inside the barrier, so an unreadable record used to
reach `handleStartupFailure()` and exit the process.

**Watcher contract** (`tools/watch-server.mjs`): the watcher keeps a backend
running. A close it did not orchestrate — including a clean `exit(0)` from a
manual `kill`, and any signal — is a **restart**, bounded by
`unexpectedExitStreak` (escalates after 3 lives that never reach
`HEALTHY_UPTIME_MS`). Treating those as fatal is what made a single `kill` set
`process.exitCode = 1` and let `concurrently --kill-others-on-fail` tear down
shared-esm/shared-cjs/cli/client (incident 2026-08-20,
`agent_notes/2026-08-20_reload-drain-and-watcher-teardown.md`). Quick failures
(<3s, or an esbuild Transform error) keep their own separate retry budget.

## 4) Client state frequency budget

Streaming is separated from structural state:

- Structural: `conversationsAtom`, `allConversationsAtom`, IDs.
- High-frequency stream text: dedicated stream buffers / streaming atoms.

`streamingContentAtom` is separate from `conversationsAtom`. Pending creation
and config commands also have separate atoms; they are not partial server
conversations. Summary transport projections do not replace the durable/runtime
record; full transcripts hydrate through the detail route.

Details and code patterns: [client state](client-state.md) and
[WS contract notes](ws-contract-surprises.md).
