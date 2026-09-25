# T09 — Conversation sum type + wire protocol v3

Branch `feat/wire-v3` (worktree `.claude/worktrees/agent-a863af0b521ec1667`). Not merged
into lean/integration, not pushed (the orchestrator backed up the WIP to `origin/wip/wire-v3`).

## SHAs

| SHA | What |
|---|---|
| 08baecd | branch point (lean/integration at the time); the "before" measurement build |
| c83724b | WIP checkpoint the orchestrator saved at the session-limit stop |
| eb2bc22 | WIP: client on rows/detail/transcript atoms |
| 7a6a5ce | merge of lean/integration 75c1458 (T11 Buddy server on the Rust core) |
| 373b98a | **HEAD**: v3 finished after the merge, guards, docs. Tree clean at HEAD; all checks below ran on it |

The two WIP commits were not squashed. Rewriting them would mean rebasing under a merge commit,
and the repo rules forbid that. Squash-merge the branch if a single commit is wanted.

## Checks (at 373b98a, `git status --porcelain` empty)

| Check | Result |
|---|---|
| `pnpm typecheck` (includes test configs) | clean |
| `pnpm test:client` | 133/133 pass |
| `pnpm test:server` | 269 tests. 255 passed in the full run. The 14 failures were all `auth.test.ts` real-server tests, which hit a real bug (below). Re-run after the fix: auth + record-migration + wire-v3, 22/22 pass |
| `bash tools/check-client-invariants.sh` | 6/6 gates pass |
| biome on the changed files | only pre-existing a11y and useExhaustiveDependencies findings remain (Chat.tsx, SwarmAnalyticsMobile, ConversationView; the same code is at lean/integration) |

The bug the full run found: `migrateConversationRecords` wrote its report into a store directory
that does not exist on a fresh data dir. The server then refused to boot (ENOENT). It is fixed
with `mkdir(root, {recursive:true})`. The guard is auth.test's real-server boot.

## Conversation model: schema diff

**Before.** `ConversationSchema` was one wide object, and the full object went to every client
on every change. Kind was encoded four ways:

- `buddyContext`, `purpose` and `placement` on the record's creation metadata;
- a text marker in the transcript (`<!-- unleashd:buddy-context-v2 -->` or the builder envelope);
- `isWorker`, `swarmId`, `workerId` and `workerRole` (nullable), plus `swarmDebugPrefix`;
- `kind: {kind: 'buddy', …}` on the wire.

The model was also carried four ways: `model`, `modelName`, `reportedModel` and
`configResolution.value.modelId`, alongside `reasoningEffort`.

**After.** Kind is a single field:

```ts
// shared/src/conversation-config.ts: stored in the record (CONVERSATION_RECORD_VERSION = 2)
ConversationKind =
  | { t: 'chat' }
  | { t: 'buddy'; context: BuddyContext; visibility: 'foreground' | 'background' }
  | { t: 'builder' }
  | { t: 'worker'; swarmId; workerId; role }
```

The wire model lives in `shared/src/conversation.ts`:

- **`ConversationRow`** is the list row (about 230 B encoded):
  - `id`, `kind: RowKind`, `parent`, `resumedFrom`, `provider`, `cwd`, `label`, `createdAt`, `activityAt`, `messageCount`, `done`;
  - `run`, which is one of `idle`, `queued`, `running` or `streaming`;
  - `RowKind` is the list projection: `chat`, `buddy` (buddyId, workspaceId, `bg`), `builder`, or `worker` (swarmId, workerId, role).
- **`ConversationDetail`** comes from `GET /api/conversations/:id`:
  - `sessionId`;
  - `config`, the `ConversationConfigState`, which is the only place the model lives;
  - `queue`, `subAgents`, `swarmDebugPrefix`;
  - `latestTurn: {observedModel, usage}`, the provider-reported model as a per-turn observation.
- **`MessagePage`**: `{epoch, total, afterSeq, messages}`. The epoch bumps only when history is replaced, not appended.
- **`RowPatch`** has these variants: `run`, `done`, `label`, `activity{activityAt, messageCount}`, `config{state, commandId}`, `queue`, `session`, `subagent`, `turn`.

Deleted from shared:

- `ConversationSchema` and `DiscoveredConversation`;
- `ConversationPurposeSchema` and `ConversationPlacementSchema`;
- `conversation-kind.ts`;
- server `serialization.ts` and `Conversation.toJSON`.

`buddyContext`, `purpose`, `placement` and the transcript marker are no longer read as identity.
Only the one-shot migration reads them. The disk adapter still strips the envelopes from the
displayed text, and treats an enveloped turn as "never a worker" for newly discovered sessions.

## Wire messages, before and after

**Server → client.**

| Before (v2) | After (v3) |
|---|---|
| `init` (full conversations, bodies included) | `hello {protocol:{version:3}, defaultCwd, loading, archivedBuddyIds, cwds, buddies, rows}`, with rows interned and defaults omitted |
| `conversations_updated`, `conversation_created` | `rows` |
| `conversation_updated` (a full snapshot) | `patch {id, patch: RowPatch}` |
| `conversation_deleted` | `removed {ids}` |
| `conversation_load_complete` | `ready {conversationIds}` |
| `status`, `session_bound`, `queue_updated`, `subagent_start/update/complete` | `patch` variants `run`, `session`, `queue` and `subagent` |
| `command_accepted`, `command_rejected` (with snapshot) | `ack {commandId, result: created{rows} \| accepted \| rejected{conversationId, error}}` |
| `message`, `chunk`, `message_complete`, `error`, `buddy_archived`, `buddies_changed`, `channel_changed` | unchanged; `message` is followed by an `activity` patch |

**Client → server.** Command names are unchanged, with two changes:

- `send_message` is deleted; it had no senders.
- `create_conversation` now carries `kind: chat | buddy{context} | fork{from}`. It no longer has `buddyContext` or `resumedFromConversationId`.

**Bodies.** They are fetched through `GET /api/conversations/:id/messages?afterSeq=&limit=` (default
500, max 2000). The route goes through the single server function `MessageSource.messages(id,
{afterSeq, limit})` in `server/src/conversations/messages.ts`, which T13 re-points at the ingest
crate.

**Skew.** `classifyServerFrame` returns `message`, `skew` or `invalid`.

- A v3 client that receives a v2 `init` keeps its rows, sets `protocolMismatchAtom`, shows "backend reloading" in the config dropdown, and reconnects.
- A v2 client that receives a v3 `hello` drops it as an unknown type and keeps its list.
- In neither case does the list go empty. The guard is `client/test/protocol-skew.test.ts`.

## Record migration (v1 → v2, one shot)

`server/src/conversations/record-migration.ts` runs in `initialize` before anything reads the
store. For each record it:

1. backs up the directory to `backup-v1-<ts>/`;
2. derives the kind:
   - `creation.buddyContext` gives buddy; visibility comes from placement, or from `defaultBuddyVisibility`;
   - `purpose: buddy_builder` gives builder;
   - otherwise, a transcript marker from `session-cache-v1` gives buddy, builder or worker;
   - otherwise the kind is chat;
3. writes the ORIGINAL record plus `kind` and `version: 2`, with no schema defaults materialised;
4. re-reads the file from disk and verifies that the hash of every non-identity field is unchanged.

When the pass is complete it writes `migration-v2-report.json` and the `.migrated-to-v2` marker.
If any record fails, it writes no marker and the next boot retries. The store throws
`UnmigratedConfigRecordError` on a v1 record; it never quarantines one.

Run on a copy of `~/.agent-viewer`:

- 8,017 records: 8,017 migrated, 8,017 verified, 0 failures;
- kinds: chat 6,348, buddy 1,118 (foreground 456, background 662), builder 54, worker 497;
- sources: `creation.buddyContext` 1,001, `creation.purpose` 54, transcript marker 614, default 6,348.

A first version wrote the schema-parsed record. Its defaults changed the hash, so 7,142 of 8,017
records were refused. The guard is the sparse-record test in
`server/test/record-migration.test.ts`.

**Row-set check.** I compared the before `init` (08baecd) with the after `hello` on the same copy.
The live list classifies identically:

- 1,158 shared ids, 0 kind changes.
- The 3 rows that are gone and the 6 that are new are drift in the live `~/.claude` and `~/.codex` transcripts between the two runs, about 2 h apart:
  - the new sessions were created after the "before" run (13:18–13:30 UTC);
  - the newest-by-mtime startup cap displaced older ones;
  - `loader.ts` changes are type-only.
- The 23 extra `buddy-run-*` rows are T11's Buddy scheduler launching runs in the copy. Fake CLIs make them exit immediately.

## Measurements

Copy of `~/.agent-viewer`, a spare port, `BUDDIES_HOME` on a temp copy, and agent CLIs shimmed to
`exit 1`. The machine was heavily loaded throughout (load average 24–80), so treat timings as
±2×.

| | before (08baecd) | after (HEAD) |
|---|---|---|
| first frame (`init` → `hello`), raw | 1,869,672 B (1,161 conv) | 273,534 B (1,184 rows), about 231 B/row |
| same, deflated (permessage-deflate estimate) | 175,026 B | 53,987 B |
| first frame received after connect | 785 ms | 76 ms |
| client: `JSON.parse` of that frame | 10–18 ms | 2 ms |
| client: parse + validate + apply `hello` to the atoms | n/a | 17–29 ms + 14–24 ms (1,184 rows) |
| bytes sent for one "mark done" toggle | 1,363,346 B (full snapshot) | 93.5 B (one `done` patch) |
| message page, 1,099-message chat, limit 200 | (was inside `init`) | 337,664 B, 109 ms |
| server startup to ready, pre-migrated copy | 33.3 s | 7.5 s (first listen 2.9 s, versus 8.4 s) |
| server startup, first boot including the one-shot migration | n/a | 51.2 s (under load average ~70) |
| server RSS after load | 411 MB | 490 MB |

Time to first render was not measured in a browser. The proxy is the first frame arriving in
76 ms instead of 785 ms, plus client apply in under 55 ms, instead of the old path of parsing
and validating 1.9 MB.

The RSS increase is not investigated. It is probably T11's Buddy core plus the startup cache.
This run did not isolate it.

## Line counts (75c1458 → 373b98a, .ts/.tsx)

| Path | Before | After | Change |
|---|---|---|---|
| shared/src | 3,421 | 3,322 | −99 |
| server/src | 25,230 | 25,406 | +176 (includes `record-migration.ts`, 339 lines, deleted after the live migration: net −163) |
| client/src | 31,374 | 31,294 | −80 |
| server/test | 12,003 | 12,353 | +350 (wire-v3, record-migration, label tests) |
| client/test | 5,164 | 5,130 | −34 |

## Guards (each with a reason comment and a pattern tag)

- `server/test/wire-v3.test.ts`:
  - the `hello` budget is at most 300 B per row, carries no bodies and no Buddy operations;
  - a `done` toggle is one patch under 200 B with no messages array;
  - message paging and epoch behaviour.
  - Patterns: patches-not-snapshots, one-store-one-index.
- `server/test/record-migration.test.ts`: sparse records verify; marker-derived builder, buddy and worker kinds. Pattern: delete-and-migrate.
- `client/test/protocol-skew.test.ts`: a v2 `init` keeps the rows; a v3 `hello` clears the skew.
- `server/test/conversation-label.test.ts`: the label strips envelopes and is bounded to 80 characters.
- The existing dedupe, event-isolation and tail-regroup tests stay green. T05's per-id isolation is kept through `transcriptAtomFamily` and `conversationDetailAtomFamily`.

Docs updated:

- `AGENTS.md`: tree map, the hard rule on rows/transcript/detail atoms, a v3 note and a skew note.
- `docs/patterns.md`: "Here" entries for sum-types, patches-not-snapshots and delete-and-migrate.
- `docs/ws-contract-surprises.md`: a v3 section; the pending and rows sections rewritten; ack names updated.

## Buddy-code touches (T11 owns these; kept minimal)

**Server.**

- `server/src/buddies/turn-policy.ts`:
  - reads `kind.context` and `kind.visibility` through the host's `visibility()` instead of `placement`;
  - `buildFirstTurnCliContent` switches exhaustively on `kind.t`.
- `server/src/conversations/buddy-creation-service.ts`: creates with `buddyKind(context, visibility)` or `{t:'builder'}`, and calls `publishRow()` instead of `toJSON`.
- `server/src/server.ts`: the Buddy runner host's `placement` reads `kind.visibility`, and `openBackground` passes `visibility: 'background'`.
- `server/src/http/conversation-routes.ts`: T11's `mcpSpecJson` switch now reads `kind.t`.

**Client.**

- `atoms/buddy-background.ts`, `BuddyConvoHeader.tsx` and `useBuddyData.ts` (which creates with `kind: {t:'buddy', context}`).
- In `components/buddies/`: `BuddyBackgroundTasks`, `BuddyConversationList`, `BuddyWorkspaceActivity`, `ChannelBrowser`, `BuddyBuilderResultCard`, `buddy-direct-actions`, and `ui-contract` (`effectiveSwarmDebugPrefix` removed). These read the row via `rowBuddy(row)`.

**Tests.** `buddies-v2`, `buddy-conversation-contract`, `buddy-creation-service` and
`codex-buddy-transcript`, plus the client Buddy tests, were updated to the row shape.

In total the Buddy files changed by +58/−101 lines.

## Deferred

1. **T23:** `records/import.rs` rejects v2 records. It must accept `kind`, and the Rust config store must read `kind`, not `creation.buddyContext`.
2. **Delete `record-migration.ts`** (and its test) once the live `~/.agent-viewer` has migrated. On the live store the first boot takes the backup and writes the report; check `migration-v2-report.json` shows `failures: []` before deleting.
3. **Client → server command renames** (for example, the `*_conversation` verbs) were not done. Only `create_conversation`'s payload changed.
4. **List previews:** the Gallery and mobile lists show the row `label` (first user line), not a last-message preview. A preview would need a row field or a lazy body fetch.
5. **`BuddyConvoHeader`** no longer shows `buddyProjectId`, which is not on `RowKind`. It can be read from the detail if T11 still wants it.
6. **Swarm verdicts** (`extractVerdict`) need loaded bodies. The Swarm views read a transcript only once it has been opened.
7. `markConversationsSeenBulk` was kept as it is.
8. **Browser measurement of time to first render** (the headless-Chrome run) was not done; see the proxy above.
9. **A11y and exhaustive-deps biome findings** in Chat.tsx, SwarmAnalyticsMobile and ConversationView were already in lean/integration and are left alone.
10. **lean/integration has moved** since the merge (75c1458 → e721900). Merging `feat/wire-v3` needs another merge.
