/**
 * Buddy Builder kind derivation — legacy purpose fallback.
 *
 * Persisted builder records in the wild carry `creation.purpose =
 * 'buddy_builder'` with NO `kind` field (observed 2026-09-07: 30 records under
 * ~/.agent-viewer/conversation-config/v1/by-conversation, all `kind: null`).
 * `getConversationKind()` must keep deriving `buddy_builder` from that legacy
 * shape. If a refactor drops the purpose fallback, every persisted Builder
 * thread silently renders as a general chat: no badge, no helper panel, no
 * sidebar label — the exact "lost Builder thread" report this guards.
 *
 * Exercises the real shared entrypoints on fixture shapes matching the
 * persisted records. No mocks.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConversationKindSchema,
  getBuddyContext,
  getConversationKind,
  isBuddyBuilderConversation,
  isBuddyConversation,
} from '@unleashd/shared';

test('legacy purpose-only builder record still classifies as builder', () => {
  // Shape of a real persisted record: kind absent, purpose set.
  const legacy = { kind: null, buddyContext: null, purpose: 'buddy_builder' };
  assert.equal(getConversationKind(legacy).kind, 'buddy_builder');
  assert.equal(isBuddyBuilderConversation(legacy), true);
  assert.equal(isBuddyConversation(legacy), false);
});

// Perf tripwire (2026-09-25): the client's derived atoms classify every
// conversation on every message/status/queue event. `kind` is already validated
// by the WS wire schema, so re-running ConversationKindSchema.safeParse per call
// cost ~15ms per pass over 1,100 conversations. If a refactor re-validates a
// present `kind` in the accessors, this fails.
test('accessors read a present kind without re-parsing it', (t) => {
  t.mock.method(ConversationKindSchema, 'safeParse', () => {
    throw new Error('present kind must not be re-parsed on the read path');
  });
  const buddy = {
    kind: {
      kind: 'buddy' as const,
      buddyId: 'b1',
      workspaceId: 'w1',
      buddyProjectId: null,
      legacyWorkItemId: null,
      automationRunId: null,
      delegatedByBuddyId: null,
      parentBuddyConversationId: null,
    },
  };
  assert.equal(isBuddyConversation(buddy), true);
  assert.equal(isBuddyBuilderConversation(buddy), false);
  assert.equal(getBuddyContext(buddy)?.buddyId, 'b1');
  assert.equal(isBuddyBuilderConversation({ kind: { kind: 'buddy_builder' as const } }), true);
});
