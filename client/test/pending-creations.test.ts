import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationConfig } from '@unleashd/shared';
import {
  type PersistedPendingCreation,
  isRetryableCreationRejection,
  preparePendingCreationForReconnect,
} from '../src/atoms/pending-creations';

const config: ConversationConfig = {
  provider: 'codex',
  model: { mode: 'default' },
  reasoning: { mode: 'default' },
};

function pending(overrides: Partial<PersistedPendingCreation> = {}): PersistedPendingCreation {
  return {
    commandId: 'command-1',
    conversationId: 'conversation-1',
    workingDirectory: '/tmp/project',
    config,
    createdAt: '2026-08-04T00:00:00.000Z',
    kind: { t: 'chat' },
    ...overrides,
  };
}

test('server lifecycle rejections are retryable after reconnect', () => {
  assert.equal(isRetryableCreationRejection('server_draining'), true);
  assert.equal(isRetryableCreationRejection('server_starting'), true);

  const original = pending({ error: 'draining', errorCode: 'server_draining' });
  const retried = preparePendingCreationForReconnect(original);

  assert.notEqual(retried, original);
  assert.equal(retried.error, undefined);
  assert.equal(retried.errorCode, undefined);
  assert.equal(retried.commandId, original.commandId);
  assert.equal(retried.conversationId, original.conversationId);
});

test('permanent creation rejection remains failed after reconnect', () => {
  const original = pending({
    error: 'Working directory does not exist',
    errorCode: 'create_failed',
  });

  assert.equal(isRetryableCreationRejection(original.errorCode), false);
  assert.equal(preparePendingCreationForReconnect(original), original);
});
