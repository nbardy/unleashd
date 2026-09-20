# Shared appearance and mobile composition — 16 September 2026

The owner requested a common restrained appearance across desktop/mobile, and an editor that uses the space above the phone keyboard without competing controls and repeated status.

Implemented:

- `client/src/index.css`: one `--ui-radius: 2px` token. CSS corner declarations throughout both shells now consume it; percentage geometry such as spinner rings stays intact. Mobile inline corner styles consume it too.
- `client/src/ui/controls.css`: common `.ui-choice` typography, selection, hover, disabled and focus appearance used by both model pickers. Mobile retains 44px targets and a bottom-sheet presentation.
- Mobile composer: full-width input, actions on a separate bottom row, secondary tools behind +. Focus gives the editor the available pane; Done returns to reading. Stop, Queue and Interrupt/Send retain the existing action paths.
- Turn diagnostics appear once. The pending-queue disclosure excludes the current sending input, fixing the simultaneous running/queued presentation.
- Explicit `[hidden]` tab-bar styling fixes `display:flex` overriding the browser's hidden rule. Keyboard mode uses measured visual viewport height directly.

## Evidence

| View | Before | After |
|---|---|---|
| Mobile chat | [Before](chat-before.png) | [After](chat-after.png) |
| Mobile model picker | [Before](picker-before.png) | [After](picker-after.png) |
| Focused composer | — | [390×480](composer-focused.png), [320×440](composer-320.png) |
| Desktop picker | — | [Shared appearance](picker-desktop.png) |

Validation: client `tsc -b`, all six client invariant gates, and 12 focused queue/CSS tests pass. New rendered queue regression verifies that a sending input is not labeled queued and pending input remains inspectable/cancellable. Browser error list was empty.

Responsive geometry: at 320×440 the input was 304×278px, action row bottom 432px, with no horizontal overflow. A simulated visual-viewport resize from an 844px layout viewport to 480px produced exactly a 480px shell and composer bottom, with the tab bar hidden. Native iPhone keyboard behavior still needs a device check; desktop viewport simulation is not a native-keyboard test. Screenshot draft was local test text, cleared without sending.

Changes remain uncommitted in the existing shared working tree. No conversation configuration, queue, running turn, or automation was changed during browser checks.
