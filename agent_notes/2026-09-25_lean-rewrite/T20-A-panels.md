# T20 slice A: conversation-pane panels and queue/turn status

Worktree: `.claude/worktrees/lane-t20-pane`, branch `refactor/t20-conversation-panels`.
Commit: **d049876**. Not merged, not pushed.

## What landed
Each concept is one view under `client/src/views/conversation/`. Chat.tsx and the mobile ConversationView both render it, and the caller picks the variant with a named prop:

| View | Desktop | Mobile | Replaces |
|---|---|---|---|
| `SubAgentPanel` | `presentation="tree"` (+ `workingDirectory`, typed sum) | `"cards"` | components/SubAgentPanel, inline `MobileSubAgentPanel` |
| `ResumeSource` | `"icon"` (header tooltip) | `"card"` | components/ResumeThreadWidget, inline `MobileResumeWidget` |
| `QueuedMessages` | `"list"` | `"disclosure"` | inline queue block in Chat.tsx, mobile/conversations/MobileQueueStrip |
| `TurnStatus` / `TurnStatusView` | `"header"` (was density compact) | `"composer"` | components/TurnStatus + TurnStatusView, TurnStatusMobile body |
| `ContextSection` / `ContextBadge` | — | used by the card presentations | MobileSection/MobileBadge use inside the pane |

Swarm stays quarantined. `swarm/SwarmConvoPrefix` takes `presentation: 'panel' | 'card'`, and core code reaches it only through `swarm/index.ts`. `MobileSwarmPrefix`, `SwarmRow`, `SwarmStat` and their index export are deleted.

The section header, surface and badge CSS moved from `mobile-ui.css` to `ui/primitives.css` as `ui-section__header/__title/__meta`, `ui-surface`, `ui-badge(--active|--accent)`. `MobileUI.tsx` now emits those classes. The mobile-only rules (`mobile-ui-section + mobile-ui-section`, `mobile-ui-card--button`) stay where they were.

## Lines (client/src, git numstat vs 486a2d3)
- TSX/TS: +591 / −869 = **−278**
  - ConversationView 763 → 611
  - Chat.tsx 1018 → 969
  - deleted: MobileQueueStrip 159, MobileSwarmPrefix 175, TurnStatusView 43, and TurnStatusMobile 34 → 9
- CSS: 14704 → **14701**, and CSS_LINE_CEILING was lowered to 14701.
  - Chat.css −124 (queue rules moved out; the dead `.queued-message-item.sending` rules dropped)
  - mobile-ui.css −158 (turn-status, queue and primitive rules moved or merged)
  - new: primitives +56, QueuedMessages.css 170, ContextSection.css 24
  - All former inline `style={{}}` on the mobile panels is now token-based CSS, which G7 checks.

## Checks (on the commit; tree clean after commit)
- `pnpm typecheck` passes.
- `pnpm test:client` passes: 170/170.
- `check-client-invariants` passes: 8/8, G8 at 14701/14701.
- Tests:
  - `conversation-views.test.tsx` (renamed from mobile-queue-presentation) renders each view in both presentations with real props. It checks:
    - the queue never lists the running input;
    - the sub-agent windowing is "live + last 3 finished";
    - the fork source links only when the client holds it.
  - `turn-diagnostics.test.ts` covers the `header` and `composer` presentations.
  - New `views-boundary.test.ts` fails if `views/` imports `mobile/*` or a desktop shell component (ShellDesktop, Sidebar, Gallery, SettingsMenu).

## Visible differences expected (mobile only; desktop should be pixel-identical)
1. **Swarm prefix card.** It now uses the desktop markup and CSS, collapsed by default, with the token row and stat grid wrapping. Mobile gains the worker table, available configs and summary rows, and loses the separate "SWARM DEBUG" section header (the token already carries the title).
2. **"Resumed from" card.**
   - When the source thread is no longer in the client's list, it is not a link and shows "Unavailable" instead of "Open ›" (AGENTS.md availability rule).
   - An unknown source provider shows no badge; it used to fall back to "claude".
3. **Spacing and sizes.**
   - Stacked context panels are spaced by the strip's grid gap (10px) instead of the extra 24px `section + section` margin.
   - Queue items use a 10px gap instead of 8px.
   - The composer turn-status reason truncates at 36ch instead of 32ch.
   - The neutral turn-status color is `--theme-base01` instead of `--text-muted`.
4. **CSS order.** `ui-surface`/`ui-badge` now load first, as primitives. A mobile view rule of equal specificity on the same element now always wins over them. This only matters if a page relied on `mobile-ui-card` beating its own class. No such case was found.

## Notes for other lanes
- **Composer lane:** `mobile/components/TurnStatusMobile.tsx` is now a 1-line delegate to `<TurnStatus presentation="composer">`. I did not edit ComposerMobile. When that lane lands, render `TurnStatus` directly and delete the file.
- **Transcript lane:** `VirtualizedMessageList.tsx` got a single prop, `presentation="panel"`, on `SwarmConvoPrefix`, because the prop is required.
- `docs/mobile-view-tree.md` and `docs/subagent_ui_contract.md` are updated. `docs/mobile-ui.md` still says new primitives stay mobile-only; that line is stale now.
- Bootstrap in a fresh worktree needs `git submodule update --init vendor/agent-cli-tool` first, or it fails with `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`.
- No screenshots were taken, because the rules said not to start a server. Run `pnpm screenshots --baseline` to confirm items 1–3.
