import assert from 'node:assert/strict';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import {
  BUDDY_CONTROL_TOKEN_ENV,
  BUDDY_CONTROL_URL_ENV,
  BuddyControlServer,
} from '../src/buddies/control-server';

test('Buddy control capabilities are scoped, rotate per turn, and bypass no public route', async () => {
  const store = new BuddiesStore(':memory:');
  const workspace = store.createWorkspace({ name: 'Workspace', rootPath: '/tmp/control-test' });
  const lead = store.createBuddy({
    project: workspace.id,
    name: 'Lead',
    role: 'Lead',
  });
  const report = store.createBuddy({
    project: workspace.id,
    name: 'Report',
    role: 'Report',
  });
  store.setBuddyRelationship({ fromBuddy: lead.id, toBuddy: report.id, kind: 'manager' });
  let active = true;
  const dispatched: string[] = [];
  const control = new BuddyControlServer({
    getStore: async () => store as unknown as BuddiesStorePort,
    isConversationActive: (conversationId) => active && conversationId === 'conversation-1',
    dispatchDelegation: async (_context, input) => {
      dispatched.push(input.purpose);
      return { ok: true };
    },
    dispatchReview: async () => ({ ok: true }),
  });
  await control.start();
  try {
    const context = {
      buddyId: lead.id,
      workspaceId: workspace.id,
      buddyProjectId: null,
      legacyWorkItemId: null,
      automationRunId: null,
      delegatedByBuddyId: null,
      parentBuddyConversationId: null,
      allowedBuddyOperations: ['buddy.delegate'],
    } as const;
    const first = control.issue(context, 'conversation-1');
    const second = control.issue(context, 'conversation-1');
    const post = (env: Readonly<Record<string, string>>) =>
      fetch(`${env[BUDDY_CONTROL_URL_ENV]}/v1/delegations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env[BUDDY_CONTROL_TOKEN_ENV]}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ toBuddyId: report.id, purpose: 'Bounded work' }),
      });

    assert.equal((await post(first)).status, 401, 'issuing a new turn revokes the old token');
    const accepted = await post(second);
    assert.equal(accepted.status, 200);
    assert.deepEqual(dispatched, ['Bounded work']);

    control.revoke('conversation-1');
    assert.equal((await post(second)).status, 401, 'explicit terminal revocation is immediate');

    const terminal = control.issue(context, 'conversation-1');

    active = false;
    assert.equal((await post(terminal)).status, 401, 'terminal turns lose callback authority');
    assert.equal(
      (
        await fetch(`${second[BUDDY_CONTROL_URL_ENV]}/v1/delegations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
      401
    );
  } finally {
    await control.close();
    store.close();
  }
});
