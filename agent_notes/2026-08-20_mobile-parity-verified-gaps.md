# Mobile parity — verified capability gaps (2026-08-20)

Evidence-based diff of the desktop conversation surface against mobile, taken at
`95c1503`. Every ABSENT/PARTIAL row below was read in the source, not inferred.
Fixed items are struck through with the commit that closed them.

## Closed in this pass

- ~~No per-item queue cancel on mobile~~ — `0e22aa1` (MobileQueueStrip).
- ~~No way to queue while a turn runs~~ — `95c1503`. The only send path during a
  turn was `interruptAndSend`, which destroys in-flight progress; desktop offers
  the choice via Tab, unreachable on a soft keyboard.
- ~~Stop did not clear the queue~~ — `95c1503`. Mobile called bare
  `stopConversation`; desktop's only stop affordance is `endConversation`
  (`clear_queue` then `stop_conversation`).

## Still open, ranked by phone impact

| # | Gap | Evidence | Why it matters on a phone |
|---|---|---|---|
| 1 | **No inline file preview** | desktop `VirtualizedMessageList.tsx:436,488,507,530` renders image/html/video/md; no `FilePreview` anywhere under `client/src/mobile/` | "Open the chart the agent just wrote" is unreachable. Arguably the single most phone-relevant desktop affordance missing. |
| 2 | **No mark Done / archive** | `markDone`/`unmarkDone` have zero hits in `client/src/mobile/`; `ConversationListMobile.tsx:63` renders a Done badge it can never set or clear | Inbox is capped at 50 (`CHAT_INBOX_LIMIT`, `atoms/conversations.ts`) and untriageable from the phone; desktop-set Done items still occupy slots. |
| 3 | **No Buddy Builder result card** | desktop `Chat.tsx:867`; no match under `mobile/`. Mobile *can* launch the builder (`BuddiesMobile.tsx:97-101`) | Start the builder on a phone, never get the completion handoff. Not blocking — the buddy still appears under the Buddies tab. |
| 4 | **No per-code-block copy** | desktop `VirtualizedMessageList.tsx:405`; no `CopyButton` under `mobile/` | Worse on touch than on desktop: hand-selecting a long code block is the painful case. Per-message copy exists (`MessageRow.tsx:224`). |
| 5 | **No tool-line collapse / tool-call grouping** | desktop `VirtualizedMessageList.tsx:175,948`; `ConversationView.tsx:710-718` is a flat `messages.map` | Noise, not capability — but noise costs more on a small screen. |
| 6 | **No stop-from-list** | desktop `Sidebar.tsx:1246-1257`; `ConversationListMobile.tsx` has status dots only | Recoverable by opening the thread. |
| 7 | **No scroll-to-bottom button** | desktop `Chat.tsx:887`; mobile auto-scrolls only within ~150px of bottom (`ConversationView.tsx:464-468`) | A scrolled-up user must swipe back manually. |
| 8 | **Static swarm-run line; sub-agent panel lacks swarm link** | `MessageRow.tsx:196-210`, `ConversationView.tsx:172-203` | Navigation shortcut only; `/workers/detail` is reachable via the Swarms tab. |

### Legitimately absent — do not "fix"

Folder grouping / Gallery (Search is the correct mobile idiom), merge mode
(`ShellMobile.tsx:12` — explicitly not in v1), settings/usage/WS-status panel
(desktop admin surface), cwd folder-filter link (no folder-filter view exists on
mobile to link into). `deleteConversation` is exported but called nowhere in the
client on either shell.

### Divergence worth knowing

Mobile shows the provider switcher ungated; desktop gates it on
`canChangeHarness`. The server rejects the change (`runtime.ts:2298`) and mobile
surfaces the error via `mobile-chat__config-error`, so it fails safe — but it
fails *after* the tap rather than disabling the control.

## Process note

`HANDOFF_MOBILE.md` §5 states the rule this audit had to relearn: **verification
means compile + render, not greps** — "the blank-screen stub bug passed every
grep gate and tsc." Everything above is source-verified but **not** render-tested.
The gates and `tsc` passing is not evidence the screen draws. Phases 4 (Tailscale
deploy) and 5 (service worker) remain unstarted: there is no service worker
anywhere in `client/`, and no Tailscale artifacts outside docs.
