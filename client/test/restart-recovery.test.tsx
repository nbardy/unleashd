import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientMessage } from '@unleashd/shared';
import { handleMessage, resumeInterruptedMessages, setSendFn } from '../src/atoms/actions';
import {
  captureRestartRecoveryQueue,
  clearRestartRecovery,
  loadRestartRecovery,
} from '../src/atoms/restart-recovery';
import { shouldOfferRestartRecovery } from '../src/hooks/useRestartRecovery';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const conversationId = '17e0146f-95c6-43a0-a506-bd48e5e8156b';

test.beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  clearRestartRecovery(conversationId);
});

test('queue mirror retains the current and pending messages when the server queue disappears', () => {
  captureRestartRecoveryQueue(conversationId, [
    {
      id: 'current',
      content: 'finish the current work',
      queuedAt: new Date('2026-09-13T00:00:00.000Z'),
      status: 'sending',
    },
    {
      id: 'next',
      content: 'then verify it',
      queuedAt: new Date('2026-09-13T00:00:01.000Z'),
      status: 'pending',
    },
  ]);

  captureRestartRecoveryQueue(conversationId, []);
  const recovery = loadRestartRecovery(conversationId);
  assert.equal(recovery?.currentMessage, 'finish the current work');
  assert.deepEqual(recovery?.queuedMessages, ['then verify it']);
});

test('resume resubmits the current message before requeueing later messages', async () => {
  const sent: ClientMessage[] = [];
  setSendFn((message) => sent.push(message));

  const resumed = resumeInterruptedMessages(conversationId, ['current', 'queued']);
  assert.equal(sent.length, 1);
  const first = sent[0];
  if (first.type !== 'queue_message') throw new Error('expected first queue command');
  handleMessage({
    type: 'command_accepted',
    commandId: first.commandId,
    conversationId,
  });
  await Promise.resolve();

  assert.equal(sent.length, 2);
  const second = sent[1];
  if (second.type !== 'queue_message') throw new Error('expected second queue command');
  assert.equal(first.content, 'current');
  assert.equal(second.content, 'queued');
  handleMessage({
    type: 'command_accepted',
    commandId: second.commandId,
    conversationId,
  });
  await resumed;
});

test('only a newer restart interruption surfaces the recovery offer', () => {
  const snapshot = { updatedAt: '2026-09-13T00:00:02.000Z' };
  const olderRestart = {
    state: 'interrupted' as const,
    terminalCause: 'server_restart' as const,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:01.000Z',
    terminalAt: '2026-09-13T00:00:01.000Z',
  };
  const newerRestart = {
    ...olderRestart,
    updatedAt: '2026-09-13T00:00:03.000Z',
    terminalAt: '2026-09-13T00:00:03.000Z',
  };

  assert.equal(shouldOfferRestartRecovery(snapshot, olderRestart, false), false);
  assert.equal(shouldOfferRestartRecovery(snapshot, newerRestart, false), true);
  assert.equal(shouldOfferRestartRecovery(snapshot, newerRestart, true), false);
});
