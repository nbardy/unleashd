# Mobile copy-thread + turn diagnostics

Date: 2026-08-20
Branch: mobile-fixes-and-audit-2026-08-18 (base 0d7ec84)

## Objective
Implement missing parity from desktop `Chat.tsx` on mobile:
1. Copy-thread button in `ConversationView` header (near `ForkButton`), reusing `buildThreadTranscript` + `copyText` via `hooks/useCopyAction`, secure-context safe (G5).
2. Turn diagnostics (`useTurnDiagnostics` + `turnDiagnosticsFromAttempt` + `TurnStatus`) wired into `mobile/conversations/ConversationView.tsx` and `mobile/components/ComposerMobile.tsx`, reusing same derived view model, not new state.

Follow `docs/mobile-ui.md` primitives and `docs/client-state.md` (derived atoms, not useMemo for list views). Keep hooks before early returns. G1-G5 must PASS.

## 1. Copy thread

Desktop: `Chat.tsx:40,371,378` builds `threadCopyText = useMemo(() => buildThreadTranscript(conversation), [conversation])` (via `utils/conversation-transcript.ts`, which strips the swarm-debug prefix identically to the display grouping) and copies via `utils/clipboard.ts:copyText` (secure-context guard: `navigator.clipboard` is `undefined` over `http://<lan-ip>`; falls back to `execCommand`). G5 bans bare `navigator.clipboard` elsewhere.

Mobile before: `ConversationView.tsx` had `ForkButton` only, zero usage of `buildThreadTranscript` / `copyText` / `useCopyAction`. The infra was already shared (`atoms/fork-actions.ts` + `utils/conversation-transcript.ts` per `docs/mobile-view-tree.md`), but the header action was absent.

Implementation:
- `client/src/mobile/conversations/ConversationView.tsx:CopyThreadButton`
  ```tsx
  function CopyThreadButton({ conversation }: { conversation: Conversation }) {
    const text = buildThreadTranscript(conversation);
    const { state, copy } = useCopyAction(text);
    const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy thread';
    return <button className="mobile-chat__action" onClick={copy}>{label}</button>;
  }
  ```
  - Imports `buildThreadTranscript` from `utils/conversation-transcript` (shared, byte-identical to desktop, includes `effectiveSwarmDebugPrefix` strip) and `useCopyAction` from `hooks/useCopyAction` (which internally calls `copyText` and owns `idle|copied|failed` + auto-reset). No direct `navigator.clipboard` touch, so G5 PASS.
  - Rendered in header actions alongside `ForkButton`:
    ```tsx
    <div className="mobile-chat__actions">
      {headerAside}
      <CopyThreadButton conversation={conversation} />
      <ForkButton conversation={conversation} />
    </div>
    ```
  - 44px-tappable via existing `.mobile-chat__action` (36px min-height + padding, `mobile-ui.css`), quiet secondary pill — does not compete with per-message `.mobile-message__copy` (which already reuses `useCopyAction` in `MessageRow.tsx`).

Primary commit: `26dd96f feat(mobile): share copy-thread via buildThreadTranscript + useCopyAction`.

## 2. Turn diagnostics

Desktop: `Chat.tsx:37,131,183` uses
```ts
const { attempt: latestTurnAttempt } = useTurnDiagnostics(id, runtimeTurnActive);
const turnDiagnostics = latestTurnAttempt && shouldPresentTurnAttempt(latestTurnAttempt, runtimeTurnActive)
  ? turnDiagnosticsFromAttempt(latestTurnAttempt) : null;
```
plus `TurnStatus` (`components/TurnStatus.tsx` → `TurnStatusView.tsx` + `turn-diagnostics.ts: buildTurnDiagnosticsViewModel`) and `shouldShowTypingIndicator(isStreaming, streamingText)` for the three-dot overlay.

Mobile before: zero usage of `useTurnDiagnostics` / `turnDiagnosticsFromAttempt` / `TurnStatus` / `shouldShowTypingIndicator`.

Implementation — share logic, mobile-only rendering (G3):
- Canonical logic moved to `client/src/utils/turn-diagnostics.ts` (382 lines, copied from `components/turn-diagnostics.ts`). `components/turn-diagnostics.ts` now re-exports from `utils/` so desktop `Chat.tsx:54` and `hooks/useTurnDiagnostics.ts` (now importing from `utils/`) stay working while mobile can import without violating G3 (mobile may import `utils/*`, not `components/*`).
- `client/src/hooks/useTurnDiagnostics.ts:3` — import path changed `../components/turn-diagnostics` → `../utils/turn-diagnostics`.
- `client/src/mobile/components/TurnStatusMobile.tsx` — thin mobile variant (not `components/TurnStatus.tsx`, which would violate G3). Same contract:
  ```ts
  export function TurnStatusMobile({ diagnostics, now, refreshIntervalMs=1000 }: { diagnostics: TurnDiagnosticsInput }) {
    const [clock, setClock] = useState(() => now ?? Date.now());
    useEffect(() => { /* isActiveTurnStatus check + interval */ }, [diagnostics...]);
    const view = buildTurnDiagnosticsViewModel(diagnostics, now ?? clock);
    return <output className={`mobile-turn-status mobile-turn-status--${view.tone}`} title={view.title}>…</output>;
  }
  ```
  Reuses `buildTurnDiagnosticsViewModel` / `isActiveTurnStatus` from `utils/turn-diagnostics` — same derived view model, no new state, same 1s refresh for active turns / `lastActivityAt`.

- `client/src/mobile/conversations/ConversationView.tsx`
  - Imports `useTurnDiagnostics`, `shouldPresentTurnAttempt`, `turnDiagnosticsFromAttempt`, `shouldShowTypingIndicator`, `TurnStatusMobile`.
  - Hooks **before early returns** (per `docs/client-state.md` hook ordering):
    ```ts
    const runtimeIsRunning = conversation?.isRunning ?? false;
    const runtimeIsStreaming = conversation?.isStreaming ?? false;
    const runtimeTurnActive = runtimeIsRunning || runtimeIsStreaming;
    const { attempt: latestTurnAttempt } = useTurnDiagnostics(conversationId || undefined, runtimeTurnActive);
    const turnDiagnostics = latestTurnAttempt && shouldPresentTurnAttempt(latestTurnAttempt, runtimeTurnActive)
      ? turnDiagnosticsFromAttempt(latestTurnAttempt) : null;
    const showTyping = shouldShowTypingIndicator(runtimeIsStreaming, streamingText ?? '');
    ```
  - Renders turn status pill below header config error:
    ```tsx
    {turnDiagnostics ? <div className="mobile-chat__turn-status-row"><TurnStatusMobile diagnostics={turnDiagnostics} /></div> : null}
    ```
  - Typing indicator (three bouncing dots, same semantics as desktop `typing-indicator-overlay`):
    ```tsx
    {showTyping && <div className="mobile-chat__typing" aria-live="polite"><span className="mobile-chat__typing-dot"/>×3</div>}
    ```
    Fallback `Thinking…` now hides when a diagnostics pill is present (`!turnDiagnostics`) to avoid double status.

- `client/src/mobile/components/ComposerMobile.tsx`
  - Same hook wiring, independent subscription (so status stays visible when `ConversationView` is not mounted, e.g. embedded buddy thread):
    ```ts
    const streamingText = useAtomValue(streamingAtomFamily(conversationId));
    const runtimeTurnActive = isRunning || isStreaming;
    const { attempt: composerTurnAttempt } = useTurnDiagnostics(conversationId || undefined, runtimeTurnActive);
    const composerTurnDiagnostics = composerTurnAttempt && shouldPresentTurnAttempt(composerTurnAttempt, runtimeTurnActive)
      ? turnDiagnosticsFromAttempt(composerTurnAttempt) : null;
    const composerShowTyping = shouldShowTypingIndicator(isStreaming, streamingText ?? '');
    ```
  - Rendered above pending-files strip:
    ```tsx
    {composerTurnDiagnostics ? <div className="mobile-composer__turn-status"><TurnStatusMobile diagnostics={composerTurnDiagnostics} /></div> : null}
    {composerShowTyping && !composerTurnDiagnostics ? <div className="mobile-composer__typing">…</div> : null}
    ```
  - Double-poll is intentional per task ("wire the same hook into both files"); poll drains via `turnDiagnosticsPollDelay` (2s active, 30s idle, exponential on 404) so idle cost is negligible.

- `client/src/mobile/styles/mobile-ui.css`
  - `.mobile-turn-status` + `--neutral/active/success/warning/danger` + `mobile-turn-status-pulse` (mirrors `TurnStatus.css` but uses `var(--text-muted)` / `var(--theme-*)` and allows wrapping).
  - `.mobile-chat__turn-status-row`, `.mobile-chat__typing`, `.mobile-composer__typing`, bounce `mobile-typing-bounce` with `prefers-reduced-motion` guard.
  - `.mobile-chat__thread-context` placeholder rule so `client/test/css-classes.test.ts` passes (class used in JSX, inline grid layout).

Commits:
- `935567f feat(mobile): prompt palette wiring for ConversationView + composer turn status` — TurnStatusMobile + ComposerMobile + utils re-export + mobile-ui.css.
- Subsequent `Duration` / sub-agent commits kept the wiring intact (rebase kept hooks before early returns).

## Gates & verification

- `bash tools/check-client-invariants.sh` — **G1-G5 PASS** (verified; no `jotaiStore.set` outside `atoms/`, no raw `.buddyContext`, no `components/*` import in `mobile/`, no bare `crypto.randomUUID`, no bare `navigator.clipboard` — copy goes via `copyText`).
- `pnpm test:client` — 24/24 PASS (css-tokens + css-classes + turn-diagnostics). The `mobile-chat__thread-context` rule was added to satisfy `css-classes.test.ts`.
- `pnpm --filter @unleashd/client exec tsc -b && vite build` — **PASS** (906k main, built in 2s). Full `pnpm build` fails on `server/src/lifecycle/shutdown.ts: flushWatchdog` — pre-existing server error unrelated to mobile, not introduced by this change.
- `docs/mobile-ui.md` primitives reused: header actions use existing `.mobile-chat__action` (not a new primitive); turn status is feature CSS, not a new `MobileUI` primitive per restraint.
- `docs/client-state.md` followed: no new `useMemo` list view; turn diagnostics reuses polling hook + derived view model, not per-component `useMemo`. Hooks remain before early returns in both files.

## Files

- `client/src/utils/turn-diagnostics.ts` — new canonical module (shared).
- `client/src/components/turn-diagnostics.ts` — now `export * from '../utils/turn-diagnostics'`.
- `client/src/hooks/useTurnDiagnostics.ts` — import path to `utils/`.
- `client/src/mobile/components/TurnStatusMobile.tsx` — new thin mobile variant.
- `client/src/mobile/conversations/ConversationView.tsx` — copy button + turn diagnostics wiring.
- `client/src/mobile/components/ComposerMobile.tsx` — turn diagnostics + typing wiring.
- `client/src/mobile/styles/mobile-ui.css` — mobile turn-status + typing styles + thread-context placeholder.
- `agent_notes/mobile-copy-turn-impl.md` — this note.

## Risks / follow-ups

- Double polling (ConversationView + ComposerMobile) doubles diagnostics requests per conversation when both are mounted (same `conversationId`). Acceptable per spec, but could be deduped via a shared atom if battery-constrained. Poll interval already backs off to 30s idle.
- `TurnStatusMobile` tone colors use `var(--theme-yellow)` / `var(--theme-green)` with fallbacks; desktop `TurnStatus.css` uses `var(--theme-*)` that are in `KNOWN_UNDEFINED` ratchet (Solarized tokens) — mobile fallbacks keep color even if tokens are undefined, but desktop still renders unset on those tokens.
- `copyText` fallback (`execCommand`) requires a live DOM selection; headless test env returns false → `Copy failed` state is exercised, not silent.
