import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationListEntry } from '../src/atoms/conversation-index';
import { latestActiveBuddyBuilder } from '../src/components/buddies/channel-buddy-builder';

function entry(id: string, done: boolean, activityMs: number): ConversationListEntry {
  return {
    id,
    activityMs,
    createdAtMs: activityMs,
    done,
    kind: 'buddy_builder',
    buddyId: null,
    buddyWorkspaceId: null,
    workingDirectory: '/',
    isRunning: false,
    isWorker: false,
    placement: 'foreground',
    parentConversationId: null,
  };
}

test('latestActiveBuddyBuilder returns the newest not-done builder only', () => {
  const newest = entry('new', false, 300);
  assert.equal(
    latestActiveBuddyBuilder([
      newest,
      entry('old', false, 100),
      entry('done', true, 400),
    ])?.id,
    'new'
  );
  assert.equal(latestActiveBuddyBuilder([entry('done', true, 500)]), null);
});
