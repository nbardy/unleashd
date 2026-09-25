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
import { isRowRunning } from '../../utils/conversation-row';
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
  const unseen = hasUnseenAfter(lastSeen, conv.messageCount);
  const preview = conv.label;
  const dirDisplay = shortenHomePath(conv.cwd);
  const folderName = conv.cwd.split('/').filter(Boolean).pop() ?? dirDisplay;
  return (
    <MobileCardLink
      to={`/chat/${encodeURIComponent(conv.id)}`}
      state={routeState}
      className="mobile-conversation-item"
    >
      <div className="mobile-conversation-item__top">
        <span className="mobile-conversation-item__title" title={dirDisplay}>
          {folderName}
        </span>
        <span className="mobile-conversation-item__meta">
          {conv.done ? <MobileBadge>Done</MobileBadge> : null}
          {unseen ? <MobileBadge tone="accent">New</MobileBadge> : null}
          <span className="mobile-conversation-item__time">{timeAgo}</span>
          {isRowRunning(conv) ? (
            <span
              className="mobile-conversation-item__status mobile-conversation-item__status--running"
              aria-label="running"
            />
          ) : conv.run === 'queued' ? (
            <span
              className="mobile-conversation-item__status mobile-conversation-item__status--queued"
              aria-label="queued"
            />
          ) : null}
        </span>
      </div>
      <div className="mobile-conversation-item__preview" title={preview}>
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
