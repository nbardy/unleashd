# 07 — SoL-Pi: what it is and what to steal (2026-09-18)

Sources: [paper](https://paperswithcode.co/paper/2609.20519) (arXiv:2609.20519,
EdgeBench 51-task eval), [project page](https://nvlabs.github.io/SoL-Pi/),
[repo](https://github.com/NVlabs/SoL-Pi) (MIT, shallow-cloned to /tmp/sol-pi
for this note). 152 proposed directions → 4 surviving mechanisms, spanning
action execution, context compaction, observation handling, delegated
reading. Vs Pi: 45–49% fewer tokens, ~1/3 less cost, ~94% score retained.
Vs native Codex/Claude harnesses: 35–64% fewer tokens, 50–54% lower cost
(API-equivalent, xhigh effort).

## The headline: savings are structural, not prompt-based

Prompt search was used to tune trigger rates *inside* mechanisms (Action
Fusion hit 100% trigger at iteration 10), but all four mechanisms control
the **lifecycle** of context. Their negative results say it outright: "do
not treat blunt brevity or early compaction as a mechanism" — naive prompt
shortening doesn't survive. This confirms our 05 finding: trimming briefing
text is small-ball; thread lifecycle is the bill.

## The four mechanisms (with repo pointers)

1. **Action Fusion** (`src/sol-pi/extensions/action-fusion/`: `then-run.ts`,
   `file-queue.ts`). Edit + its follow-up build/test/run command become ONE
   tool call: harness applies the edit, runs the command locally, returns one
   combined observation. Removes the middle model round-trip. Oracle found
   12.3% of cross-turn transitions were edit→command candidates (85% bash);
   projected −10.8% model turns, −11.5% tokens.
2. **Online Context Compact** (`extensions/online-context-compact/`:
   `economics.ts`, `extension.ts`, `plan.ts`). Compact at SUBTASK
   boundaries, not on KV-cache pressure — but only when expected future
   savings repay the rewrite. `economics.ts` is an explicit breakeven model
   (`breakevenRequests`, cache write/read ratios, 16k window reserve).
   Compaction costs a rewrite, so gate it: their formula for our auto-compact
   threshold, ready-made.
3. **ObservationPack** (`extensions/observation-pack/`: `observation.ts`,
   `ledger.ts`, 315 lines + two hooks, fail-open). Tool results >10KB are
   archived locally; context keeps a handle + ~1KB excerpt (V2: 2,048-byte
   head + 1,536-byte tail, two full sends before projection); exact pages
   recalled on demand. Paired EdgeBench: bill −23.58% with score +22.92% —
   the biggest single lever. Receipts from the reducer are exempt from
   re-packing (verified evidence is never replaced by an excerpt).
4. **Evidence-Preserving Reducer** (`extensions/evidence-preserving-reducer/`:
   `receipt.ts`, `provider.ts`, `archive.ts`). First reading of long
   build/test logs goes to a CHEAPER agent; the receipt (exact byte-for-byte
   quotes, sha-pinned to the archived log, capped items/quote length, JSON
   only, `uncertain` flag) is deterministically verified before the frontier
   agent sees it. Delegation without trusting fluent summaries — the answer
   to our provider-subagent invisibility worry.

## Integrate or extract? Extract.

SoL-Pi is built on Pi's API-driven agent loop
(`@earendil-works/pi-agent-core`); we shell out to vendor CLIs per turn.
Adopting the harness = replatforming months of CLI-subprocess architecture.
The mechanisms are substrate-independent — port them at OUR seams:

1. **ObservationPack first** — highest leverage, lowest risk. Our MCP server
   already owns result shaping (`compactInbox`/`compactCapabilities` in
   `server/src/buddies/resources.ts`). Pack large MCP results the same way:
   archive + handle + excerpt + recall tool, fail-open. Directly kills our
   318k-write-class events (05). Also applies to handoff assembly.
2. **Compaction economics second** — port `economics.ts` breakeven math into
   Hook D / auto-compact: compact only when remaining-turns × context >
   rewrite cost. Replaces our hand-picked threshold with their validated one.
3. **Reducer pattern third** — for log-heavy background flows (test/build
   triage): cheap reader + deterministic quote verification. A buddy-side
   pattern, no architecture change.
4. **Fusion last, via MCP** — we can't fuse inside the CLI's private
   edit→test loop, but we CAN offer a fused edit-and-run MCP tool in
   `buddyMcpServers` so buddy turns that go through our tools skip the
   middle round-trip.

Bonus alignment: their "merge narration into one event-driven status line"
is a direct hit on our per-turn claim/policy appends (`run-executor.ts:
459-469`) — merge them. Their "preserve exact model identity" matches our
verbatim pass-through rule (AGENTS.md).

Caveat: their numbers are EdgeBench/TB4 long-horizon coding at xhigh
effort, not buddy workloads. Expect direction, not magnitude — validate
with Hook-D attribution before claiming 40% here.
