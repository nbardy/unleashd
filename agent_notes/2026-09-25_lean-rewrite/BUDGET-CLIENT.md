# Budget pass: client TS (branch refactor/budget-client, a039b77 → ebed334, 6 commits)

| Area (06 §5.1) | Before | After | Budget | Still over, because |
|---|---:|---:|---:|---|
| core (atoms, polled fetch, WS, route state) | 3,572 | 3,404 | 1,680 | atoms already dispatch one handler per message type; the rest is features the plan deletes by owner decision (restart-recovery O4, pending-creation persistence O5, prefetch) and buddy-sidebar (B scope) |
| lib (utils, copy hook) | 1,814 | 1,708 | 1,040 | turn-diagnostics.ts 382 is deleted by the typed failure cause (03 §7 #11), not by a trim |
| views/conversation (Chat, ConversationView, panels, meter, turn diag, restart) | 3,022 | 2,874 | 560 | Chat 793 + ConversationView 520 are still two panes; the budget needs the one-pane merge (06 §2.3, owner O1) |
| views/composer + hooks | 1,821 | 1,761 | 950 | desktop composer lives inside Chat.tsx and ComposerMobile is separate; the `layout` merge is a rewrite |
| shells/mobile | 563 | 499 | 310 | ShellMobile, MobileUI and the list/sheet pages are real shells; nothing left that only re-exports |
| **All client TS** | **31,676** | **31,082** | ~14,090 | −594 lines. Comments moved to the new `docs/client-rationale.md` (668 lines, 29 anchors) |

**Cuts:** removed the re-export modules (components/turn-diagnostics, mobile/atoms/create, and the actions.ts re-exports), 5 dead MobileUI primitives, 2 single-caller helpers (inlined), the ChatMobile file (folded into ConversationView), plus Chat/ConversationView duplication (copy glyphs, back link, dead aliases/guards). The mobile section ladder is now a table: 126 cases checked identical against the old module. Moved 29 long comment narratives to docs; each site keeps a 1–3 line reason plus its guard name.
**Checks at ebed334:** typecheck, test:client 186/186, invariants 8/8, client build all pass. 56b77fd does not build by itself (ChatMobile's delete was staged one commit early; `git reset --soft` to re-split was denied). Pre-existing: 5 biome lint errors.
**Not done (would change behavior or needs a rewrite):** Chat's copy-thread failure shows a submission error where useCopyAction would show a glyph; merging the two conversation panes and composers; moving Gallery's single-caller hooks inline (it adds no net lines).
