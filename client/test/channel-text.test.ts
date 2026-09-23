import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ChannelReference,
  activeReferenceQuery,
  encodeReferences,
  rankReferences,
} from '../src/components/buddies/channel-text';

const lead: ChannelReference = { kind: 'buddy', id: 'b1', label: 'Lead', detail: '' };
const leadDesigner: ChannelReference = {
  kind: 'buddy',
  id: 'b2',
  label: 'Lead Designer',
  detail: '',
};
const task: ChannelReference = {
  kind: 'task',
  id: 't1',
  label: 'Fix login (v2)',
  detail: '',
  status: 'in_progress',
};

// A mention token is what starts a Buddy's turn server-side, so a wrong
// encoding either wakes the wrong Buddy or silently wakes nobody.
test('encoding prefers the longest picked label and needs a word boundary', () => {
  assert.equal(
    encodeReferences('@Lead Designer and @Lead, see @Fix login (v2).', [lead, leadDesigner, task]),
    '[@Lead Designer](buddy:b2) and [@Lead](buddy:b1), see [Fix login (v2)](task:t1).'
  );
  // "@Leadership" is not a pick of "Lead"; an unpicked "@Dev" stays text.
  assert.equal(encodeReferences('@Leadership @Dev', [lead]), '@Leadership @Dev');
});

test('the @ trigger needs a word start and stops at newlines', () => {
  assert.deepEqual(activeReferenceQuery('ask @fix lo', 11), { start: 4, query: 'fix lo' });
  assert.equal(activeReferenceQuery('mail me@example.com', 19), null);
  assert.equal(activeReferenceQuery('@lead\nnext', 10), null);
});

test('fuzzy ranking favours word-start matches', () => {
  const references: ChannelReference[] = [
    { kind: 'task', id: 'x', label: 'Upload deadline', detail: '', status: 'ready' },
    { kind: 'buddy', id: 'y', label: 'Product Development Lead', detail: '' },
  ];
  assert.deepEqual(
    rankReferences('pdl', references).map((reference) => reference.id),
    ['y', 'x']
  );
  assert.deepEqual(rankReferences('zzz', references), []);
});
