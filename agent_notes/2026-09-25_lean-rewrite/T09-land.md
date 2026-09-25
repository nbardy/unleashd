# T09 land: feat/wire-v3 (373b98a) onto lean/integration (e125c7c)

Merge commit: **5da6fa3** on `merge/wire-v3`. Not pushed, and not merged into lean/integration.

## Conflict resolutions (v3 fields/logic + T21a ui-* classes)
- Chat.tsx folder link: `conversation.cwd` (v3) + `chat-dir ui-truncate ui-muted` (T21a)
- Chat.tsx header: `resumedFrom` (v3) + `chat-time-ago ui-muted`
- Chat.tsx empty state: v3's `isBuddyBuilder` text (dropped T21a's `provider || 'claude'` "Waiting for…" fallback) + `empty-state ui-muted`
- Gallery.tsx: `conv.messageCount === 0` (v3; T21a had `messages.length`) + `empty-state ui-muted`
- Sidebar.tsx folder badge: `conv.kind.t === 'builder'` (v3) + `folder-badge ui-truncate`, multi-line span
- SwarmDetail.tsx roster: `rowWorker(w)?.workerId`, `w.messageCount` (v3) + `ui-truncate`/`ui-muted` on id/model/msgs
- ConversationListMobile.tsx: `isRowRunning(conv)` (v3) + `__time ui-muted`
- ConversationView.tsx (mobile): `title={conversation.cwd}` (v3) + `mobile-chat__dir ui-truncate`
- shared/src/index.ts: both sides dropped. v3 moved ConversationSchema/DiscoveredConversation to `shared/src/conversation.ts`, and T21a deleted `EFFORT_DISPLAY_NAMES` (nothing uses it)
- shared/src/conversation-kind.ts (modify/delete): v3's deletion kept. T21a's change there only removed dead helpers.

## Checks (committed tree, `git status` clean)
- `pnpm typecheck` (shared, server, client tsc -b + tests, agent-cli): PASS, run before and after the commit
- `pnpm test:server` run 1: 271/271 pass
- `pnpm test:server` run 2: 271/271 pass
- `pnpm test:client`: 134/134 pass
- `pnpm test:tools`: 3/3 pass
- `bash tools/check-client-invariants.sh`: all 8 gates PASS (G8 CSS 14980/14980)
- `pnpm --dir client exec vite build`: built OK

No failures came from the merge, so no fixes and no T09 bugs found.
