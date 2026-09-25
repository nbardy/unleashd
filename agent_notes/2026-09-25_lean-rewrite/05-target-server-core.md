# 05 — Target design: non-Buddy server core + shared types

Scope: `server/src` without `server/src/buddies` (21,272 lines) and `shared/src` (4,516 lines), HEAD `cbb8820`.
Together that is **25,788 lines**. This is a read-only design; no repository file was edited.
Inputs: DESIGN.md, PROJECT.md, 03-app-core.md (evidence), 02 §8 (Buddy target), docs/architecture.md,
docs/ws-contract-surprises.md, docs/pass-through-pattern.md, docs/auth.md, docs/error-journal.md, CLAUDE.md.
Every file:line below was re-checked with a single-file search at `cbb8820`.

Decisions this design builds on: merge is deleted; swarm is quarantined as a `Worker` variant plus one
`SwarmObserver`; transcripts move to the Rust crate `unleashd-ingest`, which owns one SQLite store;
agent-cli stays TypeScript; Buddies becomes a Rust core plus ~1.9k lines of server modules; runtime.ts
is split into TurnQueue / TurnRunner / BuddyTurnPolicy / SwarmObserver / TurnWatchdog.

**Result:** 25,788 → **~7,100 TypeScript lines (3.6×)**, or ~6,200 (4.2×) once the quarantined swarm
code is deleted. About 3.3k lines of Rust in `unleashd-ingest` take over the parsing. Counting that
Rust, the total is ~10.4k (2.5×). Most of the 3–4× comes from deleting and de-duplicating code. The
Rust move itself is roughly line-neutral. What it buys is speed and memory, not fewer lines.

---

## 1. Canonical domain model

Rules applied throughout:
- Each fact has **one owner and one store**.
- Every "kind of thing" is a tagged union (`t`).
- Absence is allowed only where absence is the meaning (`parent: ConversationId | null` = "top level").
- There are no `'unknown'` sentinels and no `.default('claude')`.

### 1.1 Identity and kind

```ts
// shared/src/domain.ts
type ConversationId = string & { readonly __brand: 'ConversationId' };   // opaque: 'buddy-run-<id>' is valid (ws-contract-surprises.md)
type ProviderSessionId = string & { readonly __brand: 'ProviderSessionId' };
type Provider = 'claude' | 'codex' | 'cursor' | 'muse' | 'gemini' | 'opencode';

type ConversationKind =                         // the ONE encoding of "what is this thread"
  | { t: 'chat' }
  | { t: 'buddy'; buddyId: string; workspaceId: string; visibility: 'foreground' | 'background' }
  | { t: 'builder' }
  | { t: 'worker'; swarmId: string; workerId: string; role: 'work' | 'review' | 'fix' };   // quarantined (C.5)

type Origin =                                   // lineage, detail-only except `parent`
  | { t: 'new' }
  | { t: 'fork'; from: ConversationId; throughMessageSeq: number; handoff: string }   // Chat "Fork" (soft handoff)
  | { t: 'child'; parent: ConversationId };                                            // provider-native sub-thread, Buddy child

type Provenance =                               // "a config record is not a conversation" (architecture.md §2.0)
  | { t: 'created'; commandId: string; fingerprint: string; firstMessage: FirstMessage }
  | { t: 'discovered' };                        // sidecar of a transcript on disk; never materialised without one

type FirstMessage =
  | { t: 'none' }
  | { t: 'pending'; text: string }
  | { t: 'claimed'; text: string; token: string; at: Date }
  | { t: 'dispatched'; at: Date };
```

| Owner / store | Replaces or deletes |
|---|---|
| `ConversationKind` is written once, at creation, into the `conversation` table of `unleashd.sqlite`. The owner is `config/records.ts` (a TS wrapper over the crate). Buddy-only data (allowed ops, briefing, delegation ids, knowledge scope) lives in the Buddies core's `run` and `TurnGrant`, **not** on the conversation. | `ConversationKindSchema` (conversation-kind.ts, 3 variants with 9 Buddy fields); `BuddyContextSchema` (conversation-config.ts, a near-copy); `purpose`; `placement` (now `visibility`); the `<!-- unleashd:buddy-context-v2 -->` marker as a source of identity; `isWorker`/`swarmId`/`workerId`/`workerRole`; `mergeParentMeta`/`mergeChildMeta` (deleted with merge); `conversationKindFromLegacy` and `getConversationKind`'s legacy path; `allowedBuddyOperations` on the wire (293 KB of init) |
| `Origin` is stored in the record | `parentConversationId`, `resumedFromConversationId`, `creation.branch` (its Buddy `audience` field moves to the Buddy grant) |
| `Provenance` is stored in the record | `provenance` enum + `creation.{commandId, fingerprint, initialMessage, initialMessageDispatchClaimedAt, …ClaimToken, …DispatchedAt}` (6 optional fields become one union) |

### 1.2 Conversation record (durable) and session binding

```ts
type ConversationRecord = {                     // row in unleashd.sqlite `conversation`; written only by config/records.ts
  id: ConversationId;
  kind: ConversationKind;
  origin: Origin;
  provenance: Provenance;
  cwd: string;
  config: ConversationConfig;                   // §1.4
  configRevision: number;                       // the ONLY revision counter; CAS for set_config
  lastResolved: ResolvedExecutionConfig | null; // null = never resolved (absence is the meaning)
  session: SessionState;
  pastSessions: SessionBinding[];               // display history across session resets
  lifecycle: { t: 'active'; done: boolean } | { t: 'deleted'; at: Date };   // tombstone
  createdAt: Date;
  updatedAt: Date;
};

type SessionState = { t: 'unbound' } | { t: 'bound'; binding: SessionBinding };
type SessionBinding = {
  provider: Provider;
  sessionId: ProviderSessionId;
  policyKey: string;       // opaque key from the TurnPolicy: 'chat' for chats, the audience key for Buddies
};
```

| Owner / store | Replaces or deletes |
|---|---|
| `conversation` table, owned by the crate's store and accessed only through `config/records.ts`. Field updates are single-writer (the server). Only `config` uses CAS. | `PersistedConversationConfigRecordSchema` stored as **16,804 JSON files, 78 MB** (7,982 by-conversation + 8,822 by-session). `recordRevision` (the second counter). `currentSession` next to `sessionBindings[]`. `status` + `done` + `deletedAt` (three fields for one lifecycle). `Conversation.sessionId` and the runtime `sessionId` mirrors. `buddyAudienceKey`, which becomes `policyKey`. `latestUsage`, which moves to the turn record (§1.3). config-store.ts (991), legacy-config-migration.ts (117), legacy-ui-state.ts (102). |

### 1.3 Turn, turn events, messages: typed once

The pipeline today is: harness JSON → `UnifiedAgentEvent` → `ProviderEvent` → `ServerMessage`, which
is four shapes. The target has two:

```
harness JSON ──(agent-cli parser)──▶ UnifiedAgentEvent ──(TurnRunner.fold)──▶ Turn state + wire Patch / Delta / Message
```

`UnifiedAgentEvent` (vendor/agent-cli-tool/src/runtime-types.ts) is **the** event type, owned by
agent-cli. The server folds it directly. `ProviderEvent` (server/src/providers/index.ts:20) and its
translation are deleted. Codex collab sub-agents move into the codex parser and arrive as the existing
`subagent.state` event. That deletes the `this.provider === 'codex'` branches and subagent-tools.ts.

```ts
type Message = { seq: number; role: 'user' | 'assistant' | 'system'; at: Date; body: MessageBody };
type MessageBody =
  | { t: 'text'; text: string }
  | { t: 'tool'; name: string; input: string }          // raw input kept (architecture.md: codex tool history)
  | { t: 'end'; reason: CompletionReason };             // replaces completedAt?/completionReason?

type CompletionReason = 'success' | 'error' | 'out_of_tokens' | 'killed';

type TurnState =                                        // replaces isRunning + isStreaming (+ the invariant comment)
  | { t: 'idle' }
  | { t: 'starting'; attemptId: string; startedAt: Date }
  | { t: 'running'; attemptId: string; startedAt: Date; streaming: boolean }
  | { t: 'stopping'; attemptId: string };

type TurnOutcome =
  | { t: 'completed' } | { t: 'out_of_tokens' }
  | { t: 'stopped'; by: 'user' }
  | { t: 'timed_out'; which: 'bridge' | 'provider_idle' | 'max_runtime' }   // max_runtime ≠ user_stop (CLAUDE.md)
  | { t: 'failed'; message: string };

type TurnRecord = {                                     // one row per attempt: `turn` table
  attemptId: string; conversationId: ConversationId; queueItemId: string | null;
  startedAt: Date; endedAt: Date; outcome: TurnOutcome;
  usage: ProviderTurnUsage | null;                      // null = the harness reports none (muse)
  observedModel: string | null;                         // provider-reported, never configuration authority
};

type SubAgent = { id: string; description: string; toolUses: number; tokens: number; startedAt: Date;
                  status: { t: 'running'; action: string } | { t: 'completed'; at: Date } | { t: 'error'; at: Date } };
type QueueItem = { id: string; text: string; queuedAt: Date; state: 'pending' | 'sending' };
```

| Entity | Owner / store | Replaces or deletes |
|---|---|---|
| `Message` | Committed history comes from `unleashd-ingest` (the provider file is the source; the crate indexes it). The in-flight turn's messages live in the `TurnRunner` overlay until ingest reports them. | `MessageSchema` + optional `toolCall`/`completedAt`/`completionReason`; the session-cache copy (491 MB); **every hydrated conversation's `messages[]` in the heap** (a large share of 472 MB RSS); 8 session shapes (`ParsedSession`, `JsonlSession`, `CodexSession`, …) |
| `TurnState` | `TurnRunner`, in memory | `isRunning`, `isStreaming`, `status` messages |
| `TurnRecord` | `turn` table, written by `turns/record.ts` at each phase change | turn-attempt-journal.ts (835) + types.ts (176) + runtime-observer.ts (64) + the `/diagnostics` route + the client's polling hook `useTurnDiagnostics` (the latest attempt now arrives as a patch). `Conversation.providerUsage`, `reportedModel`, `modelName` (same value, runtime.ts:3480/3489), `binding.latestUsage` |
| `SubAgent` | `TurnRunner`, live only | `rawStatus`/`statusSource`/`providerThreadId`, the three folded sources (runtime.ts ~1683-1845), and disk-extracted sub-agents (0 rows use them today) |
| `QueueItem` | `TurnQueue`, in memory | unchanged shape |

### 1.4 ConversationConfig: model and effort in one place

`ConversationConfig` (conversation-config.ts) is already the right shape and is kept unchanged:
`{provider, model: default|explicit, reasoning: default|disabled|explicit}` plus
`ConversationConfigPatch` and `resolveConversationConfig`.

| Where "which model" lives today (8 places) | Target |
|---|---|
| `config.model` | **Kept: the only intent** |
| `configResolution.value.modelId` | Computed on demand (`resolve(config, catalog)`). Sent only in the detail and in a `config` patch. |
| `configResolution.lastResolved`, record `lastResolvedConfig` | One `record.lastResolved` |
| `Conversation.model`, `Conversation.reasoningEffort` | Deleted from the wire |
| `Conversation.reportedModel`, `Conversation.modelName` | One `TurnRecord.observedModel` |
| `ParsedSession.model` with the `'unknown'` sentinel (disk-adapter.ts:55, :268) | The crate returns `observedModel: string \| null` |

Also deleted: `normalizeModelId`, `isModelIdValidForProvider`, the codex composite-model id helpers
(`toCodexModelId`/`fromCodexModelId`, legacy/codex-composite-model.ts), per-provider `*ModelSchema`,
`EFFORT_LEVELS_BY_PROVIDER`, `defaultReasoningEffortForProvider`, `EFFORT_DISPLAY_NAMES`,
`CODEX_THINKING_DISPLAY_NAMES`, and config-mapping.ts.

### 1.5 ProviderCatalog: one source

```ts
type ProviderCatalog = { revision: string; providers: ProviderEntry[] };
type ProviderEntry = {
  id: Provider; displayName: string; shortName: string; defaultModelId: string;
  models: ModelDefinition[];
  capabilities: { fork: boolean; requiredMcp: boolean; httpMcp: boolean; dynamicModels: boolean };
};
type ModelDefinition = { id: string; displayName: string; contextWindow: number;
                         reasoning: { t: 'none' } | { t: 'levels'; levels: string[]; defaultEffort: string } };
```

| Owner / store | Replaces or deletes |
|---|---|
| `vendor/agent-cli-tool/catalog.jsonc` → build-time generator → `shared/src/generated/catalog.ts` exports **one validated `ProviderCatalog` value**. At runtime `catalog.ts` adds dynamic OpenCode models and bumps the revision. A missing or invalid catalog is a **startup error**. | `GEN_*` arrays + `CODEX_MODEL_REGISTRY`/`CURSOR_MODEL_REGISTRY` (index.ts:99-106); providers/catalog.ts (whose fallback return is at :31); catalog-service.ts's 7 candidate paths, including the absolute home paths at :41-42; `FALLBACK_*_MODELS` in 6 provider files; `FORK_CAPABLE_PROVIDERS`/`providerSupportsFork` (now `capabilities.fork`); `providerSupportsRequiredBuddyMcp`; context-window.ts (114; now `contextWindow` on each model); `PROVIDER_METADATA` css/labels (move to the client); `/api/models` (0 client callers) |

### 1.6 Errors and journal

```ts
type CommandError =                               // every command rejection; replaces ConfigError | GeneralCommandError
  | { t: 'config'; error: ConfigError }           // provider/model/reasoning unavailable, provider_locked
  | { t: 'revision_conflict'; current: ConversationConfigState }
  | { t: 'busy' } | { t: 'not_found' } | { t: 'tombstoned' }
  | { t: 'starting' } | { t: 'draining' }
  | { t: 'denied'; reason: string }               // TurnPolicy (Buddy authorize) refused
  | { t: 'invalid'; issues: string[] };

type ErrorOccurrence = { fingerprint: string; severity: 'error' | 'warn'; component: string; message: string;
                         stack: string; bootId: string; at: Date; refs: { conversationId: ConversationId | null; attemptId: string | null } };
```

| Owner / store | Replaces or deletes |
|---|---|
| `observability/errors.ts` keeps the **JSONL** journal (0600, 5 MiB rotation, redaction). It deliberately **does not** move into the crate: the recorder of failures must not depend on the component most likely to fail. The event-loop lag monitor (T04) writes here. | error-journal.ts 493 + structured-logger.ts 116 + error-diagnostics-routes.ts 150 become one module of ~320 lines. `ConfigErrorSchema` + `GeneralCommandErrorSchema{code:string}` become one `CommandError` union. |

---

## 2. Wire contract, redesigned (protocol v3)

### 2.1 List row: init carries only these

```ts
type ConversationRow = {
  id: ConversationId;
  kind: RowKind;              // chat | buddy{buddyId, visibility} | builder | worker{swarmId, workerId, role}
  parent: ConversationId | null;
  provider: Provider;
  folder: number;             // index into hello.folders (the cwd table); resolves the 17-copy home regex once
  label: string;              // provider title, else the first user text; ≤ 60 chars, derived ONCE by ingest
  activityAt: number;         // epoch ms: the client sorts on it with no date parsing (03 §6.2 #5-6)
  messageCount: number;       // also the stale-history signal (ws-contract-surprises "Summaries")
  run: 'idle' | 'queued' | 'running' | 'streaming';
  done: boolean;
};
```

**Size estimate** at 1,163 rows (995 buddy): id 45 B, kind ~40, parent 14, provider 18, folder 10,
label ~75, activityAt 27, messageCount 18, run 13, done 12, punctuation ~15. That is ≈ 287 B per row,
or **≈ 0.33 MB raw, ~55 KB deflated, versus 1.95 MB today**. The folder table (a few hundred distinct
cwds) adds ~15 KB. Getting reliably under 0.3 MB also needs one of the following, as an owner choice:
- a 40-character label, or
- leaving background Buddy run threads out of `hello`. Buddy views would then fetch them by route, and
  the `availableConversationIdSetAtom` rule would have to accept "known to a Buddy route".

### 2.2 Everything else loads on demand

| Data | Route | Source |
|---|---|---|
| Detail: config state (config + revision + resolution), origin, createdAt, cwd, session, queue, sub-agents, latest `TurnRecord` | `GET /api/conversations/:id` | registry + record + turn table |
| Messages, paged | `GET /api/conversations/:id/messages?before=<seq>&limit=200` | `ingest.messages()` + the live-turn overlay |
| Context meter | `GET /api/conversations/:id/context` | latest `TurnRecord.usage` + catalog `contextWindow` (no transcript read) |

### 2.3 WebSocket messages: 7 client → server (from 11), 10 server → client (from 23)

| Client → server | Payload | Replaces |
|---|---|---|
| `create` | commandId, conversationId, cwd, config, kind, origin, firstMessage | `create_conversation` (drops `swarmDebugPrefix`, `buddyContext`, optional `kind`) |
| `set_config` | commandId, id, expectedRevision, patch | `set_conversation_config` |
| `send` | commandId, id, text, `mode: 'queue' \| 'interrupt'` | `queue_message`, `interrupt_and_send`; **`send_message` deleted** (conversation-websocket.ts:284) |
| `queue_edit` | id, `op: {t:'cancel',itemId} \| {t:'promote',itemId} \| {t:'clear'}` | `cancel_queued_message`, `promote_queued_message`, `clear_queue` |
| `stop` | id | `stop_conversation` |
| `delete` | commandId, id | `delete_conversation` |
| `set_done` | id, done | `set_conversation_done` |

| Server → client | Payload | Replaces |
|---|---|---|
| `hello` | protocol {version: 3}, bootId, defaultCwd, folders[], rows[], loading | `init` (1.95 MB) |
| `rows` | rows[] (upsert) | `conversations_updated`, `conversation_created` to other sockets, startup batches |
| `removed` | ids[] | `conversation_deleted`, the `conversation_load_complete` prune |
| `ready` | — | `conversation_load_complete` |
| `patch` | id, `RowPatch` | `conversation_updated` (**full `toJSON()` with every message** on done/config/status: conversation-websocket.ts:267, :353, :386), `status`, `session_bound`, `queue_updated`, `subagent_*`, `message_complete` |
| `delta` | id, text | `chunk` (hot path) |
| `message` | id, `Message` | `message` |
| `ack` | commandId, `{t:'created', row} \| {t:'accepted'} \| {t:'rejected', error: CommandError, authoritative: ConversationRow \| null}` | `conversation_created`, `command_accepted`, `command_rejected` |
| `buddy` | `{t:'changed'} \| {t:'channel', listId} \| {t:'archived', buddyId}` (owned by the Buddy module) | `buddies_changed`, `channel_changed`, `buddy_archived` |
| `error` | message | `error` (uncorrelated only) |

`merge_child_status` is deleted with merge.

```ts
type RowPatch =                                      // each variant replaces exactly one field group
  | { t: 'run'; run: ConversationRow['run'] }
  | { t: 'done'; done: boolean }
  | { t: 'label'; label: string }
  | { t: 'activity'; activityAt: number; messageCount: number }
  | { t: 'config'; state: ConversationConfigState; commandId: string | null }   // detail-level
  | { t: 'queue'; queue: QueueItem[] }                                          // detail-level
  | { t: 'session'; sessionId: ProviderSessionId }                              // detail-level
  | { t: 'subagent'; subAgent: SubAgent }                                       // detail-level
  | { t: 'turn'; turn: TurnRecord };                                            // detail-level; replaces the diagnostics poll
```

A row-level patch updates the row atom. A detail-level patch is applied only if that detail is loaded,
and otherwise ignored. Marking a 5 MB conversation done then costs about 60 bytes instead of 5 MB per
socket.

### 2.4 HTTP routes (non-Buddy)

| Keep (19 core) | Delete |
|---|---|
| `GET /login`, `POST /login`, `GET /logout` | `GET /api/models` (0 callers) |
| `GET /api/catalog` (renamed from provider-catalog) | `GET /api/audit` (0 callers; startup logs it) |
| `GET /api/conversations/:id`, `…/:id/messages`, `…/:id/context` | `GET /api/conversations/:id/diagnostics` (now a `turn` patch) |
| `GET /api/search` (crate FTS5) | `POST /api/conversations/merge` |
| `GET /api/usage` (crate aggregate) | `GET /api/buddies/:id/memory-reviews` inlined in server.ts (moves to Buddy routes) |
| `GET /api/diagnostics/errors`, `POST …/client`, `POST …/:fp/acknowledge` | palettes ×3, **if the owner picks presets** |
| `GET /api/paths`, `GET /api/validate-path`, `POST /api/mkdir`, `GET /api/files`, `GET /api/serve/*` | |
| `GET/POST /api/settings`, `POST /api/upload` | |
| Swarm (quarantined, all async): `swarm-runs`, `swarm-runtime`, `swarm-projects`, `swarm-reviews`, `swarm-signal`, `oompa-config`, `oompa-swarm-context`, `git-log`, `swarm-new-files`, `read-file` | |

### 2.5 How the schema is defined once: recommend Zod in `shared`, with a type-equality check at the napi edge

| Option | For | Against |
|---|---|---|
| **A. Zod in `shared/src/wire.ts` (recommended)** | The WS server and the client are both TS and stay TS. Commands, patches and acks are authored by TS code the crate never sees. Zod gives the client its boundary validation (T3/κ in the style guide). No new build step. | The crate's row types (sessions, messages, usage) are a second definition |
| B. Rust structs → `ts-rs`/`typeshare` → generated TS + JSON Schema → Zod | One source when Rust owns the payload | The crate would have to own UI-only types (RowPatch, CommandError, ack) that no Rust code produces. It adds a JSON-Schema→Zod step, and the client still needs runtime validation. |

The recommendation is **A plus one guard**. napi-rs already generates `.d.ts` for the crate's return
types (`IngestMessage`, `SessionRow`, `UsageRow`). `ingest.ts` maps them in one place, and a
compile-time assertion keeps them from drifting:
`type _ = AssertEqual<z.input<typeof MessageSchema>, NapiMessage>`.
Revisit B only if the WS server itself moves to Rust (DESIGN D4).

Two wire rules survive:
- **Version skew.** The client reads `hello.protocol.version` first. On a mismatch it shows
  "backend reloading" and reconnects; it does not reject every message. This replaces the
  `.default(false)` workaround with a typed state.
- **Additive fields within v3 still get `.default()`** (the CLAUDE.md rule).

---

## 3. Module map and line budget

### 3.1 Target modules (server core)

| Target module | Budget | Job |
|---:|---:|---|
| `main.ts` | 250 | composition root: auth → compression → json → mutation admission → routes → WS gate |
| `paths.ts` | 30 | data dir, uploads dir, listen host (127.0.0.1 default), startup harness audit log |
| `auth/{gate,policy,express,login-page}.ts` | 450 | unchanged semantics; login HTML trimmed |
| `transport/ws.ts` | 180 | `noServer` + gated `upgrade`, liveness ping, broadcast (serialize once per message) |
| `transport/commands.ts` | 300 | thin dispatcher `ClientCommand → handler`, one handler per variant; acks after admission |
| `conversations/registry.ts` | 200 | `Map<ConversationId, Conversation>`, row projection, patch emitter |
| `conversations/conversation.ts` | 250 | record + `TurnQueue` + current `TurnRunner`; nothing else |
| `conversations/hydrate.ts` | 150 | boot: `ingest.listRows()` ⋈ records → registry; `ingest.onChange` → `rows`/`patch` |
| `turns/queue.ts` | 200 | pure queue state machine (interrupt keeps the queue; `retireInFlightHead`) |
| `turns/runner.ts` | 450 | resolve → build request → spawn via agent-cli → fold `UnifiedAgentEvent` → patches |
| `turns/policy.ts` | 60 | `TurnPolicy` interface + the no-op chat policy; `BuddyTurnPolicy` lives in `buddies/` |
| `turns/watchdog.ts` | 120 | bridge / provider-idle / max-runtime timers; `max_runtime_timeout` cause |
| `turns/record.ts` | 150 | `TurnRecord` writes; the latest record is also sent as a `turn` patch |
| `turns/overlay.ts` | 60 | the in-flight turn's messages until ingest catches up (the session-history dedupe rule) |
| `config/service.ts` | 300 | create / patch (CAS) / fork against the catalog; fingerprint for idempotent replay |
| `config/records.ts` | 80 | typed wrapper over the crate's `conversation` table |
| `catalog.ts` | 100 | the generated catalog + dynamic OpenCode models; errors on a missing catalog |
| `ingest.ts` | 120 | napi binding wrapper; maps crate rows to shared types; panics become `IngestError` |
| `lifecycle/shutdown.ts` | 220 | the admission and reload authority (semantics unchanged) |
| `lifecycle/boot.ts` | 130 | port guard, async system ports, static client, startup barrier |
| `observability/errors.ts` | 320 | journal + console capture + lag monitor + 3 routes |
| `http/conversations.ts` | 150 | detail, messages, context, catalog |
| `http/files.ts` | 220 | paths, validate, mkdir, files, serve (known-project authorizer) |
| `http/uploads.ts` | 70 | multer + retention GC |
| `http/search.ts` | 40 | `ingest.search` |
| `http/usage.ts` | 40 | `ingest.usage` |
| `http/settings.ts` | 60 | settings.json, ignore patterns handed to ingest |
| `constants.ts` | 40 | timeouts (back-compat aliases removed) |
| `swarm/{observer,routes}.ts` | 700 | quarantined; async fs; one observer per folder |
| `palettes/` | 0 / 250 | **owner decision**: presets (client-only) or keep the generator |
| **Server core total** | **5,440** | (5,690 if palettes are kept) |

### 3.2 Target modules (shared)

| Target module | Budget | Job |
|---|---:|---|
| `wire.ts` | 350 | ClientCommand, ServerMessage, ConversationRow, RowPatch, ack, protocol |
| `domain.ts` | 220 | ids, Kind, Origin, Message, TurnState/Record, SubAgent, QueueItem, CommandError |
| `config.ts` | 200 | ConversationConfig, patch, resolve (from conversation-config.ts, without record/Buddy schemas) |
| `catalog.ts` + `generated/catalog.ts` | 100 + 120 | catalog schema and helpers; one generated value |
| `tool-summary.ts` | 150 | **one** tool-call summarizer, used by the client for live and historical tool rows (replaces the server's tool-format.ts plus a Rust copy) |
| `swarm.ts` (+ generated oompa types) | 200 | quarantined |
| `buddy-wire.ts` | 300 | Buddy route/wire schemas that remain after DESIGN B (counted here for honesty; owned by the Buddies scope) |
| **Shared total** | **1,640** | |

**Grand total: 7,080 TS lines (7,330 with palettes), versus 25,788 today: 3.6×.**

### 3.3 Every current file and what happens to it

Fate: **K→n** keep and shrink to n · **M→X** merge into X · **R** move to the Rust crate `unleashd-ingest` ·
**B** move to the Buddies scope (DESIGN B.4 budget) · **V** move into vendor agent-cli · **D** delete.

| File | Lines | Fate | Notes |
|---|---:|---|---|
| **adapters/** | **4,708** | | |
| codex-turn-lifecycle.ts | 230 | R | codex parser state |
| disk-adapter.ts | 320 | R | `ParsedSession`→row mapping; the `'unknown'` sentinel dies |
| jsonl-lines.ts | 63 | R | |
| jsonl.ts | 2,339 | R | six parsers + envelope stripping (**including merge envelopes in old transcripts**) |
| loader.ts | 735 | R | FSEvents watcher replaces rediscover + serial stat every 5 s; the provider `if/else` (:651-689) dies |
| muse-adapter.ts | 54 | R | |
| registry.ts | 325 | R | |
| session-cache.ts | 146 | D | the store replaces 491 MB / 7,655 files |
| tool-format.ts | 397 | M→shared/tool-summary.ts | oompa-launch detection goes to swarm |
| transcript-tails.ts | 99 | R | tail resume for **all** formats, including Codex |
| **application/context.ts** | 185 | M→registry.ts, ws.ts | |
| app-data.ts / network.ts / config.ts | 17/10/41 | M→paths.ts, settings.ts | the ignore matcher moves into the crate's discovery filter |
| audit.ts | 40 | M→paths.ts | log only; the route is deleted |
| **auth/** (4 files) | 661 | K→450 | security-sensitive; keep tests |
| constants/timeouts.ts | 54 | K→40 | drop `DEFAULT_TURN_IDLE_TIMEOUT_MS`/`TURN_IDLE_TIMEOUT_MS` aliases |
| **conversations/** | **6,426** | | |
| await-turn.ts | 30 | B | |
| buddy-creation-service.ts | 368 | B | becomes the Buddy runner's `prepare` |
| config-mapping.ts | 45 | D | legacy provider-preference mapping |
| config-service.ts | 521 | K→300 (config/service.ts) | |
| config-store.ts | 991 | M→crate table + records.ts (80) | CAS, tombstones, session index become SQL |
| context-window.ts | 114 | D | `contextWindow` in the catalog |
| creation-service.ts | 145 | M→config/service.ts | fingerprint |
| legacy-config-migration.ts | 117 | D | run once inside the record import (S18) |
| legacy-ui-state.ts | 102 | D | + delete `ui-state.retired.json` |
| runtime-config.ts | 50 | M→config/service.ts | |
| runtime.ts | 3,510 | split | ≈ conversation 250 + queue 200 + runner 450 + watchdog 120 + record hooks. **~900 Buddy lines → B**, ~200 swarm → swarm/observer, ~100 merge → D, ~150 ProviderEvent translation → D, ~1.2k incident comments → docs |
| serialization.ts | 28 | M→registry.ts | row projection instead of `...conversation` (:16) |
| session-context.ts | 405 | R + D | usage comes from `TurnRecord`; no sync `readFileSync` of the transcript |
| **http/** | **1,942** | | |
| conversation-routes.ts | 431 | K→150 (http/conversations.ts) | the chars/4 section breakdown is an owner decision (§3.5) |
| core-routes.ts | 27 | M→http/conversations.ts | catalog only |
| error-diagnostics-routes.ts | 150 | M→observability/errors.ts | |
| filesystem-routes.ts + path-utils.ts + known-projects.ts | 197+100+20 | K→220 (http/files.ts) | keep the non-`process.cwd()` default workspace |
| persisted-state.ts | 71 | K→60 | never put the token here (served verbatim) |
| search-routes.ts | 87 | K→40 | FTS instead of scanning heap messages |
| turn-diagnostics-routes.ts | 36 | D | `turn` patch |
| upload-routes.ts | 52 | K→70 | + retention GC (701 MB today) |
| usage-routes.ts | 771 | R + K→40 | third parser deleted; 22 sync fs calls gone |
| **lifecycle/** | **1,596** | | |
| file-poller.ts | 137 | R/D | watcher |
| port-guard.ts, startup.ts, static-client.ts, system-ports.ts | 31+77+40+40 | M→boot.ts (130) | `execSync` → async |
| progressive-loader.ts | 60 | D | the crate returns rows sorted by activity |
| session-history.ts | 156 | K→60 (turns/overlay.ts) | the dedupe bound moves with it |
| session-loader.ts | 746 | K→150 (hydrate.ts) | gemini/`ses_` id heuristics (:567-572) move into the crate |
| shutdown.ts | 309 | K→220 | |
| merge/routes.ts | 274 | D | T02 |
| **observability/** | **1,689** | | |
| error-journal.ts + structured-logger.ts | 493+116 | K→320 incl. routes and lag monitor | |
| index.ts | 5 | D | |
| runtime-observer.ts | 64 | D | the runner writes `TurnRecord` directly |
| turn-attempt-journal.ts | 835 | K→150 (turns/record.ts) | |
| types.ts | 176 | M→shared/domain.ts | |
| **palettes/** (2 files) | 393 | owner: D (presets) / K→250 | |
| **providers/** (9 files) | 471 | M→catalog.ts (100) | the 6 per-provider files and fallbacks deleted |
| server.ts | 813 | K→250 (main.ts) | the inline Buddy route (:640) → B |
| subagent-tools.ts | 194 | V + R | codex collab + gemini labels go to the parsers |
| **swarm/** (5 files) | 1,112 | K→700 (quarantined) | async; `commands.ts` execFile keeps a timeout |
| **transport/** | 646 | | |
| conversation-websocket.ts | 544 | K→300 (commands.ts) | keep `replayFailureMessage` (:538) semantics |
| websocket.ts | 102 | M→ws.ts | `statSync` (:22) → async |
| **shared/src** | **4,516** | | |
| index.ts | 1,292 | M→wire.ts / domain.ts | ~70 dead exports, re-exported jsonl types, merge prompt, `is*Message` "backwards compatibility" helpers → D |
| conversation-config.ts | 379 | K→200 (config.ts) | BuddyContext, creation metadata and the persisted-record schema leave |
| conversation-kind.ts | 270 | M→domain.ts (~40) | legacy derivation → D |
| provider-catalog.ts | 150 | K→100 | superRefine checks move to the generator |
| generated/catalog.ts | 74 | K→120 | a full `ProviderCatalog` value |
| generated/oompa-types.ts | 109 | M→swarm.ts | |
| adapters/jsonl.types.ts + codex-session.types.ts | 329+326 | R | serde types in the crate |
| legacy/codex-composite-model.ts | 37 | D | |
| utils/jsonc.ts | 9 | D | only the generator needs it |
| buddy*.ts (14 files) | 1,541 | B → buddy-wire.ts (~300) + napi `.d.ts` | |

### 3.4 Totals

| Bucket | Today | Target TS | Where the rest goes |
|---|---:|---:|---|
| server/src core (non-Buddy) | 21,272 | 5,440 | ~4,900 → Rust ingest (≈3.3k Rust after the port), ~1,300 → Buddies B.4, ~1,350 deleted outright (merge, legacy, dead, palettes-as-presets), ~8,300 removed by shrinking (split/dedupe/comments) |
| shared/src | 4,516 | 1,640 | 655 → Rust, 1,541 → Buddies (300 kept), rest shrink/delete |
| **Total** | **25,788** | **7,080** (3.6×) | + ~3.3k Rust in `unleashd-ingest` |
| After the later swarm delete | | ~6,180 (4.2×) | |

The Buddy-owned runtime pieces (admission, briefing injection, grant/MCP attachment, audience
`policyKey`, ~1.3k lines today) must be counted inside DESIGN B.4's ~1.9k (`runner.ts` + `grants.ts` +
`briefing.ts`). Check this when T11 is planned, so these lines do not fall between the two scopes.

### 3.5 Features that must survive, and removal candidates

| Must keep (product works) | Carried by |
|---|---|
| Chat with claude/codex/cursor/muse/gemini/opencode | agent-cli + `turns/runner.ts` + catalog |
| Resume after restart, Chat Fork (with the fork-capable session upgrade) | `SessionState`, `Origin.fork`, `capabilities.fork` |
| Config picker (provider/model/effort, CAS, unavailable-with-lastResolved) | `config/service.ts`, `set_config`, `config` patch |
| Queue: queue / interrupt / promote / cancel / clear | `turns/queue.ts` |
| Sidebar + Gallery (list rows, folders, done, workers) | `hello`/`rows`/`patch` |
| Transcript view, streaming, sub-agents, tool rows | `delta`/`message`/`patch`, messages route |
| Usage panel, context meter | crate `usage()`, `TurnRecord.usage` |
| Deep search | crate FTS5 |
| Error journal + `pnpm errors:list` | `observability/errors.ts` |
| Auth (shared secret, login page, WS gate) | `auth/` |
| Uploads, folder picker, file serving | `http/uploads.ts`, `http/files.ts` |
| Dev supervisor hot reload + drain | `lifecycle/shutdown.ts` (+ `tools/`, out of scope) |

| Removal candidate (**owner decision**) | Saves | Evidence |
|---|---:|---|
| Palette generator → a few presets | 393 server (+~960 client) | 03 §7 #14 |
| Turn-attempt journal detail → one `TurnRecord` per attempt | ~685 | the UI reads only `limit=1` (client/src/hooks/useTurnDiagnostics.ts) |
| Context-breakdown estimate (chars/4 split of briefing / memory / MCP) → provider-counted meter only | ~250 | conversation-routes.ts:122-366 |
| **Discovery** of external gemini/opencode/cursor history (chat with them stays) | ~500 Rust + 4.7k files watched | init has 0 gemini, 2 opencode, 13 cursor rows, yet 1,799 / 1,466 / 1,471 files are walked |
| Disk-extracted sub-agents (live sub-agents stay) | ~150 | 0 conversations carry sub-agents today |
| `swarmDebugPrefix` | ~40 | 0 workers today |
| Swarm entirely (already decided: later) | ~900 server+shared | C.5 |
| Background Buddy threads left out of `hello` (§2.1) | ~100 KB of init | 995 of 1,163 rows are Buddy |

---

## 4. Ordered migration steps

Each step is one commit series on its own branch off `lean/integration`. Each is verified at the commit
(clean `git status` or `git grep … HEAD`), with `pnpm typecheck`, `pnpm test:client` and
`bash tools/check-client-invariants.sh`.

| # | Wave / task | Step | Verify (at the commit) |
|---|---|---|---|
| S1 | T08 | Fold `UnifiedAgentEvent` directly. Delete `ProviderEvent` (providers/index.ts:20) and the runtime translation. Define `TurnOutcome`. | conversation-runtime tests; one live claude and one codex turn stream and complete |
| S2 | T08 | Replace the provider ternary (runtime.ts:1199-1219) with one request builder keyed by the catalog's capabilities | build-command contract tests in agent-cli; muse/claude/codex efforts reach argv |
| S3 | T08 (vendor first) | Codex collab → codex parser emits `subagent.state`. Commit + push inside the submodule, then bump the pointer. Delete subagent-tools' codex part. | codex collab fixture replays the same sub-agents |
| S4 | T08 | Extract `TurnQueue` (pure) | the "interrupt keeps the pending queue" and "promote moves a pending message first" tests |
| S5 | T08 | Extract `TurnWatchdog`; foreground deadlines take `TURN_MAX_RUNTIME_MS` explicitly | Buddy timeout regression tests (incident 2026-09-10) |
| S6 | T08 → T10 | Extract `SwarmObserver`: one per folder, async; delete the 2 s per-conversation timer (runtime.ts:3099) | lag monitor shows no swarm stalls; the swarm UI still updates |
| S7 | T08 | Extract `TurnPolicy`; move ~900 Buddy lines + buddy-creation-service + await-turn to `buddies/` as `BuddyTurnPolicy` (T11 later rewrites them) | buddy-coordination + buddy-conversation-contract tests |
| S8 | T08 | `TurnRunner` = what remains; `Conversation` = record + queue + runner. Delete `ConversationRuntimeView` and the duplicate interface. | runtime.ts deleted; all server tests |
| S9 | T09 | **One-time record migration** on a copy of `~/.agent-viewer`: `creation.buddyContext/purpose/placement` + worker markers → `kind`; `parentConversationId/resumedFrom/branch` → `origin`; creation fields → `provenance`. Then delete the legacy kind code, `BuddyContextSchema`, `purpose` and `placement`. | per-kind counts equal before and after; the sidebar Buddies group count equals the Buddies page (architecture.md §2.1) |
| S10 | T09 | Model in one place: drop `model`/`reasoningEffort`/`modelName`/`reportedModel`; add `TurnRecord.observedModel`. Generate the full catalog; delete fallbacks, absolute paths, context-window.ts and `/api/models`. | picker e2e; start with a missing catalog → startup error |
| S11 | T09 | Protocol v3 `hello` + `rows` + `removed` + `ready` with `ConversationRow`. Client and server change in the **same commit**; the version check replaces skew defaults. | measure hello size on real data (≤0.35 MB); the stale-history refresh test adapted |
| S12 | T09 | `patch` replaces `conversation_updated`/`status`/`session_bound`/`queue_updated`/`subagent_*`/`message_complete`; `ack` replaces the three ack types; delete `send_message` | message-command-ack, summary-history-refresh and create-replay tests; done toggle on a large thread sends < 1 KB |
| S13 | T09 | Detail + paged messages routes; the client hydrates on open; the registry drops full `messages[]` for idle conversations | RSS before/after; opening a 5 MB thread |
| S14 | T14 | Deletions: legacy-config-migration, legacy-ui-state (+ the retired file), codex-composite-model, `/api/audit`, dead exports (`.work/dead.tsv`), turn diagnostics route (→ `turn` patch), incident comments → docs (a one-line pointer stays at each site) | `git grep` for each deleted symbol at HEAD = 0 |
| S15 | T12 | `unleashd-ingest`: watcher, six parsers, tail resume (Codex included), `listRows/messages/search/usage/onChange`. **Port the server/test parser fixtures as Rust golden tests.** | compare harness: every source on the real data, TS `ParsedSession` vs crate: message counts, content hashes, label, cwd, envelope stripping. Zero unexplained diffs. |
| S16 | T13 | Switch `hydrate.ts` to the crate, then delete jsonl.ts, loader, session-cache (+ its 491 MB directory), poller, tails, shared adapter types | the startup barrier (14–20 s today) measured; the hydration test adapted |
| S17 | T13 | usage/search/context read from the crate; delete usage-routes' parser and session-context.ts | `/api/usage` totals equal the old route on a frozen copy (±0) |
| S18 | T13b | Import the 7,982 config records into `conversation` (CAS = `UPDATE … WHERE config_revision=?`); verification report per record; delete config-store.ts | record counts, per-record hashes of config/kind/session; tombstones preserved |
| S19 | T10 | Swarm quarantine completion: worker marker parse in the crate, routes async, one derived client atom | swarm dashboard on a repo with `.oompa/runs` |

S1–S8 need T02 (merge deleted) and T04 (lag monitor) first. S15 can start in parallel with S1.
S16–S18 need S11–S13, because the crate's row shape is the wire row.

---

## 5. Risks and invariants that must survive

### 5.1 Incident-driven invariants (each has a test today; port the test with the code)

| Invariant | Source | Lands in |
|---|---|---|
| Auth gate is **first** in the Express chain; compression is mounted after it | server.ts:426/433, docs/auth.md | main.ts |
| WS `noServer: true` + explicit gated `upgrade`; never `new WebSocketServer({server})`. The Vite HMR socket keeps its own `prependListener('upgrade')` gate. | server.ts:138-157, client/vite.config.ts | transport/ws.ts |
| Buddy tool callbacks use a separate loopback listener, never an exception in the public gate | docs/auth.md | buddies/grants.ts (B.5) |
| Default listen host is 127.0.0.1; the token comes from env → file → data dir, is ≥16 chars, and is never in settings.json | network.ts, docs/auth.md | paths.ts, auth/ |
| New server→client fields get `.default()` within a protocol version; a version mismatch is a typed reconnect state | CLAUDE.md, e54fe26 | wire.ts, client spine |
| Foreground Buddy deadlines receive `TURN_MAX_RUNTIME_MS` explicitly; automatic expiry is `max_runtime_timeout`, never `stop()`/`user_stop` | timeouts.ts:44, runtime.ts:462-481/1110 | turns/watchdog.ts, `TurnOutcome.timed_out` |
| The ack is sent **after** admission; composers clear optimistically; never move the ack earlier | ws-contract-surprises.md | transport/commands.ts |
| Interrupt keeps the queue; `retireInFlightHead` retires the killed head; promote interrupts | runtime.ts:3215 | turns/queue.ts |
| A create replay may send `created` and then `rejected` for the same commandId; the message is chosen by error type | conversation-websocket.ts:538 | `ack` sum + commands.ts |
| Conversation ids are opaque strings (`buddy-run-*`), not UUIDs | ws-contract-surprises.md | `ConversationId` brand |
| Durable identity beats transcript markers; a `discovered` record never materialises without a transcript; a recovered conversation keeps `record.createdAt` | architecture.md §2.0/§2.1 | `Provenance`, hydrate.ts |
| No pruning after a failed discovery for a provider; no per-file boot work beyond the newest 500 | architecture.md §2 | crate store |
| Tail resume only when the file provably grew (same inode, no shrink, identical bytes before the offset) | transcript-tails.ts | crate |
| Codex: AGENTS.md / environment / plugin bundles filtered by provenance tags; tool calls deduped by call id with `input` kept; Buddy/Builder/swarm/**merge** envelopes never become user messages | architecture.md §2 | crate parsers (merge stripping stays even though merge is deleted) |
| The Fork session upgrade is gated on the capability (`providerSupportsFork`) and never rejects the send | architecture.md §3 | `capabilities.fork` |
| Shutdown: `reloading` is absorbing, no reload while work is active, the flush watchdog is armed after `clearTimers()`, the startup barrier resolves on every outcome, and IPC loss counts as SIGTERM | architecture.md §3 | lifecycle/shutdown.ts (unchanged) |
| A streaming route must call `res.flush()`; hashed assets are immutable and everything else `no-cache` | CLAUDE.md | main.ts, boot.ts |
| Lossy directory names are decoded against the filesystem (`resolveEncodedProjectDirectory`), returning null rather than guessing | CLAUDE.md | crate |
| The default workspace is not `process.cwd()` | http/path-utils.ts | http/files.ts |
| The error journal is 0600, redacted, rotated; expected control flow is not journaled | docs/error-journal.md | observability/errors.ts |

### 5.2 Risks

| Risk | Mitigation |
|---|---|
| **Live-turn overlay vs ingest.** During a running turn the server is authoritative and the file lags; showing both duplicates messages, and dropping the overlay too early loses them. | `turns/overlay.ts` keeps the host-sent and streamed messages until `ingest.messages` reports a user message matching the host send within `MAX_SEND_EVENT_OFFSET_MS` (the session-history.ts rule). Port its tests first. |
| The napi addon crashes the server | `catch_unwind` at every napi fn → `IngestError`; ingest failure degrades to a typed "history unavailable" row state and a journal entry, while live chat keeps working. `unsafe` is forbidden in the crate. |
| Record import (S18) loses data | `VACUUM INTO`-style approach: new file, the old directory stays read-only until a verification report per record is clean; owner gate like T15 |
| Parser port drift across six quirky formats | S15 compare harness on all ~14.9k real sources + the existing fixtures as golden tests. The switch happens only at zero unexplained diff. |
| Protocol v3 is a big-bang client change | Client and server ship in one commit; the version handshake makes skew a visible reconnect, not an empty list |
| Buddy runtime lines fall between scopes (S7 moves them out; T11 must absorb them) | Put `BuddyTurnPolicy` explicitly in the T11 budget (§3.4) |
| Budgets assume incident comments move to docs. The user rule wants a comment at every non-obvious fix site. | Keep a one-line `// see docs/…#anchor` tripwire at each site. That is budgeted (~5% of each module). |
| The init target (≤0.3 MB) needs a label cap or leaving background rows out | Owner choice (§2.1); 0.33 MB without either |
| The dev loop gets `cargo build` | Wired into tools/watch-server.mjs (DESIGN D.1); Rust changes need a backend restart, same as TS today |
