import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BuddyPage } from '../../components/buddies/BuddyPage';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';

/**
 * Mobile mount of the shared Buddy page (components/buddies/BuddyPage.tsx).
 * Its only mobile-specific job: conversations opened from the page carry the
 * mobile route state, so Back from the chat returns here.
 */
export function BuddyDetailMobile() {
  const { buddyId = '' } = useParams<{ buddyId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const chatRouteState = useMemo(() => mobileConversationRouteState(location), [location]);
  const openConversation = useCallback(
    (id: string) => navigate(`/chat/${id}`, { state: chatRouteState }),
    [chatRouteState, navigate]
  );
  return (
    <BuddyPage
      key={buddyId}
      buddyId={buddyId}
      layout="narrow"
      openConversation={openConversation}
    />
  );
}
