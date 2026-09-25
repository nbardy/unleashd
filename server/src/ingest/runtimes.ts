/**
 * Runtimes built from durable records, never from transcripts.
 *
 * Why this exists (T13b S2): the TS loader parsed the newest 500 transcripts into runtimes and
 * recovered app-created records beside them. Bodies now come from the ingest store
 * (conversation-list.ts), so a runtime is only the record plus the live-turn state:
 *  - at boot, every app-created record (`user` / `legacy_inferred`) becomes one, as before (Buddy
 *    seats, pending first messages and forks are looked up by id);
 *  - any other listed conversation becomes one on first use (opened, or sent a command), from its
 *    record and the store's session rows. Before this, a conversation outside the 500-row window
 *    404'd on open (S1 gap). Guard: server/test/ingest-history.test.ts.
 */

import type { SubAgent as NativeSubAgent, SessionRow } from '@unleashd/ingest';
import type { BuddyContext, ConversationRow, SubAgent } from '@unleashd/shared';
import { encodeRows } from '@unleashd/shared';
import type { ConversationRegistry } from '../application/context';
import type { MemoryGenerationInput } from '../buddies/turn-policy';
import type { ConversationRecord, ConversationRecordStore } from '../conversations/config-records';
import type { ConversationConfigService } from '../conversations/config-service';
import type {
  ConversationBroadcast,
  ConversationOptions,
  ConversationRuntime,
} from '../conversations/runtime';
import type { JoinedConversation } from './conversation-list';

const RECOVERY_CONCURRENCY = 16;
const ROW_BATCH = 100;

export interface RuntimeBuilderDependencies {
  registry: ConversationRegistry<ConversationRuntime>;
  records: Pick<ConversationRecordStore, 'getByConversationId' | 'listSummaries'>;
  configService: Pick<ConversationConfigService, 'hydrate'>;
  /** The list's join of a record with its sessions (undefined before the list booted). */
  joined(conversationId: string): JoinedConversation | undefined;
  createConversation(options: ConversationOptions): ConversationRuntime;
  resolveBuddyConversation(context: BuddyContext): Promise<{
    context: BuddyContext;
    briefing: string;
    memoryGeneration?: MemoryGenerationInput | null;
  }>;
  dispatchInitialMessage(conversation: ConversationRuntime): Promise<void>;
  broadcast(data: ConversationBroadcast): void;
  logger?: Pick<Console, 'error' | 'log' | 'warn'>;
}

export interface RuntimeBuilder {
  /** Boot: a runtime for every app-created record. */
  recover(): Promise<void>;
  /** The runtime of a conversation, built from its record on first use. */
  materialize(conversationId: string): Promise<ConversationRuntime | undefined>;
}

/** A sub-agent the transcript recorded: finished by definition (no process is running it). */
function recordedSubAgent(agent: NativeSubAgent, session: SessionRow): SubAgent {
  const startedAt = new Date(agent.startedAt ?? session.createdAt);
  return {
    id: agent.id,
    description: agent.description,
    status: 'completed',
    toolUses: agent.toolUses,
    tokens: 0,
    ...(agent.currentAction ? { currentAction: agent.currentAction } : {}),
    startedAt,
    completedAt: agent.completedAt !== undefined ? new Date(agent.completedAt) : startedAt,
  };
}

function normalizeMemoryGeneration(value: MemoryGenerationInput | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

async function forEachConcurrently<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export function createRuntimeBuilder(dependencies: RuntimeBuilderDependencies): RuntimeBuilder {
  const logger = dependencies.logger ?? console;
  const building = new Map<string, Promise<ConversationRuntime | undefined>>();

  async function build(record: ConversationRecord): Promise<ConversationRuntime | null> {
    const joined = dependencies.joined(record.conversationId);
    const workingDirectory = record.workingDirectory ?? joined?.row?.cwd;
    if (!workingDirectory) return null;
    const hydrated = await dependencies.configService.hydrate({
      conversationId: record.conversationId,
      sessionBindings: [],
      discoveredKind: record.kind,
      legacy: {
        provider: record.config.provider,
        reportedModel: record.lastResolvedConfig?.modelId,
        source: 'external_session',
      },
    });
    const currentSession =
      hydrated.record.currentSession?.provider === hydrated.state.config.provider
        ? hydrated.record.currentSession
        : undefined;
    // A conversation with a current provider session is a resumed one, not a new
    // memory-generation boundary: no briefing is injected on rebuild. A fresh record that has not
    // started a provider session still needs the latest generation for its pending first message.
    const buddy =
      record.kind.t === 'buddy' && !currentSession
        ? await dependencies.resolveBuddyConversation(record.kind.context).catch((error) => {
            logger.warn(`[buddies] Could not rebuild ${record.conversationId} briefing:`, error);
            return null;
          })
        : null;
    const sessions = joined?.sessions ?? [];
    const current =
      sessions.find((session) => session.sessionId === currentSession?.sessionId) ??
      sessions.at(-1);
    const conversation = dependencies.createConversation({
      id: record.conversationId,
      workingDirectory,
      configState: hydrated.state,
      done: hydrated.record.done,
      existingSessionId: currentSession?.sessionId,
      existingSessionAudienceKey: currentSession?.buddyAudienceKey,
      // Provider-counted context measured before the restart keeps the meter honest.
      existingProviderUsage: currentSession?.latestUsage ?? null,
      swarmDebugPrefix: record.creation?.swarmDebugPrefix ?? current?.swarmDebugPrefix ?? null,
      resumedFromConversationId:
        record.creation?.resumedFromConversationId ?? joined?.row?.resumedFrom ?? null,
      parentConversationId: joined?.row?.parent ?? null,
      observedModel: current?.observedModel ?? null,
      title: current?.title ?? null,
      kind:
        record.kind.t === 'buddy' && buddy
          ? { ...record.kind, context: buddy.context }
          : record.kind,
      buddyBriefing: buddy?.briefing ?? null,
      buddyMemoryGeneration: normalizeMemoryGeneration(buddy?.memoryGeneration),
    });
    // The record's (or, for a discovered record, the transcript's) birth: the runtime's
    // `new Date()` default sorted the oldest history to the top as "1m ago".
    conversation.createdAt = new Date(joined?.row?.createdAt ?? record.createdAt);
    conversation.subAgents = current
      ? current.subAgents.map((agent) => recordedSubAgent(agent, current))
      : [];
    return conversation;
  }

  /** One build per id at a time; a runtime registered meanwhile (a create command) wins. */
  function register(
    conversationId: string,
    read: () => Promise<ConversationRecord | undefined>
  ): Promise<ConversationRuntime | undefined> {
    const existing = dependencies.registry.get(conversationId);
    if (existing) return Promise.resolve(existing);
    const inFlight = building.get(conversationId);
    if (inFlight) return inFlight;
    const promise = (async () => {
      const record = await read();
      if (!record || record.status !== 'active') return undefined;
      const conversation = await build(record);
      if (!conversation) return undefined;
      const raced = dependencies.registry.get(conversationId);
      if (raced) return raced;
      dependencies.registry.set(conversation);
      return conversation;
    })().finally(() => building.delete(conversationId));
    building.set(conversationId, promise);
    return promise;
  }

  function materialize(conversationId: string): Promise<ConversationRuntime | undefined> {
    return register(conversationId, () => dependencies.records.getByConversationId(conversationId));
  }

  async function recover(): Promise<void> {
    const summaries = await dependencies.records.listSummaries();
    // A discovered record is a sidecar for a transcript, not evidence of an app conversation: it
    // becomes a runtime only when used (5,275 empty "New conversation" rows came from recovering
    // them eagerly on 2026-09-06).
    const appCreated = summaries.filter(
      (summary) => summary.status === 'active' && summary.provenance !== 'external_discovered'
    );
    const rows: ConversationRow[] = [];
    const flush = () => {
      const batch = rows.splice(0);
      if (batch.length > 0) dependencies.broadcast({ type: 'rows', ...encodeRows(batch) });
    };
    await forEachConcurrently(appCreated, RECOVERY_CONCURRENCY, async (summary) => {
      // Per-record isolation: this runs inside the startup barrier, and one unreadable record
      // used to exit the process (incident 2026-08-20).
      try {
        if (dependencies.registry.has(summary.conversationId)) return;
        const record = await dependencies.records.getByConversationId(summary.conversationId);
        const conversation = await register(summary.conversationId, async () => record);
        if (!conversation) return;
        rows.push(conversation.toRow());
        if (rows.length >= ROW_BATCH) flush();
        // Absent or already dispatched never becomes pending again, so only a pending one pays
        // the claim (two record reads).
        const creation = record?.creation;
        if (creation?.initialMessage && !creation.initialMessageDispatchedAt) {
          await dependencies.dispatchInitialMessage(conversation);
        }
      } catch (error) {
        logger.error(`Failed to recover conversation ${summary.conversationId}:`, error);
      }
    });
    flush();
    logger.log(`Recovered ${dependencies.registry.size} app conversations from their records`);
  }

  return { recover, materialize };
}
