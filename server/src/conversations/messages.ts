import type { MessagePage } from '@unleashd/shared';

/**
 * The one source of message bodies (GET /api/conversations/:id/messages).
 * Lists never carry bodies; a client pages them in when it opens a
 * conversation, and refreshes only the tail when the row's messageCount moves.
 *
 * Production reads the ingest store (`ConversationList.page`: the bound
 * sessions' settled history merged with the live-turn overlay, T13b S2).
 * null = no such conversation.
 */
export type MessageSource = (
  conversationId: string,
  page: { afterSeq: number; limit: number }
) => Promise<MessagePage | null>;

export const MESSAGE_PAGE_DEFAULT_LIMIT = 500;
export const MESSAGE_PAGE_MAX_LIMIT = 2000;
