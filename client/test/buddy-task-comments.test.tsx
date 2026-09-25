import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuddyTaskCommentList } from '../src/components/buddies/BuddyTaskComments';
import { BuddyTaskPanel } from '../src/components/buddies/BuddyWork';

const names = { engineer: 'Engineer' };

test('task comments show durable authorship, body and ordinary file evidence', () => {
  const html = renderToStaticMarkup(
    <BuddyTaskCommentList
      names={names}
      comments={[
        {
          id: 'comment',
          channelId: 'task-channel',
          author: { kind: 'buddy', id: 'engineer' },
          body: 'Saved partial work.\nReview the remaining failure.',
          evidence: ['agent_notes/partial.md', 'commit:abc'],
          request: { state: 'none' },
          createdAt: '2026-09-14T10:00:00Z',
          ord: '2',
        },
        {
          id: 'gone',
          channelId: 'task-channel',
          author: { kind: 'buddy', id: 'retired' },
          body: 'An author the roster no longer names.',
          evidence: [],
          request: { state: 'none' },
          createdAt: '2026-09-14T09:00:00Z',
          ord: '1',
        },
      ]}
    />
  );
  assert.match(html, /Engineer/);
  assert.match(html, /retired/, 'an unknown author shows its id, never another name');
  assert.match(html, /Saved partial work/);
  assert.match(html, /Review the remaining failure/);
  assert.match(html, /agent_notes\/partial.md/);
  assert.match(html, /commit:abc/);
  assert.match(html, /dateTime="2026-09-14T10:00:00Z"/);
});

// Unloaded and loaded-empty must render differently (the same conflation made
// channels flash "No posts" before their posts on 2026-09-24).
test('the task panel says loading until its detail arrives, and empty only once loaded', () => {
  const loading = renderToStaticMarkup(<BuddyTaskPanel taskId="task" names={names} />);
  assert.match(loading, /Loading comments/);
  assert.doesNotMatch(loading, /No comments yet/);
  assert.match(
    renderToStaticMarkup(<BuddyTaskCommentList comments={[]} names={names} />),
    /No comments yet/
  );
});
