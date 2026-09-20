import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeSoulDraft, resolveSoulMerge } from '../src/components/buddies/soul-merge';

test('three-way soul merges preserve independent edits, deletions, identical edits and Markdown', () => {
  const cases = [
    {
      original: '# Identity\nName: Lead\n\n# Style\nBe brief.\n',
      mine: '# Identity\nName: Animal Fights Lead\n\n# Style\nBe brief.\n',
      saved: '# Identity\nName: Lead\n\n# Style\nExplain tradeoffs.\n',
      expected: '# Identity\nName: Animal Fights Lead\n\n# Style\nExplain tradeoffs.\n',
    },
    {
      original: 'Name\nobsolete\n\nStyle\nbrief',
      mine: 'Name\n\nStyle\nbrief',
      saved: 'Name\nobsolete\n\nStyle\ndetailed',
      expected: 'Name\n\nStyle\ndetailed',
    },
    { original: 'a\nb\nc', mine: 'a\nB\nc', saved: 'a\nB\nc', expected: 'a\nB\nc' },
    { original: '', mine: 'new', saved: '', expected: 'new' },
    { original: 'old', mine: '', saved: 'old', expected: '' },
    { original: 'a\nb\nc', mine: 'b\nc', saved: 'a\nb', expected: 'b' },
    {
      original: '# Name\r\n  - nested  \r\n\r\nEnd\r\n',
      mine: '# New name\r\n  - nested  \r\n\r\nEnd\r\n',
      saved: '# Name\r\n  - nested  \r\n\r\nFinish\r\n',
      expected: '# New name\r\n  - nested  \r\n\r\nFinish\r\n',
    },
  ];
  for (const { original, mine, saved, expected } of cases) {
    assert.equal(resolveSoulMerge(mergeSoulDraft(original, mine, saved), {}), expected);
    assert.equal(resolveSoulMerge(mergeSoulDraft(original, saved, mine), {}), expected);
  }
});

test('overlaps stay unresolved until chosen; choosing one region preserves unrelated saved changes', () => {
  const original = '# Name\nLead\n\n# Style\nBrief\n\n# Work\nPlan';
  const mine = original.replace('Brief', 'Detailed');
  const saved = original.replace('Brief', 'Concise').replace('Plan', 'Deliver');
  const blocks = mergeSoulDraft(original, mine, saved);
  const index = blocks.findIndex((block) => block.kind === 'conflict');
  const conflict = blocks[index];
  assert.equal(conflict.kind, 'conflict');
  if (conflict.kind !== 'conflict') throw new Error('Expected overlap');
  assert.deepEqual(conflict.original, ['Brief']);
  assert.equal(resolveSoulMerge(blocks, {}), null);
  assert.equal(
    resolveSoulMerge(blocks, { [index]: conflict.mine }),
    mine.replace('Plan', 'Deliver')
  );
  assert.equal(resolveSoulMerge(blocks, { [index]: conflict.saved }), saved);
  assert.equal(resolveSoulMerge(blocks, { [index]: [] }), saved.replace('Concise\n', ''));
  assert.equal(
    resolveSoulMerge(blocks, { [index]: ['Concise by default; detail when asked.'] }),
    saved.replace('Concise', 'Concise by default; detail when asked.')
  );
});

test('delete versus edit and different inserts at the same location require resolution', () => {
  for (const [original, mine, saved] of [
    ['start\nold\nend', 'start\nend', 'start\nchanged\nend'],
    ['start\nend', 'start\nmine\nend', 'start\nsaved\nend'],
    ['', 'mine', 'saved'],
  ]) {
    assert.equal(resolveSoulMerge(mergeSoulDraft(original, mine, saved), {}), null);
  }
});
