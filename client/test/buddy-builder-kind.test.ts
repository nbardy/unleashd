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

test('explicit builder kind classifies as builder', () => {
  const explicit = { kind: { kind: 'buddy_builder' as const } };
  assert.equal(isBuddyBuilderConversation(explicit), true);
  assert.equal(isBuddyConversation(explicit), false);
});

test('general and buddy conversations are not builders', () => {
  assert.equal(isBuddyBuilderConversation({}), false);
  assert.equal(isBuddyBuilderConversation(null), false);
  assert.equal(isBuddyBuilderConversation(undefined), false);
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
  assert.equal(isBuddyBuilderConversation(buddy), false);
  assert.equal(isBuddyConversation(buddy), true);
});
