import assert from 'node:assert/strict';
import test from 'node:test';
import { type Conversation, createDefaultConversationConfig } from '@unleashd/shared';
import { summarizeConversation } from '../src/conversations/serialization';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

// Summaries ride every `init` / `conversations_updated` broadcast. A summary
// that carried the full transcript (or mutated the runtime's messages while
// trimming) would silently bloat the wire or truncate live history.
test('summarizeConversation keeps metadata, message count, and a bounded last-message preview', () => {
  const config = createDefaultConversationConfig('codex');
  const conversation: Conversation = {
    id: '00000000-0000-4000-8000-000000000001',
    sessionId: 'session-1',
    workingDirectory: '/tmp',
    config,
    configRevision: 0,
    configResolution: resolveConfigAgainstProviderCatalog(config),
    provider: 'codex',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    messages: [
      {
        role: 'user',
        content: 'first',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        role: 'assistant',
        content: 'x'.repeat(800),
        timestamp: new Date('2026-01-01T00:01:00.000Z'),
      },
    ],
    isRunning: false,
    done: false,
    isStreaming: false,
    confirmed: true,
    subAgents: [],
    queue: [],
    isWorker: false,
    kind: { kind: 'general' },
  };

  const summary = summarizeConversation(conversation);

  assert.equal(summary.messageCount, 2);
  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0].role, 'assistant');
  assert.equal(summary.messages[0].content.length, 500);
  assert.equal(conversation.messages[1].content.length, 800);
});
