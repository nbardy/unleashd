# 03 — App core scope (non-Buddy): data model, contract, logic, perf, waste, Rust candidacy

Scope: `server/src` (excl. `buddies/`), `shared/src`, `client/src` (excl. Buddy UI), `vendor/agent-cli-tool/src`, `tools/`.
Snapshot: HEAD `cbb8820`, 2026-09-25. This was a read-only audit; no repository file was edited.
Live measurements were taken against the running dev backend: pid 21020, `node --import tsx src/server.ts`, port 7499.
Helper scripts are in `unleashd-lean-scope/.work/`: `dead.mjs` (export liveness) and `dead.tsv` (its output).

---

## 0. Measured today

| Probe | Result |
|---|---|
| 30× `GET /api/nope-404` (authed, 100ms apart) | p50 **2.5ms**, p90 **1.16s**, max **18.1s**. Most requests are fast; the event loop periodically stalls for seconds. |
| WS `init` captured with a real `ws` client (Bearer token) | **1,951,133 bytes**, 1,163 conversations, 255ms to receive |
| Conversations in the init | 995 `buddy`, 117 `general`, 51 `buddy_builder`. By provider: 715 codex, 362 claude, 71 muse, 13 cursor, 2 opencode. 358 are `done`. 0 workers, 0 with subAgents. |
| Backend memory | **472 MB RSS** for the tsx backend; 81 MB for the dev supervisor (which also hosts Vite and 3 tsc watchers) |
| `~/.agent-viewer` | 1.3 GB. uploads 701 MB (no retention). session-cache-v1 **491 MB in 7,655 files**; its largest record is 9.4 MB, a projection of a **934 MB** codex rollout. conversation-config **78 MB in 16,804 files** (7,982 by-conversation + 8,822 by-session). observability 45 MB. `ui-state.retired.json` 620 KB. |
| Provider transcripts the poller walks every 5s | ~/.claude/projects: 7,660 files, 3.1 GB. ~/.codex/sessions: 2,483 files, **6.8 GB**. ~/.cursor/projects: 1,471. opencode: 1,466. ~/.gemini: 1,799. **About 14.9k paths in total.** |
| Buddies SQLite | `~/.buddies/buddies.sqlite` is 93 MB plus a 5 MB WAL. It is opened with `node:sqlite` `DatabaseSync` (@nbardy/buddies/src/store.js:252, 157 `prepare()` sites). |
| Startup barrier (architecture.md §2) | 14–20s on about 7,700 sources and 7,800 records. It was 67–102s before the 2026-09-25 fixes. |

### Where the 1.95 MB of `init` goes (bytes per field, summed over all 1,163 rows)

| Field | Bytes | Share | Needed on the list row? |
|---|---|---|---|
| `kind` | 598,244 | 31% | Only the tag and `buddyId`. **`kind.allowedBuddyOperations` alone is 293,103 B**: the same op-name array repeated on every delegated Buddy thread. |
| `configResolution` | 189,818 | 10% | No. It duplicates `config`, `provider`, `model` and `reasoningEffort`. |
| `messages` (one preview each, up to 500 chars) | 176,278 | 9% | The row shows about 80 characters. |
| `config` | 139,259 | 7% | No; only the open conversation's picker uses it. |
| `workingDirectory` | 66,241 | 3% | Yes. |
| `providerUsage` | 53,869 | 3% | No; only the open chat's meter uses it. |
| Everything else: `model`, `reasoningEffort`, `provider`, `reportedModel`, `modelName` (same value as `reportedModel`, runtime.ts:3481/3489), `placement`, `purpose`, `mergeParentMeta`, `mergeChildMeta`, `swarmDebugPrefix`, `workerRole`/`workerId`/`swarmId`/`isWorker`, `confirmed`, `parentConversationId`, `resumedFromConversationId`, … | ~720 KB | 37% | Mostly null or default values. |
| **Of all the above, bytes spent on null or empty-array fields** | **299,380** | 15% | None. |

A list row needs only `id, title|preview(80), workingDirectory, provider, kind tag + buddyId, isRunning, isStreaming, done, updatedAt, messageCount, parent ids`. At about 250 B × 1,163 that is roughly **0.3 MB, about 6× smaller**. The summary projection (`server/src/conversations/serialization.ts:13`) spreads `...conversation` and trims only `messages`.

---

## 1. Line counts

### By directory

| Directory | Lines | Notes |
|---|---|---|
| server/src total | 36,552 | |
| ├ server/src/buddies | 15,280 | Out of scope (covered by another agent) |
| └ **server/src excl. buddies** | **21,272** | |
| &nbsp;&nbsp; conversations/ | 6,426 | runtime.ts alone is 3,510 |
| &nbsp;&nbsp; adapters/ | 4,708 | jsonl.ts alone is 2,339 |
| &nbsp;&nbsp; http/ | 1,942 | usage-routes.ts 771 |
| &nbsp;&nbsp; observability/ | 1,689 | turn-attempt-journal.ts 835 |
| &nbsp;&nbsp; lifecycle/ | 1,596 | session-loader.ts 746 |
| &nbsp;&nbsp; swarm/ | 1,112 | |
| &nbsp;&nbsp; root files (server.ts 813, subagent-tools.ts 194, …) | 1,115 | |
| &nbsp;&nbsp; auth/ | 661 | |
| &nbsp;&nbsp; transport/ | 646 | |
| &nbsp;&nbsp; providers/ | 471 | |
| &nbsp;&nbsp; palettes/ | 393 | |
| &nbsp;&nbsp; merge/ | 274 | |
| &nbsp;&nbsp; application/ | 185 | |
| shared/src | 4,516 | index.ts is 1,292; about 1,900 lines are Buddy schemas (buddy-*.ts) |
| client/src TS/TSX | 36,739 | |
| ├ Buddy UI (components/buddies, mobile/buddies) | 11,622 | Out of scope |
| └ **client excl. Buddy UI** | **25,117** | |
| client/src CSS | **18,757** | mobile/styles is 4,025 |
| vendor/agent-cli-tool/src | 4,119 | harnesses + parsers are 1,460 |
| tools/ | 2,708 (602 TS + 2,106 mjs/js) | Plus shell scripts and one C file |

**The non-Buddy core is about 72k lines:** ≈21.3k server + 2.6k shared + 25.1k client TS + 18.8k CSS + 4.1k vendor.

### Top 25 largest in-scope files

| # | File | Lines | Responsibility |
|---|---|---|---|
| 1 | server/src/conversations/runtime.ts | 3,510 | The `Conversation` class. It handles the queue, spawning, the event fold, subagents, swarm polling, Buddy admission/memory/audience, merge forks, watchdogs, the turn journal, config and serialization (§4). |
| 2 | server/src/adapters/jsonl.ts | 2,339 | Disk parsers for **all six** providers, plus discovery and extraction of in-band metadata (worker, Buddy, swarm and merge markers) |
| 3 | shared/src/index.ts | 1,292 | Wire schemas (Conversation, 11 client and 23 server message types), model registries, effort tables, the merge prompt, oompa/swarm interfaces |
| 4 | client/src/components/Sidebar.tsx | 1,290 | Desktop sidebar: grouping, filters, rows, actions |
| 5 | client/src/components/SwarmDetail.tsx | 1,152 | Oompa swarm dashboard |
| 6 | client/src/components/VirtualizedMessageList.tsx | 1,043 | Transcript virtual list and grouping |
| 7 | client/src/components/Chat.tsx | 1,022 | Desktop chat shell, composer and fork |
| 8 | client/src/mobile/conversations/ConversationView.tsx | 1,015 | Mobile chat (a second implementation of Chat) |
| 9 | server/src/conversations/config-store.ts | 991 | Config store with one JSON file per record, CAS, a by-session index and quarantine |
| 10 | server/src/observability/turn-attempt-journal.ts | 835 | JSONL journal of every turn attempt, plus its diagnostics read model |
| 11 | client/src/atoms/actions.ts | 827 | The `handleMessage` spine and WS actions |
| 12 | server/src/server.ts | 813 | Composition root. It also holds an inline Buddy route (server.ts:640). |
| 13 | server/src/http/usage-routes.ts | 771 | `/api/usage`, which is a **third** transcript parser (synchronous fs) used for cost |
| 14 | server/src/lifecycle/session-loader.ts | 746 | Startup hydration, recovery, poll wiring and broadcasts |
| 15 | server/src/adapters/loader.ts | 735 | Discovery, stat, progressive load and `pollForChanges` |
| 16 | client/src/mobile/channels/ChannelsMobile.tsx | 700 | Mobile channels (Buddy-adjacent) |
| 17 | client/src/components/Gallery.tsx | 680 | Desktop `/`: conversation grid by project |
| 18 | client/src/components/SwarmAnalytics.tsx | 648 | Swarm charts |
| 19 | client/src/components/ColorPalettePicker.tsx | 595 | Theme palette editor |
| 20 | client/src/components/BuddiesDashboard.tsx | 560 | Buddy dashboard (lives outside the buddies/ folder) |
| 21 | client/src/components/PathAutocomplete.tsx | 552 | Folder picker backed by `/api/paths` |
| 22 | server/src/transport/conversation-websocket.ts | 544 | WS command router and init |
| 23 | server/src/conversations/config-service.ts | 521 | Config create/hydrate/patch/fork against the catalog |
| 24 | client/src/mobile/components/ComposerMobile.tsx | 518 | Mobile composer (a second composer) |
| 25 | server/src/observability/error-journal.ts | 493 | Grouped error JSONL journal |

---

## 2. Canonical domain model and its duplicates

### Entities

| Entity | Type definition(s) | Key fields | Persisted where | Representations |
|---|---|---|---|---|
| **Conversation** (wire and runtime) | `ConversationSchema` shared/src/index.ts:468-591 (**37 fields**) | id, sessionId, messages, messageCount, isRunning, isStreaming, done, confirmed, createdAt, workingDirectory, provider, model, reasoningEffort, config, configRevision, configResolution, reportedModel, modelName, subAgents, queue, isWorker, swarmId, workerId, workerRole, parentConversationId, resumedFromConversationId, title, swarmDebugPrefix, kind, buddyContext, placement, purpose, mergeParentMeta, mergeChildMeta, providerUsage | Not persisted as such. It is rebuilt from the config record plus the transcript. | **7**: `ConversationSchema`; `DiscoveredConversation` (index.ts:594); the runtime class fields (runtime.ts:690-950, about 53 fields); `ConversationRuntimeView` (runtime.ts:230); the `ConversationRuntime` interface (runtime.ts:548); `toJSON()` (runtime.ts:3462); the client `conversationsAtom` plus pending stubs |
| **Config record** (durable) | `PersistedConversationConfigRecordSchema` shared/src/conversation-config.ts:200-226 | version, conversationId, sessionBindings[], currentSession, status, done, workingDirectory, creation{13 fields}, deletedAt, config, recordRevision, configRevision, lastResolvedConfig, provenance, createdAt, updatedAt | `~/.agent-viewer/conversation-config/v1/by-conversation/<b64id>.json` (7,982 files, pretty-printed per config-store.ts:914), plus a `by-session/` index (8,822 files) | One schema, but its data is copied into the runtime and then onto the wire |
| **Message** | `MessageSchema` index.ts:330 | role, content, timestamp, toolCall{name,input}, completedAt, completionReason | The provider transcript is authoritative. Copies live in the session-cache JSON and in server memory. | 3 in-flight shapes: `MessageSchema`; the WS `message`/`chunk`/`message_complete` events (index.ts:984-1007); the client streaming buffer |
| **Session** (provider-native) | `ParsedSession` disk-adapter.ts:50. Per provider: `JsonlSession` shared/src/adapters/jsonl.types.ts:264, `CodexSession` jsonl.ts:467, `OpenCodeSession` :478, `GeminiSession` :1706, `CursorSession` :1908, `MuseSession` :2085. Cache: `CachedParsedSessionSchema` session-cache.ts. | sessionId, filePath, workingDirectory, provider, model (falls back to `'unknown'`), createdAt, modifiedAt, messages, subAgents, parentSessionId, and the legacy triple kind/buddyContext/purpose | The CLIs' own files; a normalized copy in `session-cache-v1/<sha>.json` (491 MB) | **8 session shapes, 6 of them per provider** |
| **Session binding** | `ConversationSessionBindingSchema` conversation-config.ts:129 | provider, sessionId, buddyAudienceKey, latestUsage | Inside the config record | Also mirrored as `Conversation.sessionId` and the runtime `sessionId` |
| **Provider** | `ProviderSchema` provider-catalog.ts:7 (6 ids) | | none | The id enum is fine. The event vocabulary is not (see the next table). |
| **Model catalog** | 1. vendor `catalog.jsonc` → `shared/src/generated/catalog.ts` (GEN_*) → `CODEX_MODEL_REGISTRY`/`CURSOR_MODEL_REGISTRY` (index.ts:105-106). 2. `ProviderCatalogSchema` provider-catalog.ts:78. 3. `server/src/providers/catalog.ts`, which reads the jsonc again. 4. `server/src/providers/catalog-service.ts:~20-50`, which reads it a **third** time and tries 7 paths, including the **hard-coded absolute path** `/Users/nicholasbardy/git/unleashd/vendor/agent-cli-tool/catalog.jsonc`. 5. `FALLBACK_*_MODELS` hard-coded in each provider file (e.g. providers/codex.ts:5). 6. Per-provider effort defaults hard-coded in shared index.ts:250. | | The jsonc in the submodule | **5–6** |
| **Model/effort selection** | `ConversationConfig{provider, model:{default∣explicit}, reasoning:{default∣disabled∣explicit}}` conversation-config.ts:30. This is a good sum-typed design. | | Config record | "Which model" is stored in **8 places**: `config.model`, `configResolution.value.modelId`, `configResolution.lastResolved`, the record's `lastResolvedConfig`, `Conversation.model`, `Conversation.reportedModel`, `Conversation.modelName` (same value as `reportedModel`), and `ParsedSession.model` (with the `'unknown'` fallback). |
| **Conversation kind** | `ConversationKindSchema` conversation-kind.ts:22 (general∣buddy∣buddy_builder) | The buddy variant has buddyId, workspaceId, buddyProjectId, legacyWorkItemId, automationRunId, delegatedByBuddyId, parentBuddyConversationId, allowedBuddyOperations, briefing | `creation.buddyContext`/`purpose` in the record, plus a `<!-- unleashd:buddy-context-v2 -->` marker in the transcript | **4 encodings** of one fact: `kind`; `buddyContext` (`BuddyContextSchema` conversation-config.ts:151, nearly the same fields); the `purpose` enum; the text marker parsed back out (jsonl.ts:1583). `placement` is a fifth related field. Legacy derivation lives in conversation-kind.ts:154-200. |
| **Swarm/oompa worker** | Flat fields on Conversation (isWorker, swarmId, workerId, workerRole, swarmDebugPrefix); `Oompa*`/`SwarmRun*` interfaces index.ts:663-760; `shared/src/generated/oompa-types.ts` | | oompa's own files under `<cwd>/.oompa/runs/*`. Tags are parsed from the first user message (`extractWorkerMetadata` jsonl.ts:1510). | **This is a missing variant.** It should be `kind: 'swarm_worker'`, not five nullable fields. Today's init has 0 workers, so these are 5 null fields × 1,163 rows. |
| **Merge parent/child** | `mergeParentMeta`/`mergeChildMeta` index.ts:554-575; runtime types runtime.ts:79-93 | | Runtime only | **Also a missing variant.** The schema comment says "exactly one is set; both null otherwise". |
| **SubAgent** | `SubAgentSchema` index.ts:356, plus the WS start/update/complete messages | id, description, status, toolUses, tokens, currentAction, statusSource… | Extracted from transcripts: the Claude Task tool and codex collab | 3 sources (native, inferred, disk) are folded together in runtime.ts:1683-1845 |
| **Queue item** | `QueuedMessageSchema` index.ts:373 | id, content, queuedAt, status | Runtime memory only | 1 |
| **Turn attempt** | observability/types.ts, turn-attempt-journal.ts | | `observability/turn-attempts.jsonl` plus 4 rotations | 1 |
| **Error journal entry** | observability/error-journal.ts, types.ts | fingerprint, grouped counts | `observability/errors.jsonl` plus 4 rotations | 1 |
| **Project/folder** | **No type.** It is a `workingDirectory` string, grouped client-side by `folderGroupKey`/`getProjectRoot`. Related: `http/known-projects.ts`, and `resolveEncodedProjectDirectory` jsonl.ts:234 for lossy directory-name decoding. | | none | Implicit |
| **Device UI prefs** | `DeviceUiPrefsSchema` index.ts:883 (9 fields; `sidebarViewMode` is never read) | | Browser localStorage | Plus the retired `~/.agent-viewer/ui-state.retired.json` (620 KB), still on disk, and `conversations/legacy-ui-state.ts` (102 lines) |
| **Server settings** | http/persisted-state.ts | colorPalette, ignore[] | `~/.agent-viewer/settings.json` | 1 on the server, plus the client's zustand `settingsStore` |
| **Palettes** | palettes/palette-service.ts | | `~/.agent-viewer/palettes/` | 1 |
| **Uploads** | upload-routes.ts (multer) | | `~/.agent-viewer/uploads`, **701 MB, no retention** | 1 |

### One turn's events are re-typed four times

| Layer | Type | Example tags |
|---|---|---|
| Harness stdout | Per-harness raw JSON | `stream_event`, `item.completed` |
| agent-cli | `UnifiedAgentEvent` vendor/agent-cli-tool/src/runtime-types.ts:147-167 | `session.started`, `text.delta`, `tool.use`, `turn.complete`, `usage`, `progress` |
| server | `ProviderEvent` server/src/providers/index.ts:20 | `message_start`, `text_delta`, `tool_use`, `message_complete`, `error`. The server translates into this in runtime.ts:1264-1390, then switches on it again in `handleOutput` runtime.ts:1845-2120. |
| wire | `ServerMessage` index.ts:1105 | `chunk`, `message`, `message_complete`, `status`, `subagent_*`, `session_bound`, `queue_updated` |

`ProviderEvent` is a rename-only layer, about 150 lines of translation. The server should fold `UnifiedAgentEvent` directly.

### Drift and duplicates to fix

1. **Kind is encoded 4 ways** (`kind`, `buddyContext`, `purpose`, the text marker), and `placement` sits next to them. The wire still sends `purpose` and `placement` on every row (runtime.ts:3500-3501). The buddy variant of `ConversationKind` and `BuddyContext` are near-identical schemas (conversation-kind.ts:24-37 vs conversation-config.ts:151-166).
2. **"Which model" is stored in 8 places.** `reportedModel` and `modelName` serialize the same runtime field.
3. **The record has two revision counters,** `recordRevision` and `configRevision` (conversation-config.ts:218-220).
4. **Transcript content is stored 3 times:** the provider file, the session-cache JSON (491 MB), and the server heap. The heap keeps the full `messages[]` of every hydrated conversation.
5. **Worker, merge and swarm facts are nullable bags rather than sum variants.** Every row carries about 11 null fields for features that no current row uses.
6. **Model lists come from 5–6 sources** with silent fallbacks, including an absolute path under the user's home directory.
7. **Each provider's transcript format has 4 parsers:**
   - history: adapters/jsonl.ts
   - cost: http/usage-routes.ts:92,296,319
   - context meter: conversations/session-context.ts:96,259
   - live stream: vendor/agent-cli-tool/src/parsers/*

---

## 3. WS and HTTP contract (non-Buddy)

### Client → server over WS (`ClientMessageSchema` index.ts:860; validated in conversation-websocket.ts:104-105)

| Type | Handler (conversation-websocket.ts) | Ack | Purpose |
|---|---|---|---|
| create_conversation | :170 | conversation_created / command_rejected | Create with client-generated ids plus config (and an optional initialMessage) |
| set_conversation_config | :359 | conversation_updated(config) / command_rejected | Patch provider/model/reasoning, with CAS on `expectedRevision` |
| send_message | :284 | none | Legacy direct send. The composers use queue_message instead. |
| queue_message | :398 | command_accepted/rejected, sent only **after the full spawn setup** | Enqueue |
| interrupt_and_send | :399 | same | Preempt the running turn and send |
| cancel_queued_message / promote_queued_message / clear_queue | :426 / :429 / :432 | queue_updated | Queue editing |
| stop_conversation | :306 | status | Stop |
| delete_conversation | :310 | conversation_deleted | Delete. Also terminalises the Buddy link row. |
| set_conversation_done | :339 | conversation_updated(done) | Mark done |

### Server → client over WS (`ServerMessageSchema` index.ts:1105, 23 types)

| Type | Size and frequency | Notes |
|---|---|---|
| init | **1.95 MB** once per connection (about 190 KB deflated) | Every conversation as a "summary" (§0), plus archivedBuddyIds, defaultCwd and protocol. Built in conversation-websocket.ts:453-480. |
| conversations_updated | Summaries. Sent every 5s whenever any transcript changed, and in startup batches. | Full summary rows every time |
| conversation_load_complete | Ids of every conversation (~45 KB) | Prunes the client's list |
| conversation_created / conversation_updated | One full `Conversation` | `conversation_updated` carries the **full** `toJSON()` including **every message**, even for `reason:'done'` (conversation-websocket.ts:352-354), `'config'` (:384-387, runtime.ts:2738/2763) and `'status'` (:266-268). Marking a 5 MB conversation done sends 5 MB to every socket. These should be field patches. |
| conversation_deleted | small | |
| command_accepted / command_rejected | small; a rejection may embed a full Conversation | |
| chunk | One per text delta, the hot path | Stringified once per broadcast (application/context.ts:168); the client runs a full Zod parse on each one |
| message, message_complete, status, session_bound, queue_updated | small, per turn | |
| subagent_start / subagent_update / subagent_complete | per tool event | |
| merge_child_status | rare | |
| error | rare | Generic, uncorrelated |
| buddy_archived, buddies_changed (250ms debounce), channel_changed | Buddy | |

### HTTP routes outside buddies

| Route | File:line | Purpose | Cost note |
|---|---|---|---|
| GET /login, POST /login, GET /logout | auth/express.ts:78,90,126 | Shared-secret gate | |
| GET /api/audit | http/core-routes.ts:7 | Startup audit results | |
| GET /api/provider-catalog | core-routes.ts:11 | Model catalog (5 KB) | |
| GET /api/models | core-routes.ts:15 | Model list per provider | Duplicates provider-catalog |
| GET /api/conversations/:id | http/conversation-routes.ts:423 | Full transcript from the registry | Can be several MB; served from messages held in the heap |
| GET /api/conversations/:id/context-breakdown | conversation-routes.ts:372 | chars/4 estimate plus provider usage | **Synchronous `readFileSync` of the whole transcript** (session-context.ts:96). For codex it also does a sync year/month/day readdir walk (session-context.ts:296-306). |
| GET /api/conversations/:id/diagnostics | http/turn-diagnostics-routes.ts:5 | Turn journal read model | |
| GET /api/diagnostics/errors; POST …/client; POST …/:fp/acknowledge | http/error-diagnostics-routes.ts:28,43,72 | Error journal | |
| GET /api/paths, GET /api/validate-path, POST /api/mkdir, GET /api/files, GET /api/serve/* | http/filesystem-routes.ts:22,105,128,151,171 | Folder picker and file serving | |
| GET/POST /api/settings | http/persisted-state.ts:38,41 | settings.json | |
| GET /api/search | http/search-routes.ts:32 | Deep search | |
| POST /api/upload | http/upload-routes.ts:34 | multer, up to 20 files | No retention (701 MB on disk) |
| GET /api/usage | http/usage-routes.ts:486 | Token and cost aggregation | **22 sync fs calls**: sync readdir, stat and readFileSync over ~/.claude and ~/.codex (:111,196,319,589,655) |
| POST /api/conversations/merge | merge/routes.ts:222 | Merge review forks | |
| GET /api/custom-palettes, DELETE /api/custom-palettes/:key, POST /api/generate-palette | palettes/palette-service.ts:102,106,123 | Theming | |
| GET /api/oompa-swarm-context, /api/git-log, /api/swarm-runs, /api/swarm-new-files, /api/read-file | swarm/read-model-routes.ts:18,51,75,117,156 | Oompa dashboard | |
| GET /api/oompa-config, /api/swarm-runtime, /api/swarm-projects, POST /api/swarm-signal, GET /api/swarm-reviews | swarm/routes.ts:28,45,51,72,76 | Oompa dashboard | Sync fs (swarm/routes.ts:33-104,226) |
| GET /api/buddies/:buddyId/memory-reviews | server.ts:640 | A Buddy route inlined in the composition root | |

### Does the init need to be 2 MB?

No. The client needs a list-row projection, about 0.3 MB. Per-conversation `config`, `configResolution`, `providerUsage`, `subAgents`, `queue` and full `kind` belong to `GET /api/conversations/:id`, which is already the hydration path.

Cheapest wins, in order:
1. Drop `allowedBuddyOperations` and the Buddy-internal ids from the wire `kind`: about −300 KB.
2. Omit null and default fields: about −300 KB. The schema already has `.default()` on these fields.
3. Drop `configResolution`, `purpose`, `placement`, `modelName`, `model` and `reasoningEffort` from summaries, since they are duplicated or derivable: about −350 KB.
4. Cut the preview to about 120 characters: about −130 KB.

---

## 4. Business-logic hotspots

### 4.1 `server/src/conversations/runtime.ts` (3,510 lines)

The class is declared **inside** the factory `createConversationRuntime` (runtime.ts:690). It closes over a 38-member dependency bag (`ConversationRuntimeDependencies`, runtime.ts:273-364) and has about 53 instance fields.

| Concern braided into the class | Location | ~Lines |
|---|---|---|
| Buddy memory snapshot, briefing markers, audience, chat-run admission, owner MCP, coordination runs | 94-230, 778-960, 2120-2443, 3014 | ~900 (243 "buddy" mentions) |
| `spawnForMessage`, a single method of about **630 lines** | 1025-1658 | 630 |
| Translating UnifiedAgentEvent → ProviderEvent | 1264-1390 | 130 |
| `handleOutput` switch: text, tool_use, subagent detection, completion | 1845-2120 | 275 |
| Codex collab subagents (provider-specific) | 1683-1845 | 160 |
| Oompa swarm polling: a **2s `setInterval` per running conversation** that reads `.oompa/runs` synchronously | 2962-3156 | 200 |
| Watchdogs: bridge, provider-idle, max runtime | 2897-3089 | 190 |
| Queue: enqueue, interrupt, promote, cancel, clear, processQueue | 3185-3400 | 215 |
| Merge fork and soft fork, including a sync `readFileSync` of the review doc at :2609 | 2500-2709 | 100 |
| Turn-attempt journal hooks | 367-486, 970-1025 | 150 |
| Config resolution and the legacy getters `buddyContext`/`purpose` | 755-780, 3416-3460 | 80 |
| Serialization | 3462-3510 | 50 |

That is **about 11 concerns in one class**.

Structural branching on provider inside the core:
- **runtime.ts:1196-1222.** A three-level ternary builds `{harness: provider, ...baseRequest, reasoningEffort, ...buddyRequest}`. The claude, codex and muse branches are **identical** apart from type narrowing, and the last branch casts. The fix is one expression: make the request type generic over the harness, or allow `reasoningEffort` on every harness request.
- **runtime.ts:1770 and 2013** branch on `this.provider === 'codex'` for collab subagents. A codex parser that emits the existing `subagent.state` event should own this (vendor runtime-types.ts:49).
- **runtime.ts:144** `providerSupportsRequiredBuddyMcp` is a capability, so it belongs in the harness table.

**Proposed split**, with one clean path per type:

| Unit | Responsibility |
|---|---|
| `TurnQueue` | Pure state machine for the queue |
| `TurnRunner` | Spawn plus the event fold for one turn, with no Buddy code |
| `BuddyTurnPolicy` | Admission, briefing, MCP servers, memory. Injected as a strategy selected by `kind`; the general kind gets a no-op policy. |
| `SwarmObserver` | One per working directory, not one per conversation |
| `TurnWatchdog` | Timeouts |

`Conversation` then becomes a record, a queue and the current turn.

### 4.2 Session loading and polling

| Piece | File | Notes |
|---|---|---|
| Discovery | adapters/loader.ts:74-130 `discoverAll` | readdir of every provider root, then `Promise.all` stat of every file (about 14.9k paths) |
| **Poll every 5s** (`FILE_POLL_INTERVAL_MS`, constants/timeouts.ts:54) | loader.ts:600-700 `pollForChanges` | **Rediscovers everything every 5s**, then **awaits `fs.promises.stat` serially for each file** in a `for` loop (loader.ts:636-640). OpenCode computes a composite mtime over its part directories. |
| Skipping active sessions | loader.ts:651-689 | A **6-branch `if/else` on `adapter.provider`** derives the session id from the path. That duplicates `adapter.sessionFileKeys()`, which architecture.md says replaced exactly this. |
| OpenCode reach-in | loader.ts:614-619 | Casts the adapter to read a private `_sessionIndex` field |
| Poller state machine | lifecycle/file-poller.ts | Clean ports-and-adapters design. It calls `collectActiveIds()` 3× per update. |
| Session cache | adapters/session-cache.ts | One JSON file per source. Every hit runs `JSON.parse` plus a **Zod `safeParse` over the whole message array** (session-cache.ts:~68). `CACHE_VERSION` has been bumped 7 times, and each bump forces a reparse of all 7.6k sources. |
| Tail resume | adapters/transcript-tails.ts | Claude only. Codex (6.8 GB, including one 934 MB file) still does a full parse whenever the file changes. |
| Disk parsers | adapters/jsonl.ts | Six providers in one file, plus in-band identity parsing: the Buddy marker, `[oompa…]` tags, merge prefixes, Codex AGENTS.md bundles |
| Provider-specific id heuristics | lifecycle/session-loader.ts:567-572 | Special cases for `gemini` and for opencode `ses_` ids |
| Threading | whole server | **No `worker_threads` anywhere.** All JSON.parse and message extraction runs on the main event loop, interleaved with requests. |

### 4.3 Providers

`server/src/providers/*` (471 lines) now only lists models, which is the right level of thinness. The waste is in how models are sourced: three catalog readers and a `FALLBACK_*_MODELS` list in each provider file. `loadProviderModels` returns the hard-coded list whenever the catalog cannot be found (providers/catalog.ts:31), which is a silent fallback. Effort defaults are hard-coded per provider (shared index.ts:250), even though the catalog already carries `defaultEffort`.

### 4.4 Silent fallbacks in the core

| Site | Fallback |
|---|---|
| shared index.ts:489 | `provider: ProviderSchema.default('claude')` on the wire |
| disk-adapter.ts:174 `sessionToConversation` | Kind falls back to `{kind:'general'}`. architecture.md §2.1 documents the bug this caused. |
| disk-adapter.ts:55 | `model: 'unknown'` used as a sentinel string |
| conversation-kind.ts:154-200 | An invalid `kind` is logged, then re-derived from legacy fields |
| providers/catalog.ts:31 | A missing catalog returns the hard-coded model list |
| catalog-service.ts:~20-50 | Tries 7 candidate paths, including an absolute path under the user's home directory |
| index.ts:432 `effortLevelsForProvider` | `?? []` |
| Counts of `catch {}` / `?? ''` / `?? []` / `'unknown'` per file | jsonl.ts 37, swarm/read-model-routes.ts 23, usage-routes.ts 19, runtime.ts 17, swarm/runtime.ts 13, config-store.ts 13 |

### 4.5 Duplication between server and client

- Kind derivation (`getConversationKind`) runs on both sides, and the client re-derives Buddy grouping from `kind` on every update (§6).
- The client re-derives config resolution in 6 files instead of importing the shared `resolveConversationConfig` / `findModelDefinition`.
- There are two chat shells and two composers: Chat.tsx (1,022) vs mobile ConversationView.tsx (1,015), and Chat's composer vs ComposerMobile.tsx (518).

---

## 5. Performance and event-loop audit

### 5.1 Blocking calls on request, timer and turn paths, ranked by likely impact

| Rank | Site | Kind | Path | Data size | Why it matters |
|---|---|---|---|---|---|
| **1** | Buddy scheduler `setInterval(poll, 1000)` (server.ts:763 → buddies/scheduler.ts:284) using `node:sqlite` `DatabaseSync` (@nbardy/buddies store.js:252) | sync sqlite | timer, **every 1s** | 93 MB DB + 5 MB WAL, 157 prepared statements | This is the measured cause of the p50 157ms / max 2.1s (brief) and max 18s (today) HTTP stalls. Every sqlite call blocks the only thread. |
| **2** | Waiting Buddy chat run: `setInterval(() => this.processQueue(), 1000)` for **each waiting conversation** (runtime.ts:2406), calling `startBuddyChatRun` against sync sqlite | sync sqlite | timer, 1s × N waiting | | Grows with the number of queued Buddy chats |
| **3** | `pollForChanges` every 5s (loader.ts:600-700) | async, but serial `await stat` over ~14.9k paths, plus full rediscovery (readdir of every project directory) | timer, 5s | about 15k stats per tick | Not blocking per call, but it keeps the libuv threadpool (4 threads) and the loop busy for a large part of each tick, delaying other fs work queued behind it (config-store reads, uploads) |
| **4** | Full reparse of a changing Codex rollout (jsonl.ts:546 `parseCodexJsonlFile`) on poll | main-thread CPU (readline + JSON.parse per line) | timer, whenever an external codex session is running | files up to **934 MB** | Codex has no tail resume. A running external codex session costs seconds of CPU per change. |
| **5** | Session-cache hit: `JSON.parse` + Zod `safeParse` of the whole message array (session-cache.ts:~67-68) | main-thread CPU | startup (500 conversations) and each poll hit | records up to 9.4 MB, 64 KB on average | Zod v3 over tens of thousands of messages at boot is a large share of the 14–20s barrier (inferred from code; not profiled) |
| **6** | `/api/usage` (usage-routes.ts:486+) | **sync** readdirSync, statSync, readFileSync + JSON.parse per line (:111,196,319,589,655) | request (UsagePanel) | up to 3.1 GB Claude + 6.8 GB codex, filtered to 30 days by mtime | One click can stall the loop for seconds. A response cache exists, and the per-file caches are cleared when it expires. |
| **7** | `/api/conversations/:id/context-breakdown` → session-context.ts:84,96,248-259,296-306 | sync stat, **readFileSync of the whole transcript**, sync codex year/month/day walk | request, on each chat open (ContextBreakdownMeter) | transcript size (MBs to hundreds of MB) | Runs on the hot "open a conversation" path |
| **8** | Swarm polling per running conversation: `readLatestOompaRuntime` (swarm/runtime.ts:38-133, 12 sync calls) every 2s (runtime.ts:3099), and on events throttled to 1.5s | sync readdir, stat, readFile | timer and turn | `.oompa/runs/*`, typically small | N running turns × 0.5 Hz of sync fs, even in repos with no `.oompa` directory at all (then it is just existsSync) |
| **9** | Swarm routes (swarm/routes.ts:33-226, context.ts, read-model-routes.ts) | sync fs | request, polled by the client every 10–15s | small–medium | |
| **10** | `conversation_updated` → `toJSON()` with all messages, `JSON.stringify` once, deflated per socket (context.ts:168) | main-thread CPU | WS command (done/config/status) | full transcript | Multi-MB stringify plus deflate for a one-bit change |
| **11** | Init: `summarizeConversation` × n + `JSON.stringify` of 2 MB + deflate | CPU | per WS connect (every reconnect, every tab) | 2 MB | ~50–100ms per connect (estimated) |
| 12 | Catalog readers (providers/catalog.ts:22-32, catalog-service.ts:45-47) | sync existsSync + readFileSync | startup, then cached | small | Low impact |
| 13 | lifecycle/system-ports.ts:28,33 `execSync` (lsof, kill -9) | sync child_process | startup only | | Low impact, but it blocks at boot |
| 14 | transport/websocket.ts:22 `statSync` (validateWorkingDirectory) | sync | WS create | | Low |
| 15 | runtime.ts:2609 `readFileSync` of a merge review doc | sync | merge completion | small | Low |

### 5.2 Timers and pollers

| Owner | Cadence | Work per tick |
|---|---|---|
| Buddy scheduler (server.ts:763, scheduler.ts:284) | **1s** | sync sqlite: due automations, coordination, run capacity |
| Buddy chat admission (runtime.ts:2406) | 1s per waiting conversation | `processQueue` → sync sqlite |
| File poller (file-poller.ts:134, `FILE_POLL_INTERVAL_MS` 5s) | 5s | rediscover and stat ~14.9k paths; reparse changed files; broadcast summaries |
| Swarm poller (runtime.ts:3099, `SWARM_POLL_INTERVAL_MS` 2s) | 2s per **running** conversation | sync read of `.oompa/runs` |
| Turn watchdogs (runtime.ts:2905,2942,2953) | per turn, rearmed on activity | timers only |
| Attempt-activity journal (`ATTEMPT_ACTIVITY_INTERVAL_MS` 5s, runtime.ts:367) | throttled on events | async append to turn-attempts.jsonl |
| WS liveness (transport/websocket.ts:72) | 20s per socket | ping |
| buddies_changed debounce (server.ts:479) | 250ms | broadcast |
| Shutdown drain (shutdown.ts:160,222) | during reload only | counters |
| Memory reviewer (Buddy, server.ts:~755) | own loop | out of scope |
| Client side (for context) | 1s turn-status tick; 2–30s `usePolledFetch` (Buddy panels at 5s, one at 2s) | HTTP load on the same blocked loop |

### 5.3 Startup, memory and processes

**Startup order** (server.ts, lifecycle/session-loader.ts, adapters/loader.ts):
1. Auth, config store, session cache
2. Discovery of about 14.9k sources, stat, mtime sort
3. The config-store lookup scan runs in parallel: it reads all ~7,982 records
4. Hydration of the newest 500 through the session cache (a miss means a parse)
5. Recovery of transcript-less records, 16-wide
6. Barrier (`initialLoadComplete`)
7. The Buddy scheduler and memory reviewer start

Scaling behaviour: history size drives steps 2, 3 and the pruning of stale cache records. The hydration cap (500) bounds step 4.

**Memory:** the backend is 472 MB RSS in dev. That includes tsx transpile caches, about 1,163 conversations of which about 500 are fully hydrated with every message in the heap, and the sqlite page cache. The supervisor is 81 MB.

**Processes per turn:**

| Case | Processes spawned |
|---|---|
| General turn | 1: the provider CLI via `vendor/agent-cli-tool/src/process-runner.ts:48`. Claude and cursor CLIs are node processes; codex is a native binary. |
| Buddy turn | +1–2 MCP servers, launched by the CLI through `server/src/buddies/mcp-config.ts:18-40`. **In dev the compiled `.js` does not exist next to `src/`** (the check at mcp-config.ts:21-22 resolves to `server/src/buddies/*.js`), so each MCP server starts as `node --import tsx <entry>.ts` and transpiles on every turn. Owner controls add a second (`owner-mcp`). |
| Cursor with required MCP | +1 probe spawn per required server before the turn (vendor execute.ts:277 → mcp-startup.ts:18) |
| Server-side git/oompa execFile | Only on swarm routes (swarm/commands.ts:27,44), not on turns |

A typical Buddy turn on claude is therefore **2–3 node processes, each about 60–150 MB**, one of them paying tsx startup.

---

## 6. Client

Full atom and spine tables came from a sub-audit. The findings that bear on a lean rework are summarized here; file:line refer to `client/src`.

### 6.1 Atom structure

- **Base atoms:**
  - `conversationsAtom` (a Map, atoms/conversations.ts:27)
  - `streamingContentAtom` (:65)
  - pending creations and pending config (:54-55)
  - `resourceCacheAtom` (atoms/resources.ts:64, LRU)
  - `prefsAtom` and `seenAtom` (atoms/ui.ts:112,116, backed by localStorage)
- **Derived from `conversationsAtom`:** `allConversationsAtom` (:183, filter and sort), then about 12 more: ids, the id Set, recent directories, the inbox, three buddy-sidebar atoms, running-count-by-folder, workers-by-project, mobile search, and buddy background.
- **Per-id families:** `conversationAtomFamily`, `chatMessageGroupsAtomFamily`, `childConversationsAtomFamily` (:145, an **O(n) scan that returns a new array every time**), `queueAtomFamily`, and 8 more.
- **A second state library:** zustand, used only by `stores/settingsStore.ts`.

### 6.2 O(n) work on every event (n ≈ 1.1k–5k)

Every write to `conversationsAtom` triggers all of the following. That includes status, queue and message events, and **each 5s poller batch**.

| # | Site | Cost |
|---|---|---|
| 1 | Immer `mutate()` copies the Map (atoms/mutate.ts:11, actions.ts:129) | O(n) plus the auto-freeze check |
| 2 | `allConversationsAtom` filter and sort | O(n log n); sort keys are cached |
| 3 | `allConversationIdsAtom` → `availableConversationIdSetAtom` (:208, :213) | 2× O(n). It builds **a new Set each time**, re-rendering about 5 subscriber types, including every `BuddyWorkerThreadBadge`. |
| 4 | buddy-sidebar.ts:48, 186, 213 | 3× O(n), plus 3 more id Sets rebuilt |
| 5 | Sidebar.tsx:138-199 `useMemo` chain | 4× O(n). `getConversationLastActivity` **parses dates with no cache**, and `folderGroupKey` runs 3 regexes per row. This breaks the "list views go in derived atoms" rule. |
| 6 | Gallery.tsx:98-107 (desktop `/`) | The sort comparator parses dates |
| 7 | `childConversationsAtomFamily(openId)` | Chat.tsx (1,022 lines) re-renders on any event for any conversation |
| 8 | `workersByProjectAtom` (:303) | A new Map each time. 6 swarm views subscribe, and 5 of them regroup it again. |
| 9 | `markConversationsSeenBulk` on every `conversations_updated` (actions.ts:660-665) | O(n) JSON write to localStorage and a re-render of every mobile row. This is also a **bug**: the NEW badge never shows for external updates. |
| 10 | Stream frames at about 60 Hz: `chatMessageGroupsAtomFamily` → `groupChatMessages` (utils/chat-message-groups.ts:31) | Regroups the **whole transcript** every frame. Each group gets a new identity, so every visible `VirtualizedGroup` re-renders. |
| 11 | `safeParseServerMessage` (hooks/useWebSocket.ts:39) | A full Zod discriminated-union parse per WS message, including every `chunk` and the 2 MB init |
| 12 | `console.log` in the spine (actions.ts:346, 484, 534, 543, 548, 620, 722, 734, 752) | Runs per event |

The sub-audit estimates, without profiling, 10–30 ms per event at n=5k on desktop and about 4× that on a phone.

The fix is structural:
- **One sidebar-index atom** computed in a single pass.
- Stable empty arrays and equality-checked results.
- Message groups keyed by message identity, so only the tail group changes while streaming.
- Remove the bulk seen-mark.
- Run Zod only on init and snapshots, never on `chunk`.

### 6.3 Components and duplication

The largest components are in the §1 table. The desktop and mobile trees duplicate:
- the chat shell: ConversationView.tsx inlines about 355 lines of copied panels at :147-500
- the composer
- the swarm regroup (6 copies)
- the 30s "time ago" tick (8 copies)
- the home-directory shortening regex (17 copies across 13 files)

`'claude'` is hard-coded as the default provider in 8 client places.

### 6.4 Bundle (client/dist, built Sep 24)

| Chunk | Raw | Gzip |
|---|---|---|
| main: the entire app, both device trees, every route | **1,085 KB** | 318 KB |
| KaTeX (lazy) | 266 KB | 79 KB |
| highlight.js (lazy) | 174 KB | 53 KB |
| CSS | 277 KB | 43 KB |

There is no `React.lazy` and no `manualChunks`. App.tsx statically imports every route, including the unlinked `/robot` demo.

### 6.5 Client polling

`usePolledFetch` pauses while the tab is hidden. Cadences:
- BuddyWorkspaceActivity: **2s**
- 8 Buddy panels: 5s
- swarm runtime: 10s
- swarm projects: 15s
- channel backstops: 30s
- turn status: a 1s tick while a turn is running
- a 30s re-render tick in 8 places

---

## 7. Waste list

The dead-export scan (`.work/dead.mjs`) finds each `export` in the non-Buddy server, shared and vendor code and checks for word matches in any other src or test file. It reported **71 exports unused anywhere**. Most of those are 1-line type aliases in shared/src/index.ts, such as the per-message `*Message` types (index.ts:791-1103) and the `ClaudeModel`/`GeminiModel`/`MuseModel` aliases. It also found 243 exports used only inside their own file, which is export noise with 0 deletable lines, and 54 exports used only by tests.

| # | Item | Where | Est. deletable lines | Risk |
|---|---|---|---|---|
| 1 | Dead functions and values | `extractSubAgentsFromEntries` jsonl.ts:1342; `formatToolResult` tool-format.ts:392; `isAuthEndpoint` auth/gate.ts:152; `refreshProviderCatalog` catalog-service.ts:174; `__clearCatalogCache` catalog.ts:43; `isGeneralKind`/`isBuddyBuilderKind`/`getBuddyId`/`getWorkspaceId` conversation-kind.ts:70,73,246,262; `CODEX_THINKING_DISPLAY_NAMES` index.ts:159; `EFFORT_DISPLAY_NAMES` index.ts:458; `isClientMessage`/`isServerMessage` index.ts:1172-1178 (commented "for backwards compatibility"); `isModelInCatalog` vendor catalog.ts:96; unused type aliases (~40) | ~150 | Low |
| 2 | Test-only production exports | `parseJsonlFile` jsonl.ts:371, `extractMessagesFromEntries` :1079, `recoverOpenCodexTurns` codex-turn-lifecycle.ts:131, `transitionConversationConfig` conversation-config.ts:371, `parseClientMessage`/`parseServerMessage` index.ts:1143,1157, `DEFAULT_TURN_IDLE_TIMEOUT_MS`/`TURN_IDLE_TIMEOUT_MS` timeouts.ts:38-39 | ~80 prod + their tests | Low |
| 3 | `ProviderEvent` re-typing layer | providers/index.ts:20; translation at runtime.ts:1264-1390; second switch in `handleOutput` | ~150 | Medium |
| 4 | Identical provider ternary | runtime.ts:1196-1222 | ~25 | Low |
| 5 | Legacy kind encodings | `buddyContext`/`purpose`/`placement` on the wire and runtime (runtime.ts:755-780); `conversationKindFromLegacy` + `getConversationKind` legacy path (conversation-kind.ts:140-200); `BuddyContextSchema` as a separate schema; the text marker as identity source (jsonl.ts:1583-1660). Needs a one-time record migration first. | ~300 | Medium |
| 6 | Legacy config migration + retired UI state | conversations/legacy-config-migration.ts (117), legacy-ui-state.ts (102), `ui-state.retired.json`; `shared/src/legacy/codex-composite-model.ts` (37) | ~260 | Low–Medium: needs confirmation that no un-migrated records remain |
| 7 | Duplicate transcript parsers | usage-routes.ts (771), which should read usage from the session cache / normalized parse; session-context.ts (405), which should use the parsed session's usage or `latestUsage` in the binding. Keep jsonl.ts plus the vendor stream parsers. | ~800–1,000 | Medium |
| 8 | Model catalog readers and fallbacks | providers/catalog.ts, catalog-service.ts `loadFileCatalogReasoning` with 7 paths including an absolute home path, `FALLBACK_*_MODELS` × 6 files, hard-coded effort defaults index.ts:250. The generated catalog should be the single source. | ~250 | Low |
| 9 | Provider `if/else` in the poller | loader.ts:651-689 (use `sessionFileKeys`) and the OpenCode `_sessionIndex` cast (:614-619) | ~40 | Low |
| 10 | Nullable worker/merge/swarm fields → kind variants | index.ts:510-575, runtime fields, jsonl.ts:1494-1580, client consumers | net −150, plus −300 KB from init | Medium |
| 11 | Observability volume | turn-attempt-journal.ts (835) + types.ts + diagnostics route. It is a second event log parallel to the provider transcript. The route is used by `useTurnDiagnostics`, so check how much of the UI actually reads it. A leaner option is one summary row per turn (start, end, cause) folded into the error journal. | ~500 | Medium: it is incident tooling |
| 12 | Incident-narrative comments | about 30–60% of lines in shared/src/index.ts, runtime.ts, config-store.ts and session-loader.ts are comments. Many are dated incident stories that belong in docs or commit messages. Example: `ConversationSchema.done` has a 7-line comment on a `.default(false)`. | ~1,500 comment lines | None (no behaviour change) |
| 13 | Oompa/swarm subsystem | server/src/swarm (1,112), per-conversation swarm poller in runtime (200), SwarmDetail/SwarmAnalytics/SwarmDashboard + mobile copies (~3,500 client). There are 0 workers in today's init. Candidate for a separate app or plugin if it is rarely used. | ~5,000 if cut | Product decision |
| 14 | Palette generator | palettes/ (393) + ColorPalettePicker (595) + zustand store (368) | ~600 if simplified to presets | Product decision |
| 15 | Merge feature | merge/routes.ts (274), runtime merge fork (~100), MERGE_REVIEW_PROMPT, merge atoms, strip UI | ~800 if cut | Product decision |
| 16 | `send_message` WS command | Composers use queue_message; conversation-websocket.ts:284 | ~30 | Low: verify no Buddy caller |
| 17 | Uploads with no retention | 701 MB on disk | 0 lines; add GC | Low |
| 18 | session-cache stores whole transcripts | 491 MB. Could store only a list-row summary plus a byte offset, and reparse on open. | Architectural | Medium |
| 19 | Client items (sub-audit) | `/robot` demo (~320), dead CSS (~330), swarm regroup ×6 (~70), mobile panel copies (~150), zustand store (~60 + one dependency), legacy pending-creation migration (~45), tick/home-shorten copies (~40), config re-derivation (~30), `sidebarViewMode` (~8) | ~1,100–1,400 | Low |

**Totals:** safe deletions are about 3–4k lines of code plus about 1.5k comment lines. If swarm, merge and palette are cut or split out, that adds about 6–7k more.

---

## 8. Rust candidacy (scoping only)

A Rust rewrite of I/O-bound, orchestration-heavy code does not by itself fix this app's slowness. The measured stalls come from **synchronous work on the one JS thread**: sqlite on a 1s tick, sync fs in routes, and CPU parsing of huge transcripts on the main thread. They also come from **doing too much**: rescanning 15k files every 5s, 2 MB inits, full-transcript rebroadcasts. Moving these off the main thread, making them async or deleting them fixes most of it in TypeScript.

Rust pays off where there is real CPU or memory work: parsing multi-GB JSONL, holding and serving transcripts, and a filesystem watcher replacing polling.

| Subsystem | Bound by | Rust benefit | Risk | Dependencies | Notes |
|---|---|---|---|---|---|
| **Transcript ingest**: disk parsers jsonl.ts, session cache, usage and context-meter parsers | **CPU + memory** (JSON.parse of GBs; a 934 MB codex file; Zod over large message arrays) | **High.** serde/simd-json streaming parse is 5–20× faster and off the event loop. Tail-resume for every format and mmap-based scanning come naturally. | Medium: six formats with many quirks (Codex AGENTS.md bundles, Buddy envelopes, merge prefixes), all encoded as comments and tests | Provider file formats only | **The best first seam.** Build a sidecar binary or napi module that emits `ParsedSession`/summary JSON. The contract already exists (`ParsedSession`, disk-adapter.ts:50) and there are regression fixtures in server/test. |
| **Discovery/poller** (loader.ts pollForChanges, file-poller.ts) | I/O syscalls (15k stats every 5s) | **Medium.** `notify` (FSEvents) replaces polling entirely. The real win is event-driven watching, which is also doable in Node with `fs.watch` recursive on macOS. | Low | ingest | Do it together with ingest |
| **Buddy store (node:sqlite DatabaseSync)** | Sync sqlite on the main thread | **Medium–High as a process boundary.** The same win is available by moving the store into a worker_thread or child process, in any language. A Rust service (rusqlite) owning the SQLite file is natural if Buddies becomes its own daemon. | High: owned by the @nbardy/buddies package, 35 tables (being cut to about 10) | The Buddies package | Seam: the SQLite file plus the Buddy MCP stdio protocol. See the Buddies scope. |
| **Config store** (config-store.ts, 16.8k JSON files) | File I/O count | **Low for Rust itself.** The win is the data layout: one SQLite table instead of 16.8k files, shared with the Rust ingest. | Medium: CAS and provenance semantics | ingest | Migrate the storage shape, not the language |
| **Conversation runtime** (runtime.ts: queue, spawn, event fold, watchdogs) | Process spawn + event fan-out; I/O-bound orchestration | **Low–Medium.** tokio would be fine, but the complexity is logic, not speed. First split it into TurnQueue/TurnRunner/BuddyTurnPolicy (§4.1). | High: most business rules and incident fixes live here | agent-cli, Buddies, config | Port late, and only after the split |
| **agent-cli-tool** (build argv, spawn, parse stdout) | Process spawn + streaming parse | **Low–Medium.** Small, pure and well-bounded (4.1k lines), so it is a natural Rust crate and CLI. Per-turn cost is dominated by the provider CLI's own startup (Claude CLI is node) and the tsx-launched MCP servers. | Low | Harness CLIs | A good second port because its seam is already a canonical request plus a unified event stream |
| **Buddy MCP server** (spawned per turn) | **Process spawn + tsx startup** | **High per turn** as a static binary (~5 ms start vs ~0.5–1s for tsx transpile). Much of the same win comes from launching the prebuilt `.js` in dev. | Medium | Buddies store | Seam: the MCP stdio protocol |
| **HTTP/WS transport + auth** | I/O | **Low.** Express/ws are not the bottleneck; payload shape is (§3). | Medium: the security-sensitive gate needs a careful port | everything | Port last. The contract (shared Zod schemas) would need to become JSON Schema or a Rust-first definition (e.g. `typeshare`/`ts-rs`) to avoid drift. |
| **Usage/cost** (usage-routes.ts) | CPU + sync fs | High if kept, but it should be **deleted** and computed from ingest | Low | ingest | |
| **Swarm/oompa read models** | small sync fs | None | | oompa | Make it async or move it out |
| **Client** | Render work (O(n) derived atoms), 1 MB bundle | Not a Rust question. WASM would not help; the fixes are §6.2 plus code-splitting. | | | |

### Proposed incremental order, with seams

| Step | Change | Seam |
|---|---|---|
| **0. TS hygiene (no Rust)** | Move the Buddy store behind a worker_thread or child process. Make usage/context/swarm fs async. Slim the init to list rows; send field patches instead of full `conversation_updated`. Launch the compiled MCP entrypoint in dev. Add Codex tail-resume. Expected to remove most of the p90/max stalls. | none |
| **1. `unleashd-ingest` (Rust sidecar or napi-rs)** | FSEvents watcher, six parsers, and a normalized session store in one SQLite file (replacing session-cache-v1's 7.6k JSON files and eventually the config-store directory). It emits list-row summaries and full transcripts on demand. The Node server reads it over stdio JSON-lines or reads the SQLite read-only. | Process boundary + SQLite file. Contract: `ParsedSession` / summary row. |
| **2. `agent-cli` in Rust** | Same canonical request → argv → spawn → unified events, exposed as a CLI emitting NDJSON. Node consumes it as a child process, exactly as it consumes the provider CLI today. | Process boundary + the `UnifiedAgentEvent` NDJSON |
| **3. Buddies daemon** | Owns `buddies.sqlite`, the scheduler and the MCP server as one binary (coordinate with the Buddies scope, which cuts 35 → ~10 tables first). | SQLite file + MCP stdio + a small HTTP API |
| **4. Conversation runtime + WS server** | Only after §4.1's split, and only if the Node shell is still the bottleneck. At that point it is thin: registry, queue, broadcast. | HTTP/WS contract (the shared schemas, converted to a codegen source) |

**Where Rust does not help:** the 2 MB init, full-transcript broadcasts, O(n) client derivations, the 5s full rescan (a design issue), 7-way model duplication, and the braided runtime. These are data-shape and design problems, and the same fixes apply in TypeScript.
