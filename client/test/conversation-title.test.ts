import assert from 'node:assert/strict';
import test from 'node:test';
import type { Conversation } from '@unleashd/shared';
import { getConversationTitle } from '../src/components/conversation-title';

function conversation(partial: Partial<Conversation>): Conversation {
  return {
    messages: [],
    ...partial,
  } as Conversation;
}

function userMessage(content: string) {
  return { role: 'user' as const, content, timestamp: new Date('2026-09-22T00:00:00.000Z') };
}

/**
 * Sidebar labels used to render the raw first user message, so buddy-spawned
 * turns showed the `<!-- unleashd:buddy-context-v2 … -->` envelope (a long
 * base64 line) instead of anything readable. The provider title now wins and
 * the fallback strips hidden envelopes.
 */
test('provider title wins over message text', () => {
  const conv = conversation({
    title: 'Channels and task overlap',
    messages: [userMessage('some other first line')],
  });
  assert.equal(getConversationTitle(conv), 'Channels and task overlap');
});

test('buddy-context envelope is stripped from the fallback label', () => {
  const conv = conversation({
    messages: [
      userMessage(
        '<!-- unleashd:buddy-context-v2 eyJidWRkeUlkIjoiYWJjIn0 11428 -->\nFix the sidebar labels'
      ),
    ],
  });
  assert.equal(getConversationTitle(conv), 'Fix the sidebar labels');
});

test('comment-only content falls back to the placeholder', () => {
  const conv = conversation({
    messages: [userMessage('<!-- unleashd:swarm-prefix -->\n<!-- /unleashd:swarm-prefix -->')],
  });
  assert.equal(getConversationTitle(conv), 'New conversation');
});

test('oompa prefix and long lines still truncate as before', () => {
  const oompa = conversation({ messages: [userMessage('[oompa:swarm1:w0] do the thing')] });
  assert.equal(getConversationTitle(oompa), 'do the thing');
  const long = conversation({ messages: [userMessage(`x${'y'.repeat(100)}`)] });
  const title = getConversationTitle(long);
  assert.equal(title.length, 78);
  assert.ok(title.endsWith('…'));
});
