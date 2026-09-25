import type { QueuedMessage } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { cancelQueuedMessage, clearQueue, promoteQueuedMessage } from '../../atoms/actions';
import { queueOf, transcriptFamily } from '../../atoms/conversations';
import { MobileBadge } from '../components/MobileUI';

/**
 * MobileQueueStrip — per-item queue with cancel + send-now, mirroring desktop Chat.tsx.
 *
 * Desktop renders `pendingQueue` (queue.filter pending) with per-item
 * cancelQueuedMessage, promoteQueuedMessage (Send now) + Clear All
 * (clearQueue). Mobile was number-only (queueLength) and could not cancel
 * one item. This strip reuses the SAME server-authoritative atoms
 * (transcriptFamily → queueOf) and actions
 * (cancelQueuedMessage/promoteQueuedMessage/clearQueue) — no new state.
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
  /** Optional override — when omitted reads the loaded transcript's queue. */
  queue?: readonly QueuedMessage[];
}) {
  // Keep hook before early return — even if conversationId is empty, the atom
  // returns EMPTY_QUEUE and avoids conditional hook violation.
  const queueFromAtom = queueOf(useAtomValue(transcriptFamily(conversationId ?? '')));
  const queue = queueProp ?? queueFromAtom;

  // Pending items are the cancelable ones; 'sending' is the current turn's
  // message already being processed (desktop shows it separately as Current).
  const pendingQueue = queue.filter((m) => m.status === 'pending');
  // The current sending input is represented by turn status, not the queue.
  const showQueue = pendingQueue;

  if (!conversationId || showQueue.length === 0) return null;

  const handleCancel = (messageId: string) => {
    cancelQueuedMessage(conversationId, messageId);
  };

  const handleSendNow = (messageId: string) => {
    promoteQueuedMessage(conversationId, messageId);
  };

  const handleClearAll = () => {
    clearQueue(conversationId);
  };

  return (
    <details className="mobile-queue-disclosure">
      <summary>{showQueue.length} queued</summary>
      <button type="button" onClick={handleClearAll} aria-label="Clear all queued messages">
        Clear queued messages
      </button>
      <ul
        aria-label="Queued messages"
        style={{ display: 'grid', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}
      >
        {showQueue.map((qm, index) => (
          <li
            key={qm.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 'var(--ui-radius)',
              background: 'var(--bg-raised-1)',
              border: '1px solid var(--border-subtle)',
              minWidth: 0,
            }}
          >
            <MobileBadge
              tone={qm.status === 'sending' ? 'accent' : 'neutral'}
              style={{ flexShrink: 0 }}
            >
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
              <>
                <button
                  type="button"
                  onClick={() => handleSendNow(qm.id)}
                  aria-label={`Send queued message ${index + 1} now`}
                  title="Send now — run this next, interrupting the active turn"
                  style={{
                    flexShrink: 0,
                    height: 28,
                    padding: '0 10px',
                    borderRadius: 'var(--ui-radius)',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-page)',
                    color: 'var(--text-emphasis)',
                    fontSize: 12,
                    lineHeight: 1,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  Send now
                </button>
                <button
                  type="button"
                  onClick={() => handleCancel(qm.id)}
                  aria-label={`Cancel queued message ${index + 1}`}
                  title="Cancel this message"
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: 'var(--ui-radius)',
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
              </>
            ) : (
              <MobileBadge tone="accent" style={{ flexShrink: 0, fontSize: 10 }}>
                sending
              </MobileBadge>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
