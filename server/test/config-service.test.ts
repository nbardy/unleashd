import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ConfigResolution, ConversationConfig, Provider } from '@unleashd/shared';
import {
  ConversationConfigResolutionError,
  type ConversationConfigResolver,
  ConversationConfigService,
  ConversationTombstonedError,
  applyConversationConfigPatch,
} from '../src/conversations/config-service';
import {
  ConfigRevisionConflictError,
  ConversationConfigStore,
} from '../src/conversations/config-store';
import { migrateLegacyConversationConfig } from '../src/conversations/legacy-config-migration';

const CONVERSATION_ID = '550e8400-e29b-41d4-a716-446655440000';
const FORK_ID = '550e8400-e29b-41d4-a716-446655440001';

const DEFAULT_CONFIG: ConversationConfig = {
  provider: 'codex',
  model: { mode: 'default' },
  reasoning: { mode: 'default' },
};

const DEFAULTS: Record<Provider, string> = {
  claude: 'opus',
  codex: 'gpt-5.6-sol',
  opencode: 'opencode/big-pickle',
  gemini: 'gemini-3.1-pro-preview',
  cursor: 'composer-2.5',
};

const resolver: ConversationConfigResolver = {
  async resolve(config): Promise<ConfigResolution> {
    const modelId =
      config.model.mode === 'default' ? DEFAULTS[config.provider] : config.model.modelId;
    if (modelId === 'retired-model') {
      return {
        status: 'unavailable',
        catalogRevision: 'test-catalog-1',
        error: {
          code: 'model_unavailable',
          message: 'Model is unavailable',
          provider: config.provider,
          modelId,
        },
      };
    }
    const defaultEffort =
      modelId === 'gpt-5.6-sol' ? 'ultra' : modelId === 'gpt-5.6-terra' ? 'xhigh' : undefined;
    const reasoningEffort =
      config.reasoning.mode === 'explicit'
        ? config.reasoning.effort
        : config.reasoning.mode === 'default'
          ? defaultEffort
          : undefined;
    if (reasoningEffort === 'invalid') {
      return {
        status: 'unavailable',
        catalogRevision: 'test-catalog-1',
        error: {
          code: 'reasoning_unavailable',
          message: 'Reasoning effort is unavailable',
          provider: config.provider,
          modelId,
        },
      };
    }
    return {
      status: 'resolved',
      catalogRevision: 'test-catalog-1',
      value: {
        provider: config.provider,
        modelId,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
    };
  },
};

async function withService(
  run: (service: ConversationConfigService, store: ConversationConfigStore) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'unleashd-config-service-'));
  const store = new ConversationConfigStore({ appDataRoot: root });
  const service = new ConversationConfigService({
    store,
    resolver,
    now: () => new Date('2026-07-28T12:00:00.000Z'),
  });
  try {
    await run(service, store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('pure provider transition resets dependent selections and enforces lifecycle', () => {
  const reset = applyConversationConfigPatch(
    {
      provider: 'codex',
      model: { mode: 'explicit', modelId: 'gpt-5.6-terra' },
      reasoning: { mode: 'disabled' },
    },
    { isRunning: false, queueDepth: 0, hasStartedSession: false },
    { kind: 'set_provider', provider: 'claude' }
  );
  assert.deepEqual(reset, {
    ok: true,
    value: {
      provider: 'claude',
      model: { mode: 'default' },
      reasoning: { mode: 'default' },
    },
  });

  const locked = applyConversationConfigPatch(
    DEFAULT_CONFIG,
    { isRunning: false, queueDepth: 0, hasStartedSession: true },
    { kind: 'set_provider', provider: 'claude' }
  );
  assert.equal(locked.ok, false);
  if (!locked.ok) assert.equal(locked.error.code, 'provider_locked');

  const modelWhileBusy = applyConversationConfigPatch(
    DEFAULT_CONFIG,
    { isRunning: false, queueDepth: 1, hasStartedSession: false },
    { kind: 'set_model', model: { mode: 'explicit', modelId: 'gpt-5.4' } }
  );
  assert.equal(modelWhileBusy.ok, true);

  const reasoningWhileRunning = applyConversationConfigPatch(
    DEFAULT_CONFIG,
    { isRunning: true, queueDepth: 1, hasStartedSession: true },
    { kind: 'set_reasoning', reasoning: { mode: 'disabled' } }
  );
  assert.equal(reasoningWhileRunning.ok, true);

  const providerWhileBusy = applyConversationConfigPatch(
    DEFAULT_CONFIG,
    { isRunning: true, queueDepth: 1, hasStartedSession: false },
    { kind: 'set_provider', provider: 'claude' }
  );
  assert.equal(providerWhileBusy.ok, false);
  if (!providerWhileBusy.ok) assert.equal(providerWhileBusy.error.code, 'conversation_busy');
});

test('create, update, fork, and hydrate preserve selection intent and revisions', async () => {
  await withService(async (service, store) => {
    const created = await service.create({
      conversationId: CONVERSATION_ID,
      config: DEFAULT_CONFIG,
    });
    assert.equal(created.revision, 0);
    assert.equal(created.resolution.status, 'resolved');

    const updated = await service.update(
      created,
      { isRunning: false, queueDepth: 0, hasStartedSession: false },
      {
        conversationId: CONVERSATION_ID,
        commandId: 'command-1',
        expectedRevision: 0,
        patch: {
          kind: 'set_model',
          model: { mode: 'explicit', modelId: 'gpt-5.6-terra' },
        },
      }
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value.next.revision, 1);
    assert.deepEqual(updated.value.next.config.reasoning, { mode: 'default' });
    assert.deepEqual((await store.getByConversationId(CONVERSATION_ID))?.lastResolvedConfig, {
      provider: 'codex',
      modelId: 'gpt-5.6-terra',
      reasoningEffort: 'xhigh',
    });

    const fork = await service.fork({
      conversationId: FORK_ID,
      source: updated.value.next,
    });
    assert.equal(fork.revision, 0);
    assert.deepEqual(fork.config, updated.value.next.config);

    const hydrated = await service.hydrate({
      conversationId: CONVERSATION_ID,
      sessionBindings: [{ provider: 'codex', sessionId: 'native-session' }],
      legacy: { provider: 'codex', reportedModel: 'gpt-5.4-high' },
    });
    assert.equal(hydrated.migrated, false);
    assert.deepEqual(hydrated.state.config, updated.value.next.config);
    assert.equal(
      (await store.findBySession('codex', 'native-session'))?.conversationId,
      CONVERSATION_ID
    );

    const recoveredByNativeSession = await service.hydrate({
      conversationId: 'native-session',
      sessionBindings: [{ provider: 'codex', sessionId: 'native-session' }],
      legacy: { provider: 'codex', reportedModel: 'gpt-5.6-sol' },
    });
    assert.equal(recoveredByNativeSession.record.conversationId, CONVERSATION_ID);
    assert.deepEqual(recoveredByNativeSession.state.config, updated.value.next.config);

    assert.equal(await service.delete(CONVERSATION_ID), true);
    assert.equal((await store.getByConversationId(CONVERSATION_ID))?.status, 'deleted');
    assert.equal(await service.purge(CONVERSATION_ID), true);
    assert.equal(await store.getByConversationId(CONVERSATION_ID), undefined);
  });
});

test('Fable session hydration recovers reported model names and preserves saved selections', async () => {
  await withService(async (service, store) => {
    const legacy = {
      provider: 'claude' as const,
      reportedModel: 'claude-fable-5-1',
      source: 'external_session' as const,
    };
    const imported = await service.hydrate({
      conversationId: CONVERSATION_ID,
      sessionBindings: [{ provider: 'claude', sessionId: 'imported-fable-session' }],
      legacy,
    });
    assert.equal(imported.migrated, true);
    assert.deepEqual(imported.diagnostics, []);
    assert.deepEqual((await store.getByConversationId(CONVERSATION_ID))?.config, {
      provider: 'claude',
      model: { mode: 'explicit', modelId: 'fable' },
      reasoning: { mode: 'disabled' },
    });
    assert.equal(imported.record.lastResolvedConfig?.modelId, 'fable');

    const savedConfig: ConversationConfig = {
      provider: 'claude',
      model: { mode: 'explicit', modelId: 'opus' },
      reasoning: { mode: 'explicit', effort: 'high' },
    };
    await service.create({ conversationId: FORK_ID, config: savedConfig });
    const existing = await service.hydrate({
      conversationId: FORK_ID,
      sessionBindings: [{ provider: 'claude', sessionId: 'saved-claude-session' }],
      legacy,
    });
    assert.equal(existing.migrated, false);
    assert.deepEqual(existing.state.config, savedConfig);
    assert.deepEqual((await store.getByConversationId(FORK_ID))?.config, savedConfig);
  });
});

test('matching create replay recovers crash metadata without duplicating the record', async () => {
  await withService(async (service, store) => {
    const input = {
      conversationId: CONVERSATION_ID,
      config: DEFAULT_CONFIG,
      workingDirectory: '/tmp/project',
      creation: {
        commandId: 'create-command',
        fingerprint: 'request-fingerprint',
        initialMessage: 'Start here',
      },
    };
    const concurrent = await Promise.all([
      service.createOrReplay(input),
      service.createOrReplay(input),
    ]);
    assert.deepEqual(concurrent.map((result) => result.replayed).sort(), [false, true]);

    const replayed = await service.createOrReplay(input);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.record.workingDirectory, '/tmp/project');
    assert.equal(replayed.record.creation?.initialMessage, 'Start here');
    assert.equal((await store.list()).length, 1);

    await assert.rejects(
      service.createOrReplay({
        ...input,
        creation: { ...input.creation, fingerprint: 'different-request' },
      }),
      ConfigRevisionConflictError
    );
  });
});

test('current session rotation is authoritative and tombstones block hydration', async () => {
  await withService(async (service, store) => {
    await service.create({
      conversationId: CONVERSATION_ID,
      config: DEFAULT_CONFIG,
      currentSession: { provider: 'codex', sessionId: 'session-1' },
    });
    await service.setCurrentSession(CONVERSATION_ID, {
      provider: 'codex',
      sessionId: 'session-2',
    });
    const rotated = await service.getRecord(CONVERSATION_ID);
    assert.equal(rotated?.currentSession?.sessionId, 'session-2');
    assert.equal(rotated?.sessionBindings[0]?.sessionId, 'session-1');

    await service.delete(CONVERSATION_ID);
    await assert.rejects(
      service.hydrate({
        conversationId: 'session-2',
        sessionBindings: [{ provider: 'codex', sessionId: 'session-2' }],
        legacy: { provider: 'codex', reportedModel: 'gpt-5.6-sol' },
      }),
      ConversationTombstonedError
    );
    assert.equal((await store.findBySession('codex', 'session-2'))?.status, 'deleted');
  });
});

test('updates reject stale revisions and unavailable combinations without persisting', async () => {
  await withService(async (service, store) => {
    const created = await service.create({
      conversationId: CONVERSATION_ID,
      config: DEFAULT_CONFIG,
    });
    const stale = await service.update(
      created,
      { isRunning: false, queueDepth: 0, hasStartedSession: false },
      {
        conversationId: CONVERSATION_ID,
        commandId: 'stale',
        expectedRevision: 10,
        patch: { kind: 'set_reasoning', reasoning: { mode: 'disabled' } },
      }
    );
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.error.code, 'revision_conflict');

    const unavailable = await service.update(
      created,
      { isRunning: false, queueDepth: 0, hasStartedSession: false },
      {
        conversationId: CONVERSATION_ID,
        commandId: 'bad',
        expectedRevision: 0,
        patch: {
          kind: 'set_model',
          model: { mode: 'explicit', modelId: 'retired-model' },
        },
      }
    );
    assert.equal(unavailable.ok, false);
    assert.equal((await store.getByConversationId(CONVERSATION_ID))?.configRevision, 0);
  });
});

test('create and fork require a currently resolved configuration', async () => {
  await withService(async (service) => {
    await assert.rejects(
      service.create({
        conversationId: CONVERSATION_ID,
        config: {
          ...DEFAULT_CONFIG,
          model: { mode: 'explicit', modelId: 'retired-model' },
        },
      }),
      ConversationConfigResolutionError
    );
  });
});

test('legacy migration is deterministic and confines composite decoding to known models', () => {
  const composite = migrateLegacyConversationConfig({
    provider: 'codex',
    reportedModel: 'gpt-5.4-high',
    source: 'external_session',
  });
  assert.deepEqual(composite.config, {
    provider: 'codex',
    model: { mode: 'explicit', modelId: 'gpt-5.4' },
    reasoning: { mode: 'explicit', effort: 'high' },
  });
  assert.equal(composite.provenance, 'external_discovered');

  const baseOnly = migrateLegacyConversationConfig({
    provider: 'codex',
    reportedModel: 'gpt-5.4',
  });
  assert.deepEqual(baseOnly.config.reasoning, { mode: 'disabled' });

  const futureSuffix = migrateLegacyConversationConfig({
    provider: 'codex',
    reportedModel: 'gpt-example-ultra',
  });
  assert.deepEqual(futureSuffix.config.model, { mode: 'default' });
  assert.deepEqual(futureSuffix.config.reasoning, { mode: 'disabled' });
  assert.equal(futureSuffix.diagnostics[0]?.code, 'unknown_reported_model');

  const futureFable = migrateLegacyConversationConfig({
    provider: 'claude',
    reportedModel: 'claude-fable-future',
  });
  assert.deepEqual(futureFable.config.model, { mode: 'default' });
  assert.equal(futureFable.diagnostics[0]?.code, 'unknown_reported_model');
});
