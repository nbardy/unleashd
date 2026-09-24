import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommand } from '@nbardy/agent-cli';
import {
  CODEX_MODEL_REGISTRY,
  CodexModelSchema,
  CreateConversationCommandSchema,
  DEFAULT_CODEX_MODEL_ID,
  ModelIdSchema,
  NO_CODEX_THINKING,
  SetConversationConfigCommandSchema,
  defaultReasoningEffortForProvider,
  fromCodexModelId,
  isModelIdValidForProvider,
  modelValidationHint,
  toCodexModelId,
} from '../../shared/src/index';
import { inferProviderFromModel } from '../src/adapters/jsonl';
import codexProvider from '../src/providers/codex';

// =============================================================================
// Canonical schema: base IDs only. Effort is a separate reasoningEffort field.
// =============================================================================

test('CODEX_MODEL_REGISTRY includes the expected base entries with shared thinking options', () => {
  const names = CODEX_MODEL_REGISTRY.map((entry) => entry.modelName).sort();
  assert.deepEqual(names, [
    'gpt-5.3-codex-spark',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.5',
    'gpt-5.6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-6-astra',
    'gpt-6-luna',
    'gpt-6-sol',
  ]);
  for (const entry of CODEX_MODEL_REGISTRY) {
    assert.deepEqual(entry.thinkingOptions, [
      NO_CODEX_THINKING,
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]);
  }
});

test('CodexModelSchema accepts only the configured base IDs (no composites)', () => {
  assert.equal(CodexModelSchema.safeParse('gpt-5.6-sol').success, true);
  assert.equal(CodexModelSchema.safeParse('gpt-5.6-terra').success, true);
  assert.equal(CodexModelSchema.safeParse('gpt-5.6-luna').success, true);
  assert.equal(CodexModelSchema.safeParse('gpt-5.5').success, true);
  assert.equal(CodexModelSchema.safeParse('gpt-5.4').success, true);
  assert.equal(CodexModelSchema.safeParse('gpt-5.4-mini').success, true);
  assert.equal(CodexModelSchema.safeParse('gpt-5.3-codex-spark').success, true);
  assert.equal(CodexModelSchema.safeParse('gpt-5.5-high').success, false);
  assert.equal(CodexModelSchema.safeParse('gpt-5.4-high').success, false);
  assert.equal(CodexModelSchema.safeParse('gpt-5.3-codex-spark-xhigh').success, false);
});

test('ModelIdSchema is an opaque wire string; provider catalogs enforce compatibility', () => {
  for (const id of [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex-spark',
  ]) {
    assert.equal(ModelIdSchema.safeParse(id).success, true, `${id} should be valid`);
  }
  for (const id of ['gpt-5.5-high', 'gpt-5.4-high', 'future-provider/model']) {
    assert.equal(ModelIdSchema.safeParse(id).success, true, `${id} should be structurally valid`);
  }
  assert.equal(ModelIdSchema.safeParse('').success, false);
});

test('CreateConversationCommand carries canonical model and reasoning selections', () => {
  for (const model of [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex-spark',
  ]) {
    for (const reasoningEffort of ['medium', 'high', 'xhigh'] as const) {
      const result = CreateConversationCommandSchema.safeParse({
        type: 'create_conversation',
        commandId: `create-${model}-${reasoningEffort}`,
        conversationId: '550e8400-e29b-41d4-a716-446655440000',
        workingDirectory: '/tmp',
        config: {
          provider: 'codex',
          model: { mode: 'explicit', modelId: model },
          reasoning: { mode: 'explicit', effort: reasoningEffort },
        },
      });
      assert.equal(result.success, true, `${model}+${reasoningEffort} should be accepted`);
    }
  }
});

test('SetConversationConfigCommand structurally accepts opaque non-empty model IDs', () => {
  for (const model of [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex-spark',
  ]) {
    const result = SetConversationConfigCommandSchema.safeParse({
      type: 'set_conversation_config',
      commandId: `set-${model}`,
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      expectedRevision: 0,
      patch: { kind: 'set_model', model: { mode: 'explicit', modelId: model } },
    });
    assert.equal(result.success, true, `${model} should be accepted`);
  }
});

// =============================================================================
// Server-side provider/model validation
// =============================================================================

test('isModelIdValidForProvider accepts base IDs for codex, rejects composites', () => {
  for (const id of [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex-spark',
  ]) {
    assert.equal(isModelIdValidForProvider('codex', id), true, `codex should accept ${id}`);
  }
  assert.equal(isModelIdValidForProvider('codex', 'gpt-5.5-high'), false);
  assert.equal(isModelIdValidForProvider('codex', 'gpt-5.4-high'), false);
});

test('isModelIdValidForProvider rejects codex IDs for other providers', () => {
  assert.equal(isModelIdValidForProvider('claude', 'gpt-5.3-codex-spark'), false);
  assert.equal(isModelIdValidForProvider('opencode', 'gpt-5.4'), false);
});

test('modelValidationHint for codex mentions sol, gpt-5.4, and spark', () => {
  const hint = modelValidationHint('codex');
  assert.ok(hint.includes('gpt-5.6-sol'), `Hint should mention gpt-5.6-sol: ${hint}`);
  assert.ok(hint.includes('gpt-5.5'), `Hint should mention gpt-5.5: ${hint}`);
  assert.ok(hint.includes('gpt-5.4'), `Hint should mention gpt-5.4: ${hint}`);
  assert.ok(hint.includes('spark'), `Hint should mention spark: ${hint}`);
});

// =============================================================================
// Canonical command build: agent-cli owns composition.
// Caller passes {model: base, reasoning: effort}; agent-cli emits
//   -m <base> -c model_reasoning_effort=<effort>
// =============================================================================

test('buildCommand: base model + reasoning composes correctly', () => {
  const spec = buildCommand('codex', {
    model: 'gpt-5.6-sol',
    reasoning: 'ultra',
    prompt: 'hello',
  });
  const mIdx = spec.argv.indexOf('-m');
  assert.equal(spec.argv[mIdx + 1], 'gpt-5.6-sol');
  assert.ok(spec.argv.includes('-c'));
  assert.ok(spec.argv.includes('model_reasoning_effort=ultra'));
});

test('buildCommand: base model without reasoning emits no effort flag', () => {
  const spec = buildCommand('codex', {
    model: 'gpt-5.4',
    prompt: 'hello',
  });
  const mIdx = spec.argv.indexOf('-m');
  assert.equal(spec.argv[mIdx + 1], 'gpt-5.4');
  assert.ok(!spec.argv.includes('-c'));
});

test('buildCommand: spark + reasoning composes correctly', () => {
  const spec = buildCommand('codex', {
    model: 'gpt-5.3-codex-spark',
    reasoning: 'xhigh',
    prompt: 'hello',
  });
  const mIdx = spec.argv.indexOf('-m');
  assert.equal(spec.argv[mIdx + 1], 'gpt-5.3-codex-spark');
  assert.ok(spec.argv.includes('model_reasoning_effort=xhigh'));
});

test('buildCommand: suffix-looking opaque model IDs pass through unchanged', () => {
  const spec = buildCommand('codex', {
    model: 'gpt-5.4-high',
    prompt: 'hello',
  });
  const mIdx = spec.argv.indexOf('-m');
  assert.equal(spec.argv[mIdx + 1], 'gpt-5.4-high');
  assert.ok(!spec.argv.some((arg) => arg.startsWith('model_reasoning_effort=')));
});

// =============================================================================
// listModels returns base IDs only (effort is a separate UI control)
// =============================================================================

test('listModels returns exactly the configured base IDs', () => {
  const models = codexProvider.listModels();
  const ids = models.map((m) => m.id).sort();
  assert.deepEqual(ids, [
    'gpt-5.3-codex-spark',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.5',
    'gpt-5.6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-6-astra',
    'gpt-6-luna',
    'gpt-6-sol',
  ]);
});

test('listModels has exactly one default and it matches DEFAULT_CODEX_MODEL_ID', () => {
  const models = codexProvider.listModels();
  const defaults = models.filter((m) => m.isDefault);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, DEFAULT_CODEX_MODEL_ID);
  assert.equal(DEFAULT_CODEX_MODEL_ID, 'gpt-5.6-sol');
});

test('reasoning defaults follow the selected provider and Codex model', () => {
  assert.equal(defaultReasoningEffortForProvider('claude', 'opus'), 'high');
  assert.equal(defaultReasoningEffortForProvider('codex', 'gpt-5.6-sol'), 'ultra');
  assert.equal(defaultReasoningEffortForProvider('codex', 'gpt-5.6-terra'), 'xhigh');
  assert.equal(defaultReasoningEffortForProvider('codex', 'gpt-5.6-luna'), 'xhigh');
  assert.equal(defaultReasoningEffortForProvider('codex'), 'ultra');
  assert.equal(defaultReasoningEffortForProvider('gemini'), undefined);
});

test('create command distinguishes provider default from explicit no-effort', () => {
  const base = {
    type: 'create_conversation' as const,
    commandId: 'create-default-test',
    conversationId: '550e8400-e29b-41d4-a716-446655440000',
    workingDirectory: '/tmp',
  };
  const defaultResult = CreateConversationCommandSchema.safeParse({
    ...base,
    config: {
      provider: 'codex',
      model: { mode: 'explicit', modelId: 'gpt-5.6-sol' },
      reasoning: { mode: 'default' },
    },
  });
  const noEffortResult = CreateConversationCommandSchema.safeParse({
    ...base,
    commandId: 'create-disabled-test',
    config: {
      provider: 'codex',
      model: { mode: 'explicit', modelId: 'gpt-5.6-sol' },
      reasoning: { mode: 'disabled' },
    },
  });

  assert.equal(defaultResult.success, true);
  assert.equal(noEffortResult.success, true);
  if (defaultResult.success) assert.equal(defaultResult.data.config.reasoning.mode, 'default');
  if (noEffortResult.success) assert.equal(noEffortResult.data.config.reasoning.mode, 'disabled');
});

// =============================================================================
// Migration helpers: fromCodexModelId / toCodexModelId round-trip
// =============================================================================

test('fromCodexModelId decomposes legacy composites', () => {
  assert.deepEqual(fromCodexModelId('gpt-5.4-high'), { baseModel: 'gpt-5.4', effort: 'high' });
  assert.deepEqual(fromCodexModelId('gpt-5.4-xhigh'), { baseModel: 'gpt-5.4', effort: 'xhigh' });
  assert.deepEqual(fromCodexModelId('gpt-5.3-codex-spark-medium'), {
    baseModel: 'gpt-5.3-codex-spark',
    effort: 'medium',
  });
});

test('fromCodexModelId returns base as-is when no effort suffix present', () => {
  assert.deepEqual(fromCodexModelId('gpt-5.4'), { baseModel: 'gpt-5.4', effort: null });
  assert.deepEqual(fromCodexModelId('gpt-5.3-codex-spark'), {
    baseModel: 'gpt-5.3-codex-spark',
    effort: null,
  });
});

test('to/fromCodexModelId round-trips through composite strings', () => {
  for (const base of [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex-spark',
  ]) {
    for (const effort of ['medium', 'high', 'xhigh', 'ultra'] as const) {
      const composite = toCodexModelId(base, effort);
      const decomposed = fromCodexModelId(composite);
      assert.equal(decomposed.baseModel, base);
      assert.equal(decomposed.effort, effort);
    }
  }
});

// =============================================================================
// Resume wiring + required codex safety flags (unchanged by refactor)
// =============================================================================

test('buildCommand: resume uses exec resume <sessionId>', () => {
  const spec = buildCommand('codex', {
    model: 'gpt-5.3-codex-spark',
    reasoning: 'high',
    prompt: 'continue',
    sessionId: 'thread-123',
    resume: true,
  });
  assert.equal(spec.argv[0], 'codex');
  assert.equal(spec.argv[1], 'exec');
  assert.equal(spec.argv[2], 'resume');
  assert.equal(spec.argv[3], 'thread-123');
});

test('buildCommand: codex includes --skip-git-repo-check', () => {
  const spec = buildCommand('codex', {
    model: 'gpt-5.4',
    prompt: 'hello',
  });
  assert.ok(spec.argv.includes('--skip-git-repo-check'));
});

// =============================================================================
// Oompa: inferProviderFromModel identifies base codex IDs as codex
// =============================================================================

test('inferProviderFromModel maps base codex IDs to codex', () => {
  for (const model of [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex-spark',
  ]) {
    assert.equal(inferProviderFromModel(model), 'codex', `${model} should infer codex`);
  }
});
