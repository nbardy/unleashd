import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuddyDirectory } from '../src/components/buddies/BuddyDirectory';
import { buddyFixture, rosterFixture } from './fixtures/buddy-roster';

// T11 dropped the cards' open/blocked counts; the owner asked for them back (T22 feature 8).
test('directory cards show each Buddy its own open and blocked counts, zero when it has none', () => {
  const overview = [
    rosterFixture(
      [buddyFixture({ id: 'ada', name: 'Ada' }), buddyFixture({ id: 'bo', name: 'Bo' })],
      {
        taskCounts: [{ buddyId: 'ada', open: 2, blocked: 1 }],
      }
    ),
  ];
  const html = renderToStaticMarkup(
    <BuddyDirectory overview={overview} onOpen={() => {}} onNew={() => {}} creating={false} />
  );
  const [, , ada, bo] = html.split('buddy-card-title">'); // [head, the New card, Ada, Bo]
  assert.match(ada, /^Ada/);
  assert.match(ada, /2 open<\/span><span>1 blocked/);
  assert.match(bo, /^Bo/);
  assert.match(bo, /0 open<\/span><span>0 blocked/);
});
