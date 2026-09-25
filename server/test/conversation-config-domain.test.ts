import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ConversationConfig,
  ProviderCatalogSchema,
  resolveConversationConfig,
  transitionConversationConfig,
} from '../../shared/src/index';

const catalog = ProviderCatalogSchema.parse({
  revision: 'catalog-1',
  providers: [
    {
      id: 'claude',
      displayName: 'Claude',
      shortName: 'C',
      defaultModelId: 'opus',
      models: [
        {
          id: 'opus',
          displayName: 'Opus',
          reasoning: { levels: ['low', 'high'], defaultEffort: 'high' },
        },
      ],
    },
    {
      id: 'codex',
      displayName: 'Codex',
      shortName: 'X',
      defaultModelId: 'gpt-5.6-sol',
      models: [
        {
          id: 'gpt-5.6-sol',
          displayName: 'GPT-5.6 Sol',
          reasoning: {
            levels: ['low', 'xhigh', 'ultra'],
            defaultEffort: 'ultra',
          },
        },
        {
          id: 'gpt-5.6-terra',
          displayName: 'GPT-5.6 Terra',
          reasoning: {
            levels: ['low', 'xhigh'],
            defaultEffort: 'xhigh',
          },
        },
      ],
    },
  ],
});

function config(overrides: Partial<ConversationConfig> = {}): ConversationConfig {
  return {
    provider: 'codex',
    model: { mode: 'default' },
    reasoning: { mode: 'default' },
    ...overrides,
  };
}

test('provider catalog enforces relational invariants', () => {
  for (const invalid of [
    {
      revision: 'x',
      providers: [
        {
          id: 'codex',
          displayName: 'Codex',
          shortName: 'X',
          defaultModelId: 'missing',
          models: [],
        },
      ],
    },
    {
      revision: 'x',
      providers: [
        {
          id: 'codex',
          displayName: 'Codex',
          shortName: 'X',
          defaultModelId: 'sol',
          models: [
            { id: 'sol', displayName: 'Sol' },
            { id: 'sol', displayName: 'Duplicate' },
          ],
        },
      ],
    },
    {
      revision: 'x',
      providers: [
        {
          id: 'codex',
          displayName: 'Codex',
          shortName: 'X',
          defaultModelId: 'sol',
          models: [
            {
              id: 'sol',
              displayName: 'Sol',
              reasoning: { levels: ['low'], defaultEffort: 'ultra' },
            },
          ],
        },
      ],
    },
  ]) {
    assert.equal(ProviderCatalogSchema.safeParse(invalid).success, false);
  }
});

test('default model and reasoning resolve together at the execution boundary', () => {
  assert.deepEqual(resolveConversationConfig(config(), catalog), {
    status: 'resolved',
    catalogRevision: 'catalog-1',
    value: {
      provider: 'codex',
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
    },
  });

  assert.deepEqual(
    resolveConversationConfig(
      config({ model: { mode: 'explicit', modelId: 'gpt-5.6-terra' } }),
      catalog
    ),
    {
      status: 'resolved',
      catalogRevision: 'catalog-1',
      value: {
        provider: 'codex',
        modelId: 'gpt-5.6-terra',
        reasoningEffort: 'xhigh',
      },
    }
  );
});

test('disabled reasoning omits the CLI flag and explicit values pass through unchanged', () => {
  const disabled = resolveConversationConfig(config({ reasoning: { mode: 'disabled' } }), catalog);
  assert.equal(disabled.status, 'resolved');
  if (disabled.status === 'resolved') {
    assert.equal('reasoningEffort' in disabled.value, false);
  }

  const explicit = resolveConversationConfig(
    config({ reasoning: { mode: 'explicit', effort: 'xhigh' } }),
    catalog
  );
  assert.equal(explicit.status, 'resolved');
  if (explicit.status === 'resolved') {
    assert.equal(explicit.value.reasoningEffort, 'xhigh');
  }
});

test('unavailable explicit selections are retained and return structured errors', () => {
  const previous = {
    provider: 'codex' as const,
    modelId: 'retired-model',
    reasoningEffort: 'high',
  };
  const resolution = resolveConversationConfig(
    config({ model: { mode: 'explicit', modelId: 'retired-model' } }),
    catalog,
    previous
  );
  assert.equal(resolution.status, 'unavailable');
  if (resolution.status === 'unavailable') {
    assert.equal(resolution.error.code, 'model_unavailable');
    assert.deepEqual(resolution.lastResolved, previous);
  }
});

test('invalid explicit reasoning for a new model rejects the whole transition', () => {
  const current = config({ reasoning: { mode: 'explicit', effort: 'ultra' } });
  const result = transitionConversationConfig(
    current,
    { kind: 'set_model', model: { mode: 'explicit', modelId: 'gpt-5.6-terra' } },
    catalog
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'reasoning_unavailable');
  assert.deepEqual(current.model, { mode: 'default' });
});
