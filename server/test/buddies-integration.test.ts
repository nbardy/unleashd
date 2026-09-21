import assert from 'node:assert/strict';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { BuddiesUnavailableError, createBuddiesIntegration } from '../src/buddies/integration';

test('optional Buddies loading is lazy, memoized, and classifies package failures', async () => {
  let loadCount = 0;
  const integration = createBuddiesIntegration({
    getConversation: () => undefined,
    loadModule: async () => {
      loadCount += 1;
      throw new Error('package missing');
    },
  });

  await assert.rejects(integration.getStore(), BuddiesUnavailableError);
  await assert.rejects(integration.getStore(), BuddiesUnavailableError);
  assert.equal(loadCount, 1);
});

test('owner_thread briefing with a production-length conversation id stays within budget', async () => {
  // Regression guard: the static BUDDY OPERATIONS suffix grew with each
  // feature line until an owner_thread audience carrying a real UUID pushed
  // it past the suffix budget, and every Buddy message failed at compose
  // time (2026-09-21). Short placeholder ids in other tests never tripped it.
  const raw = new BuddiesStore(':memory:');
  const store = raw as unknown as BuddiesStorePort;
  try {
    const w = raw.createWorkspace({ name: 'Research', rootPath: '/tmp' });
    const b = raw.createBuddy({ project: w.id, name: 'Researcher', role: 'Compare evidence' });
    const integration = createBuddiesIntegration({
      getConversation: () => undefined,
      store,
    });
    const resolved = await integration.resolveConversation({
      buddyId: b.id,
      workspaceId: w.id,
      knowledgeScope: {
        kind: 'owner_thread',
        conversationId: '12345678-1234-1234-1234-123456789abc',
      },
    });
    assert.ok(resolved.briefing.includes('BUDDY OPERATIONS'));
  } finally {
    raw.close();
  }
});
