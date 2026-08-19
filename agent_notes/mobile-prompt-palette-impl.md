# Mobile PromptPalette implementation

## Objective
Wire `useSavedPrompts` hook + `PromptPalette` component into mobile
`ComposerMobile.tsx` / `ConversationView.tsx` without violating mobile view-tree invariants.

## Reference
- Desktop: `client/src/components/Chat.tsx:45,1047` uses `useSavedPrompts` `{savePrompt,fuzzySearch,incrementUsage,deletePrompt}` and renders `<PromptPalette>`
- Mobile had 0 usage: `grep mobile/PromptPalette=0`

## Constraints
- `docs/mobile-view-tree.md`: mobile may import `atoms/*, hooks/*, utils/*, shared/*, components/buddies/*` — never `components/*.tsx`
- Gates G1-G5 must PASS (`bash tools/check-client-invariants.sh`)
- `jotaiStore.set` stays in `atoms/`
- Keep logic in hooks, UI thin

## Decision: duplicate thin wrapper
Per `mobile-view-tree.md` guidance: "either move PromptPalette to a shared location or duplicate thin wrapper, but reuse the hook which is already shared".

Chose **duplicate thin wrapper** at `client/src/mobile/components/PromptPaletteMobile.tsx`:
- Reuses `hooks/useSavedPrompts` (already shared, allowed)
- Duplicates ~80 lines of UI (search, keyboard nav, delete) but adapts to mobile bottom-sheet (`<dialog modal>`) with safe-area padding
- Desktop stays at `client/src/components/PromptPalette.tsx` (centered overlay) — no move, no shared-location refactor
- Import path `../../hooks/useSavedPrompts` + `./PromptPaletteMobile` — G3 stays green (no `components/*` import)

Alternative considered: move `PromptPalette` to `client/src/shared-ui/` or `utils/` — rejected because desktop import would need churn and mobile sheet needs distinct styling (bottom sheet vs centered overlay).

## Wiring

### 1. `PromptPaletteMobile.tsx` (new, 124 lines)
- Props mirror desktop: `isOpen, onClose, onSelect, prompts, fuzzySearch, incrementUsage, deletePrompt`
- Manages `query`, `selectedIndex`, `results = fuzzySearch(query)` (logic in hook)
- `<dialog class="mobile-sheet mobile-sheet--prompt-palette">` — reuses `mobile-ui.css` sheet styles (backdrop, grabber, 72vh max-height, safe-area inset)
- Keyboard: ArrowDown/Up, Enter (incrementUsage + onSelect), Escape, Cmd/Ctrl+Backspace delete
- Focus query input on open via `setTimeout(() => inputRef.current?.focus(), 0)` (same as desktop)

### 2. `ComposerMobile.tsx`
- Owns hook when standalone: `useSavedPrompts()` → save + palette fallback
- Adds buttons in `mobile-composer__actions`:
  - Save: `☆` (`mobile-composer__btn--save`, disabled when `!hasText`) → `savePrompt(draft.trim())`
  - Palette: `☰` (`mobile-composer__btn--palette`) → `onOpenPalette?.() || setShowPalette(true)`
  - Existing Attach/Stop/Send preserved
- Handles `Ctrl+P / Cmd+P` both at window level and textarea `onKeyDown` (matches desktop `Chat.tsx:250`)
- Accepts optional parent delegation props (`onOpenPalette`, `onSavePrompt`, `paletteSelectedContent`) so `ConversationView` can own single hook source
- Fallback palette rendering when `!onOpenPalette` (standalone use, e.g. tests)
- Listens for custom event `prompt-palette:select` and prop `paletteSelectedContent` to update draft via `updateDraft(content)` + textarea height recalc
- Styles appended to `mobile-ui.css` (`prompt-palette-mobile__*`, `mobile-composer__btn--save/palette`)

### 3. `ConversationView.tsx` (pane owner)
- Owns single source hook: `const { savePrompt, prompts, fuzzySearch, incrementUsage, deletePrompt } = useSavedPrompts();`
- State: `showPalette`, `paletteSelectedContent`
- Renders `<PromptPaletteMobile>` at pane level (so buddy inline threads embedding `ConversationView` also get palette — per `mobile-view-tree.md` "One conversation pane, two entry points")
- Window `keydown` listener for `Ctrl+P / Cmd+P` → `setShowPalette(true)` (mirrors desktop)
- `handlePaletteSelect` pushes selection to composer via both prop (`setPaletteSelectedContent`) and event bridge (`prompt-palette:select`), then closes palette
- Passes to `ComposerMobile`: `onOpenPalette={() => setShowPalette(true)}`, `onSavePrompt={savePrompt}`, `paletteSelectedContent`
- Both `ComposerMobile` instances (normal + pending-creation) receive same delegation

## Why pane-owned vs composer-owned
- Logic in hooks: hook stays pure, no `jotaiStore.set` in components (G1)
- Single hook source: `ConversationView` owns `useSavedPrompts`, `ComposerMobile` delegates save via `onSavePrompt` — avoids duplicate `localStorage` state drift (two `useSavedPrompts` instances would diverge until reload)
- Buddy threads: `ChatMobile` is 15-line wrapper, `ConversationView` is the only pane — owning palette here guarantees plain chats + buddy threads share same palette

## Gates
```
bash tools/check-client-invariants.sh
G1 PASS (no jotaiStore.set outside atoms/)
G2 PASS (no raw .buddyContext/.purpose)
G3 PASS (no components/* import in mobile/ except buddies/)
G4 PASS (no bare crypto.randomUUID)
G5 PASS (no bare navigator.clipboard)
```

## Verification
- `grep -rn PromptPalette client/src/mobile` → `ComposerMobile.tsx` + `PromptPaletteMobile.tsx` + `ConversationView.tsx` (3 files, 5 hits, previously 0)
- `grep -rn useSavedPrompts client/src/mobile` → `ComposerMobile.tsx` + `ConversationView.tsx` + `PromptPaletteMobile.tsx` type import (previously 0)
- `pnpm --filter client build` → `tsc -b && vite build` PASS (721 modules, 2.53s)
- Manual: mobile sheet opens via `☰` button and `Ctrl+P`/`Cmd+P` (hardware keyboard), search filters, Enter inserts into draft, `☆` saves current draft, delete via `×` or `Cmd+Backspace`

## Follow-up
- No additional atom needed; palette open state stays local `useState` (no jotaiStore.set)
- If design wants to move `PromptPalette` to shared location later, both wrappers can re-export from `client/src/shared/ui/PromptPalette.tsx` — for now duplicate keeps trees decoupled

