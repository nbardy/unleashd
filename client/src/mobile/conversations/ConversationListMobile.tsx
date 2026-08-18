import { useAtomValue } from 'jotai';
import { memo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  allConversationIdsAtom,
  chatConversationIdsAtom,
  chatConversationInboxAtom,
  conversationAtomFamily,
} from '../../atoms/conversations';
import { doneConversationsAtom, hasUnseenMessages, lastSeenMessageIndexAtom } from '../../atoms/ui';
import { formatTimeAgo, getConversationLastActivity } from '../../utils/time';
import {
  MobileBadge,
  MobileCardButton,
  MobileEmptyPanel,
  MobileHeaderAction,
  MobilePage,
  MobilePath,
} from '../components/MobileUI';
import { NewConversationSheet } from '../components/NewConversationSheet';

function useTimeTick(ms = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

const ConversationListItem = memo(function ConversationListItem({
  id,
}: {
  id: string;
}) {
  const conv = useAtomValue(conversationAtomFamily(id));
  const lastSeenMessageIndex = useAtomValue(lastSeenMessageIndexAtom);
  const doneConversations = useAtomValue(doneConversationsAtom);
  const navigate = useNavigate();
  const done = doneConversations.includes(id);

  if (!conv) return null;

  const lastTime = getConversationLastActivity(conv);
  const timeAgo = formatTimeAgo(lastTime);
  const totalMessages = conv.messageCount ?? conv.messages.length;
  const unseen = hasUnseenMessages(lastSeenMessageIndex, id, totalMessages);
  const preview =
    conv.messages.length > 0
      ? conv.messages[conv.messages.length - 1].content.substring(0, 120)
      : 'New conversation';
  const dirDisplay = conv.workingDirectory.replace(/^\/Users\/[^/]+/, '~');
  const folderName = conv.workingDirectory.split('/').filter(Boolean).pop() ?? dirDisplay;
  return (
    <MobileCardButton
      onClick={() => navigate(`/chat/${conv.id}`)}
      className="mobile-conversation-item"
    >
      <div className="mobile-conversation-item__top">
        <span className="mobile-conversation-item__title" title={dirDisplay}>
          {folderName}
        </span>
        <span className="mobile-conversation-item__meta">
          {done ? <MobileBadge>Done</MobileBadge> : null}
          {unseen ? <MobileBadge tone="accent">New</MobileBadge> : null}
          <span className="mobile-conversation-item__time">{timeAgo}</span>
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
      <div className="mobile-conversation-item__preview" title={preview}>
        {preview}
      </div>
      <MobilePath>{dirDisplay}</MobilePath>
    </MobileCardButton>
  );
});

export function ConversationListMobile({
  scope = 'all',
}: {
  scope?: 'all' | 'chats';
}) {
  const ids = useAtomValue(scope === 'chats' ? chatConversationIdsAtom : allConversationIdsAtom);
  const chatInbox = useAtomValue(chatConversationInboxAtom);
  const [showCreate, setShowCreate] = useState(false);
  useTimeTick();

  const list =
    ids.length === 0 ? (
      <MobileEmptyPanel>
        No conversations yet. Tap <strong>+ New</strong> to start one.
      </MobileEmptyPanel>
    ) : (
      <div className="mobile-ui-stack mobile-conversation-list">
        {ids.map((id) => (
          <ConversationListItem key={id} id={id} />
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
