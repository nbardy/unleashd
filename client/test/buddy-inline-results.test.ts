import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBuddyBuilderToolResult, parseBuddyBuilderToolResult } from '@unleashd/shared';
import { splitStructuredMessageContent } from '../src/utils/structured-message-segments';

const workspace = { id: 'w1', slug: 'workspace', name: 'Workspace', root_path: '/tmp/workspace' };
const result = {
  conversationId: 'c1',
  buddy: {
    id: 'b1',
    project_id: 'w1',
    slug: 'researcher',
    name: 'Researcher --> <script>',
    role: 'Research',
    status: 'active',
    provider: 'codex',
    model: null,
    reasoning_effort: null,
  },
  homeWorkspace: workspace,
  workspaces: [workspace],
  followUpQuestions: [],
};

test('creation and update stay between surrounding prose, including marker-like names', () => {
  const created = formatBuddyBuilderToolResult({
    buddyBuilderEvent: { action: 'created', result },
  });
  const updated = formatBuddyBuilderToolResult({
    buddyBuilderEvent: { action: 'updated', result, revision: 2 },
  });
  const segments = splitStructuredMessageContent(`Before\n${created}\nBetween\n${updated}\nAfter`);
  assert.deepEqual(
    segments.map((s) => s.type),
    ['text', 'buddy_builder_result', 'text', 'buddy_builder_result', 'text']
  );
  assert.equal(segments[2].type === 'text' && segments[2].content, '\nBetween\n');
  const cards = segments
    .filter((s) => s.type === 'buddy_builder_result')
    .map((s) => JSON.parse(decodeURIComponent(s.json)));
  assert.deepEqual(
    cards.map((c) => c.action),
    ['created', 'updated']
  );
  assert.equal(cards[0].result.buddy.name, result.buddy.name);
});

test('reads, rejected results and malformed events cannot masquerade as successful mutations', () => {
  assert.equal(parseBuddyBuilderToolResult({ results: [result] }), null);
  assert.equal(parseBuddyBuilderToolResult({ isError: true, result }), null);
  assert.equal(
    parseBuddyBuilderToolResult({ buddyBuilderEvent: { action: 'updated', result }, result }),
    null
  );
  assert.equal(parseBuddyBuilderToolResult(result)?.action, 'created');
});
