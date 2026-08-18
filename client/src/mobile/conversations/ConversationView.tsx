import type { Conversation } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loadConversationDetails, setActiveConversationId } from '../../atoms/actions';
import {
  conversationAtomFamily,
  conversationDetailsLoadedAtomFamily,
  conversationLoadCompleteAtom,
  pendingConfigCommandAtomFamily,
  pendingCreationAtomFamily,
  streamingAtomFamily,
} from '../../atoms/conversations';
import { forkConversation } from '../../atoms/fork-actions';
import { markMessagesSeen, setSavedActiveConversationId } from '../../atoms/ui';
import { useProviderCatalog } from '../../hooks/useProviderCatalog';
import { ComposerMobile } from '../components/ComposerMobile';
import { MessageRow } from '../components/MessageRow';
import { ModelSheetMobile, modelSummary } from '../components/ModelSheetMobile';

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
 * `pendingCreationsAtom` until the server confirms it over WS. Rendering
 * "not found" for that window is wrong — it is the bug that made every new
 * plain conversation look broken while buddy threads (created synchronously by
 * `POST /api/buddies/builder`, so already in `conversationsAtom` before the
 * route changes) looked fine. Mirror Chat.tsx: only claim "not found" once the
 * conversation list has finished loading AND there is no pending creation.
 */

function ForkButton({ conversation }: { conversation: Conversation }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // A conversation the server has not confirmed yet has no config to fork from.
  const disabled = !conversation.config;

  return (
    <>
      <button
        type="button"
        className="mobile-chat__action"
        disabled={disabled}
        title={
          disabled
            ? 'Waiting for the server to confirm this conversation'
            : 'Fork into a new thread (soft handoff — carries the transcript as a draft)'
        }
        onClick={() => {
          const forkedId = forkConversation(conversation);
          if (!forkedId) {
            setError('Cannot fork yet — conversation is still being created.');
            return;
          }
          navigate(`/chat/${forkedId}`);
        }}
      >
        Fork
      </button>
      {error ? (
        <span role="alert" className="mobile-chat__action-error">
          {error}
        </span>
      ) : null}
    </>
  );
}

export function ConversationView({
  conversationId,
  onBack,
  headerAside,
}: {
  conversationId: string;
  /** Omit to render no back control (embedded use). */
  onBack?: () => void;
  headerAside?: ReactNode;
}) {
  const conversation = useAtomValue(conversationAtomFamily(conversationId));
  const detailsLoaded = useAtomValue(conversationDetailsLoadedAtomFamily(conversationId));
  const streamingText = useAtomValue(streamingAtomFamily(conversationId));
  const pendingCreation = useAtomValue(pendingCreationAtomFamily(conversationId));
  const conversationLoadComplete = useAtomValue(conversationLoadCompleteAtom);
  const pendingConfigCommand = useAtomValue(pendingConfigCommandAtomFamily(conversationId));
  const { catalog } = useProviderCatalog();

  const [detailError, setDetailError] = useState<string | null>(null);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Dual-active-id: ephemeral routing atom `activeConversationIdAtom`
  // (conversations.ts) + persisted `savedActiveConversationIdAtom` (atoms/ui).
  // Cleanup clears only the ephemeral one (preserve persisted truth).
  useEffect(() => {
    if (!conversationId) return;
    setActiveConversationId(conversationId);
    setSavedActiveConversationId(conversationId);
    return () => {
      setActiveConversationId(null);
    };
  }, [conversationId]);

  // Load boundary: gate on conversationDetailsLoadedAtomFamily, lazy HTTP fetch
  useEffect(() => {
    if (!conversationId || !conversation || detailsLoaded) {
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailError(null);
    void loadConversationDetails(conversationId).catch((e) => {
      if (!cancelled) setDetailError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, conversation, detailsLoaded]);

  // Merge streaming at render time — never write messages mid-stream
  const messages = useMemo(() => {
    if (!conversation) return [];
    if (!streamingText) return conversation.messages;
    const msgs = conversation.messages.slice();
    const last = msgs[msgs.length - 1];
    if (last?.role !== 'assistant') return conversation.messages;
    msgs[msgs.length - 1] = { ...last, content: last.content + streamingText };
    return msgs;
  }, [conversation, streamingText]);

  // Mark seen when last message becomes visible (IntersectionObserver plumbing §4)
  useEffect(() => {
    if (messages.length === 0) return;
    const el = lastMessageRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            markMessagesSeen(conversationId, messages.length - 1);
          }
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [conversationId, messages.length]);

  // Auto-scroll to bottom on new messages (flat list, not virtualized — iOS momentum)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll if near bottom (avoid fighting user scroll)
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingText]);

  // Also scroll to bottom on mount / conversation switch
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId]);

  // All hooks above early returns (React hook ordering)
  if (!conversationId) {
    return <div className="mobile-chat__notice">No conversation selected.</div>;
  }

  // A pending creation is a real conversation the server has not acked yet.
  // Showing "not found" here is what made every new plain conversation look
  // broken; buddy threads dodged it only because their POST creates the
  // conversation server-side before the client ever routes to it.
  if (!conversation && pendingCreation) {
    const pendingDir = pendingCreation.workingDirectory.replace(/^\/Users\/[^/]+/, '~');
    return (
      <div className="mobile-chat">
        <div className="mobile-chat__header">
          <div className="mobile-chat__titlebar">
            {onBack ? (
              <button
                type="button"
                className="mobile-chat__back"
                onClick={onBack}
                aria-label="Back to chats"
              >
                ←
              </button>
            ) : null}
            <div className="mobile-chat__heading">
              <div className="mobile-chat__dir" title={pendingCreation.workingDirectory}>
                {pendingDir}
              </div>
              <div className="mobile-chat__status">
                {pendingCreation.error
                  ? 'creation failed'
                  : `starting ${pendingCreation.config.provider}…`}
              </div>
            </div>
          </div>
        </div>
        <div className="mobile-chat__loading">
          {pendingCreation.error ? (
            <div className="mobile-chat__creation-error" role="alert">
              <p>Could not create this conversation.</p>
              <p className="mobile-chat__creation-error-detail">{pendingCreation.error}</p>
              <Link to="/" className="mobile-chat__back-link">
                ← Back to chats
              </Link>
            </div>
          ) : (
            `Starting ${pendingCreation.config.provider} in ${pendingDir}…`
          )}
        </div>
        {/* Composer stays mounted but inert: the server has no session to
            accept a message for yet, and a queued send would hang forever. */}
        <ComposerMobile
          conversationId={conversationId}
          isRunning={false}
          isStreaming={false}
          queueLength={0}
          disabledReason={
            pendingCreation.error ? 'Creation failed' : 'Waiting for the server to confirm…'
          }
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
        <div style={{ marginBottom: 12 }}>
          <Link to="/" className="mobile-chat__back-link">
            ← Back to chats
          </Link>
        </div>
        Conversation not found. It may have been deleted.
      </div>
    );
  }

  if (!detailsLoaded) {
    return (
      <div className="mobile-chat">
        <div className="mobile-chat__header">
          <div className="mobile-chat__titlebar">
            {onBack ? (
              <button
                type="button"
                className="mobile-chat__back"
                onClick={onBack}
                aria-label="Back to chats"
              >
                ←
              </button>
            ) : null}
            <span style={{ fontSize: 13, fontWeight: 600 }}>{conversationId.slice(0, 8)}</span>
          </div>
        </div>
        <div className="mobile-chat__loading">{detailError ?? 'Loading conversation history…'}</div>
      </div>
    );
  }

  const dirDisplay = conversation.workingDirectory.replace(/^\/Users\/[^/]+/, '~');
  const isRunning = conversation.isRunning ?? false;
  const isStreaming = conversation.isStreaming ?? false;
  const queue = conversation.queue ?? [];
  const configSaving = !!pendingConfigCommand && !pendingConfigCommand.error;
  const configError = pendingConfigCommand?.error ?? null;

  return (
    <div className="mobile-chat">
      <div className="mobile-chat__header">
        <div className="mobile-chat__titlebar">
          {onBack ? (
            <button
              type="button"
              className="mobile-chat__back"
              onClick={onBack}
              aria-label="Back to chats"
            >
              ←
            </button>
          ) : null}
          <div className="mobile-chat__heading">
            <div className="mobile-chat__dir" title={conversation.workingDirectory}>
              {dirDisplay}
            </div>
            <div className="mobile-chat__status">
              {/* One compact line: status + model. The model used to be three
                  always-visible dropdown chips that wrapped onto two or three
                  rows on a phone and ate a third of the screen. */}
              {isRunning || isStreaming ? (
                <span className="mobile-chat__status--running">● running</span>
              ) : queue.length > 0 ? (
                <span>{queue.length} queued</span>
              ) : (
                <span>idle</span>
              )}
              {conversation.config ? (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="mobile-chat__model"
                    onClick={() => setModelSheetOpen(true)}
                    aria-haspopup="dialog"
                    title="Change model"
                  >
                    {modelSummary(conversation.config, catalog)}
                    {configSaving ? ' …' : ''}
                    <span aria-hidden="true"> ▾</span>
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="mobile-chat__actions">
            {headerAside}
            <ForkButton conversation={conversation} />
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

      {/* Flat message list — not virtualized, iOS momentum-scroll (§10 Phase 1) */}
      <div ref={scrollRef} className="mobile-chat__messages">
        {messages.length === 0 ? (
          <div className="mobile-chat__empty">No messages yet. Send a message to start.</div>
        ) : (
          messages.map((msg, idx) => (
            <MessageRow
              key={`${idx}-${msg.timestamp ? new Date(msg.timestamp).getTime() : idx}`}
              message={msg}
              isLast={idx === messages.length - 1}
              lastMessageRef={lastMessageRef}
            />
          ))
        )}
        {(isRunning || isStreaming) && !streamingText && (
          <div className="mobile-chat__thinking">Thinking…</div>
        )}
      </div>

      <ComposerMobile
        conversationId={conversation.id}
        isRunning={isRunning}
        isStreaming={isStreaming}
        queueLength={queue.length}
      />

      {modelSheetOpen && conversation.config ? (
        <ModelSheetMobile
          conversationId={conversation.id}
          config={conversation.config}
          configRevision={conversation.configRevision}
          onClose={() => setModelSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}
