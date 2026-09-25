import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CreateConversationCommandSchema,
  DEFAULT_CODEX_MODEL_ID,
  ModelIdSchema,
  SetConversationConfigCommandSchema,
  isModelIdValidForProvider,
  normalizeModelId,
} from '../../shared/src/index';
import { sessionToConversation } from '../src/adapters/disk-adapter';
import { providers } from '../src/providers';

const conversationId = '550e8400-e29b-41d4-a716-446655440000';

// Hard rule: provider-bespoke model ids pass through the wire as opaque strings.
// A shared enum here would reject every model a provider adds before we ship.
test('wire commands carry opaque, provider-bespoke model ids and reject only empty ones', () => {
  assert.equal(ModelIdSchema.safeParse('gpt-6-astra').success, true);
  assert.equal(ModelIdSchema.safeParse('future-provider/model').success, true);
  assert.equal(ModelIdSchema.safeParse('').success, false);
  assert.equal(
    CreateConversationCommandSchema.safeParse({
      type: 'create_conversation',
      commandId: 'create-opencode',
      conversationId,
      workingDirectory: '/tmp',
      config: {
        provider: 'opencode',
        model: { mode: 'explicit', modelId: 'opencode/big-pickle' },
        reasoning: { mode: 'default' },
      },
      kind: { t: 'chat' },
    }).success,
    true
  );
  assert.equal(
    SetConversationConfigCommandSchema.safeParse({
      type: 'set_conversation_config',
      commandId: 'set-opencode-model',
      conversationId,
      expectedRevision: 0,
      patch: {
        kind: 'set_model',
        model: { mode: 'explicit', modelId: 'opencode/big-pickle' },
      },
    }).success,
    true
  );
});

test('server provider/model validation rejects cross-provider, retired and composite ids', () => {
  assert.equal(isModelIdValidForProvider('claude', 'opus'), false); // retired 2026-09-23
  assert.equal(isModelIdValidForProvider('claude', 'opencode/gpt-5'), false);
  assert.equal(isModelIdValidForProvider('claude', 'gpt-5.3-codex-spark'), false);
  // Effort is a separate field; legacy composites are migrated, never accepted.
  assert.equal(isModelIdValidForProvider('codex', 'gpt-5.4-medium'), false);
  assert.equal(isModelIdValidForProvider('codex', 'opencode/gpt-5'), false);
  assert.equal(isModelIdValidForProvider('opencode', 'gpt-5.4'), false);
  assert.equal(isModelIdValidForProvider('opencode', 'openai/gpt-5'), true);
  assert.equal(isModelIdValidForProvider('cursor', 'opus'), false);
  // Aliases validate through their canonical form.
  assert.equal(isModelIdValidForProvider('cursor', 'composer-2'), true);
  assert.equal(normalizeModelId('cursor', 'composer-2'), 'composer-2.5');
  assert.equal(normalizeModelId('cursor', 'grok-4.5'), 'cursor-grok-4.5-high');
  assert.equal(normalizeModelId('cursor', 'grok-4.7'), 'grok-4.7-high');
});

// listModels() reads vendor/agent-cli-tool/catalog.jsonc at runtime, while
// isModelIdValidForProvider checks the build-time generated enums. When the two
// drifted, muse-spark-1.3 showed in the picker and was rejected at config time
// (6015f54). Every listed model must be selectable, with exactly one default.
test('every provider lists only models its validator accepts, with exactly one default', () => {
  for (const [name, provider] of Object.entries(providers)) {
    const models = provider.listModels();
    for (const model of models) {
      assert.equal(
        isModelIdValidForProvider(provider.name, model.id),
        true,
        `${name} lists ${model.id}, which config validation rejects`
      );
    }
    assert.equal(models.filter((model) => model.isDefault).length, 1, `${name} default count`);
  }
  const codexDefault = providers.codex.listModels().find((model) => model.isDefault);
  assert.equal(codexDefault?.id, DEFAULT_CODEX_MODEL_ID, 'runtime and generated defaults agree');
});

test('disk hydration rejects a globally valid model from the wrong provider', () => {
  const conversation = sessionToConversation({
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    filePath: '/tmp/codex-session.jsonl',
    workingDirectory: '/tmp',
    provider: 'codex',
    model: 'opus',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    modifiedAt: new Date('2026-01-01T00:00:00Z'),
    messages: [],
  });

  assert.ok(conversation);
  assert.equal(conversation.model, undefined);
});
