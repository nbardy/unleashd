import { atom } from 'jotai';
import { linkConversationId } from '../components/buddies/buddies-shaping';
import type { ConversationLink } from '../components/buddies/types';
import { getConversationLastActivity } from '../utils/time';
import { availableConversationIdSetAtom, conversationAtomFamily } from './conversations';

/**
 * Canonical foreground Buddy-thread projection for both shells. Background,
 * automation, provider-child and swarm-worker transcripts remain directly
 * addressable through their dedicated surfaces; they are not ordinary chats.
 */
export function buddyConversationListAtom(
  links: ConversationLink[],
  showReviewConversations: boolean
) {
  return atom((get) => {
    const availableIds = get(availableConversationIdSetAtom);
    const seen = new Set<string>();
    const rows = links.flatMap((link) => {
      if (
        link.kind === 'automation' ||
        (!showReviewConversations && link.kind === 'review')
      )
        return [];
      const id = linkConversationId(link);
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const conversation = get(conversationAtomFamily(id));
      if (
        conversation?.placement === 'background' ||
        conversation?.isWorker ||
        conversation?.parentConversationId
      )
        return [];
      const available = availableIds.has(id);
      const timestamp = Math.max(
        new Date(link.last_active_at ?? 0).getTime() || 0,
        conversation ? getConversationLastActivity(conversation).getTime() : 0
      );
      return [
        { id, link, available, running: available && Boolean(conversation?.isRunning), timestamp },
      ];
    });
    rows.sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        Number(b.running) - Number(a.running) ||
        b.timestamp - a.timestamp
    );
    return rows;
  });
}
