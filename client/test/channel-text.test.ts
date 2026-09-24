import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ChannelReference,
  activeReferenceQuery,
  completesPickedReference,
  encodeReferences,
  insertReference,
  mentionedBuddies,
  rankReferences,
} from '../src/components/buddies/channel-text';

const unreported = { kind: 'unreported' } as const;
const lead: ChannelReference = {
  kind: 'buddy',
  id: 'b1',
  label: 'Lead',
  detail: '',
  execution: unreported,
};
const leadDesigner: ChannelReference = {
  kind: 'buddy',
  id: 'b2',
  label: 'Lead Designer',
  detail: '',
  execution: unreported,
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
    {
      kind: 'buddy',
      id: 'y',
      label: 'Product Development Lead',
      detail: '',
      execution: unreported,
    },
  ];
  assert.deepEqual(
    rankReferences('pdl', references).map((reference) => reference.id),
    ['y', 'x']
  );
  assert.deepEqual(rankReferences('zzz', references), []);
});

// Live workspaces carry dozens of done Tasks; without the penalty they crowd
// the eight picker slots ahead of the live work you are trying to mention.
test('finished Tasks sink below live ones with the same match', () => {
  const task = (id: string, status: string): ChannelReference => ({
    kind: 'task',
    id,
    label: 'Preserve context',
    detail: '',
    status,
  });
  assert.deepEqual(
    rankReferences('pres', [task('done', 'done'), task('live', 'in_progress')]).map(
      (reference) => reference.id
    ),
    ['live', 'done']
  );
});

// Mention chips carry model choices, and the server rejects a post whose
// mentionConfigs name a Buddy the body does not mention. So a chip must vanish
// when its @Label is deleted, and "@Lead Designer" must not grow a Lead chip —
// reading chips straight off the picked list would do both.
test('mention chips follow the text, not the picked list', () => {
  const picked = [lead, leadDesigner, task];
  assert.deepEqual(
    mentionedBuddies('@Lead Designer and @Lead, see @Fix login (v2)', picked).map((b) => b.id),
    ['b2', 'b1']
  );
  assert.deepEqual(
    mentionedBuddies('ask @Lead Designer', picked).map((b) => b.id),
    ['b2']
  );
  assert.deepEqual(mentionedBuddies('never mind', picked), []);
});

// 2026-09-24: after Enter picked a Buddy, "@Product Development Lead " was
// still a live query (queries may hold spaces), so the @ menu never closed and
// covered the mention chip's model picker.
test('a picked reference closes the @ query it completed', () => {
  const trigger = activeReferenceQuery('ask @le', 7);
  assert.ok(trigger);
  const inserted = insertReference('ask @le', trigger, leadDesigner);
  const after = activeReferenceQuery(inserted.text, inserted.caret);
  assert.ok(after);
  const all = [lead, leadDesigner, task];
  assert.equal(completesPickedReference(after.query, [leadDesigner], all), true);
  assert.equal(completesPickedReference('Lead Designer can you', [leadDesigner], all), true);
  // Still typing toward a longer name keeps the menu open.
  assert.equal(completesPickedReference('Lead Des', [lead], all), false);
});
