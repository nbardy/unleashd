import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationConfig, ProviderCatalog } from '@unleashd/shared';
import {
  type ChannelReference,
  activeReferenceQuery,
  choiceLabel,
  completesPickedReference,
  composerReferenceMarks,
  decodeChannelDraft,
  encodeChannelDraft,
  encodeReferences,
  insertReference,
  mentionChoice,
  mentionedBuddies,
  pickerValue,
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

test('a picked @name is marked in the composer exactly where send will tokenise it', () => {
  const text = '@Lead Designer and @Lead, see @Fix login (v2). @Leadership';
  const picked = [lead, leadDesigner, task];
  assert.deepEqual(composerReferenceMarks(text, picked), [
    { start: 0, end: '@Lead Designer'.length, kind: 'buddy' },
    {
      start: text.indexOf('@Lead,'),
      end: text.indexOf('@Lead,') + '@Lead'.length,
      kind: 'buddy',
    },
    {
      start: text.indexOf('@Fix login (v2)'),
      end: text.indexOf('@Fix login (v2)') + '@Fix login (v2)'.length,
      kind: 'task',
    },
  ]);
  assert.deepEqual(composerReferenceMarks('@Leadership', [lead]), []);
});

// A draft must bring its picks back with the text (2026-09-24 draft fix):
// saving the text alone would restore `@Lead` as plain words, and the post
// would then mention nobody and start no reply.
test('a restored draft still encodes its mentions', () => {
  const text = 'hey @Lead can you check this';
  const restored = decodeChannelDraft(encodeChannelDraft({ text, picked: [lead] }));
  assert.equal(
    encodeReferences(restored.text, restored.picked),
    'hey [@Lead](buddy:b1) can you check this'
  );
  // Clearing the text deletes the key rather than storing an empty object,
  // and a blob that is not a draft is discarded whole.
  assert.equal(encodeChannelDraft({ text: '', picked: [lead] }), '');
  assert.deepEqual(decodeChannelDraft('{"text":7}'), { text: '', picked: [] });
});

const PROFILE: ConversationConfig = {
  provider: 'codex',
  model: { mode: 'explicit', modelId: 'gpt-5.6-sol' },
  reasoning: { mode: 'default' },
};
const SEAT: ConversationConfig = {
  provider: 'claude',
  model: { mode: 'explicit', modelId: 'opus' },
  reasoning: { mode: 'explicit', effort: 'high' },
};
const catalog = {
  revision: 'test',
  providers: [
    {
      id: 'claude',
      displayName: 'Claude',
      defaultModelId: 'opus',
      models: [{ id: 'opus', displayName: 'Claude Opus' }],
      supportsRequiredMcp: true,
    },
    {
      id: 'codex',
      displayName: 'Codex',
      defaultModelId: 'gpt-5.6-sol',
      models: [{ id: 'gpt-5.6-sol', displayName: 'GPT Sol' }],
      supportsRequiredMcp: true,
    },
  ],
} as ProviderCatalog;

// An un-picked mention in a thread must show the Buddy's latest seat, not
// the profile default. The profile is only the baseline when there is no seat.
test('a mention chip labels the thread seat, and the profile only when there is none', () => {
  const buddy: ChannelReference = {
    kind: 'buddy',
    id: 'b1',
    label: 'Lead',
    detail: '',
    execution: { kind: 'profile', config: PROFILE },
  };
  if (buddy.kind !== 'buddy') return;
  const none = mentionChoice(buddy, new Map(), []);
  assert.equal(none.kind, 'profile');
  assert.equal(choiceLabel(none, catalog), 'GPT Sol');
  assert.deepEqual(pickerValue(none), PROFILE);

  const seated = mentionChoice(buddy, new Map(), [{ buddyId: 'b1', config: SEAT }]);
  assert.equal(seated.kind, 'seat');
  assert.equal(choiceLabel(seated, catalog), 'Claude Opus');
  assert.deepEqual(pickerValue(seated), SEAT);

  const chosen = mentionChoice(
    buddy,
    new Map([['b1', PROFILE]]),
    [{ buddyId: 'b1', config: SEAT }]
  );
  assert.equal(chosen.kind, 'chosen');
  assert.equal(choiceLabel(chosen, catalog), 'GPT Sol');
});
