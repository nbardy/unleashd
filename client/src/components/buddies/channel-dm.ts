/**
 * client/src/components/buddies/channel-dm.ts
 *
 * A Buddy DM drawn as a channel thread (493c1c7): the conversation's message groups become thread
 * rows — a day rule, a lead (avatar + name + time) or a continuation — so a DM reads like the
 * channel around it. Pure, so mobile may import it.
 */
import type { Message, QueuedMessage } from '@unleashd/shared';
import type { MessageGroup } from '../../utils/chat-message-groups';

// The window channelRows uses: a later message from the same author within five minutes
// continues the run (the avatar and name stay on the lead).
const GROUP_WINDOW_MS = 5 * 60_000;

export type DmAuthor = 'owner' | 'buddy';

export type DmRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'lead' | 'continuation'; key: string; author: DmAuthor; at: string; body: string };

const dayLabel = (date: Date) =>
  date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

// One response's text in order; tool lines stay, so ChannelMarkdown collapses them the way it
// does in a post.
function responseBody(group: Extract<MessageGroup, { type: 'assistant' }>): string {
  return group.parts
    .map((part) =>
      part.type === 'content'
        ? part.message.content
        : part.messages.map((message) => message.content).join('\n')
    )
    .join('\n');
}

/**
 * Rows for one DM generation. System records (errors, notices) are left out: a failed turn shows
 * its retry under the transcript instead. `queued` is what the owner sent that the server has not
 * written to the transcript yet, so Send shows it at once.
 */
export function dmRows(groups: readonly MessageGroup[], queued: readonly QueuedMessage[]): DmRow[] {
  const rows: DmRow[] = [];
  let previous: { author: DmAuthor; at: number; day: string } | null = null;
  const push = (key: string, author: DmAuthor, at: Date, body: string) => {
    const text = body.trim();
    if (!text) return;
    const day = at.toDateString();
    if (previous?.day !== day) rows.push({ kind: 'day', key: `day:${key}`, label: dayLabel(at) });
    const continues =
      previous?.day === day &&
      previous.author === author &&
      at.getTime() - previous.at < GROUP_WINDOW_MS;
    rows.push({
      kind: continues ? 'continuation' : 'lead',
      key,
      author,
      at: at.toISOString(),
      body: text,
    });
    previous = { author, at: at.getTime(), day };
  };
  for (const group of groups) {
    const first = group.messages[0];
    switch (group.type) {
      case 'assistant':
        push(
          `m:${group.firstMessageIndex}`,
          'buddy',
          new Date(first.timestamp),
          responseBody(group)
        );
        break;
      case 'single':
        if (first.role === 'user')
          push(`m:${group.firstMessageIndex}`, 'owner', new Date(first.timestamp), first.content);
        break;
    }
  }
  for (const item of queued) push(`q:${item.id}`, 'owner', new Date(item.queuedAt), item.content);
  return rows;
}

/** The owner's last message: what an out-of-tokens retry resends on the new harness. */
export function lastOwnerText(messages: readonly Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.content.trim()) return message.content;
  }
  return null;
}
