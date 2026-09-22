import type { Conversation } from '@unleashd/shared';

/**
 * Sidebar label for a conversation.
 *
 * Precedence: provider-generated title (Claude ai-title/custom-title,
 * carried on the conversation) wins. Otherwise derive from the first user
 * message, with hidden HTML envelopes (buddy-context, swarm-prefix) stripped
 * — they are CLI instructions, never label text. Falls back to the first
 * message, then a placeholder. Title > most-recent preview per spec.
 */
export function getConversationTitle(conversation: Conversation): string {
  if (conversation.title?.trim()) return conversation.title.trim();
  const userMsg = conversation.messages.find((m) => m.role === 'user');
  const source = userMsg ?? conversation.messages[0];
  if (!source) return 'New conversation';
  // Strip hidden HTML envelopes from the whole content BEFORE taking the
  // first line: buddy turns start with a single-line
  // `<!-- unleashd:buddy-context-v2 … -->` line, so first-line-then-strip
  // would leave nothing and fall back to the raw comment.
  const visible = source.content.replace(/<!--[\s\S]*?-->/g, '');
  const firstLine =
    visible
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  if (!firstLine) return 'New conversation';
  const cleaned = firstLine.replace(/^\[oompa[^\]]*\]\s*/i, '').trim() || firstLine;
  return cleaned.length > 80 ? `${cleaned.substring(0, 77)}…` : cleaned;
}
