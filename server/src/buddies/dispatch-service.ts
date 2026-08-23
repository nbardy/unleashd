import type { BuddyContext } from '@unleashd/shared';
import type { BuddiesStorePort } from './contract';
import { BUDDY_REVIEW_RESULT_INSTRUCTIONS } from './integration';
import {
  type BuddyOperationName,
  type PreparedBuddyDelegation,
  type PreparedBuddyReviewRequest,
  REVIEW_BUDDY_OPERATIONS,
} from './operations';

export interface BuddyDispatchServiceDependencies {
  getStore(): Promise<BuddiesStorePort>;
  createConversation(input: {
    context: BuddyContext;
    initialMessage: string;
    commandId: string;
    conversationId?: string;
    deferInitialMessage?: boolean;
  }): Promise<BuddyDispatchConversation>;
  dispatchInitialMessage(
    conversation: BuddyDispatchConversation,
    options: { enqueueAuthorized(enqueue: () => void): void }
  ): Promise<void>;
  abandonConversation(conversation: BuddyDispatchConversation): Promise<void> | void;
  createId(): string;
}

export interface BuddyDispatchConversation {
  id: string;
  toJSON(): unknown;
}

export function createBuddyDispatchService(dependencies: BuddyDispatchServiceDependencies) {
  const assertCurrent = (
    store: BuddiesStorePort,
    context: BuddyContext,
    operation: BuddyOperationName,
    automationClaimToken?: string
  ) => {
    if (!context.automationRunId) return;
    store.assertAutomationOperationAllowed(
      context.automationRunId,
      operation,
      automationClaimToken ?? ''
    );
  };
  const withCurrentAuthority = <T>(
    store: BuddiesStorePort,
    context: BuddyContext,
    operation: BuddyOperationName,
    automationClaimToken: string | undefined,
    callback: () => T
  ): T => {
    if (!context.automationRunId) return callback();
    return store.withAutomationRunAuthority(
      context.automationRunId,
      operation,
      automationClaimToken ?? '',
      callback
    );
  };
  return {
    async delegation(
      context: BuddyContext,
      input: PreparedBuddyDelegation,
      automationClaimToken?: string
    ) {
      const buddies = await dependencies.getStore();
      assertCurrent(buddies, context, 'buddy.delegate', automationClaimToken);
      const normalizedParent = input.parentConversationId ?? null;
      const existing = buddies
        .listDelegations({ buddy: context.buddyId, workspace: context.workspaceId })
        .find(
          (candidate) =>
            candidate.from_buddy_id === context.buddyId &&
            candidate.to_buddy_id === input.toBuddyId &&
            candidate.purpose === input.purpose &&
            candidate.parent_conversation_id === normalizedParent &&
            (candidate.status === 'pending' || candidate.status === 'active')
        );
      if (existing?.child_conversation_id) {
        return { delegation: existing, alreadyDispatched: true };
      }
      const delegation =
        existing ??
        buddies.createDelegation({
          fromBuddy: context.buddyId,
          toBuddy: input.toBuddyId,
          workspace: context.workspaceId,
          project: input.projectId,
          purpose: input.purpose,
          parentConversationId: input.parentConversationId,
        });
      const claimToken = dependencies.createId();
      const claim = buddies.claimDelegationDispatch(delegation.id, {
        claimToken,
        leaseSeconds: 300,
      });
      if (!claim.dispatch_claim_acquired) {
        if (claim.child_conversation_id) {
          return { delegation: claim, alreadyDispatched: true };
        }
        throw new Error('Delegation dispatch is already claimed by another executor');
      }
      let conversation: BuddyDispatchConversation | null = null;
      try {
        conversation = await dependencies.createConversation({
          context: {
            buddyId: input.toBuddyId,
            workspaceId: context.workspaceId,
            buddyProjectId: null,
            delegatedByBuddyId: context.buddyId,
            parentBuddyConversationId: input.parentConversationId ?? null,
            allowedBuddyOperations: input.allowedOperations,
          },
          commandId: `buddy-delegation-${delegation.id}`,
          deferInitialMessage: true,
          initialMessage: [
            `Delegated by Buddy ${context.buddyId}.`,
            `Delegation id: ${delegation.id}.`,
            input.projectId
              ? `Supervising project id: ${input.projectId}. The project remains owned by the delegating employee.`
              : 'No supervising Buddy project was selected.',
            `Purpose: ${input.purpose}`,
            `Allowed Buddy operations: ${input.allowedOperations.join(', ')}.`,
            'Own this bounded assignment within that operation policy.',
            'When the definition of done is actually satisfied, call complete_assignment with concrete evidence. A completed model turn alone does not complete the assignment.',
          ].join('\n'),
        });
        let active: ReturnType<BuddiesStorePort['bindDelegationConversation']> | null = null;
        await dependencies.dispatchInitialMessage(conversation, {
          enqueueAuthorized: (enqueue) => {
            active = withCurrentAuthority(
              buddies,
              context,
              'buddy.delegate',
              automationClaimToken,
              () => {
                const bound = buddies.bindDelegationConversation(delegation.id, {
                  claimToken,
                  childConversationId: conversation!.id,
                });
                enqueue();
                return bound;
              }
            );
          },
        });
        if (!active) throw new Error('Delegation child did not reach its authorized start');
        return { delegation: active, conversation: conversation.toJSON() };
      } catch (error) {
        if (conversation) await dependencies.abandonConversation(conversation);
        try {
          buddies.failDelegationDispatch(delegation.id, {
            claimToken,
            error: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // Preserve the dispatch failure; another claimant may own the lease.
        }
        throw error;
      }
    },

    async review(
      context: BuddyContext,
      input: PreparedBuddyReviewRequest,
      automationClaimToken?: string
    ) {
      const buddies = await dependencies.getStore();
      assertCurrent(buddies, context, 'buddy.request_review', automationClaimToken);
      const conversationId = dependencies.createId();
      const review = buddies.createReview({
        reviewer: input.reviewerBuddyId,
        subject: input.subjectBuddyId,
        workspace: context.workspaceId,
        project: input.projectId,
        conversationId,
        evidence: input.evidence,
      });
      let conversation: BuddyDispatchConversation | null = null;
      try {
        conversation = await dependencies.createConversation({
          conversationId,
          context: {
            buddyId: input.reviewerBuddyId,
            workspaceId: context.workspaceId,
            buddyProjectId: null,
            delegatedByBuddyId: context.buddyId,
            parentBuddyConversationId: input.parentConversationId ?? null,
            allowedBuddyOperations: REVIEW_BUDDY_OPERATIONS,
          },
          commandId: `buddy-review-${review.id}`,
          deferInitialMessage: true,
          initialMessage: [
            `Review requested by Buddy ${context.buddyId}.`,
            `Review id: ${review.id}.`,
            `Review Buddy ${input.subjectBuddyId}.`,
            input.projectId
              ? `Reviewed project id: ${input.projectId}.`
              : 'No Buddy project was selected.',
            `Review purpose: ${input.purpose}`,
            `Input evidence: ${JSON.stringify(input.evidence)}`,
            `Allowed Buddy operations: ${REVIEW_BUDDY_OPERATIONS.join(', ')}.`,
            'Use the native submit_review operation with a structured verdict, score, summary, concrete evidence, and required actions.',
            'The legacy result block below is a compatibility fallback only.',
            BUDDY_REVIEW_RESULT_INSTRUCTIONS,
          ].join('\n'),
        });
        await dependencies.dispatchInitialMessage(conversation, {
          enqueueAuthorized: (enqueue) =>
            withCurrentAuthority(
              buddies,
              context,
              'buddy.request_review',
              automationClaimToken,
              enqueue
            ),
        });
        return { review, conversation: conversation.toJSON() };
      } catch (error) {
        if (conversation) await dependencies.abandonConversation(conversation);
        try {
          buddies.updateReview(review.id, { status: 'cancelled' });
        } catch {
          // Preserve the original dispatch failure.
        }
        throw error;
      }
    },
  };
}
