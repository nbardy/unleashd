import assert from 'node:assert/strict';
import test from 'node:test';
import type { BuddyContext } from '@unleashd/shared';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddyDispatchService } from '../src/buddies/dispatch-service';

function fixture(cancelDuringCreate: boolean) {
  let active = true;
  let inAuthority = false;
  let bound = 0;
  let enqueued = 0;
  let abandoned = 0;
  let failedDispatch = 0;
  let cancelledReview = 0;
  const requireAuthority = (_run: string, _operation: string, token: string) => {
    if (!active) throw new Error('automation run is not active: cancelled');
    if (token !== 'current-claim') throw new Error('automation run claim is not owned');
    return true as const;
  };
  const store = {
    assertAutomationOperationAllowed: requireAuthority,
    withAutomationRunAuthority(
      _run: string,
      operation: string,
      token: string,
      callback: () => unknown
    ) {
      requireAuthority('run-1', operation, token);
      inAuthority = true;
      try {
        const result = callback();
        requireAuthority('run-1', operation, token);
        return result;
      } finally {
        inAuthority = false;
      }
    },
    listDelegations: () => [],
    createDelegation: () => ({
      id: 'delegation-1',
      from_buddy_id: 'lead',
      to_buddy_id: 'report',
      workspace_id: 'workspace',
      buddy_project_id: null,
      child_conversation_id: null,
      parent_conversation_id: 'parent',
      purpose: 'Do work',
      status: 'pending',
    }),
    claimDelegationDispatch: () => ({
      id: 'delegation-1',
      dispatch_claim_acquired: true,
      child_conversation_id: null,
    }),
    bindDelegationConversation: () => {
      assert.equal(inAuthority, true, 'binding shares the run authority transaction');
      bound += 1;
      return { id: 'delegation-1', status: 'active' };
    },
    failDelegationDispatch: () => {
      failedDispatch += 1;
      return { id: 'delegation-1' };
    },
    createReview: () => ({ id: 'review-1' }),
    updateReview: () => {
      cancelledReview += 1;
      return { id: 'review-1' };
    },
  } as unknown as BuddiesStorePort;
  const service = createBuddyDispatchService({
    getStore: async () => store,
    createId: () => 'conversation-1',
    createConversation: async () => {
      if (cancelDuringCreate) active = false;
      return { id: 'conversation-1', toJSON: () => ({ id: 'conversation-1' }) };
    },
    dispatchInitialMessage: async (_conversation, options) =>
      options.enqueueAuthorized(() => {
        assert.equal(inAuthority, true, 'enqueue shares the run authority transaction');
        enqueued += 1;
      }),
    abandonConversation: () => {
      abandoned += 1;
    },
  });
  const context: BuddyContext = {
    buddyId: 'lead',
    workspaceId: 'workspace',
    buddyProjectId: null,
    legacyWorkItemId: null,
    automationRunId: 'run-1',
    delegatedByBuddyId: null,
    parentBuddyConversationId: 'parent',
    allowedBuddyOperations: ['buddy.delegate', 'buddy.request_review'],
  };
  return {
    service,
    context,
    counts: () => ({ bound, enqueued, abandoned, failedDispatch, cancelledReview }),
  };
}

test('delegation binds and starts inside the current automation authority transaction', async () => {
  const { service, context, counts } = fixture(false);
  await service.delegation(
    context,
    {
      toBuddyId: 'report',
      purpose: 'Do work',
      parentConversationId: 'parent',
      allowedOperations: ['buddy.complete_assignment'],
    },
    'current-claim'
  );
  assert.deepEqual(counts(), {
    bound: 1,
    enqueued: 1,
    abandoned: 0,
    failedDispatch: 0,
    cancelledReview: 0,
  });
});

test('cancellation during async creation leaves delegation and review children dormant', async () => {
  const delegation = fixture(true);
  await assert.rejects(
    delegation.service.delegation(
      delegation.context,
      {
        toBuddyId: 'report',
        purpose: 'Do work',
        parentConversationId: 'parent',
        allowedOperations: ['buddy.complete_assignment'],
      },
      'current-claim'
    ),
    /not active: cancelled/
  );
  assert.deepEqual(delegation.counts(), {
    bound: 0,
    enqueued: 0,
    abandoned: 1,
    failedDispatch: 1,
    cancelledReview: 0,
  });

  const review = fixture(true);
  await assert.rejects(
    review.service.review(
      review.context,
      {
        reviewerBuddyId: 'critic',
        subjectBuddyId: 'report',
        purpose: 'Review work',
        parentConversationId: 'parent',
        evidence: [],
      },
      'current-claim'
    ),
    /not active: cancelled/
  );
  assert.deepEqual(review.counts(), {
    bound: 0,
    enqueued: 0,
    abandoned: 1,
    failedDispatch: 0,
    cancelledReview: 1,
  });
});
