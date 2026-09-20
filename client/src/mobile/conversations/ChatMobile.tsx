import { useAtomValue } from 'jotai';
import type { MouseEventHandler } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { conversationAtomFamily } from '../../atoms/conversations';
import { resolveMobileConversationDestination } from '../../utils/conversation-route-state';
import { ConversationView } from './ConversationView';

/**
 * ChatMobile — route wrapper for /chat/:id.
 *
 * All conversation rendering lives in ConversationView, which buddy surfaces
 * reuse. Keep this file a wrapper: logic added here is logic buddy threads
 * silently do not get.
 */
export function ChatMobile() {
  const { id } = useParams<{ id: string }>();
  const conversationId = id ?? '';
  const conversation = useAtomValue(conversationAtomFamily(conversationId));
  const location = useLocation();
  const navigate = useNavigate();
  const destination = resolveMobileConversationDestination(location.state, conversation);
  const handleBack: MouseEventHandler<HTMLAnchorElement> = (event) => {
    // Internal router entries already retain the exact Buddy/tab/search path.
    // A direct deep link has the public React Router key `default`; let the
    // anchor use the deterministic fallback instead of leaving the app.
    if (location.key === 'default') return;
    event.preventDefault();
    navigate(-1);
  };
  return (
    <ConversationView
      conversationId={conversationId}
      backTo={destination.path}
      onBack={handleBack}
    />
  );
}
