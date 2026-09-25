import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { buddyConversationListAtom } from '../../atoms/buddy-conversation-list';
import { conversationAtomFamily } from '../../atoms/conversations';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { formatTimeAgo } from '../../utils/time';
import { conversationPath } from './buddy-tabs';
import type { ConversationLink } from './types';

function ConversationRow({
  id,
  link,
  available,
  running,
  timestamp,
  routeState,
}: {
  id: string;
  link: ConversationLink;
  available: boolean;
  running: boolean;
  timestamp: number;
  routeState: Record<string, unknown>;
}) {
  const conversation = useAtomValue(conversationAtomFamily(id));
  // The server derives the label once (provider title, else first user line).
  const label = conversation?.label;
  const title =
    (label && label !== 'New conversation' ? label : null) ||
    (link.kind === 'review'
      ? 'Buddy review'
      : timestamp > 0
        ? `Conversation · ${new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
        : 'New conversation');
  const contents = (
    <>
      <span className="buddy-thread-list__title">{title}</span>
      <span className="buddy-thread-list__meta">
        {running && <span className="buddy-thread-list__running">Running</span>}
        {!available && <span>Unavailable</span>}
        {link.kind === 'review' && <span>Review</span>}
        {timestamp > 0 && (
          <time
            dateTime={new Date(timestamp).toISOString()}
            title={new Date(timestamp).toLocaleString()}
          >
            {formatTimeAgo(new Date(timestamp))}
          </time>
        )}
      </span>
    </>
  );
  return (
    <li>
      {available ? (
        <Link className="buddy-thread-list__row" to={conversationPath(id)} state={routeState}>
          {contents}
          <span className="buddy-thread-list__arrow" aria-hidden="true">
            ↗
          </span>
        </Link>
      ) : (
        <div className="buddy-thread-list__row" aria-disabled="true">
          {contents}
        </div>
      )}
    </li>
  );
}

export function BuddyConversationList({
  links,
  showReviewConversations = false,
}: {
  links: ConversationLink[];
  showReviewConversations?: boolean;
}) {
  const location = useLocation();
  const routeState = useMemo(() => mobileConversationRouteState(location), [location]);
  const listAtom = useMemo(
    () => buddyConversationListAtom(links, showReviewConversations),
    [links, showReviewConversations]
  );
  const rows = useAtomValue(listAtom);
  if (!rows.length)
    return (
      <p className="buddy-thread-list__empty">
        No conversations yet. Start a chat with this Buddy.
      </p>
    );
  return (
    <ul className="buddy-thread-list">
      {rows.map((row) => (
        <ConversationRow key={row.id} {...row} routeState={routeState} />
      ))}
    </ul>
  );
}
