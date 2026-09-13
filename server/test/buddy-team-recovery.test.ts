import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddyMessageExecution, TeamSetupResult } from '@unleashd/shared';
import express from 'express';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createLegacyBuddyMcpServer as createBuddyMcpServer } from '../src/buddies/mcp-server';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { registerBuddyRoutes } from '../src/buddies/routes';
import { teamStore } from '../src/buddies/team-access';

test('runtime diagnostics survive package mismatch; owner controls release the original two requests', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-team-recovery-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const store = teamStore(raw as unknown as BuddiesStorePort);
  const workspace = raw.createWorkspace({ name: 'Font fixture', rootPath: root });
  const chief = raw.createBuddy({ project: workspace.id, name: 'Chief', role: 'Coordinate' });
  const targets = ['Pixel', 'Path'].map((name) =>
    raw.createBuddy({ project: workspace.id, name, role: 'Read only audit' })
  );
  const outsider = raw.createBuddy({
    project: workspace.id,
    name: 'Unrelated',
    role: 'Other work',
  });
  const context = { buddyId: chief.id, workspaceId: workspace.id, conversationId: 'owner-chief' };
  const messages = targets.map((target) =>
    store.sendCoordinatedMessage(
      {
        fromBuddy: chief.id,
        to: target.id,
        workspace: workspace.id,
        parentConversationId: context.conversationId,
        purpose: 'audit',
        body: 'Read only audit. No training, spending, external actions or schedules.',
        key: `audit:${target.id}`,
      },
      { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
    )
  );
  const runIds = messages.map((message) => store.getMessageExecution(message.id).runId!);
  const mcp = createBuddyMcpServer(store, context);
  const client = new Client({ name: 'recovery-fixture', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('Provider execution is driven explicitly by this fixture');
    },
    sendError(response, error, status) {
      response.status(status).json({ error: String(error) });
    },
    getNextAutomationRunAt: () => null,
    createId: () => 'fixture-id',
    isConversationDeleted: async () => false,
  });
  const http = app.listen(0, '127.0.0.1');
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return (
      result.structuredContent as {
        data: {
          contract: { compatible: boolean; code: string | null; packageVersion: string | null };
          ownerSetupUrl: string;
          execution: BuddyMessageExecution;
          operations: Record<string, { allowed: boolean }>;
        };
      }
    ).data;
  };
  try {
    await Promise.all([
      mcp.connect(b),
      client.connect(a),
      new Promise<void>((resolve) => http.once('listening', resolve)),
    ]);
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const request = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    };
    const contractMethod = raw.getTeamContractVersion;
    Object.defineProperty(raw, 'getTeamContractVersion', { value: undefined, configurable: true });
    const unavailable = await call('get_capabilities', { targetBuddyId: targets[0].id });
    assert.equal(unavailable.contract.compatible, false);
    assert.equal(unavailable.contract.code, 'TEAM_CONTRACT_UNAVAILABLE');
    assert.equal(unavailable.contract.packageVersion, null);
    assert.match(unavailable.ownerSetupUrl, /\/settings\?workspaceId=/);
    const unknown = await call('get_message', { messageId: messages[0].id });
    assert.equal(unknown.execution.messageId, messages[0].id);
    assert.equal(unknown.execution.state, 'unknown');
    assert.equal(unknown.execution.code, 'TEAM_CONTRACT_UNAVAILABLE');
    assert.equal(
      (
        await client.callTool({
          name: 'set_relationship',
          arguments: {
            key: 'blocked',
            fromBuddyId: chief.id,
            toBuddyId: targets[0].id,
            kind: 'manager',
          },
        })
      ).isError,
      true
    );
    assert.throws(
      () =>
        new BuddyOperationsService(store, { ...context, buddyId: outsider.id }).execute(
          'buddy.get_message',
          { messageId: messages[0].id }
        ),
      /outside participant scope/
    );
    const ownerUnknown = await request(`/api/buddies/messages?buddyId=${chief.id}`);
    assert.equal(ownerUnknown.length, 2);
    assert.equal(ownerUnknown[0].execution.state, 'unknown');
    Object.defineProperty(raw, 'getTeamContractVersion', {
      value: () => '2026-09-10.1',
      configurable: true,
    });
    assert.equal((await call('get_capabilities')).contract.code, 'TEAM_CONTRACT_MISMATCH');
    Object.defineProperty(raw, 'getTeamContractVersion', {
      value: contractMethod,
      configurable: true,
    });
    assert.equal((await call('get_capabilities')).contract.compatible, true);
    for (const [index, target] of targets.entries()) {
      assert.equal(
        (await call('get_message', { messageId: messages[index].id })).execution.code,
        'background_disabled'
      );
      const attach = { managerId: chief.id, key: `attach:${target.id}` };
      await request(`/api/buddies/${target.id}/reparent`, 'POST', attach);
      await request(`/api/buddies/${target.id}/reparent`, 'POST', attach);
      const grant = {
        key: `review:${target.id}`,
        configuration: {
          workspaceId: workspace.id,
          reason: 'Owner authorizes team review; writes and private memory remain separate',
          access: [
            {
              grantee: { id: chief.id },
              target: { id: target.id },
              relationships: true,
              profile: 'read',
              soul: 'read',
              baseRevision: 0,
            },
          ],
        },
      };
      const preview = (await request('/api/buddies/team-configuration', 'POST', {
        ...grant,
        preview: true,
      })) as TeamSetupResult;
      const apply = { ...grant, preview: false, expectedPlanHash: preview.planHash };
      assert.ok((await request('/api/buddies/team-configuration', 'POST', apply)).receipt);
      assert.equal(
        (await request('/api/buddies/team-configuration', 'POST', apply)).receipt.replayed,
        true
      );
      const capabilities = await call('get_capabilities', { targetBuddyId: target.id });
      assert.equal(capabilities.operations.get_soul.allowed, true);
      assert.equal(capabilities.operations.update_soul.allowed, false);
      assert.equal(capabilities.operations.get_memory.allowed, false);
      assert.equal(capabilities.operations['update_profile.backgroundEnabled'].allowed, false);
      await request(`/api/buddies/${target.id}/memberships/${workspace.id}`, 'PATCH', {
        background_enabled: true,
      });
      await request(`/api/buddies/${target.id}/memberships/${workspace.id}`, 'PATCH', {
        background_enabled: true,
      });
      const enabled = await call('get_message', { messageId: messages[index].id });
      assert.equal(enabled.execution.runId, runIds[index]);
      assert.equal(enabled.execution.code, 'awaiting_admission');
      assert.equal(enabled.execution.acknowledgedAt, null);
      const token = `claim:${target.id}`;
      assert.ok(
        store.claimBuddyRun(runIds[index], {
          claimToken: token,
          conversationId: `audit:${target.id}`,
        })
      );
      store.startBuddyRun(runIds[index], token);
      assert.equal(
        (await call('get_message', { messageId: messages[index].id })).execution.state,
        'running'
      );
      const recipient = new BuddyOperationsService(
        store,
        {
          buddyId: target.id,
          workspaceId: workspace.id,
          conversationId: `audit:${target.id}`,
          coordinationRunId: runIds[index],
          allowedOperations: MESSAGE_BUDDY_OPERATIONS,
        },
        { automationClaimToken: token }
      );
      recipient.execute('buddy.reply', {
        messageId: messages[index].id,
        outcome: 'complete',
        body: 'Read only findings reviewed.',
        evidence: ['fixture:audit'],
      });
      store.finishBuddyRun(runIds[index], { claimToken: token, status: 'complete' });
      const complete = await call('get_message', { messageId: messages[index].id });
      assert.equal(complete.execution.state, 'complete');
      assert.ok(complete.execution.acknowledgedAt);
      assert.equal(store.listBuddyRuns({ buddyId: target.id }).length, 1);
      assert.equal(raw.listAutomations({ buddy: target.id }).length, 0);
    }
    const access = await request(`/api/buddies/${chief.id}/access/${workspace.id}`);
    for (const target of targets) {
      const item = access.targets.find((item: { id: string }) => item.id === target.id);
      assert.equal(item.managerId, chief.id);
      assert.equal(item.backgroundEnabled, true);
    }
    assert.equal(raw.listBuddies().length, 4);
    assert.equal(raw.listMessages({ fromBuddy: chief.id }).length, 2);
  } finally {
    await client.close();
    await mcp.close();
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve()))
    );
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
