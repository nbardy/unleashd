# Mobile feature audit — 2026-08-18

Triggered by a user report that mobile had no "new" button on convos, buddies, or
swarms. That turned out not to be a CSS bug but a **whole missing capability
class**: mobile v1 shipped read-only. Widening the search found more of the same
shape, plus two silent-failure mechanisms that hide broken UI from every
automated check the repo has.

Method: three parallel read-only sweeps (conversation view, nav/pages, dead
controls + browser-API hazards), each cross-checked against the running app at a
375×812 viewport. Findings below are marked **FIXED** (landed in this change),
**CONFIRMED** (verified, not fixed), or **SUSPECTED** (needs a device or server
check).

---

## The two silent-failure mechanisms

These matter more than any single finding, because they are why so much broken UI
survived to production. Neither TypeScript, Biome, nor the browser reports them.

### M1 — an undefined CSS custom property renders as *unset*, not as an error

`--accent` was referenced by ~15 mobile rules and defined nowhere: `index.css`
defines `--accent-primary`, `--accent-user`, … but never a bare `--accent`. Every
one of those rules silently resolved to transparent/inherited. The unread "New"
badge and all mobile focus rings had been invisible for their entire existence.

**FIXED** — defined in `client/src/index.css` as an alias of `--accent-primary`.
Guarded by `client/test/css-tokens.test.ts`. Verified the guard fails when the
definition is removed.

The same sweep found **11 more undefined tokens in the desktop tree**
(`--theme-base0`, `--theme-base01`, `--theme-base02`, `--theme-base03`,
`--theme-base1`, `--theme-green`, `--theme-red`, `--theme-violet`,
`--theme-yellow`, `--font-xs`, `--text-dim`) across `MergeModal.css`,
`MergeProgressStrip.css`, `Sidebar.css`, `SwarmAnalytics.css`, `TurnStatus.css` —
Solarized-era names orphaned when `index.css` moved to semantic tokens. Held in a
`KNOWN_UNDEFINED` ratchet. **CONFIRMED, not fixed** (they need per-component
colour decisions).

### M2 — a `className` with no CSS rule renders as unstyled default HTML

Found via `.mobile-markdown`, which `MessageRow.tsx` has always set and which no
stylesheet ever defined — so every mobile message body rendered as raw HTML: no
code chips, no `pre` frames, no list indentation.

**FIXED** for `.mobile-markdown`. Guarded by `client/test/css-classes.test.ts`.

The guard then exposed a much larger problem: **86 mobile classes have no CSS at
all.** Almost the entire mobile buddy-detail tree (`BuddyDetailMobile` and its
Work/Chats/Memory/Autos tabs, `BuddyDetailProfileEditor`) was written against a
stylesheet that was never authored. Visually confirmed: unconstrained heading
sizes, and labels running into values — "Reports to **Owner**0 skills", "Last
run8/5/2026, 2:17:28 AM", "Primary next action**Review the 11…**".

**FIXED in round 2** (see below) — all 86 styled across `mobile-controls.css`,
`mobile-buddy.css` and `mobile-swarm.css`; `UNSTYLED_BASELINE` is now empty and
the ratchet remains. This turned out to be the actual cause of the separately
reported "buddy page is missing features": the actions were wired all along and
simply did not render as controls.

---

## Fixed in this change

| # | Finding | Cause |
|---|---|---|
| **F1** | No "+ New" on Chats / Swarms / Buddies | Never implemented. `MobilePage` had an unused `headerAside` slot; empty states told the user to go use desktop. |
| **F2** | Buddies page hid the create button in the state that needed it most | `BuddiesMobile` early-returned a bare div for loading/error/empty, bypassing `MobilePage` and therefore the header. |
| **F3** | `crypto.randomUUID is not a function` on every creation path | Secure-context-gated API. Undefined over `http://<lan-ip>`, defined on `localhost` — so it worked in dev and broke on the phone. |
| **F4** | Conversation view had no usable text input | `ChatMobile` sized itself `height: 100dvh` inside a scrollport that is `100dvh − tab-bar`. The composer sat 57px below the fold, hit-tested by the tab bar; `overscroll-behavior: contain` on the message list blocked scroll chaining, so it was unreachable. On a notched PWA it was 0px visible. |
| **F5** | No way to type a newline on a phone | `ComposerMobile` intercepted bare Enter to send, and the hint read "Shift+Enter for newline" — a binding no soft keyboard has. |
| **F6** | Interrupt-with-a-message unreachable | Stop *replaced* Send during a turn; interrupt existed only via the Enter key. With F5 fixed, that path would have vanished entirely. |
| **F7** | No fork control on mobile | Never implemented. |
| **F8** | Mobile drafts died on every navigation | `ComposerMobile` held the draft in `useState` only. This also made F7 half-broken: fork seeds `draft:<new id>` and nothing read it. |
| **F9** | Double-counted safe-area inset | `ComposerMobile` added `env(safe-area-inset-bottom)` on top of the tab bar's own inset, compounding F4 on notched devices. |
| **F10** | Chat and buddy conversations drifting apart | Extracted `ConversationView`; `ChatMobile` is now a 15-line wrapper. Fork and transcript logic moved to `atoms/fork-actions.ts` + `utils/conversation-transcript.ts`, now shared with desktop `Chat.tsx`. |

---

## Confirmed, not fixed — ranked

### Blocks a workflow

1. **Mobile buddy automations call routes that do not exist.**
   `BuddyDetailAutomationsTab.tsx:70,86` build `/api/buddies/:buddyId/automations/:id/run`
   and `PATCH /api/buddies/:buddyId/automations/:id`. The server registers only
   `GET`/`POST` on `/api/buddies/:buddyId/automations`; the item routes are
   *not* buddy-scoped (`server/src/buddies/routes.ts:725,754`). Both buttons are
   dead, and `.catch(() => {})` at `:74`/`:92` swallows the failure — the list
   just refetches unchanged, indistinguishable from success.

2. **Human approvals cannot be resolved on mobile.** Desktop resolves via
   `BuddyAutomationsTab.tsx:81-123`. Mobile never passes `employee.approvals`
   into its Automations tab even though it loads them
   (`BuddyDetailMobile.tsx:130`). An approval gate clearable only from a desktop
   is a hard stop for human-in-the-loop work.

3. **`AskUserQuestion` options are decorative on desktop, absent on mobile.**
   `AskUserQuestion.tsx:60,82-90` — tapping an option toggles a local `useState`
   and highlights it. Nothing is ever sent. The user believes they answered; the
   agent waits forever. Mobile renders the options as a plain `<ul>`
   (`MessageRow.tsx:143-169`), so there is **no way to answer at all** from a
   phone.

4. **Hardcoded `expectedRevision: 0`.** `BuddyDetailConversationsTab.tsx:103`
   sends `0` into a strict optimistic-concurrency check
   (`config-service.ts:359`), so "Apply effort" fails on any conversation whose
   config ever changed — with no error shown, because the mobile tree never
   reads `pendingConfigCommandsAtom`.

### Silent wrong behaviour

5. **`navigator.clipboard` is secure-context-gated — same class as F3.**
   `Chat.tsx:558` calls `writeText` unguarded with no `try/catch`: over a LAN IP
   it throws, and the copy button silently never flips to its confirmed state.
   `VirtualizedMessageList.tsx:350` catches but only `console.warn`s. **This is
   the one remaining instance of the bug the user reported.** Recommend a
   `utils/clipboard.ts` with an `execCommand` fallback, plus a G5 gate mirroring
   G4.

6. **Mobile provider picker is ungated and swallows rejections.** Desktop
   computes `canChangeHarness` and renders a static badge when a conversation is
   running or has history, mirroring the server's `provider_locked` rejection
   (`config-service.ts:114,124`). `ProviderModelPickerMobile.tsx:59` renders an
   always-live picker and subscribes to no error channel: the tap is rejected
   and the UI shows nothing.
   → **Half fixed in round 2**: `ConversationView` now subscribes to
   `pendingConfigCommandAtomFamily` and renders the rejection, so the failure is
   no longer silent. The picker is still *ungated* — it offers changes the
   server will refuse rather than disabling them up front.

7. **Send while disconnected wedges the mobile composer.**
   `sendAcknowledgedMessageCommand` (`actions.ts:272-282`) resolves only on a
   server ack; if the socket is not OPEN, `useWebSocket.ts:110` only
   `console.warn`s and the promise never settles. The button sticks on `…`,
   disabled, with no error — and `ComposerMobile` never reads `wsStatusAtom`,
   unlike `NewConversationSheet`. Likely on iOS after backgrounding the PWA.

8. **`SwarmsMobile` passes `null` for the runtime snapshot**
   (`SwarmsMobile.tsx:78`), so running counts fall back to `conv.isRunning`.
   Non-Claude-harness swarms read "idle" on mobile and "running" on desktop.

9. **`FilePreview` only treats `localhost` as local**
   (`FilePreview.tsx:70-72`). Over a LAN IP or tailscale host, inline image and
   markdown previews silently stop rendering. Compare against
   `window.location.host` instead.

### Missing capability

10. **No per-row actions on the mobile inbox.** Desktop rows offer mark-done,
    un-done, stop/end, promote-worker, new-conversation-in-folder, and
    folder-scoped search. Mobile rows are tap-to-open only. Notably the mobile
    inbox *renders* a Done badge it can never set or clear, and does not filter
    done items out — so they accumulate with no way to clear them. Structural
    cause: `MobileCardButton` makes the entire row a `<button>`, so no nested
    control can be added without changing the primitive (swipe actions or a
    long-press sheet).
11. **No file/image attach on mobile** — the device with the camera is the one
    that cannot attach a photo. Desktop has dropzone + paste + button
    (`Chat.tsx:315,426,1160`).
12. **No queue management** — mobile shows a count only; cancel-one
    (`actions.ts:293`) and clear-all (`:297`) have no mobile caller.
13. **No tool-call collapsing on mobile.** Desktop folds runs into an
    accordion (`VirtualizedMessageList.tsx:173,946`); mobile renders every
    `🔧 mcp__…` as a full-height block with its own timestamp. Combined with no
    virtualization (an accepted tradeoff) this produced a measured 43,000px
    transcript.
14. **Buddy Builder dead-ends on mobile.** `createBuddyViaBuilder` routes into a
    Builder thread, but `BuddyBuilderResultCard` — which carries the button that
    completes creation — is desktop-only. You can start a buddy on a phone and
    never finish it.
15. **No settings, theme/palette, or usage surface on mobile.** `ConfigDropdown`
    mounts only in `ShellDesktop.tsx:31`. Palette choice is shared with desktop
    and unchangeable from a phone.
16. **No persistent WS status indicator on mobile** — a phone with a dead socket
    just stops responding.
17. **Mobile inbox capped at 50** (`CHAT_INBOX_LIMIT`) with no "show more"; the
    only escape is Search.
18. `/workers/analytics` **has no inbound link on either tree** — two built
    pages reachable only by typing the URL. `/done` likewise, and its mobile
    factory omits the filter the route exists for, so it would render *all*
    conversations with no header (`App.tsx:123`).
19. **No sub-agent panels on mobile** — `MessageRow` declares and renders a
    `subAgents` prop that no caller passes. Dead branch.
20. **Unguarded `localStorage` writes** on the creation path
    (`pending-creations.ts:170`) and in a `setPendingFiles` updater
    (`Chat.tsx:295`) — a quota error takes down conversation creation. Only
    `atoms/ui.ts` wraps its storage access. Recommend a `utils/storage.ts` + G6
    gate.
21. **Errors swallowed with no surface**: file upload (`Chat.tsx:299`,
    console-only), settings/palette persistence (`settingsStore.ts:300,324,343`
    — theme reverts on reload with no explanation).
22. **`ⓘ Project stats` has no `onClick`** (`SwarmDetail.tsx:1031`); its panel
    opens on `:hover` only, so it is dead on touch and for keyboard users.
23. **Capability gates that render nothing with no explanation** —
    `canChangeHarness`, `supportsDynamicModels`, `resolvedModel?.reasoning`, and
    merge-mode all simply omit their control. `MergeModal.tsx:80-93` is the good
    pattern to copy: show a disabled control with the reason.
24. **Dead code**: `AgentAuditOverlay.tsx` (never imported),
    `useLocalStorage.ts` (no consumers, unguarded `JSON.parse`),
    `deleteConversation` (`actions.ts:241`, zero callers in either tree —
    neither tree can delete a conversation from the UI).

### Suspected

25. **Outside-tap dismissal uses `mousedown` only**
    (`ProviderModelPickerMobile.tsx:29`). iOS may not synthesize it reliably for
    taps on non-interactive elements, leaving the dropdown stuck open.
    `pointerdown` is a one-word fix that is correct either way. Not reproducible
    in desktop emulation.
26. **iOS WebSocket recovery after backgrounding.** `useWebSocket.ts:78-83`
    reconnects only from `onclose`, with no `visibilitychange` check (unlike
    `usePolledFetch`). If iOS suspends the socket without firing `onclose`, the
    app can sit in a stale `connected` state.
27. **`color-mix(in oklch, …)` floors the app at iOS Safari 16.2.** It underpins
    the entire token system; below that, the desktop tree loses nearly all
    colour. Vite targets Safari 16, so only 16.0–16.1 sits in the gap.
28. **Mid-turn model changes** — both trees leave the model picker enabled while
    running; whether the server accepts that needs a read of `config-service`.

---

## Assumptions made while fixing

- **Enter now inserts a newline on mobile; the button sends.** Inverts the
  desktop binding, matching Messages/WhatsApp. A hardware keyboard still gets
  Cmd/Ctrl+Enter. Without this there was no way to type a second line.
- **The create sheet does not offer a provider picker.** The catalog default is
  used and `ConversationView`'s header picker changes it before the first
  message — the only point where it matters.
- **Fork is the soft-handoff fork** (new conversation + transcript draft +
  `resumedFromConversationId`), not the merge/provider-session fork. Desktop
  `Chat.tsx` now calls the same shared action.
- **`--accent` aliases `--accent-primary`.** It was undefined; the TSX fallbacks
  that already existed used a similar purple.
- **The 86 unstyled classes and 11 undefined desktop tokens are recorded, not
  fixed.** Both need per-component design decisions well outside this change.

---

## Guards added

| Gate | Enforces |
|---|---|
| `check-client-invariants.sh` **G4** | No bare `crypto.randomUUID` outside `utils/ids.ts` |
| `client/test/css-tokens.test.ts` | No new undefined `var(--x)`; mobile held to zero debt |
| `client/test/css-classes.test.ts` | No new `className` without a CSS rule |
| `pnpm test:client` | Newly wired into `pnpm test` — `client/test/` held 19 passing tests that no script ran |

**Recommended next**: a G5 gate for bare `navigator.clipboard` and a G6 for bare
`localStorage`, both the identical shape to G4 and both live bugs today. Also
worth adding: a layout assertion that the composer's rect lies inside
`.mobile-content`'s rect at 375×812 — that single check would have caught F4.

---

## Round 2 — second batch of user-reported issues

### Fixed

| # | Reported | Actual cause |
|---|---|---|
| **R1** | Conversation header too fat; model chips stack into rows | Three always-visible dropdown chips (`ProviderModelPickerMobile`) wrapped onto 2–3 rows on a 375px screen. Replaced with a single compact label (`idle · Claude Opus 5 ▾`) opening `ModelSheetMobile`. Header **110px → 62px**. |
| **R2** | New plain conversation lands on "Conversation not found"; buddy conversations fine | `ConversationView` rendered "not found" whenever `conversationAtomFamily` was empty. A client-created conversation lives only in `pendingCreationsAtom` until the server acks it over WS — so the window between navigate and ack always showed the error. Buddy threads dodged it because `POST /api/buddies/builder` creates the conversation **server-side** and broadcasts it before returning, so it is already in `conversationsAtom` when the route changes. Now mirrors `Chat.tsx`: a pending creation renders a "starting…" pane with an inert composer, and "not found" is claimed only once `conversationLoadCompleteAtom` is true and there is no pending creation. Creation errors surface in-pane instead of masquerading as a deleted conversation. |
| **R3a** | Tapping the chat box zooms the viewport and clips send | iOS Safari auto-zooms any focused input under 16px. The composer was 14px. Now 16px — the one value that disables it. Locked in with a comment; `mobile-controls.css` inputs are 16px for the same reason. |
| **R3b** | Send button clipped / overlapping | The button was a **sibling** of the textarea, so the zoom pushed it past the right edge. It is now a 36px circular icon button **inside** the rounded composer box, with Stop as a second circle when a turn is running. |
| **R3c** | Composer should float just above the keyboard | New `useKeyboardInset()` publishes `--mobile-keyboard-inset` from `window.visualViewport`. iOS shrinks only the *visual* viewport on keyboard open, so a `100dvh` shell leaves the composer underneath it. The shell is now `calc(100dvh - var(--mobile-keyboard-inset, 0px))` and the tab bar hides while the keyboard is up. Verified at a simulated 300px keyboard: shell 812→512px, composer and send both above the keyboard line. |
| **R4** | Buddy page has no new/resume conversation and no sub-buddies | **The features were already implemented and wired.** `talk()` (new) and `openProjectConversation()` (resume) exist in `BuddyDetailMobile.tsx`, and direct reports were rendered. They were invisible because the entire buddy-detail tree is one of the 86-unstyled-class casualties from M2 — `.mobile-cta` had `min-height: 0` and no background, so primary actions did not read as buttons. Fixed by writing the missing stylesheets. Sub-buddies additionally promoted from inline links crammed in the meta row (they ran together as `3 reports: AliceBobCarol`) to a labelled section of tappable pills. This matters because the Buddies directory lists `topLevel` only — tapping through a manager is the **only** route to a sub-buddy. |
| **R5** | Conversation page spacing off | Header/messages/composer now sum to exactly the pane height (62 + 626 + 67 = 755) with no overflow and no dead space. Composer safe-area double-count removed in round 1. |
| **R6** | Footer/chat box too fat and too bubbly; cut helper text | Composer trimmed **67px → 53px**: box radius 22px (pill) → 10px, input `min-height` 36→30px, buttons 36→30px, padding tightened throughout. The `{n} queued` line was removed — the last standing helper text in the footer (the "Enter to send · Shift+Enter" hint had already gone with R3/F5). Queue depth still reaches the user through the send button's label and `title` ("Queue"). `font-size` stayed at **16px**: it is the iOS auto-zoom threshold from R3a, so height came out of padding instead. |
| **M2 (round 1)** | 86 unstyled classes | **All 86 now styled** across three new stylesheets: `mobile-controls.css` (shared `mobile-cta` / `mobile-link` / `mobile-badge` / `mobile-field` / `mobile-pre` …), `mobile-buddy.css`, `mobile-swarm.css`. `UNSTYLED_BASELINE` is now empty and the ratchet stays to catch the next one. |
| — | (found while fixing) Mobile config errors invisible | `ConversationView` now subscribes to `pendingConfigCommandAtomFamily` and renders rejections. Previously a rejected provider/model change closed the picker and silently reverted — audit item #6 from round 1. |

### Notes on R4

The research pass confirmed mobile's `talk()` builds its `buddyContext` through `buildBuddyContextForTalk` and derives provider/model/reasoning from the buddy record exactly as desktop does, so no behavioural change was needed — only visibility. Two related defects were confirmed but **not** fixed, since they are pre-existing and orthogonal:

- `BuddyDetailConversationsTab.tsx:103` still hardcodes `expectedRevision: 0` (round-1 item #4). It fails on any conversation whose config was ever changed, silently.
- The same tab's `available` check tests only whether a link *carries* an id, never whether the conversation still exists — so a stale buddy link still lands on "Conversation not found". The `availableIds` Set already exists one level up in `BuddyDetailMobile.tsx` and just needs threading.

### Assumptions

- **Model selection moved into a modal.** The header shows `<status> · <model> ▾`; everything else is one tap away. Provider, model and reasoning are all in the sheet, values passed through verbatim.
- **The tab bar hides while the keyboard is up.** It and the composer were competing for the same ~56px. Matches the reference app behaviour.
- **`.mobile-cta` is a 44px pill.** These are primary touch actions; the previous rendering had no minimum height at all.
- **Swarm detail/analytics styling was included** even though this batch did not ask for it — the same undefined-class bug covered both trees, and fixing only half would have left the ratchet non-empty.
