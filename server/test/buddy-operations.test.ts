import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { BuddyOperationsService } from '../src/buddies/operations';

test('scoped Buddy operations close work, remember, delegate, review, and audit', () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-operations-'));
  const store = new BuddiesStore(':memory:');
  try {
    const workspace = store.createWorkspace({ name: 'Workspace', rootPath: root });
    const lead = store.createBuddy({
      project: workspace.id,
      name: 'Lead',
      role: 'Own outcomes',
      memoryPath: 'lead-memory',
    });
    const operator = store.createBuddy({
      project: workspace.id,
      name: 'Operator',
      role: 'Execute bounded work',
    });
    const critic = store.createBuddy({
      project: workspace.id,
      name: 'Critic',
      role: 'Review evidence independently',
    });
    store.setBuddyRelationship({
      fromBuddy: lead.id,
      toBuddy: operator.id,
      kind: 'manager',
    });
    store.setBuddyRelationship({
      fromBuddy: lead.id,
      toBuddy: critic.id,
      kind: 'manager',
    });
    store.setBuddyRelationship({
      fromBuddy: critic.id,
      toBuddy: operator.id,
      kind: 'reviews',
    });
    const operations = new BuddyOperationsService(store as unknown as BuddiesStorePort, {
      buddyId: lead.id,
      workspaceId: workspace.id,
    });

    const created = operations.execute('buddy.new_project', {
      title: 'Launch proof cell',
      definitionOfDone: 'Evidence-backed decision recorded',
      status: 'in_progress',
      nextAction: 'Run proof cell',
      todos: [{ title: 'Run proof cell', status: 'in_progress' }],
    });
    const project = created.data as {
      id: string;
      todos: Array<{ id: string }>;
    };
    assert.throws(
      () =>
        operations.execute('buddy.update_project', {
          projectId: project.id,
          status: 'done',
        }),
      /evidence is required/
    );
    const completed = operations.execute('buddy.update_project', {
      projectId: project.id,
      status: 'done',
      evidence: ['metric:proof-cell-1'],
      todoOperations: [{ operation: 'update', todoId: project.todos[0].id, status: 'done' }],
    });
    assert.equal((completed.data as { status: string }).status, 'done');

    const memory = operations.execute('buddy.remember', {
      kind: 'curated',
      content: 'Proof requires an external-use decision.',
    });
    assert.match((memory.data as { content: string }).content, /external-use decision/);
    store.remember(lead.id, {
      content: 'Daily execution note.',
      date: '2026-07-01T00:00:00.000Z',
    });
    const compactedMemory = operations.execute('buddy.compact_memory', {
      summary: 'The execution note was incorporated into durable memory.',
      retainDays: 0,
    });
    assert.equal((compactedMemory.data as { compact: boolean }).compact, true);

    const delegated = operations.execute('buddy.delegate', {
      toBuddyId: operator.id,
      purpose: 'Pressure-test the proof',
      projectId: project.id,
    });
    const delegationId = (delegated.data as { id: string }).id;
    const settled = operations.execute('buddy.complete_delegation', {
      delegationId,
      outcome: 'The proof passed with one required correction.',
    });
    assert.equal((settled.data as { status: string }).status, 'complete');
    const inbox = operations.execute('buddy.get_inbox');
    assert.deepEqual(
      (
        inbox.data as {
          delegationOutcomes: Array<{ id: string; status: string; outcome: string | null }>;
        }
      ).delegationOutcomes.map(({ id, status, outcome }) => ({ id, status, outcome })),
      [
        {
          id: delegationId,
          status: 'complete',
          outcome: 'The proof passed with one required correction.',
        },
      ]
    );
    const prepared = operations.prepareDelegation({
      toBuddyId: operator.id,
      purpose: 'Read-only evidence check',
    });
    assert.ok(prepared.allowedOperations.includes('buddy.complete_assignment'));
    assert.ok(!prepared.allowedOperations.includes('buddy.new_project'));
    const delegatedOperations = new BuddyOperationsService(store as unknown as BuddiesStorePort, {
      buddyId: operator.id,
      workspaceId: workspace.id,
      allowedOperations: prepared.allowedOperations,
    });
    assert.throws(
      () =>
        delegatedOperations.execute('buddy.new_project', {
          title: 'Unrequested project',
          definitionOfDone: 'Should not be created',
        }),
      /not allowed in this delegated conversation/
    );
    const operatorProject = store.newProject({
      buddy: operator.id,
      workspace: workspace.id,
      title: 'Repair proof',
      definitionOfDone: 'Correction verified',
    });

    const requestedReview = operations.execute('buddy.request_review', {
      reviewerBuddyId: critic.id,
      subjectBuddyId: operator.id,
      purpose: 'Independently verify the correction',
      projectId: operatorProject.id,
    });
    const reviewId = (requestedReview.data as { id: string }).id;
    const criticOperations = new BuddyOperationsService(store as unknown as BuddiesStorePort, {
      buddyId: critic.id,
      workspaceId: workspace.id,
    });
    assert.deepEqual(
      (
        criticOperations.execute('buddy.get_inbox').data as {
          assignedReviews: Array<{ id: string }>;
        }
      ).assignedReviews.map((review) => review.id),
      [reviewId]
    );
    assert.deepEqual(
      (
        criticOperations.execute('buddy.get_current_work', {
          targetBuddyId: operator.id,
        }).data as Array<{ id: string }>
      ).map((item) => item.id),
      [operatorProject.id]
    );
    const submitted = criticOperations.execute('buddy.submit_review', {
      reviewId,
      verdict: 'needs_work',
      score: 65,
      summary: 'The correction is directionally right but not verified.',
      evidence: [
        {
          kind: 'project',
          reference: operatorProject.id,
          observation: 'The verification todo is still open.',
        },
      ],
      requiredActions: ['Close the verification todo with a metric reference.'],
    });
    assert.equal((submitted.data as { status: string }).status, 'complete');
    const teamInbox = operations.execute('buddy.get_inbox');
    assert.deepEqual(
      (teamInbox.data as { reviewOutcomes: Array<{ id: string }> }).reviewOutcomes.map(
        (review) => review.id
      ),
      [reviewId]
    );

    assert.throws(
      () =>
        operations.execute('buddy.update_project', {
          projectId: operatorProject.id,
          status: 'in_progress',
        }),
      /outside the conversation scope/
    );
    assert.equal(store.listAuditEvents({ buddy: lead.id }).length, 9);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('automation-scoped operations enforce the durable allowlist and create a real approval', () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-automation-operations-'));
  const store = new BuddiesStore(':memory:');
  try {
    const workspace = store.createWorkspace({ name: 'Workspace', rootPath: root });
    const lead = store.createBuddy({
      project: workspace.id,
      name: 'Lead',
      role: 'Own outcomes',
    });
    const project = store.newProject({
      buddy: lead.id,
      workspace: workspace.id,
      title: 'Bounded launch',
      definitionOfDone: 'Human decision recorded',
    });
    const automation = store.createAutomation({
      buddy: lead.id,
      workspace: workspace.id,
      project: project.id,
      name: 'Prepare launch',
      scheduleKind: 'interval',
      scheduleExpression: '3600',
      jobKind: 'prompt',
      jobPayload: { prompt: 'Prepare the launch without publishing.' },
      policy: {
        allowedOperations: ['buddy.get_current_work', 'buddy.request_human_approval'],
      },
    });
    const run = store.claimAutomationRun(automation.id, {
      scheduledFor: '2026-07-28T00:00:00.000Z',
    });
    store.updateAutomationRun(run.id, {
      status: 'running',
      claimToken: run.claim_token,
    });
    const operations = new BuddyOperationsService(
      store as unknown as BuddiesStorePort,
      {
        buddyId: lead.id,
        workspaceId: workspace.id,
        buddyProjectId: project.id,
        automationRunId: run.id,
      },
      { automationClaimToken: run.claim_token ?? undefined }
    );

    operations.execute('buddy.get_current_work');
    const staleOperations = new BuddyOperationsService(
      store as unknown as BuddiesStorePort,
      {
        buddyId: lead.id,
        workspaceId: workspace.id,
        buddyProjectId: project.id,
        automationRunId: run.id,
      },
      { automationClaimToken: 'stale-executor' }
    );
    assert.throws(() => staleOperations.execute('buddy.get_current_work'), /claim is not owned/);
    assert.throws(
      () =>
        operations.execute('buddy.update_project', {
          projectId: project.id,
          nextAction: 'Publish now',
        }),
      /not allowed/
    );

    const requested = operations.execute('buddy.request_human_approval', {
      action: 'Publish the bounded launch',
      reason: 'The draft passed internal checks.',
      risk: 'This changes public state.',
    });
    const approval = requested.data as { id: string; status: string };
    assert.equal(approval.status, 'pending');
    assert.equal(store.listApprovalRequests({ status: 'pending' }).length, 1);
    assert.equal(
      store
        .listAuditEvents({ buddy: lead.id })
        .filter((event) => event.operation === 'buddy.request_human_approval').length,
      1
    );

    const resolved = store.resolveApprovalRequest(approval.id, {
      decision: 'approved',
      resolvedBy: 'owner',
      note: 'Approved for this bounded action only.',
    });
    assert.equal(resolved.status, 'approved');
    assert.throws(
      () =>
        store.resolveApprovalRequest(approval.id, {
          decision: 'rejected',
          resolvedBy: 'owner',
        }),
      /already approved/
    );

    store.updateAutomationRun(run.id, {
      status: 'failed',
      error: 'provider failed',
      claimToken: run.claim_token ?? undefined,
    });
    const inbox = new BuddyOperationsService(store as unknown as BuddiesStorePort, {
      buddyId: lead.id,
      workspaceId: workspace.id,
    }).execute('buddy.get_inbox');
    assert.match(JSON.stringify(inbox.data), /provider failed/);
    assert.doesNotMatch(JSON.stringify(inbox.data), /claim_token|automation_claim/);
    assert.throws(() => operations.execute('buddy.get_current_work'), /not active: failed/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('automation schedule validation leaves durable definitions unchanged on failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-automation-validation-'));
  const store = new BuddiesStore(':memory:');
  try {
    const workspace = store.createWorkspace({ name: 'Workspace', rootPath: root });
    const buddy = store.createBuddy({
      project: workspace.id,
      name: 'Scheduler',
      role: 'Own bounded schedules',
    });
    const operations = new BuddyOperationsService(store as unknown as BuddiesStorePort, {
      buddyId: buddy.id,
      workspaceId: workspace.id,
    });

    assert.throws(
      () =>
        operations.execute('buddy.set_automation', {
          action: 'create',
          name: 'Invalid interval',
          scheduleKind: 'interval',
          scheduleExpression: 'not-seconds',
          timezone: 'UTC',
          jobKind: 'prompt',
          jobPayload: { prompt: 'Never persist this.' },
        }),
      /positive seconds/
    );
    assert.deepEqual(store.listAutomations({ buddy: buddy.id }), []);

    const created = operations.execute('buddy.set_automation', {
      action: 'create',
      name: 'Valid interval',
      scheduleKind: 'interval',
      scheduleExpression: '60',
      timezone: 'UTC',
      jobKind: 'prompt',
      jobPayload: { prompt: 'Persist once.' },
    }).data as { id: string; schedule_expression: string; next_run_at: string };
    const before = store.getAutomation(created.id);
    assert.throws(
      () =>
        operations.execute('buddy.set_automation', {
          action: 'update',
          automationId: created.id,
          name: 'Must not partially update',
          scheduleExpression: '0',
        }),
      /positive seconds/
    );
    assert.deepEqual(store.getAutomation(created.id), before);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
