import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import {
  type BuddyContext,
  type ConfigureTeamInput,
  type TeamSetupResult,
  formatTeamConfigurationProposal,
} from '@unleashd/shared';
import express from 'express';
import type { BuddiesStorePort } from '../src/buddies/contract';
import {
  BUDDY_CONTROL_TOKEN_ENV,
  BuddyControlServer,
  OWNER_CONTROL_TOKEN_ENV,
  OWNER_CONTROL_URL_ENV,
} from '../src/buddies/control-server';
import { createOwnerTeamMcpServer } from '../src/buddies/owner-mcp';
import type { OwnerTurnInput } from '../src/buddies/owner-team-configuration';
import { registerBuddyRoutes } from '../src/buddies/routes';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'buddy-owner-authority-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const workspace = raw.createWorkspace({ name: 'Font fixture', rootPath: root });
  const lead = raw.createBuddy({ project: workspace.id, name: 'Chief', role: 'Coordinate' });
  const pixel = raw.createBuddy({ project: workspace.id, name: 'Pixel', role: 'Research' });
  const context: BuddyContext = {
    buddyId: lead.id,
    workspaceId: workspace.id,
    buddyProjectId: null,
    legacyWorkItemId: null,
    automationRunId: null,
    delegatedByBuddyId: null,
    parentBuddyConversationId: null,
  };
  const input: ConfigureTeamInput = {
    key: 'configure-existing',
    preview: true,
    configuration: {
      workspaceId: workspace.id,
      reason: 'Owner asks to coordinate existing research team',
      relationships: [
        { from: { id: lead.id }, to: { id: pixel.id }, kind: 'manager', present: true },
      ],
      memberships: [lead, pixel].map((buddy) => ({
        buddy: { id: buddy.id },
        present: true,
        incoming: true,
      })),
      access: [{ grantee: { id: lead.id }, target: { id: pixel.id }, incoming: true }],
    },
  };
  return {
    root,
    raw,
    workspace,
    lead,
    pixel,
    context,
    input,
    close() {
      raw.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function post(url: string, token: string, input: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { data: TeamSetupResult; error?: string; code?: string };
  return { status: response.status, body };
}

test('owner MCP uses a real active-turn capability and rejects employee, maintenance, stale, spoofed and foreign scopes', async () => {
  const f = fixture();
  const active = new Set(['owner-chat', 'employee-chat']);
  const control = new BuddyControlServer({
    getStore: async () => f.raw as unknown as BuddiesStorePort,
    isConversationActive: (id) => active.has(id),
    dispatchDelegation: async () => {
      throw new Error('Unexpected dispatch');
    },
    dispatchReview: async () => {
      throw new Error('Unexpected dispatch');
    },
  });
  await control.start();
  const env = control.issueOwner(
    { origin: 'owner_input', inputId: 'owner-input-1' },
    'owner-chat',
    [f.workspace.id]
  );
  const url = env[OWNER_CONTROL_URL_ENV];
  const owner = env[OWNER_CONTROL_TOKEN_ENV];
  const mcp = createOwnerTeamMcpServer(async (input) => {
    const result = await post(url, owner, input);
    if (result.status !== 200)
      throw Object.assign(new Error(result.body.error), { code: result.body.code });
    return result.body.data;
  });
  const client = new Client({ name: 'owner-authority-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([mcp.connect(b), client.connect(a)]);
    const schema = (await client.listTools()).tools.find(
      (tool) => tool.name === 'configure_team'
    )!.inputSchema;
    for (const field of ['key', 'configuration', 'preview', 'expectedPlanHash'])
      assert.ok(schema.properties?.[field]);
    for (const origin of ['buddy_message', 'schedule', 'maintenance', 'unknown'])
      assert.throws(
        () =>
          control.issueOwner({ origin, inputId: 'forged' } as OwnerTurnInput, 'owner-chat', [
            f.workspace.id,
          ]),
        /provenance/
      );
    const employee = control.issue(f.context, 'employee-chat');
    const resourceUrl = url.replace('/team-configuration', '/resource');
    const resourceInput = {
      operation: 'get_document',
      input: { workspaceId: f.workspace.id, ref: { targetBuddyId: f.pixel.id, kind: 'working' } },
    };
    assert.equal((await post(resourceUrl, owner, resourceInput)).status, 200);
    assert.equal(
      (await post(resourceUrl, employee[BUDDY_CONTROL_TOKEN_ENV], resourceInput)).status,
      403
    );
    assert.equal((await post(url, employee[BUDDY_CONTROL_TOKEN_ENV], f.input)).status, 403);
    assert.equal(
      (await post(url, 'forged-token', { ...f.input, actor: 'owner', origin: 'owner_input' }))
        .status,
      403
    );
    const maintenance = control.issueMemoryReview(() => {
      throw new Error('Unexpected memory call');
    }, new AbortController().signal);
    assert.equal(
      (await post(url, maintenance.env.UNLEASHD_MEMORY_REVIEW_TOKEN, f.input)).status,
      403
    );
    const foreignRoot = join(f.root, 'foreign');
    mkdirSync(foreignRoot);
    const foreign = f.raw.createWorkspace({ name: 'Foreign', rootPath: foreignRoot });
    assert.equal(
      (
        await post(url, owner, {
          ...f.input,
          configuration: { ...f.input.configuration, workspaceId: foreign.id },
        })
      ).body.code,
      'OWNER_SCOPE_DENIED'
    );
    assert.equal(
      (await client.callTool({ name: 'configure_team', arguments: { ...f.input, preview: false } }))
        .isError,
      true
    );
    assert.equal(
      (await client.callTool({ name: 'configure_team', arguments: { ...f.input, actor: 'owner' } }))
        .isError,
      true
    );
    const preview = await client.callTool({ name: 'configure_team', arguments: f.input });
    assert.equal(preview.isError, undefined, JSON.stringify(preview));
    const plan = (preview.structuredContent as { teamSetup: TeamSetupResult }).teamSetup;
    assert.equal(plan.canApply, true);
    assert.equal(f.raw.isCoordinationManager(f.lead.id, f.pixel.id), false);
    const applied = await client.callTool({
      name: 'configure_team',
      arguments: { ...f.input, preview: false, expectedPlanHash: plan.planHash },
    });
    assert.equal(applied.isError, undefined, JSON.stringify(applied));
    assert.equal(f.raw.isCoordinationManager(f.lead.id, f.pixel.id), true);
    assert.equal(
      f.raw.getCoordinationMembership(f.pixel.id, f.workspace.id)?.background_enabled,
      1
    );
    assert.deepEqual(f.raw.getBuddyAccess(f.lead.id, f.workspace.id, f.pixel.id)?.capabilities, [
      'execution.manage',
      'profile.read',
    ]);
    control.revoke('owner-chat');
    assert.equal(
      (
        await client.callTool({
          name: 'configure_team',
          arguments: { ...f.input, preview: false, expectedPlanHash: plan.planHash },
        })
      ).isError,
      true,
      'Retained MCP catalog cannot reuse revoked owner authority'
    );
    const refreshed = control.issueOwner(
      { origin: 'owner_input', inputId: 'owner-input-2' },
      'owner-chat',
      [f.workspace.id]
    );
    active.delete('owner-chat');
    assert.equal((await post(url, refreshed[OWNER_CONTROL_TOKEN_ENV], f.input)).status, 403);
  } finally {
    await client.close();
    await mcp.close();
    await control.close();
    f.close();
  }
});

test('cancellation while owner control awaits the store fences the configuration commit', async () => {
  const f = fixture();
  let gated = false;
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const control = new BuddyControlServer({
    getStore: async () => {
      if (gated) {
        entered();
        await gate;
      }
      return f.raw as unknown as BuddiesStorePort;
    },
    isConversationActive: () => true,
    dispatchDelegation: async () => {
      throw new Error('Unexpected dispatch');
    },
    dispatchReview: async () => {
      throw new Error('Unexpected dispatch');
    },
  });
  await control.start();
  try {
    const env = control.issueOwner({ origin: 'owner_input', inputId: 'owner-race' }, 'owner-chat', [
      f.workspace.id,
    ]);
    const preview = await post(env[OWNER_CONTROL_URL_ENV], env[OWNER_CONTROL_TOKEN_ENV], f.input);
    assert.equal(preview.status, 200, JSON.stringify(preview));
    gated = true;
    const pending = post(env[OWNER_CONTROL_URL_ENV], env[OWNER_CONTROL_TOKEN_ENV], {
      ...f.input,
      preview: false,
      expectedPlanHash: preview.body.data.planHash,
    });
    await reached;
    control.revoke('owner-chat');
    release();
    assert.equal((await pending).body.code, 'OWNER_CONTROL_REVOKED');
    assert.equal(f.raw.isCoordinationManager(f.lead.id, f.pixel.id), false);
    assert.equal(f.raw.getBuddyAccess(f.lead.id, f.workspace.id, f.pixel.id), null);
    assert.equal(
      f.raw.getCoordinationMembership(f.pixel.id, f.workspace.id)?.background_enabled,
      0
    );
  } finally {
    release();
    await control.close();
    f.close();
  }
});

test('legacy Builder control requires a host-issued full owner Builder turn and revokes writes after drain', async () => {
  const f = fixture();
  const control = new BuddyControlServer({
    getStore: async () => f.raw as unknown as BuddiesStorePort,
    isConversationActive: () => true,
    dispatchDelegation: async () => {
      throw new Error('Unexpected dispatch');
    },
    dispatchReview: async () => {
      throw new Error('Unexpected dispatch');
    },
  });
  await control.start();
  try {
    const input = {
      operation: 'create_buddy',
      input: {
        workspaceId: f.workspace.id,
        creationKey: 'new-specialist',
        name: 'New specialist',
        role: 'Research',
        soul: 'Bounded research only',
      },
    };
    const exact = control.issueOwner(
      { origin: 'owner_input', inputId: 'exact' },
      'builder',
      [f.workspace.id],
      undefined,
      true
    );
    const endpoint = exact[OWNER_CONTROL_URL_ENV].replace(
      '/team-configuration',
      '/builder-operation'
    );
    assert.equal(
      (await post(endpoint, exact[OWNER_CONTROL_TOKEN_ENV], input)).body.code,
      'OWNER_BUILDER_SCOPE_REQUIRED',
      'An exact scope does not gain legacy full-owner Builder access'
    );
    const lead = control.issueOwner(
      { origin: 'owner_input', inputId: 'lead' },
      'lead-chat',
      [f.workspace.id],
      () => f.raw.listWorkspaces().map((workspace) => workspace.id)
    );
    assert.equal(
      (await post(endpoint, lead[OWNER_CONTROL_TOKEN_ENV], input)).body.code,
      'OWNER_BUILDER_SCOPE_REQUIRED',
      'A lead owner turn cannot enter the legacy Builder endpoint'
    );
    const full = control.issueOwner(
      { origin: 'owner_input', inputId: 'full-builder' },
      'builder',
      [f.workspace.id],
      () => f.raw.listWorkspaces().map((workspace) => workspace.id),
      true
    );
    const created = await post(endpoint, full[OWNER_CONTROL_TOKEN_ENV], input);
    assert.equal(created.status, 200, JSON.stringify(created));
    assert.equal(f.raw.listBuddies().length, 3, JSON.stringify(created));
    assert.equal((await post(endpoint, full[OWNER_CONTROL_TOKEN_ENV], input)).status, 200);
    assert.equal(f.raw.listBuddies().length, 3, 'Builder replay preserves the one identity');
    control.revoke('builder');
    const revoked = await post(endpoint, full[OWNER_CONTROL_TOKEN_ENV], {
      ...input,
      input: { ...input.input, creationKey: 'must-not-create', name: 'Forbidden new hire' },
    });
    assert.equal(revoked.status, 403);
    assert.equal(f.raw.listBuddies().length, 3);
  } finally {
    await control.close();
    f.close();
  }
});

test('owner proposal HTTP applies its exact attachment and repairs interrupted acknowledgement on replay', async () => {
  const f = fixture();
  const proposal = { key: f.input.key, configuration: f.input.configuration };
  const message = f.raw.sendCoordinatedMessage(
    {
      fromBuddy: f.lead.id,
      to: 'owner',
      workspace: f.workspace.id,
      parentConversationId: 'owner-chat',
      purpose: 'team_setup',
      body: formatTeamConfigurationProposal('Configure this team.', proposal),
      key: 'setup-proposal',
    },
    { policy: { allowed_operations: ['buddy.get_current_work', 'buddy.reply'] } }
  );
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => f.raw as unknown as BuddiesStorePort,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('Configuration must not create provider work');
    },
    sendError(response, error, status) {
      response.status(status).json({ error: String(error) });
    },
    getNextAutomationRunAt: () => '',
    createId: () => 'owner-http-input',
    isConversationDeleted: async () => false,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/buddies/messages/${message.id}/team-configuration`;
  const request = async (input: unknown) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return { status: response.status, body: (await response.json()) as TeamSetupResult };
  };
  const originalReply = f.raw.replyToOwnerMessage;
  try {
    const preview = await request({ preview: true });
    assert.equal(preview.status, 200, JSON.stringify(preview));
    assert.equal(f.raw.getMessage(message.id)?.status, 'pending');
    // A single failure at the post-commit effect boundary reproduces response/acknowledgement loss.
    f.raw.replyToOwnerMessage = () => {
      throw new Error('Injected acknowledgement interruption');
    };
    const input = { preview: false, expectedPlanHash: preview.body.planHash };
    const interrupted = await request(input);
    assert.equal(interrupted.status, 400);
    assert.equal(
      f.raw.isCoordinationManager(f.lead.id, f.pixel.id),
      true,
      JSON.stringify({ interrupted, preview })
    );
    assert.equal(f.raw.getMessage(message.id)?.status, 'pending');
    f.raw.replyToOwnerMessage = originalReply;
    const repaired = await request(input);
    assert.equal(repaired.status, 200, JSON.stringify(repaired));
    assert.equal(repaired.body.receipt?.replayed, true);
    assert.equal(f.raw.getMessage(message.id)?.status, 'replied');
    assert.deepEqual(f.raw.getMessage(message.id)?.reply_evidence, [
      repaired.body.receipt?.auditId,
    ]);
    const replay = await request(input);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.receipt?.auditId, repaired.body.receipt?.auditId);
    assert.equal(
      f.raw.listBuddyRuns({ rootMessageId: message.id }).length,
      1,
      'One restricted result return, no worker duplicates'
    );
    const rejectedProposal = f.raw.sendCoordinatedMessage(
      {
        fromBuddy: f.lead.id,
        to: 'owner',
        workspace: f.workspace.id,
        parentConversationId: 'owner-chat',
        purpose: 'team_setup',
        body: formatTeamConfigurationProposal('Remove the reporting edge.', {
          key: 'rejected-configuration',
          configuration: {
            ...f.input.configuration,
            relationships: [
              { from: { id: f.lead.id }, to: { id: f.pixel.id }, kind: 'manager', present: false },
            ],
          },
        }),
        key: 'rejected-proposal',
      },
      { policy: { allowed_operations: ['buddy.get_current_work'] } }
    );
    f.raw.replyToOwnerMessage(rejectedProposal.id, {
      outcome: 'rejected',
      body: 'Keep the reporting relationship.',
      evidence: ['Owner rejection'],
    });
    const closed = await fetch(url.replace(message.id, rejectedProposal.id), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preview: true }),
    });
    assert.equal(closed.status, 400);
    assert.equal(
      f.raw.isCoordinationManager(f.lead.id, f.pixel.id),
      true,
      'Rejected proposals cannot be applied through the attachment route'
    );
  } finally {
    f.raw.replyToOwnerMessage = originalReply;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.close();
  }
});
