import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
// biome-ignore lint/correctness/noUnusedImports: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { BuddyRailRow } = await import('../src/components/buddies/BuddyRailRow');

// Clicking a Buddy name in the Slack rail opens the DM (the ongoing owner
// chat), matching the mobile Buddies home. It used to link to the Buddy page,
// leaving the DM behind a hover-only icon.
test('desktop slack rail: buddy name is a DM button, never a buddy-page link', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <BuddyRailRow
        member={{ id: 'b1', name: 'Lead', role: 'Own the work' }}
        workspaceId="ws"
        openDm={() => {}}
        current={false}
      />
    </MemoryRouter>
  );
  assert.ok(html.includes('aria-label="Message Lead"'), 'name must offer the DM action');
  assert.ok(!html.includes('href="/buddies/'), 'rail name must not link to a buddy page');
});
