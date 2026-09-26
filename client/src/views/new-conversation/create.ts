import type { ConversationConfig } from '@unleashd/shared';
import { createConversation } from '../../atoms/actions';
import { setLastWorkingDirectory } from '../../atoms/ui';

/**
 * New-conversation create flow, shared by the desktop modal and the mobile
 * sheet (views/new-conversation/NewConversationForm).
 *
 * `CreateKind` selects the handler; `createFromRequest` is the thin
 * dispatcher; each handler has one semantic path. Both land on the core
 * `createConversation` action (WS `create_conversation` with a client-owned
 * id, so a dropped response replays instead of duplicating) — there is no
 * second creation spine.
 */

export type CreateKind = 'chat' | 'swarm';

export interface CreateRequest {
  kind: CreateKind;
  workingDirectory: string;
  config: ConversationConfig;
}

async function createChat(request: CreateRequest): Promise<string> {
  setLastWorkingDirectory(request.workingDirectory);
  return createConversation({
    workingDirectory: request.workingDirectory,
    config: request.config,
    kind: { t: 'chat' },
  });
}

async function createSwarm(request: CreateRequest): Promise<string> {
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
    kind: { t: 'chat' },
  });
}

const CREATE_HANDLERS: Record<CreateKind, (request: CreateRequest) => Promise<string>> = {
  chat: createChat,
  swarm: createSwarm,
};

/** Resolves to the new conversation id. Rejects with a typed Error on failure. */
export function createFromRequest(request: CreateRequest): Promise<string> {
  return CREATE_HANDLERS[request.kind](request);
}
