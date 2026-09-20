# Scope: ObservationPack port (plan only — DO NOT IMPLEMENT yet)

Goal: stop replaying large tool payloads on every turn, per SoL-Pi
ObservationPack (`/tmp/sol-pi/src/sol-pi/extensions/observation-pack/`:
`observation.ts`, `ledger.ts`, 315 lines + two hooks, fail-open).

## Where it plugs in here

- `server/src/buddies/resources.ts` — `compactInbox`/`compactCapabilities`
  already shape MCP results; add pack/unpack beside them.
- `server/src/buddies/run-executor.ts:441,511` — handoff assembly (60KB
  tail-slice today; pack large slices instead).
- SoL-Pi parameters to adopt: participate above 10KB, two full sends
  before projection, excerpt = 2,048-byte head + 1,536-byte tail, whole
  lines; exempt verified reducer receipts from re-packing.

## Plan steps

1. Local archive store (content-hash keyed) + ledger for packed payloads.
2. Pack step in MCP result path: over threshold → store, return
   handle + excerpt; under threshold → unchanged (fail-open default).
3. Recall tool/page mechanism so the model can fetch exact pages on demand.
4. Wire handoff assembly through the same pack step.
5. Attribution first (Hook D): measure packed-bytes-per-turn before/after
   on one buddy before rolling out.

## Risks

- Recall UX: model must learn handle→recall; needs description tuning
  (SoL-Pi prompt-searched trigger rates for the same reason).
- Over-packing small-but-critical outputs degrades quality; keep the 10KB
  floor and the receipt exemption.
- Archive growth/disk hygiene for long-lived buddies.

Estimate: S–M (days, mostly isolated to resources.ts + one tool).
