import type { Conversation } from '@unleashd/shared';

const PREVIEW_CONTENT_LENGTH = 500;

/**
 * Project canonical conversation state into a bounded list-row snapshot.
 *
 * This is a transport projection, not another persistence model: keep metadata
 * intact, include only a last-message preview, and hydrate the full transcript
 * through the conversation-detail route. Adding caches or alternate snapshot
 * formats here creates competing freshness rules.
 */
export function summarizeConversation(conversation: Conversation): Conversation {
  const lastMessage = conversation.messages.at(-1);
  return {
    ...conversation,
    messageCount: conversation.messageCount ?? conversation.messages.length,
    messages: lastMessage
      ? [
          {
            ...lastMessage,
            content: lastMessage.content.slice(0, PREVIEW_CONTENT_LENGTH),
            toolCall: undefined,
          },
        ]
      : [],
  };
}
