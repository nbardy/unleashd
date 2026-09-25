import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { listField, rowFamily } from '../../atoms/conversations';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { isRowRunning } from '../../utils/conversation-row';
import { formatTimeAgo, getConversationLastActivity } from '../../utils/time';
import { conversationPath } from './buddy-tabs';

function ConversationRow({ id, routeState }: { id: string; routeState: Record<string, unknown> }) {
  const conversation = useAtomValue(rowFamily(id));
  if (!conversation) return null;
  const activity = getConversationLastActivity(conversation);
  // The server derives the label once (provider title, else first user line).
  const title =
    conversation.label !== 'New conversation'
      ? conversation.label
      : `Conversation · ${activity.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  return (
    <li>
      <Link className="buddy-thread-list__row" to={conversationPath(id)} state={routeState}>
        <span className="buddy-thread-list__title">{title}</span>
        <span className="buddy-thread-list__meta">
          {isRowRunning(conversation) && (
            <span className="buddy-thread-list__running">Running</span>
          )}
          <time dateTime={activity.toISOString()} title={activity.toLocaleString()}>
            {formatTimeAgo(activity)}
          </time>
        </span>
        <span className="buddy-thread-list__arrow" aria-hidden="true">
          ↗
        </span>
      </Link>
    </li>
  );
}

const NO_IDS: readonly string[] = [];

/** One Buddy's foreground chats (list index `buddyThreads`), running first. */
export function BuddyConversationList({ buddyId }: { buddyId: string }) {
  const location = useLocation();
  const routeState = useMemo(() => mobileConversationRouteState(location), [location]);
  const ids = useAtomValue(listField('buddyThreads')).get(buddyId)?.foreground ?? NO_IDS;
  if (!ids.length)
    return (
      <p className="buddy-thread-list__empty">
        No conversations yet. Start a chat with this Buddy.
      </p>
    );
  return (
    <ul className="buddy-thread-list">
      {ids.map((id) => (
        <ConversationRow key={id} id={id} routeState={routeState} />
      ))}
    </ul>
  );
}
