import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ConversationConfig, ResolvedExecutionConfig } from '@unleashd/shared';
import {
  CONFIG_STORE_VERSION,
  ConfigRevisionConflictError,
  type ConfigStoreWarning,
  ConversationConfigStore,
  PersistedConversationConfigRecordSchema,
  UnsupportedConfigRecordVersionError,
} from '../src/conversations/config-store';

const CONVERSATION_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_CONVERSATION_ID = '550e8400-e29b-41d4-a716-446655440001';

const CONFIG: ConversationConfig = {
  provider: 'codex',
  model: { mode: 'default' },
  reasoning: { mode: 'disabled' },
};

const RESOLVED: ResolvedExecutionConfig = {
  provider: 'codex',
  modelId: 'gpt-5.6-sol',
};

async function withStore(
  run: (
    store: ConversationConfigStore,
    root: string,
    warnings: ConfigStoreWarning[]
  ) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'unleashd-config-store-'));
  const warnings: ConfigStoreWarning[] = [];
  const store = new ConversationConfigStore({
    appDataRoot: root,
    now: () => new Date('2026-07-28T12:00:00.000Z'),
    logger: { warn: (warning) => warnings.push(warning) },
  });
  try {
    await run(store, root, warnings);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('config store round-trips durable selection intent and resolves session bindings', async () => {
  await withStore(async (store) => {
    const created = await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      sessionBindings: [{ provider: 'codex', sessionId: 'thread/with unsafe chars' }],
      config: CONFIG,
      lastResolvedConfig: RESOLVED,
      provenance: 'user',
    });
    assert.equal(created.version, CONFIG_STORE_VERSION);
    assert.equal(created.configRevision, 0);

    assert.deepEqual(await store.getByConversationId(CONVERSATION_ID), created);
    assert.deepEqual(await store.findBySession('codex', 'thread/with unsafe chars'), created);
  });
});

test('config store rekeys opaque legacy application IDs without losing session identity', async () => {
  await withStore(async (store) => {
    const opaqueId = 'ses_native-provider-id';
    await store.create({
      conversationId: opaqueId,
      kind: { t: 'chat' },
      currentSession: { provider: 'opencode', sessionId: opaqueId },
      config: { ...CONFIG, provider: 'opencode' },
      provenance: 'legacy_inferred',
    });

    const migrated = await store.rekeyConversation(opaqueId, CONVERSATION_ID);

    assert.equal(migrated.conversationId, CONVERSATION_ID);
    assert.equal(await store.getByConversationId(opaqueId), undefined);
    assert.equal(
      (await store.findBySession('opencode', opaqueId))?.conversationId,
      CONVERSATION_ID
    );
  });
});

test('records without lifecycle fields parse as active without inventing a current session', () => {
  const parsed = PersistedConversationConfigRecordSchema.parse({
    version: 2,
    conversationId: CONVERSATION_ID,
    kind: { t: 'chat' },
    sessionBindings: [{ provider: 'codex', sessionId: 'legacy-session' }],
    config: CONFIG,
    configRevision: 0,
    provenance: 'legacy_inferred',
    createdAt: '2026-07-28T12:00:00.000Z',
    updatedAt: '2026-07-28T12:00:00.000Z',
  });
  assert.equal(parsed.status, 'active');
  assert.equal(parsed.currentSession, undefined);
});

test('config store serializes concurrent revision checks', async () => {
  await withStore(async (store) => {
    const initial = await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      config: CONFIG,
      provenance: 'user',
    });
    const update = {
      ...initial,
      configRevision: 1,
      updatedAt: '2026-07-28T12:01:00.000Z',
    };
    const outcomes = await Promise.allSettled([
      store.save(update, 0),
      store.save(
        {
          ...update,
          config: { ...CONFIG, reasoning: { mode: 'default' as const } },
        },
        0
      ),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = outcomes.find((result) => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected');
    assert.ok(rejected.reason instanceof ConfigRevisionConflictError);
  });
});

test('session binding rotation removes the old index and lookup repairs a missing index', async () => {
  await withStore(async (store) => {
    const initial = await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      sessionBindings: [{ provider: 'codex', sessionId: 'old-session' }],
      config: CONFIG,
      provenance: 'user',
    });
    await store.save(
      {
        ...initial,
        configRevision: 1,
        sessionBindings: [{ provider: 'codex', sessionId: 'new-session' }],
      },
      0
    );
    assert.equal(await store.findBySession('codex', 'old-session'), undefined);
    assert.equal(
      (await store.findBySession('codex', 'new-session'))?.conversationId,
      CONVERSATION_ID
    );

    await rm(store.sessionDirectory, { recursive: true, force: true });
    assert.equal(
      (await store.findBySession('codex', 'new-session'))?.conversationId,
      CONVERSATION_ID
    );
    assert.equal(await store.rebuildSessionIndex(), 1);
  });
});

test('bulk session lookups scan once while imports, rotations, tombstones, and rekeys update the index', async () => {
  await withStore(async (store) => {
    // The bulk scope's one full scan (private; list() serves it inside a scope).
    const scanner = store as unknown as { scanRecords: () => ReturnType<typeof store.list> };
    const list = scanner.scanRecords.bind(store);
    let scans = 0;
    scanner.scanRecords = async () => {
      scans += 1;
      return list();
    };

    await store.withSessionLookupIndex(async () => {
      for (let i = 0; i < 12; i += 1) {
        const sessionId = `session-${i}`;
        assert.equal(await store.findBySession('codex', sessionId), undefined);
        assert.equal(await store.findBySession('codex', sessionId), undefined);
        await store.create({
          conversationId: `import-${i}`,
          kind: { t: 'chat' },
          currentSession: { provider: 'codex', sessionId },
          config: CONFIG,
          provenance: 'legacy_inferred',
        });
        // Exercise the transient fallback, not just the normal durable index.
        await rm(store.sessionDirectory, { recursive: true, force: true });
        assert.equal(
          (await store.findBySession('codex', sessionId))?.conversationId,
          `import-${i}`
        );
      }

      await store.setCurrentSession('import-0', { provider: 'codex', sessionId: 'rotated' });
      await store.delete('import-0');
      await store.rekeyConversation('import-1', CONVERSATION_ID);
      await store.purge('import-2');
      await rm(store.sessionDirectory, { recursive: true, force: true });
      assert.equal((await store.findBySession('codex', 'session-0'))?.status, 'deleted');
      assert.equal((await store.findBySession('codex', 'rotated'))?.status, 'deleted');
      assert.equal(
        (await store.findBySession('codex', 'session-1'))?.conversationId,
        CONVERSATION_ID
      );
      assert.equal(await store.findBySession('codex', 'session-2'), undefined);
      await store.withSessionLookupIndex(async () => {
        assert.equal(await store.findBySession('codex', 'nested-miss'), undefined);
      });
      assert.equal(scans, 1);
    });

    assert.equal(await store.findBySession('codex', 'ordinary-miss'), undefined);
    assert.equal(scans, 1, 'the index built by the import answers misses after it');
  });
});

test('bulk lookup repairs stale indexes, reads current records, and releases its scope after failure', async () => {
  await withStore(async (store, root) => {
    const binding = { provider: 'codex' as const, sessionId: 'native-session' };
    await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      currentSession: binding,
      config: CONFIG,
      provenance: 'user',
    });
    await store.create({
      conversationId: OTHER_CONVERSATION_ID,
      kind: { t: 'chat' },
      config: CONFIG,
      provenance: 'user',
    });
    const indexPath = path.join(
      store.sessionDirectory,
      'codex',
      `${Buffer.from(binding.sessionId).toString('base64url')}.json`
    );
    const otherStore = new ConversationConfigStore({ appDataRoot: root });

    await assert.rejects(
      store.withSessionLookupIndex(async () => {
        await writeFile(
          indexPath,
          JSON.stringify({ version: 1, conversationId: OTHER_CONVERSATION_ID })
        );
        assert.equal(
          (await store.findBySession('codex', binding.sessionId))?.conversationId,
          CONVERSATION_ID
        );
        assert.equal(JSON.parse(await readFile(indexPath, 'utf8')).conversationId, CONVERSATION_ID);

        await otherStore.delete(CONVERSATION_ID);
        await rm(store.sessionDirectory, { recursive: true, force: true });
        assert.equal((await store.findBySession('codex', binding.sessionId))?.status, 'deleted');

        await otherStore.create({
          conversationId: 'external-record',
          kind: { t: 'chat' },
          currentSession: { provider: 'codex', sessionId: 'external-session' },
          config: CONFIG,
          provenance: 'user',
        });
        assert.equal(
          (await store.findBySession('codex', 'external-session'))?.conversationId,
          'external-record'
        );
        assert.equal(await store.findBySession('codex', 'future-unindexed-session'), undefined);
        throw new Error('import failed');
      }),
      /import failed/
    );

    // The failed scope released its record scan: list() reads the disk again.
    assert.ok((await store.list()).some((record) => record.conversationId === 'external-record'));
    // Another process's later write reaches this store through the durable
    // by-session index it maintains, not through a scan.
    await otherStore.setCurrentSession('external-record', {
      provider: 'codex',
      sessionId: 'future-unindexed-session',
    });
    assert.equal(
      (await store.findBySession('codex', 'future-unindexed-session'))?.conversationId,
      'external-record'
    );
  });
});

test('bulk lookup includes writes and purges committed while its initial record scan is pending', async () => {
  await withStore(async (store) => {
    await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      currentSession: { provider: 'codex', sessionId: 'removed-during-scan' },
      config: CONFIG,
      provenance: 'user',
    });
    let releaseScan!: () => void;
    let markScanned!: () => void;
    const resumeScan = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    const scanned = new Promise<void>((resolve) => {
      markScanned = resolve;
    });
    // The bulk scope's one full scan (private; list() serves it inside a scope).
    const scanner = store as unknown as { scanRecords: () => ReturnType<typeof store.list> };
    const list = scanner.scanRecords.bind(store);
    scanner.scanRecords = async () => {
      const records = await list();
      markScanned();
      await resumeScan;
      return records;
    };

    let markWritten!: () => void;
    const written = new Promise<void>((resolve) => {
      markWritten = resolve;
    });
    // The scope does not wait for its scan; these lookups run after the writes
    // below, and must see them although the scan captured the older records.
    const loading = store.withSessionLookupIndex(async () => {
      await written;
      assert.equal(await store.findBySession('codex', 'removed-during-scan'), undefined);
      assert.equal(
        (await store.findBySession('codex', 'created-during-scan'))?.conversationId,
        OTHER_CONVERSATION_ID
      );
    });
    await scanned;
    try {
      await store.purge(CONVERSATION_ID);
      await store.create({
        conversationId: OTHER_CONVERSATION_ID,
        kind: { t: 'chat' },
        currentSession: { provider: 'codex', sessionId: 'created-during-scan' },
        config: CONFIG,
        provenance: 'user',
      });
      await rm(store.sessionDirectory, { recursive: true, force: true });
    } finally {
      markWritten();
      releaseScan();
    }
    await loading;
  });
});

test('list inside a bulk scope serves its one scan and never a record this store rewrote', async () => {
  // Startup recovery lists every record inside the scope whose index scan
  // already read them all (2026-09-25); reusing that scan must not hide writes
  // made after it.
  await withStore(async (store) => {
    await store.create({
      kind: { t: 'chat' },
      conversationId: CONVERSATION_ID,
      config: CONFIG,
      provenance: 'user',
    });
    await store.create({
      kind: { t: 'chat' },
      conversationId: 'purged',
      config: CONFIG,
      provenance: 'user',
    });
    const scanner = store as unknown as { scanRecords: () => ReturnType<typeof store.list> };
    const scan = scanner.scanRecords.bind(store);
    let scans = 0;
    scanner.scanRecords = async () => {
      scans += 1;
      return scan();
    };
    await store.withSessionLookupIndex(async () => {
      assert.equal((await store.list()).length, 2);
      await store.setDone(CONVERSATION_ID, true);
      await store.purge('purged');
      await store.create({
        conversationId: OTHER_CONVERSATION_ID,
        kind: { t: 'chat' },
        config: CONFIG,
        provenance: 'user',
      });
      const listed = new Map((await store.list()).map((record) => [record.conversationId, record]));
      assert.deepEqual([...listed.keys()].sort(), [CONVERSATION_ID, OTHER_CONVERSATION_ID]);
      assert.equal(listed.get(CONVERSATION_ID)?.done, true);
    });
    assert.equal(scans, 1);
  });
});

test('a bulk scope runs without waiting for its record scan', async () => {
  // Regression, 2026-09-25: startup awaited a full read of every record
  // (~7,800, 3-6s) before discovery began. Only a lookup miss needs the scan.
  await withStore(async (store) => {
    const scanner = store as unknown as { scanRecords: () => ReturnType<typeof store.list> };
    const scan = scanner.scanRecords.bind(store);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    scanner.scanRecords = async () => {
      await held;
      return scan();
    };
    const ran = await Promise.race([
      store.withSessionLookupIndex(async () => 'ran'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 500)),
    ]);
    release();
    assert.equal(ran, 'ran');
  });
});

test('one failing bulk lookup does not release an overlapping import scope', async () => {
  await withStore(async (store) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The bulk scope's one full scan (private; list() serves it inside a scope).
    const scanner = store as unknown as { scanRecords: () => ReturnType<typeof store.list> };
    const list = scanner.scanRecords.bind(store);
    let scans = 0;
    scanner.scanRecords = async () => {
      scans += 1;
      return list();
    };
    const importing = store.withSessionLookupIndex(() => held);
    try {
      await assert.rejects(
        store.withSessionLookupIndex(async () => {
          throw new Error('other import failed');
        }),
        /other import failed/
      );
      assert.equal(await store.findBySession('codex', 'still-importing'), undefined);
      assert.equal(scans, 1);
    } finally {
      release();
      await importing;
    }
    assert.equal(await store.findBySession('codex', 'finished-importing'), undefined);
    assert.equal(scans, 1);
  });
});

test('after the startup scope, a session lookup miss never scans every record', async () => {
  // Regression, 2026-09-25: the startup index was dropped when its scope ended,
  // so each later miss read and parsed all ~7,800 records (42MB, ~3.2s), up to
  // 3x per new external session the poller found.
  await withStore(async (store, root) => {
    await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      currentSession: { provider: 'codex', sessionId: 'known-session' },
      config: CONFIG,
      provenance: 'user',
    });
    await store.create({
      conversationId: OTHER_CONVERSATION_ID,
      kind: { t: 'chat' },
      currentSession: { provider: 'claude', sessionId: 'unindexed-on-disk' },
      config: CONFIG,
      provenance: 'user',
    });
    // A record with no durable index entry, as an older version could leave:
    // the startup scan must cover it, not a per-lookup scan.
    await rm(path.join(store.sessionDirectory, 'claude'), { recursive: true, force: true });

    const restarted = new ConversationConfigStore({ appDataRoot: root });
    await restarted.withSessionLookupIndex(async () => {});
    const scanner = restarted as unknown as { scanRecords: () => Promise<unknown> };
    scanner.scanRecords = async () => {
      throw new Error('findBySession scanned every record after startup');
    };

    assert.equal(await restarted.findBySession('codex', 'never-seen'), undefined);
    assert.equal(
      (await restarted.findBySession('codex', 'known-session'))?.conversationId,
      CONVERSATION_ID
    );
    assert.equal(
      (await restarted.findBySession('claude', 'unindexed-on-disk'))?.conversationId,
      OTHER_CONVERSATION_ID
    );

    // Writes after startup keep the retained index current.
    await restarted.create({
      conversationId: 'created-after-startup',
      kind: { t: 'chat' },
      currentSession: { provider: 'codex', sessionId: 'late-session' },
      config: CONFIG,
      provenance: 'user',
    });
    await restarted.purge(CONVERSATION_ID);
    await rm(restarted.sessionDirectory, { recursive: true, force: true });
    assert.equal(
      (await restarted.findBySession('codex', 'late-session'))?.conversationId,
      'created-after-startup'
    );
    assert.equal(await restarted.findBySession('codex', 'known-session'), undefined);
  });
});

test('deleting a config persists a tombstone and keeps session identity across restart', async () => {
  await withStore(async (store, root) => {
    await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      currentSession: { provider: 'codex', sessionId: 'native-session' },
      config: CONFIG,
      provenance: 'user',
    });

    assert.equal(await store.delete(CONVERSATION_ID), true);
    assert.equal(await store.delete(CONVERSATION_ID), false);
    const restartedStore = new ConversationConfigStore({ appDataRoot: root });
    const tombstone = await restartedStore.getByConversationId(CONVERSATION_ID);
    assert.equal(tombstone?.status, 'deleted');
    assert.equal(tombstone?.deletedAt, '2026-07-28T12:00:00.000Z');
    assert.equal(
      (await restartedStore.findBySession('codex', 'native-session'))?.conversationId,
      CONVERSATION_ID
    );
    assert.deepEqual(
      (await restartedStore.listActive()).map((record) => record.conversationId),
      []
    );
    assert.deepEqual(
      (await restartedStore.listDeleted()).map((record) => record.conversationId),
      [CONVERSATION_ID]
    );

    assert.equal(await restartedStore.purge(CONVERSATION_ID), true);
    assert.equal(await restartedStore.getByConversationId(CONVERSATION_ID), undefined);
    assert.equal(await restartedStore.findBySession('codex', 'native-session'), undefined);
  });
});

test('current session rotation preserves historical aliases without ambiguous resume state', async () => {
  await withStore(async (store) => {
    await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      currentSession: { provider: 'codex', sessionId: 'old-session' },
      config: CONFIG,
      provenance: 'user',
    });

    const rotated = await store.setCurrentSession(CONVERSATION_ID, {
      provider: 'codex',
      sessionId: 'new-session',
    });
    assert.deepEqual(rotated?.currentSession, {
      provider: 'codex',
      sessionId: 'new-session',
    });
    assert.deepEqual(rotated?.sessionBindings, [{ provider: 'codex', sessionId: 'old-session' }]);
    assert.equal(
      (await store.findBySession('codex', 'old-session'))?.conversationId,
      CONVERSATION_ID
    );
    assert.equal(
      (await store.findBySession('codex', 'new-session'))?.conversationId,
      CONVERSATION_ID
    );
    assert.equal(await store.rebuildSessionIndex(), 2);
  });
});

test('concurrent session rotations retain every alias through record-level CAS', async () => {
  await withStore(async (store) => {
    await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      currentSession: { provider: 'codex', sessionId: 'session-1' },
      config: CONFIG,
      provenance: 'user',
    });

    await Promise.all([
      store.setCurrentSession(CONVERSATION_ID, {
        provider: 'codex',
        sessionId: 'session-2',
      }),
      store.setCurrentSession(CONVERSATION_ID, {
        provider: 'codex',
        sessionId: 'session-3',
      }),
    ]);

    const record = await store.getByConversationId(CONVERSATION_ID);
    assert.equal(record?.recordRevision, 2);
    const allSessions = [
      ...(record?.sessionBindings.map((binding) => binding.sessionId) ?? []),
      ...(record?.currentSession ? [record.currentSession.sessionId] : []),
    ];
    assert.deepEqual(allSessions.sort(), ['session-1', 'session-2', 'session-3']);
  });
});

test('creation recovery metadata and initial-message delivery marker are durable', async () => {
  await withStore(async (store) => {
    await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      workingDirectory: '/tmp/project',
      creation: {
        commandId: 'create-command',
        fingerprint: 'request-fingerprint',
        initialMessage: 'Start here',
      },
      config: CONFIG,
      provenance: 'user',
    });

    const beforeDispatch = await store.getByConversationId(CONVERSATION_ID);
    assert.equal(beforeDispatch?.status, 'active');
    assert.equal(beforeDispatch?.workingDirectory, '/tmp/project');
    assert.equal(beforeDispatch?.creation?.initialMessageDispatchedAt, undefined);

    const claims = await Promise.all([
      store.claimInitialMessageDispatch(CONVERSATION_ID, new Date('2026-07-28T12:01:00.000Z')),
      store.claimInitialMessageDispatch(CONVERSATION_ID, new Date('2026-07-28T12:01:01.000Z')),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const claim = claims.find(Boolean);
    assert.ok(claim?.creation?.initialMessageDispatchClaimToken);
    assert.equal(claim?.creation?.initialMessageDispatchedAt, undefined);
    await store.completeInitialMessageDispatch(
      CONVERSATION_ID,
      claim.creation.initialMessageDispatchClaimToken,
      new Date('2026-07-28T12:01:02.000Z')
    );
    const afterDispatch = await store.getByConversationId(CONVERSATION_ID);
    assert.ok(afterDispatch?.creation?.initialMessageDispatchedAt);
  });
});

test('corrupt records are quarantined once and do not prevent loading valid records', async () => {
  await withStore(async (store, _root, warnings) => {
    await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      config: CONFIG,
      provenance: 'user',
    });
    await mkdir(store.conversationDirectory, { recursive: true });
    await writeFile(
      path.join(store.conversationDirectory, `${OTHER_CONVERSATION_ID}.json`),
      '{not-json',
      'utf8'
    );

    const listed = await store.list();
    assert.deepEqual(
      listed.map((record) => record.conversationId),
      [CONVERSATION_ID]
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.code, 'corrupt_record_quarantined');
    assert.equal((await readdir(store.quarantineDirectory)).length, 1);

    await store.list();
    assert.equal(warnings.length, 1);
  });
});

test('future-version records are preserved and never quarantined or overwritten', async () => {
  await withStore(async (store, _root, warnings) => {
    await mkdir(store.conversationDirectory, { recursive: true });
    const encodedId = Buffer.from(CONVERSATION_ID, 'utf8').toString('base64url');
    const filePath = path.join(store.conversationDirectory, `${encodedId}.json`);
    const future = { version: 999, conversationId: CONVERSATION_ID };
    await writeFile(filePath, JSON.stringify(future), 'utf8');

    await assert.rejects(
      store.getByConversationId(CONVERSATION_ID),
      UnsupportedConfigRecordVersionError
    );
    assert.deepEqual(await store.list(), []);
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), future);
    assert.equal(warnings[0]?.code, 'future_record_version');
    await assert.rejects(
      store.create({
        conversationId: CONVERSATION_ID,
        kind: { t: 'chat' },
        config: CONFIG,
        provenance: 'user',
      }),
      UnsupportedConfigRecordVersionError
    );
  });
});

test('store rejects relative app-data roots', () => {
  assert.throws(
    () => new ConversationConfigStore({ appDataRoot: 'relative/path' }),
    /must be absolute/
  );
});

// The context meter's whole value is that it survives a restart: without this
// round-trip a reload falls back to the chars/4 estimate until the next turn
// reports usage, which is exactly the wrong number to show on a long thread.
test('provider usage persists on the current session and survives a reopen', async () => {
  await withStore(async (store, root) => {
    await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      sessionBindings: [],
      config: CONFIG,
      provenance: 'user',
    });
    await store.setCurrentSession(CONVERSATION_ID, { provider: 'codex', sessionId: 'sess-a' });
    await store.setCurrentSessionUsage(CONVERSATION_ID, 'sess-a', {
      contextTokens: 30_735,
      outputTokens: 412,
      cachedInputTokens: 30_080,
      contextWindow: 258_400,
      observedAt: '2026-09-20T00:00:00.000Z',
    });

    // Reopen from disk exactly as a restarted server would.
    const reopened = new ConversationConfigStore({ appDataRoot: root });
    const record = await reopened.getByConversationId(CONVERSATION_ID);
    assert.equal(record?.currentSession?.latestUsage?.contextTokens, 30_735);
    assert.equal(record?.currentSession?.latestUsage?.contextWindow, 258_400);
  });
});

// Usage belongs to the session that produced it. A late write from a turn that
// finished after the session rotated must not be filed against its successor —
// that would show the old thread's full context on a brand-new one.
test('usage for a superseded session is dropped, not filed against the new one', async () => {
  await withStore(async (store) => {
    await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      sessionBindings: [],
      config: CONFIG,
      provenance: 'user',
    });
    await store.setCurrentSession(CONVERSATION_ID, { provider: 'codex', sessionId: 'sess-a' });
    await store.setCurrentSession(CONVERSATION_ID, { provider: 'codex', sessionId: 'sess-b' });
    await store.setCurrentSessionUsage(CONVERSATION_ID, 'sess-a', {
      contextTokens: 900_000,
      outputTokens: 1,
      observedAt: '2026-09-20T00:00:00.000Z',
    });

    const record = await store.getByConversationId(CONVERSATION_ID);
    assert.equal(record?.currentSession?.sessionId, 'sess-b');
    assert.equal(record?.currentSession?.latestUsage, undefined);
  });
});

// Re-binding the SAME session (an audience-key change on a Buddy thread) is not
// a new provider context, so it must not throw the measured count away.
test('re-binding the same session keeps its measured usage', async () => {
  await withStore(async (store) => {
    await store.create({
      conversationId: CONVERSATION_ID,
      kind: { t: 'chat' },
      sessionBindings: [],
      config: CONFIG,
      provenance: 'user',
    });
    await store.setCurrentSession(CONVERSATION_ID, { provider: 'codex', sessionId: 'sess-a' });
    await store.setCurrentSessionUsage(CONVERSATION_ID, 'sess-a', {
      contextTokens: 12_345,
      outputTokens: 7,
      observedAt: '2026-09-20T00:00:00.000Z',
    });
    await store.setCurrentSession(CONVERSATION_ID, {
      provider: 'codex',
      sessionId: 'sess-a',
      buddyAudienceKey: 'audience-2',
    });

    const record = await store.getByConversationId(CONVERSATION_ID);
    assert.equal(record?.currentSession?.buddyAudienceKey, 'audience-2');
    assert.equal(record?.currentSession?.latestUsage?.contextTokens, 12_345);
  });
});
