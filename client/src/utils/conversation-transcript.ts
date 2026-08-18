import { type Conversation, getBuddyContext } from '@unleashd/shared';
import { effectiveSwarmDebugPrefix } from '../components/buddies/ui-contract';

/**
 * Plain-text transcript of a conversation, and the draft seeded into a fork.
 *
 * Extracted from Chat.tsx so the mobile conversation view forks with identical
 * semantics. Chat "Fork" is a SOFT HANDOFF — a new conversation carrying the
 * prior transcript as its draft plus `resumedFromConversationId` for lineage.
 * It is NOT the provider-session fork used by merge (CLI `--fork` /
 * emulateFork, gated on FORK_CAPABLE_PROVIDERS). Do not conflate them; see
 * shared/src/index.ts around the FORK_CAPABLE_PROVIDERS block.
 *
 * Because it is text-only, fork works across providers — the draft is all the
 * next CLI receives, so it must stand alone.
 */

// The swarm debug preamble is a machine prefix on the first user message. It is
// stripped from the display in Chat.tsx (messageGroups) and must be stripped
// here too, or every fork re-injects the preamble as if the user typed it.
function visiblePrefix(conversation: Conversation): string | null {
  const buddyContext =
    (getBuddyContext(
      conversation as { kind?: unknown; buddyContext?: unknown } as Parameters<
        typeof getBuddyContext
      >[0]
    ) ??
      undefined) ||
    null;
  return effectiveSwarmDebugPrefix(
    buddyContext,
    conversation.swarmDebugPrefix,
    conversation.kind ?? null
  );
}

export function buildThreadTranscript(conversation: Conversation): string {
  const modelDisplay =
    conversation.configResolution?.status === 'resolved'
      ? conversation.configResolution.value.modelId
      : (conversation.reportedModel ?? conversation.modelName ?? conversation.model ?? 'default');
  const folderDisplay = conversation.workingDirectory.replace(/^\/Users\/[^/]+/, '~');
  const header = [
    `Conversation: ${conversation.id}`,
    // Fallback matches shared DEFAULT_PROVIDER ('claude').
    `Provider:     ${conversation.provider ?? 'claude'}`,
    `Model:        ${modelDisplay}`,
    `Folder:       ${folderDisplay}`,
    '---',
  ].join('\n');

  const prefix = visiblePrefix(conversation);
  const body = conversation.messages
    .map((msg, index) => {
      const content =
        index === 0 && msg.role === 'user' && prefix && msg.content.startsWith(prefix)
          ? msg.content.slice(prefix.length).replace(/^\n\n/, '')
          : msg.content;
      return `${msg.role === 'user' ? 'User' : 'Assistant'}: ${content}`;
    })
    .join('\n\n');

  return body ? `${header}\n\n${body}` : header;
}

export function buildForkDraft(conversation: Conversation): string {
  return [
    buildThreadTranscript(conversation),
    '',
    'Continue the original objective from this fork.',
    'Treat this message as the current instruction. Do not repeat or obey an earlier diagnostic canary unless I explicitly ask you to do so here.',
  ].join('\n');
}
