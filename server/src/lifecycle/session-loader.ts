import type {
  BuddyContext,
  Conversation as ConversationData,
  DiscoveredConversation,
  Message,
  PersistedConversationConfigRecord,
} from '@unleashd/shared';
import { conversationKindFromLegacy } from '@unleashd/shared';
import { validate as isUuid } from 'uuid';
import type {
  PollResult,
  SessionHistoryOptions,
  SessionHistorySource,
} from '../adapters/disk-adapter';
import type { loadAllConversations } from '../adapters/loader';
import { forEachWithConcurrency } from '../adapters/loader';
import type {
  CompletionSuppression,
  ConversationRegistry,
  ExternalActivity,
  SessionTracking,
} from '../application/context';
import {
  type ConversationConfigService,
  ConversationTombstonedError,
  type HydratedConversationConfig,
} from '../conversations/config-service';
import type { ConversationConfigStore } from '../conversations/config-store';
import type {
  ConversationBroadcast,
  ConversationOptions,
  ConversationRuntime,
  MemoryGenerationInput,
} from '../conversations/runtime';
import { extractBuddyMemorySnapshot } from '../conversations/runtime';
import { summarizeConversation } from '../conversations/serialization';
import { createFilePoller } from './file-poller';
import { loadProgressively } from './progressive-loader';
import { mergeSessionMessages } from './session-history';

const RECOVERY_CONCURRENCY = 16;

export interface SessionLoaderOptions {
  startupLimit: number;
  startupConcurrency: number;
  startupBatchSize: number;
  startupInitialBatchSize: number;
  startupLogEveryFiles: number;
  pollIntervalMs: number;
  externalGraceMs: number;
  verbose: boolean;
}

export interface SessionLoaderDependencies {
  options: SessionLoaderOptions;
  registry: ConversationRegistry<ConversationRuntime>;
  sessions: SessionTracking;
  externalActivity: ExternalActivity;
  completionSuppression: CompletionSuppression;
  configStore: ConversationConfigStore;
  configService: ConversationConfigService;
  loadConversations: typeof loadAllConversations;
  pollConversations(
    mtimes: Map<string, number>,
    activeIds: Set<string>,
    options: SessionHistoryOptions
  ): Promise<PollResult>;
  createConversation(options: ConversationOptions): ConversationRuntime;
  createId(): string;
  resolveBuddyConversation(context: BuddyContext): Promise<{
    context: BuddyContext;
    briefing: string;
    memoryGeneration?: MemoryGenerationInput | null;
  }>;
  dispatchInitialMessage(conversation: ConversationRuntime): Promise<void>;
  persistCurrentSession(conversation: ConversationRuntime, sessionId: string): Promise<void>;
  broadcast(data: ConversationBroadcast): void;
  logger?: Pick<Console, 'error' | 'log' | 'warn'>;
}

export interface SessionLoader {
  loadExistingConversations(): Promise<void>;
  startFilePolling(): NodeJS.Timeout;
}

function normalizeMemoryGeneration(value: MemoryGenerationInput | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function createSessionLoader(dependencies: SessionLoaderDependencies): SessionLoader {
  const logger = dependencies.logger ?? console;
  let fileMtimes = new Map<string, number>();
  const nativeSources = new Map<string, DiscoveredConversation>();
  const boundSessionIds = new Map<string, Set<string>>();
  const startupRuntimes = new WeakSet<ConversationRuntime>();

  function sourceKey(source: { provider: string; sessionId: string }): string {
    return `${source.provider}:${source.sessionId}`;
  }

  function rememberSources(source: SessionHistorySource): void {
    for (const related of source.boundSessionSources ?? [])
      nativeSources.set(sourceKey(related), related);
    const { boundSessionSources: _related, ...current } = source;
    nativeSources.set(sourceKey(source), current);
  }

  async function resolveSessionBindings(source: DiscoveredConversation) {
    const record = await dependencies.configStore.findBySession(source.provider, source.sessionId);
    if (!record || record.status !== 'active') return [];
    return rememberBindings(record);
  }

  function rememberBindings(record: PersistedConversationConfigRecord) {
    const bindings = [
      ...record.sessionBindings,
      ...(record.currentSession ? [record.currentSession] : []),
    ];
    const unique = [...new Map(bindings.map((binding) => [sourceKey(binding), binding])).values()];
    boundSessionIds.set(record.conversationId, new Set(unique.map((binding) => binding.sessionId)));
    return unique;
  }

  function restoreDisplayHistory(
    conversation: ConversationRuntime,
    record: PersistedConversationConfigRecord,
    source: DiscoveredConversation
  ): void {
    const bindings = rememberBindings(record);
    const sources = bindings
      .map((binding) => nativeSources.get(sourceKey(binding)))
      .filter((entry): entry is DiscoveredConversation => entry !== undefined);
    if (sources.length === 0) sources.push(source);
    // Native rows replace matching live turns. Unmatched turns survive when
    // a bound transcript is missing or its latest provider flush is partial.
    conversation.messages = mergeSessionMessages(
      sources.map((entry) => entry.messages),
      conversation.messages
    );
    // Discovered sidecars historically used import time. The earliest native
    // birth corrects those records, while an app-created durable date survives rotation.
    conversation.createdAt =
      record.provenance === 'external_discovered'
        ? new Date(
            Math.min(
              ...[record.createdAt, ...sources.map((entry) => entry.createdAt)]
                .map((date) => new Date(date).getTime())
                .filter(Number.isFinite)
            )
          )
        : new Date(record.createdAt);
  }

  function findBySessionId(sessionId: string): ConversationRuntime | undefined {
    const direct = dependencies.registry.get(sessionId);
    if (direct) {
      dependencies.sessions.registerAlias(sessionId, direct.id);
      return direct;
    }
    const mappedId = dependencies.sessions.aliasFor(sessionId);
    if (mappedId) {
      const mapped = dependencies.registry.get(mappedId);
      if (mapped) {
        dependencies.sessions.registerAlias(sessionId, mapped.id);
        return mapped;
      }
      dependencies.sessions.unregisterAlias(sessionId);
    }
    for (const conversation of dependencies.registry.values()) {
      if (conversation.sessionId !== sessionId) continue;
      dependencies.sessions.registerAlias(sessionId, conversation.id);
      return conversation;
    }
    return undefined;
  }

  function findByCurrentSessionId(sessionId: string): ConversationRuntime | undefined {
    for (const conversation of dependencies.registry.values()) {
      if (conversation.sessionId === sessionId) return conversation;
    }
    return undefined;
  }

  function resolveParentConversationId(parentSessionId: string | null | undefined): string | null {
    if (!parentSessionId) return null;
    return findBySessionId(parentSessionId)?.id ?? parentSessionId;
  }

  async function hydrate(source: SessionHistorySource): Promise<ConversationRuntime | null> {
    rememberSources(source);
    const sessionId = source.sessionId;
    const existingRecord = await dependencies.configStore.findBySession(source.provider, sessionId);
    const currentSource =
      existingRecord?.currentSession && nativeSources.get(sourceKey(existingRecord.currentSession));
    if (currentSource && sourceKey(currentSource) !== sourceKey(source))
      return hydrate(currentSource);
    let conversationId =
      existingRecord?.conversationId ?? (isUuid(sessionId) ? sessionId : dependencies.createId());
    if (existingRecord?.status === 'active' && !isUuid(existingRecord.conversationId)) {
      const replacementId = dependencies.createId();
      await dependencies.configStore.rekeyConversation(
        existingRecord.conversationId,
        replacementId
      );
      conversationId = replacementId;
    }

    let hydratedConfig: HydratedConversationConfig;
    try {
      hydratedConfig = await dependencies.configService.hydrate({
        conversationId,
        sessionBindings: [{ provider: source.provider, sessionId }],
        currentSession: { provider: source.provider, sessionId },
        workingDirectory: source.workingDirectory,
        legacy: {
          provider: source.provider,
          reportedModel: source.modelName ?? source.model,
          reasoningEffort: source.reasoningEffort,
          source: 'external_session',
        },
      });
    } catch (error) {
      if (error instanceof ConversationTombstonedError) return null;
      throw error;
    }

    const currentSession = hydratedConfig.record.currentSession;
    rememberBindings(hydratedConfig.record);
    const existing = dependencies.registry.get(hydratedConfig.record.conversationId);
    if (existing && (!startupRuntimes.has(existing) || existing.hasActiveProcess())) return null;
    if (
      currentSession &&
      (currentSession.provider !== source.provider || currentSession.sessionId !== sessionId)
    ) {
      if (existing) {
        restoreDisplayHistory(existing, hydratedConfig.record, source);
        return existing;
      }
      return null;
    }
    if (existing) {
      restoreDisplayHistory(existing, hydratedConfig.record, source);
      return existing;
    }
    if (hydratedConfig.migrated && hydratedConfig.diagnostics.length > 0) {
      logger.warn(
        `[conversation-config] Migrated ${sessionId}: ${hydratedConfig.diagnostics
          .map((diagnostic) => diagnostic.message)
          .join('; ')}`
      );
    }

    // Kind is canonical; durable record creation may still carry legacy buddyContext/purpose for old sessions.
    // Prefer source.kind (from disk-adapter, already migrated), else derive from creation legacy.
    //
    // SUBTLE — first *specific* candidate wins, not first non-null. `sessionToConversation`
    // never returns a nullish kind: it falls back to `{kind:'general'}` when the transcript
    // carries no buddy marker (disk-adapter.ts:193). A `source.kind ?? …` chain therefore
    // short-circuits on that default and makes both durable fallbacks below dead code for
    // every transcript-backed conversation. That silently de-buddied Chat "Fork" threads:
    // a fork inherits its buddy identity from `resumedFromConversationId` at creation
    // (conversation-websocket.ts:159) and stores it in `creation.buddyContext`, but its
    // transcript has no marker (its first message is the pasted fork draft), so on the next
    // restart it rehydrated as `general` — dropping out of the sidebar's Buddies group and
    // losing buddy MCP scoping while its buddy_conversations link row stayed live. That is
    // the "N conversations on the Buddies page, N-1 in the sidebar" split.
    //
    // Nothing ever demotes buddy → general (no detach flow exists), so preferring any
    // specific kind over `general` cannot resurrect a deliberate downgrade.
    const kindForHydrate =
      [
        source.kind,
        conversationKindFromLegacy({
          buddyContext: hydratedConfig.record.creation?.buddyContext ?? null,
          purpose: hydratedConfig.record.creation?.purpose ?? null,
          kind: null,
        }),
        conversationKindFromLegacy({
          buddyContext: source.buddyContext ?? null,
          purpose: source.purpose ?? null,
          kind: null,
        }),
      ].find((candidate) => candidate != null && candidate.kind !== 'general') ?? null;
    const memorySnapshot =
      source.messages
        .filter((message) => message.role === 'user')
        .map((message) => extractBuddyMemorySnapshot(message.content))
        .find((snapshot) => snapshot !== null) ?? null;
    const resumableSession =
      currentSession?.provider === hydratedConfig.state.config.provider
        ? currentSession
        : undefined;
    const conversation = dependencies.createConversation({
      id: hydratedConfig.record.conversationId,
      workingDirectory: hydratedConfig.record.workingDirectory ?? source.workingDirectory,
      configState: hydratedConfig.state,
      done: hydratedConfig.record.done,
      existingSessionId: resumableSession?.sessionId,
      existingSessionAudienceKey: resumableSession?.buddyAudienceKey,
      // Provider-counted context size measured before the restart. Restoring it
      // is what keeps the meter honest across a reload instead of falling back
      // to the chars/4 estimate until the next turn reports usage.
      existingProviderUsage: resumableSession?.latestUsage ?? null,
      isWorker: source.isWorker,
      swarmId: source.swarmId ?? null,
      workerId: source.workerId ?? null,
      workerRole: source.workerRole ?? null,
      parentConversationId: resolveParentConversationId(source.parentConversationId),
      resumedFromConversationId:
        source.resumedFromConversationId ??
        hydratedConfig.record.creation?.resumedFromConversationId ??
        null,
      modelName: source.modelName ?? null,
      title: source.title ?? null,
      kind: kindForHydrate,
      placement: hydratedConfig.record.creation?.placement ?? source.placement,
      buddyContext: source.buddyContext ?? hydratedConfig.record.creation?.buddyContext ?? null,
      purpose: source.purpose ?? hydratedConfig.record.creation?.purpose ?? 'general',
      buddyBriefing: memorySnapshot?.briefing ?? null,
      buddyMemoryGeneration: memorySnapshot?.generation ?? null,
    });
    restoreDisplayHistory(conversation, hydratedConfig.record, source);
    conversation.subAgents = source.subAgents;
    startupRuntimes.add(conversation);
    return conversation;
  }

  async function recoverConversationsWithoutTranscripts(): Promise<void> {
    // Records are independent, so recover them concurrently. One at a time,
    // ~800 records each paid several sequential record reads, and this phase
    // held the startup barrier for ~10s after the last transcript loaded
    // (2026-09-25).
    const records = await dependencies.configService.listRecoverable();
    // Stream recovered conversations like transcript batches. They used to be
    // registered silently, and `conversation_load_complete` only prunes, so a
    // client connected during startup never showed these (mostly app-created)
    // conversations until it reconnected.
    const summaries: ConversationData[] = [];
    const flush = () => {
      if (summaries.length === 0) return;
      dependencies.broadcast({
        type: 'conversations_updated',
        conversations: summaries.splice(0),
        summaries: true,
      });
    };
    await forEachWithConcurrency(records, RECOVERY_CONCURRENCY, async (record) => {
      const recovered = await recoverRecord(record);
      if (!recovered) return;
      summaries.push(summarizeConversation(recovered.toJSON()));
      if (summaries.length >= dependencies.options.startupBatchSize) flush();
    });
    flush();
  }

  async function recoverRecord(
    record: PersistedConversationConfigRecord
  ): Promise<ConversationRuntime | null> {
    if (dependencies.registry.has(record.conversationId) || !record.workingDirectory) {
      return null;
    }
    // An `external_discovered` record is a config sidecar for a transcript that
    // already exists on disk — it is not independent evidence that a conversation
    // exists. Startup only hydrates the newest `startupLimit` (500) transcripts,
    // so recovering these materialised one empty "New conversation" per
    // un-hydrated session: 5,275 of 5,633 conversations on 2026-09-06, each
    // stamped createdAt=now, which floated all of them to the top of the
    // sidebar's recent-folder groups. Only app-created records (`user` /
    // `legacy_inferred`) may become a conversation without a transcript —
    // those are the ones that genuinely have nothing on disk yet.
    const availableSource = rememberBindings(record)
      .map((binding) => nativeSources.get(sourceKey(binding)))
      .find((source) => source !== undefined);
    if (record.provenance === 'external_discovered' && !availableSource) return null;
    // Per-record isolation is required, not defensive: this loop runs inside the
    // startup barrier, so an unreadable or future-versioned record used to throw
    // all the way out to handleStartupFailure() and exit the process — one bad
    // record bricked every conversation on disk (incident 2026-08-20).
    try {
      const hydrated = await dependencies.configService.hydrate({
        conversationId: record.conversationId,
        sessionBindings: [],
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
      // A conversation with a current provider session is a resumed
      // application conversation, not a new memory-generation boundary. It
      // has no transcript snapshot to recover here, so do not inject the
      // latest Buddy briefing during recovery. Fresh records that have not
      // started a provider session still need the latest generation for
      // their pending initial message.
      const recoveredBuddy =
        record.creation?.buddyContext && !currentSession
          ? await dependencies
              .resolveBuddyConversation(record.creation.buddyContext)
              .catch((error) => {
                logger.warn(
                  `[buddies] Could not rebuild ${record.conversationId} briefing:`,
                  error
                );
                return null;
              })
          : null;
      const recovered = dependencies.createConversation({
        id: record.conversationId,
        workingDirectory: record.workingDirectory,
        configState: hydrated.state,
        done: hydrated.record.done,
        existingSessionId: currentSession?.sessionId,
        existingSessionAudienceKey: currentSession?.buddyAudienceKey,
        existingProviderUsage: currentSession?.latestUsage ?? null,
        swarmDebugPrefix: record.creation?.swarmDebugPrefix ?? null,
        resumedFromConversationId: record.creation?.resumedFromConversationId ?? null,
        kind: recoveredBuddy?.context
          ? {
              kind: 'buddy',
              buddyId: recoveredBuddy.context.buddyId,
              workspaceId: recoveredBuddy.context.workspaceId,
              buddyProjectId: recoveredBuddy.context.buddyProjectId ?? null,
              legacyWorkItemId: recoveredBuddy.context.legacyWorkItemId ?? null,
              automationRunId: recoveredBuddy.context.automationRunId ?? null,
              delegatedByBuddyId: recoveredBuddy.context.delegatedByBuddyId ?? null,
              parentBuddyConversationId: recoveredBuddy.context.parentBuddyConversationId ?? null,
              allowedBuddyOperations: recoveredBuddy.context.allowedBuddyOperations,
            }
          : record.creation?.buddyContext
            ? {
                kind: 'buddy',
                buddyId: record.creation.buddyContext.buddyId,
                workspaceId: record.creation.buddyContext.workspaceId,
                buddyProjectId: record.creation.buddyContext.buddyProjectId ?? null,
                legacyWorkItemId: record.creation.buddyContext.legacyWorkItemId ?? null,
                automationRunId: record.creation.buddyContext.automationRunId ?? null,
                delegatedByBuddyId: record.creation.buddyContext.delegatedByBuddyId ?? null,
                parentBuddyConversationId:
                  record.creation.buddyContext.parentBuddyConversationId ?? null,
                allowedBuddyOperations: record.creation.buddyContext.allowedBuddyOperations,
              }
            : record.creation?.purpose === 'buddy_builder'
              ? { kind: 'buddy_builder' }
              : null,
        buddyContext: recoveredBuddy?.context ?? record.creation?.buddyContext ?? null,
        buddyBriefing: recoveredBuddy?.briefing ?? null,
        buddyMemoryGeneration: normalizeMemoryGeneration(recoveredBuddy?.memoryGeneration),
        purpose: record.creation?.purpose ?? 'general',
        placement: record.creation?.placement,
      });
      // The record's createdAt is the conversation's real birth time. Leaving
      // the runtime's `new Date()` default made every recovered conversation
      // look like it was created at boot, sorting the oldest history to the
      // top of the sidebar as "1m ago".
      recovered.createdAt = new Date(record.createdAt);
      if (availableSource) restoreDisplayHistory(recovered, record, availableSource);
      // Awaited hydration must not replace a runtime created while startup was loading.
      if (dependencies.registry.has(record.conversationId)) return null;
      startupRuntimes.add(recovered);
      dependencies.registry.set(recovered);
      // Absent or already-dispatched never becomes pending again, so skip the
      // claim (two record reads); ~765 recovered records paid it every
      // startup (2026-09-25). A pending one still goes through the claim.
      const creation = hydrated.record.creation;
      if (creation?.initialMessage && !creation.initialMessageDispatchedAt) {
        await dependencies.dispatchInitialMessage(recovered);
      }
      return recovered;
    } catch (error) {
      logger.error(`Failed to recover conversation ${record.conversationId}:`, error);
      return null;
    }
  }

  function reresolveParentIds(): void {
    const changed: ConversationData[] = [];
    for (const conversation of dependencies.registry.values()) {
      if (!conversation.parentConversationId) continue;
      const resolved = resolveParentConversationId(conversation.parentConversationId);
      if (resolved === conversation.parentConversationId) continue;
      conversation.parentConversationId = resolved;
      changed.push(summarizeConversation(conversation.toJSON()));
    }
    if (changed.length > 0) {
      dependencies.broadcast({
        type: 'conversations_updated',
        conversations: changed,
        summaries: true,
      });
    }
  }

  async function loadExistingConversations(): Promise<void> {
    logger.log('Loading conversations from persisted session files...');
    try {
      fileMtimes = await loadProgressively<
        DiscoveredConversation,
        ConversationRuntime,
        ConversationData
      >(
        {
          limit: dependencies.options.startupLimit,
          concurrency: dependencies.options.startupConcurrency,
          batchSize: dependencies.options.startupBatchSize,
          initialBatchSize: dependencies.options.startupInitialBatchSize,
          logEveryFiles: dependencies.options.startupLogEveryFiles,
        },
        {
          load: (options) => dependencies.loadConversations({ ...options, resolveSessionBindings }),
          hydrate,
          // Creation is allowed while old history hydrates. A live runtime
          // created after discovery is authoritative and must never be replaced
          // by the older disk snapshot.
          store: (conversation) => {
            if (dependencies.registry.get(conversation.id) === conversation) return true;
            if (dependencies.registry.has(conversation.id)) return false;
            dependencies.registry.set(conversation);
            return true;
          },
          serialize: (conversation) => summarizeConversation(conversation.toJSON()),
          broadcast: (conversations) =>
            dependencies.broadcast({
              type: 'conversations_updated',
              conversations,
              summaries: true,
            }),
          count: () => dependencies.registry.size,
        }
      );
      await recoverConversationsWithoutTranscripts();
      reresolveParentIds();
      logger.log(`Loaded ${dependencies.registry.size} conversations from persisted session files`);
    } catch (error) {
      logger.error('Failed to load conversations from persisted sessions:', error);
      throw error;
    }
  }

  function collectActiveIds(): Set<string> {
    const activeIds = new Set<string>();
    for (const [id, conversation] of dependencies.registry.entries()) {
      if (!conversation.hasActiveProcess()) continue;
      activeIds.add(id);
      activeIds.add(conversation.sessionId);
      for (const sessionId of boundSessionIds.get(id) ?? []) activeIds.add(sessionId);
    }
    return activeIds;
  }

  function findBootstrapMatch(
    sessionId: string,
    source: DiscoveredConversation
  ): ConversationRuntime | undefined {
    const importedLastUser = getLastUserMessageContent(source.messages);
    if (!importedLastUser) return undefined;
    const importedCreatedMs = new Date(source.createdAt).getTime();

    for (const conversation of dependencies.registry.values()) {
      if (conversation.provider !== source.provider || conversation.id === sessionId) continue;
      if (conversation.sessionId !== conversation.id && conversation.provider !== 'gemini') {
        continue;
      }
      if (
        (conversation.provider === 'opencode' && conversation.sessionId.startsWith('ses_')) ||
        conversation.workingDirectory !== source.workingDirectory
      ) {
        continue;
      }
      const existingLastUser = getLastUserMessageContent(conversation.messages);
      if (!existingLastUser || existingLastUser !== importedLastUser) continue;
      const existingCreatedMs = conversation.createdAt.getTime();
      if (
        Number.isFinite(importedCreatedMs) &&
        Math.abs(existingCreatedMs - importedCreatedMs) > 5 * 60_000
      ) {
        continue;
      }
      return conversation;
    }
    return undefined;
  }

  async function applyPolledUpdate(
    sessionId: string,
    source: SessionHistorySource
  ): Promise<ConversationData | null> {
    rememberSources(source);
    const record = await dependencies.configStore.findBySession(source.provider, sessionId);
    if (record?.status === 'deleted') return null;
    let existing = findByCurrentSessionId(sessionId);
    const boundExisting = record && dependencies.registry.get(record.conversationId);
    if (!existing && boundExisting && record) {
      if (boundExisting.hasActiveProcess()) return null;
      restoreDisplayHistory(boundExisting, record, source);
      // Older native sessions can gain history, but cannot change current
      // runtime metadata, model selection, session identity or running status.
      return boundExisting.toJSON();
    }
    if (!existing) {
      const reconciled = findBootstrapMatch(sessionId, source);
      if (reconciled) {
        const oldSessionId = reconciled.sessionId;
        reconciled.sessionId = sessionId;
        if (oldSessionId !== sessionId) {
          dependencies.sessions.unregisterAlias(oldSessionId, { keepKnown: true });
        }
        dependencies.sessions.registerAlias(sessionId, reconciled.id);
        await dependencies.persistCurrentSession(reconciled, sessionId);
        existing = reconciled;
        logger.log(
          `[Poll] Reconciled session ${sessionId.substring(0, 8)} with conversation ${reconciled.id.substring(0, 8)} (old session ${oldSessionId.substring(0, 8)})`
        );
      }
    }

    if (existing && !existing.hasActiveProcess()) {
      dependencies.sessions.registerAlias(sessionId, existing.id);
      if (record) restoreDisplayHistory(existing, record, source);
      else existing.messages = mergeSessionMessages([source.messages], existing.messages);
      existing.subAgents = source.subAgents;
      existing.isWorker = source.isWorker;
      existing.swarmId = source.swarmId ?? null;
      existing.workerId = source.workerId ?? null;
      existing.workerRole = source.workerRole ?? null;
      existing.parentConversationId = resolveParentConversationId(source.parentConversationId);
      // Native provider artifacts do not carry Unleashd's UI lineage. A poll
      // must never erase the durable parent recorded at child creation.
      existing.resumedFromConversationId =
        source.resumedFromConversationId ?? existing.resumedFromConversationId;
      // Provider artifacts are discovery evidence, not authority to detach a
      // conversation from an application-owned kind. Their general fallback only
      // means that no marker was observed. Since no Buddy/Builder detach flow
      // exists, polling may promote general to a specific kind but never demote or
      // reassign a specific durable runtime kind.
      const specificPolledKind =
        [
          source.kind,
          conversationKindFromLegacy({
            buddyContext: source.buddyContext ?? null,
            purpose: source.purpose ?? null,
            kind: null,
          }),
        ].find((candidate) => candidate != null && candidate.kind !== 'general') ?? null;
      if (existing.kind.kind === 'general' && specificPolledKind) {
        existing.kind = specificPolledKind;
      }
      existing.modelName = source.modelName ?? source.model ?? null;
      // Idle-only path (active processes return earlier): the file backfill
      // already resolved custom-over-ai precedence, so last file wins here.
      if (source.title !== undefined) existing.title = source.title;
      existing.refreshConfigResolution();
      const serialized = existing.toJSON();
      if (dependencies.externalActivity.has(sessionId)) serialized.isRunning = true;
      return serialized;
    }

    if (
      existing ||
      dependencies.sessions.isKnown(sessionId) ||
      dependencies.sessions.isDeleted(sessionId)
    ) {
      return null;
    }
    const conversation = await hydrate(source);
    if (!conversation) return null;
    const liveWinner = dependencies.registry.get(conversation.id);
    if (liveWinner && liveWinner !== conversation) return null;
    dependencies.registry.set(conversation);
    const serialized = conversation.toJSON();
    if (dependencies.externalActivity.has(sessionId)) serialized.isRunning = true;
    return serialized;
  }

  function pruneSessionTracking(): void {
    dependencies.sessions.prune(dependencies.registry);
  }

  function startFilePolling(): NodeJS.Timeout {
    return createFilePoller<DiscoveredConversation, ConversationData>(
      {
        intervalMs: dependencies.options.pollIntervalMs,
        externalGraceMs: dependencies.options.externalGraceMs,
        verbose: dependencies.options.verbose,
      },
      {
        getMtimes: () => fileMtimes,
        setMtimes: (mtimes) => {
          fileMtimes = mtimes;
        },
        collectActiveIds,
        poll: (mtimes, activeIds) =>
          dependencies.pollConversations(mtimes, activeIds, { resolveSessionBindings }),
        pruneCompletionSuppressions: (now) => dependencies.completionSuppression.prune(now),
        isCompletionSuppressed: (sessionId, now) =>
          dependencies.completionSuppression.isSuppressed(sessionId, now),
        externalActivity: {
          entries: () => dependencies.externalActivity.entries(),
          has: (sessionId) => dependencies.externalActivity.has(sessionId),
          set: (sessionId, lastSeen) => dependencies.externalActivity.set(sessionId, lastSeen),
          delete: (sessionId) => dependencies.externalActivity.delete(sessionId),
        },
        findConversationId: (sessionId) => findByCurrentSessionId(sessionId)?.id,
        broadcastStatus: (conversationId, isRunning) =>
          dependencies.broadcast({
            type: 'status',
            conversationId,
            isRunning,
            isStreaming: false,
          }),
        applyUpdate: applyPolledUpdate,
        // Summaries, not full histories. A still-running external transcript
        // changes every poll, and its full ConversationData (~400-500KB) was
        // serialized and sent to every client every 5s (2026-09-25). A client
        // with the history loaded refetches it over HTTP when the summary's
        // messageCount moves (handleConversationsUpdated), so only a viewer
        // pays for the full history.
        broadcastUpdates: (conversations) =>
          dependencies.broadcast({
            type: 'conversations_updated',
            conversations: conversations.map(summarizeConversation),
            summaries: true,
          }),
        pruneTracking: pruneSessionTracking,
      }
    ).start();
  }

  return { loadExistingConversations, startFilePolling };
}

function getLastUserMessageContent(messages: Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user') continue;
    const content = messages[index].content.trim();
    return content.length > 0 ? content : null;
  }
  return null;
}
