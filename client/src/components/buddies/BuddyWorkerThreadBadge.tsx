import type { BuddyWorkerThread } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { Link } from 'react-router-dom';
import { allConversationIdsAtom } from '../../atoms/conversations';
import './BuddyWorkerThreadBadge.css';

export function BuddyWorkerThreadBadge({ thread }: { thread: BuddyWorkerThread }) {
  const ids = useAtomValue(allConversationIdsAtom);
  const label = `${thread.label} · worker`;
  return ids.includes(thread.conversationId) ? (
    <Link
      className="buddy-worker-thread-badge"
      to={`/chat/${thread.conversationId}`}
      aria-label={`Open ${thread.label} worker thread`}
    >
      {label} ↗
    </Link>
  ) : (
    <span
      className="buddy-worker-thread-badge"
      title="Thread is not available yet or has been removed"
    >
      {label} · unavailable
    </span>
  );
}
