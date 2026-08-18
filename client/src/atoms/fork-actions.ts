import type { Conversation } from '@unleashd/shared';
import { buildForkDraft } from '../utils/conversation-transcript';
import { createConversation } from './pending-creations';
import { DRAFT_KEY_PREFIX } from './ui';

/**
 * Chat "Fork" — soft handoff into a new conversation. One implementation for
 * both view trees (desktop Chat.tsx header, mobile ConversationView header).
 *
 * Returns the new conversation id, or null when the source conversation has no
 * resolved config yet (a pending creation that the server has not confirmed).
 * Callers navigate; this function does not.
 */
export function forkConversation(conversation: Conversation): string | null {
  const config = conversation.config;
  if (!config) return null;

  const forkedId = createConversation({
    workingDirectory: conversation.workingDirectory,
    config,
    resumedFromConversationId: conversation.id,
  });
  // The composer reads this key on mount, so the transcript must land before
  // the route change that renders it.
  localStorage.setItem(`${DRAFT_KEY_PREFIX}${forkedId}`, buildForkDraft(conversation));
  return forkedId;
}
