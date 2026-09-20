import assert from 'node:assert/strict';
import test from 'node:test';
// biome-ignore lint/correctness/noUnusedImports: test transform uses classic JSX.
import React from 'react';
import type { QueuedMessage } from '@unleashd/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { MobileQueueStrip } from '../src/mobile/conversations/MobileQueueStrip';

test('mobile queue separates the running input from waiting messages', () => {
  const current: QueuedMessage = {
    id: 'current',
    content: 'Already running',
    status: 'sending',
    queuedAt: new Date(),
  };
  const pending: QueuedMessage = {
    id: 'pending',
    content: 'Follow up later',
    status: 'pending',
    queuedAt: new Date(),
  };
  assert.equal(
    renderToStaticMarkup(<MobileQueueStrip conversationId="example" queue={[current]} />),
    ''
  );
  const html = renderToStaticMarkup(
    <MobileQueueStrip conversationId="example" queue={[current, pending]} />
  );
  assert.match(html, /1 queued/);
  assert.match(html, /Follow up later/);
  assert.match(html, /Cancel queued message 1/);
  assert.doesNotMatch(html, /Already running/);
});
