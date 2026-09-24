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

// The BUDDY OPERATIONS suffix is developer-authored prose re-sent with every
// briefing. Its budget lives here, not as a runtime throw: as a throw it failed
// every owner-thread Buddy message on 2026-09-21 when one new feature line
// pushed it 9 chars over, while tests with short placeholder ids stayed green.
// Trim a line before raising this number.
const BUDDY_OPERATIONS_MAX_CHARACTERS = 3_000;

test('BUDDY OPERATIONS stays within its budget for every audience and run variant', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = raw as unknown as BuddiesStorePort;
  try {
    const w = raw.createWorkspace({ name: 'Research', rootPath: '/tmp' });
    const b = raw.createBuddy({ project: w.id, name: 'Researcher', role: 'Compare evidence' });
    const integration = createBuddiesIntegration({ getConversation: () => undefined, store });
    const uuid = '12345678-1234-1234-1234-123456789abc';
    const ownerThread = { kind: 'owner_thread' as const, conversationId: uuid };
    const variants = [
      {},
      { automationRunId: uuid },
      { knowledgeScope: ownerThread },
      { knowledgeScope: ownerThread, automationRunId: uuid },
    ];
    for (const variant of variants) {
      const { briefing } = await integration.resolveConversation({
        buddyId: b.id,
        workspaceId: w.id,
        ...variant,
      });
      const suffix = briefing.slice(briefing.indexOf('\nBUDDY OPERATIONS'));
      assert.ok(
        suffix.length <= BUDDY_OPERATIONS_MAX_CHARACTERS,
        `${JSON.stringify(variant)}: ${suffix.length} chars`
      );
    }
  } finally {
    raw.close();
  }
});
