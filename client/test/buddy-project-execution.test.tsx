import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  BuddyBackgroundProgress,
  BuddyProjectExecution,
} from '../src/components/buddies/BuddyProjectExecution';
import type { BuddyProject } from '../src/components/buddies/types';

const project: BuddyProject = {
  id: 'project-background',
  workspace_id: 'workspace',
  buddy_id: 'engineer',
  title: 'Wave pool demonstration',
  definition_of_done: 'A reviewed demo video demonstrates the wave-pool design workflow.',
  status: 'ready',
  priority: 0,
  updated_at: '2026-09-10T00:00:00Z',
  revision: 1,
  todos: [
    {
      id: 'todo-demo',
      title: 'Record the demonstration',
      status: 'open',
      definition_of_done: 'Video shows a complete simulation with readable labels.',
    },
  ],
};

const render = (value: BuddyProject) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <BuddyProjectExecution project={value} availableConversationIds={new Set()} />
    </MemoryRouter>
  );

test('background task panel keeps completion criteria with the project and individual task', () => {
  const html = render(project);
  assert.match(html, /A reviewed demo video demonstrates the wave-pool design workflow/);
  assert.match(html, /Video shows a complete simulation with readable labels/);
  assert.match(html, />Edit criteria<\/button>/);
  assert.match(html, />Run in background<\/button>/);
  assert.match(html, /Execution limits/);
  assert.match(html, /Task comments/);
  assert.match(html, /Add comment/);
  assert.doesNotMatch(
    html,
    /href="\/chat\//,
    'starting background work does not require opening chat'
  );
});

test('completed task remains inspectable with evidence and offers no new background start', () => {
  const html = render({
    ...project,
    status: 'done',
    completion_evidence: ['Reviewed demo: output/wave-pool.mp4'],
    todos: [
      {
        ...project.todos[0],
        status: 'done',
        completion_evidence: ['Review confirms readable labels and complete simulation.'],
      },
    ],
  });
  assert.match(html, /Reviewed demo: output\/wave-pool.mp4/);
  assert.match(html, /Review confirms readable labels and complete simulation/);
  assert.doesNotMatch(html, />Run in background<\/button>/);
});

test('background disposition distinguishes exhausted work from a completed provider turn', () => {
  const html = renderToStaticMarkup(
    <BuddyBackgroundProgress
      messageStatus="replied"
      queuedRunCount={4}
      execution={{
        messageId: 'request',
        runId: 'last-turn',
        projectId: project.id,
        state: 'complete',
        code: null,
        reason: null,
        remedy: null,
        acknowledgedAt: null,
        acceptedAt: null,
        acceptedBy: null,
        completionEvidence: [],
        error: null,
        background: {
          mode: 'until_done',
          disposition: 'limit_reached',
          runsUsed: 3,
          maxRuns: 3,
          maxDurationSeconds: 3600,
          startedAt: '2026-09-10T00:00:00Z',
          deadline: '2026-09-10T01:00:00Z',
          waitingMessageIds: [],
        },
      }}
    />
  );
  assert.match(html, /<strong>limit reached<\/strong>/);
  assert.match(html, /3\/3 attempts started/);
  assert.match(html, /dateTime="2026-09-10T01:00:00Z"/);
  assert.doesNotMatch(html, /<strong>complete<\/strong>|4 runs/);
});
