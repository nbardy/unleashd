import {
  type ConversationConfig,
  ConversationConfigSchema,
  type CreateConversationCommand,
  type CreateKind,
  CreateKindSchema,
} from '@unleashd/shared';
import { produce } from 'immer';
import { newId } from '../utils/ids';
import { activeConversationIdAtom, pendingCreationsAtom, sendFnAtom } from './conversations';
import { jotaiStore } from './store';
import { PENDING_CONVERSATIONS_KEY } from './ui';

export interface PersistedPendingCreation {
  commandId: string;
  conversationId: string;
  workingDirectory: string;
  config: ConversationConfig;
  createdAt: string;
  swarmDebugPrefix?: string;
  initialMessage?: string;
  /** chat | buddy{context} | fork{from}: the one kind encoding (T09). */
  kind: CreateKind;
  error?: string;
  errorCode?: string;
}

// v3 (T09, 2026-09-25): creations carry `kind`. Older stores are dropped, not
// migrated: a pending creation lives for the seconds before its ack, and its
// first message survives in the `draft:<id>` key.
interface PendingCreationStoreV3 {
  version: 3;
  creations: PersistedPendingCreation[];
}

export interface CreateConversationArgs {
  workingDirectory: string;
  config: ConversationConfig;
  swarmDebugPrefix?: string;
  initialMessage?: string;
  kind: CreateKind;
}

const PENDING_CREATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETRYABLE_CREATION_ERROR_CODES = new Set(['server_draining', 'server_starting']);

export function isRetryableCreationRejection(errorCode: string | undefined): boolean {
  return errorCode !== undefined && RETRYABLE_CREATION_ERROR_CODES.has(errorCode);
}

export function normalizeWorkingDirectory(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('~')) return trimmed.replace(/\/+$/, '') || '~';

  const withSingleSlashes = trimmed.replace(/\/+/g, '/');
  const hasLeadingSlash = withSingleSlashes.startsWith('/');
  const normalized: string[] = [];
  for (const segment of withSingleSlashes.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }

  if (hasLeadingSlash) {
    const rootPath = `/${normalized.join('/')}`;
    return rootPath === '/' ? '/' : rootPath.replace(/\/+$/, '');
  }
  return normalized.join('/') || '.';
}

function parsePersistedPendingCreation(value: unknown): PersistedPendingCreation | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PersistedPendingCreation>;
  const createdAt =
    typeof candidate.createdAt === 'string' ? Date.parse(candidate.createdAt) : Number.NaN;
  const config = ConversationConfigSchema.safeParse(candidate.config);
  const kind = CreateKindSchema.safeParse(candidate.kind);
  if (
    typeof candidate.commandId !== 'string' ||
    typeof candidate.conversationId !== 'string' ||
    typeof candidate.workingDirectory !== 'string' ||
    !Number.isFinite(createdAt) ||
    Date.now() - createdAt > PENDING_CREATION_MAX_AGE_MS ||
    !config.success ||
    !kind.success
  ) {
    return null;
  }
  return {
    commandId: candidate.commandId,
    conversationId: candidate.conversationId,
    workingDirectory: candidate.workingDirectory,
    config: config.data,
    createdAt: candidate.createdAt as string,
    swarmDebugPrefix:
      typeof candidate.swarmDebugPrefix === 'string' ? candidate.swarmDebugPrefix : undefined,
    initialMessage:
      typeof candidate.initialMessage === 'string' ? candidate.initialMessage : undefined,
    kind: kind.data,
    error: typeof candidate.error === 'string' ? candidate.error : undefined,
    errorCode: typeof candidate.errorCode === 'string' ? candidate.errorCode : undefined,
  };
}

function persistPendingConversations(creations: PersistedPendingCreation[]): void {
  if (creations.length === 0) {
    localStorage.removeItem(PENDING_CONVERSATIONS_KEY);
    return;
  }
  const store: PendingCreationStoreV3 = { version: 3, creations };
  localStorage.setItem(PENDING_CONVERSATIONS_KEY, JSON.stringify(store));
}

export function loadPendingConversations(): PersistedPendingCreation[] {
  const raw = localStorage.getItem(PENDING_CONVERSATIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<PendingCreationStoreV3>;
    if (parsed.version !== 3 || !Array.isArray(parsed.creations)) {
      throw new Error('Unsupported pending creation store');
    }
    const creations = parsed.creations
      .map(parsePersistedPendingCreation)
      .filter((value): value is PersistedPendingCreation => value !== null);
    if (creations.length !== parsed.creations.length) persistPendingConversations(creations);
    return creations;
  } catch {
    console.warn('[PendingConversations] Corrupt localStorage data — clearing');
    localStorage.removeItem(PENDING_CONVERSATIONS_KEY);
    return [];
  }
}

export function removePendingConversation(id: string, commandId?: string): void {
  const existing = loadPendingConversations();
  const pending = existing.filter(
    (creation) =>
      creation.conversationId !== id ||
      (commandId !== undefined && creation.commandId !== commandId)
  );
  if (pending.length !== existing.length) persistPendingConversations(pending);
}

export function markPendingCreationRejected(
  commandId: string,
  error: string,
  errorCode?: string
): void {
  const creations = loadPendingConversations();
  const creation = creations.find((candidate) => candidate.commandId === commandId);
  if (!creation) return;
  creation.error = error;
  creation.errorCode = errorCode;
  persistPendingConversations(creations);
}

/**
 * A reconnect establishes a new authoritative server epoch. Admission failures
 * from the previous draining/starting epoch may be retried with the original
 * idempotency identifiers; validation and provider failures must remain failed.
 */
export function preparePendingCreationForReconnect(
  creation: PersistedPendingCreation
): PersistedPendingCreation {
  if (!isRetryableCreationRejection(creation.errorCode)) return creation;
  return { ...creation, error: undefined, errorCode: undefined };
}

export function persistPendingCreationRetry(creation: PersistedPendingCreation): void {
  const creations = loadPendingConversations();
  const index = creations.findIndex((candidate) => candidate.commandId === creation.commandId);
  if (index === -1) return;
  creations[index] = creation;
  persistPendingConversations(creations);
}

function sendCreateCommand(creation: Omit<PersistedPendingCreation, 'createdAt' | 'error'>): void {
  const command: CreateConversationCommand = {
    type: 'create_conversation',
    commandId: creation.commandId,
    conversationId: creation.conversationId,
    workingDirectory: normalizeWorkingDirectory(creation.workingDirectory),
    config: creation.config,
    initialMessage: creation.initialMessage,
    swarmDebugPrefix: creation.swarmDebugPrefix,
    kind: creation.kind,
  };
  jotaiStore.get(sendFnAtom).send(command);
}

export function resendPendingCreation(creation: PersistedPendingCreation): void {
  if (!creation.error) sendCreateCommand(creation);
}

export function createConversation(args: CreateConversationArgs): string {
  const conversationId = newId();
  const commandId = newId();
  const workingDirectory = normalizeWorkingDirectory(args.workingDirectory);
  const createdAt = new Date();
  const persisted: PersistedPendingCreation = {
    commandId,
    conversationId,
    workingDirectory,
    config: args.config,
    createdAt: createdAt.toISOString(),
    swarmDebugPrefix: args.swarmDebugPrefix,
    initialMessage: args.initialMessage,
    kind: args.kind,
  };

  jotaiStore.set(
    pendingCreationsAtom,
    produce(jotaiStore.get(pendingCreationsAtom), (draft) => {
      draft.set(conversationId, {
        kind: 'create_conversation',
        commandId,
        conversationId,
        workingDirectory,
        config: args.config,
        createKind: args.kind,
        createdAt,
      });
    })
  );
  jotaiStore.set(activeConversationIdAtom, conversationId);

  const existing = loadPendingConversations();
  existing.push(persisted);
  persistPendingConversations(existing);
  sendCreateCommand(persisted);
  return conversationId;
}
