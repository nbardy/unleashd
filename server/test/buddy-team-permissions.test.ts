import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import {
  BuddyTeamAccessViewSchema,
  type TeamConfiguration,
  TeamSetupResultSchema,
} from '@unleashd/shared';
import express from 'express';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { BuddyOperationsService } from '../src/buddies/operations';
import { registerBuddyRoutes } from '../src/buddies/routes';

test('owner team settings preserve independent saved permissions, expiry and revocation through HTTP', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-team-permissions-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const store = raw as unknown as BuddiesStorePort;
  const workspace = raw.createWorkspace({ name: 'Settings fixture', rootPath: root });
  const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Coordinate' });
  const target = raw.createBuddy({ project: workspace.id, name: 'Target', role: 'Research' });
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('Permission editing must not start work');
    },
    sendError: (response, error, status) => response.status(status).json({ error: String(error) }),
    getNextAutomationRunAt: () => '',
    createId: () => 'owner-settings-fixture',
    isConversationDeleted: async () => false,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const configure = async (key: string, configuration: TeamConfiguration) => {
    const preview = TeamSetupResultSchema.parse(
      await request('/api/buddies/team-configuration', 'POST', {
        key,
        configuration,
        preview: true,
      })
    );
    assert.deepEqual(preview.blockers, []);
    const result = TeamSetupResultSchema.parse(
      await request('/api/buddies/team-configuration', 'POST', {
        key,
        configuration,
        preview: false,
        expectedPlanHash: preview.planHash,
      })
    );
    assert.ok(result.receipt);
    return { preview, result };
  };
  const accessUrl = `/api/buddies/${lead.id}/access/${workspace.id}`;
  const currentGrant = () => raw.getBuddyAccess(lead.id, workspace.id, target.id)!;
  const capabilities = () =>
    new BuddyOperationsService(store, {
      buddyId: lead.id,
      workspaceId: workspace.id,
      conversationId: 'owner-lead',
    }).execute('buddy.get_capabilities', { targetBuddyId: target.id }).data as {
      operations: Record<string, { allowed: boolean }>;
    };
  try {
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const configuration: TeamConfiguration = {
      workspaceId: workspace.id,
      reason: 'Owner configures exact team permissions',
      access: [
        {
          grantee: { id: lead.id },
          target: { id: target.id },
          baseRevision: 0,
          relationships: true,
          profile: 'write',
          soul: 'write',
          memory: 'write',
          incoming: true,
          schedules: true,
          expiresAt,
        },
      ],
      staffing: [
        {
          grantee: { id: lead.id },
          enabled: true,
          createdBuddyIncoming: true,
          expiresAt,
          baseRevision: 0,
        },
      ],
    };
    const { preview } = await configure('all-access', configuration);
    assert.equal(preview.effects.filter((effect) => effect.resource === 'grant').length, 2);
    assert.deepEqual(currentGrant().capabilities, [
      'execution.manage',
      'memory.read',
      'memory.write',
      'profile.read',
      'profile.write',
      'relationship.write',
      'schedule.manage',
      'soul.read',
      'soul.write',
    ]);
    assert.equal(capabilities().operations.update_soul.allowed, true);
    assert.equal(capabilities().operations['update_profile.backgroundEnabled'].allowed, true);
    const staffing = raw.getBuddyAccess(lead.id, workspace.id, workspace.id)!;
    assert.deepEqual(staffing.capabilities, ['staff.create']);
    assert.equal(staffing.created_buddy_incoming, true);
    assert.equal(staffing.expires_at, expiresAt);
    assert.equal(raw.getCoordinationMembership(target.id, workspace.id)?.background_enabled, 0);

    const writeOnly: TeamConfiguration = {
      workspaceId: workspace.id,
      reason: 'Revoke reads while retaining saved write flags',
      access: [
        {
          grantee: { id: lead.id },
          target: { id: target.id },
          baseRevision: 1,
          relationships: false,
          profile: 'write_only',
          soul: 'write_only',
          memory: 'write_only',
          incoming: true,
          schedules: false,
        },
      ],
      staffing: [
        { grantee: { id: lead.id }, enabled: true, createdBuddyIncoming: false, baseRevision: 1 },
      ],
    };
    await configure('write-only', writeOnly);
    assert.deepEqual(currentGrant().capabilities, [
      'execution.manage',
      'memory.write',
      'profile.write',
      'soul.write',
    ]);
    assert.equal(currentGrant().expires_at, expiresAt, 'An omitted expiry preserves its bound');
    assert.equal(capabilities().operations.update_soul.allowed, false);
    assert.equal(capabilities().operations['update_profile.backgroundEnabled'].allowed, false);
    assert.equal(
      raw.getBuddyAccess(lead.id, workspace.id, workspace.id)!.created_buddy_incoming,
      false
    );
    const readOnly: TeamConfiguration = {
      workspaceId: workspace.id,
      reason: 'Permit reads and remove expiration',
      access: [
        {
          grantee: { id: lead.id },
          target: { id: target.id },
          profile: 'read',
          soul: 'read',
          memory: 'read',
          incoming: false,
          expiresAt: null,
          baseRevision: 2,
        },
      ],
    };
    await configure('read-only', readOnly);
    assert.deepEqual(currentGrant().capabilities, ['memory.read', 'profile.read', 'soul.read']);
    assert.equal(currentGrant().expires_at, null);
    assert.equal(capabilities().operations.get_soul.allowed, true);
    const stale = TeamSetupResultSchema.parse(
      await request('/api/buddies/team-configuration', 'POST', {
        key: 'stale',
        configuration: readOnly,
        preview: true,
      })
    );
    assert.equal(stale.canApply, false);
    assert.equal(stale.blockers[0].code, 'grant_revision_conflict');

    raw.db
      .prepare('DELETE FROM buddy_projects WHERE buddy_id=? AND project_id=?')
      .run(lead.id, workspace.id);
    const detachedDiagnostic = BuddyTeamAccessViewSchema.parse(await request(accessUrl));
    assert.equal(raw.getCoordinationMembership(lead.id, workspace.id), null);
    assert.ok(detachedDiagnostic.grants.some((row) => row.target_id === target.id));
    assert.equal(
      detachedDiagnostic.targets.find((row) => row.id === target.id)?.permissionsEditable,
      false
    );

    raw.updateBuddy(lead.id, { status: 'archived' });
    const archivedGranteeDiagnostic = BuddyTeamAccessViewSchema.parse(await request(accessUrl));
    assert.ok(archivedGranteeDiagnostic.grants.some((row) => row.target_id === target.id));
    const archivedMembership = raw.getCoordinationMembership(lead.id, workspace.id);
    assert.ok(archivedMembership);
    const genericArchivedResponse = await fetch(`${base}/api/buddies/${lead.id}`);
    assert.equal(
      genericArchivedResponse.status,
      404,
      'Generic archived Buddy routes remain hidden'
    );

    raw.updateBuddy(target.id, { status: 'archived' });
    const diagnostic = BuddyTeamAccessViewSchema.parse(await request(accessUrl));
    assert.equal(
      diagnostic.targets.find((row) => row.id === target.id)?.permissionsEditable,
      false
    );
    assert.ok(diagnostic.grants.some((row) => row.target_id === target.id));
    const revoke: TeamConfiguration = {
      workspaceId: workspace.id,
      reason: 'Revoke obsolete team permissions',
      access: [
        {
          grantee: { id: lead.id },
          target: { id: target.id },
          relationships: false,
          profile: 'none',
          soul: 'none',
          memory: 'none',
          incoming: false,
          schedules: false,
          baseRevision: 3,
        },
      ],
      staffing: [
        { grantee: { id: lead.id }, enabled: false, createdBuddyIncoming: false, baseRevision: 2 },
      ],
    };
    const revoked = await configure('revoke', revoke);
    assert.deepEqual(currentGrant().capabilities, []);
    assert.deepEqual(raw.getBuddyAccess(lead.id, workspace.id, workspace.id)!.capabilities, []);
    assert.equal(raw.getBuddy(lead.id)?.status, 'archived');
    assert.deepEqual(raw.getCoordinationMembership(lead.id, workspace.id), archivedMembership);
    const replay = TeamSetupResultSchema.parse(
      await request('/api/buddies/team-configuration', 'POST', {
        key: 'all-access',
        configuration,
        preview: false,
        expectedPlanHash: preview.planHash,
      })
    );
    assert.equal(replay.receipt?.replayed, true);
    assert.equal(replay.drift, true);
    assert.deepEqual(currentGrant().capabilities, []);
    const audit = raw.getAuditEvent(revoked.result.receipt!.auditId)!;
    const auditPayload =
      typeof audit.payload === 'string' ? JSON.parse(audit.payload) : audit.payload;
    assert.equal(auditPayload.ownerInputId, 'owner-settings-fixture');
    assert.equal(auditPayload.conversationId, null);
    const retiredRoute = await fetch(`${base}${accessUrl}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: ['soul.write'] }),
    });
    assert.equal(retiredRoute.status, 404);
    assert.equal(raw.listBuddyRuns().length, 0);
    assert.equal(raw.listAutomations({ buddy: lead.id }).length, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
