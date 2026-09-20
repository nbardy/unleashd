import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import express from 'express';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { BuddyOperationsService } from '../src/buddies/operations';
import { registerBuddyRoutes } from '../src/buddies/routes';

test('manager tools create reports without quotas, preserve retirement memory, and respect restricted assignments', () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-direct-reports-'));
  const store = new BuddiesStore(':memory:');
  try {
    const workspace = store.createWorkspace({ name: 'Work', rootPath: root });
    const manager = store.createBuddy({ project: workspace.id, name: 'Lead', role: 'Lead' });
    const context = { buddyId: manager.id, workspaceId: workspace.id };
    const port = store as unknown as BuddiesStorePort;
    const operations = new BuddyOperationsService(port, context);
    const hire = {
      key: 'researcher',
      name: 'Researcher',
      role: 'Research',
      soul: 'Research with cited evidence.',
    };
    assert.equal(manager.hire_quota, 0, 'legacy zero quota does not prevent creating reports');
    assert.throws(() => operations.execute('buddy.hire_direct_report', hire), /No owner grant/);
    store.setBuddyAccess({
      granteeId: manager.id,
      workspaceId: workspace.id,
      capabilities: ['staff.create'],
      baseRevision: 0,
      key: 'staff',
      reason: 'Owner authorizes fixture staffing',
    });
    const hired = operations.execute('buddy.hire_direct_report', hire).data as {
      buddy: { id: string; status: string };
      outcome: string;
    };
    assert.equal(hired.outcome, 'hired');
    assert.equal(existsSync(store.getBuddy(hired.buddy.id)!.soul_path!), true);
    assert.equal('hiring' in port.getBuddyTeamState(manager.id), false);
    assert.equal(port.getBuddyTeamState(hired.buddy.id).manager?.id, manager.id);
    const repeated = operations.execute('buddy.hire_direct_report', hire).data as typeof hired;
    assert.equal(repeated.buddy.id, hired.buddy.id);
    assert.equal(repeated.outcome, 'hired');
    const second = operations.execute('buddy.hire_direct_report', {
      ...hire,
      key: 'another-researcher',
      name: 'Another researcher',
    }).data as typeof hired;
    assert.equal(second.outcome, 'hired');
    assert.notEqual(second.buddy.id, hired.buddy.id);
    assert.deepEqual(
      new Set(port.getBuddyTeamState(manager.id).team.map((member) => member.id)),
      new Set([hired.buddy.id, second.buddy.id])
    );
    const restricted = new BuddyOperationsService(port, {
      ...context,
      allowedOperations: ['buddy.hire_direct_report'],
    });
    assert.throws(() => restricted.execute('buddy.hire_direct_report', hire), /restricted/);
    const access = store.getBuddyAccess(manager.id, workspace.id, hired.buddy.id)!;
    store.setBuddyAccess({
      granteeId: manager.id,
      workspaceId: workspace.id,
      targetBuddyId: hired.buddy.id,
      capabilities: ['profile.write', 'execution.manage'],
      baseRevision: access.revision,
      key: 'retirement',
      reason: 'Owner authorizes retirement and work reassignment',
    });
    store.rememberNote(hired.buddy.id, { body: 'Dataset requires attribution.', topic: 'dataset' });
    const project = store.newProject({
      buddy: hired.buddy.id,
      workspace: workspace.id,
      title: 'Dataset review',
      definitionOfDone: 'Attribution verified',
    });
    assert.throws(
      () =>
        operations.execute('buddy.retire_direct_report', {
          buddyId: hired.buddy.id,
          reason: 'Consolidate work',
        }),
      /open project/
    );
    const retired = operations.execute('buddy.retire_direct_report', {
      buddyId: hired.buddy.id,
      reason: 'Consolidate work',
      reassignOpenWorkToManager: true,
    }).data as { buddy: { status: string }; reassignedProjects: number };
    assert.equal(retired.buddy.status, 'archived');
    assert.equal(retired.reassignedProjects, 1);
    assert.equal(store.getBuddyProject(project.id)?.buddy_id, manager.id);
    assert.equal(
      port.getBuddyTeamState(manager.id).team.find((member) => member.id === hired.buddy.id)
        ?.status,
      'archived'
    );
    assert.throws(
      () => operations.execute('buddy.hire_direct_report', hire),
      /not active|inactive/i
    );
    assert.equal(
      store.getBuddy(hired.buddy.id)?.status,
      'archived',
      'setup replay does not undo retirement'
    );
    assert.equal(store.recall(hired.buddy.id, { pattern: 'attribution' }).matches.length, 1);
    store.updateBuddy(manager.id, { status: 'paused' });
    assert.throws(
      () =>
        operations.execute('buddy.retire_direct_report', {
          buddyId: hired.buddy.id,
          reason: 'Stop',
        }),
      /active manager/
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('owner profile rejects obsolete quotas and detail exposes canonical reporting relationships', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-report-routes-'));
  const store = new BuddiesStore(':memory:');
  const workspace = store.createWorkspace({ name: 'Work', rootPath: root });
  const manager = store.createBuddy({
    project: workspace.id,
    name: 'Manager',
    role: 'Manage',
    provider: 'codex',
  });
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store as unknown as BuddiesStorePort,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('not used');
    },
    sendError: (response, error, status) => {
      response.status(status).json({ error: String(error) });
    },
    getNextAutomationRunAt: () => '2026-09-09T00:00:00Z',
    createId: () => 'unused',
    isConversationDeleted: async () => false,
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/buddies/${manager.id}`;
    const patch = (hireQuota?: number) =>
      fetch(`${endpoint}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'codex', hireQuota }),
      });
    const obsoleteQuota = await patch(2);
    assert.equal(obsoleteQuota.status, 400);
    assert.match(((await obsoleteQuota.json()) as { error: string }).error, /no longer used/);
    assert.equal((await patch(0)).status, 400);
    assert.equal((await patch()).status, 200, 'execution profile remains editable without quotas');
    assert.equal(store.getBuddy(manager.id)?.hire_quota, 0);
    const operations = new BuddyOperationsService(store as unknown as BuddiesStorePort, {
      buddyId: manager.id,
      workspaceId: workspace.id,
    });
    store.setBuddyAccess({
      granteeId: manager.id,
      workspaceId: workspace.id,
      capabilities: ['staff.create'],
      baseRevision: 0,
      key: 'staff',
      reason: 'Owner authorizes fixture staffing',
    });
    const hired = operations.execute('buddy.hire_direct_report', {
      key: 'analyst',
      name: 'Analyst',
      role: 'Analyze',
      soul: 'Use evidence.',
    }).data as { buddy: { id: string } };
    const response = await fetch(endpoint);
    assert.equal(response.status, 200);
    const detail = (await response.json()) as {
      team: Array<{ id: string }>;
      employment: unknown;
      manager: unknown;
    };
    assert.equal('hiring' in detail, false);
    assert.deepEqual(detail.employment, { kind: 'top_level' });
    assert.equal(detail.manager, null);
    assert.deepEqual(
      detail.team.map((member) => member.id),
      [hired.buddy.id]
    );
    const reportResponse = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/buddies/${hired.buddy.id}`
    );
    assert.equal(reportResponse.status, 200);
    const reportDetail = (await reportResponse.json()) as {
      employment: unknown;
      manager: { id: string };
    };
    assert.equal('hiring' in reportDetail, false);
    assert.deepEqual(reportDetail.employment, { kind: 'direct_report', managerId: manager.id });
    assert.equal(reportDetail.manager.id, manager.id);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
