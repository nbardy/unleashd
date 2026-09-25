# 06 — Target client (lean rewrite scope, read-only)

Scope: `client/src` (TS/TSX and CSS). No repository file was edited.
**Baseline:** `lean/integration` @ `8c9fcfa` (cbb8820 plus the merge deletion, which already removed 786 client lines).
Measured on that tree: **36,260 TS/TSX + 18,489 CSS = 54,749 lines** in 226 files. The full per-file table is `.work/06-client-files.tsv`. The audit scripts are `.work/06-css-audit.mjs` and `.work/06-group.mjs`.
**Target:** **~17.8k lines (3.1×)** with the quarantined swarm UI kept, and **~15.5k (3.5×)** after swarm is dropped. Levers that go further, all owner decisions, are listed in §5.3.

This builds on the work already planned elsewhere:
- **T05 (client speed, running):**
  - one-pass sidebar/list index atom
  - tail-only message regroup while streaming
  - `React.lazy` route splitting
  - dedupe of the time-ago tick (8 copies) and the home-path regex (17 copies)

  This plan **consumes** these and does not redo them. Steps that touch the same files are ordered after T05 (§6).
- **T09 (Conversation sum type and field patches):** defines the wire. §1 states what the client needs from it.
- **T10 (swarm quarantine):** covers the `Worker` variant and the one derived grouping atom.
- **T11 (Buddy server rewrite):** provides the ~35 routes the Buddy UI moves onto.

---

## 0. Where the 54.7k lines are (by what they do)

| Group | TS | CSS | Total | Note |
|---|---:|---:|---:|---|
| Buddy pages (directory, buddy page, 8 tabs, mobile copies, atoms, useBuddyData) | 6,945 | 3,652 | 10,597 | BuddiesDashboard.css alone is 1,618 |
| Buddy channels (ChannelBrowser, ChannelsMobile, channel-data, composer, text, markdown) | 4,312 | 2,508 | 6,820 | the most-used Buddy surface |
| Buddy UI that dies with the decisions (team config, inactive access, coordination, review markers) | 1,824 | 449 | 2,273 | 02 §5 |
| Buddy sigil (procedural avatars + dev gallery) | 911 | 0 | 911 | owner decision O3 |
| Lists, search, new conversation (Sidebar, Gallery, FolderFilter, PathAutocomplete, Search×2, mobile list/sheet) | 4,274 | 2,403 | 6,677 | |
| Chat shell and panels (Chat, ConversationView, turn diagnostics, restart recovery, subagents, meter, queue) | 3,812 | 2,369 | 6,181 | |
| Swarm (quarantined) | 3,816 | 2,735 | 6,551 | 1,029 TS + 404 CSS of it are mobile copies |
| Shells + shared primitives (App, index.css, mobile.css, mobile-ui.css, MobileUI) | 725 | 2,539 | 3,264 | mobile-ui.css is 1,392 |
| State core (atoms, WS, polled fetch, route state) | 2,612 | 0 | 2,612 | |
| Transcript rendering (VirtualizedMessageList, MessageRow, markdown, segments, FilePreview) | 2,328 | 234 | 2,562 | |
| Palette / settings / usage (ColorPalettePicker, zustand store, UsagePanel) | 1,407 | 970 | 2,377 | owner decision O2 |
| Composer (hooks, ComposerMobile, Fullscreen, attachments, PromptPalette×2) | 1,871 | 268 | 2,139 | |
| Config picker (desktop picker + ModelSheetMobile) | 573 | 247 | 820 | |
| Misc infra (auth, error reporter, clipboard, ids, time) | 648 | 0 | 648 | |
| `/robot` demo | 202 | 115 | 317 | unlinked route |
| **Total** | **36,260** | **18,489** | **54,749** | |

**Buddy UI in total:** 13,992 TS + 6,609 CSS = **20,601**, which matches 02 §5.
**The mobile tree:** `client/src/mobile/*` is **6,899 TS + 4,172 CSS**. About 5.1k of that TS re-renders surfaces the desktop already has (§2).

---

## 1. Client data model

### 1.1 What the client needs from the wire (the T09 contract, client side)

| Server → client | Payload | Client handler (one per type) |
|---|---|---|
| `init` | `rows: ConversationRow[]` (slim, ~250 B each), `defaultCwd`, `loadComplete` | replace `rowsAtom` |
| `conversation_upserted` | one full `ConversationRow` | set one entry |
| `conversation_patched` | `{id, fields: Partial<RowFields>}` with **list fields only** (title, status, done, updatedAt, messageCount, model) | shallow-merge one entry |
| `conversation_removed` | `{id}` | delete the entry and remove the per-id atoms from their families |
| `message` / `chunk` / `message_complete` | as today | transcript append / stream buffer |
| `detail_patched` | `{id, fields: Partial<Detail>}` (config+revision, queue, subAgents, usage) | patch the detail, only while it is loaded |
| `command_accepted` / `command_rejected` | `{commandId, …}` | settle the command |
| `buddies_changed` / `channel_changed` / `buddy_archived` | as today | invalidate resource keys |

Bodies are fetched on demand: `GET /api/conversations/:id/messages?after=<seq>` returns `{messages, throughSeq, detail}`.

**Deleted from the wire, as the client sees it:** `configResolution`, `reportedModel`/`modelName`, `purpose`, `placement`, `buddyContext`, the swarm/worker nullable fields on non-worker rows, `messages[]` on list rows, the whole-conversation re-send when `done` changes, and `conversations_updated` batches (replaced by patches).

### 1.2 Canonical client types (sum types; no accidental optionality)

```ts
type ConversationRow =                                   // from @unleashd/shared (T09)
  | { kind: 'chat';   ...RowFields; parentId: Id | null; resumedFromId: Id | null }
  | { kind: 'buddy';  ...RowFields; buddyId: Id; workspaceId: Id; role: 'owner_chat' | 'run' | 'builder' }
  | { kind: 'worker'; ...RowFields; swarmId: Id; workerId: string; workerRole: string };
type RowStatus  = { tag: 'idle' } | { tag: 'running'; streaming: boolean } | { tag: 'failed'; cause: TurnFailureCause };
type Transcript = { tag: 'absent' } | { tag: 'loading' } | { tag: 'loaded'; messages: Message[]; throughSeq: number; detail: Detail }
                | { tag: 'failed'; error: string };
type Command    = { tag: 'create'; commandId; conversationId; args: CreateArgs; state: CommandState }
                | { tag: 'set_config'; commandId; conversationId; baseRevision; patch; state: CommandState }
                | { tag: 'send'; commandId; conversationId; content; mode: 'queue' | 'interrupt'; state: CommandState };
type CommandState = { tag: 'sent' } | { tag: 'rejected'; code: RejectCode; message: string };
type Connection = { tag: 'connecting' } | { tag: 'open'; send: (m: ClientMessage) => void } | { tag: 'closed' };
```

Every "what kind is this row?" question becomes one `switch (row.kind)` in a thin dispatcher: row renderer, pane header, sidebar section. Today the same question is asked through `getConversationKind`, `getBuddyContext`, `isBuddyKind`, `isBuddyBuilderConversation`, `.isWorker`, `.placement !== 'background'` and a path regex (`isNestedWorktreeDirectory`), spread over atoms and components.

### 1.3 Atoms: base (8) and derived (6)

| Atom | Kind | Replaces (lines today) | Notes |
|---|---|---|---|
| `connectionAtom: Connection` | base | `wsStatusAtom` + `sendFnAtom` (a no-op default `send`, which is a silent fallback) | a send while closed is a typed error, not a dropped message |
| `rowsAtom: Map<Id, ConversationRow>` | base | `conversationsAtom` | a patch does `new Map(prev).set(id, {...row, ...fields})`. That is a pointer copy with no Immer and no freeze walk. Cost was never the copy, it was the ~10 derived passes, which T05 removes. |
| `transcriptFamily(id): Transcript` | base | `conversation.messages` on rows, `conversationDetailsLoadedAtom`, `detail-loader.ts`, `staleDetailIds`, `refreshIfStale` | the stale-epoch guard becomes "a response for seq < throughSeq is dropped" |
| `streamFamily(id): string` | base | `streamingContentAtom` (a Map copied per frame) + `streamingAtomFamily` | the rAF flush writes one per-id atom, so a frame no longer copies a Map |
| `commandsAtom: Map<CommandId, Command>` | base | `pendingCreationsAtom`, `pendingConfigCommandsAtom`, the module-level `pendingMessageCommands` Map in actions.ts | one reconnect handler resends the `sent` commands |
| `prefsAtom`, `seenAtom` | base (localStorage) | `atoms/ui.ts` | drop `sidebarViewMode` (never read) and `activeConversationId` (the route owns it) |
| `resourceCacheAtom` | base | unchanged (`atoms/resources.ts`) | keep. The keyed-cache design is the one piece of client state that is already lean. |
| `outboxAtom` | base | `channel-outbox.ts` | unchanged |
| `rowFamily(id)` | derived | `conversationAtomFamily` (which filters archived buddies on every read) | the server stops sending an archived Buddy's rows, so the filter is deleted |
| `listIndexAtom` | derived, **one pass** | T05's index: `allConversationsAtom`, `allConversationIdsAtom`, `availableConversationIdSetAtom`, `recentDirectoriesAtom`, `chatConversationInboxAtom`, `workersByProjectAtom`, `childConversationsAtomFamily` (O(n) per family member), `buddy-sidebar.ts` ×3, `buddy-conversation-list`, `buddy-background`, `buddy-work`, `sidebarRunningCountByFolder`, `mobileSearchResultsAtom` input | fields: `{order, idSet, byFolder, inbox, childrenOf, buddyThreads, workersByProject, recentDirs, runningByFolder}`. Each field keeps its identity when its content is unchanged. |
| `groupsFamily(id)` | derived | `chatMessageGroupsAtomFamily` | T05's tail regroup; reads `transcriptFamily` + `streamFamily` |
| `commandFor(conversationId)` | derived | `pendingCreationAtomFamily`, `pendingConfigCommandAtomFamily` (an O(n) find) | index by conversationId inside `commandsAtom` |
| `unreadFamily(id)` | derived | the NEW-badge reads spread across rows | `row.messageCount > seen[id]`. The bulk `markConversationsSeenBulk` is deleted; it was the bug that hid NEW on external updates (03 §6.2 #9). |
| `ownerUnreadAtom` | derived | `useOwnerUnreadTitle` + channel unread fetch | stays a resource key |

### 1.4 Deleted state and its code

| Item | Where | Lines | Why it can go |
|---|---|---:|---|
| Legacy pending-creation migration (`migrateLegacyPendingConversation`, the V1 array format, `LEGACY_RETRYABLE_CREATION_ERRORS`, V2 store parse) | pending-creations.ts:57-160 | ~130 | Principle 7: one-time migration done. The retry decision reads `code` only. |
| Pending creations persisted to localStorage across page reload | pending-creations.ts (rest), `PENDING_CONVERSATIONS_KEY` | ~120 | **O5.** In-memory commands plus resend on reconnect still cover drain/restart. Only a full page reload inside the ~100 ms before `command_accepted` loses the initial message, and that stays in `draft:<id>`. |
| Pending config command + client re-derivation of the effective model | config-actions.ts, pickers reading `configResolution`/`reportedModel` | ~80 | the server sends one resolved `model` on the row and `config` in the detail |
| Kind accessors used as identity (`getBuddyContext`, `buddyContextFromKind`, `isBuddyBuilderConversation` on the client) | ~40 call sites | ~120 | `row.kind` switch. Gate G2 (raw `.buddyContext`/`.purpose` in mobile) is deleted with the fields. |
| `restartRecoveryAtomFamily` + replay UI | restart-recovery.ts 94, useRestartRecovery 92, RestartRecoveryPrompt 31, a test | ~220 | **O4.** It depends on `server_restart` diagnostics. With a typed `TurnFailureCause` on the row (f090910 decision), a failed turn offers **Retry**, which resends the last user message through the same `send` command. |
| Turn-diagnostics read model | utils/turn-diagnostics.ts 382, useTurnDiagnostics 137, useTurnStatusViewModel 37 | ~500 | `RowStatus.failed.cause` drives `TurnStatus`. It needs the server journal decision (03 §7 #11), but the client no longer parses attempts either way. |
| zustand `settingsStore` + `initSettings` | stores/settingsStore.ts 368 | 368 → 60 | **O2.** A preset palette is a `data-palette` attribute plus CSS; removes the second state library and a dependency. |
| `mergeAtoms` | — | 0 | already deleted in 8c9fcfa |
| `console.log` in the spine (9) | actions.ts | 9 | 03 §6.2 #12 |
| Zod parse of every `chunk` | useWebSocket.ts:39 | ~10 | parse `init` and snapshots; `chunk`/`message` are shape-checked by type tag only (T05 may already do this) |
| `activeConversationIdAtom` (dual-active-id) | conversations.ts, App restore | ~40 | the route param is the active id; `prefs.lastConversationId` is only for restore |
| `archivedBuddyIdsAtom` filtering in 3 atoms | buddy-visibility.ts + conversations.ts | ~25 | the server omits them |

**State core: 2,612 → ~1,680 TS** (§5 lists the files).

---

## 2. Two view trees

### 2.1 Duplication measured

| Surface | Desktop (lines) | Mobile copy (lines) | Already shared | Duplicated for real |
|---|---|---|---|---|
| Conversation pane | Chat.tsx 1,008 | ConversationView 970 + ChatMobile 37 | groups, draft, fork, transcript text | **inline panel copies** in ConversationView: `MobileSubAgentPanel` :146 (88), `MobileResumeWidget` :234 (54), `MobileSwarmPrefix`+`SwarmRow`+`SwarmStat` :288-456 (169) = **311**; header actions |
| Transcript rows | VirtualizedMessageList 1,043 | MessageRow 377 | markdown pipeline, groups, segments, copy hook | markdown component overrides, assistant-response rendering, inline cards |
| Composer | in Chat.tsx + PromptPalette 138 | ComposerMobile 518 + PromptPaletteMobile 197 + FullscreenComposer 120 + ComposerAttachments 82 | draft, attachments, submission hooks | prompt palette ×2, queue/interrupt controls |
| Config picker | ConversationConfigPicker 259 + ConfigDropdown 121 | ModelSheetMobile 232 | catalog hook, `.ui-choice` | the option list and grouping |
| Search | SearchPalette 398 | SearchMobile 275 + search atom 37 | fuzzyMatch | ranking and the result list |
| Conversation lists | Sidebar 1,245 + Gallery 679 | ConversationListMobile 137 | the inbox atom | row rendering (title, time-ago, badge, running dot) ×3 |
| New conversation | Sidebar form + PathAutocomplete 552 | NewConversationSheet 211 + create.ts 68 | recentDirectories, createConversation | the form |
| Queue / turn status | inside Chat, TurnStatus 63 | MobileQueueStrip 159, TurnStatusMobile 32 | queue atom, view-model hook | the markup |
| Swarm | Dashboard 231, Detail 1,152, Analytics 648 | SwarmsMobile 191, SwarmDetailMobile 430, SwarmAnalyticsMobile 408 | parsers in utils/ | every view (6 regroup copies, 03 §6.3) |
| Buddy page | BuddiesDashboard 560 | BuddiesMobile 187 + BuddyDetailMobile 316 + 4 tab files 666 | `useBuddyPage`; **mobile already imports 8 desktop Buddy TSX panels** | automations tab ×2 (299 / 325), profile editor ×2, work tab |
| Channels | ChannelBrowser 979 | ChannelsMobile 700 | data, composer, markdown, author, loader (TSX already shared) | rail/feed/thread layout |
| **Mobile-side duplicate TS** | | **≈5,100** of 6,899 | | plus 4,172 mobile CSS restyling the same concepts |

### 2.2 The finding: the rule is already bent where it works best

Gate G3 says "mobile never imports `components/*` except `components/buddies/`", and `docs/mobile-view-tree.md` lists only the `.ts` helpers there. In practice:
- mobile imports **17 Buddy TSX components**: ChannelComposer, ChannelLoader, ChannelMarkdown, BuddyMessages, BuddyCoordination, BuddyTeamExecution, InlineBuddyTeamConfiguration, …
- `ChannelComposer` imports the desktop `components/ConversationConfigPicker`, so mobile already reaches a desktop component transitively.

The Buddy/Channel surfaces are exactly the ones that did not fork. Where G3 was honoured literally (chat, composer, picker, search, swarm), the trees forked.

**What the rule protects.** From the docs and history, it protects three things:
1. desktop layout CSS must not leak into mobile (global cascade)
2. no second bridge or spine
3. no `if (isMobile)` downstream

None of these needs separate *content* components.

### 2.3 Proposal: three layers, one rule (owner decision **O1**)

```
core/     state, spine, commands, resources         (no JSX)
lib/      pure helpers: markdown, groups, paths, time (no JSX)
ui/       primitives: Page, Section, Button, Badge, ListRow, Overlay, Empty, Notice  (+ primitives.css)
views/    device-agnostic CONTENT: transcript rows, composer, config picker, search,
          conversation pane body, conversation row, buddy tabs, channel feed/thread
shells/desktop/   layout only: ShellDesktop, Sidebar, Gallery, FolderFilter, SettingsMenu
shells/mobile/    layout only: ShellMobile, tab bar, pane modes, keyboard inset
features/buddies/ features/swarm/   (views + their own data hooks; swarm is a lazy chunk)
```

**New G3:** `shells/mobile` and `shells/desktop` never import each other. `views/`, `ui/` and `features/` never import `shells/*`. `views/` and `features/` CSS may use only `ui/` primitives, tokens and their own prefixed classes. No width media queries except in `shells/*`, plus `[data-device=mobile]` rules colocated in view CSS.

**Device differences become data.** A view that differs by device takes a named variant prop chosen by the shell, never a boolean:
- `Composer layout: 'inline' | 'fullscreen'`
- `Overlay presentation: 'popover' | 'sheet'`
- `TranscriptList: 'virtual' | 'windowed'`

The windowed list stays because iOS momentum needs a flat scroller (client-state.md). `DeviceKind` stays the single dispatch point (δ in App.tsx). Views never call `useDeviceKind`.

**What stays two-tree:**
- the shell (sidebar vs tab bar)
- the transcript list *container* (virtual vs windowed, ~100 lines each)
- the fullscreen editing mode (FullscreenComposer's viewport logic is mobile-only and correct)
- the Channels mount point (outside the shell on desktop, inside on mobile), which is a 2-line route-table difference

**Rule changes to flag:**

| Rule today | Change | Rationale |
|---|---|---|
| G3: mobile imports no `components/*` except `buddies/` | shells don't import each other; views are shared | measured ~5.1k duplicated lines; the exception already covers 17 TSX files |
| G2: no raw `.buddyContext`/`.purpose` in mobile | delete | the fields leave the wire (T09) |
| docs/mobile-ui.md "new primitives must remain mobile-only" | primitives live in `ui/`, used by both | the same card/badge/list-row exists 3× today (MobileUI, App.css, feature CSS) |
| "device-specific derived views live in `mobile/atoms/`" | keep, but there is nearly nothing left to put there (search state moves into `views/Search`) | — |

**Kept unchanged:** one bridge, one spine, G1 (`jotaiStore.set` only in `core/`, renamed from `atoms/`), G4, G5, G6, `usePolledFetch` for reads, `<Link>` + `idSet` for "open conversation".

---

## 3. CSS (18,489 lines)

### 3.1 Measurements (postcss parse, `.work/06-css-audit.mjs`)

| Metric | Value | What it means |
|---|---:|---|
| Files / rules / declarations | 55 / 2,450 / 9,861 | |
| **Colors via `var(--…)` vs literal** | **2,419 vs 70** | the color token layer works. `index.css` derives 60+ tokens from 14 theme values. **Keep it.** |
| Declarations with a literal `px` | 2,528 | spacing and type are not tokenized at all |
| Distinct `font-size` values | **45** (12px×136, 11px×129, 13px×102, 10px×55, 14px×40, 16px×38, 9px×25, 15px×19, 12.5px, 13.5px, 11.5px, 14.5px, …) | a 6-step type scale covers all of them |
| Distinct `padding` / `gap` / `border-radius` values | **172** / 39 / 14 | `--ui-radius` exists, but 14 radii are still in use |
| Width media queries | 700, 720, 760, 768×5, 900, 640, 600, 340px | 9 breakpoints for a 2-device app |
| Unique `prop:value` pairs | 1,709 across 9,861 declarations | 8,824 declarations (89%) repeat a pair used elsewhere |
| **The 30 most common pairs** | ~3,600 declarations (37%) | layout: `display:flex` 433, `align-items:center` 247, `flex-direction:column` 155, `min-width:0` 148, `gap:8px` 112. Text: 4 color tokens 687, `font-size` 11/12/13 367. Chrome: `border-radius:var(--ui-radius)` 296, `border:1px solid var(--border-subtle)` 117, `cursor:pointer` 160 |
| Identical declaration blocks (≥3 declarations) repeated | 76 blocks, 188 instances | copy-pasted rules |
| Classes styled in more than one file (any position, not just top-level) | 64 | e.g. `.provider-selector`/`.model-selector` in Chat, Sidebar and ChannelComposer CSS. G6 checks only top-level selectors, so it misses these. |
| **Dead selectors (class token appears in no TS/TSX)** | strict: **162 lines** (mobile-memory-v2 119, Chat 35, ChannelContent 8); loose: 512 | dead CSS is **not** where the weight is. Several "dead" hits are library-generated (`.katex-*`, `.hljs`, `.task-list-item`), so they are false positives. |
| Comment lines | ~870 | mostly incident notes; they move to docs |

**Where the weight actually is:**
1. **Live CSS for features being deleted or merged:** Buddy UI 6,609, swarm 2,735, palette/usage 970, `/robot` 115.
2. **Two stylesheets per concept:** mobile/styles 4,025 restyles chat, lists, buddy and channels again.
3. **Per-component re-declaration of layout and type:** that is the 37%.

### 3.2 Lean styling approach (owner decision **O13**; recommended default below)

Plain global CSS, no new dependency, in five layers with a line budget each:

| Layer | File(s) | Budget | Contents |
|---|---|---:|---|
| 1. Tokens | `ui/tokens.css` (from index.css 369) | 250 | the 14 theme values + color-mix derivations (kept as is); **new:** `--fs-1…6` (10/11/12/13/15/18), `--sp-1…6` (2/4/6/8/12/16/24), `--radius` (one value) + `--radius-round`, `--z-*`, `--dur-*`; `data-palette` presets (O2) |
| 2. Primitives | `ui/primitives.css` + `ui/*.tsx` (~250 TS) | 450 | `.stack`/`.row`/`.cluster` with `--gap` steps, `.card`, `.btn` (+`--primary`/`--ghost`/`--danger`), `.badge` (+ intents), `.input`, `.list-row`, `.overlay` (popover/sheet), `.page`/`.section`, `.empty`, `.notice`, `.spinner`, `.mono`, `.muted`, `.truncate` |
| 3. Content | `lib/markdown.css` | 280 | one markdown stylesheet for chat **and** channel bodies (code, katex, hljs, tables, task lists), replacing Chat.css + ChannelContent.css + the mobile-markdown rules |
| 4. Views/features | one file per view dir: transcript 350, composer 200, conversation 150, config 80, lists 300, buddies 380, channels 420, swarm 450 | 2,330 | layout unique to the view only; device tweaks as `[data-device=mobile] .x {}` colocated |
| 5. Shells | `shells/desktop.css` 220, `shells/mobile.css` 220 | 440 | frame, sidebar, tab bar, safe areas, pane modes; the only place with width media queries (one breakpoint, 768px) |
| **Total** | | **3,750** (3,300 without swarm) | from 18,489 (**4.9×**) |

Why not CSS Modules or Tailwind:
- Modules would fix the G6 class of bug, but the bug is already gated. They add a build convention and do not reduce the line count.
- Tailwind would cut the most CSS, but it moves the weight into className strings, adds a dependency and a tool, and the `[data-device]` / `data-palette` token design already exists.

Either is a legitimate owner call. The budget above assumes plain CSS.

### 3.3 Migration path (CSS)

1. **Measure first:** extend screenshots (step S0) so every route has a baseline sheet.
2. **Tokenize values in place, with no class renames:** a codemod maps literal `font-size` to the nearest `--fs-*` and `gap`/`padding` steps to `--sp-*`. It skips values inside `calc()` and `clamp()`. Run `--compare`; accept diffs up to 1px of type rounding. This is mechanical and big: ~2,500 declarations. **New gate G7 (ratchet):** a literal `font-size` or `px` `gap`/`padding` outside `ui/tokens.css` fails unless it is in `KNOWN_LITERAL` (starts at the post-codemod count and only goes down).
3. **Primitives:** introduce `ui/primitives.css` + `ui/*.tsx`. Components adopt them as each view is consolidated (steps S5–S12). Their per-component CSS is deleted in the same commit, never later.
4. **Delete with the feature:** each feature deletion removes its CSS in the same commit (Buddy team config, reviews, swarm mobile, palette, robot).
5. **Merge mobile stylesheets into the view files** as each view is shared. `mobile/styles/*` shrinks to `shells/mobile.css`.
6. **Final gate G8:** a per-layer line budget, where `wc -l` over each layer must stay ≤ its budget. Plus a strengthened `css-classes.test.ts` covering *all* classes, not just `mobile-`: every class styled must appear in TS/TSX (dead CSS), and every literal class used must be styled (the existing ratchet).

### 3.4 Verifying there are no visual regressions

- **Coverage.** `pnpm screenshots` today covers only Channels (8 screens, `tools/screenshots.mjs:248`). Step S0 adds these screens, each with a `needs`/skip reason, and never faked data:
  - `gallery`
  - `chat` (a long real transcript: code, tool calls, katex)
  - `chat-picker-open`
  - `sidebar` (desktop only)
  - `search`
  - `new-conversation`
  - `buddies`, `buddy-<tab>` × each tab
  - `workspace-activity`
  - `swarm`, `swarm-detail`
  - `settings-menu`

  Streaming is not screenshotted. It is covered by the tail-regroup test.
- **Diff.** `pnpm screenshots --compare <previous run dir>` loads both PNGs into a canvas in the same headless Chrome (no new dependency, and it reuses `tools/lib/headless-chrome.mjs`). It writes `diff/<screen>@<size>.png` plus a changed-pixel percentage into `manifest.json`, and the contact sheet gets a third column. Budget: 0% for pure refactors, and ≤0.5% plus a reviewer look for the tokenization codemod.
- **Per step:** baseline run on the parent commit, then run on the step commit, then compare. The sheet goes to `output/screenshots/…` and is linked from the commit message. Real data drifts between runs, so use `--workspace/--channel/--thread` pins and run both captures back-to-back.

---

## 4. Buddy UI mapped onto the 11 primitives and ~35 routes

Routes are from 02 §8.4 (buddies, tasks, runs, docs, schedules, channels/lists). "Target" is TS/TSX; the CSS is in the §3.2 budgets (buddies 380, channels 420).

### 4.1 Screens

| Screen / route | Primitive(s) | Today (TS) | Fate | Target |
|---|---|---:|---|---:|
| `/buddies` directory (+ manager tree, replacing the Team tab) | buddy | BuddyDirectory 132, dashboard directory part ~120, BuddiesMobile 187, BuddyRailRow 60 | **simplify**, one view for both shells; tree by `manager_id` | 150 |
| `/buddies/:id/:tab` frame + tab nav | buddy | BuddiesDashboard 560, BuddyDetailMobile 316, BuddySectionNav 39, buddy-tabs 65 | **simplify**: one frame; tabs are routes (kept) | 150 |
| tab **chats** | run → conversation | BuddyConversationList 103, BuddyDetailConversationsTab 44, atoms/buddy-conversation-list 49 | **keep**, reads `listIndex.buddyThreads[buddyId]` | 60 |
| tab **tasks** (was Work) | task (+child tasks as todos), post (target=task), run | BuddyProjectExecution 350, BuddyTaskComments 156, BuddyDetailWorkTab 150, atoms/buddy-work 10, dashboard work cards ~150 | **simplify**: list + detail; todos are child tasks; comments are posts on the task through the shared feed; "Run" → `POST /tasks/:id/run` | 280 |
| tab **inbox** (was Mailbox) | post (target=buddy, `reply_state`), run | BuddyMessages 670 | **simplify**: posts to/from the buddy; awaiting replies; reply → `POST /runs/:id/reply`; memberships/stop sections go | 200 |
| tab **runs** (was Background + Team execution) | run | BuddyTeamExecution 350, BuddyBackgroundTasks 123, atoms/buddy-background 30, coordination run section ~120 | **merge** into one run list `GET /runs?buddyId` with cancel/retry; repair dropped | 150 |
| tab **docs** (was Memory + soul editor) | doc, doc_revision | BuddyMemoryWorkspace 125, BuddyMemoryPanel 282, memory.ts 147, BuddySoulEditor 203, BuddySoulConflict 120, soul-merge 37 | **simplify**: one `DocEditor` for soul/working/long_term/note with CAS; on conflict, show theirs vs yours and pick (drops the `node-diff3` 3-way merge, **O14**); revisions list | 260 |
| tab **schedules** (was Automations) | schedule, run | BuddyAutomationsTab 299, BuddyDetailAutomationsTab 325 | **merge** the two copies; legacy automation-run history and approvals are deleted; history = `GET /runs?scheduleId` | 170 |
| tab **settings** (profile, model, manager, run limit, archive) | buddy | BuddySettings 102, BuddyExecutionProfile 125, BuddyDetailProfileEditor 147, coordination reparent part ~60 | **merge** onto `PATCH /buddies/:id` and `DELETE` | 140 |
| tab **team** | — | BuddyTeamConfiguration 976, BuddyInactiveAccess 106, BuddyCoordination 474 (rest) | **delete** (decided); manager edit is in settings, the org view is in the directory | 0 |
| review markers in transcripts | — | BuddyReviewMessage 127, utils/buddy-review-message 141, InlineBuddyTeamConfiguration hook-ins | **delete** (reviews deleted). Old transcripts show the raw text, which is acceptable because they are legacy. | 0 |
| `/buddies/workspaces/:id` activity | run (live), workspace | BuddyWorkspaceActivity 157 | **simplify** onto `GET /runs?workspaceId&live`; drop the 2 s poll for push + 30 s backstop | 90 |
| `/buddies/workspaces/:id/channels` (+ `/channels`) | channel, post, post_read | ChannelBrowser 979, ChannelsMobile 700, channel-route 48 | **merge**: one `ChannelView` (home/rail, feed, thread) + a desktop frame (80) and a mobile frame (90) | 720 |
| channel data + feeds (keyset paging, unread, responding) | post, post_read | channel-data 827 | **keep the design** (it is sound, per client-state.md), trimmed onto the new routes | 400 |
| channel composer (mentions, media, model pick) | post | ChannelComposer 635 | **simplify**; uses `views/config` and `views/composer/Attachments` | 320 |
| channel text / markdown / author / links / wake / loader / outbox | post | channel-text 344, ChannelMarkdown 339, ChannelAuthor 82, channel-link 43, CopyLinkButton 66, WakeIndicator 70, ChannelLoader 127, channel-outbox 52 | **simplify**: ChannelMarkdown reuses `lib/markdown` (one pipeline, one flavor table) | 620 |
| Builder create + result card | buddy (builder conversation) | create-buddy-builder 28, BuddyBuilderResultCard 178 | **keep**, trimmed | 115 |
| Buddy header in chat + worker-thread badge | buddy, run | BuddyConvoHeader 53, BuddyWorkerThreadBadge 26 | **keep** | 60 |
| Avatar | buddy | BuddySigil 35 + sigil/ 791 + dev/sigil-gallery 85 | **O3**: initials + a hue from id (30), or keep the sigil (+880) | 30 |
| Data layer | all | api.ts 40, types.ts 281, buddies-shaping 139, ui-contract 138, buddy-direct-actions 84, useBuddyData 264, atoms/buddy-sidebar 244, mobile/atoms/buddies 59 | **rewrite**: typed client for the 35 routes (80); types come from `@unleashd/shared` generated from the T06 crate, so there is no hand copy (0); read hooks per primitive (150); shaping (80); direct actions (40); the sidebar's buddy section comes from `listIndex` + overview (0) | 350 |
| **Buddy total** | | **13,992 TS + 6,609 CSS = 20,601** | | **~4,255 TS + 800 CSS ≈ 5,055 (4.1×)** |

### 4.2 Route usage after the rewrite (client callers)

| Route group (02 §8.4) | Client caller |
|---|---|
| `GET /buddies`, `GET/PATCH/DELETE /buddies/:id`, `POST /builder` | directory, frame, settings, builder |
| `GET/POST /tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/run` | tasks tab, channel task chips |
| `GET /runs`, `POST /runs/:id/{cancel,retry,reply}` | runs tab, inbox, workspace activity, schedule history |
| `GET/PUT /docs/:bid/:kind`, `POST /docs/:bid/notes`, `POST /docs/:bid/recall` | docs tab |
| `GET/POST/PATCH/DELETE /schedules`, `POST /schedules/:id/run` | schedules tab |
| channels (8) + lists GET/POST + 3 feeds | channel views, composer, unread title |

Every call goes through `features/buddies/api.ts`. No other file builds a `/api/buddies` URL, which fixes the dynamic-URL sprawl in 02 §5. That is a grep gate (G9).

---

## 5. Module map (every file or group → target)

### 5.1 Target layout and budgets

| Target module | Today's files (lines, lean/integration) | Fate | Target TS | Target CSS |
|---|---|---|---:|---:|
| `core/` store, mutate, rows, index, transcripts, stream, spine, commands, connection, prefs, resources, usePolledFetch, useWebSocket, fork | atoms/* except buddy (2,213), usePolledFetch 187, useWebSocket 116, conversation-route-state 124, config-actions 46, fork-actions 27, restart-recovery 94, mobile/atoms/buddies 59 | rewrite onto §1 | 1,680 | 0 |
| `lib/` markdown pipeline, groups, segments, time, paths, fuzzy, ids, clipboard, transcript text, subAgents, route state, project colors, copy hook | utils/* non-swarm, non-review (1,570), lazyMarkdownPlugins 84, useCopyAction 53 | keep, dedupe (T05 does time/paths) | 1,040 | 280 (markdown.css) |
| `lib/` observability + auth | client-error-reporter 164, ClientErrorBoundary 78, auth/session 63 | keep, trim | 200 | 0 |
| `ui/` primitives | MobileUI 151, EmptyState 29, ChatActivity 33, App.css shared bits, controls.css | **new shared layer** | 250 | 700 (tokens 250 + primitives 450) |
| `views/transcript` | VirtualizedMessageList 1,043, MessageRow 377, AskUserQuestion 94, FilePreview 238 | **merge**: one row set, two list containers | 810 | 350 |
| `views/composer` + hooks | Composer part of Chat, ComposerMobile 518, FullscreenComposer 120, ComposerAttachments 82, PromptPalette 138 + Mobile 197, useConversationDraft 283, usePendingAttachments 333, useComposerSubmission 134, useSavedPrompts 66 | **merge**: `layout: 'inline' | 'fullscreen'` | 950 | 200 |
| `views/conversation` | Chat.tsx 1,008, ConversationView 970, ChatMobile 37, SubAgentPanel 216, ResumeThreadWidget 77, MobileQueueStrip 159, TurnStatus* 95, ContextBreakdownMeter 274, turn diagnostics 556, RestartRecoveryPrompt 31 | **merge** into one pane body; shells add a frame | 560 | 150 |
| `views/config` | ConversationConfigPicker 259, ModelSheetMobile 232, useProviderCatalog 36 | **merge**; popover vs sheet via `Overlay` | 256 | 80 |
| `views/lists` (ConversationRow, FolderGroups, Search, NewConversation) | Search×2 673, search atom 37, NewConversationSheet 211, create.ts 68, PathAutocomplete 552, conversation-title 30, fuzzy in lib | **merge** | 740 | 300 (with sidebar/gallery) |
| `shells/desktop` (ShellDesktop, Sidebar, Gallery, FolderFilter, SettingsMenu, UsagePanel) | ShellDesktop 21, Sidebar 1,245, Gallery 679, FolderFilter 290 + hooks 131, ConfigDropdown 121, UsagePanel 323, ColorPalettePicker 595, settingsStore 368 | **simplify**: lists come from `listIndex`, rows from `views/lists`; palette → presets (O2) | 990 | 220 |
| `shells/mobile` (ShellMobile, Chats page, useDeviceKind, useKeyboardInset) | ShellMobile 119, ConversationListMobile 137, useDeviceKind 49, useKeyboardInset 48, mobile.css 595, mobile-ui.css 1,392, mobile-controls 207, search-mobile 198, composer/fullscreen CSS 147 | **shrink** to frame only | 310 | 220 |
| `App.tsx`, `main.tsx` | 251 + 57 | lazy route table (T05), restore-on-load via route | 150 | 0 |
| `features/buddies` | 13,992 TS + 6,609 CSS | §4 | 4,255 | 800 |
| `features/swarm` (quarantined, lazy chunk) | 3,816 TS + 2,735 CSS | move; delete mobile copies (O6); one regroup; one parser | 1,900 | 450 |
| delete: `/robot` | RobotLoader 202 + 115 | delete | 0 | 0 |
| **Total** | **36,260 TS + 18,489 CSS = 54,749** | | **~14,090** | **~3,750** |

**Client total: ~17,840 (3.07×).** Without the swarm chunk (one later delete, per DESIGN C.5): **~15,490 (3.53×)**.

### 5.2 Product features that must survive, and where they land

| Feature | Lands in | Screenshot screen (S0) |
|---|---|---|
| Chat: send, queue, interrupt, stop, done | `views/conversation`, `views/composer`, `core/commands` | chat |
| Streaming (rAF flush, tail regroup, live markdown renderer) | `core/stream`, `groupsFamily`, `lib/markdown` (`renderMarkdownLive`) | — (test) |
| Sidebar + gallery + folder filter + NEW badges | `shells/desktop`, `views/lists`, `listIndex`, `unreadFamily` | sidebar, gallery |
| Config picker (provider/model/effort, pass-through strings) | `views/config` | chat-picker-open, mention-model |
| Resume / fork (soft handoff via `draft:<id>`) | `core/fork`, `views/conversation` | chat |
| Channels (feeds, threads, @mentions, media, Task chips, unread) | `features/buddies/channels` | the existing 8 channel screens |
| Buddy pages (directory, 7 tabs, builder) | `features/buddies` | buddies, buddy-<tab> |
| Mobile shell (tab bar, pane modes, fullscreen composer, keyboard) | `shells/mobile`, `views/composer` fullscreen | every screen @phone |
| Uploads / dropzone (keep the unary `onDrop` rule) | `views/composer/Attachments`, `usePendingAttachments` | new-conversation, chat |
| Markdown / KaTeX / highlight (lazy chunks) | `lib/markdown` | chat (long) |
| Search (fuzzy, conversations + buddies) | `views/lists/Search` | search |
| Subagents panel, context meter, turn status + retry | `views/conversation` | chat |
| Swarm dashboard/detail (quarantined) | `features/swarm` (lazy) | swarm, swarm-detail |
| Error boundary + client error journal | `lib/observability` | — |

### 5.3 Owner decisions (candidate removals and rule changes)

| # | Decision | Default recommended | Lines at stake |
|---|---|---|---:|
| O1 | Replace G3 with the shells/views rule (§2.3) | **yes**; it is the precondition for most of the merge savings | ~5,000 |
| O2 | Palette generator → fixed presets (`data-palette`) and drop zustand | **presets** (DESIGN decision 9 left this open) | ~1,900 (595+575 picker, 368 store, server side separately) |
| O3 | Procedural Buddy sigil → initials avatar | **initials** | ~880 |
| O4 | Restart-recovery replay → "Retry" on a typed failed turn | **Retry** | ~220 + a test |
| O5 | Pending creations persisted across page reload → in-memory + resend on reconnect | **in-memory** | ~250 |
| O6 | Swarm: delete the mobile copies (SwarmsMobile/Detail/Analytics + mobile-swarm.css) and fold Analytics into Detail | **delete mobile copies** now; the rest goes when swarm goes | ~1,430 now, ~6,550 at removal |
| O7 | Desktop `/` Gallery kept vs `/` = the chat list at full width | keep, trimmed to 250 + 150 CSS | ~800 more if merged |
| O8 | `/robot` demo route | **delete** | 317 |
| O9 | UsagePanel (depends on the server usage-route rewrite, 03 §7 #7) | keep, reading the new usage source | ~500 if cut |
| O10 | Context breakdown meter → a single bar from `latestUsage` | **single bar** | ~250 |
| O11 | Turn-diagnostics detail UI (depends on the fate of the server turn-attempt journal) | **delete**, keep `cause` | ~500 |
| O12 | Buddy tabs: 8 → 7 (team deleted; background + team-execution → runs) | **yes** (follows the decided deletions) | in §4 |
| O13 | Styling: plain CSS + tokens + primitives (vs CSS Modules/Tailwind) | **plain CSS** | §3 |
| O14 | Soul/doc conflict: 3-way merge (`node-diff3`) → pick theirs/yours | **pick** | ~160 + a dependency |

---

## 6. Ordered migration steps

Every step is one branch off `lean/integration` in its own worktree and lands on its own. **Exit checks for every step:**
- `pnpm typecheck` (`tsc -b`)
- `pnpm test:client`
- `bash tools/check-client-invariants.sh`
- `pnpm screenshots --compare <parent-run>` with the contact sheet reviewed

Verify the **commit** (`git status --porcelain` empty in the worktree, or `git grep` at HEAD), per CLAUDE.md. A step that deletes a feature deletes its CSS, its tests and its docs lines in the same commit.

| Step | Depends on | Work | Δ lines (≈) | Extra verification |
|---|---|---|---:|---|
| **S0** | — | Screenshot coverage for all routes (§3.4) + `--compare` pixel diff; take the baseline run. Strengthen `css-classes.test.ts` to all classes (dead-CSS direction); extend G6 to descendant-position classes, with a ratchet list of today's 64. | +250 tools | the sheet shows every route at 4 sizes |
| **S1** | — | Safe deletions: `/robot`, `dev/sigil-gallery`, strict-dead CSS (162), the `sidebarViewMode` pref, spine `console.log`s, legacy pending-creation migration (130) | −700 | — |
| **S2** | T05 merged | Tokens: `--fs-*`, `--sp-*`, one radius; codemod literals; gate G7 ratchet; one breakpoint | −400 (values mostly change in place) | compare ≤0.5% per screen, eyeballed |
| **S3** | S2 | `ui/` primitives (TS + CSS). Adopt them in MobileUI and App.css shared primitives. Write the rule change O1 into `docs/mobile-view-tree.md`, `docs/mobile-ui.md` and CLAUDE.md's code map, and update G3 in `check-client-invariants.sh` | −300 | G3 new form passes |
| **S4** | S3 | `views/transcript`: one row set (from VML + MessageRow), two containers; markdown CSS unified | −1,500 | chat (long), channel screens; markdown-pipeline test stays byte-identical |
| **S5** | S3 | `views/composer`: one Composer (`inline`/`fullscreen`), one PromptPalette, shared Attachments | −1,100 | new test: fullscreen keeps the same textarea node mounted (regression guard from mobile-ui.md) |
| **S6** | S3 | `views/config` + `Overlay` (popover/sheet); `views/lists/Search`; `views/lists/NewConversation` (PathAutocomplete trimmed) | −1,800 | chat-picker-open, search, new-conversation |
| **S7** | S4, S5 | `views/conversation`: one pane body; delete the 311 lines of inline mobile panel copies; `TurnStatus` from the row status | −2,000 | chat @ all sizes |
| **S8** | T05, S6 | Lists: `ConversationRow` + Sidebar/Gallery/mobile list on `listIndex`; FolderFilter trimmed | −2,500 | sidebar, gallery, chats @phone |
| **S9** | T09 merged | Wire adoption: `rowsAtom` + patches + `transcriptFamily` + `commandsAtom` + `connectionAtom`; delete the kind accessors, `configResolution` readers, archived filter, dual active id, bulk seen-mark, G2 | −1,200 | new integration test: replay a captured `init` + patch stream fixture through the real spine and assert the index and one row; replaces pending-creations/detail-loader/summary-history tests |
| **S10** | S9 + owner O4, O5, O11 | Commands: in-memory resend on reconnect; Retry on failed turn; delete restart-recovery and the turn-diagnostics read model | −1,000 | a regression test for "a draining rejection is retried after reconnect with the same commandId" |
| **S11** | T11 merged | Buddy UI onto the 35 routes: delete team config, access, coordination, review markers, approvals, legacy runs; tabs per §4; one directory/frame for both shells; `api.ts` sole URL builder (G9) | −10,300 | buddies, buddy-<tab> @ all sizes; delete the buddy-team-* tests; keep buddy-conversation-links |
| **S12** | S4, S11 | Channels: one `ChannelView` + two frames; ChannelMarkdown on `lib/markdown`; composer on views | −4,300 | all 8 existing channel screens, both trees |
| **S13** | T10 merged + O6 | Swarm quarantine: move to `features/swarm` (lazy), delete the mobile copies, one regroup, one parser | −4,200 | swarm, swarm-detail (desktop); on phone the swarm tab shows the chat list filtered to workers |
| **S14** | owner O2, O3, O10, O14 | Presets replace the palette generator + zustand; initials avatar; single-bar meter; doc conflict pick | −3,200 | settings-menu; avatar in the directory and channels |
| **S15** | all | CSS final pass: merge the remaining `mobile/styles/*` into view files; per-layer budget gate G8; delete `mobile/` and `components/` directories; docs updated (client-state.md atom tables, mobile docs) | −2,400 | full sheet vs the S0 baseline, both trees |

The Δ column sums to about −36.9k, which is 54,749 → ~17,840.

**Order rationale:**
- S0–S3 have no dependencies and de-risk everything after them (you cannot cut 15k CSS lines without a pixel diff).
- S4–S8 are client-only merges that pay back before the wire changes.
- S9–S13 wait on the server tasks (T09, T10, T11) and are then mostly deletion.
- Owner-gated removals are grouped in S10 and S14 so the rest never blocks on a decision.

**Tests** (following the owner's rules):
- One integration test through the real spine on a captured-and-trimmed `init` + patch fixture.
- Architectural invariants that a refactor would silently break:
  - a streaming frame changes only the tail group's identity
  - a status patch on conversation A does not change `listIndex.inbox` identity when A's list position is unchanged
  - no `/api/buddies` string outside `features/buddies/api.ts`
- Regression guards that already exist stay: failed-refresh-keeps-page, markdown-pipeline, buddy-conversation-links, folder-grouping, upload-drain-retry.
- Tests of deleted features go with them: team config, team execution, restart recovery, pending creations (V1 migration), review messages. That is roughly 1,500 of the 6,244 test lines.
