import type { DiskAdapter, ParsedSession } from './disk-adapter';
import { MUSE_SESSIONS_DIR, getMuseSessionFiles, parseMuseSessionFile } from './jsonl';

/**
 * Muse adapter — reads ~/.local/share/muse/sessions/YYYY/MM/DD/{sessionId}/session.jsonl
 * and rehydrates conversations via the shared ParsedSession → Conversation path.
 *
 * Discovery scans all *.jsonl/*.json under MUSE_SESSIONS_DIR (recursive, includes subagent
 * sessions as separate files but they are filtered by empty-message check in loader).
 * Parsing reuses the Muse durable JSONL parsing in jsonl.ts (which handles
 * stream.id, route_facts cwd, model, timestamps, messages, and durable buddyContext).
 * Hidden buddy prefix fallback is handled downstream in sessionToConversation via
 * extractBuddyContext on messages.
 */
export const museAdapter: DiskAdapter = {
  provider: 'muse',

  async discoverFiles(): Promise<string[]> {
    return getMuseSessionFiles(MUSE_SESSIONS_DIR);
  },

  async parseFile(filePath: string): Promise<ParsedSession | null> {
    const session = await parseMuseSessionFile(filePath);
    if (session.messages.length === 0) return null;

    return {
      sessionId: session.sessionId,
      filePath: session.filePath,
      workingDirectory: session.workingDirectory,
      provider: 'muse',
      model: session.model,
      createdAt: session.createdAt,
      modifiedAt: session.modifiedAt,
      messages: session.messages,
      subAgents: [],
      parentSessionId: null,
      kind: session.kind ?? null,
      buddyContext: session.buddyContext,
      swarmDebugPrefix: session.swarmDebugPrefix,
      resumedFromConversationId: session.resumedFromConversationId,
      purpose: session.purpose,
    };
  },
};
