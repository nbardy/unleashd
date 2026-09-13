import type { Message } from '@unleashd/shared';
import { messageTranscriptContent } from './conversation-transcript';
import { splitStructuredMessageContent } from './structured-message-segments';
import { splitToolActivity } from './tool-activity-segments';

export type AssistantResponsePart =
  | { type: 'content'; key: string; message: Message }
  | { type: 'tool_calls'; key: string; messages: Message[]; count: number };

export type AssistantResponse = {
  type: 'assistant';
  messages: Message[];
  parts: AssistantResponsePart[];
  copyText: string;
  firstMessageIndex: number;
};

export type MessageGroup =
  | AssistantResponse
  | { type: 'single'; messages: Message[]; firstMessageIndex?: number };

/** Provider records are transcript fragments, not independently actionable chat bubbles.
 * One response owns their ordered parts, virtual item, heading and Copy action.
 * Completion metadata and widgets stay inside it; user/system records end it. */
export function groupChatMessages(messages: Message[], prefix: string | null): MessageGroup[] {
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

  messages.forEach((message, index) => {
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
    // Keep interactive payloads intact. Tool input is separate, literal data and
    // must never be interpreted as prose or a widget marker.
    if (splitStructuredMessageContent(msg.content).some((part) => part.type !== 'text')) {
      appendPart(msg, `${index}:0`);
    } else if (msg.toolCall) {
      appendPart(msg, `${index}:0`, 1);
    } else {
      splitToolActivity(msg.content).forEach((part, partIndex) => {
        appendPart(
          { ...msg, content: part.content },
          `${index}:${partIndex}`,
          part.type === 'tool_calls' ? part.count : 0
        );
      });
    }
  });
  finishResponse();
  return groups;
}
