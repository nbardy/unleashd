import assert from 'node:assert/strict';
import test from 'node:test';
// biome-ignore lint/correctness/noUnusedImports: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BuddyTeamObservationSchema } from '@unleashd/shared';
import { BuddyTeamExecutionList } from '../src/components/buddies/BuddyTeamExecution';

test('team receipts distinguish failed execution, saved artifacts, reply delivery and current work', () => {
  const data = BuddyTeamObservationSchema.parse({
    observedAt: '2026-09-12T16:00:00Z',
    nextOffset: null,
    limitations: ['GPU reservations are not host leases.'],
    items: [
      {
        runId: 'failed-attempt',
        buddyId: 'worker',
        buddyName: 'Engineer',
        inputKind: 'message_request',
        messageId: 'message',
        rootMessageId: 'root',
        conversationId: 'deleted-thread',
        attempt: 1,
        state: 'failed',
        createdAt: '2026-09-12T15:00:00Z',
        startedAt: '2026-09-12T15:00:01Z',
        acknowledgedAt: '2026-09-12T15:00:02Z',
        endedAt: '2026-09-12T15:10:00Z',
        deadline: '2026-09-12T15:10:00Z',
        errorCode: 'max_runtime_timeout',
        error: 'Attempt expired',
        project: {
          id: 'project',
          revision: 6,
          status: 'done',
          updatedAt: '2026-09-12T15:30:00Z',
          evidenceCount: 2,
        },
        reply: {
          persistedAt: '2026-09-12T15:20:00Z',
          outcome: 'done',
          evidenceCount: 1,
          deliveryStates: ['message_reply: failed'],
          deliveryCount: 2,
          deliveryNextOffset: 1,
          deliveries: [
            {
              runId: 'return-retry',
              kind: 'message_reply',
              attempt: 2,
              state: 'complete',
              acknowledgedAt: '2026-09-12T15:21:01Z',
              createdAt: '2026-09-12T15:21:00Z',
              endedAt: '2026-09-12T15:22:00Z',
              errorCode: null,
              error: null,
              retryOfRunId: 'failed-return',
            },
          ],
        },
        checkpoints: [
          {
            id: 'checkpoint',
            run_id: 'failed-attempt',
            buddy_id: 'worker',
            workspace_id: 'workspace',
            project_id: 'project',
            message_id: 'message',
            root_message_id: 'root',
            created_at: '2026-09-12T15:05:00Z',
            artifacts: [{ ref: 'artifact:survived', version: 'commit:abc' }],
            effects: ['Saved local result'],
            resume: 'Review existing output',
            visibility: 'team',
          },
        ],
        recovery: {
          controllerBuddyIds: ['lead'],
          canRetry: false,
          reason: 'Stopped roots cannot be retried',
          remainingRuns: 3,
          remainingSeconds: 4000,
          checkpointIds: ['checkpoint'],
          action: null,
        },
        execution: null,
        limits: {
          turnCapSeconds: 600,
          maxActiveRuns: 2,
          backgroundEnabled: true,
          pausedReason: null,
        },
      },
    ],
  });
  const render = (available: ReadonlySet<string>) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <BuddyTeamExecutionList
          data={data}
          availableConversationIds={available}
          onRetry={async () => {}}
          onDeliveryPage={() => {}}
          onInspectRun={() => {}}
        />
      </MemoryRouter>
    );
  const markup = render(new Set());
  assert.match(markup, /failed · attempt 1/);
  assert.match(markup, /revision 6/);
  assert.match(markup, /message_reply: complete · attempt 2 · return-retry/);
  assert.match(markup, /Retry of failed-return/);
  assert.match(markup, /Older deliveries \(2 attempts\)/);
  assert.match(markup, /Inspect delivery attempt 2/);
  assert.match(markup, /Delivery completion does not record consumer review/);
  assert.match(markup, /artifact:survived/);
  assert.match(markup, /commit:abc/);
  assert.match(markup, /Stopped roots cannot be retried/);
  assert.doesNotMatch(markup, /href="\/chat\/deleted-thread"/);
  assert.doesNotMatch(markup, /Retry this input/);
  assert.match(render(new Set(['deleted-thread'])), /href="\/chat\/deleted-thread"/);
  data.items[0].recovery.canRetry = true;
  const retryMarkup = render(new Set());
  assert.match(retryMarkup, /Retry this input/);
  assert.match(retryMarkup, /Historical checkpoint/);
  assert.match(retryMarkup, /artifact:survived/);
  assert.doesNotMatch(retryMarkup, /name="checkpoint"|Resume from/);
});
