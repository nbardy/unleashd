import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type ConversationConfig,
  type ConversationCreationMetadata,
  type PersistedConversationConfigRecord,
  PersistedConversationConfigRecordSchema,
  type Provider,
  ProviderSchema,
  type ProviderTurnUsage,
  ProviderTurnUsageSchema,
  type ResolvedExecutionConfig,
} from '@unleashd/shared';
import { z } from 'zod';

export const CONFIG_STORE_VERSION = 1 as const;
export const INITIAL_MESSAGE_DISPATCH_LEASE_MS = 15_000;

export { PersistedConversationConfigRecordSchema };
export type { PersistedConversationConfigRecord };

export const SessionBindingSchema =
  PersistedConversationConfigRecordSchema.shape.sessionBindings.element;

export type SessionBinding = PersistedConversationConfigRecord['sessionBindings'][number];

export const ConfigProvenanceSchema = PersistedConversationConfigRecordSchema.shape.provenance;

export type ConfigProvenance = PersistedConversationConfigRecord['provenance'];

const SessionIndexRecordSchema = z.object({
  version: z.literal(CONFIG_STORE_VERSION),
  conversationId: z.string().min(1),
});

export type ConfigStoreWarning =
  | {
      code: 'corrupt_record_quarantined';
      filePath: string;
      quarantinePath: string;
      error: string;
    }
  | {
      code: 'future_record_version';
      filePath: string;
      version: number;
    }
  | {
      code: 'session_index_update_failed';
      conversationId: string;
      error: string;
    };

export interface ConfigStoreLogger {
  warn(warning: ConfigStoreWarning): void;
}

export interface ConversationConfigStoreOptions {
  appDataRoot: string;
  now?: () => Date;
  logger?: ConfigStoreLogger;
  durableWrites?: boolean;
}

export interface ConversationConfigRecordListOptions {
  status?: PersistedConversationConfigRecord['status'];
}

export type ConfigRecordExpectation =
  | number
  | 'missing'
  | { configRevision: number; recordRevision: number };

interface SessionLookupIndex {
  scopes: number;
  ready: Promise<void>;
  bySession: Map<string, Set<string>>;
  byConversation: Map<string, readonly string[]>;
  pending?: Map<string, readonly string[]>;
  /** The scope's one full scan; `list()` serves it while the scope is open. */
  records?: ReadonlyMap<string, PersistedConversationConfigRecord>;
  /** Records this store wrote or removed since the scope began; re-read, never served stale. */
  written: Set<string>;
}

export class ConfigRevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number | undefined
  ) {
    super(
      `Configuration revision conflict: expected ${expectedRevision}, actual ${
        actualRevision ?? 'missing'
      }`
    );
    this.name = 'ConfigRevisionConflictError';
  }
}

export class UnsupportedConfigRecordVersionError extends Error {
  constructor(
    readonly filePath: string,
    readonly version: number
  ) {
    super(`Unsupported conversation config version ${version} in ${filePath}`);
    this.name = 'UnsupportedConfigRecordVersionError';
  }
}

/**
 * Durable authority for application-owned conversation configuration.
 *
 * Conversation records are authoritative. Session indexes are only accelerators:
 * lookup falls back to scanning records and repairs a missing or stale index.
 */
export class ConversationConfigStore {
  readonly rootDirectory: string;
  readonly conversationDirectory: string;
  readonly sessionDirectory: string;
  readonly quarantineDirectory: string;

  private readonly now: () => Date;
  private readonly logger?: ConfigStoreLogger;
  private readonly durableWrites: boolean;
  private readonly locks = new Map<string, Promise<void>>();
  private sessionLookupIndex: SessionLookupIndex | undefined;

  constructor(options: ConversationConfigStoreOptions) {
    if (!path.isAbsolute(options.appDataRoot)) {
      throw new Error('ConversationConfigStore appDataRoot must be absolute');
    }
    this.rootDirectory = path.join(options.appDataRoot, 'conversation-config', 'v1');
    this.conversationDirectory = path.join(this.rootDirectory, 'by-conversation');
    this.sessionDirectory = path.join(this.rootDirectory, 'by-session');
    this.quarantineDirectory = path.join(this.rootDirectory, 'quarantine');
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger;
    this.durableWrites = options.durableWrites ?? false;
  }

  async getByConversationId(
    conversationId: string
  ): Promise<PersistedConversationConfigRecord | undefined> {
    const filePath = this.conversationPath(conversationId);
    return this.readRecord(filePath);
  }

  /**
   * Amortize missing-session lookup during a bulk import. The index contains only
   * identities; every hit still reads its authoritative record from disk. Writes
   * through this store maintain it, including writes while the initial scan runs.
   * Normal scan-and-repair behavior resumes when the last overlapping scope ends.
   * Unindexed writes by another process are discovered after the scope ends.
   */
  async withSessionLookupIndex<T>(operation: () => Promise<T>): Promise<T> {
    let index = this.sessionLookupIndex;
    if (!index) {
      index = {
        scopes: 0,
        ready: Promise.resolve(),
        bySession: new Map(),
        byConversation: new Map(),
        pending: new Map(),
        written: new Set(),
      };
      this.sessionLookupIndex = index;
      index.ready = this.buildSessionLookupIndex(index);
      // Observed only by a lookup miss (findBySession awaits it). Nothing else
      // waits: awaiting the scan here held all of startup for a full read of
      // every record (~7,800, 3-6s) before discovery began (2026-09-25).
      index.ready.catch(() => {});
    }
    index.scopes += 1;
    try {
      return await operation();
    } finally {
      index.scopes -= 1;
      if (index.scopes === 0 && this.sessionLookupIndex === index) {
        this.sessionLookupIndex = undefined;
      }
    }
  }

  async findBySession(
    provider: Provider,
    sessionId: string
  ): Promise<PersistedConversationConfigRecord | undefined> {
    ProviderSchema.parse(provider);
    const indexPath = this.sessionIndexPath({ provider, sessionId });
    const indexedConversationId = await this.readSessionIndex(indexPath);
    if (indexedConversationId) {
      const indexed = await this.getByConversationId(indexedConversationId);
      if (
        indexed &&
        recordSessionBindings(indexed).some(
          (binding) => binding.provider === provider && binding.sessionId === sessionId
        )
      ) {
        return indexed;
      }
    }

    const index = this.sessionLookupIndex;
    if (index) {
      await index.ready;
      const candidates = index.bySession.get(bindingKey({ provider, sessionId }));
      for (const conversationId of candidates ?? []) {
        let record: PersistedConversationConfigRecord | undefined;
        try {
          record = await this.getByConversationId(conversationId);
        } catch (error) {
          if (error instanceof UnsupportedConfigRecordVersionError) continue;
          throw error;
        }
        if (
          record &&
          recordSessionBindings(record).some(
            (binding) => binding.provider === provider && binding.sessionId === sessionId
          )
        ) {
          await this.writeSessionIndex({ provider, sessionId }, record.conversationId);
          return record;
        }
      }
      return undefined;
    }

    const records = await this.list();
    const found = records.find((record) =>
      recordSessionBindings(record).some(
        (binding) => binding.provider === provider && binding.sessionId === sessionId
      )
    );
    if (found) {
      await this.writeSessionIndex({ provider, sessionId }, found.conversationId);
    }
    return found;
  }

  /**
   * Every supported record. Inside a bulk lookup scope this serves the scope's
   * scan plus fresh reads of what this store wrote since: startup scanned all
   * ~7,800 records twice (lookup index, then recovery), and each scan cost
   * seconds of the startup barrier (2026-09-25).
   */
  async list(
    options: ConversationConfigRecordListOptions = {}
  ): Promise<PersistedConversationConfigRecord[]> {
    const index = this.sessionLookupIndex;
    const records = index ? await this.scopeRecords(index) : await this.scanRecords();
    return records.filter(
      (record) => options.status === undefined || record.status === options.status
    );
  }

  private async scopeRecords(
    index: SessionLookupIndex
  ): Promise<PersistedConversationConfigRecord[]> {
    await index.ready;
    const records = new Map(index.records);
    const written = [...index.written];
    const current = await Promise.all(written.map((id) => this.readSupportedRecord(id)));
    written.forEach((conversationId, position) => {
      const record = current[position];
      if (record) records.set(conversationId, record);
      else records.delete(conversationId);
    });
    return [...records.values()];
  }

  private async readSupportedRecord(
    conversationId: string
  ): Promise<PersistedConversationConfigRecord | undefined> {
    try {
      return await this.getByConversationId(conversationId);
    } catch (error) {
      if (error instanceof UnsupportedConfigRecordVersionError) return undefined;
      throw error;
    }
  }

  private async scanRecords(): Promise<PersistedConversationConfigRecord[]> {
    await mkdir(this.conversationDirectory, { recursive: true });
    const entries = await readdir(this.conversationDirectory, {
      withFileTypes: true,
    });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          try {
            return await this.readRecord(path.join(this.conversationDirectory, entry.name));
          } catch (error) {
            // A future record is intentionally left untouched. It must not
            // prevent supported records from rebuilding their derived indexes.
            if (error instanceof UnsupportedConfigRecordVersionError) return undefined;
            throw error;
          }
        })
    );
    return records.filter(
      (record): record is PersistedConversationConfigRecord => record !== undefined
    );
  }

  listActive(): Promise<PersistedConversationConfigRecord[]> {
    return this.list({ status: 'active' });
  }

  listDeleted(): Promise<PersistedConversationConfigRecord[]> {
    return this.list({ status: 'deleted' });
  }

  /**
   * Save a complete record. When expectedRevision is supplied it is compared
   * against durable state while holding the per-conversation lock.
   */
  async save(
    input: PersistedConversationConfigRecord,
    expectedRevision?: ConfigRecordExpectation
  ): Promise<PersistedConversationConfigRecord> {
    const parsed = PersistedConversationConfigRecordSchema.parse(input);
    return this.withLock(parsed.conversationId, async () => {
      const existing = await this.getByConversationId(parsed.conversationId);
      if (expectedRevision === 'missing' && existing) {
        throw new ConfigRevisionConflictError(-1, existing.configRevision);
      }
      if (typeof expectedRevision === 'number' && existing?.configRevision !== expectedRevision) {
        throw new ConfigRevisionConflictError(expectedRevision, existing?.configRevision);
      }
      if (
        typeof expectedRevision === 'object' &&
        (existing?.configRevision !== expectedRevision.configRevision ||
          existing.recordRevision !== expectedRevision.recordRevision)
      ) {
        throw new ConfigRevisionConflictError(
          expectedRevision.configRevision,
          existing?.configRevision
        );
      }

      const previousBindings = existing ? recordSessionBindings(existing) : [];
      const recordPath = this.conversationPath(parsed.conversationId);
      await this.atomicWriteJson(recordPath, parsed);
      this.trackSessionBindings(parsed.conversationId, recordSessionBindings(parsed));

      try {
        await this.reconcileSessionIndexes(
          parsed.conversationId,
          previousBindings,
          recordSessionBindings(parsed)
        );
      } catch (error) {
        this.logger?.warn({
          code: 'session_index_update_failed',
          conversationId: parsed.conversationId,
          error: errorMessage(error),
        });
      }
      return parsed;
    });
  }

  async create(input: {
    conversationId: string;
    sessionBindings?: readonly SessionBinding[];
    currentSession?: SessionBinding;
    workingDirectory?: string;
    creation?: ConversationCreationMetadata;
    config: ConversationConfig;
    lastResolvedConfig?: ResolvedExecutionConfig;
    provenance: ConfigProvenance;
  }): Promise<PersistedConversationConfigRecord> {
    const timestamp = this.now().toISOString();
    return this.save(
      {
        version: CONFIG_STORE_VERSION,
        conversationId: input.conversationId,
        sessionBindings: [...(input.sessionBindings ?? [])],
        status: 'active',
        done: false,
        ...(input.currentSession ? { currentSession: input.currentSession } : {}),
        ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
        ...(input.creation ? { creation: input.creation } : {}),
        config: input.config,
        recordRevision: 0,
        configRevision: 0,
        lastResolvedConfig: input.lastResolvedConfig,
        provenance: input.provenance,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      'missing'
    );
  }

  /**
   * Mark a conversation deleted without discarding its identity or session
   * indexes. Native transcript files can then be recognized as belonging to a
   * deleted application conversation after restart.
   */
  async delete(conversationId: string): Promise<boolean> {
    const existing = await this.getByConversationId(conversationId);
    if (!existing || existing.status === 'deleted') return false;
    await this.updateRecord(conversationId, (record) => ({
      ...record,
      status: 'deleted',
      deletedAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
    }));
    return true;
  }

  /**
   * Physically remove a record. Reserved for rollback of a creation that was
   * never exposed; user deletion should use the durable tombstone above.
   */
  async purge(conversationId: string): Promise<boolean> {
    return this.withLock(conversationId, async () => {
      const existing = await this.getByConversationId(conversationId);
      if (!existing) return false;

      await rm(this.conversationPath(conversationId), { force: true });
      this.trackSessionBindings(conversationId, []);
      try {
        await this.reconcileSessionIndexes(conversationId, recordSessionBindings(existing), []);
      } catch (error) {
        this.logger?.warn({
          code: 'session_index_update_failed',
          conversationId,
          error: errorMessage(error),
        });
      }
      return true;
    });
  }

  /**
   * Replace an application-owned conversation ID while preserving provider
   * session bindings. Used to migrate legacy records that stored an opaque
   * provider session ID as their application identity.
   */
  async rekeyConversation(
    conversationId: string,
    replacementConversationId: string
  ): Promise<PersistedConversationConfigRecord> {
    const existing = await this.getByConversationId(conversationId);
    if (!existing) throw new Error(`Conversation config not found: ${conversationId}`);
    if (await this.getByConversationId(replacementConversationId)) {
      throw new ConfigRevisionConflictError(-1, 0);
    }

    await this.purge(conversationId);
    const replacement = { ...existing, conversationId: replacementConversationId };
    try {
      return await this.save(replacement, 'missing');
    } catch (error) {
      await this.save(existing, 'missing');
      throw error;
    }
  }

  async appendBranchLaunch(conversationId: string, digest: string, handoff: string) {
    return this.updateRecord(conversationId, (record) => {
      const branch = record.creation?.branch;
      if (record.status === 'deleted' || !branch) throw new Error('Launch branch unavailable');
      if (digest === branch.throughMessageId || branch.launches?.[digest]) return record;
      // Never silently discard launch context needed by an outstanding request.
      if (Object.keys(branch.launches ?? {}).length >= 128)
        throw new Error(
          'Background review launch history is full; start another owner conversation'
        );
      return {
        ...record,
        creation: {
          ...record.creation,
          branch: { ...branch, launches: { ...branch.launches, [digest]: handoff } },
        },
      };
    });
  }

  /** Undefined when no record exists for this id. */
  setDone(
    conversationId: string,
    done: boolean
  ): Promise<PersistedConversationConfigRecord | undefined> {
    return this.updateRecord(conversationId, (record) =>
      record.done === done ? record : { ...record, done, updatedAt: this.now().toISOString() }
    );
  }

  async setCurrentSession(
    conversationId: string,
    currentSession: SessionBinding
  ): Promise<PersistedConversationConfigRecord | undefined> {
    const parsedSession = SessionBindingSchema.parse(currentSession);
    return this.updateRecord(conversationId, (record) => {
      if (
        record.currentSession?.provider === parsedSession.provider &&
        record.currentSession.sessionId === parsedSession.sessionId &&
        (parsedSession.buddyAudienceKey === undefined ||
          record.currentSession.buddyAudienceKey === parsedSession.buddyAudienceKey)
      ) {
        return record;
      }
      const historical = uniqueBindings([
        ...record.sessionBindings,
        ...(record.currentSession ? [record.currentSession] : []),
      ]).filter(
        (binding) =>
          binding.provider !== parsedSession.provider ||
          binding.sessionId !== parsedSession.sessionId
      );
      return {
        ...record,
        sessionBindings: historical,
        // Re-binding the SAME session (an audience-key change) must not discard
        // its measured usage; only a genuine session change starts a fresh
        // provider context and therefore a fresh count.
        currentSession:
          record.currentSession?.sessionId === parsedSession.sessionId
            ? {
                ...parsedSession,
                ...(record.currentSession.latestUsage
                  ? { latestUsage: record.currentSession.latestUsage }
                  : {}),
              }
            : parsedSession,
        updatedAt: this.now().toISOString(),
      };
    });
  }

  /**
   * Attach provider-counted usage to the CURRENT session binding.
   *
   * Deliberately a no-op when the record has no current session, or when its
   * session id has moved on: usage belongs to the session that produced it, and
   * a late write from a finished turn must not be filed against its successor.
   */
  async setCurrentSessionUsage(
    conversationId: string,
    sessionId: string,
    latestUsage: ProviderTurnUsage
  ): Promise<PersistedConversationConfigRecord | undefined> {
    const parsedUsage = ProviderTurnUsageSchema.parse(latestUsage);
    return this.updateRecord(conversationId, (record) => {
      if (record.currentSession?.sessionId !== sessionId) return record;
      return {
        ...record,
        currentSession: { ...record.currentSession, latestUsage: parsedUsage },
        updatedAt: this.now().toISOString(),
      };
    });
  }

  async addSessionBinding(
    conversationId: string,
    binding: SessionBinding
  ): Promise<PersistedConversationConfigRecord | undefined> {
    const parsedBinding = SessionBindingSchema.parse(binding);
    return this.updateRecord(conversationId, (record) => {
      if (
        record.currentSession?.provider === parsedBinding.provider &&
        record.currentSession.sessionId === parsedBinding.sessionId
      ) {
        return record;
      }
      const bindings = uniqueBindings([...record.sessionBindings, parsedBinding]);
      if (bindings.length === record.sessionBindings.length) return record;
      return {
        ...record,
        sessionBindings: bindings,
        updatedAt: this.now().toISOString(),
      };
    });
  }

  async markInitialMessageDispatched(
    conversationId: string,
    dispatchedAt = this.now()
  ): Promise<PersistedConversationConfigRecord | undefined> {
    return this.updateRecord(conversationId, (record) => {
      if (!record.creation?.initialMessage || record.creation.initialMessageDispatchedAt) {
        return record;
      }
      return {
        ...record,
        creation: {
          ...record.creation,
          initialMessageDispatchClaimedAt: undefined,
          initialMessageDispatchClaimToken: undefined,
          initialMessageDispatchedAt: dispatchedAt.toISOString(),
        },
        updatedAt: this.now().toISOString(),
      };
    });
  }

  /**
   * Atomically leases delivery of the creation message. Delivery is
   * acknowledged separately, so a crashed dispatcher can be recovered.
   */
  async claimInitialMessageDispatch(
    conversationId: string,
    claimedAt = this.now()
  ): Promise<PersistedConversationConfigRecord | undefined> {
    let claimed = false;
    const claimToken = randomUUID();
    const record = await this.updateRecord(conversationId, (current) => {
      claimed = false;
      if (
        current.status === 'deleted' ||
        !current.creation?.initialMessage ||
        current.creation.initialMessageDispatchedAt
      ) {
        return current;
      }
      const priorClaimedAt = current.creation.initialMessageDispatchClaimedAt;
      if (
        priorClaimedAt &&
        claimedAt.getTime() - Date.parse(priorClaimedAt) < INITIAL_MESSAGE_DISPATCH_LEASE_MS
      ) {
        return current;
      }
      claimed = true;
      return {
        ...current,
        creation: {
          ...current.creation,
          initialMessageDispatchClaimedAt: claimedAt.toISOString(),
          initialMessageDispatchClaimToken: claimToken,
        },
        updatedAt: claimedAt.toISOString(),
      };
    });
    return claimed ? record : undefined;
  }

  async completeInitialMessageDispatch(
    conversationId: string,
    claimToken: string,
    dispatchedAt = this.now()
  ): Promise<PersistedConversationConfigRecord | undefined> {
    let completed = false;
    const record = await this.updateRecord(conversationId, (current) => {
      if (
        current.status === 'deleted' ||
        !current.creation?.initialMessage ||
        current.creation.initialMessageDispatchedAt ||
        current.creation.initialMessageDispatchClaimToken !== claimToken
      ) {
        return current;
      }
      completed = true;
      return {
        ...current,
        creation: {
          ...current.creation,
          initialMessageDispatchClaimedAt: undefined,
          initialMessageDispatchClaimToken: undefined,
          initialMessageDispatchedAt: dispatchedAt.toISOString(),
        },
        updatedAt: dispatchedAt.toISOString(),
      };
    });
    return completed ? record : undefined;
  }

  async rebuildSessionIndex(): Promise<number> {
    const records = await this.list();
    const rebuiltRoot = `${this.sessionDirectory}.rebuild-${randomUUID()}`;
    await mkdir(rebuiltRoot, { recursive: true });
    let count = 0;
    for (const record of records) {
      for (const binding of recordSessionBindings(record)) {
        await this.atomicWriteJson(
          this.sessionIndexPath(binding, rebuiltRoot),
          {
            version: CONFIG_STORE_VERSION,
            conversationId: record.conversationId,
          },
          rebuiltRoot
        );
        count += 1;
      }
    }
    await rm(this.sessionDirectory, { recursive: true, force: true });
    await rename(rebuiltRoot, this.sessionDirectory);
    return count;
  }

  private async buildSessionLookupIndex(index: SessionLookupIndex): Promise<void> {
    const records = await this.scanRecords();
    index.records = new Map(records.map((record) => [record.conversationId, record]));
    for (const record of records) {
      this.updateSessionLookupIndex(
        index,
        record.conversationId,
        recordSessionBindings(record).map(bindingKey)
      );
    }
    // A write may have committed after readdir/readRecord captured the scan.
    // Replay its latest bindings so the scan cannot undo a creation or purge.
    for (const [conversationId, keys] of index.pending ?? []) {
      this.updateSessionLookupIndex(index, conversationId, keys);
    }
    index.pending = undefined;
  }

  private trackSessionBindings(conversationId: string, bindings: readonly SessionBinding[]): void {
    const index = this.sessionLookupIndex;
    if (!index) return;
    index.written.add(conversationId);
    const keys = bindings.map(bindingKey);
    if (index.pending) {
      index.pending.set(conversationId, keys);
    } else {
      this.updateSessionLookupIndex(index, conversationId, keys);
    }
  }

  private updateSessionLookupIndex(
    index: SessionLookupIndex,
    conversationId: string,
    keys: readonly string[]
  ): void {
    for (const key of index.byConversation.get(conversationId) ?? []) {
      const candidates = index.bySession.get(key);
      candidates?.delete(conversationId);
      if (candidates?.size === 0) index.bySession.delete(key);
    }
    index.byConversation.delete(conversationId);
    if (keys.length === 0) return;
    index.byConversation.set(conversationId, keys);
    for (const key of keys) {
      const candidates = index.bySession.get(key) ?? new Set<string>();
      candidates.add(conversationId);
      index.bySession.set(key, candidates);
    }
  }

  private async readRecord(
    filePath: string
  ): Promise<PersistedConversationConfigRecord | undefined> {
    let source: string;
    try {
      source = await readFile(filePath, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(source);
    } catch (error) {
      await this.quarantine(filePath, errorMessage(error));
      return undefined;
    }

    const version = objectVersion(decoded);
    if (version !== undefined && version > CONFIG_STORE_VERSION) {
      this.logger?.warn({ code: 'future_record_version', filePath, version });
      throw new UnsupportedConfigRecordVersionError(filePath, version);
    }

    const parsed = PersistedConversationConfigRecordSchema.safeParse(decoded);
    if (!parsed.success) {
      await this.quarantine(filePath, parsed.error.message);
      return undefined;
    }
    return parsed.data;
  }

  private async updateRecord(
    conversationId: string,
    update: (record: PersistedConversationConfigRecord) => PersistedConversationConfigRecord
  ): Promise<PersistedConversationConfigRecord | undefined> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await this.getByConversationId(conversationId);
      if (!existing) return undefined;
      const next = update(existing);
      if (next === existing) return existing;
      try {
        return await this.save(
          { ...next, recordRevision: existing.recordRevision + 1 },
          {
            configRevision: existing.configRevision,
            recordRevision: existing.recordRevision,
          }
        );
      } catch (error) {
        if (!(error instanceof ConfigRevisionConflictError) || attempt === 2) throw error;
      }
    }
    return undefined;
  }

  private async readSessionIndex(filePath: string): Promise<string | undefined> {
    try {
      const decoded = JSON.parse(await readFile(filePath, 'utf8'));
      const parsed = SessionIndexRecordSchema.safeParse(decoded);
      return parsed.success ? parsed.data.conversationId : undefined;
    } catch (error) {
      if (isMissingFileError(error) || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  private async quarantine(filePath: string, error: string): Promise<void> {
    await mkdir(this.quarantineDirectory, { recursive: true });
    const quarantinePath = path.join(
      this.quarantineDirectory,
      `${path.basename(filePath, '.json')}-${this.now().toISOString().replaceAll(':', '-')}.json`
    );
    try {
      await rename(filePath, quarantinePath);
    } catch (renameError) {
      if (!isMissingFileError(renameError)) throw renameError;
      return;
    }
    this.logger?.warn({
      code: 'corrupt_record_quarantined',
      filePath,
      quarantinePath,
      error,
    });
  }

  private async reconcileSessionIndexes(
    conversationId: string,
    previous: readonly SessionBinding[],
    next: readonly SessionBinding[]
  ): Promise<void> {
    const nextKeys = new Set(next.map(bindingKey));
    for (const binding of previous) {
      if (!nextKeys.has(bindingKey(binding))) {
        const indexPath = this.sessionIndexPath(binding);
        const indexedId = await this.readSessionIndex(indexPath);
        if (indexedId === conversationId) {
          await rm(indexPath, { force: true });
        }
      }
    }
    for (const binding of next) {
      await this.writeSessionIndex(binding, conversationId);
    }
  }

  private async writeSessionIndex(binding: SessionBinding, conversationId: string): Promise<void> {
    await this.atomicWriteJson(this.sessionIndexPath(binding), {
      version: CONFIG_STORE_VERSION,
      conversationId,
    });
  }

  private conversationPath(conversationId: string): string {
    const parsed = z.string().min(1).parse(conversationId);
    return path.join(this.conversationDirectory, `${encodeSessionId(parsed)}.json`);
  }

  private sessionIndexPath(binding: SessionBinding, root = this.sessionDirectory): string {
    const parsed = SessionBindingSchema.parse(binding);
    return path.join(root, parsed.provider, `${encodeSessionId(parsed.sessionId)}.json`);
  }

  private async atomicWriteJson(
    filePath: string,
    value: unknown,
    syncRoot?: string
  ): Promise<void> {
    const directory = path.dirname(filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = path.join(
      directory,
      `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
    );
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      if (this.durableWrites) {
        const temporary = await open(temporaryPath, 'r');
        try {
          await temporary.sync();
        } finally {
          await temporary.close();
        }
      }
      await rename(temporaryPath, filePath);
      if (this.durableWrites) {
        const directoryHandle = await open(syncRoot ?? directory, 'r');
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.catch(() => undefined).then(() => current);
    this.locks.set(key, tail);
    await prior.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}

function encodeSessionId(sessionId: string): string {
  return Buffer.from(sessionId, 'utf8').toString('base64url');
}

function bindingKey(binding: SessionBinding): string {
  return `${binding.provider}\0${binding.sessionId}`;
}

function uniqueBindings(bindings: readonly SessionBinding[]): SessionBinding[] {
  const unique = new Map<string, SessionBinding>();
  for (const binding of bindings) unique.set(bindingKey(binding), binding);
  return [...unique.values()];
}

function recordSessionBindings(record: PersistedConversationConfigRecord): SessionBinding[] {
  return uniqueBindings([
    ...record.sessionBindings,
    ...(record.currentSession ? [record.currentSession] : []),
  ]);
}

function objectVersion(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || !('version' in value)) return undefined;
  return typeof value.version === 'number' ? value.version : undefined;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
