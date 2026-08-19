# Architecture in One Page

Moved out of AGENTS.md (startup-context size limit). File-level roles live in
the AGENTS.md code tree map; this doc is the why behind the layout.

## 1) Provider abstraction is the integration seam

Provider-specific CLI details are expressed through a shared contract, split
between the build-time contract in `agent-cli-tool` (harnesses + builder +
types), the server provider runtime (`server/src/providers/*`), and shared
provider IDs in `shared/src/index.ts`.

## 1.5) Shared agent CLI stays a thin wrapper

The `vendor/agent-cli-tool` submodule is deliberately small. Its job is:

1. take one canonical request shape
2. map that request into harness-specific argv
3. run the real CLI process
4. parse harness-specific stdout/stderr
5. emit one unified event stream

Which file owns which step is in the AGENTS.md code tree map
(build.ts / process-runner.ts / parsers / execute.ts / runtime-types.ts).

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

## 3) Conversation lifecycle and state authority

Authoritative in-memory model is `Conversation` in `server/src/server.ts`.

Flow is:
1. Client creates conversation.
2. Server validates + spawns provider process.
3. Chunk + message events are streamed into buffers/state.
4. On completion/close, queue/status/message boundaries are reconciled and broadcast.

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

## 4) Client state frequency budget

Streaming is separated from structural state:

- Structural: `conversationsAtom`, `allConversationsAtom`, IDs.
- High-frequency stream text: dedicated stream buffers / streaming atoms.

Details and code patterns: AGENTS.md "Writing state subscriptions" /
"Writing state mutations".
