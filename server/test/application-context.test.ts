import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebSocketServer } from 'ws';
import { createConversationApplicationContext } from '../src/application/context';

// A suppression that never expires would silently swallow every later
// completion notification for that session.
test('completion suppression expires deterministically', () => {
  let now = 1_000;
  const context = createConversationApplicationContext<{ id: string; sessionId: string }>({
    webSocketServer: { clients: new Set() } as unknown as WebSocketServer,
    completionSuppressionMs: 100,
    now: () => now,
  });

  context.completionSuppression.mark('session-1');
  assert.equal(context.completionSuppression.isSuppressed('session-1', now), true);

  now += 100;
  assert.equal(context.completionSuppression.isSuppressed('session-1', now), false);
  assert.equal(context.completionSuppression.isSuppressed('session-1', now), false);
});
