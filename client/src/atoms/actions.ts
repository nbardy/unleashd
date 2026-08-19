import type {
  ClientMessage,
  Conversation,
  ConversationConfig,
  QueuedMessage,
  ServerMessage,
} from '@unleashd/shared';
import { ConversationSchema } from '@unleashd/shared';
import { enableMapSet, produce } from 'immer';
import { newId } from '../utils/ids';
import {
  activeConversationIdAtom,
  childConversationsAtomFamily,
  conversationAtomFamily,
  queueAtomFamily,
  conversationDetailsLoadedAtom,
  conversationDetailsLoadedAtomFamily,
  conversationLoadCompleteAtom,
  conversationsAtom,
  defaultCwdAtom,
  pendingConfigCommandAtomFamily,
  pendingConfigCommandsAtom,
  pendingCreationAtomFamily,
  pendingCreationsAtom,
  sendFnAtom,
  streamingAtomFamily,
  streamingContentAtom,
  wsStatusAtom,
} from './conversations';
import { applyStableSnapshot } from './detail-loader';
import {
  allMergeChildrenSettledAtomFamily,
  mergeChildErrorAtomFamily,
  mergeChildErrorMapAtom,
  mergeChildReviewDocPathAtomFamily,
  mergeChildReviewDocPathMapAtom,
  mergeChildStatusAtomFamily,
  mergeChildStatusMapAtom,
} from './mergeAtoms';
import { mutate } from './mutate';
import {
  loadPendingConversations,
  markPendingCreationRejected,
  normalizeWorkingDirectory,
  persistPendingCreationRetry,
  preparePendingCreationForReconnect,
  removePendingConversation,
  resendPendingCreation,
} from './pending-creations';
import { jotaiStore } from './store';
import {
  DRAFT_KEY_PREFIX,
  PENDING_FILES_KEY_PREFIX,
  getSavedActiveConversationId,
  hydrateUiFromServer,
  markConversationsSeenBulk,
  markMessagesSeen,
  removeSeenIndex,
} from './ui';

// Enable Immer's Map/Set support — must be called once before any produce() on Maps.
// mutate.ts also calls enableMapSet; this is idempotent and keeps this file standalone.
enableMapSet();

// Re-export for downstream consumers that previously imported from conversationStore
export type { QueuedMessage } from '@unleashd/shared';
export { createConversation } from './pending-creations';
export type { CreateConversationArgs } from './pending-creations';
export { mutate } from './mutate';

// =============================================================================
// Chunk Buffer
//
// Text chunks arrive 100-200x per response (1-20 chars each). Without buffering,
// each chunk would trigger a Jotai notification → React re-render → Markdown reparse.
// Instead, accumulate in a plain object outside state and flush once per animation
// frame (~60Hz). This collapses 100-200 updates into ~3-10 per response.
// =============================================================================

const chunkBuffer: Map<string, string> = new Map();
let chunkFlushScheduled = false;
const conversationDetailRequests = new Map<string, Promise<void>>();
let conversationDetailEpoch = 0;
const pendingMessageCommands = new Map<
  string,
  { resolve: () => void; reject: (error: Error) => void }
>();

function rejectPendingMessageCommands(error: Error): void {
  for (const pending of pendingMessageCommands.values()) pending.reject(error);
  pendingMessageCommands.clear();
}

function markConversationDetailsLoaded(ids: Iterable<string>): void {
  const next = new Set(jotaiStore.get(conversationDetailsLoadedAtom));
  for (const id of ids) next.add(id);
  jotaiStore.set(conversationDetailsLoadedAtom, next);
}

/**
 * Replace one authoritative conversation snapshot while preserving the only
 * client-only field carried on the record. Whole-record replacement does not
 * need Immer; cloning the Map gives Jotai the structural change it subscribes
 * to and keeps this boundary readable at call sites.
 */
function replaceConversationSnapshot(snapshot: Conversation): void {
  const conversations = jotaiStore.get(conversationsAtom);
  const existing = conversations.get(snapshot.id);
  const next = new Map(conversations);
  next.set(snapshot.id, {
    ...snapshot,
    swarmDebugPrefix: snapshot.swarmDebugPrefix ?? existing?.swarmDebugPrefix ?? null,
  });
  jotaiStore.set(conversationsAtom, next);
}

export function loadConversationDetails(conversationId: string): Promise<void> {
  const existing = conversationDetailRequests.get(conversationId);
  if (existing) return existing;

  const requestEpoch = conversationDetailEpoch;
  const request = (async () => {
    await applyStableSnapshot(
      () =>
        requestEpoch === conversationDetailEpoch
          ? jotaiStore.get(conversationsAtom).get(conversationId)
          : undefined,
      async () => {
        const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`);
        if (!response.ok) {
          throw new Error(`Conversation detail request failed with HTTP ${response.status}`);
        }
        const parsed = ConversationSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new Error(`Invalid conversation detail: ${parsed.error.message}`);
        }
        return parsed.data;
      },
      (snapshot) => {
        replaceConversationSnapshot(snapshot);
        markConversationDetailsLoaded([conversationId]);
      }
    );
  })().finally(() => {
    // An old epoch may settle after reconnect installed a newer request.
    if (conversationDetailRequests.get(conversationId) === request) {
      conversationDetailRequests.delete(conversationId);
    }
  });

  conversationDetailRequests.set(conversationId, request);
  return request;
}

function flushChunkBuffer(): void {
  chunkFlushScheduled = false;
  if (chunkBuffer.size === 0) return;

  const pending = new Map(chunkBuffer);
  chunkBuffer.clear();

  // Write to streamingContentAtom only — never to conversationsAtom.
  // Sidebar/Gallery subscribe to allConversationsAtom (derived from conversationsAtom)
  // and therefore never see chunk updates. Chat.tsx merges streamingContent at render time.
  const conversations = jotaiStore.get(conversationsAtom);
  const next = produce(jotaiStore.get(streamingContentAtom), (draft) => {
    for (const [id, text] of pending) {
      const conv = conversations.get(id);
      if (!conv || conv.messages.length === 0) continue;
      const lastMsg = conv.messages[conv.messages.length - 1];
      if (lastMsg.role !== 'assistant') continue;
      draft.set(id, (draft.get(id) ?? '') + text);
    }
  });

  // Only notify if something actually changed
  if (next !== jotaiStore.get(streamingContentAtom)) {
    jotaiStore.set(streamingContentAtom, next);
  }
}

function scheduleChunkFlush(): void {
  if (!chunkFlushScheduled) {
    chunkFlushScheduled = true;
    requestAnimationFrame(flushChunkBuffer);
  }
}

// =============================================================================
// Helper: read the current send function
// =============================================================================

function send(msg: ClientMessage): void {
  jotaiStore.get(sendFnAtom).send(msg);
}

// =============================================================================
// WebSocket Status
// =============================================================================

export function setWsStatus(status: 'connecting' | 'connected' | 'disconnected'): void {
  jotaiStore.set(wsStatusAtom, status);
}

export function setSendFn(fn: (msg: ClientMessage) => void): void {
  jotaiStore.set(sendFnAtom, { send: fn });
}

// =============================================================================
// Public Actions — called by React components
// =============================================================================

export function setActiveConversationId(id: string | null): void {
  jotaiStore.set(activeConversationIdAtom, id);
}

/**
 * Merge feature: POST /api/conversations/merge. Server mints the parent id
 * and per-child ids/review UUIDs, creates everything, spawns forks, then
 * broadcasts conversations_updated + merge_child_status events. Returns the
 * parent id so the caller can navigate to the new thread.
 */
export async function createMergeConversations(args: {
  parentConfig: ConversationConfig;
  workingDirectory: string;
  sourceIds: string[];
}): Promise<{
  parentId: string;
  children: Array<{ sourceId: string; childId: string; reviewUuid: string }>;
}> {
  const res = await fetch('/api/conversations/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'merge failed' }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function deleteConversation(id: string): void {
  send({ type: 'delete_conversation', conversationId: id });
}

export function sendMessage(conversationId: string, content: string): Promise<void> {
  const conv = jotaiStore.get(conversationsAtom).get(conversationId);
  if (!conv) {
    console.warn(`[Send] Cannot send message: conversation ${conversationId} not found`);
    return Promise.reject(new Error(`Conversation ${conversationId} not found`));
  }
  return queueMessage(conversationId, content);
}

export function stopConversation(conversationId: string): void {
  const conv = jotaiStore.get(conversationsAtom).get(conversationId);
  if (!conv) return;
  send({ type: 'stop_conversation', conversationId });
}

/**
 * End all work on a conversation. WebSocket messages are processed in order,
 * so pending work is cleared before the active provider process is stopped.
 */
export function endConversation(conversationId: string): void {
  const conv = jotaiStore.get(conversationsAtom).get(conversationId);
  if (!conv) return;
  send({ type: 'clear_queue', conversationId });
  send({ type: 'stop_conversation', conversationId });
}

function sendAcknowledgedMessageCommand(
  message:
    | { type: 'queue_message'; conversationId: string; content: string }
    | { type: 'interrupt_and_send'; conversationId: string; content: string }
): Promise<void> {
  const commandId = newId();
  return new Promise<void>((resolve, reject) => {
    pendingMessageCommands.set(commandId, { resolve, reject });
    send({ ...message, commandId });
  });
}

export function interruptAndSend(conversationId: string, content: string): Promise<void> {
  const conv = jotaiStore.get(conversationsAtom).get(conversationId);
  if (!conv) return Promise.reject(new Error(`Conversation ${conversationId} not found`));
  return sendAcknowledgedMessageCommand({ type: 'interrupt_and_send', conversationId, content });
}

export function queueMessage(conversationId: string, content: string): Promise<void> {
  return sendAcknowledgedMessageCommand({ type: 'queue_message', conversationId, content });
}

export function cancelQueuedMessage(conversationId: string, messageId: string): void {
  send({ type: 'cancel_queued_message', conversationId, messageId });
}

export function clearQueue(conversationId: string): void {
  send({ type: 'clear_queue', conversationId });
}

export function getQueue(conversationId: string): QueuedMessage[] {
  return jotaiStore.get(conversationsAtom).get(conversationId)?.queue ?? [];
}

// =============================================================================
// WebSocket Message Handlers — one clean handler per ServerMessage variant
// Dispatcher stays thin (CLAUDE.md D1); work lives in handlers (D2).
// Partial collection updates go through mutate(); scalar/full-replace stays
// plain jotaiStore.set (AGENTS.md mutation rule).
// =============================================================================

function handleInit(data: Extract<ServerMessage, { type: 'init' }>): void {
  // A socket epoch ended without acknowledgements. Keep composer text and
  // let the user retry against the new authoritative server epoch.
  rejectPendingMessageCommands(new Error('Connection restarted before the message was accepted'));
  console.log(`[WS] init: ${data.conversations.length} conversations`);
  conversationDetailEpoch += 1;
  conversationDetailRequests.clear();

  // Total wipe and replace. Server is the absolute epoch.
  const serverState = new Map<string, Conversation>();
  for (let i = 0; i < data.conversations.length; i++) {
    const conv = data.conversations[i];
    serverState.set(conv.id, conv);
  }

  // Reconcile client-owned pending creations without weakening the
  // authoritative Conversation map with schema-incomplete stubs.
  const pendingState = new Map<string, import('./conversations').PendingConversationCreation>();
  for (const persistedCreation of loadPendingConversations()) {
    const pc = preparePendingCreationForReconnect(persistedCreation);
    if (serverState.has(pc.conversationId)) {
      removePendingConversation(pc.conversationId, pc.commandId);
    } else {
      if (pc !== persistedCreation) persistPendingCreationRetry(pc);
      pendingState.set(pc.conversationId, {
        kind: 'create_conversation',
        commandId: pc.commandId,
        conversationId: pc.conversationId,
        workingDirectory: normalizeWorkingDirectory(pc.workingDirectory),
        config: pc.config,
        buddyContext: pc.buddyContext,
        createdAt: new Date(pc.createdAt),
        error: pc.error,
        errorCode: pc.errorCode,
      });
      setTimeout(() => resendPendingCreation(pc), 0);
    }
  }

  jotaiStore.set(defaultCwdAtom, data.defaultCwd);
  jotaiStore.set(conversationsAtom, serverState);
  jotaiStore.set(
    conversationDetailsLoadedAtom,
    data.summaries ? new Set() : new Set(data.conversations.map((conversation) => conversation.id))
  );
  jotaiStore.set(conversationLoadCompleteAtom, data.loading !== true);
  jotaiStore.set(pendingCreationsAtom, pendingState);
  // `init` is an authoritative epoch after connect/reconnect. Config writes
  // are revision-checked and their result is already reflected in these
  // snapshots, so an acknowledgement lost with the old socket must not
  // leave the UI in a permanent "Saving…" state.
  jotaiStore.set(pendingConfigCommandsAtom, new Map());

  // Apply server UI state preferences
  if (data.uiState) {
    hydrateUiFromServer(data.uiState);
  }

  // Drop stale streaming state from before this reconnect
  chunkBuffer.clear();
  jotaiStore.set(streamingContentAtom, new Map());
}

function handleConversationCreated(
  data: Extract<ServerMessage, { type: 'conversation_created' }>
): void {
  replaceConversationSnapshot(data.conversation);
  markConversationDetailsLoaded([data.conversation.id]);
  removePendingConversation(data.conversation.id, data.commandId);
  mutate(pendingCreationsAtom, (draft) => {
    const pending = draft.get(data.conversation.id);
    if (pending?.kind === 'create_conversation' && pending.commandId === data.commandId) {
      draft.delete(data.conversation.id);
    }
  });
}

function handleConversationUpdated(
  data: Extract<ServerMessage, { type: 'conversation_updated' }>
): void {
  replaceConversationSnapshot(data.conversation);
  markConversationDetailsLoaded([data.conversation.id]);
  if (data.commandId) {
    mutate(pendingConfigCommandsAtom, (draft) => {
      draft.delete(data.commandId as string);
    });
  }
}

function handleCommandRejected(data: Extract<ServerMessage, { type: 'command_rejected' }>): void {
  const authoritativeConversation = data.authoritativeConversation;
  if (authoritativeConversation) {
    replaceConversationSnapshot(authoritativeConversation);
    markConversationDetailsLoaded([authoritativeConversation.id]);
  }
  const message = data.error.message;
  const pendingMessageCommand = pendingMessageCommands.get(data.commandId);
  if (pendingMessageCommand) {
    pendingMessageCommands.delete(data.commandId);
    pendingMessageCommand.reject(new Error(message));
    return;
  }
  const pendingConfig = jotaiStore.get(pendingConfigCommandsAtom).get(data.commandId);
  if (pendingConfig?.kind === 'set_conversation_config') {
    mutate(pendingConfigCommandsAtom, (draft) => {
      const pending = draft.get(data.commandId);
      if (pending?.kind === 'set_conversation_config') pending.error = message;
    });
    return;
  }

  const pendingCreation = Array.from(jotaiStore.get(pendingCreationsAtom).values()).find(
    (creation) => creation.kind === 'create_conversation' && creation.commandId === data.commandId
  );
  if (pendingCreation) {
    markPendingCreationRejected(data.commandId, message, data.error.code);
    mutate(pendingCreationsAtom, (draft) => {
      const pending = draft.get(pendingCreation.conversationId);
      if (pending?.kind === 'create_conversation') {
        pending.error = message;
        pending.errorCode = data.error.code;
      }
    });
  }
}

function handleCommandAccepted(data: Extract<ServerMessage, { type: 'command_accepted' }>): void {
  const pendingMessageCommand = pendingMessageCommands.get(data.commandId);
  if (pendingMessageCommand) {
    pendingMessageCommands.delete(data.commandId);
    pendingMessageCommand.resolve();
  }
}

function handleSessionBound(data: Extract<ServerMessage, { type: 'session_bound' }>): void {
  console.log(`[WS] session_bound: UI ${data.conversationId} -> CLI ${data.sessionId}`);
  mutate(conversationsAtom, (draft) => {
    const conv = draft.get(data.conversationId);
    if (conv) conv.sessionId = data.sessionId;
  });
}

function handleConversationDeleted(
  data: Extract<ServerMessage, { type: 'conversation_deleted' }>
): void {
  mutate(conversationsAtom, (draft) => {
    draft.delete(data.conversationId);
  });
  const loadedDetails = new Set(jotaiStore.get(conversationDetailsLoadedAtom));
  loadedDetails.delete(data.conversationId);
  jotaiStore.set(conversationDetailsLoadedAtom, loadedDetails);
  const currentActive = jotaiStore.get(activeConversationIdAtom);
  if (currentActive === data.conversationId) {
    jotaiStore.set(activeConversationIdAtom, null);
  }
  removePendingConversation(data.conversationId);
  mutate(pendingCreationsAtom, (draft) => {
    draft.delete(data.conversationId);
  });
  localStorage.removeItem(`${DRAFT_KEY_PREFIX}${data.conversationId}`);
  localStorage.removeItem(`${PENDING_FILES_KEY_PREFIX}${data.conversationId}`);
  removeSeenIndex(data.conversationId);
  // §5 #10 — atomFamily memoizes per-ID atoms forever; deleted conversations
  // leak one atom per family. Remove all families keyed by this id.
  conversationAtomFamily.remove(data.conversationId);
  streamingAtomFamily.remove(data.conversationId);
  conversationDetailsLoadedAtomFamily.remove(data.conversationId);
  pendingCreationAtomFamily.remove(data.conversationId);
  pendingConfigCommandAtomFamily.remove(data.conversationId);
  childConversationsAtomFamily.remove(data.conversationId);
  queueAtomFamily.remove(data.conversationId);
  mergeChildStatusAtomFamily.remove(data.conversationId);
  mergeChildReviewDocPathAtomFamily.remove(data.conversationId);
  mergeChildErrorAtomFamily.remove(data.conversationId);
  allMergeChildrenSettledAtomFamily.remove(data.conversationId);
}

function handleMessageEvent(data: Extract<ServerMessage, { type: 'message' }>): void {
  console.log(`[WS] message event: role=${data.role}, content="${data.content.substring(0, 50)}"`);
  let newMessageIndex: number | null = null;

  mutate(conversationsAtom, (draft) => {
    const conv = draft.get(data.conversationId);
    if (!conv) return;

    const lastMsg = conv.messages[conv.messages.length - 1];
    if (data.role === 'assistant' && lastMsg?.role === 'assistant') {
      console.log('[WS] Skipping duplicate assistant message');
      return;
    }

    newMessageIndex = conv.messages.length;
    console.log(`[WS] Adding message #${newMessageIndex + 1} (role=${data.role})`);
    conv.messages.push({ role: data.role, content: data.content, timestamp: new Date() });
  });

  if (newMessageIndex !== null) {
    const activeId = getSavedActiveConversationId();
    if (activeId === data.conversationId) {
      markMessagesSeen(data.conversationId, newMessageIndex);
    }
  }
}

function handleChunk(data: Extract<ServerMessage, { type: 'chunk' }>): void {
  if (data.text.length > 0) {
    chunkBuffer.set(data.conversationId, (chunkBuffer.get(data.conversationId) ?? '') + data.text);
    scheduleChunkFlush();
  }
}

function handleStatus(data: Extract<ServerMessage, { type: 'status' }>): void {
  const conversations = jotaiStore.get(conversationsAtom);
  const conv = conversations.get(data.conversationId);
  if (!conv) return;

  // Flush any pending chunks before clearing streaming state,
  // otherwise a pending rAF could re-add the entry we're about to delete.
  if (!data.isStreaming) {
    flushChunkBuffer();
  }

  const streamingContent = jotaiStore.get(streamingContentAtom);

  mutate(conversationsAtom, (draft) => {
    const c = draft.get(data.conversationId);
    if (c) {
      c.isRunning = data.isRunning;
      c.isStreaming = data.isStreaming;
    }
  });

  // If streaming stopped, nuke the transient streaming buffer.
  // The committed truth will come via conversations_updated.
  if (!data.isStreaming && streamingContent.has(data.conversationId)) {
    mutate(streamingContentAtom, (draft) => {
      draft.delete(data.conversationId);
    });
  }
}

function handleError(data: Extract<ServerMessage, { type: 'error' }>): void {
  console.error('Server error:', data.message);
  // Backward compatibility for a draining server from before correlated
  // message commands: its generic protocol error still must not strand the
  // composer waiting forever or discard the submitted draft.
  rejectPendingMessageCommands(new Error(data.message));
}

function handleMessageComplete(_data: Extract<ServerMessage, { type: 'message_complete' }>): void {
  // Flush buffered chunks synchronously — message_complete can arrive in the same
  // event loop tick as the last chunk, before rAF fires.
  flushChunkBuffer();
}

function handleConversationsUpdated(
  data: Extract<ServerMessage, { type: 'conversations_updated' }>
): void {
  console.log(`[WS] conversations_updated: ${data.conversations.length} changed`);
  const loadedDetails = jotaiStore.get(conversationDetailsLoadedAtom);
  mutate(conversationsAtom, (draft) => {
    for (const conv of data.conversations) {
      // Preserve client-only swarmDebugPrefix — the disk poller doesn't
      // persist it, so the server sends null. Without this merge the
      // prefix vanishes after every poll cycle.
      const existing = draft.get(conv.id);
      draft.set(conv.id, {
        ...conv,
        messages:
          data.summaries && existing && loadedDetails.has(conv.id)
            ? existing.messages
            : conv.messages,
        swarmDebugPrefix: conv.swarmDebugPrefix ?? existing?.swarmDebugPrefix ?? null,
      });
    }
  });
  if (!data.summaries) {
    markConversationDetailsLoaded(data.conversations.map((conversation) => conversation.id));
  }
  // Mark all updated conversations as seen to prevent stale NEW badges after
  // external JSONL edits. Conservative — better to miss a badge than show wrong one.
  const updates: Record<string, number> = {};
  for (const conv of data.conversations) {
    const messageCount = conv.messageCount ?? conv.messages.length;
    if (messageCount > 0) updates[conv.id] = messageCount - 1;
  }
  markConversationsSeenBulk(updates);
}

function handleConversationLoadComplete(
  _data: Extract<ServerMessage, { type: 'conversation_load_complete' }>
): void {
  jotaiStore.set(conversationLoadCompleteAtom, true);
}

function handleMergeChildStatus(
  data: Extract<ServerMessage, { type: 'merge_child_status' }>
): void {
  // Review child has settled. Write status (complete | error) + optional
  // doc path so the progress strip chip in the parent's Chat updates and
  // the tooltip can fetch the doc.
  mutate(mergeChildStatusMapAtom, (draft) => {
    draft.set(data.childConversationId, data.status);
  });
  if (data.reviewDocPath) {
    mutate(mergeChildReviewDocPathMapAtom, (draft) => {
      draft.set(data.childConversationId, data.reviewDocPath as string);
    });
  }
  if (data.errorMessage) {
    mutate(mergeChildErrorMapAtom, (draft) => {
      draft.set(data.childConversationId, data.errorMessage as string);
    });
  }
}

function handleQueueUpdated(data: Extract<ServerMessage, { type: 'queue_updated' }>): void {
  mutate(conversationsAtom, (draft) => {
    const conv = draft.get(data.conversationId);
    if (conv) conv.queue = data.queue;
  });
}

function handleSubagentStart(data: Extract<ServerMessage, { type: 'subagent_start' }>): void {
  console.log(
    `[WS] subagent_start: ${data.subAgent.id.substring(0, 8)} - "${data.subAgent.description.substring(0, 30)}"`
  );
  mutate(conversationsAtom, (draft) => {
    const conv = draft.get(data.conversationId);
    if (conv) {
      conv.subAgents = [...conv.subAgents, data.subAgent].slice(-10);
    }
  });
}

function handleSubagentUpdate(data: Extract<ServerMessage, { type: 'subagent_update' }>): void {
  console.log(
    `[WS] subagent_update: ${data.subAgentId.substring(0, 8)} - action: ${data.currentAction || 'none'}`
  );
  mutate(conversationsAtom, (draft) => {
    const conv = draft.get(data.conversationId);
    if (!conv) return;
    const agent = conv.subAgents.find((a) => a.id === data.subAgentId);
    if (!agent) return;
    if (data.toolUses !== undefined) agent.toolUses = data.toolUses;
    if (data.tokens !== undefined) agent.tokens = data.tokens;
    if (data.currentAction !== undefined) agent.currentAction = data.currentAction;
    if (data.status !== undefined) agent.status = data.status;
    if (data.rawStatus !== undefined) agent.rawStatus = data.rawStatus;
    if (data.statusSource !== undefined) agent.statusSource = data.statusSource;
  });
}

function handleSubagentComplete(data: Extract<ServerMessage, { type: 'subagent_complete' }>): void {
  console.log(
    `[WS] subagent_complete: ${data.subAgentId.substring(0, 8)} - status: ${data.status}`
  );
  mutate(conversationsAtom, (draft) => {
    const conv = draft.get(data.conversationId);
    if (!conv) return;
    const agent = conv.subAgents.find((a) => a.id === data.subAgentId);
    if (!agent) return;
    agent.status = data.status;
    agent.completedAt = data.completedAt;
    if (data.status === 'error') {
      agent.currentAction = 'Error';
    } else if (!agent.currentAction) {
      agent.currentAction = 'Done';
    }
  });
}

// =============================================================================
// WebSocket Message Handler — thin dispatcher (D1)
// =============================================================================

export function handleMessage(data: ServerMessage): void {
  switch (data.type) {
    case 'init':
      return handleInit(data);
    case 'conversation_created':
      return handleConversationCreated(data);
    case 'conversation_updated':
      return handleConversationUpdated(data);
    case 'command_rejected':
      return handleCommandRejected(data);
    case 'command_accepted':
      return handleCommandAccepted(data);
    case 'session_bound':
      return handleSessionBound(data);
    case 'conversation_deleted':
      return handleConversationDeleted(data);
    case 'message':
      return handleMessageEvent(data);
    case 'chunk':
      return handleChunk(data);
    case 'status':
      return handleStatus(data);
    case 'error':
      return handleError(data);
    case 'message_complete':
      return handleMessageComplete(data);
    case 'conversations_updated':
      return handleConversationsUpdated(data);
    case 'conversation_load_complete':
      return handleConversationLoadComplete(data);
    case 'merge_child_status':
      return handleMergeChildStatus(data);
    case 'queue_updated':
      return handleQueueUpdated(data);
    case 'subagent_start':
      return handleSubagentStart(data);
    case 'subagent_update':
      return handleSubagentUpdate(data);
    case 'subagent_complete':
      return handleSubagentComplete(data);
    default: {
      // Exhaustive check: warn on unknown message types so new server
      // events don't silently disappear during development.
      console.warn(`[WS] Unhandled message type: ${(data as Record<string, unknown>).type}`);
      break;
    }
  }
}
