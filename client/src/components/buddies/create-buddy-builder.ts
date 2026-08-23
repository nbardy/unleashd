import { newId } from '../../utils/ids';

/**
 * Open one idempotent Buddy Builder conversation. The caller owns navigation so
 * desktop and mobile can add their own route context without creating another
 * creation spine.
 */
export async function createBuddyViaBuilder(): Promise<string> {
  const response = await fetch('/api/buddies/builder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: newId(),
      commandId: newId(),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    conversationId?: string;
    conversation?: { id?: string };
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error ?? `Buddy Builder failed (HTTP ${response.status})`);
  }
  const confirmedId = payload.conversationId ?? payload.conversation?.id;
  if (!confirmedId) throw new Error('Buddy Builder did not return a conversation');
  return confirmedId;
}
