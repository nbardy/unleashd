import {
  type ConfigError,
  type ConfigResolution,
  type ConversationConfig,
  type ConversationConfigPatch,
  type ConversationConfigState,
  type ConversationCreationMetadata,
  type ConversationKind,
  type ResolvedExecutionConfig,
  type Result,
  applyConversationConfigPatch as applyConversationConfigSelectionPatch,
} from '@unleashd/shared';
import {
  type ConfigProvenance,
  ConfigRevisionConflictError,
  type ConversationConfigStore,
  type PersistedConversationConfigRecord,
  type SessionBinding,
} from './config-store';
import {
  type LegacyConfigDiagnostic,
  type LegacyConfigEvidence,
  migrateLegacyConversationConfig,
} from './legacy-config-migration';

export interface ConversationConfigResolver {
  resolve(config: ConversationConfig): Promise<ConfigResolution>;
}

export type { ConversationConfigState } from '@unleashd/shared';

export interface ConfigUpdateContext {
  isRunning: boolean;
  queueDepth: number;
  hasStartedSession: boolean;
}

export interface ConfigUpdateCommand {
  conversationId: string;
  commandId: string;
  expectedRevision: number;
  patch: ConversationConfigPatch;
}

export interface ConfigUpdateSuccess {
  commandId: string;
  previous: ConversationConfigState;
  next: ConversationConfigState;
}

export interface NewConversationConfigInput {
  conversationId: string;
  kind: ConversationKind;
  config: ConversationConfig;
  sessionBindings?: readonly SessionBinding[];
  currentSession?: SessionBinding;
  workingDirectory?: string;
  creation?: ConversationCreationMetadata;
  provenance?: ConfigProvenance;
}

export interface CreateConversationConfigResult {
  state: ConversationConfigState;
  record: PersistedConversationConfigRecord;
  replayed: boolean;
}

export interface HydrateConversationConfigInput {
  conversationId: string;
  /** Kind of a discovered transcript, stored only when this creates its record. */
  discoveredKind: ConversationKind;
  sessionBindings: readonly SessionBinding[];
  currentSession?: SessionBinding;
  workingDirectory?: string;
  legacy: LegacyConfigEvidence;
}

export interface HydratedConversationConfig {
  state: ConversationConfigState;
  record: PersistedConversationConfigRecord;
  migrated: boolean;
  diagnostics: LegacyConfigDiagnostic[];
}

export interface ForkConversationConfigInput {
  conversationId: string;
  kind: ConversationKind;
  source: ConversationConfigState;
  sessionBindings?: readonly SessionBinding[];
  currentSession?: SessionBinding;
  workingDirectory?: string;
  creation?: ConversationCreationMetadata;
}

export interface ConversationConfigServiceOptions {
  store: ConversationConfigStore;
  resolver: ConversationConfigResolver;
  now?: () => Date;
}

/**
 * Applies lifecycle policy and produces a complete selection without I/O.
 * Relational provider/model/effort validation remains the resolver's job.
 */
export function applyConversationConfigPatch(
  current: ConversationConfig,
  context: ConfigUpdateContext,
  patch: ConversationConfigPatch
): Result<ConversationConfig, ConfigError> {
  const changesProvider =
    (patch.kind === 'set_provider' && patch.provider !== current.provider) ||
    (patch.kind === 'replace' && patch.config.provider !== current.provider);

  // A running CLI receives an immutable ResolvedExecutionConfig snapshot at
  // spawn time. Model/reasoning changes are therefore safe while a turn is in
  // flight and take effect on the next turn (including the next queued turn).
  // Provider changes remain blocked because they would invalidate the active
  // provider session and its resume state.
  if (changesProvider && (context.isRunning || context.queueDepth > 0)) {
    return failure(
      'conversation_busy',
      context.isRunning
        ? 'Provider cannot change while a turn is running'
        : 'Provider cannot change while messages are queued'
    );
  }

  if (patch.kind === 'set_provider') {
    if (context.hasStartedSession && patch.provider !== current.provider) {
      return failure(
        'provider_locked',
        'Provider cannot change after the conversation has started',
        current.provider
      );
    }
    if (patch.provider === current.provider) return { ok: true, value: current };
    return {
      ok: true,
      value: applyConversationConfigSelectionPatch(current, patch),
    };
  }

  if (
    patch.kind === 'replace' &&
    context.hasStartedSession &&
    patch.config.provider !== current.provider
  ) {
    return failure(
      'provider_locked',
      'Provider cannot change after the conversation has started',
      current.provider
    );
  }
  return {
    ok: true,
    value: applyConversationConfigSelectionPatch(current, patch),
  };
}

export class ConversationConfigService {
  private readonly store: ConversationConfigStore;
  private readonly resolver: ConversationConfigResolver;
  private readonly now: () => Date;

  constructor(options: ConversationConfigServiceOptions) {
    this.store = options.store;
    this.resolver = options.resolver;
    this.now = options.now ?? (() => new Date());
  }

  resolve(config: ConversationConfig): Promise<ConfigResolution> {
    return this.resolver.resolve(config);
  }

  async create(input: NewConversationConfigInput): Promise<ConversationConfigState> {
    return (await this.createOrReplay(input)).state;
  }

  async createOrReplay(input: NewConversationConfigInput): Promise<CreateConversationConfigResult> {
    const existing = await this.store.getByConversationId(input.conversationId);
    if (existing) {
      if (existing.status === 'deleted') {
        throw new ConversationTombstonedError(existing);
      }
      if (isMatchingCreateReplay(existing, input)) {
        return {
          state: await this.stateFromRecord(existing),
          record: existing,
          replayed: true,
        };
      }
      throw new ConfigRevisionConflictError(-1, existing.configRevision);
    }

    const resolution = await this.resolver.resolve(input.config);
    assertResolved(resolution);
    let record: PersistedConversationConfigRecord;
    try {
      record = await this.store.create({
        conversationId: input.conversationId,
        sessionBindings: input.sessionBindings,
        currentSession: input.currentSession,
        workingDirectory: input.workingDirectory,
        creation: input.creation,
        kind: input.kind,
        config: input.config,
        lastResolvedConfig: resolution.value,
        provenance: input.provenance ?? 'user',
      });
    } catch (error) {
      if (!(error instanceof ConfigRevisionConflictError)) throw error;
      const winner = await this.store.getByConversationId(input.conversationId);
      if (!winner || !isMatchingCreateReplay(winner, input)) throw error;
      if (winner.status === 'deleted') {
        throw new ConversationTombstonedError(winner);
      }
      return {
        state: await this.stateFromRecord(winner),
        record: winner,
        replayed: true,
      };
    }
    return {
      state: { config: input.config, revision: 0, resolution },
      record,
      replayed: false,
    };
  }

  async hydrate(input: HydrateConversationConfigInput): Promise<HydratedConversationConfig> {
    const existing =
      (await this.store.getByConversationId(input.conversationId)) ??
      (await findFirstSessionRecord(this.store, input.sessionBindings));
    if (existing) {
      if (existing.status === 'deleted') {
        throw new ConversationTombstonedError(existing);
      }
      // Each update returns the record it read or wrote, so the result needs no
      // re-read. Startup hydrates ~1,100 records; the extra read per record was
      // a measurable share of the startup barrier (2026-09-25).
      let refreshed = existing;
      for (const binding of input.sessionBindings) {
        refreshed =
          (await this.store.addSessionBinding(existing.conversationId, binding)) ?? refreshed;
      }
      const inferredCurrentSession =
        existing.currentSession ?? existing.sessionBindings.at(-1) ?? input.currentSession;
      if (inferredCurrentSession && !existing.currentSession) {
        refreshed =
          (await this.store.setCurrentSession(existing.conversationId, inferredCurrentSession)) ??
          refreshed;
      }
      return {
        state: await this.stateFromRecord(refreshed),
        record: refreshed,
        migrated: false,
        diagnostics: [],
      };
    }

    const migration = migrateLegacyConversationConfig(input.legacy);
    const resolution = await this.resolver.resolve(migration.config);
    let record: PersistedConversationConfigRecord;
    try {
      record = await this.store.create({
        conversationId: input.conversationId,
        sessionBindings: input.sessionBindings,
        currentSession: input.currentSession,
        workingDirectory: input.workingDirectory,
        kind: input.discoveredKind,
        config: migration.config,
        lastResolvedConfig: resolution.status === 'resolved' ? resolution.value : undefined,
        provenance: migration.provenance,
      });
    } catch (error) {
      if (!(error instanceof ConfigRevisionConflictError)) throw error;
      // Hydration can race when two native artifacts identify the same
      // conversation. Durable state wins; inferred state is never overwritten.
      const winner =
        (await this.store.getByConversationId(input.conversationId)) ??
        (await findFirstSessionRecord(this.store, input.sessionBindings));
      if (!winner) throw error;
      if (winner.status === 'deleted') {
        throw new ConversationTombstonedError(winner);
      }
      return {
        state: await this.stateFromRecord(winner),
        record: winner,
        migrated: false,
        diagnostics: [],
      };
    }
    return {
      state: { config: record.config, revision: 0, resolution },
      record,
      migrated: true,
      diagnostics: migration.diagnostics,
    };
  }

  async fork(input: ForkConversationConfigInput): Promise<ConversationConfigState> {
    const resolution = await this.resolver.resolve(input.source.config);
    assertResolved(resolution);
    await this.store.create({
      conversationId: input.conversationId,
      sessionBindings: input.sessionBindings,
      currentSession: input.currentSession,
      workingDirectory: input.workingDirectory,
      creation: input.creation,
      kind: input.kind,
      config: input.source.config,
      lastResolvedConfig: resolution.value,
      provenance: 'user',
    });
    return { config: input.source.config, revision: 0, resolution };
  }

  async bindSession(conversationId: string, binding: SessionBinding): Promise<void> {
    await this.store.addSessionBinding(conversationId, binding);
  }

  appendBranchLaunch(conversationId: string, digest: string, handoff: string) {
    return this.store.appendBranchLaunch(conversationId, digest, handoff);
  }

  async setCurrentSession(conversationId: string, binding: SessionBinding): Promise<void> {
    await this.store.setCurrentSession(conversationId, binding);
  }

  setDone(
    conversationId: string,
    done: boolean
  ): Promise<PersistedConversationConfigRecord | undefined> {
    return this.store.setDone(conversationId, done);
  }

  getRecord(conversationId: string): Promise<PersistedConversationConfigRecord | undefined> {
    return this.store.getByConversationId(conversationId);
  }

  listRecoverable(): Promise<PersistedConversationConfigRecord[]> {
    return this.store.listActive();
  }

  claimInitialMessageDispatch(
    conversationId: string,
    dispatchedAt?: Date
  ): Promise<PersistedConversationConfigRecord | undefined> {
    return this.store.claimInitialMessageDispatch(conversationId, dispatchedAt);
  }

  completeInitialMessageDispatch(
    conversationId: string,
    claimToken: string,
    dispatchedAt?: Date
  ): Promise<PersistedConversationConfigRecord | undefined> {
    return this.store.completeInitialMessageDispatch(conversationId, claimToken, dispatchedAt);
  }

  delete(conversationId: string): Promise<boolean> {
    return this.store.delete(conversationId);
  }

  purge(conversationId: string): Promise<boolean> {
    return this.store.purge(conversationId);
  }

  async update(
    current: ConversationConfigState,
    context: ConfigUpdateContext,
    command: ConfigUpdateCommand
  ): Promise<Result<ConfigUpdateSuccess, ConfigError>> {
    if (command.expectedRevision !== current.revision) {
      return failure(
        'revision_conflict',
        `Configuration revision conflict: expected ${command.expectedRevision}, actual ${current.revision}`
      );
    }
    const transition = applyConversationConfigPatch(current.config, context, command.patch);
    if (!transition.ok) return transition;

    const resolution = await this.resolver.resolve(transition.value);
    if (resolution.status !== 'resolved') {
      return { ok: false, error: resolution.error };
    }

    const existing = await this.store.getByConversationId(command.conversationId);
    if (!existing) {
      return failure(
        'revision_conflict',
        'Configuration record disappeared before the update was committed'
      );
    }
    if (existing.status === 'deleted') {
      return failure('revision_conflict', 'Conversation has been deleted');
    }

    const nextRevision = current.revision + 1;
    const nextRecord: PersistedConversationConfigRecord = {
      ...existing,
      config: transition.value,
      recordRevision: existing.recordRevision + 1,
      configRevision: nextRevision,
      lastResolvedConfig: resolution.value,
      provenance: 'user',
      updatedAt: this.now().toISOString(),
    };
    try {
      await this.store.save(nextRecord, {
        configRevision: current.revision,
        recordRevision: existing.recordRevision,
      });
    } catch (error) {
      if (error instanceof ConfigRevisionConflictError) {
        return failure(
          'revision_conflict',
          `Configuration revision conflict: expected ${current.revision}, actual ${
            error.actualRevision ?? 'missing'
          }`
        );
      }
      throw error;
    }

    return {
      ok: true,
      value: {
        commandId: command.commandId,
        previous: current,
        next: {
          config: transition.value,
          revision: nextRevision,
          resolution,
        },
      },
    };
  }

  private async stateFromRecord(
    record: PersistedConversationConfigRecord
  ): Promise<ConversationConfigState> {
    const current = await this.resolver.resolve(record.config);
    if (current.status === 'unavailable' && record.lastResolvedConfig) {
      return {
        config: record.config,
        revision: record.configRevision,
        resolution: { ...current, lastResolved: record.lastResolvedConfig },
      };
    }
    return {
      config: record.config,
      revision: record.configRevision,
      resolution: current,
    };
  }
}

async function findFirstSessionRecord(
  store: ConversationConfigStore,
  bindings: readonly SessionBinding[]
): Promise<PersistedConversationConfigRecord | undefined> {
  for (const binding of bindings) {
    const record = await store.findBySession(binding.provider, binding.sessionId);
    if (record) return record;
  }
  return undefined;
}

function assertResolved(resolution: ConfigResolution): asserts resolution is ConfigResolution & {
  status: 'resolved';
  value: ResolvedExecutionConfig;
} {
  if (resolution.status !== 'resolved') {
    throw new ConversationConfigResolutionError(resolution.error);
  }
}

export class ConversationConfigResolutionError extends Error {
  constructor(readonly configError: ConfigError) {
    super(configError.message);
    this.name = 'ConversationConfigResolutionError';
  }
}

export class ConversationTombstonedError extends Error {
  constructor(readonly record: PersistedConversationConfigRecord) {
    super(`Conversation has been deleted: ${record.conversationId}`);
    this.name = 'ConversationTombstonedError';
  }
}

function isMatchingCreateReplay(
  existing: PersistedConversationConfigRecord,
  input: NewConversationConfigInput
): boolean {
  const commandId = input.creation?.commandId;
  const fingerprint = input.creation?.fingerprint;
  if (!commandId && !fingerprint) return false;
  if (commandId && existing.creation?.commandId !== commandId) return false;
  if (fingerprint && existing.creation?.fingerprint !== fingerprint) return false;
  if (
    input.creation?.initialMessage !== undefined &&
    existing.creation?.initialMessage !== input.creation.initialMessage
  ) {
    return false;
  }
  if (
    input.workingDirectory !== undefined &&
    existing.workingDirectory !== input.workingDirectory
  ) {
    return false;
  }
  return JSON.stringify(existing.config) === JSON.stringify(input.config);
}

function failure(
  code: ConfigError['code'],
  message: string,
  provider?: ConversationConfig['provider']
): Result<never, ConfigError> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(provider ? { provider } : {}),
    },
  };
}
