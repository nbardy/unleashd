# PORT-QOL-2: workspace home onto lean/integration (2026-09-26)

Worktree `.claude/worktrees/lane-port2`, branch `port/qol-2` (79efc37 + 3 commits). Not pushed, not merged.

| Source | Result | Where / why |
|---|---|---|
| 6d04860 `/` is the workspace home | ported **7682fde** | `WorkspaceHome.tsx` + pure `workspace-home.ts`. Workspaces come from the shared overview, so there is no new GET route. Recency and Buddy faces come from `listField('buddyEntries')`, which replaces the server `recentRuns`. Totals come from `ownerUnreadTotal` over `useOwnerInboxes`. Desktop `/` sits outside the shell; mobile keeps it in the tab bar as "Home". The list moved to `/chats`, and `useRestoreOnLoad` is deleted. The crate's POST create was already idempotent by root path. The route now realpaths the folder, returns 400 for a file, a missing path, a relative path or `/`, and uses the folder name when no name is given (buddies-v2 HTTP test). Beyond the source, the "← Gallery" buttons, Chat's bounce, Sidebar Done, the mobile chat fallback and the screenshot screens now point at `/chats`; there is also a new `workspace-home` screen. The +111 CSS is offset by merging same-file rules with identical bodies (safety-checked). G8: 14961 → 14947. |
| 89b27ad Create disabled until a folder is chosen | ported **bf1a194** | `createReady(folder, valid)`: PathAutocomplete calls `''` valid. A test pins that case. |
| c5e0ded workspace emblems | ported **d48024c** | `emblem.ts` is copied. The source's two-program shader is applied onto the OffscreenCanvas renderer. Emblems render in the sigil worker: `SigilRequest.kind` is `'sigil' \| 'emblem'`, and the worker dispatches through a Record. `sigil-off-main-thread.test.ts` covers emblems too. The `?emblems` gallery page is **obsolete**: integration deleted `dev/sigil-gallery.ts`. |

Checks on the clean committed tree (`git status --porcelain` empty): typecheck pass, test:server 255/255, test:client 156/156, test:tools pass, test:cli pass, invariants 8/8, vite build pass. No UI screenshots were taken (no dev server was run for this lane).

Open: `prefsAtom.activeConversationId` is now written but not read for restore.
