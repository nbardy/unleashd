# Code patterns

These are the structural patterns this codebase is being rebuilt around (lean rewrite, 2026-09-25). Each one
replaced measured bloat or a measured slowdown. Use them for new code, and keep them intact when you change code.

**Tagging rule.** Code that implements a pattern carries a one-line tag at the definition site:

```ts
// Pattern: one-write-path (docs/patterns.md#one-write-path)
```

(Rust uses `//` or `//!` the same way.) The tag says which invariant the code keeps. A reason comment explains why
this spot exists. Before changing tagged code, read the pattern here. If you must break a pattern, update this file
and the tag in the same commit and give the reason.

Find the implementations with `rg -n "Pattern: <name>"`.

---

## one-store-one-index
**Smell:** many hand-written views, each scanning all the data on every change.
**Pattern:** one normalized store (rows by id) plus ONE derived index, computed in a single pass. The index's
fields keep their identity when their content is unchanged. Per-id cursors (families) serve single-item views.
Updates cost what changed, not n.
**Here:** `client/src/atoms/conversation-index.ts` (about 10 full passes per event became one index).

## sum-types
**Smell:** nullable field bags, and "what kind / which provider is this?" checks inside core logic.
**Pattern:** the kinds are a sum type, fixed once at the boundary. One thin exhaustive dispatcher picks a handler,
and each handler has one clean path with no structural branching (see ~/.claude/CLAUDE.md "One Clean Path").
**Here:** `ConversationKindSchema` (chat | buddy | builder | worker, `shared/src/conversation-config.ts`) and its
list projection `RowKind`; crate `types.rs` (`ChannelKind`, `RequestState`, `RunInput`); `McpServerSpec {kind:'stdio'|'http'}` in
agent-cli; the conversation's `TurnPolicy`, chosen once by kind (`policyFor` in `conversations/runtime.ts`:
`ChatTurnPolicy` / `BuddyTurnPolicy` / `BuddyBuilderTurnPolicy`).

## parse-dont-validate
**Smell:** the same validation repeated at every layer.
**Pattern:** canonicalize raw input once at the boundary into canonical types. After that, the core trusts the types,
with no re-checks and no silent fallbacks (a typed error or a typed "unknown" variant instead).

## capability-grants
**Smell:** the same permission check in N places (`send` was checked in 7+).
**Pattern:** authorize once and pass a capability object (e.g. `TurnGrant`) that carries the decision. There is one
`authorize(actor, op, subject)` rule and no second copy of it.
**Here:** crate `store.rs` `authorize`; `server/src/buddies/grants.ts` (T11).

## table-driven
**Smell:** long if/switch ladders keyed by name (tools, routes, harness features).
**Pattern:** a table of `{name, schema, handler}` rows plus one generic loop. Adding a case means adding a row.
**Here:** the MCP tool table (T11: 47 tools → 12); agent-cli `mcp-encoding.ts` (one handler per harness per
kind); `SUB_AGENT_FOLDS` in `server/src/turns/subagents.ts` (codex collab threads vs the generic Task fold).

## pure-core
**Smell:** logic interleaved with I/O and timers, so tests need heavy mocks.
**Pattern:** state machines are pure functions `(state, event) → (state, effects)`. I/O lives at the edges.
Test the core directly and the shell with one integration test.
**Here:** `TurnQueue` in `server/src/turns/queue.ts` (T08): transitions with no I/O, timers or broadcasts; the
conversation applies the effects.

## one-write-path
**Smell:** one mutation method or one table per variant of the same thing.
**Pattern:** one append/write path for a concept, with read models derived from it.
**Here:** crate `posts.rs`, where every DM, channel post, reply and task comment is a `post` in a channel; `records/store.rs` `put`, the one write of a conversation record and its session index. Ingest crate
`store.rs` `Writer::apply`: transcripts are parsed once, and the usage/cost numbers (`usage_turn`) and the context
meter (`session.context`) are read models of that one ingest, replacing two more transcript parsers
(`usage-routes.ts`, `session-context.ts`).

## idempotency-keys
**Smell:** ad-hoc dedupe, retry flags, "did we already do this?" queries.
**Pattern:** every externally triggered mutation carries a key, unique per actor and scope, recorded once in the event log.
A replay returns the original result.
**Here:** crate `store.rs` event log (`idem_key`).

## wake-on-write
**Smell:** one timer per entity, or fast polling of state that changes rarely.
**Pattern:** wake the worker when the thing it waits for is written (enqueue, settle, file change), plus ONE slow
backstop tick. Shared clocks run only while someone subscribes.
**Here:** `client/src/hooks/useTimeTick.ts` (8 intervals → 1); Buddy runner (T11); the shared chat-admission tick
(`buddies/turn-policy.ts`); `SwarmObservers` in `server/src/swarm/observer.ts` (one async poller per folder, only
while a turn runs there, replacing one blocking 2 s poller per running conversation). Ingest crate `watch.rs` +
`filewatch.rs`: FSEvents for discovery, a kqueue watch on each file that is being written, and a batch that closes
2 ms after its last event (was a fixed 50 ms window: append → onChange p50 68 ms → 4–6 ms). The 10-minute rescan is
the backstop.

## patches-not-snapshots
**Smell:** resending whole objects on small changes (5 MB on "mark done").
**Pattern:** send field patches, and apply them with structural sharing so unchanged parts keep their identity.
List payloads carry summary rows; bodies load on demand.
**Here:** `RowPatchSchema` / `applyRowPatch` / `applyDetailPatch` in `shared/src/conversation.ts`;
`handlePatch` in `client/src/atoms/actions.ts`; the tail-only transcript refresh (`refreshTranscript`);
T05's tail-only stream regroup. Guard: `server/test/wire-v3.test.ts`.

## ordered-ids
**Smell:** ordering rows by a timestamp, with a random id as the tie-break: rows written in the same millisecond read
back shuffled.
**Pattern:** ids are time-ordered UUIDv7 (RFC 9562) from ONE monotonic generator per process (a counter within the
millisecond), and reads order by the id, never by timestamp ties. Timestamps stay the true write time. Rows that must
keep an older id carry the ordered id in a separate column assigned in their original write order.
**Here:** `crates/unleashd-buddies/src/ids.rs`; `post.ord` (threads, pages, read cursors), run ids (claim FIFO).
29 of 50 back-to-back threads came back shuffled before (2026-09-25).

## one-type-source
**Smell:** the same type hand-copied in several layers, drifting apart.
**Pattern:** one definition plus codegen or inference (napi-generated `index.d.ts`, Zod-inferred TS types).
**Here:** `crates/unleashd-buddies/index.d.ts`, generated from the Rust.

## one-definition
**Smell:** the same helper, regex or constant pasted inline in many files.
**Pattern:** one named definition, imported everywhere.
**Here:** `shortenHomePath` in `client/src/utils/directories.ts` (it was inline in 13 files).

## deep-modules
**Smell:** wrappers, relays and adapters that only forward calls.
**Pattern:** few modules with small interfaces that hide real work. Delete pass-through layers.
**Here:** the `owner-mcp.ts` relay and the `ProviderEvent` re-typing layer were deleted (T11/T08).

## quarantine
**Smell:** an optional feature's imports spread through the core, so removing it later means an archaeology dig.
**Pattern:** the feature lives in one folder with ONE entry module. Code outside the folder imports only that
entry, from a fixed list of files that a guard test pins; on the client every entry export is lazy, so core chunks
carry none of its code or CSS. Deleting the feature = delete the folder + the call sites of the entry.
**Here:** swarm/oompa (T10): `server/src/swarm/index.ts`, `client/src/swarm/index.ts`; guards
`server/test/swarm-quarantine.test.ts`, `client/test/swarm-quarantine.test.ts`.

## delete-and-migrate
**Smell:** compatibility shims, permanent flags, migration chains (33 schema versions).
**Pattern:** a one-time export into a clean shape, with zero-loss verification (counts plus content hashes). Then
delete the old path entirely.
**Here:** crate `import.rs` + `verify.rs` (both deleted after the live swap); `crates/unleashd-ingest/src/records/import.rs` (config JSON directory → records table, deleted after T23b);
`server/src/conversations/record-migration.ts` (config records v1 → v2 with one stored `kind`; delete once the
live dir is migrated).

## tokens-and-shells
**Smell:** per-screen CSS values (45 font sizes, 172 paddings) and a copy of every screen per device.
**Pattern:** design tokens, then a few primitives, then views, then two thin device shells over the same views.
**Here:** `client/src/ui/tokens.css` (layer 1: `--fs-1…9` type, `--sp-1…11` spacing; the only file
allowed a px font-size/padding/gap) and `client/src/ui/primitives.css` (layer 2: `.ui-stack`, `.ui-row`,
`.ui-inline-row`, `.ui-truncate`, `.ui-card`, `.ui-muted`), T21a. Gates G7 (no literal px, breakpoints only
768px/340px) and G8 (total CSS lines never grow) in `tools/check-client-invariants.sh`. Views and shells: T20/T21.

## fix-guards
**Smell:** a fixed slowdown or bug quietly comes back.
**Pattern:** every fix leaves three things:
1. a 1–3 line reason comment (what broke, the measured cost, the guard's name);
2. a regression test that fails on the bad pattern itself;
3. runtime visibility. The event-loop stall monitor records any stall of 100 ms or more, with its cause.
**Here:** `server/src/observability/event-loop-stall.ts`; the "reconcile tick never scans a table" query-plan test;
the crate's query-plan guard; Buddy sigils render in a worker (`sigil/client.ts`, guard
`client/test/sigil-off-main-thread.test.ts`: 12 inline renders blocked "Loading thread…" 0.6–3.5 s). For visual regressions the guard is the screenshot compare loop:
`pnpm screenshots` before, `pnpm screenshots --baseline <run>` after, which exits non-zero when any screen's
changed pixels exceed `--threshold` (`tools/lib/screenshot-compare.mjs`; masks in `tools/lib/headless-chrome.mjs`).
