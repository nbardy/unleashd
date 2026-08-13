import {
  type BuddyContext,
  BuddyContextSchema,
  type ConversationConfig,
  ConversationConfigSchema,
  type CreateConversationCommand,
  type ModelId,
  type Provider,
  normalizeModelId,
} from '@unleashd/shared';
import { produce } from 'immer';
import { activeConversationIdAtom, pendingCreationsAtom, sendFnAtom } from './conversations';
import { jotaiStore } from './store';
import { PENDING_CONVERSATIONS_KEY } from './ui';

export type { BuddyContext } from '@unleashd/shared';

export interface PersistedPendingCreation {
  commandId: string;
  conversationId: string;
  workingDirectory: string;
  config: ConversationConfig;
  createdAt: string;
  swarmDebugPrefix?: string;
  resumedFromConversationId?: string;
  initialMessage?: string;
  buddyContext?: BuddyContext;
  error?: string;
  errorCode?: string;
}

interface PendingCreationStoreV2 {
  version: 2;
  creations: PersistedPendingCreation[];
}

export interface CreateConversationArgs {
  workingDirectory: string;
  config: ConversationConfig;
  swarmDebugPrefix?: string;
  resumedFromConversationId?: string;
  initialMessage?: string;
  buddyContext?: BuddyContext;
}

const PENDING_CREATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETRYABLE_CREATION_ERROR_CODES = new Set(['server_draining', 'server_starting']);
const LEGACY_RETRYABLE_CREATION_ERRORS = [
  'Backend reload is draining active turns; try again after reconnecting',
];

export function isRetryableCreationRejection(
  errorCode: string | undefined,
  error: string | undefined
): boolean {
  return (
    (errorCode !== undefined && RETRYABLE_CREATION_ERROR_CODES.has(errorCode)) ||
    (errorCode === undefined &&
      error !== undefined &&
      LEGACY_RETRYABLE_CREATION_ERRORS.includes(error))
  );
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
  if (
    typeof candidate.commandId !== 'string' ||
    typeof candidate.conversationId !== 'string' ||
    typeof candidate.workingDirectory !== 'string' ||
    !Number.isFinite(createdAt) ||
    Date.now() - createdAt > PENDING_CREATION_MAX_AGE_MS ||
    !config.success
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
    resumedFromConversationId:
      typeof candidate.resumedFromConversationId === 'string'
        ? candidate.resumedFromConversationId
        : undefined,
    initialMessage:
      typeof candidate.initialMessage === 'string' ? candidate.initialMessage : undefined,
    buddyContext: parseBuddyContext(candidate.buddyContext),
    error: typeof candidate.error === 'string' ? candidate.error : undefined,
    errorCode: typeof candidate.errorCode === 'string' ? candidate.errorCode : undefined,
  };
}

function parseBuddyContext(value: unknown): BuddyContext | undefined {
  const parsed = BuddyContextSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function migrateLegacyPendingConversation(value: unknown): PersistedPendingCreation | null {
  if (!value || typeof value !== 'object') return null;
  const legacy = value as {
    id?: string;
    workingDirectory?: string;
    provider?: Provider;
    model?: ModelId;
    createdAt?: string;
    swarmDebugPrefix?: string;
    resumedFromConversationId?: string;
    reasoningEffort?: string | null;
  };
  if (!legacy.id || !legacy.workingDirectory || !legacy.provider || !legacy.createdAt) return null;
  const model = normalizeModelId(legacy.provider, legacy.model);
  return {
    commandId: crypto.randomUUID(),
    conversationId: legacy.id,
    workingDirectory: legacy.workingDirectory,
    config: {
      provider: legacy.provider,
      model: model ? { mode: 'explicit', modelId: model } : { mode: 'default' },
      reasoning:
        legacy.reasoningEffort === null
          ? { mode: 'disabled' }
          : legacy.reasoningEffort === undefined
            ? { mode: 'default' }
            : { mode: 'explicit', effort: legacy.reasoningEffort },
    },
    createdAt: legacy.createdAt,
    swarmDebugPrefix: legacy.swarmDebugPrefix,
    resumedFromConversationId: legacy.resumedFromConversationId,
  };
}

function persistPendingConversations(creations: PersistedPendingCreation[]): void {
  if (creations.length === 0) {
    localStorage.removeItem(PENDING_CONVERSATIONS_KEY);
    return;
  }
  const store: PendingCreationStoreV2 = { version: 2, creations };
  localStorage.setItem(PENDING_CONVERSATIONS_KEY, JSON.stringify(store));
}

export function loadPendingConversations(): PersistedPendingCreation[] {
  const raw = localStorage.getItem(PENDING_CONVERSATIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PendingCreationStoreV2 | unknown[];
    const rawCreations =
      !Array.isArray(parsed) && parsed.version === 2 && Array.isArray(parsed.creations)
        ? parsed.creations
        : Array.isArray(parsed)
          ? parsed.map(migrateLegacyPendingConversation)
          : null;
    if (!rawCreations) throw new Error('Unsupported pending creation store');

    const creations = rawCreations
      .map(parsePersistedPendingCreation)
      .filter((value): value is PersistedPendingCreation => value !== null);
    if (Array.isArray(parsed) || creations.length !== rawCreations.length) {
      persistPendingConversations(creations);
    }
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
  if (!isRetryableCreationRejection(creation.errorCode, creation.error)) return creation;
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
    resumedFromConversationId: creation.resumedFromConversationId,
    buddyContext: creation.buddyContext,
  };
  jotaiStore.get(sendFnAtom).send(command);
}

export function resendPendingCreation(creation: PersistedPendingCreation): void {
  if (!creation.error) sendCreateCommand(creation);
}

export function createConversation(args: CreateConversationArgs): string {
  const conversationId = crypto.randomUUID();
  const commandId = crypto.randomUUID();
  const workingDirectory = normalizeWorkingDirectory(args.workingDirectory);
  const createdAt = new Date();
  const persisted: PersistedPendingCreation = {
    commandId,
    conversationId,
    workingDirectory,
    config: args.config,
    createdAt: createdAt.toISOString(),
    swarmDebugPrefix: args.swarmDebugPrefix,
    resumedFromConversationId: args.resumedFromConversationId,
    initialMessage: args.initialMessage,
    buddyContext: args.buddyContext,
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
        buddyContext: args.buddyContext,
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
