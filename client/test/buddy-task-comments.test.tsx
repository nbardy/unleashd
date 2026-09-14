import assert from 'node:assert/strict';
import test from 'node:test';
// biome-ignore lint/correctness/noUnusedImports: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BuddyTaskCommentList,
  BuddyTaskComments,
} from '../src/components/buddies/BuddyTaskComments';

test('task comments show durable authorship, body and ordinary file evidence', () => {
  const html = renderToStaticMarkup(
    <BuddyTaskCommentList
      comments={[
        {
          id: 'comment',
          project_id: 'task',
          author: 'buddy:engineer',
          body: 'Saved partial work.\nReview the remaining failure.',
          evidence: ['agent_notes/partial.md', 'commit:abc'],
          created_at: '2026-09-14T10:00:00Z',
        },
      ]}
    />
  );
  assert.match(html, /buddy:engineer/);
  assert.match(html, /Saved partial work/);
  assert.match(html, /Review the remaining failure/);
  assert.match(html, /agent_notes\/partial.md/);
  assert.match(html, /commit:abc/);
  assert.match(html, /dateTime="2026-09-14T10:00:00Z"/);
});

test('shared task comment panel offers append while loading and honest empty history', () => {
  const html = renderToStaticMarkup(<BuddyTaskComments projectId="task" />);
  assert.match(html, /Task comments/);
  assert.match(html, /Loading comments/);
  assert.match(html, /Evidence or file references/);
  assert.match(html, /Add comment/);
  assert.match(renderToStaticMarkup(<BuddyTaskCommentList comments={[]} />), /No comments yet/);
});
