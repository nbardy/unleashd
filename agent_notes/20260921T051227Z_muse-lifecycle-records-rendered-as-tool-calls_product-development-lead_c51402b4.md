# Muse lifecycle records were rendering as tool calls

Date: 2026-09-21
Buddy: Product Development Lead (`c51402b4`)
Branch: `feat/mailing-lists-2026-09-21`

## Symptom

Owner reported "lots of `model.meta.response` in tool calls" in muse conversations.

## What `model.meta.response` actually is

Not a tool. It is muse's own bookkeeping: a `side_effect_intent` record
declaring "I am about to make a model round-trip," keyed
`model:<run_id>:<task_id>`, with `policy_decision: "not_applicable"` and no
other payload — no token counts, no model name, no content.

It is *not* a periodic heartbeat either. It fires once per model round-trip, so
it goes silent during a single long model call, which is exactly when a liveness
signal would matter. The real heartbeat is `agent-cli.heartbeat`
(`vendor/agent-cli-tool/src/heartbeat.ts:45`), which is timer-driven.

## Root cause

`vendor/agent-cli-tool/src/parsers/muse.ts` forwarded **every** lifecycle record
carrying an `operation` as a `tool.use`, because `tool.use` was the only unified
event with a name attached. Three unrelated kinds of record therefore arrived
looking identical to a tool invocation.

Muse was the only parser doing this. codex (`parsers/codex.ts:160,246`), gemini
and cursor already route lifecycle noise to `progress` with a namespaced
`source`. This change makes muse consistent with them.

## Evidence

Two sources, and the distinction mattered.

**Durable session log** (`~/.local/share/muse/sessions/2026/09/06/01a076df…`) —
21 `model.meta.response`, all `side_effect_intent`, all payload-free. Good
evidence for *what muse thinks*, but the wrong stream: the durable log wraps
records as `runtime.session` + `event.kind`, while the parser switches on
`task.lifecycle.*`. Reasoning about the parser from this file produced one wrong
intermediate conclusion (that no completion record existed to correlate against).

**Live `muse exec --json` capture** — Muse Code 1.3.0, three bash commands, 100
stdout records. This is the stream the parser actually reads, and it is now
checked in as `vendor/agent-cli-tool/test/fixtures/muse-1.3-three-bash-calls.jsonl`.

| finding | count |
|---|---|
| `model.meta.response` intents | 4 |
| `tool:bash` intents | 3 |
| `reminder.child_run` intents | 4 |
| `tool.result` frames (each with `correlation_facts.tool_name`) | 3 |
| lifecycle records carrying **no** `operation` | 70 of 100 |

Two things only the live capture showed:

1. **Only `task.lifecycle.side_effect_intent` carries an `operation` at all.**
   The proposed/accepted/scheduled/started/completed records — 70 of the 100 —
   carry none, so they already yielded nothing and could never inflate counts.
2. **Every tool call was announced twice.** Once by its `tool:bash` intent, and
   again by the `tool.use` that the `tool.result` case synthesized. So real
   tools were double-counted on top of the bogus `model.*` rows.

All 3 tool intents completed under their own `task_id` (3/3), and all 3
`tool.result` frames named `bash` — so start/finish correlation is available,
which is what made the dedupe safe.

## Change

`vendor/agent-cli-tool/src/parsers/muse.ts` — classify the `operation` instead of
forwarding it:

- `tool:<name>` → the single `tool.use` for that call, prefix stripped, emitted
  at **start** so a running tool gets a live row.
- `model.*` → `progress` with source `muse.model_step`.
- anything else (reminders, `session_name.allocate`, …) → `progress` with source
  `muse.lifecycle`.

`progress` is never rendered (`server/src/conversations/runtime.ts:1296` logs it
behind `AGENT_CLI_DEBUG_EVENTS`) but still counts as provider liveness for the
stall watchdog (`isProviderProgressEvent`, `runtime.ts:348-357`). So model steps
keep their only real value — evidence the run is advancing — without pretending
to be tools. Nothing is dropped silently.

The `tool.result` case now suppresses its duplicate `tool.use` only when it can
consume a matching start it actually saw (counted per tool name, not a boolean).
An unmatched result still emits both, because **losing a tool call from history
is a worse failure than showing it twice**.

## Deliberately NOT removed

The guard exceptions in `server/src/buddies/memory-review-runner.ts:116-117,148-153`
(`MUSE_MODEL_STEP`, the `tool:` prefix strip) can no longer fire. They stay.

That guard's failure mode is killing a memory review *mid-write* over muse's own
bookkeeping. Tolerating a shape known not to be an invocation costs nothing;
dropping the exceptions would re-arm that failure the next time muse's event
shape moves. The stale comment above them was rewritten to say so, rather than
left describing behaviour that is no longer true.

## Verification

- `vendor/agent-cli-tool`: 246/246 tests pass, `tsc --noEmit` clean.
- Four new tests in `test/muse-parser.test.ts`, three of them driven by the real
  fixture rather than hand-written frames: one tool.use per call with bare names,
  model steps never appear as tools, an unmatched `tool.result` still reports its
  call, and two starts of the same tool consume two results (counting, not a
  boolean).
- `server`: `tsc --noEmit` clean; `buddy-memory-review.test.ts` 10 pass / 0 fail
  (2 live-gated skips). The suite's existing case that feeds
  `model.meta.response` as a `tool.use` still passes — which is the guard
  exceptions doing their defense-in-depth job.

## Not verified

The before/after was not watched in a live muse thread in the browser. The claim
that these rows land in the client's "▸ N tool calls" grouping follows from
`tool.use` reaching the UI, but was not confirmed visually.
