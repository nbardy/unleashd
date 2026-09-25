import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BuddyDirectory } from '../src/components/buddies/BuddyDirectory';
import type { Buddy } from '../src/components/buddies/types';
import { directoryEntries, filterDirectoryEntries } from '../src/components/buddies/ui-contract';
import { buddyFixture, rosterFixture } from './fixtures/buddy-roster';

const lead = buddyFixture({
  id: 'buddy-product',
  name: 'Product Lead',
  role: 'Owns roadmap and release planning',
});

function renderDirectory(reports: Buddy[]) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <BuddyDirectory
        overview={[rosterFixture([lead, ...reports])]}
        onOpen={() => {}}
        onNew={() => {}}
        creating={false}
      />
    </MemoryRouter>
  );
}

test('Buddy directory search matches role, workspace, and report metadata', () => {
  const design = buddyFixture({ id: 'buddy-design', name: 'Design Buddy', managerId: lead.id });
  const entries = directoryEntries([rosterFixture([lead, design])]);
  const names = (query: string) =>
    filterDirectoryEntries(entries, query).map((entry) => entry.buddy.name);
  assert.deepEqual(names('release planning'), ['Product Lead']);
  assert.deepEqual(names('unleashd'), ['Design Buddy', 'Product Lead']);
  assert.deepEqual(names('design buddy'), ['Design Buddy', 'Product Lead']);
  assert.deepEqual(names('missing'), []);
});

// The overview includes archived Buddies (they still author old posts), so the
// directory must filter them out of both the cards and the report counts.
test('Buddy directory omits archived Buddies and does not count them as reports', () => {
  const html = renderDirectory([
    buddyFixture({ id: 'buddy-a', name: 'Active Buddy', managerId: lead.id }),
    buddyFixture({ id: 'buddy-b', name: 'Former Buddy', managerId: lead.id, status: 'archived' }),
  ]);
  assert.match(html, /Product Lead/);
  assert.match(html, /Active Buddy/);
  assert.doesNotMatch(html, /Former Buddy/);
  assert.match(html, />1 report</);
});
