import type { BuddyWorkerThread } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { Link } from 'react-router-dom';
import { listField } from '../../atoms/conversations';
import './BuddyWorkerThreadBadge.css';

export function BuddyWorkerThreadBadge({ thread }: { thread: BuddyWorkerThread }) {
  const available = useAtomValue(listField('idSet'));
  const label = `${thread.label} · worker`;
  return available.has(thread.conversationId) ? (
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
