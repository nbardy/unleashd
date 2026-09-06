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

test('legacy v1 records parse as active without inventing a current session', () => {
  const parsed = PersistedConversationConfigRecordSchema.parse({
    version: 1,
    conversationId: CONVERSATION_ID,
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
    const list = store.list.bind(store);
    let scans = 0;
    store.list = async (options) => {
      scans += 1;
      return list(options);
    };

    await store.withSessionLookupIndex(async () => {
      for (let i = 0; i < 12; i += 1) {
        const sessionId = `session-${i}`;
        assert.equal(await store.findBySession('codex', sessionId), undefined);
        assert.equal(await store.findBySession('codex', sessionId), undefined);
        await store.create({
          conversationId: `import-${i}`,
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
    assert.equal(scans, 2, 'ordinary lookup resumes scanning after the import');
  });
});

test('bulk lookup repairs stale indexes, reads current records, and releases its scope after failure', async () => {
  await withStore(async (store, root) => {
    const binding = { provider: 'codex' as const, sessionId: 'native-session' };
    await store.create({
      conversationId: CONVERSATION_ID,
      currentSession: binding,
      config: CONFIG,
      provenance: 'user',
    });
    await store.create({
      conversationId: OTHER_CONVERSATION_ID,
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

    await otherStore.setCurrentSession('external-record', {
      provider: 'codex',
      sessionId: 'future-unindexed-session',
    });
    await rm(store.sessionDirectory, { recursive: true, force: true });
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
    const list = store.list.bind(store);
    store.list = async (options) => {
      const records = await list(options);
      markScanned();
      await resumeScan;
      return records;
    };

    const loading = store.withSessionLookupIndex(async () => {
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
        currentSession: { provider: 'codex', sessionId: 'created-during-scan' },
        config: CONFIG,
        provenance: 'user',
      });
      await rm(store.sessionDirectory, { recursive: true, force: true });
    } finally {
      releaseScan();
    }
    await loading;
  });
});

test('one failing bulk lookup does not release an overlapping import scope', async () => {
  await withStore(async (store) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const list = store.list.bind(store);
    let scans = 0;
    store.list = async (options) => {
      scans += 1;
      return list(options);
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
    assert.equal(scans, 2);
  });
});

test('deleting a config persists a tombstone and keeps session identity across restart', async () => {
  await withStore(async (store, root) => {
    await store.create({
      conversationId: CONVERSATION_ID,
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
