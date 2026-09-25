import type { ConversationDetail, ConversationRow, Message } from '@unleashd/shared';
import { shortenHomePath } from './directories';

/**
 * Plain-text transcript of a conversation, and the draft seeded into a fork.
 *
 * Extracted from Chat.tsx so the mobile conversation view forks with identical
 * semantics. Chat "Fork" is a SOFT HANDOFF — a new conversation carrying the
 * prior transcript as its draft, created with `kind: {t:'fork', from}` for
 * lineage. The server upgrades the first send to a provider-session fork (CLI
 * `--fork` / emulateFork) only for same-provider FORK_CAPABLE_PROVIDERS pairs;
 * see shared/src/index.ts around the FORK_CAPABLE_PROVIDERS block.
 *
 * Because it is text-only, fork works across providers — the draft is all the
 * next CLI receives, so it must stand alone.
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
