import { useAtomValue } from 'jotai';
import { memo, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  allConversationIdsAtom,
  chatConversationIdsAtom,
  chatConversationInboxAtom,
  conversationAtomFamily,
} from '../../atoms/conversations';
import { hasUnseenAfter, lastSeenMessageIndexAtomFamily } from '../../atoms/ui';
import { useTimeTick } from '../../hooks/useTimeTick';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { shortenHomePath } from '../../utils/directories';
import { formatTimeAgo, getConversationLastActivity } from '../../utils/time';
import {
  MobileBadge,
  MobileCardLink,
  MobileEmptyPanel,
  MobileHeaderAction,
  MobilePage,
  MobilePath,
} from '../components/MobileUI';
import { NewConversationSheet } from '../components/NewConversationSheet';

const ConversationListItem = memo(function ConversationListItem({
  id,
  routeState,
}: {
  id: string;
  routeState: Record<string, unknown>;
}) {
  const conv = useAtomValue(conversationAtomFamily(id));
  const lastSeen = useAtomValue(lastSeenMessageIndexAtomFamily(id));
  useTimeTick();

  if (!conv) return null;

  const lastTime = getConversationLastActivity(conv);
  const timeAgo = formatTimeAgo(lastTime);
  const totalMessages = conv.messageCount ?? conv.messages.length;
  const unseen = hasUnseenAfter(lastSeen, totalMessages);
  const preview =
    conv.messages.length > 0
      ? conv.messages[conv.messages.length - 1].content.substring(0, 120)
      : 'New conversation';
  const dirDisplay = shortenHomePath(conv.workingDirectory);
  const folderName = conv.workingDirectory.split('/').filter(Boolean).pop() ?? dirDisplay;
  return (
    <MobileCardLink
      to={`/chat/${encodeURIComponent(conv.id)}`}
      state={routeState}
      className="mobile-conversation-item ui-stack"
    >
      <div className="mobile-conversation-item__top ui-row">
        <span className="mobile-conversation-item__title ui-truncate" title={dirDisplay}>
          {folderName}
        </span>
        <span className="mobile-conversation-item__meta ui-row">
          {conv.done ? <MobileBadge>Done</MobileBadge> : null}
          {unseen ? <MobileBadge tone="accent">New</MobileBadge> : null}
          <span className="mobile-conversation-item__time ui-muted">{timeAgo}</span>
          {conv.isRunning ? (
            <span
              className="mobile-conversation-item__status mobile-conversation-item__status--running"
              aria-label="running"
            />
          ) : conv.queue?.length ? (
            <span
              className="mobile-conversation-item__status mobile-conversation-item__status--queued"
              aria-label="queued"
            />
          ) : null}
        </span>
      </div>
      <div className="mobile-conversation-item__preview ui-truncate" title={preview}>
        {preview}
      </div>
      <MobilePath>{dirDisplay}</MobilePath>
    </MobileCardLink>
  );
});

export function ConversationListMobile({
  scope = 'all',
}: {
  scope?: 'all' | 'chats';
}) {
  const ids = useAtomValue(scope === 'chats' ? chatConversationIdsAtom : allConversationIdsAtom);
  const chatInbox = useAtomValue(chatConversationInboxAtom);
  const location = useLocation();
  const routeState = useMemo(() => mobileConversationRouteState(location), [location]);
  const [showCreate, setShowCreate] = useState(false);

  const list =
    ids.length === 0 ? (
      <MobileEmptyPanel>
        No conversations yet. Tap <strong>+ New</strong> to start one.
      </MobileEmptyPanel>
    ) : (
      <div className="mobile-ui-stack mobile-conversation-list">
        {ids.map((id) => (
          <ConversationListItem key={id} id={id} routeState={routeState} />
        ))}
      </div>
    );

  if (scope !== 'chats') return <div className="mobile-ui-page">{list}</div>;

  const subtitle =
    chatInbox.total > ids.length
      ? `${ids.length} most recent · ${chatInbox.total} total`
      : `${chatInbox.total} ${chatInbox.total === 1 ? 'conversation' : 'conversations'}`;

  return (
    <>
      <MobilePage
        title="Chats"
        subtitle={subtitle}
        className="mobile-chats"
        headerAside={
          <MobileHeaderAction onClick={() => setShowCreate(true)} aria-label="New conversation">
            + New
          </MobileHeaderAction>
        }
      >
        {list}
      </MobilePage>
      {showCreate && <NewConversationSheet kind="chat" onClose={() => setShowCreate(false)} />}
    </>
  );
}
