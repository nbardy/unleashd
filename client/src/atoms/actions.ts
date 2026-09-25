import type {
  ClientMessage,
  ConversationDetail,
  ConversationRow,
  Message,
  MessagePage,
  RowPatch,
  ServerMessage,
} from '@unleashd/shared';
import {
  ConversationDetailSchema,
  MessagePageSchema,
  applyDetailPatch,
  applyRowPatch,
  decodeRows,
} from '@unleashd/shared';
import { type Draft, enableMapSet } from 'immer';
import { newId } from '../utils/ids';
import { archivedBuddyIdsAtom, hideArchivedBuddy } from './buddy-visibility';
import {
  type Transcript,
  activeConversationIdAtom,
  conversationLoadCompleteAtom,
  conversationPatchAtom,
  conversationsAtom,
  defaultCwdAtom,
  detailPatchAtom,
  detailsAtom,
  forgetConversationAtoms,
  pendingConfigCommandsAtom,
  pendingCreationsAtom,
  protocolMismatchAtom,
  sendFnAtom,
  streamingContentAtom,
  streamingPatchAtom,
  transcriptPatchAtom,
  transcriptsAtom,
  wsStatusAtom,
} from './conversations';
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
import { invalidateBuddyResources, invalidateChannelResources } from './resources';
import {
  captureRestartRecoveryQueue,
  clearRestartRecovery,
  removeRestartRecoveryAtom,
} from './restart-recovery';
import { jotaiStore } from './store';
import {
  DRAFT_KEY_PREFIX,
  PENDING_FILES_KEY_PREFIX,
  getSavedActiveConversationId,
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
const transcriptRequests = new Map<string, Promise<void>>();
// Bumped on every `hello`: a response started under an older socket epoch is
// dropped instead of overwriting state the new epoch already delivered.
let connectionEpoch = 0;
const pendingMessageCommands = new Map<
  string,
  { resolve: () => void; reject: (error: Error) => void }
>();

function rejectPendingMessageCommands(error: Error): void {
  for (const pending of pendingMessageCommands.values()) pending.reject(error);
  pendingMessageCommands.clear();
}

// =============================================================================
// Row, detail and transcript writes. Each names the ids it touches, so the
// per-id atoms and the list index update for those ids only.
// =============================================================================

function putRows(rows: readonly ConversationRow[]): void {
  if (rows.length === 0) return;
  jotaiStore.set(conversationPatchAtom, {
    set: rows.map((row) => [row.id, row] as const),
    remove: [],
  });
}

function removeConversations(ids: readonly string[]): void {
  if (ids.length === 0) return;
  jotaiStore.set(conversationPatchAtom, { set: [], remove: ids });
  jotaiStore.set(detailPatchAtom, { set: [], remove: ids });
  jotaiStore.set(transcriptPatchAtom, { set: [], remove: ids });
}

function readTranscript(id: string): Transcript | null {
  return jotaiStore.get(transcriptsAtom).get(id) ?? null;
}

function putTranscript(id: string, transcript: Transcript): void {
  jotaiStore.set(transcriptPatchAtom, { set: [[id, transcript]], remove: [] });
}

/** Snapshot read for event handlers in components (never a subscription). */
export function readConversation(id: string): ConversationRow | null {
  return jotaiStore.get(conversationsAtom).get(id) ?? null;
}

/** Snapshot read of a loaded detail (never a subscription). */
export function readConversationDetail(id: string): ConversationDetail | null {
  return jotaiStore.get(detailsAtom).get(id) ?? null;
}

/** Snapshot read of a loaded transcript's messages (never a subscription). */
export function readConversationMessages(id: string): readonly Message[] {
  return readTranscript(id)?.messages ?? [];
}

// Loaded transcripts that a row says have moved on since they were fetched.
// They stay on screen (no "Loading…" flash) and page in their tail the next
// time they become active. Marking them unloaded instead made every reopened
// external chat show the loading screen (review of c21b131).
const staleTranscriptIds = new Set<string>();

function refreshIfStale(id: string): void {
  if (!staleTranscriptIds.has(id)) return;
  staleTranscriptIds.delete(id);
  void refreshTranscript(id).catch((error) => {
    console.warn(`[WS] Could not refresh history for ${id}:`, error);
  });
}

// =============================================================================
// On-demand bodies: detail + message pages (protocol v3)
// =============================================================================

const MESSAGE_PAGE_LIMIT = 500;

async function fetchJson<T>(
  url: string,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false; error: Error };
  }
): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request ${url} failed with HTTP ${response.status}`);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`Invalid response from ${url}: ${parsed.error.message}`);
  return parsed.data;
}

function messagesUrl(id: string, afterSeq: number): string {
  return `/api/conversations/${encodeURIComponent(id)}/messages?afterSeq=${afterSeq}&limit=${MESSAGE_PAGE_LIMIT}`;
}

/**
 * Every message with seq > afterSeq, paged. Restarts from the beginning when
 * the server's epoch moves mid-read (its history was replaced, not appended).
 */
async function readMessagesAfter(
  id: string,
  afterSeq: number
): Promise<{ epoch: number; messages: Message[] }> {
  let first: MessagePage | null = null;
  const messages: Message[] = [];
  let cursor = afterSeq;
  while (true) {
    const page = await fetchJson(messagesUrl(id, cursor), MessagePageSchema);
    if (first && page.epoch !== first.epoch) return readMessagesAfter(id, -1);
    first ??= page;
    messages.push(...page.messages);
    cursor += page.messages.length;
    if (page.messages.length === 0 || cursor + 1 >= page.total) {
      return { epoch: page.epoch, messages };
    }
  }
}

/**
 * Open a conversation: its detail and every message body. Deduped in flight
 * and epoch-guarded against reconnect; a transcript that a live event moved
 * past while loading pages in its tail afterwards.
 */
export function loadConversationDetails(conversationId: string): Promise<void> {
  const existing = transcriptRequests.get(conversationId);
  if (existing) return existing;

  const requestEpoch = connectionEpoch;
  const request = (async () => {
    const [detail, body] = await Promise.all([
      fetchJson(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
        ConversationDetailSchema
      ),
      readMessagesAfter(conversationId, -1),
    ]);
    if (requestEpoch !== connectionEpoch || !readConversation(conversationId)) return;
    jotaiStore.set(detailPatchAtom, { set: [[conversationId, detail]], remove: [] });
    putTranscript(conversationId, body);
    staleTranscriptIds.delete(conversationId);
    // Live events that raced the fetch: the row is authoritative on length.
    if (readConversation(conversationId)?.messageCount !== body.messages.length) {
      staleTranscriptIds.add(conversationId);
      queueMicrotask(() => refreshIfStale(conversationId));
    }
  })().finally(() => {
    // An old epoch may settle after reconnect installed a newer request.
    if (transcriptRequests.get(conversationId) === request) {
      transcriptRequests.delete(conversationId);
    }
  });

  transcriptRequests.set(conversationId, request);
  return request;
}

/**
 * Page in only what changed: the last message we hold (a streamed reply may
 * have grown) and everything after it. A different epoch means the history
 * was replaced, so the whole transcript reloads.
 */
function refreshTranscript(conversationId: string): Promise<void> {
  const current = readTranscript(conversationId);
  if (!current) return loadConversationDetails(conversationId);
  const existing = transcriptRequests.get(conversationId);
  if (existing) return existing;
  const requestEpoch = connectionEpoch;
  const keep = Math.max(0, current.messages.length - 1);
  const request = (async () => {
    const tail = await readMessagesAfter(conversationId, keep - 1);
    if (requestEpoch !== connectionEpoch) return;
    if (tail.epoch !== current.epoch) {
      transcriptRequests.delete(conversationId);
      jotaiStore.set(transcriptPatchAtom, { set: [], remove: [conversationId] });
      await loadConversationDetails(conversationId);
      return;
    }
    const latest = readTranscript(conversationId) ?? current;
    // Structural sharing: the kept prefix keeps its message objects, so only
    // the tail groups rebuild (T05's tail regroup).
    putTranscript(conversationId, {
      epoch: tail.epoch,
      messages: [...latest.messages.slice(0, keep), ...tail.messages],
    });
  })().finally(() => {
    if (transcriptRequests.get(conversationId) === request) {
      transcriptRequests.delete(conversationId);
    }
  });
  transcriptRequests.set(conversationId, request);
  return request;
}

function flushChunkBuffer(): void {
  chunkFlushScheduled = false;
  if (chunkBuffer.size === 0) return;

  const pending = new Map(chunkBuffer);
  chunkBuffer.clear();

  // Write to streamingContentAtom only — never to the rows or transcripts, so
  // the list views never see chunk updates. Chat merges the streaming text
  // into its message groups (chatMessageGroupsAtomFamily).
  const streaming = jotaiStore.get(streamingContentAtom);
  const updates: Array<readonly [string, string]> = [];
  for (const [id, text] of pending) {
    const lastMsg = readTranscript(id)?.messages.at(-1);
    if (lastMsg?.role !== 'assistant') continue;
    updates.push([id, (streaming.get(id) ?? '') + text]);
  }
  // Writes only the streaming conversations' own atoms.
  if (updates.length > 0) jotaiStore.set(streamingPatchAtom, { set: updates, remove: [] });
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

/**
 * The socket delivered another protocol's greeting (a v2 `init`): the backend
 * has not reloaded yet. Keep every row; useWebSocket reconnects.
 */
export function noteProtocolMismatch(serverVersion: number): void {
  jotaiStore.set(protocolMismatchAtom, { serverVersion });
}

// =============================================================================
// Public Actions — called by React components
// =============================================================================

export function setActiveConversationId(id: string | null): void {
  jotaiStore.set(activeConversationIdAtom, id);
  if (id !== null) refreshIfStale(id);
}

/**
 * Hide or unhide a conversation. Not optimistic: the server writes the record
 * and broadcasts a `done` patch, which is what moves the row. Callers disable
 * the control while disconnected — send() drops messages then.
 */
export function setConversationDone(conversationId: string, done: boolean): void {
  send({ type: 'set_conversation_done', conversationId, done });
}

export function stopConversation(conversationId: string): void {
  if (!readConversation(conversationId)) return;
  send({ type: 'stop_conversation', conversationId });
}

/**
 * End all work on a conversation. WebSocket messages are processed in order,
 * so pending work is cleared before the active provider process is stopped.
 */
export function endConversation(conversationId: string): void {
  if (!readConversation(conversationId)) return;
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
  if (!readConversation(conversationId))
    return Promise.reject(new Error(`Conversation ${conversationId} not found`));
  return sendAcknowledgedMessageCommand({ type: 'interrupt_and_send', conversationId, content });
}

export function queueMessage(conversationId: string, content: string): Promise<void> {
  return sendAcknowledgedMessageCommand({ type: 'queue_message', conversationId, content });
}

export async function resumeInterruptedMessages(
  conversationId: string,
  messages: readonly string[]
): Promise<void> {
  for (const content of messages) await queueMessage(conversationId, content);
}

export function cancelQueuedMessage(conversationId: string, messageId: string): void {
  send({ type: 'cancel_queued_message', conversationId, messageId });
}

export function promoteQueuedMessage(conversationId: string, messageId: string): void {
  send({ type: 'promote_queued_message', conversationId, messageId });
}

export function clearQueue(conversationId: string): void {
  send({ type: 'clear_queue', conversationId });
}

// =============================================================================
// WebSocket Message Handlers — one clean handler per ServerMessage variant
// Dispatcher stays thin (CLAUDE.md D1); work lives in handlers (D2).
// =============================================================================

function handleHello(data: Extract<ServerMessage, { type: 'hello' }>): void {
  jotaiStore.set(protocolMismatchAtom, null);
  jotaiStore.set(archivedBuddyIdsAtom, new Set(data.archivedBuddyIds));
  // A socket epoch ended without acknowledgements. Keep composer text and
  // let the user retry against the new authoritative server epoch.
  rejectPendingMessageCommands(new Error('Connection restarted before the message was accepted'));
  connectionEpoch += 1;
  transcriptRequests.clear();
  const rows = decodeRows(data);

  // During startup the server intentionally sends an early, possibly empty,
  // hello and hydrates disk conversations via later `rows` batches. Preserve
  // the prior epoch until that authoritative load completes; otherwise a
  // reload makes the sidebar flash empty and can evict the active
  // conversation while its replacement server is still restoring it.
  const serverState = data.loading
    ? new Map(jotaiStore.get(conversationsAtom))
    : new Map<string, ConversationRow>();
  for (const row of rows) serverState.set(row.id, row);

  // Reconcile client-owned pending creations without weakening the
  // authoritative row map with schema-incomplete stubs.
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
        createKind: pc.kind,
        createdAt: new Date(pc.createdAt),
        error: pc.error,
        errorCode: pc.errorCode,
      });
      setTimeout(() => resendPendingCreation(pc), 0);
    }
  }

  jotaiStore.set(defaultCwdAtom, data.defaultCwd);
  jotaiStore.set(conversationsAtom, serverState);
  // Details and bodies belong to the previous epoch; the open conversation
  // reloads them (ConversationView / Chat gate on the transcript).
  jotaiStore.set(detailsAtom, new Map());
  jotaiStore.set(transcriptsAtom, new Map());
  staleTranscriptIds.clear();
  jotaiStore.set(conversationLoadCompleteAtom, !data.loading);
  jotaiStore.set(pendingCreationsAtom, pendingState);
  // `hello` is an authoritative epoch after connect/reconnect. Config writes
  // are revision-checked and their result is already reflected in the
  // details, so an acknowledgement lost with the old socket must not leave
  // the UI in a permanent "Saving…" state.
  jotaiStore.set(pendingConfigCommandsAtom, new Map());

  // Drop stale streaming state from before this reconnect
  chunkBuffer.clear();
  jotaiStore.set(streamingContentAtom, new Map());
}

function handleRows(data: Extract<ServerMessage, { type: 'rows' }>): void {
  const rows = decodeRows(data);
  putRows(rows);
  // A row whose count differs from a loaded transcript means that history is
  // stale. The poller sends only rows (it used to push every growing external
  // transcript's full history to every client each 5s), so this is how an
  // open chat sees new external messages: the open conversation pages in its
  // tail, any other stale one does so when opened.
  markStale(rows);
  // Mark all updated conversations as seen to prevent stale NEW badges after
  // external JSONL edits. Conservative — better to miss a badge than show wrong one.
  const updates: Record<string, number> = {};
  for (const row of rows) {
    if (row.messageCount > 0) updates[row.id] = row.messageCount - 1;
  }
  markConversationsSeenBulk(updates);
  if (rows.some((row) => row.kind.t === 'buddy')) invalidateBuddyResources();
}

function markStale(rows: readonly ConversationRow[]): void {
  const active = jotaiStore.get(activeConversationIdAtom);
  for (const row of rows) {
    const transcript = readTranscript(row.id);
    if (!transcript || transcript.messages.length === row.messageCount) continue;
    staleTranscriptIds.add(row.id);
    // A failed refresh leaves the previous history on screen; the next row
    // with a moved count retries.
    if (row.id === active) refreshIfStale(row.id);
  }
}

function handleRemoved(data: Extract<ServerMessage, { type: 'removed' }>): void {
  for (const id of data.ids) forgetConversation(id);
}

function forgetConversation(id: string): void {
  // Read before the delete: the Buddy views that cache this conversation can
  // only be identified while the row is still here.
  const deleted = readConversation(id);
  removeConversations([id]);
  if (deleted?.kind.t === 'buddy') invalidateBuddyResources();
  if (jotaiStore.get(activeConversationIdAtom) === id) {
    jotaiStore.set(activeConversationIdAtom, null);
  }
  removePendingConversation(id);
  mutate(pendingCreationsAtom, (draft) => {
    draft.delete(id);
  });
  localStorage.removeItem(`${DRAFT_KEY_PREFIX}${id}`);
  localStorage.removeItem(`${PENDING_FILES_KEY_PREFIX}${id}`);
  clearRestartRecovery(id);
  removeRestartRecoveryAtom(id);
  removeSeenIndex(id);
  staleTranscriptIds.delete(id);
  // §5 #10 — atomFamily memoizes per-ID atoms forever; deleted conversations
  // leak one atom per family. Remove all families keyed by this id.
  forgetConversationAtoms(id);
}

function handleReady(data: Extract<ServerMessage, { type: 'ready' }>): void {
  const authoritativeIds = new Set(data.conversationIds);
  removeConversations(
    Array.from(jotaiStore.get(conversationsAtom).keys()).filter((id) => !authoritativeIds.has(id))
  );
  jotaiStore.set(conversationLoadCompleteAtom, true);
}

// Pattern: patches-not-snapshots (docs/patterns.md#patches-not-snapshots)
function handlePatch(data: Extract<ServerMessage, { type: 'patch' }>): void {
  const row = readConversation(data.id);
  if (row) {
    const next = applyRowPatch(row, data.patch);
    if (next !== row) putRows([next]);
  }
  const detail = readConversationDetail(data.id);
  if (detail) {
    const next = applyDetailPatch(detail, data.patch);
    if (next !== detail) jotaiStore.set(detailPatchAtom, { set: [[data.id, next]], remove: [] });
  }
  patchEffects(data.id, data.patch);
}

/** What a patch means beyond the field it sets (one handler per variant). */
function patchEffects(id: string, patch: RowPatch): void {
  switch (patch.t) {
    case 'run':
      runChanged(id, patch.run);
      return;
    case 'config':
      configLanded(patch.commandId);
      return;
    case 'queue':
      captureRestartRecoveryQueue(id, patch.queue);
      return;
    case 'activity':
      activityMoved(id, patch.messageCount);
      return;
    case 'done':
    case 'label':
    case 'session':
    case 'subagent':
    case 'turn':
      return;
  }
}

function runChanged(id: string, run: ConversationRow['run']): void {
  if (run === 'streaming') return;
  // Flush any pending chunks before clearing streaming state, otherwise a
  // pending rAF could re-add the entry we're about to delete.
  flushChunkBuffer();
  // Streaming stopped: the transcript already holds the committed text
  // (chunks and `message_complete` mirror the server's fold).
  jotaiStore.set(streamingPatchAtom, { set: [], remove: [id] });
}

function configLanded(commandId: string | null): void {
  if (commandId === null) return;
  mutate(pendingConfigCommandsAtom, (draft) => {
    draft.delete(commandId);
  });
}

function activityMoved(id: string, messageCount: number): void {
  const transcript = readTranscript(id);
  if (!transcript || transcript.messages.length === messageCount) return;
  staleTranscriptIds.add(id);
  if (id === jotaiStore.get(activeConversationIdAtom)) refreshIfStale(id);
}

function handleAck(data: Extract<ServerMessage, { type: 'ack' }>): void {
  switch (data.result.t) {
    case 'created':
      creationAcknowledged(data.commandId, decodeRows(data.result.rows));
      return;
    case 'accepted':
      messageCommandSettled(data.commandId, null);
      return;
    case 'rejected':
      commandRejected(data.commandId, data.result.error);
      return;
  }
}

function creationAcknowledged(commandId: string, rows: readonly ConversationRow[]): void {
  putRows(rows);
  for (const row of rows) {
    removePendingConversation(row.id, commandId);
    mutate(pendingCreationsAtom, (draft) => {
      const pending = draft.get(row.id);
      if (pending?.kind === 'create_conversation' && pending.commandId === commandId) {
        draft.delete(row.id);
      }
    });
    // A new conversation has an empty transcript: nothing to fetch.
    if (row.messageCount === 0 && !readTranscript(row.id)) {
      putTranscript(row.id, { epoch: 0, messages: [] });
      void loadDetailOnly(row.id);
    }
  }
  // A Buddy's detail bundle carries its conversation list, so a new Buddy
  // thread makes every cached Buddy view one row out of date.
  if (rows.some((row) => row.kind.t === 'buddy')) invalidateBuddyResources();
}

async function loadDetailOnly(id: string): Promise<void> {
  const requestEpoch = connectionEpoch;
  try {
    const detail = await fetchJson(
      `/api/conversations/${encodeURIComponent(id)}`,
      ConversationDetailSchema
    );
    if (requestEpoch !== connectionEpoch || !readConversation(id)) return;
    jotaiStore.set(detailPatchAtom, { set: [[id, detail]], remove: [] });
  } catch (error) {
    console.warn(`[WS] Could not load detail for ${id}:`, error);
  }
}

function messageCommandSettled(commandId: string, error: Error | null): boolean {
  const pending = pendingMessageCommands.get(commandId);
  if (!pending) return false;
  pendingMessageCommands.delete(commandId);
  if (error) pending.reject(error);
  else pending.resolve();
  return true;
}

function commandRejected(commandId: string, error: { code: string; message: string }): void {
  if (messageCommandSettled(commandId, new Error(error.message))) return;
  const pendingConfig = jotaiStore.get(pendingConfigCommandsAtom).get(commandId);
  if (pendingConfig?.kind === 'set_conversation_config') {
    mutate(pendingConfigCommandsAtom, (draft) => {
      const pending = draft.get(commandId);
      if (pending?.kind === 'set_conversation_config') pending.error = error.message;
    });
    return;
  }

  const pendingCreation = Array.from(jotaiStore.get(pendingCreationsAtom).values()).find(
    (creation) => creation.kind === 'create_conversation' && creation.commandId === commandId
  );
  if (pendingCreation) {
    markPendingCreationRejected(commandId, error.message, error.code);
    mutate(pendingCreationsAtom, (draft) => {
      const pending = draft.get(pendingCreation.conversationId);
      if (pending?.kind === 'create_conversation') {
        pending.error = error.message;
        pending.errorCode = error.code;
      }
    });
  }
}

function handleMessageEvent(data: Extract<ServerMessage, { type: 'message' }>): void {
  // Bodies are kept only for loaded transcripts; the row's activity patch
  // (sent with every message) carries the count for everyone else.
  const transcript = readTranscript(data.conversationId);
  if (!transcript) return;
  const lastMsg = transcript.messages.at(-1);
  // A duplicate assistant record; the live one is already growing.
  if (data.role === 'assistant' && lastMsg?.role === 'assistant') return;
  const newMessageIndex = transcript.messages.length;
  putTranscript(data.conversationId, {
    epoch: transcript.epoch,
    messages: [
      ...transcript.messages,
      { role: data.role, content: data.content, timestamp: new Date() },
    ],
  });
  if (getSavedActiveConversationId() === data.conversationId) {
    markMessagesSeen(data.conversationId, newMessageIndex);
  }
}

function handleChunk(data: Extract<ServerMessage, { type: 'chunk' }>): void {
  if (data.text.length > 0) {
    chunkBuffer.set(data.conversationId, (chunkBuffer.get(data.conversationId) ?? '') + data.text);
    scheduleChunkFlush();
  }
}

function handleError(data: Extract<ServerMessage, { type: 'error' }>): void {
  console.error('Server error:', data.message);
  // A generic protocol error must not strand the composer waiting forever or
  // discard the submitted draft.
  rejectPendingMessageCommands(new Error(data.message));
}

function handleMessageComplete(data: Extract<ServerMessage, { type: 'message_complete' }>): void {
  // Flush buffered chunks synchronously — message_complete can arrive in the same
  // event loop tick as the last chunk, before rAF fires.
  flushChunkBuffer();
  commitStreamedReply(data.conversationId, data.reason ?? 'success');
  const remaining = readConversationDetail(data.conversationId)?.queue.filter(
    (message) => message.status === 'pending'
  );
  if (remaining?.length) captureRestartRecoveryQueue(data.conversationId, remaining);
  else clearRestartRecovery(data.conversationId);
}

/**
 * Fold the streamed text into the transcript's last assistant message, as the
 * server did (chunks mirror its fold). v2 learned this from a full snapshot of
 * the conversation after every turn.
 */
function commitStreamedReply(id: string, reason: NonNullable<Message['completionReason']>): void {
  const transcript = readTranscript(id);
  const last = transcript?.messages.at(-1);
  if (!transcript || last?.role !== 'assistant') return;
  const streamed = jotaiStore.get(streamingContentAtom).get(id) ?? '';
  putTranscript(id, {
    epoch: transcript.epoch,
    messages: [
      ...transcript.messages.slice(0, -1),
      {
        ...last,
        content: last.content + streamed,
        completedAt: last.completedAt ?? new Date(),
        completionReason: last.completionReason ?? reason,
      },
    ],
  });
  jotaiStore.set(streamingPatchAtom, { set: [], remove: [id] });
}

// =============================================================================
// WebSocket Message Handler — thin dispatcher (D1)
// =============================================================================

export function handleMessage(data: ServerMessage): void {
  switch (data.type) {
    case 'buddy_archived':
      hideArchivedBuddy(data.buddyId);
      return;
    case 'buddies_changed':
      invalidateBuddyResources();
      return;
    case 'channel_changed':
      invalidateChannelResources(data.channelId);
      return;
    case 'hello':
      handleHello(data);
      return;
    case 'rows':
      handleRows(data);
      return;
    case 'removed':
      handleRemoved(data);
      return;
    case 'ready':
      handleReady(data);
      return;
    case 'patch':
      handlePatch(data);
      return;
    case 'ack':
      handleAck(data);
      return;
    case 'message':
      handleMessageEvent(data);
      return;
    case 'chunk':
      handleChunk(data);
      return;
    case 'error':
      handleError(data);
      return;
    case 'message_complete':
      handleMessageComplete(data);
      return;
  }
}

export type { Draft };
