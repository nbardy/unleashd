import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { setRows } from './fixtures/client-store';
import { syntheticConversations, syntheticId } from './fixtures/synthetic-conversations';

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { Provider } = await import('jotai');
const { jotaiStore } = await import('../src/atoms/store');
const { seedResource } = await import('../src/atoms/resources');
const { searchMatchesFamily, searchQueryAtom } = await import('../src/atoms/search');
const { historySearch } = await import('../src/views/search/search-model');
const { SearchView } = await import('../src/views/search/SearchView');

// One ranking and result list for the desktop palette and the mobile Search
// tab (T20). Rendered through the real atoms with the history resource seeded.

const rows = syntheticConversations(12);
const held = syntheticId(1);
const gone = 'deleted-conversation';

function hit(conversationId: string, messageIndex: number, snippet: string, minute: number) {
  return {
    conversationId,
    messageIndex,
    role: 'assistant',
    snippet,
    workingDirectory: '/Users/dev/git/project-1',
    timestamp: new Date(Date.UTC(2026, 8, 1, 0, minute)),
  };
}

test('history hits group per conversation, and a conversation this client lost is not a link', () => {
  setRows(rows);
  jotaiStore.set(searchQueryAtom, { kind: 'searching', query: 'retry' });
  seedResource(historySearch('retry', ''), [
    hit(held, 3, 'add a retry with backoff', 1),
    hit(gone, 1, 'the retry loop', 5),
    hit(held, 9, 'Retry again', 2),
  ]);
  const html = renderToStaticMarkup(
    <Provider store={jotaiStore}>
      <MemoryRouter>
        <SearchView presentation="page" />
      </MemoryRouter>
    </Provider>
  );
  // Two hits in one conversation render as one grouped result.
  assert.equal(html.match(/2 hits/g)?.length, 1);
  assert.match(html, new RegExp(`href="/chat/${held}"`));
  // Opening a conversation the client no longer holds bounces off Chat's
  // missing-conversation redirect, so it renders without an href.
  assert.doesNotMatch(html, new RegExp(`href="/chat/${gone}"`));
  assert.match(html, /the <mark class="search-view__highlight">retry<\/mark> loop/);
  // Highlight is case-insensitive and keeps the source casing.
  assert.match(html, /<mark class="search-view__highlight">Retry<\/mark> again/);
});

test('a folder-scoped search only matches conversations under that folder', () => {
  setRows(rows);
  jotaiStore.set(searchQueryAtom, { kind: 'searching', query: 'Question' });
  const folder = rows[1].cwd;
  const scoped = jotaiStore.get(searchMatchesFamily(folder));
  const expected = rows.filter((row) => row.cwd.startsWith(folder)).map((row) => row.id);
  assert.ok(scoped.length > 0);
  assert.deepEqual([...scoped].sort(), [...expected].sort());
  assert.ok(jotaiStore.get(searchMatchesFamily('')).length > scoped.length);
});
