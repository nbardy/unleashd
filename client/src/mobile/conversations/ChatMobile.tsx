import { useNavigate, useParams } from 'react-router-dom';
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
  const navigate = useNavigate();
  return <ConversationView conversationId={id ?? ''} onBack={() => navigate('/')} />;
}
