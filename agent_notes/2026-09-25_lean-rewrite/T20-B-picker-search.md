# T20-B: config picker + search (one view tree)

Status: DONE. Worktree `lane-t20-picker`, branch `refactor/t20-picker-search`.
Commits: `7d874b7` (picker), `f35501c` (search). Not merged, not pushed.
Checks run at each commit with a clean tree: `pnpm typecheck` 0, `pnpm test:client`
173/173, `check-client-invariants` 8/8 (CSS_LINE_CEILING 14704 -> 14544).

## Lines (added / removed across the files involved)

| | TS/TSX before -> after | CSS before -> after |
|---|---|---|
| Config picker | 625 -> 564 (-61) | 245 -> 238 (-7) |
| Search | 704 -> 521 (-183) | 378 -> 225 (-153) |
| Total client/src | +1550 / -1954 = **-404** | |

TSX "before" = deleted files plus removed blocks in Chat.tsx, Sidebar.tsx, ConversationView.tsx.

## Config picker (`client/src/views/config/`)
- `config-options.ts`: pure option list and grouping (`configGroups`, `withModel`, `modelSummary`).
  Each choice carries its full `next` config, with dependent intent reset (provider -> defaults;
  a model without the current effort -> reasoning default).
- `ConversationConfigPicker.tsx`: one radio-group renderer. The `inlineDefaults` boolean became
  `defaults: 'listed' | 'inline'`. The unused `showProvider` prop was dropped.
- `ConfigOverlay.tsx` takes `presentation: 'popover' | 'sheet'`. Chat header uses popover
  (click-outside/Esc, stays open). ConversationView uses sheet (showModal, a pick closes it, and
  typing a custom model id does not).
- Deleted: `components/ConversationConfigPicker.tsx`, `mobile/components/ModelSheetMobile.tsx`,
  the popover CSS in Chat.css, the option CSS in Sidebar.css and mobile-ui.css.
- Import-line-only edits in `buddies/ChannelComposer.tsx` and `buddies/HarnessPicker.tsx`.
  HarnessPicker also imported the old path, so it needed the same edit.
- `ConfigDropdown` was left alone. It is the desktop settings/status menu (palette, usage), not a
  model picker, so it belongs to the shell.
- Legacy class hooks `new-conv-label`, `provider-selector`, `model-selector`, `custom-model-option`
  stay on the picker markup because `ChannelComposer.css` (channel lane) targets them. The
  follow-up is to retarget to `config-picker__*` and drop them.

## Search (`client/src/views/search/`)
- `SearchView presentation: 'palette' | 'page'` over one ranking: Buddies, then local conversations
  (fuzzyMatch, optional folder scope), then message history grouped per conversation.
- `search-model.ts`: `historySearch` is a keyed `usePolledFetch` resource. It replaced two bare
  fetch-in-effect copies, per the AGENTS rule. Also `groupHits` and `highlight`.
- `mobile/atoms/search.ts` -> `atoms/search.ts` (`searchQueryAtom`, `searchMatchesFamily(folder)`).
- `mobile/search/SearchMobile.tsx` is now an 11-line MobilePage wrapper.
- Deleted: `components/SearchPalette.tsx/.css`, `mobile/styles/search-mobile.css`.
- docs/mobile-view-tree.md now has a "Shared views" section in place of the old mobile search atom example.

## Tests
- `client/test/config-picker.test.tsx`: model switch resets an unsupported effort; provider switch
  resets; inline defaults fold onto the resolved model/effort; a retired saved model renders
  selected and disabled.
- `client/test/search-view.test.tsx`: renders the page with real atoms and a seeded history
  resource. Hits group per conversation, a hit for a conversation the client lost has no href,
  and highlighting is case-insensitive. A folder-scoped search matches only that folder.

## Visible differences (not screenshot-verified: no server was started, per instructions)
Picker:
- Mobile sheet options are radio pills (same `.ui-choice` look) instead of buttons. The "Provider
  default" meta shows the model display name instead of its id. Tapping the already-selected
  option no longer closes the sheet.
- The mobile sheet header reads "Conversation settings" with a small x, same as desktop.
- Sidebar new-conversation form: options use the plain `.ui-choice` look (no tertiary fill).
  Radios are visually hidden but focusable, so arrow keys work (before they were `display:none`).
- Listed defaults render as "Provider default · <meta>" / "Model default · high" (a muted meta
  span) instead of "Provider default (X)".
- Desktop popover: "Saving…" / errors / "Harness is fixed" are note lines inside the options.
- Behaviour fix: the form and channel composer now also reset an effort the new model lacks.
  Before, only Chat and the mobile sheet did this.
- Mobile still offers every provider (no MCP filter, no harness lock), as before.
Search:
- Desktop palette: when idle it now lists recent conversations (scoped to the folder when opened
  from a folder) instead of "Type at least 2 characters". It adds a local "Conversations" section,
  and history hits are grouped per conversation (up to 3 snippets each) instead of one row per hit.
  Keyboard: up/down/Enter/Esc unchanged.
- Mobile tab: it now includes Buddy matches. Rows use the palette's list look instead of cards,
  and the "N conversations matched" meta line is gone. Debounce is 150ms (was 300). Touch links
  still carry the mobile route state.
- Both: a history hit for a conversation the client no longer holds is dimmed and not clickable.
