import assert from 'node:assert/strict';
import test from 'node:test';
import { MuseModelSchema, isModelIdValidForProvider } from '../../shared/src/index';
import museProvider from '../src/providers/muse';
import opencodeProvider from '../src/providers/opencode';

// muse-spark-1.3 (non-contributor) exists on the Meta API alongside the
// contributor preview. The muse provider validates against a closed enum
// generated from catalog.jsonc, so a missing entry rejects the model at
// config time even though the CLI would accept it.

test('muse provider accepts muse-spark-1.3 and still defaults to the contributor build', () => {
  assert.equal(isModelIdValidForProvider('muse', 'muse-spark-1.3'), true);
  assert.equal(MuseModelSchema.safeParse('muse-spark-1.3').success, true);
  assert.equal(MuseModelSchema.safeParse('muse-spark-9.9').success, false);

  const models = museProvider.listModels();
  const entry = models.find((m) => m.id === 'muse-spark-1.3');
  assert.ok(entry, 'muse-spark-1.3 must be listed');
  assert.equal(entry.isDefault, false);

  const defaults = models.filter((m) => m.isDefault);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, 'muse-spark-1.3-contributor');
});

test('opencode dropdown lists meta/muse-spark-1.3 without moving the default', () => {
  assert.equal(isModelIdValidForProvider('opencode', 'meta/muse-spark-1.3'), true);

  const models = opencodeProvider.listModels();
  assert.ok(models.some((m) => m.id === 'meta/muse-spark-1.3'));

  const defaults = models.filter((m) => m.isDefault);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, 'opencode/big-pickle');
});
