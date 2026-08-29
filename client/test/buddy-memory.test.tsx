import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuddyMemoryPanel } from '../src/components/buddies/BuddyMemoryPanel';
import { formatMemoryWriteError, normalizeBuddyMemory } from '../src/components/buddies/memory';
import type { Buddy, BuddyMemory } from '../src/components/buddies/types';

const BUDDY: Buddy = {
  id: 'buddy-1',
  name: 'Product Buddy',
  role: 'Product development',
  status: 'active',
  soul_path: '/profiles/product-buddy/BUDDY_SOUL.md',
  memory_path: '/profiles/product-buddy/memory',
  provider: 'codex',
  reasoning_effort: null,
};

const V2_MEMORY: BuddyMemory = {
  soul: 'Be precise.',
  soulPath: BUDDY.soul_path,
  summary: 'Long-term operating knowledge.',
  recentJournal: [],
  working: 'Investigate the current release boundary.',
  longTerm: 'Project state is authoritative for task status.',
  workingRevision: 7,
  longTermRevision: 4,
  generation: 12,
  operations: { updateMemory: true, rememberNote: true, recall: true },
  notes: [
    {
      id: 'note-1',
      path: '/workspace/agent_notes/note.md',
      topic: 'release-boundary',
      kind: 'decision',
      buddy_id: BUDDY.id,
      workspace_id: 'workspace-1',
      evidence: [],
      content: 'Keep runtime memory out of packages.',
      written_at: '2026-08-29T00:00:00.000Z',
    },
  ],
};

function render(
  memory: BuddyMemory,
  variant: 'desktop' | 'mobile' = 'desktop',
  error: string | null = null
) {
  return renderToStaticMarkup(
    React.createElement(BuddyMemoryPanel, {
      buddy: BUDDY,
      memory,
      variant,
      error,
      onRetry: () => {},
      onUpdate: async () => {},
      onRememberLegacy: async () => {},
      onRememberNote: async () => {},
      onRecall: async ({ pattern }) => ({ pattern, matches: [], truncated: false }),
    })
  );
}

test('memory panel renders independent v2 documents, revisions, generation, and note controls', () => {
  const html = render(V2_MEMORY);

  assert.match(html, /WORKING_MEMORY\.md/);
  assert.match(html, /LONG_TERM_MEMORY\.md/);
  assert.match(html, /Revision 7/);
  assert.match(html, /Revision 4/);
  assert.match(html, /Memory generation 12/);
  assert.match(html, /Append note/);
  assert.match(html, /Recall notes/);
  assert.match(html, /Keep runtime memory out of packages\./);
  assert.doesNotMatch(html, /Curated memory/);
});

test('legacy payload remains a usable summary, journal, and remember form', () => {
  const memory = normalizeBuddyMemory({
    summary: 'Legacy summary',
    recentJournal: [{ path: '/memory/journal/2026-08-29.md', content: 'Legacy entry' }],
  });
  const html = render(memory, 'mobile');

  assert.match(html, /Curated memory/);
  assert.match(html, /Legacy summary/);
  assert.match(html, /Recent journal/);
  assert.match(html, /Legacy entry/);
  assert.match(html, /Remember/);
  assert.doesNotMatch(html, /WORKING_MEMORY\.md/);
});

test('stale CAS errors tell the editor which revision must be reloaded', () => {
  const message = formatMemoryWriteError(
    new Error('StaleMemoryWrite: working memory is at revision 8; supplied base 7')
  );

  assert.equal(
    message,
    'Memory changed while you were editing (current revision 8; your base 7). Reload the document and retry.'
  );
});

test('mobile v2 markup stays within the mobile feature class boundary', () => {
  const html = render(V2_MEMORY, 'mobile');

  assert.match(html, /mobile-memory-v2/);
  assert.match(html, /aria-label="WORKING_MEMORY\.md content"/);
  assert.doesNotMatch(html, /buddy-memory-v2/);
});
