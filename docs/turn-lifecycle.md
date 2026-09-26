# Turn lifecycle: reasons behind the server core

Code keeps a 1–3 line reason comment and the guard's name at each site
(docs/patterns.md#fix-guards). The longer story lives here, keyed by the anchor
the comment cites.

## one-terminal-path

`executeCommand().completed` describes child-process termination, not consumption
of the normalized event stream, and session persistence is asynchronous. Releasing
ownership before the event consumer drains could start the next queued turn while
text/session/turn.complete events from this one were still being applied. One
joined terminal path (`TurnRunner.start`: `await eventConsumption` then `settle`)
is simpler than making every handler replay-safe.

The same rule covers failures that happen before any child exists: a synchronous
spawn throw (`TurnRunner.start`) and a configuration preflight refusal
(`Conversation.refusePreflight`) have no later completion event, so each
terminalises the attempt and emits `buddy-turn-failed` at the single point that
owns the error. An automation subscribes to that event before `sendMessage()`, so
its `runTurn` promise never waits for its outer timeout. History:
`agent_notes/2026-08-24_automation-execution-ownership-design.md` (invariant I8).
Guards: `provider completion waits for the normalized event stream and session
persistence`, `event-stream failure after turn.complete fails automation after
joined drain`.

## early-turn-complete

A timeout or stop seals the stream: later provider events are dropped so they
cannot resurrect or complete the turn twice. A normal `turn.complete` does NOT
seal. On resume Claude can emit a result for drained task-notifications before
the prompt's own answer, and that answer must still be recorded (493c1c7).
Guard: conversation-runtime.test.ts "an early turn.complete does not drop …".

## one-request-shape

Every harness gets one `ExecuteCommandRequest`. Effort is a pass-through string:
configuration validation rejects levels the provider does not accept, and
agent-cli maps it to a flag only for harnesses that take one (execute.ts). The
cast covers only agent-cli's `reasoningEffort?: never` typing on the rest. It
replaced three identical per-provider branches (T08 S2). Guard: `every harness
receives its resolved effort in one request shape`.

## provider-usage

`usage` events are provider-counted truth for the request that just completed.
agent-cli already canonicalised per-harness conventions and excluded Claude's
turn-aggregate `result` usage and its sub-agent measurements, so the server takes
them verbatim; re-deriving would reintroduce double counting. Last write wins
within a turn (tool loops issue several requests; the latest is the live context
size). It can go down when the provider compacts; that is the signal.

The value is flushed once per turn, not per event: each write is a CAS round trip
on the config record. It is filed under the session settled at drain, so a
mid-turn rotation records usage against the session that holds that context. A
failed write is logged and never fails the turn. A session reset clears it: a new
session is an empty context.

## chat-fork

Chat "Fork" is a soft handoff: `resumedFromConversationId` is UI lineage and the
context lives in the draft / first user message, so changing provider before the
first send must still work. The first send upgrades to provider-session
inheritance only when the source has the same provider, the harness can fork
(`providerSupportsFork`) and the memory generations match. Anything else stays a
soft handoff and never rejects the send. When inheritance ran, first-turn
briefing / pasted-context prefixes are skipped: the CLI already has the source
transcript. Bug 2026-08-20: muse → muse died with `Harness "muse" does not
support fork.` because only the same-provider branch reached prepareSession.
Guard: `same-provider fork on a fork-incapable harness falls back to string
handoff`.

## session-relative-prompt

A seat's wording depends on whether the provider session resumes, and that is
decided at admission (`sendAdmittedMessage`): a Buddy turn may first wait for a
run slot, and a changed Buddy audience rotates the session. Asking first and
sending one prompt later leaves a window for the decision to flip, so callers
hand over both wordings (`SessionRelativePrompt`). The runner's `--resume` and
the chosen wording come from the same `resumesProviderSession` decision.

## preflight

Configuration is resolved against the catalog immediately before any message or
queue mutation (catalog changes can move defaults without changing durable
intent). The policy's preflight is an admission rule, not a process failure:
checking it before spawn keeps a queued message retryable and prevents a
synchronous spawn throw from leaving the queue head "sending".
