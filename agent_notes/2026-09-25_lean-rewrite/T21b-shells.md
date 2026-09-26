# T21b — CSS views and shells (+ T20 leftovers)

Worktree `.claude/worktrees/lane-t21b`, branch `refactor/t21b-css-shells`, base a039b77.

## CSS lines (wc -l, before → after)

| Group | Before (a039b77) | After |
|---|---:|---:|
| `mobile/` (styles + fullscreen-composer) | 1,944 | 1,647 |
| `components/buddies/` | 2,998 | 2,928 |
| `components/*.css` (desktop) | 3,659 | 3,509 |
| `views/` | 2,504 | 2,491 |
| `ui/` | 220 | 282 (+ `.ui-sheet*` primitive) |
| `swarm/` | 1,288 | 1,288 |
| root (`index.css`, `App.css`) | 527 | 525 |
| **Total** | **13,140** | **12,670** (−470) |

`CSS_LINE_CEILING` lowered 13140 → 12670.

## What changed

1. **Shells / width media.** `ShellMobile` root carries `data-device="mobile"`.
   Width `@media (max-width: 768px)` blocks in shared view sheets became
   colocated `[data-device="mobile"] .x` rules: `Transcript.css`,
   `BuddyWorkspaceActivity.css`, `BuddyBuilderResultCard.css`,
   `BuddyConvoHeader.css` (reached on mobile through SwarmDetail →
   VirtualizedMessageList), `App.css` (`.restart-recovery`, rendered by
   ComposerMobile). Blocks in desktop-only sheets were deleted (see pixel list).
   `mobile-controls.css` (29 live lines left) folded into `mobile-ui.css`.
2. **Dead selectors** (each class checked with rg against all TS/TSX; zero
   hits outside CSS): Gallery `.state-badge/.state-indicator/.state-label/.state-idle/.state-running`;
   mobile-controls `.mobile-cta`, `.mobile-badge*` (9), `.mobile-field`, `.mobile-error`, `.mobile-pre`;
   mobile-ui `.mobile-sheet__section-title/__input*/__recent*/__note`;
   mobile.css `.mobile-hub*`, `.mobile-buddy-section__heading`;
   Sidebar `.new-conv-label` (only the picker emitted it; identical to `.config-picker__label`).
   Duplicate: `.mobile-channel .channel-markdown { font-size: var(--fs-post) }` (the view already sets it).
3. **Palette sheet.** New `.ui-sheet`, `__inner`, `__grabber`, `__header`, `__title`, `__close`
   in `ui/primitives.css` (loaded by both trees, after `.ui-card`). PromptPalette's sheet,
   NewConversationSheet and ConfigOverlay's sheet all use it; `.mobile-sheet*` (except
   `.mobile-sheet__error`, a BuddiesMobile page class) and the duplicate
   `.config-overlay--sheet/__inner/__grabber` rules are gone. ConfigOverlay's own frame is
   config-specific (it renders the picker), so it was not reusable as the palette's frame; the
   shared primitive is the CSS, and each caller keeps its own dialog open/cancel logic
   (NewConversationSheet blocks cancel while busy).
4. **Composer classes.** Picker no longer emits `new-conv-label`, `provider-selector`,
   `model-selector`, `custom-model-option`. ChannelComposer.css and NewConversationForm.css
   target `config-picker__label/__group/__custom` at equal specificity.
5. **Palette a11y.** Combobox + listbox (APG activedescendant pattern): input `role=combobox`
   with `aria-controls`, `aria-activedescendant`, `aria-expanded`, `aria-keyshortcuts`;
   results `role=listbox` (tabIndex −1); each row is a real `<button role="option" aria-selected
   tabIndex={-1}>`. The delete button moved out of the option (options may not contain
   interactive content) and is `aria-hidden` + tabIndex −1; ⌘/Ctrl+Backspace is its keyboard
   path. Lint: `useFocusableInteractive` satisfied by tabIndex; `useSemanticElements`
   suppressed per attribute with the reason (a native `<select>` cannot render two-line rows).
6. **Gates.** G3 rewritten to O1: mobile/ ↛ desktop shell, desktop shell ↛ mobile/; the views
   half stays in `client/test/views-boundary.test.ts` (referenced, not duplicated). New G9: no
   width `@media` outside `App.css`, `components/Sidebar.css`, `mobile/styles/*`. Both probed with
   planted violations. Docs: `docs/mobile-view-tree.md`, `docs/mobile-ui.md`, AGENTS.md, the
   tokens.css breakpoint comment.

## Rules whose removal/change can move pixels

- **Stray `}` fixes (visible fixes, not refactors).** Three sheets had an unmatched `}`,
  which makes the browser drop the NEXT rule:
  - `mobile-ui.css` (since 0d7ec84, 2026-08-20): `.mobile-chat__typing, .mobile-composer__typing`
    was dropped, so the mobile typing dots (inline spans with width/height) rendered at
    zero size. They now render as a flex row of dots.
  - `Sidebar.css`: `.status-dot.connected { background: var(--accent-success) }` was dropped;
    the connected dot in ConfigDropdown now turns green.
  - `Chat.css`: trailing `}` at EOF, no effect.
- **Desktop-only narrow-window rules deleted** (only visible when a desktop window is resized
  below 768px after load; a reload at that width picks the mobile tree anyway):
  ChannelBrowser (rail collapse, full-screen thread), BuddiesDashboard (directory/grid stacking),
  Gallery (padding), Chat `.thread-context` padding, ColorPalettePicker (stacked layout).
- **Scope change of converted rules:** they now apply to the mobile tree at any width
  (e.g. iPad rotated to landscape after load) and no longer to a narrowed desktop window.
  Specificity rose by one attribute; no competing rule sat in between (checked).
- **Palette rows:** row padding moved onto the option button (so the whole row stays
  clickable) and the delete button is a sibling of the option; when it appears the option
  (usage count and preview) shrinks by 20px + gap, where before only the header row did.
- **Sheets:** `.mobile-sheet *{box-sizing}` dropped (the global `*` rule in App.css already
  sets it; only `::before/::after` lost it, and no sheet uses them). `.prompt-palette--sheet`
  max-height 72vh now wins deterministically (it depended on chunk order before).

## Not done / notes

- `swarm/SwarmDashboard.tsx` imports `mobile/components/NewConversationSheet` (feature →
  mobile shell). O1 forbids it; left for the TS lane since it is not a className change.
  G3 does not cover `swarm/`.
- `mobile-channels.css` still restyles `.channel-composer*` inside `.mobile-channel`
  (visible, pane-specific tweaks); moving them needs a composer `layout` variant.
- 340px breakpoint is allowed by G7 but unused now.

## Commits

- 4965dc2 refactor(client): T21b shells own width media; ui-sheet primitive; palette a11y
  (tree clean at commit; typecheck, test:client 186/186, invariants 9/9 green)
