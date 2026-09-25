import { type OpenConversation, buildForkDraft } from '../utils/conversation-transcript';
import { createConversation } from './commands';
import { DRAFT_KEY_PREFIX } from './ui';

/**
 * Chat "Fork" — soft handoff into a new conversation. One implementation for
 * both view trees (desktop Chat.tsx header, mobile ConversationView header).
 * Takes the open conversation (row + loaded detail + bodies), so a fork is only
 * offered once the source is loaded. Callers navigate; this function does not.
 */
export function forkConversation(source: OpenConversation): string {
  const forkedId = createConversation({
    workingDirectory: source.row.cwd,
    config: source.detail.config.config,
    kind: { t: 'fork', from: source.row.id },
  });
  // The composer reads this key on mount, so the transcript must land before
  // the route change that renders it.
  localStorage.setItem(`${DRAFT_KEY_PREFIX}${forkedId}`, buildForkDraft(source));
  return forkedId;
}
