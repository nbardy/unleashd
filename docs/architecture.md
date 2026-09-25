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
   No conversation model, no swarm orchestration, no sidebar/UI state, no
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

8. **MCP servers are a sum type: `{kind:'stdio'}` or `{kind:'http', url,
   headers}`.** Each harness has one encoder per kind (`src/mcp-encoding.ts`
   dispatches). HTTP header values (the per-turn bearer) travel in the CLI's
   environment wherever the CLI can expand them (claude `${VAR}`, codex
   `env_http_headers`, cursor `${env:VAR}`); muse cannot, so its token sits in
   a 0600 settings dir that `runCommand` deletes when the process exits.
   Claude (HTTP, verified 2026-09-25) and cursor (stdio, verified 2026-09-24)
   drop a failed server SILENTLY and the turn succeeds, so the runner probes
   every required HTTP server on every harness (`initialize` + `tools/list`,
   `src/mcp-startup.ts`) and fails the turn on a dead URL or rejected token.
   Muse reads `mcpServers`, not the legacy `mcp_servers`: with both keys
   present it drops every MCP server.

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
The first scope builds an in-memory index (session ID → conversation IDs) from
that scan, and the index then lives for the process: every write through the
store maintains it, so after startup a lookup miss is the answer and never
rescans. Until 2026-09-25 it was dropped when the scope ended, and each miss the
poller made for a new external session (up to 3 per session) read all ~7,800
records (~3.2s). Every hit still reads the authoritative record. Another
process's writes are found through the durable `by-session/` index it maintains,
which lookup consults first; a record with no durable entry (older versions) is
covered by the startup scan. The scope's cached record scan (served by `list()`)
is released on completion or failure. This optimization preserves the existing
hydration/readiness barrier.

**Startup cost rules** (2026-09-25: the barrier took 67-102s on ~7,700 sources
and ~7,800 records; these brought it to 14-20s on the same data). Each is
guarded by a test; every one of them regressed by growing with history size.

- **One record scan per startup, and nothing waits for it.** The lookup scope's
  scan runs alongside discovery; only a lookup miss awaits it. `list()` inside
  the scope serves that scan plus fresh reads of records this store wrote since —
  recovery used to rescan all records a second time.
- **No per-binding scan of sources.** Adapters declare `sessionFileKeys(path)`;
  the loader indexes discovery once. A `matches(file, id)` predicate made each
  binding walk every source (O(bindings × sources), ~8s).
- **No per-row work for a lone transcript.** `mergeSessionMessages` returns a
  single source unchanged; the general merge stringifies every row.
- **Recovered conversations stream.** They broadcast in batches like transcript
  batches, and recovery runs 16-wide. `conversation_load_complete` only prunes
  the client's list; it never adds.
- **Do not reintroduce per-file work on boot** that does not scale with the
  newest 500 sources (e.g. the removed chmod of every session-cache record).
- **The session cache holds only live sources.** After a discovery that failed
  for no provider, startup deletes records outside the discovered set (13,375 →
  7,475 records). Never prune after a failed discovery: it would drop that
  provider's whole cache.
- **Recovery dispatches only pending first messages.** A record whose
  `initialMessage` is absent or dispatched skips the claim (two record reads).

### 2.0) A config record is not a conversation

Startup hydrates only the newest `STARTUP_INITIAL_LOAD_LIMIT` (500) transcripts;
the mtime baseline still records every source, so `limit` is a real hydration
cap and the omitted history does not look "new" to the first poll.

The config store writes one durable record per session it has ever seen,
tagged `provenance: 'external_discovered'`. That record is a **sidecar for a
transcript on disk, not evidence that a conversation exists.** Only records the
app itself created (`user` / `legacy_inferred`) may be materialised without a
transcript — those are the ones that genuinely have nothing on disk yet, e.g. a
new thread whose first message has not dispatched.

`recoverConversationsWithoutTranscripts()` ignored provenance and recovered all
6,143 active records. Every un-hydrated session came back as a message-less
conversation stamped `createdAt = now`: **5,275 of 5,633 conversations in the
init payload on 2026-09-06**, all titled "New conversation — 1m ago", all
sorted into the top of the sidebar's recent-folder groups. A recovered
conversation now also keeps `record.createdAt`, so history with nothing on disk
cannot claim it was created at boot.

Consequence to keep in mind: a conversation older than the hydration cap is
absent from the sidebar until polling or a raised cap hydrates it. That is the
designed meaning of the cap — an empty row for it was never a better answer,
since `GET /api/conversations/:id` serves the registry and would have returned
an empty transcript anyway.

Regression guard: `server/test/session-loader-hydration.test.ts`.

Stable tool instructions belong in native tool descriptions or the dedicated
model instruction channel. Keep authored text intact; scope generated workflow
context to the selected operation. Display cleanup runs independently of durable
identity: Builder, Buddy and swarm envelopes must not become user messages
after reload. (The merge feature and its `unleashd:merge-prefix` envelope were
deleted on 2026-09-25; old merge transcripts now display the injected reviews as
ordinary first-message text.) Complete reserved envelopes pasted at the start of user text remain ambiguous.
Tests cover live provider input, imported/cached display and literal user quotes;
see `product/buddies/AUDIT_PROMPT_PLACEMENT_2026-09-12.md` for rationale and limits.

Codex app transcripts can store `AGENTS.md` and environment setup as user-role
`response_item` messages ahead of the real prompt, and again on resumed turns.
The adapter filters their `content_item_kinds` provenance tags before extracting
visible text; do not hide actual user text based on an `AGENTS.md` prefix.
The same filter removes `plugins.recommendations`. Codex 0.146 predates those
tags: recognize its complete three-block recommendations/AGENTS/environment
bundle only at startup, with turn metadata and no provenance tags. Preserve
explicit user text, standalone pastes, and later untagged messages. Cache v6
reparses old projections so resumed history no longer becomes a plugin-list title.
Buddy envelope removal runs independently of durable identity and checks every
user message, since the briefing need not occupy the first row. Durable kind
still wins over recovered marker identity. Parser changes must invalidate the
normalized session cache so unchanged older transcripts are repaired on reload.
Regression guard: `server/test/codex-buddy-transcript.test.ts`.

Codex tool calls must survive both the event-message and response-message history
paths. Retain function/freeform calls in transcript order and deduplicate them by
call identity, not their formatted text. Otherwise polling replaces the live tool
activity with a prose-only transcript. Preserve commands, JSON arguments and
freeform scripts in `Message.toolCall.input`; formatting just the tool name loses
the information the expanded history should show. Render input as literal code
and omit it from bounded sidebar summaries. Cache v5 reparses earlier projections
to restore those details. Guards: `server/test/codex-tool-history.test.ts` and the
disk-to-desktop/mobile render case in `client/test/chat-message-groups.test.tsx`.

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
`server/src/conversations/runtime.ts`: record + `TurnQueue` (`turns/queue.ts`) +
`TurnRunner` (`turns/runner.ts`) + a `TurnPolicy` chosen once by kind
(`turns/policy.ts`, `buddies/turn-policy.ts`). Timeouts are `turns/watchdog.ts`,
swarm observation `swarm/observer.ts`. `server/src/server.ts` composes its
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

The poller resumes an append-only transcript (Claude) from its last byte
offset instead of re-parsing it (`server/src/adapters/transcript-tails.ts`,
`DiskAdapter.growth`). Before this, a still-running 120MB external Claude
session cost ~1.2s of main-thread parsing every 5s and queued every WS command
behind it (2026-09-25). After it, the same poll takes ~15ms. A resume is taken
only when the file provably only grew: same inode, no shrink, and unchanged
bytes just before the offset. Any other case is a named full read. Codex,
Cursor, Gemini, OpenCode and Muse stay `rewritten` (full parse). Codex could be
next, but its turn lifecycle and final sort need the whole file first. Guard:
`server/test/transcript-tail-poll.test.ts`.

Buddy provider-session bindings also persist the host-resolved disclosure audience.
On restart, the runtime compares that saved key with freshly resolved access before
resuming. Matching access preserves native conversation context and still receives
the current briefing and MCP configuration. Changed access or legacy bindings with
no saved audience start a fresh session while retaining display history. Memory
revision changes alone do not reset a session. Audience metadata is written when
the provider confirms its session ID, never inferred from transcript text.

### Chat "Fork" and provider-session inheritance

Chat "Fork" (`atoms/fork-actions.ts`) is a soft handoff: a new conversation with
`resumedFromConversationId` lineage and the transcript as draft text. Any
provider pair works.

It **opportunistically upgrades** to native session inheritance (CLI `--fork` /
`emulateFork`) on its first send when the source is the same provider *and*
that provider is in `FORK_CAPABLE_PROVIDERS` (`runtime.ts` `sendMessage`).
Everything else stays string handoff. That upgrade must never reject the send.
(Merge, the only other session-fork user, was deleted on 2026-09-25.)

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

**One dev process** (`tools/dev-supervisor.mjs` + `tools/dev-runtime.mjs`):
`pnpm dev` hosts the three TypeScript watch compilers (shared ESM, shared CJS,
agent-cli-tool), Vite and the backend runner in the supervisor process through
their JS APIs; only the backend server is a child. The backend and Vite start
after every compiler's first pass, so no compiler output lands on a backend
mid-boot and there is no separate pre-build. It replaced concurrently plus a
`pnpm --filter` wrapper per tool (18 processes → ~5, 2026-09-25); memory is
about the same, the saving is processes and a deterministic start order.

**Watcher contract** (`tools/watch-server.mjs`): keep exactly one backend
running the code on disk.

- **What to watch is derived, never configured.** The backend runs with Node's
  `WATCH_REPORT_DEPENDENCIES` protocol and reports every file it loads —
  `server/src`, `shared/dist`, and `node_modules` alike — and one recursive
  watch on the repository is filtered against that set. The hand-written list it
  replaced omitted `node_modules`, so a vendored Buddies upgrade never reloaded
  the backend (2026-09-23).
- **Rust crates rebuild on save.** The backend loads each crate's addon
  (`crates/<c>/*.node`), never its `.rs` files, so a saved `src/**/*.rs`,
  `build.rs` or `Cargo.toml` runs `tools/ensure-addons.mjs` for that crate (one
  at a time): a cache copy when any worktree built those sources, else a
  throttled cargo build. Only addon crates (a napi `package.json`) rebuild; the
  import CLI crates never do. The rewritten addon then reloads the backend like
  any loaded file; a failed build keeps the current addon (T14b, 2026-09-26).
- **New code must build before the old backend is asked to drain.** One esbuild
  bundle of `src/server.ts` (~60ms) catches syntax errors and missing exports;
  on failure the current backend keeps serving.
- **Only a real content change reloads, judged after the writes settle.** Every
  `pnpm dev` start re-emits `shared/dist` and the agent-cli-tool `dist`
  byte-for-byte, and `tsc` truncates each file before writing it. The runner
  compares touched files against the digests the backend loaded once events go
  quiet, never per event. Digesting per event read the empty intermediate as a
  change and restarted a backend mid-startup, so the history loaded twice
  (2026-09-25).
- **Any exit it did not request is a restart**, with backoff doubling to 30s and
  resetting after 30s of healthy uptime. It never gives up: giving up is what let
  `concurrently --kill-others-on-fail` tear down the whole dev runtime after a
  single `kill` (incident 2026-08-20,
  `agent_notes/2026-08-20_reload-drain-and-watcher-teardown.md`).
- **The backend never outlives the watcher.** `shutdown.ts` treats losing the
  IPC channel as SIGTERM; an orphan from 01:31 on 2026-09-23 kept the port and
  served stale code after its supervisor was replaced.

## 4) Client state frequency budget

Streaming is separated from structural state:

- Structural: `rowsAtom` (per-id records) and the one-pass `listIndexAtom`
  whose fields are the collection views. See
  [client state](client-state.md#an-event-costs-what-it-changed-2026-09-25).
- High-frequency stream text: dedicated stream buffers / streaming atoms.

`streamFamily(id)` is separate from `rowsAtom`. Pending creation and config
commands live in `commandsAtom`; they are not partial server
conversations. Summary transport projections do not replace the durable/runtime
record; full transcripts hydrate through the detail route.

Details and code patterns: [client state](client-state.md) and
[WS contract notes](ws-contract-surprises.md).
