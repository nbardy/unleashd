# T20 slice E: transcript rows and composer

Worktree: `.claude/worktrees/lane-t20-composer`, branch `refactor/t20-transcript-composer`.
Commits: **5f437e5** (rows), **f60a672** (composer). Not merged, not pushed.

## What landed

| View | Desktop | Mobile | Replaces |
|---|---|---|---|
| `views/transcript/TranscriptGroup` | `presentation="hover"` in VirtualizedMessageList | `"footer"` in ConversationView's windowed list | the row half of VirtualizedMessageList (StandaloneMessage, AssistantResponseBlock, MemoizedMessageContent, VirtualizedGroup); mobile `MessageRow.tsx` (deleted) |
| `views/transcript/markdown-components` | — | — | the markdown overrides (code classification, FilePreview links, code-block Copy, LaTeX delimiters), moved out of VirtualizedMessageList |
| `views/composer/PromptPalette` | `"popover"` | `"sheet"` | components/PromptPalette(.css), mobile PromptPaletteMobile (both deleted) |
| `views/composer/ComposerAttachments` + `UploadErrorNotice` | `"chips"` | `"gallery"` | Chat.tsx's inline pending-files strip and upload banner; mobile ComposerAttachments (moved) and its upload banner |
| `views/composer/SendControls` | `"labelled"` | `"icons"` | Chat.tsx's send/interrupt block; ComposerMobile's stop/queue/send buttons |
| `views/conversation/TurnStatus` | — | rendered directly by ComposerMobile | `TurnStatusMobile.tsx` (deleted) |

The list containers stay two (virtual vs windowed). `FullscreenComposer` and the textareas/keyboard contracts stay per tree.
Mobile palette plumbing was simplified: ComposerMobile owns its palette, as Chat.tsx does. The pane-level palette in ConversationView is removed, along with the `paletteSelectedContent`/`onOpenPalette`/`onSavePrompt` props, the `prompt-palette:select` CustomEvent bridge, the duplicate pane-level Ctrl+P listener, and the optional `queue` prop that fell back to an atom read (`queue` is now required).

## Lines (client/src)
- TS/TSX: 33,824 → **33,424** (−400).
  - VirtualizedMessageList 1025 → 293, Chat.tsx 969 → 929, ConversationView 611 → 548, ComposerMobile 503 → 397.
  - Deleted: MessageRow 301, PromptPalette 138, PromptPaletteMobile 199, TurnStatusMobile 9.
  - New: TranscriptGroup 389, markdown-components 393 (mostly moved), PromptPalette 213, ComposerAttachments 152 (82 moved), SendControls 123.
- CSS: 14,636 → **14,478** (−158). CSS_LINE_CEILING was lowered to 14478.
  - Chat.css 1384 → 731, mobile-ui.css 1109 → 780.
  - Deleted: PromptPalette.css 110, composer-attachments.css 78 (moved).
  - New: Transcript.css 593, PromptPalette.css 147, ComposerAttachments.css 162, SendControls.css 110.
  - Deleted mobile rules: `.mobile-markdown*`, `.mobile-message__*`, `.mobile-assistant-response*`, `.mobile-response-activity*`, `.prompt-palette-mobile__*`, `.mobile-upload-error*`, `.mobile-composer__btn--send/--queue/--stop`, `.mobile-composer__stop-glyph`.

## Checks (on each commit; `git status` clean after both)
- `pnpm typecheck` passes.
- `pnpm test:client` passes: 171/171.
  - The tail-regroup and render-isolation tests in `chat-message-groups.test.tsx` now render `TranscriptGroup` in both presentations.
  - New `composer-views.test.tsx` is a regression guard: while a turn runs, both composers keep a non-destructive queue path (the mobile Queue button, the desktop Tab hint).
  - `swarm-quarantine.test.ts` allowlists `views/transcript/TranscriptGroup.tsx`, which is the new home of the `InlineSwarmRunWidget` import.
- `check-client-invariants` passes: 8/8, G8 at 14478/14478.

## Visible differences expected
Desktop should be nearly pixel-identical. The exceptions:
- **Send button label.** It reads "Queue" when idle with messages waiting (the shared label). It used to say "Send".
- **"Tab to queue" hint.** It now shows whenever a turn is active and there is content. It used to need `isStreaming`.
- **Remove chips.** They gain an aria-label.
- **Prompt palette.** Usage reads "used N×" instead of "Nx", the preview ellipsis is "…", and the empty-state copy changed.

Mobile rows now look like the desktop rows (the `@media (max-width: 768px)` rules in Transcript.css were already written for that width):
1. **Layout.** The user message is a right-aligned tinted bubble; it was a full-width raised card. Role labels use desktop styling instead of uppercase 11px. System messages have no role label; they used to read "Assistant".
2. **Markdown styling.** Rows use desktop markdown styling: `.message-content`, with line-height 1.7 at fs-5. It was `.mobile-markdown` at 14px/1.5.
3. **Features mobile gains:**
   - file-path previews and links (tap opens the file; there is no hover thumbnail);
   - a code-block Copy button, always visible via `@media (hover: none)`;
   - `\(..\)` / `\[..\]` LaTeX;
   - remark-breaks (it replaces `white-space: pre-wrap`);
   - inline tool-line collapsing inside prose;
   - the interactive AskUserQuestion widget (it was a static card);
   - the swarm run widget (it was an "Oompa run" label);
   - every message of a non-assistant group (only the first used to render).
4. **Footer.** It keeps the time and Copy pill; the pill now has the copy glyph. The empty live response shows the desktop "Thinking…" with dots.
5. **Palette sheet.** Rows use desktop item markup (name + usage + ×, then preview). Delete stays visible on touch via `@media (hover: none)`. The listbox/option ARIA roles were dropped: the delete button can't live inside an option, and biome rejects the roles on divs.
6. **Upload error banner.** It now uses the desktop styling (bordered, fs-3), on `--theme-danger`.
7. **Composer buttons.** Stop/queue glyph sizing now comes from `.send-controls__icon` (fs-5) instead of inline 15px.

## Features only one tree has (by design)
- **Desktop only:**
  - Tab-to-queue and Enter-to-send;
  - drag-and-drop dropzone overlay;
  - hover-revealed actions;
  - Stop lives in the Sidebar, not the composer;
  - out-of-tokens "Retry with a different harness";
  - DM Channels notice;
  - current-message indicator;
  - Buddy Builder placeholder.
- **Mobile only:**
  - Enter = newline, Cmd/Ctrl+Enter sends;
  - explicit Stop and Queue buttons;
  - palette button in the "+" tools menu;
  - the fullscreen editor (FullscreenComposer) with Done;
  - "Running" / typing indicator in the composer;
  - attachment preview pager;
  - hidden file input instead of the dropzone.

## Notes
- `PromptPalette presentation="sheet"` still uses the mobile `.mobile-sheet*` frame classes, which are loaded by the mobile tree only. When the config lane's shared overlay lands in `ui/`, both frames should move onto it.
- Transcript.css keeps the existing `@media (max-width: 768px)` rules (G7 allows 768px). 06 §2.3 prefers `[data-device=mobile]`, but no such attribute exists yet.
- Coordinator notice (swarm `layout` prop, `views/config`): noted, none of those names were reintroduced. `VirtualizedMessageList` still passes `presentation="panel"` to `SwarmConvoPrefix` as on this branch's base; the merge should switch it to `layout="wide"`.
- No screenshots were taken, because the rules said not to start a server. Run `pnpm screenshots --baseline` to confirm the mobile items above.
