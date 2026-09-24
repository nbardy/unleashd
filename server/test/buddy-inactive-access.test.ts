import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import {
  BuddyInactiveAccessSchema,
  BuddyTeamAccessViewSchema,
  type TeamConfiguration,
  TeamSetupResultSchema,
} from '@unleashd/shared';
import express from 'express';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { registerBuddyRoutes } from '../src/buddies/routes';

// Before the inventory, a grant held by an archived or detached grantee was
// revocable only if the owner already knew the (grantee, target) pair: archived
// Buddies 404 on every generic route and BuddyCoordination lists current
// memberships only. This drives the discover → open → revoke path the owner UI
// takes, and pins that the read never writes and revocation never widens access.
test('inactive-access inventory finds archived, detached and former-target grants; revocation empties it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-inactive-access-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const store = raw as unknown as BuddiesStorePort;
  const workspace = raw.createWorkspace({ name: 'Inventory fixture', rootPath: root });
  const make = (name: string) =>
    raw.createBuddy({ project: workspace.id, name, role: 'Fixture role' });
  const lead = make('Lead');
  const report = make('Report');
  const archivedLead = make('Archived lead');
  const detachedLead = make('Detached lead');
  const formerReport = make('Former report');
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('Reading or revoking access must not start work');
    },
    sendError: (response, error, status) => response.status(status).json({ error: String(error) }),
    getNextAutomationRunAt: () => '',
    createId: () => 'inventory-fixture',
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
    const applied = TeamSetupResultSchema.parse(
      await request('/api/buddies/team-configuration', 'POST', {
        key,
        configuration,
        preview: false,
        expectedPlanHash: preview.planHash,
      })
    );
    assert.ok(applied.receipt);
  };
  const inventoryUrl = `/api/buddies/workspaces/${workspace.id}/inactive-access`;
  const inventory = async () => BuddyInactiveAccessSchema.parse(await request(inventoryUrl));
  const grantRows = () =>
    raw.db
      .prepare('SELECT * FROM buddy_access_grants ORDER BY grantee_id, target_id')
      .all() as unknown[];
  const auditCount = () =>
    (raw.db.prepare('SELECT COUNT(*) AS n FROM buddy_audit_events').get() as { n: number }).n;
  const read = (grantee: string, target: string) => ({
    grantee: { id: grantee },
    target: { id: target },
    profile: 'read' as const,
    relationships: true,
    baseRevision: 0,
  });
  try {
    await configure('grant', {
      workspaceId: workspace.id,
      reason: 'Fixture grants while everyone is an active member',
      access: [
        read(lead.id, report.id),
        read(archivedLead.id, report.id),
        read(lead.id, formerReport.id),
      ],
      staffing: [
        {
          grantee: { id: detachedLead.id },
          enabled: true,
          createdBuddyIncoming: false,
          baseRevision: 0,
        },
      ],
    });
    assert.deepEqual((await inventory()).entries, [], 'Grants between members are not listed');

    raw.updateBuddy(archivedLead.id, { status: 'archived' });
    raw.updateBuddy(formerReport.id, { status: 'archived' });
    raw.db
      .prepare('DELETE FROM buddy_projects WHERE buddy_id=? AND project_id=?')
      .run(detachedLead.id, workspace.id);
    const archivedMembership = raw.getCoordinationMembership(archivedLead.id, workspace.id);
    assert.ok(archivedMembership, 'Archiving keeps the membership row');

    const before = { grants: grantRows(), audits: auditCount() };
    const found = await inventory();
    assert.deepEqual(
      { grants: grantRows(), audits: auditCount() },
      before,
      'The read writes nothing'
    );
    assert.equal(found.omitted, 0);
    const shape = found.entries
      .map(({ grantee, target }) => ({
        grantee: `${grantee.name}:${grantee.standing}`,
        target: target.kind === 'workspace' ? 'workspace' : `${target.name}:${target.standing}`,
      }))
      .sort((a, b) => a.grantee.localeCompare(b.grantee) || a.target.localeCompare(b.target));
    assert.deepEqual(shape, [
      { grantee: 'Archived lead:archived', target: 'Report:member' },
      { grantee: 'Detached lead:detached', target: 'workspace' },
      { grantee: 'Lead:member', target: 'Former report:archived' },
    ]);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${base}${inventoryUrl}`, { method });
      assert.equal(response.status, 404, `${method} has no route`);
    }

    // Each entry opens the per-grantee access read (the UI's settings panel) and
    // revokes through the unchanged preview/apply at the grant's own revision.
    for (const { grant } of found.entries) {
      const opened = BuddyTeamAccessViewSchema.parse(
        await request(`/api/buddies/${grant.grantee_id}/access/${workspace.id}`)
      );
      assert.ok(opened.grants.some((row) => row.target_id === grant.target_id));
      await configure(`revoke:${grant.grantee_id}:${grant.target_id}`, {
        workspaceId: workspace.id,
        reason: 'Revoke access held outside the team',
        ...(grant.target_id === workspace.id
          ? {
              staffing: [
                {
                  grantee: { id: grant.grantee_id },
                  enabled: false,
                  createdBuddyIncoming: false,
                  baseRevision: grant.revision,
                },
              ],
            }
          : {
              access: [
                {
                  grantee: { id: grant.grantee_id },
                  target: { id: grant.target_id },
                  profile: 'none',
                  soul: 'none',
                  memory: 'none',
                  relationships: false,
                  incoming: false,
                  schedules: false,
                  baseRevision: grant.revision,
                },
              ],
            }),
      });
      assert.deepEqual(
        raw.getBuddyAccess(grant.grantee_id, workspace.id, grant.target_id)!.capabilities,
        []
      );
    }

    assert.deepEqual((await inventory()).entries, []);
    assert.deepEqual(raw.getBuddyAccess(lead.id, workspace.id, report.id)!.capabilities, [
      'profile.read',
      'relationship.write',
    ]);
    // Revocation left every standing exactly where it was: nothing re-joined.
    assert.equal(raw.getBuddy(archivedLead.id)?.status, 'archived');
    assert.equal(raw.getBuddy(formerReport.id)?.status, 'archived');
    assert.deepEqual(
      raw.getCoordinationMembership(archivedLead.id, workspace.id),
      archivedMembership
    );
    assert.equal(raw.getCoordinationMembership(detachedLead.id, workspace.id), null);
    assert.equal(raw.listBuddyRuns().length, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
