import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { loadConversationDetails, setActiveConversationId } from '../../atoms/actions';
import {
  conversationAtomFamily,
  conversationDetailsLoadedAtomFamily,
  streamingAtomFamily,
} from '../../atoms/conversations';
import { markMessagesSeen, setSavedActiveConversationId } from '../../atoms/ui';
import { ComposerMobile } from '../components/ComposerMobile';
import { MessageRow } from '../components/MessageRow';
import { ProviderModelPickerMobile } from '../components/ProviderModelPickerMobile';

export function ChatMobile() {
  const { id } = useParams<{ id: string }>();
  const conversationId = id ?? '';
  const navigate = useNavigate();

  const conversation = useAtomValue(conversationAtomFamily(conversationId));
  const detailsLoaded = useAtomValue(conversationDetailsLoadedAtomFamily(conversationId));
  const streamingText = useAtomValue(streamingAtomFamily(conversationId));

  const [detailError, setDetailError] = useState<string | null>(null);
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
    return (
      <div style={{ padding: 24, color: 'var(--text-muted, #888)' }}>No conversation selected.</div>
    );
  }

  if (!conversation) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted, #888)' }}>
        <div style={{ marginBottom: 12 }}>
          <Link to="/" style={{ color: 'var(--accent, #7c5cff)', fontSize: 13 }}>
            ← Back to chats
          </Link>
        </div>
        Conversation not found. It may have been deleted.
      </div>
    );
  }

  if (!detailsLoaded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid var(--border-subtle, #2a2a2a)',
            background: 'var(--bg-raised-1, #1a1a1a)',
          }}
        >
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary, #e8e8e8)',
              fontSize: 14,
            }}
          >
            ← Back
          </button>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{conversationId.slice(0, 8)}</span>
        </div>
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-muted, #888)' }}>
          {detailError ?? 'Loading conversation history…'}
        </div>
      </div>
    );
  }

  const dirDisplay = conversation.workingDirectory.replace(/^\/Users\/[^/]+/, '~');
  const isRunning = conversation.isRunning ?? false;
  const isStreaming = conversation.isStreaming ?? false;
  const queue = conversation.queue ?? [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: 'var(--bg-page, #0f0f0f)',
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle, #2a2a2a)',
          background: 'var(--bg-raised-1, #1a1a1a)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => navigate('/')}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary, #e8e8e8)',
              fontSize: 14,
              padding: '4px 6px',
            }}
            aria-label="Back to chats"
          >
            ←
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary, #e8e8e8)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={conversation.workingDirectory}
            >
              {dirDisplay}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>
              {conversation.provider} · {(isRunning || isStreaming) && <span style={{ color: '#22c55e' }}>● running</span>}
              {!isRunning && !isStreaming && queue.length > 0 && <span>{queue.length} queued</span>}
              {!isRunning && !isStreaming && queue.length === 0 && <span>idle</span>}
            </div>
          </div>
        </div>

        {conversation.config && (
          <ProviderModelPickerMobile
            conversationId={conversation.id}
            config={conversation.config}
            configRevision={conversation.configRevision}
          />
        )}
      </div>

      {/* Flat message list — not virtualized, iOS momentum-scroll (§10 Phase 1) */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorY: 'contain',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '12px 12px 8px',
        }}
      >
        {messages.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted, #888)', fontSize: 13 }}>
            No messages yet. Send a message to start.
          </div>
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
          <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', padding: '4px 12px' }}>
            Thinking…
          </div>
        )}
      </div>

      <ComposerMobile
        conversationId={conversation.id}
        isRunning={isRunning}
        isStreaming={isStreaming}
        queueLength={queue.length}
      />
    </div>
  );
}
