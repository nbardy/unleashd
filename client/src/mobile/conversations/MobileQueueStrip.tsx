import type { QueuedMessage } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { cancelQueuedMessage, clearQueue } from '../../atoms/actions';
import { queueAtomFamily } from '../../atoms/conversations';
import { MobileBadge, MobileSection } from '../components/MobileUI';

/**
 * MobileQueueStrip — per-item queue with cancel, mirroring desktop Chat.tsx.
 *
 * Desktop renders `pendingQueue` (queue.filter pending) with per-item
 * cancelQueuedMessage + Clear All (clearQueue). Mobile was number-only
 * (queueLength) and could not cancel one item. This strip reuses the SAME
 * server-authoritative atoms (queueAtomFamily) and actions
 * (cancelQueuedMessage/clearQueue) — no new state.
 *
 * Uses MobileBadge/MobileSection primitives (mobile-ui) per G3, and lives in
 * mobile/conversations so ConversationView + ComposerMobile can share it
 * without importing desktop components/*.
 *
 * Hook ordering: useAtomValue before early return (React hook rule).
 */
export function MobileQueueStrip({
  conversationId,
  queue: queueProp,
}: {
  conversationId: string;
  /** Optional override — when omitted reads queueAtomFamily(conversationId). */
  queue?: QueuedMessage[];
}) {
  // Keep hook before early return — even if conversationId is empty, the atom
  // returns EMPTY_QUEUE and avoids conditional hook violation.
  const queueFromAtom = useAtomValue(queueAtomFamily(conversationId ?? ''));
  const queue = queueProp ?? queueFromAtom;

  // Pending items are the cancelable ones; 'sending' is the current turn's
  // message already being processed (desktop shows it separately as Current).
  const pendingQueue = queue.filter((m) => m.status === 'pending');
  const displayQueue = pendingQueue.length > 0 ? pendingQueue : queue;

  if (!conversationId || queue.length === 0) return null;
  // If only 'sending' remains, still show it but without cancel
  const showQueue = displayQueue;

  const handleCancel = (messageId: string) => {
    cancelQueuedMessage(conversationId, messageId);
  };

  const handleClearAll = () => {
    clearQueue(conversationId);
  };

  return (
    <MobileSection
      title="Queued"
      meta={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <MobileBadge tone="active">{queue.length} queued</MobileBadge>
          {queue.length > 0 ? (
            <button
              type="button"
              onClick={handleClearAll}
              aria-label="Clear all queued messages"
              title="Clear all queued messages"
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '2px 6px',
                textDecoration: 'underline',
              }}
            >
              Clear All
            </button>
          ) : null}
        </span>
      }
    >
      <div
        role="list"
        aria-label="Queued messages"
        style={{ display: 'grid', gap: 8 }}
      >
        {showQueue.map((qm, index) => (
          <div
            key={qm.id}
            role="listitem"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              minWidth: 0,
            }}
          >
            <MobileBadge tone={qm.status === 'sending' ? 'accent' : 'neutral'} style={{ flexShrink: 0 }}>
              #{index + 1}
            </MobileBadge>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={qm.content}
            >
              {qm.content || '(empty message)'}
            </span>
            {qm.status === 'pending' ? (
              <button
                type="button"
                onClick={() => handleCancel(qm.id)}
                aria-label={`Cancel queued message ${index + 1}`}
                title="Cancel this message"
                style={{
                  flexShrink: 0,
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-page)',
                  color: 'var(--text-muted)',
                  fontSize: 16,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ×
              </button>
            ) : (
              <MobileBadge tone="accent" style={{ flexShrink: 0, fontSize: 10 }}>
                sending
              </MobileBadge>
            )}
          </div>
        ))}
      </div>
    </MobileSection>
  );
}
