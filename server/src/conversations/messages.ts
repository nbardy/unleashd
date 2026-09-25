import type { MessagePage } from '@unleashd/shared';

/**
 * The one source of message bodies (GET /api/conversations/:id/messages).
 * Lists never carry bodies; a client pages them in when it opens a
 * conversation, and refreshes only the tail when the row's messageCount moves.
 *
 * Today the page is cut from the runtime's in-memory transcript. T13 swaps
 * this function's body for the Rust ingest crate (`ingest.messages(id,
 * afterSeq, limit)`) plus the live-turn overlay; callers do not change.
 */
export type MessageSource = (
  conversationId: string,
  page: { afterSeq: number; limit: number }
) => MessagePage | null;

export const MESSAGE_PAGE_DEFAULT_LIMIT = 500;
export const MESSAGE_PAGE_MAX_LIMIT = 2000;

export function runtimeMessageSource(
  getConversation: (
    id: string
  ) => { messagePage(afterSeq: number, limit: number): MessagePage } | undefined
): MessageSource {
  return (conversationId, { afterSeq, limit }) =>
    getConversation(conversationId)?.messagePage(afterSeq, limit) ?? null;
}
