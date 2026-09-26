import { type BuddyWorkerThread, BuddyWorkerThreadSchema, type Message } from '@unleashd/shared';
import { messageTranscriptContent } from './conversation-transcript';
import { splitStructuredMessageContent } from './structured-message-segments';
import { splitToolActivity } from './tool-activity-segments';

export type AssistantResponsePart =
  | { type: 'content'; key: string; message: Message }
  | {
      type: 'tool_calls';
      key: string;
      messages: Message[];
      count: number;
      workerThreads?: BuddyWorkerThread[];
    };

export type AssistantResponse = {
  type: 'assistant';
  messages: Message[];
  parts: AssistantResponsePart[];
  copyText: string;
  firstMessageIndex: number;
};

export type MessageGroup =
  | AssistantResponse
  | { type: 'single'; messages: Message[]; firstMessageIndex: number }
  | { type: 'dm_divider'; firstMessageIndex: number; harness: string | null };

/** Provider records are transcript fragments, not independently actionable chat bubbles.
 * One response owns their ordered parts, virtual item, heading and Copy action.
 * Completion metadata and widgets stay inside it; user/system records end it. */
export function groupChatMessages(
  messages: readonly Message[],
  prefix: string | null
): MessageGroup[] {
  return groupMessageRange(messages, prefix, 0);
}

/**
 * Group `messages`, where `messages[i]` is transcript record `firstIndex + i`.
 * Groups start at message boundaries (a user/system record, or the first
 * assistant record after one), so grouping from the first record of any group
 * gives exactly the groups a full pass gives from there on. That is what lets
 * the helpers below redo only the last group.
 */
function groupMessageRange(
  messages: readonly Message[],
  prefix: string | null,
  firstIndex: number
): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let response: AssistantResponse | undefined;
  const appendPart = (message: Message, key: string, count = 0) => {
    if (!response) return;
    if (count) {
      const last = response.parts.at(-1);
      if (last?.type === 'tool_calls') {
        last.messages.push(message);
        last.count += count;
      } else {
        response.parts.push({ type: 'tool_calls', key, messages: [message], count });
      }
    } else {
      response.parts.push({ type: 'content', key, message });
    }
  };
  const finishResponse = () => {
    if (response) response.copyText = response.messages.map(messageTranscriptContent).join('\n\n');
    response = undefined;
  };

  messages.forEach((message, localIndex) => {
    const index = firstIndex + localIndex;
    const msg =
      index === 0 && message.role === 'user' && prefix && message.content.startsWith(prefix)
        ? { ...message, content: message.content.slice(prefix.length).replace(/^\n\n/, '') }
        : message;
    if (msg.role !== 'assistant') {
      finishResponse();
      groups.push({ type: 'single', messages: [msg], firstMessageIndex: index });
      return;
    }
    if (!response) {
      response = {
        type: 'assistant',
        messages: [],
        parts: [],
        copyText: '',
        firstMessageIndex: index,
      };
      groups.push(response);
    }
    response.messages.push(msg);
    const appendOrdinary = (fragment: Message, key: string) => {
      // Tool input is literal data, never an interpreted widget.
      if (fragment.toolCall) appendPart(fragment, key, 1);
      else if (splitStructuredMessageContent(fragment.content).some((part) => part.type !== 'text'))
        appendPart(fragment, key);
      else
        splitToolActivity(fragment.content).forEach((part, partIndex) => {
          if (part.content.trim())
            appendPart(
              { ...fragment, content: part.content },
              `${key}:${partIndex}`,
              part.type === 'tool_calls' ? part.count : 0
            );
        });
    };
    if (msg.toolCall) {
      appendOrdinary(msg, `${index}:0`);
      return;
    }
    const marker = /<!--buddy_worker_thread:(.*?)-->/gs;
    let offset = 0;
    for (const match of msg.content.matchAll(marker)) {
      const start = match.index!;
      if (start > offset)
        appendOrdinary({ ...msg, content: msg.content.slice(offset, start) }, `${index}:${offset}`);
      try {
        const thread = BuddyWorkerThreadSchema.parse(JSON.parse(decodeURIComponent(match[1])));
        let last = response.parts.at(-1);
        if (last?.type !== 'tool_calls') {
          last = { type: 'tool_calls', key: `${index}:${start}`, messages: [], count: 0 };
          response.parts.push(last);
        }
        last.workerThreads ??= [];
        if (!last.workerThreads.some((item) => item.conversationId === thread.conversationId))
          last.workerThreads.push(thread);
      } catch {
        /* A malformed receipt must never become a link. */
      }
      offset = start + match[0].length;
    }
    if (offset < msg.content.length)
      appendOrdinary({ ...msg, content: msg.content.slice(offset) }, `${index}:${offset}`);
  });
  finishResponse();
  return groups;
}

/**
 * Regroup after `messages` replaced `previousMessages`. When every record
 * before the last group is the same object as before (records appended, or
 * the last response grew), only the last group is rebuilt and every earlier
 * group keeps its identity, so memoized rows skip. Otherwise, a full pass.
 */
export function regroupChatMessages(
  previousGroups: readonly MessageGroup[],
  previousMessages: readonly Message[],
  messages: readonly Message[],
  prefix: string | null
): MessageGroup[] {
  const tail = previousGroups.at(-1);
  if (!tail || messages.length < tail.firstMessageIndex) return groupChatMessages(messages, prefix);
  const start = tail.firstMessageIndex;
  for (let i = 0; i < start; i++) {
    if (messages[i] !== previousMessages[i]) return groupChatMessages(messages, prefix);
  }
  return [
    ...previousGroups.slice(0, -1),
    ...groupMessageRange(messages.slice(start), prefix, start),
  ];
}

/**
 * The settled groups with live streaming text appended to the last record.
 * Streaming only ever grows the last assistant response, so only the last
 * group is rebuilt; each animation frame used to regroup the whole
 * transcript and hand every group a new identity (03-app-core §6.2 #10).
 */
export function withStreamingTail(
  settled: MessageGroup[],
  messages: readonly Message[],
  streamingText: string,
  prefix: string | null
): MessageGroup[] {
  const last = messages.at(-1);
  const tail = settled.at(-1);
  if (!streamingText || !last || last.role !== 'assistant' || !tail) return settled;
  const window = messages.slice(tail.firstMessageIndex);
  window[window.length - 1] = { ...last, content: last.content + streamingText };
  return [...settled.slice(0, -1), ...groupMessageRange(window, prefix, tail.firstMessageIndex)];
}
