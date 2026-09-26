# Context meter: why it reads the way it does

Code: `server/src/conversations/context-window.ts` (denominator) and
`buildContextBreakdown` in `server/src/http/conversation-routes.ts` (numerator and
bands). Guard: `server/test/context-breakdown.test.ts`.

## window

The denominator used to be a hardcoded 200,000, the single largest error in the
meter: Opus 5.5, Fable 5.1 and Sonnet 5 carry 1M windows, so "220k / 200k" was
really 22% of budget. Only Haiku 4.5 is a 200K model. Resolution is a sum type so
the fallback is never silent: an unknown model surfaces as `source: 'unknown'`
with a display-only floor (200K, the smallest window we ship, so the meter reads
full early rather than falsely roomy).

Order: operator override (`UNLEASHD_CONTEXT_BUDGET_TOKENS`) → the window the
harness reported (codex does; its absence means "resolve from the model", not
"unknown") → the catalog alias id the config stores → the provider-reported model
name (haiku tested before the 1M families) → unknown. The 1M alias entries assume
default `claude -p`; Bedrock/GCP/Foundry, 4.6 models without extended context, or
`CLAUDE_CODE_DISABLE_1M_CONTEXT=1` narrow it to 200K, which the server cannot
observe; those operators set the override. The retired `opus` alias stays so stored
configs still resolve.

## measured

Two provider-truth paths answer the same question. The live `usage` event is
freshest but exists only for turns taken since the server listened; the harness's
own session log (read through ingest) is retroactive and is the only source for
codex and muse, whose stdout carries no per-request token fields. Live wins when
present; the file is what makes an idle thread read correctly instead of falling
back to chars/4.

A live reading above a KNOWN window is not a context size but a cumulative
aggregate a parser passed through (2026-09-22: codex exec reported the session
total 16,062,762 on a 258,400 window). It is dropped and the file or the estimate
answers; this also heals bindings still carrying a pre-fix aggregate. Operator
budgets and unknown floors are exempt: exceeding a budget is real over-budget
signal, and a floor is a guess.

## bands

Sections (history, briefing, memory, mcp, handoff) are chars/4 estimates. With a
measured total the sections keep their estimates and the unmodelled harness
overhead (system prompt + tool schemas we never see; ~39.5k for a one-word claude
prompt) becomes `residualTokens`. When the measured total comes in under the
model, the bands scale down to fit (`tokensScaled`); they never sum past the real
context.

"Was history dropped?" and "do the bands fit?" are separate questions. Compaction
prefers the harness's own marker (exact, can report pre/post counts); the ratio
test (measured < 0.9 × estimate) is only the fallback for a reading with no log.
chars/4 is rough both ways and the measured number also includes overhead, so a
measured total meaningfully under the estimate can only mean dropped history.
`marker` and `inferred` are never blended: one is the provider's word, the other
our arithmetic, and only the marker can count boundaries.
