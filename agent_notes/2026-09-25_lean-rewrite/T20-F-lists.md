# T20 slice F: conversation rows and the new-conversation form

Branch `refactor/t20-lists` (worktree `.claude/worktrees/lane-t20-lists`). Status: DONE, not merged, not pushed.

Commits:
- `6645ef0` adds one `ConversationRow` view, used by Sidebar, Gallery and the mobile lists.
- `f80085a` adds one `NewConversationForm`, shown in the desktop modal and in the mobile sheet.

Checks at `f80085a`, run with a clean tree so they test the commit:
- `pnpm typecheck` passes.
- `pnpm test:client` passes, 173/173. This includes folder-grouping, buddy-conversation-links and the new conversation-row-links test.
- `check-client-invariants` passes all 8 gates. G8 is 14697 lines, and the ceiling was lowered from 14704 to 14697.

## Line counts

| File | Before | After |
|---|---|---|
| components/Sidebar.tsx | 1183 | 892 |
| components/Gallery.tsx | 719 | 603 |
| components/PathAutocomplete.tsx | 554 | 554 (unchanged; the Buddy WorkspaceHome also uses it) |
| mobile/conversations/ConversationListMobile.tsx | 122 | 59 |
| mobile/components/NewConversationSheet.tsx | 213 | 84 (only the `<dialog>` container) |
| mobile/atoms/create.ts | 70 | 1 (re-exports `createBuddyViaBuilder` for BuddiesMobile, which belongs to the Buddy lane) |
| views/conversation-row/ConversationRow.tsx | — | 308 |
| views/new-conversation/NewConversationForm.tsx | — | 231 |
| views/new-conversation/create.ts | — | 65 (moved from mobile/atoms) |
| **TSX total** | **2861** | **2797** |
| components/Sidebar.css | 965 | 723 |
| components/Gallery.css | 430 | 339 |
| mobile/styles/mobile.css | 493 | 437 |
| mobile/styles/mobile-ui.css | 1267 | 1230 |
| views/conversation-row/ConversationRow.css | — | 292 |
| views/new-conversation/NewConversationForm.css | — | 127 |
| **CSS total** | **3155** | **3148** |

Test added: `client/test/conversation-row-links.test.tsx`, 6 cases. Each variant must:
- be one `<a href=/chat/:id>`,
- not nest a `<button>` inside the link,
- render nothing when the row is missing.

## What was built

**ConversationRow** (`variant: 'sidebar' | 'card' | 'list'`):
- It is a flat discriminated props union, so the default `memo` still works.
- All variants share one subscription path (`rowFamily(id)`, `unreadFamily(id)` and the shared tick) and one `rowFacts` derivation.
- All variants use one status dot: `data-status` is running, queued, unread or idle.
- There is one handler per variant.
- The sidebar variant keeps ONE line and keeps Done as an absolute hover overlay, now `.conversation-row__done`.
- All three variants are now `<Link>`s. Before, Sidebar and Gallery were `div onClick={navigate}`, so middle-click and open-in-new-tab now work.
- An absent `rowFamily` renders nothing, so it acts as the availability check. The rows come from `listField` ids, which is where `idSet` also comes from.
- The Gallery card uses a stretched link, so Restore and Promote are not nested inside the `<a>`.

**NewConversationForm** (`layout: 'modal' | 'sheet'`, `start: DirectoryStart`, `primary: 'chat' | 'swarm'`):
- The containers stay in the shells: the Sidebar overlay and the mobile `<dialog>`.
- Layout differences are one data table (`LAYOUT`), with no boolean props.
- `create.ts` (`createFromRequest`, with handlers for chat and swarm) now serves both trees. This deleted the Sidebar's duplicate `handleConfirm` and `handleCreateNewSwarm`.

## Feature differences

**Features one tree gains:**
- Mobile gains PathAutocomplete: fuzzy search over recent folders, filesystem suggestions, path validation and mkdir. It also gains the Chat and Swarm buttons together in one sheet (the primary one follows the page) and the Shift+Enter hint.
- Desktop gains the "Disconnected from the server" note in the form (before, it was only a tooltip) and a Link row with a focus ring.
- The Gallery card now shows the unread and queued dot as well as running.

**Features that stay on one tree (by layout):**
- **Desktop modal only:**
  - the inline provider/model picker;
  - the path field autofocuses.

  The sheet uses the catalog default provider, and the model is changed from ChatMobile's header, as before.

  Reason for keeping the picker off mobile: its option CSS (`.provider-option` and related) lives in the desktop `Sidebar.css`. The config-picker lane owns that CSS, and mobile does not load that file.
- **Mobile sheet only:** tappable recent-folder buttons, showing 8 of them.
- **Mobile list row only:** Done and New text badges, plus the folder and path lines.
- **Sidebar row only:** the Done action, the kind label (Builder / Buddies), and the time-ago brightness decay.
- **Gallery card only:** Restore and Promote, the id, the provider/worker badge and the message count.

**Behaviour changes:**
- **Filter box removed:** mobile's separate "Filter recent folders" box is gone. PathAutocomplete's fuzzy match over recent folders replaces it.
- **Default directory:** mobile's default is now the latest-activity cwd, not `recentDirs[0]`.
- **Create waits for the catalog:** Create is disabled on both trees until the provider catalog loads. Mobile used to fall back to 'claude'.
- **Buddy "new thread" seed:** in the Sidebar, a Buddy with no prior thread now starts from the catalog default. Before, it reused the last new-conversation picker choice.
- **Trailing slash:** both trees normalise the directory with `normalizeFolderDirectory`. Desktop used to send a trailing `/` after picking a suggestion.
- **Swarm title (mobile):** on the mobile Swarms page, "+ New" still says "New swarm" and makes Swarm the primary action.

## Notes for other lanes
- `SwarmsMobile` (swarm lane) still imports `mobile/components/NewConversationSheet` with the same `{kind, onClose}` props. It was not touched.
- The Sidebar CSS now reuses the view's `.conversation-row__dot` and `conversation-row-pop` keyframes for pending rows, the folder "N running" dot and the Buddy header. This let me delete `.status-indicator` and the duplicate keyframes.
- The instructions said the desktop shows the form "inline", but it actually shows it in the Sidebar's centered modal. I kept that container and did not add a new inline mount.
- I did no screenshot pass, because I was told not to start a server.
