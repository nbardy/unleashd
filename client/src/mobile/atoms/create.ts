import type { ConversationConfig } from '@unleashd/shared';
import { createConversation } from '../../atoms/actions';
export { createBuddyViaBuilder } from '../../components/buddies/create-buddy-builder';
import { setLastWorkingDirectory } from '../../atoms/ui';

/**
 * Mobile create flow — canonical request + type-directed dispatch.
 *
 * Mobile v1 shipped with no create affordance at all: every list page was
 * read-only and the empty states told you to go use the desktop app. These are
 * the actions behind the "+ New" buttons that closed that gap.
 *
 * `MobileCreateRequest` is the sum type; `createFromRequest` is the thin
 * dispatcher; each handler below has one semantic path. Both handlers land on
 * the same core `createConversation` action (WS `create_conversation` with a
 * client-owned id, so a dropped response replays instead of duplicating) —
 * mobile adds no second creation spine.
 */

export type MobileCreateKind = 'chat' | 'swarm';

export interface MobileCreateRequest {
  kind: MobileCreateKind;
  workingDirectory: string;
  config: ConversationConfig;
}

async function createChat(request: MobileCreateRequest): Promise<string> {
  setLastWorkingDirectory(request.workingDirectory);
  return createConversation({
    workingDirectory: request.workingDirectory,
    config: request.config,
  });
}

async function createSwarm(request: MobileCreateRequest): Promise<string> {
  // Same endpoint the desktop swarm button uses. The prefix is a debug preamble
  // the server derives from the repo; without it the conversation is a plain
  // chat, so a failure here must surface rather than silently degrade (T4).
  const response = await fetch(
    `/api/oompa-swarm-context?dir=${encodeURIComponent(request.workingDirectory)}`
  );
  const payload = (await response.json().catch(() => ({}))) as {
    prefix?: string;
    error?: string;
  };
  if (!response.ok || !payload.prefix) {
    throw new Error(payload.error ?? `Failed to load swarm context (HTTP ${response.status})`);
  }

  setLastWorkingDirectory(request.workingDirectory);
  return createConversation({
    workingDirectory: request.workingDirectory,
    config: request.config,
    swarmDebugPrefix: payload.prefix,
  });
}

const CREATE_HANDLERS: Record<MobileCreateKind, (request: MobileCreateRequest) => Promise<string>> =
  {
    chat: createChat,
    swarm: createSwarm,
  };

/** Resolves to the new conversation id. Rejects with a typed Error on failure. */
export function createFromRequest(request: MobileCreateRequest): Promise<string> {
  return CREATE_HANDLERS[request.kind](request);
}
