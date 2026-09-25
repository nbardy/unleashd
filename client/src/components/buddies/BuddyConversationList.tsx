import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { buddyConversationIdsAtomFamily } from '../../atoms/buddy-conversation-list';
import { conversationAtomFamily } from '../../atoms/conversations';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { formatTimeAgo, getConversationLastActivity } from '../../utils/time';
import { conversationPath } from './buddy-tabs';

function ConversationRow({ id, routeState }: { id: string; routeState: Record<string, unknown> }) {
  const conversation = useAtomValue(conversationAtomFamily(id));
  if (!conversation) return null;
  const source =
    conversation.messages.find((message) => message.role === 'user') ?? conversation.messages[0];
  const activity = getConversationLastActivity(conversation);
  const title =
    source?.content
      .replace(/<!--[\s\S]*?-->/g, '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ||
    `Conversation · ${activity.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  return (
    <li>
      <Link className="buddy-thread-list__row" to={conversationPath(id)} state={routeState}>
        <span className="buddy-thread-list__title">{title}</span>
        <span className="buddy-thread-list__meta">
          {conversation.isRunning && <span className="buddy-thread-list__running">Running</span>}
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

/** One Buddy's foreground chats (atoms/buddy-conversation-list.ts), running first. */
export function BuddyConversationList({ buddyId }: { buddyId: string }) {
  const location = useLocation();
  const routeState = useMemo(() => mobileConversationRouteState(location), [location]);
  const ids = useAtomValue(buddyConversationIdsAtomFamily(buddyId));
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
