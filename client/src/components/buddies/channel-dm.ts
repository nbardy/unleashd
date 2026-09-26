import type { MessageGroup } from '../../utils/chat-message-groups';

// Same window channelRows uses: a later message from the same person within
// five minutes continues the run (avatar + name stay on the lead).
const GROUP_WINDOW_MS = 5 * 60_000;

export type DmAuthor = 'owner' | 'buddy';

export type DmRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'divider'; key: string; harness: string | null }
  | {
      kind: 'lead' | 'continuation';
      key: string;
      author: DmAuthor;
      at: string;
      body: string;
    };

export type DmQueued = { id: string; content: string; queuedAt: Date };

function dayKey(date: Date): string {
  return date.toDateString();
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function responseBody(group: Extract<MessageGroup, { type: 'assistant' }>): string {
  return group.parts
    .map((part) =>
      part.type === 'content'
        ? part.message.content
        : part.messages.map((message) => message.content).join('\n')
    )
    .join('\n')
    .trim();
}

/**
 * Conversation groups as thread rows: a day rule, a lead (avatar + name) or a
 * continuation, and the New-chat divider. Tool lines stay in the body so
 * ChannelMarkdown collapses them the same way a thread post does.
 * `queued` is the owner's messages the server has not copied into the
 * transcript yet, so Send shows them at once.
 */
export function dmTranscriptRows(
  groups: readonly MessageGroup[],
  queued: readonly DmQueued[] = [],
  // Streaming text that has not been attached to an assistant record yet.
  // Once a record exists, chatMessageGroupsAtomFamily already folds it in.
  liveTail: string | null = null
): DmRow[] {
  const rows: DmRow[] = [];
  let previous: { author: DmAuthor; at: number; day: string } | null = null;

  const pushMessage = (key: string, author: DmAuthor, at: Date, body: string) => {
    const text = body.trim();
    if (!text) return;
    const day = dayKey(at);
    if (previous === null || previous.day !== day) {
      rows.push({ kind: 'day', key: `day:${day}:${key}`, label: dayLabel(at) });
    }
    const continues =
      previous !== null &&
      previous.day === day &&
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
    if (group.type === 'dm_divider') {
      rows.push({
        kind: 'divider',
        key: `divider:${group.firstMessageIndex}`,
        harness: group.harness,
      });
      // The next message opens a new run, without repeating the day rule.
      if (previous) previous = { author: 'owner', at: 0, day: previous.day };
      continue;
    }
    const message = group.messages[0];
    if (!message || message.role === 'system') continue;
    const author: DmAuthor = message.role === 'user' ? 'owner' : 'buddy';
    const body = group.type === 'assistant' ? responseBody(group) : message.content;
    pushMessage(`m:${group.firstMessageIndex}`, author, new Date(message.timestamp), body);
  }
  if (liveTail && groups.at(-1)?.type !== 'assistant') {
    pushMessage('live', 'buddy', new Date(), liveTail);
  }
  for (const item of queued) {
    pushMessage(`q:${item.id}`, 'owner', new Date(item.queuedAt), item.content);
  }
  return rows;
}
