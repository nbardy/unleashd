import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Doc } from '../src/components/buddies/types';

// BuddyMemory imports a stylesheet; node cannot load CSS, so it loads as an empty module.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { BuddyMemory, DocCard, DocRevisionList, addressOf, readUrl } = await import(
  '../src/components/buddies/BuddyMemory'
);

const doc = (overrides: Partial<Doc>): Doc => ({
  id: 'doc-1',
  buddyId: 'ada',
  workspaceId: 'ws-1',
  scope: { kind: 'buddy' },
  kind: 'shared',
  name: 'release-checklist',
  revision: 3,
  content: 'ship it',
  updatedAt: '2026-09-26T00:00:00Z',
  ...overrides,
});

test('a scoped doc is read and written at its own scope, never as the Buddy-scoped doc of that name', () => {
  // The route defaults a missing scope to `buddy`: an editor that dropped the scope would read
  // (and, on save, create) a different doc with the same name.
  const shared = doc({ scope: { kind: 'workspace', workspaceId: 'ws-1' } });
  const url = new URL(readUrl('ada', 'shared', addressOf(shared)), 'http://x');
  assert.equal(url.pathname, '/api/buddies/ada/docs/shared');
  assert.equal(url.searchParams.get('scope'), 'workspace');
  assert.equal(url.searchParams.get('scopeId'), 'ws-1');
  assert.equal(url.searchParams.get('name'), 'release-checklist');
  const thread = addressOf(doc({ scope: { kind: 'thread', threadId: 'post-9' } }));
  assert.deepEqual(thread, { scope: 'thread', scopeId: 'post-9', name: 'release-checklist' });
});

test('revision history lists newest first with its reason and author', () => {
  const revision = (n: number, reason: string) => ({
    docId: 'doc-1',
    revision: n,
    content: `v${n}`,
    reason,
    author: n === 2 ? 'owner' : 'buddy:ada',
    provenance: '',
    sha256: '',
    createdAt: `2026-09-2${n}T00:00:00Z`,
  });
  const html = renderToStaticMarkup(
    <DocRevisionList revisions={[revision(1, 'first draft'), revision(2, 'owner edit')]} />
  );
  assert.ok(html.indexOf('Revision 2') < html.indexOf('Revision 1'));
  assert.match(html, /owner edit/);
  assert.match(html, /buddy:ada/);
});

test('the Memory tab lists notes and shared docs with their scope, and offers a new doc', () => {
  const card = renderToStaticMarkup(
    <DocCard buddyId="ada" doc={doc({ scope: { kind: 'workspace', workspaceId: 'ws-1' } })} />
  );
  assert.match(card, /release-checklist/);
  assert.match(card, /Workspace · Revision 3/);
  const tab = renderToStaticMarkup(<BuddyMemory buddyId="ada" workspaceId="ws-1" />);
  assert.match(tab, /Notes/);
  assert.match(tab, /Shared docs/);
  assert.match(tab, /aria-label="New doc"/);
});
