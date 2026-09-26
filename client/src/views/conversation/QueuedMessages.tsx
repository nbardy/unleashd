import type { QueuedMessage } from '@unleashd/shared';
import { cancelQueuedMessage, clearQueue, promoteQueuedMessage } from '../../atoms/actions';
import { ContextBadge } from './ContextSection';
import './QueuedMessages.css';

/**
 * Messages waiting behind the running turn, each with Send now (promote,
 * interrupting the active turn) and cancel, plus clear-all. Only `pending`
 * items are listed: the `sending` one is the current turn's input, which the
 * turn status (and desktop's Current message strip) already shows.
 *
 * `list` (desktop, above the composer): always-open panel.
 * `disclosure` (mobile, above the composer): a "N queued" <details> strip.
 */
export interface QueuedMessagesProps {
  presentation: 'list' | 'disclosure';
  conversationId: string;
  queue: readonly QueuedMessage[];
}

interface QueueActions {
  sendNow: (messageId: string) => void;
  cancel: (messageId: string) => void;
  clearAll: () => void;
}

export function QueuedMessages({ presentation, conversationId, queue }: QueuedMessagesProps) {
  const pending = queue.filter((m) => m.status === 'pending');
  if (pending.length === 0) return null;
  const actions: QueueActions = {
    sendNow: (messageId) => promoteQueuedMessage(conversationId, messageId),
    cancel: (messageId) => cancelQueuedMessage(conversationId, messageId),
    clearAll: () => clearQueue(conversationId),
  };
  return presentation === 'list' ? (
    <QueueList pending={pending} actions={actions} />
  ) : (
    <QueueDisclosure pending={pending} actions={actions} />
  );
}

const SEND_NOW_TITLE = 'Send now — run this next, interrupting the active turn';

function QueueList({ pending, actions }: { pending: QueuedMessage[]; actions: QueueActions }) {
  return (
    <div className="queued-messages">
      <div className="queued-messages-header ui-row">
        <span className="queued-badge">Queued ({pending.length})</span>
        <button
          type="button"
          className="clear-queue-header-btn ui-control"
          onClick={actions.clearAll}
          title="Clear all queued messages"
        >
          Clear All
        </button>
      </div>
      <ul className="queued-messages-list ui-stack">
        {pending.map((qm, index) => (
          <li key={qm.id} className="queued-message-item">
            <span className="queued-message-content">{qm.content}</span>
            <span className="queued-message-status">#{index + 1} in queue</span>
            <button
              type="button"
              className="queued-message-send-now ui-control"
              onClick={() => actions.sendNow(qm.id)}
              title={SEND_NOW_TITLE}
            >
              Send now
            </button>
            <button
              type="button"
              className="queued-message-remove ui-control ui-row"
              onClick={() => actions.cancel(qm.id)}
              title="Remove from queue"
            >
              &times;
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueueDisclosure({
  pending,
  actions,
}: {
  pending: QueuedMessage[];
  actions: QueueActions;
}) {
  return (
    <details className="queue-disclosure">
      <summary>{pending.length} queued</summary>
      <button
        type="button"
        className="queue-disclosure__clear"
        onClick={actions.clearAll}
        aria-label="Clear all queued messages"
      >
        Clear queued messages
      </button>
      <ul className="queue-disclosure__list" aria-label="Queued messages">
        {pending.map((qm, index) => (
          <li key={qm.id} className="ui-surface ui-card ui-row context-card">
            <ContextBadge tone="neutral">#{index + 1}</ContextBadge>
            <span
              className="context-card__body queue-disclosure__content ui-truncate"
              title={qm.content}
            >
              {qm.content || '(empty message)'}
            </span>
            <button
              type="button"
              className="queue-disclosure__send ui-card ui-control ui-inline-row"
              onClick={() => actions.sendNow(qm.id)}
              aria-label={`Send queued message ${index + 1} now`}
              title={SEND_NOW_TITLE}
            >
              Send now
            </button>
            <button
              type="button"
              className="queue-disclosure__cancel ui-card ui-control ui-inline-row"
              onClick={() => actions.cancel(qm.id)}
              aria-label={`Cancel queued message ${index + 1}`}
              title="Cancel this message"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
