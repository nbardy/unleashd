import { useAtomValue } from 'jotai';
import {
  type MouseEventHandler,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  childRowsFamily,
  commandFor,
  connectionAtom,
  detailOf,
  groupsFamily,
  loadCompleteOf,
  messagesOf,
  queueOf,
  rowFamily,
  streamFamily,
  subAgentsOf,
  transcriptFamily,
} from '../../atoms/conversations';
import { forkConversation } from '../../atoms/fork-actions';
import { markMessagesSeen } from '../../atoms/ui';
import { DmChannelsNotice } from '../../components/buddies/DmChannelsNotice';
import { useConversationBodies } from '../../hooks/useConversationBodies';
import { useCopyAction } from '../../hooks/useCopyAction';
import { useProviderCatalog } from '../../hooks/useProviderCatalog';
import { useSavedPrompts } from '../../hooks/useSavedPrompts';
import { useTurnDiagnostics } from '../../hooks/useTurnDiagnostics';
import { SwarmConvoPrefix } from '../../swarm';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { rowBuddy } from '../../utils/conversation-row';
import { type OpenConversation, buildThreadTranscript } from '../../utils/conversation-transcript';
import { shortenHomePath } from '../../utils/directories';
import { buildUnifiedSubAgents } from '../../utils/subAgents';
import {
  shouldPresentTurnAttempt,
  shouldShowTypingIndicator,
  turnDiagnosticsFromAttempt,
} from '../../utils/turn-diagnostics';
import { QueuedMessages } from '../../views/conversation/QueuedMessages';
import { ResumeSource } from '../../views/conversation/ResumeSource';
import { SubAgentPanel } from '../../views/conversation/SubAgentPanel';
import { ComposerMobile } from '../components/ComposerMobile';
import { AssistantResponseRow, MessageRow } from '../components/MessageRow';
import { setConversationConfig } from '../../atoms/commands';
import { ConfigOverlay } from '../../views/config/ConfigOverlay';
import { modelSummary } from '../../views/config/config-options';
import { PromptPaletteMobile } from '../components/PromptPaletteMobile';

/**
 * ConversationView — the one mobile conversation pane.
 *
 * Extracted from ChatMobile so plain chats and buddy conversations render the
 * SAME transcript + composer instead of drifting into two implementations.
 * `ChatMobile` is now a thin route wrapper around it; any buddy surface that
 * wants an inline thread embeds this directly.
 *
 * LAYOUT CONTRACT (this is what made the composer invisible on phones):
 * this component fills its PARENT, it does not size itself to the viewport.
 * It renders inside ShellMobile's `.mobile-content`, which is already
 * `100dvh − tab-bar`. The old `height: 100dvh` here made the pane 56px taller
 * than its scrollport, pushing the composer underneath the bottom tab bar with
 * no way to scroll to it — the message list swallowed the gesture. Keep this
 * `height: 100%` and keep `.mobile-content__inner` a stretched flex column.
 *
 * CREATION STATES: a freshly created conversation exists only in
 * `commandsAtom` (a `create` command) until the server confirms it over WS. Rendering
 * "not found" for that window is wrong — it is the bug that made every new
 * plain conversation look broken while buddy threads (created synchronously by
 * `POST /api/buddies/builder`, so already in `rowsAtom` before the
 * route changes) looked fine. Mirror Chat.tsx: only claim "not found" once the
 * conversation list has finished loading AND there is no pending creation.
 */

/** Message groups mounted on open, and added per "Show earlier" tap. */
const MOBILE_GROUP_PAGE = 30;

/** First shown group index, pinned per conversation (see `groupWindow`). */
type GroupWindow = { readonly conversationId: string; readonly firstShown: number };
/** Matches no conversation, so the first render with history pins a window. */
const UNPINNED_GROUP_WINDOW: GroupWindow = { conversationId: '', firstShown: 0 };

function CopyThreadButton({ conversation }: { conversation: OpenConversation }) {
  const text = buildThreadTranscript(conversation);
  const { state, copy } = useCopyAction(text);
  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy thread';
  return (
    <button
      type="button"
      className="mobile-chat__action"
      onClick={copy}
      title={label}
      aria-label={label}
    >
      {label}
    </button>
  );
}

function ForkButton({ conversation }: { conversation: OpenConversation }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Offered only once the source is loaded (row + detail + bodies).
  return (
    <button
      type="button"
      className="mobile-chat__action"
      title="Fork into a new thread (soft handoff — carries the transcript as a draft)"
      onClick={() => {
        const forkedId = forkConversation(conversation);
        navigate(`/chat/${forkedId}`, { state: mobileConversationRouteState(location) });
      }}
    >
      Fork
    </button>
  );
}

export function ConversationView({
  conversationId,
  backTo,
  onBack,
  headerAside,
}: {
  conversationId: string;
  /** Omit to render no back control (embedded use). */
  backTo?: string;
  onBack?: MouseEventHandler<HTMLAnchorElement>;
  headerAside?: ReactNode;
}) {
  const conversation = useAtomValue(rowFamily(conversationId));
  const dmBuddy = rowBuddy(conversation);
  const transcript = useAtomValue(transcriptFamily(conversationId));
  const detail = detailOf(transcript);
  const messages = messagesOf(transcript);
  const subAgents = subAgentsOf(transcript);
  const { loaded: detailsLoaded, error: detailError } = useConversationBodies(conversationId);
  const streamingText = useAtomValue(streamFamily(conversationId));
  const messageGroups = useAtomValue(groupsFamily(conversationId));
  const totalMessageCount = messages.length;
  const { create: pendingCreation, config: pendingConfigCommand } = useAtomValue(
    commandFor(conversationId)
  );
  const conversationLoadComplete = loadCompleteOf(useAtomValue(connectionAtom).server);
  const childConversations = useAtomValue(childRowsFamily(conversationId));
  const queue = queueOf(transcript);
  const { catalog } = useProviderCatalog();

  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Render window: groups from `firstShown` on mount. The list stays a flat
  // scroller (iOS momentum) instead of a virtualizer, but mounting all of it
  // was the cost — opening a 1,099-message conversation blocked the main
  // thread 1,321ms (4x CPU, 2026-09-25), nearly all markdown parse for turns
  // nobody had scrolled to.
  //
  // The window stores the INDEX of the first shown group, not a count from the
  // end: with a count, every new group unmounted the oldest mounted one, so
  // content above the reader shifted mid-read (Safari has no scroll anchoring).
  // It is pinned the first render the history is present (React's
  // adjust-state-during-render pattern — no effect, no flash of every group)
  // and moved only by "Show earlier". Switching conversations re-pins because
  // the stored id no longer matches.
  const newestPageStart = Math.max(0, messageGroups.length - MOBILE_GROUP_PAGE);
  const [groupWindow, setGroupWindow] = useState(UNPINNED_GROUP_WINDOW);
  if (detailsLoaded && groupWindow.conversationId !== conversationId) {
    setGroupWindow({ conversationId, firstShown: newestPageStart });
  }
  // min(): if the history shrinks below the pinned start, show the newest page.
  const firstShownGroup =
    groupWindow.conversationId === conversationId
      ? Math.min(groupWindow.firstShown, newestPageStart)
      : newestPageStart;
  // Distance from the bottom captured just before "load earlier" grows the
  // window; restored after layout so the reader's place does not jump.
  const bottomOffsetBeforeGrow = useRef<number | null>(null);

  // Prompt palette — shared hook (logic) + mobile sheet (UI). Mirrors Chat.tsx.
  // Owned here so the palette is available at the conversation-pane level:
  // ChatMobile is a thin wrapper and buddy inline threads embed ConversationView
  // directly — owning it here means both get the palette without duplication.
  // The composer remains thin: it only renders save/ palette buttons and forwards
  // selections via prop + custom event bridge.
  const {
    savePrompt,
    prompts: savedPrompts,
    fuzzySearch,
    incrementUsage,
    deletePrompt,
  } = useSavedPrompts();
  const [showPalette, setShowPalette] = useState(false);
  const [paletteSelectedContent, setPaletteSelectedContent] = useState<string | null>(null);

  // Same derivation as Chat.tsx: unified sub-agents + swarm prefix + resume lineage.
  // Reuses shared utils so desktop and mobile cannot drift.
  const unifiedSubAgents = useMemo(
    () => buildUnifiedSubAgents(subAgents, childConversations),
    [subAgents, childConversations]
  );

  // The server sets a swarm prefix only on chats (T09), so no kind check here.
  const visibleSwarmDebugPrefix = detail?.swarmDebugPrefix ?? null;

  const resumedFromConversationId = conversation?.resumedFrom ?? '';
  const resumedFromConversation = useAtomValue(rowFamily(resumedFromConversationId));

  // Mark seen when last message becomes visible (IntersectionObserver plumbing §4)
  useEffect(() => {
    if (messageGroups.length === 0) return;
    const el = lastMessageRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            markMessagesSeen(conversationId, totalMessageCount - 1);
          }
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [conversationId, totalMessageCount, messageGroups.length]);

  // Prompt palette: Ctrl+P / Cmd+P at the pane level (matches desktop Chat.tsx).
  // Owned here so hardware keyboards work even when composer textarea is not focused.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowPalette(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Auto-scroll to bottom on new messages (flat list, not virtualized — iOS momentum)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll if near bottom (avoid fighting user scroll)
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messageGroups, streamingText]);

  const handlePaletteSelect = (content: string) => {
    // Push into composer via prop (primary) + event bridge (fallback if composer remounts)
    setPaletteSelectedContent(content);
    window.dispatchEvent(new CustomEvent('prompt-palette:select', { detail: content }));
    setShowPalette(false);
    // Clear after a tick so repeated same-content selections re-trigger the effect
    setTimeout(() => setPaletteSelectedContent(null), 0);
  };

  // Also scroll to bottom on mount / conversation switch
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId]);

  const showEarlierGroups = () => {
    const el = scrollRef.current;
    if (el) bottomOffsetBeforeGrow.current = el.scrollHeight - el.scrollTop;
    setGroupWindow({
      conversationId,
      firstShown: Math.max(0, firstShownGroup - MOBILE_GROUP_PAGE),
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the window grows
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const offset = bottomOffsetBeforeGrow.current;
    if (!el || offset === null) return;
    bottomOffsetBeforeGrow.current = null;
    el.scrollTop = el.scrollHeight - offset;
  }, [firstShownGroup]);

  // Turn diagnostics — same hook desktop Chat.tsx uses (hooks/useTurnDiagnostics)
  // + same derived view model (utils/turn-diagnostics). Reuses existing atoms
  // and polling, not new state. Must stay before early returns.
  const runtimeIsRunning = conversation?.run === 'running' || conversation?.run === 'streaming';
  const runtimeIsStreaming = conversation?.run === 'streaming';
  const runtimeTurnActive = runtimeIsRunning || runtimeIsStreaming;
  const { attempt: latestTurnAttempt } = useTurnDiagnostics(
    conversationId || undefined,
    runtimeTurnActive
  );
  const turnDiagnostics =
    latestTurnAttempt && shouldPresentTurnAttempt(latestTurnAttempt, runtimeTurnActive)
      ? turnDiagnosticsFromAttempt(latestTurnAttempt)
      : null;
  const showTyping = shouldShowTypingIndicator(runtimeIsStreaming, streamingText ?? '');

  // All hooks above early returns (React hook ordering)
  if (!conversationId) {
    return <div className="mobile-chat__notice">No conversation selected.</div>;
  }

  // A pending creation is a real conversation the server has not acked yet.
  // Showing "not found" here is what made every new plain conversation look
  // broken; buddy threads dodged it only because their POST creates the
  // conversation server-side before the client ever routes to it.
  if (!conversation && pendingCreation) {
    const { workingDirectory, config } = pendingCreation.args;
    const creationError =
      pendingCreation.state.tag === 'rejected' ? pendingCreation.state.message : null;
    const pendingDir = shortenHomePath(workingDirectory);
    return (
      <div className="mobile-chat">
        <div className="mobile-chat__header ui-stack">
          <div className="mobile-chat__titlebar ui-row">
            {backTo ? (
              <Link
                to={backTo}
                replace
                className="mobile-chat__back"
                onClick={onBack}
                aria-label="Back"
              >
                ←
              </Link>
            ) : null}
            <div className="mobile-chat__heading">
              <div className="mobile-chat__dir ui-truncate" title={workingDirectory}>
                {pendingDir}
              </div>
              <div className="mobile-chat__status ui-muted">
                {creationError ? 'creation failed' : `starting ${config.provider}…`}
              </div>
            </div>
          </div>
        </div>
        <div className="mobile-chat__loading">
          {creationError ? (
            <div className="mobile-chat__creation-error" role="alert">
              <p>Could not create this conversation.</p>
              <p className="mobile-chat__creation-error-detail">{creationError}</p>
              {backTo ? (
                <Link to={backTo} replace className="mobile-chat__back-link" onClick={onBack}>
                  ← Back
                </Link>
              ) : null}
            </div>
          ) : (
            `Starting ${config.provider} in ${pendingDir}…`
          )}
        </div>
        {/* Composer stays mounted but inert: the server has no session to
            accept a message for yet, and a queued send would hang forever. */}
        <ComposerMobile
          conversationId={conversationId}
          isRunning={false}
          isStreaming={false}
          queue={[]}
          disabledReason={creationError ? 'Creation failed' : 'Waiting for the server to confirm…'}
          onOpenPalette={() => setShowPalette(true)}
          onSavePrompt={savePrompt}
          paletteSelectedContent={paletteSelectedContent}
        />
      </div>
    );
  }

  if (!conversation) {
    // Genuinely absent — but only once the list has actually finished loading.
    if (!conversationLoadComplete) {
      return <div className="mobile-chat__notice">Loading conversations…</div>;
    }
    return (
      <div className="mobile-chat__notice">
        {backTo ? (
          <div style={{ marginBottom: 12 }}>
            <Link to={backTo} replace className="mobile-chat__back-link" onClick={onBack}>
              ← Back
            </Link>
          </div>
        ) : null}
        Conversation not found. It may have been deleted.
      </div>
    );
  }

  if (!detailsLoaded || !detail) {
    return (
      <div className="mobile-chat">
        <div className="mobile-chat__header ui-stack">
          <div className="mobile-chat__titlebar ui-row">
            {backTo ? (
              <Link
                to={backTo}
                replace
                className="mobile-chat__back"
                onClick={onBack}
                aria-label="Back"
              >
                ←
              </Link>
            ) : null}
            <span style={{ fontSize: 13, fontWeight: 600 }}>{conversationId.slice(0, 8)}</span>
          </div>
        </div>
        <div className="mobile-chat__loading">{detailError ?? 'Loading conversation history…'}</div>
      </div>
    );
  }

  const dirDisplay = shortenHomePath(conversation.cwd);
  const isRunning = runtimeIsRunning;
  const isStreaming = runtimeIsStreaming;
  const open: OpenConversation = { row: conversation, detail, messages };
  const turnActive = isRunning || isStreaming;
  // The live assistant bubble hosts its own working indicator when it has no
  // renderable parts yet; the standalone row below covers every other shape
  // (user-last transcripts, non-empty responses) so the two never double up.
  const lastGroup = messageGroups.length > 0 ? messageGroups[messageGroups.length - 1] : null;
  const liveBubbleHostsWorking =
    !!lastGroup && lastGroup.type === 'assistant' && lastGroup.parts.length === 0 && turnActive;
  // queue already derived via queueAtomFamily before early returns — keeps hook order
  const configSaving = pendingConfigCommand?.state.tag === 'sent';
  const configError =
    pendingConfigCommand?.state.tag === 'rejected' ? pendingConfigCommand.state.message : null;

  const hasThreadContext = unifiedSubAgents.length > 0 || !!conversation.resumedFrom;
  const showSwarmPrefix = !!visibleSwarmDebugPrefix;

  return (
    <div className="mobile-chat">
      <div className="mobile-chat__header ui-stack">
        <div className="mobile-chat__titlebar ui-row">
          {backTo ? (
            <Link
              to={backTo}
              replace
              className="mobile-chat__back"
              onClick={onBack}
              aria-label="Back"
            >
              ←
            </Link>
          ) : null}
          <div className="mobile-chat__heading">
            <div className="mobile-chat__dir ui-truncate" title={conversation.cwd}>
              {dirDisplay}
              {conversation.kind.t === 'builder' && (
                <span className="buddy-helper-kicker"> · Buddy Builder</span>
              )}
            </div>
            <div className="mobile-chat__status ui-muted">
              {/* One compact line: status + model. The model used to be three
                  always-visible dropdown chips that wrapped onto two or three
                  rows on a phone and ate a third of the screen. */}
              {detail ? (
                <>
                  <button
                    type="button"
                    className="mobile-chat__model"
                    onClick={() => setModelSheetOpen(true)}
                    aria-haspopup="dialog"
                    title="Change model"
                  >
                    {modelSummary(detail.config.config, catalog)}
                    {configSaving ? ' …' : ''}
                    <span aria-hidden="true"> ▾</span>
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="mobile-chat__actions ui-row">
            {headerAside}
            <CopyThreadButton conversation={open} />
            <ForkButton conversation={open} />
          </div>
        </div>

        {/* Config rejections were previously invisible on mobile — the picker
            closed and the label silently reverted on the next server snapshot. */}
        {configError ? (
          <div className="mobile-chat__config-error" role="alert">
            {configError}
          </div>
        ) : null}
      </div>

      {dmBuddy !== null && (
        <DmChannelsNotice
          conversationId={conversation.id}
          buddy={dmBuddy}
          className="dm-channels-notice ui-row ui-muted"
        />
      )}

      {/* Thread-context strip: the same views Chat.tsx renders, in their card presentations. */}
      {(hasThreadContext || showSwarmPrefix) && (
        <div className="mobile-chat__thread-context">
          {unifiedSubAgents.length > 0 ? (
            <SubAgentPanel presentation="cards" subAgents={unifiedSubAgents} />
          ) : null}
          {conversation.resumedFrom ? (
            <ResumeSource
              presentation="card"
              sourceConversationId={conversation.resumedFrom}
              sourceConversation={resumedFromConversation ?? null}
            />
          ) : null}
          {showSwarmPrefix ? (
            <SwarmConvoPrefix
              layout="narrow"
              prefix={visibleSwarmDebugPrefix!}
              swarmId={conversation.kind.t === 'worker' ? conversation.kind.swarmId : null}
            />
          ) : null}
        </div>
      )}

      {/* Flat message list — not virtualized (iOS momentum-scroll, §10 Phase 1),
          but windowed from a pinned first group; see `groupWindow`. */}
      <div ref={scrollRef} className="mobile-chat__messages ui-stack">
        {firstShownGroup > 0 && (
          <button
            type="button"
            className="mobile-chat__load-earlier ui-muted"
            onClick={showEarlierGroups}
          >
            Show {Math.min(firstShownGroup, MOBILE_GROUP_PAGE)} earlier ({firstShownGroup} hidden)
          </button>
        )}
        {messageGroups.length === 0 ? (
          <div className="mobile-chat__empty">
            {conversation.kind.t === 'builder'
              ? 'Describe a Buddy or a whole team, their workspace, and what they should accomplish.'
              : 'No messages yet. Send a message to start.'}
          </div>
        ) : (
          messageGroups.slice(firstShownGroup).map((group, windowIndex) => {
            const index = firstShownGroup + windowIndex;
            return group.type === 'assistant' ? (
              <AssistantResponseRow
                key={group.firstMessageIndex}
                response={group}
                isLast={index === messageGroups.length - 1}
                lastMessageRef={lastMessageRef}
                isLive={turnActive && index === messageGroups.length - 1}
              />
            ) : (
              <MessageRow
                key={group.firstMessageIndex}
                message={group.messages[0]}
                isLast={index === messageGroups.length - 1}
                lastMessageRef={lastMessageRef}
              />
            );
          })
        )}
        {turnActive && !streamingText && !turnDiagnostics && !liveBubbleHostsWorking && (
          <div className="mobile-chat__thinking">Thinking…</div>
        )}
        {showTyping && (
          <div className="mobile-chat__typing" aria-live="polite">
            <span className="mobile-chat__typing-dot" />
            <span className="mobile-chat__typing-dot" />
            <span className="mobile-chat__typing-dot" />
          </div>
        )}
      </div>

      <QueuedMessages presentation="disclosure" conversationId={conversation.id} queue={queue} />

      <ComposerMobile
        conversationId={conversation.id}
        isRunning={isRunning}
        isStreaming={isStreaming}
        queue={queue}
        onOpenPalette={() => setShowPalette(true)}
        onSavePrompt={savePrompt}
        paletteSelectedContent={paletteSelectedContent}
      />

      {modelSheetOpen ? (
        <ConfigOverlay
          presentation="sheet"
          value={detail.config.config}
          onChange={(config) =>
            setConversationConfig({
              conversationId: conversation.id,
              expectedRevision: detail.config.revision,
              patch: { kind: 'replace', config },
            })
          }
          onClose={() => setModelSheetOpen(false)}
        />
      ) : null}

      {/* Prompt palette — mobile sheet, owned at pane level so buddy threads share it.
          Thin UI; logic lives in hooks/useSavedPrompts (same hook desktop uses). */}
      <PromptPaletteMobile
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        onSelect={handlePaletteSelect}
        prompts={savedPrompts}
        fuzzySearch={fuzzySearch}
        incrementUsage={incrementUsage}
        deletePrompt={deletePrompt}
      />
    </div>
  );
}
