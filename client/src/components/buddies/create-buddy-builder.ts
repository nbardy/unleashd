import { buddyAction } from './api';

/**
 * Open a Buddy Builder conversation (POST /api/buddies/builder, no body →
 * `{conversationId}`). The caller owns navigation so desktop and mobile can
 * add their own route context without creating another creation spine.
 */
export async function createBuddyViaBuilder(): Promise<string> {
  const { conversationId } = await buddyAction<{ conversationId: string }>('/api/buddies/builder');
  return conversationId;
}
