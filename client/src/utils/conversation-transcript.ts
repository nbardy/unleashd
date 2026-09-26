import type { ConversationDetail, ConversationRow, Message } from '@unleashd/shared';
import { shortenHomePath } from './directories';

/**
 * Plain-text transcript and the fork draft, shared by both trees. Fork is a soft handoff: a new
 * conversation whose draft carries the transcript, so it must stand alone across providers. See
 * docs/client-rationale.md#fork-transcript.
 */

/** An open conversation: its row, its loaded detail and its loaded bodies. */
export interface OpenConversation {
  row: ConversationRow;
  detail: ConversationDetail;
  messages: readonly Message[];
}

export function messageTranscriptContent(message: Message): string {
  return message.toolCall?.input
    ? `${message.content}\n\n${message.toolCall.input}`
    : message.content;
}

export function buildThreadTranscript({ row, detail, messages }: OpenConversation): string {
  // The server's resolution is the model; the client never re-derives it (T09).
  const resolution = detail.config.resolution;
  const modelDisplay =
    resolution.status === 'resolved'
      ? resolution.value.modelId
      : (resolution.lastResolved?.modelId ?? detail.latestTurn.observedModel ?? 'default');
  const header = [
    `Conversation: ${row.id}`,
    `Provider:     ${row.provider}`,
    `Model:        ${modelDisplay}`,
    `Folder:       ${shortenHomePath(row.cwd)}`,
    '---',
  ].join('\n');

  // The swarm debug preamble is a machine prefix on the first user message
  // (the server sets it only on chats). Strip it here too, or every fork
  // re-injects the preamble as if the user typed it.
  const prefix = detail.swarmDebugPrefix;
  const body = messages
    .map((msg, index) => {
      const content =
        index === 0 && msg.role === 'user' && prefix && msg.content.startsWith(prefix)
          ? msg.content.slice(prefix.length).replace(/^\n\n/, '')
          : messageTranscriptContent(msg);
      return `${msg.role === 'user' ? 'User' : 'Assistant'}: ${content}`;
    })
    .join('\n\n');

  return body ? `${header}\n\n${body}` : header;
}

export function buildForkDraft(conversation: OpenConversation): string {
  return [
    buildThreadTranscript(conversation),
    '',
    'Continue the original objective from this fork.',
  ].join('\n');
}
