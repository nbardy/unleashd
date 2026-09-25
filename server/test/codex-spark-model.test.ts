import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_MODEL_REGISTRY,
  DEFAULT_CODEX_MODEL_ID,
  defaultReasoningEffortForProvider,
  fromCodexModelId,
} from '../../shared/src/index';
import { inferProviderFromModel } from '../src/adapters/jsonl';

// Canonical Codex ids are base models; effort is a separate reasoning field.
// Legacy composites (`gpt-5.4-high`) still exist in old session files, and
// disk-adapter decodes them with fromCodexModelId.

const BASE_MODELS = CODEX_MODEL_REGISTRY.map((entry) => entry.modelName);

test('fromCodexModelId decomposes legacy composites and leaves hyphenated bases whole', () => {
  assert.deepEqual(fromCodexModelId('gpt-5.4-high'), { baseModel: 'gpt-5.4', effort: 'high' });
  assert.deepEqual(fromCodexModelId('gpt-5.3-codex-spark-medium'), {
    baseModel: 'gpt-5.3-codex-spark',
    effort: 'medium',
  });
  assert.deepEqual(fromCodexModelId('gpt-5.4'), { baseModel: 'gpt-5.4', effort: null });
  // `-spark` / `-mini` must not be mistaken for an effort suffix.
  assert.deepEqual(fromCodexModelId('gpt-5.3-codex-spark'), {
    baseModel: 'gpt-5.3-codex-spark',
    effort: null,
  });
  assert.deepEqual(fromCodexModelId('gpt-5.4-mini'), { baseModel: 'gpt-5.4-mini', effort: null });
});

test('fromCodexModelId decomposes every registered base through composite strings', () => {
  for (const base of BASE_MODELS) {
    for (const effort of ['medium', 'high', 'xhigh', 'ultra'] as const) {
      const decomposed = fromCodexModelId(`${base}-${effort}`);
      assert.equal(decomposed.baseModel, base);
      assert.equal(decomposed.effort, effort);
    }
  }
});

test('an absent Codex model takes the default model’s reasoning, not none', () => {
  assert.equal(
    defaultReasoningEffortForProvider('codex'),
    defaultReasoningEffortForProvider('codex', DEFAULT_CODEX_MODEL_ID)
  );
  assert.notEqual(defaultReasoningEffortForProvider('codex'), undefined);
  assert.equal(defaultReasoningEffortForProvider('gemini'), undefined);
});

// Oompa worker transcripts carry only a model string; provider inference from it
// decides which harness a swarm row is attributed to.
test('inferProviderFromModel maps every registered Codex base id to codex', () => {
  for (const model of BASE_MODELS) {
    assert.equal(inferProviderFromModel(model), 'codex', `${model} should infer codex`);
  }
});
