import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import { BUDDY_TEAM_CONTRACT_VERSION } from '@unleashd/shared';
import type {
  BuddyCapabilityDecision,
  BuddyMessage,
  BuddyMessageExecution,
  BuddyTeamCapability,
} from '@unleashd/shared';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createLegacyBuddyMcpServer as createBuddyMcpServer } from '../src/buddies/mcp-server';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { teamStore } from '../src/buddies/team-access';

test('one lead MCP onboards four existing identities, imports one, assigns and verifies bounded work without duplicate effects', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-team-mcp-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const store = teamStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'Font fixture', rootPath: root });
  const make = (name: string) =>
    raw.createBuddyFromBuilder({
      conversationId: 'setup',
      creationKey: name,
      requestFingerprint: name,
      project: w.id,
      name,
      role: name,
      soul: `Initial ${name}`,
    }).buddy;
  const lead = make('Chief');
  const specialists = [
    raw.createBuddy({ project: w.id, name: 'Pixel', role: 'Existing unconfigured specialist' }),
    ...['Path', 'Product', 'Research'].map(make),
  ];
  const context = { buddyId: lead.id, workspaceId: w.id, conversationId: 'owner-chief' };
  const service = new BuddyOperationsService(store, context);
  const server = createBuddyMcpServer(store, context, {
    dispatchMessage: async (input) => {
      const message = store.sendCoordinatedMessage(
        {
          fromBuddy: lead.id,
          workspace: w.id,
          ...input,
          parentConversationId: 'owner-chief',
          project: input.projectId,
        },
        { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
      );
      return {
        operation: 'buddy.send',
        data: { message, execution: store.getMessageExecution(message.id) },
        audit: { recordedAtomicallyByStore: true },
      };
    },
  });
  const client = new Client({ name: 'team-acceptance', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return (
      result.structuredContent as {
        data: {
          id: string;
          buddy: { id: string };
          revision: number;
          enabled: boolean;
          updated_at: string;
          preview: boolean;
          execution: BuddyMessageExecution;
          message: BuddyMessage;
          operations: Record<string, BuddyCapabilityDecision>;
          contractVersion: string;
        };
      }
    ).data;
  };
  try {
    await Promise.all([server.connect(b), client.connect(a)]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of [
      'get_capabilities',
      'create_buddy',
      'set_relationship',
      'get_profile',
      'update_profile',
      'get_memory',
    ])
      assert.ok(names.includes(name));
    const denied = await call('get_capabilities', { targetBuddyId: specialists[0].id });
    assert.equal(denied.contractVersion, BUDDY_TEAM_CONTRACT_VERSION);
    assert.equal(denied.operations.update_profile.code, 'owner_grant_required');
    assert.throws(
      () => service.execute('buddy.get_current_work', { targetBuddyId: specialists[0].id }),
      /not a direct report/
    );
    const grant = (target: string | undefined, key: string, capabilities: BuddyTeamCapability[]) =>
      store.setBuddyAccess({
        granteeId: lead.id,
        workspaceId: w.id,
        targetBuddyId: target,
        baseRevision: 0,
        key,
        reason: 'Owner authorizes fixture team',
        capabilities,
      });
    for (const target of specialists) {
      grant(target.id, `grant:${target.id}`, [
        'relationship.write',
        'profile.read',
        'profile.write',
        'memory.read',
        'memory.write',
        'soul.read',
        'soul.write',
        'execution.manage',
      ]);
      const relationship = {
        fromBuddyId: lead.id,
        toBuddyId: target.id,
        kind: 'manager',
        key: `attach:${target.id}`,
      };
      await call('set_relationship', relationship);
      await call('set_relationship', relationship);
      assert.deepEqual(await call('get_current_work', { targetBuddyId: target.id }), []);
      const profile = await call('get_profile', { targetBuddyId: target.id });
      await call('update_profile', {
        targetBuddyId: target.id,
        key: `profile:${target.id}`,
        baseRevision: profile.revision,
        reason: 'Apply handoff',
        changes: { role: 'Own bounded specialist delivery', backgroundEnabled: true },
      });
      const head = await call('get_memory', { targetBuddyId: target.id, doc: 'working' });
      const edit = {
        targetBuddyId: target.id,
        doc: 'working',
        baseVersion: head.revision,
        content: 'Evidence-backed hypothesis',
        reasoning: 'Import approved handoff',
        key: `memory:${target.id}`,
      };
      assert.equal((await call('update_memory', { ...edit, preview: true })).preview, true);
      assert.equal((await call('update_memory', edit)).revision, head.revision + 1);
      await call('update_memory', edit);
      const soul = await call('get_soul', { targetBuddyId: target.id });
      const soulEdit = {
        targetBuddyId: target.id,
        baseVersion: soul.revision,
        content: 'Deliver bounded work; external actions require separate owner approval.',
        reasoning: 'Import owner-authorized handoff',
        key: `soul:${target.id}`,
      };
      await call('update_soul', soulEdit);
      await call('update_soul', soulEdit);
      const input = {
        ownerId: target.id,
        key: `project:${target.id}`,
        title: 'Bounded research',
        definitionOfDone: 'A reviewed result with an evidence reference',
      };
      const project = await call('new_project', input);
      assert.equal((await call('new_project', input)).id, project.id);
      const send = {
        to: target.id,
        key: `dispatch:${target.id}`,
        purpose: 'Complete assigned work',
        body: 'Accept the project, deliver the result, then reply with evidence.',
        projectId: project.id,
      };
      const receipt = await call('send', send);
      assert.equal((await call('send', send)).execution.runId, receipt.execution.runId);
      const run = store.claimBuddyRun(receipt.execution.runId, {
        claimToken: target.id,
        conversationId: `thread:${target.id}`,
      })!;
      assert.ok(run);
      store.startBuddyRun(run.id, target.id);
      const worker = new BuddyOperationsService(
        store,
        {
          buddyId: target.id,
          workspaceId: w.id,
          conversationId: `thread:${target.id}`,
          coordinationRunId: run.id,
          allowedOperations: MESSAGE_BUDDY_OPERATIONS,
        },
        { automationClaimToken: target.id }
      );
      worker.execute('buddy.update_project', {
        projectId: project.id,
        key: 'accept',
        baseRevision: project.revision,
        status: 'in_progress',
      });
      const accepted = await call('get_message', { messageId: receipt.message.id });
      assert.equal(accepted.execution.acceptedBy, null);
      assert.equal(accepted.execution.projectSnapshot.acceptedBy, target.id);
      assert.ok(accepted.execution.acknowledgedAt);
      worker.execute('buddy.update_project', {
        projectId: project.id,
        key: 'complete',
        baseRevision: project.revision + 1,
        status: 'done',
        evidence: ['fixture:reviewed-result'],
      });
      worker.execute('buddy.reply', {
        messageId: receipt.message.id,
        outcome: 'complete',
        body: 'Result reviewed.',
        evidence: ['fixture:reviewed-result'],
      });
      store.finishBuddyRun(run.id, {
        claimToken: target.id,
        status: 'complete',
        outcome: 'PRIVATE_PROVIDER_OUTPUT',
      });
      const finished = await call('get_message', { messageId: receipt.message.id });
      assert.equal(finished.execution.state, 'complete');
      assert.deepEqual(finished.execution.completionEvidence, ['fixture:reviewed-result']);
    }
    raw.linkConversation({
      buddy: lead.id,
      workspace: w.id,
      provider: 'codex',
      unleashdConversationId: 'owner-chief',
    });
    const schedule = await call('set_automation', {
      action: 'create',
      key: 'check-in',
      name: 'Review results',
      scheduleKind: 'interval',
      scheduleExpression: '300',
      prompt: 'Inspect inbox and completed work; steer only when needed.',
    });
    assert.equal(schedule.enabled, false);
    const enable = {
      action: 'enable',
      automationId: schedule.id,
      key: 'enable-check-in',
      baseRevision: schedule.updated_at,
    };
    assert.equal(
      (await client.callTool({ name: 'set_automation', arguments: enable })).isError,
      true
    );
    grant(lead.id, 'schedule-access', ['schedule.manage']);
    assert.equal((await call('set_automation', enable)).enabled, true);
    assert.equal((await call('set_automation', enable)).id, schedule.id);
    const access = store.getBuddyAccess(lead.id, w.id, lead.id)!;
    store.setBuddyAccess({
      granteeId: lead.id,
      workspaceId: w.id,
      targetBuddyId: lead.id,
      capabilities: [],
      baseRevision: access.revision,
      key: 'revoke-schedule',
      reason: 'Revocation fixture',
    });
    assert.equal(
      (await client.callTool({ name: 'set_automation', arguments: enable })).isError,
      true
    );
    grant(undefined, 'staff', ['staff.create']);
    const creation = {
      key: 'fifth',
      name: 'New Specialist',
      role: 'New bounded research',
      soul: 'Use evidence; external actions need separate approval.',
    };
    const imported = await call('create_buddy', creation);
    assert.equal((await call('create_buddy', creation)).buddy.id, imported.buddy.id);
    assert.equal(raw.listBuddies().length, 6);
    assert.equal(raw.listBuddyOwnedProjects({ includeClosed: true }).length, 4);
    assert.equal(
      store.listBuddyRuns({ limit: 100 }).filter((r) => r.input_kind === 'message_request').length,
      4
    );
    const unrelated = make('Unrelated');
    const outsider = new BuddyOperationsService(store, {
      buddyId: unrelated.id,
      workspaceId: w.id,
      conversationId: 'private-reader',
    });
    store.setCoordinationMembership(unrelated.id, w.id, { read_all_work: true });
    assert.throws(
      () =>
        outsider.execute('buddy.get_memory', { targetBuddyId: specialists[0].id, doc: 'working' }),
      /No owner grant/
    );
    const message = raw.listMessages({ buddy: lead.id })[0];
    assert.throws(
      () => outsider.execute('buddy.get_message', { messageId: message.id }),
      /participant scope/
    );
    const runs = outsider.execute('buddy.get_runs', { projectId: message.buddy_project_id })
      .data as Array<{ outcome: string | null; execution: BuddyMessageExecution }>;
    assert.ok(runs.length > 0);
    assert.equal(runs[0].outcome, null);
    assert.equal(runs[0].execution, null, 'Private execution fields require message visibility');
    const requesterRuns = await call('get_runs', { projectId: message.buddy_project_id });
    assert.doesNotMatch(JSON.stringify(requesterRuns), /PRIVATE_PROVIDER_OUTPUT/);
    const old = store.getBuddyAccess(lead.id, w.id, specialists[0].id)!;
    store.setBuddyAccess({
      granteeId: lead.id,
      workspaceId: w.id,
      targetBuddyId: specialists[0].id,
      capabilities: [],
      baseRevision: old.revision,
      key: 'revoke',
      reason: 'Fixture revocation',
    });
    assert.equal(
      (await call('get_capabilities', { targetBuddyId: specialists[0].id })).operations.update_soul
        .allowed,
      false
    );
    const replay = await client.callTool({
      name: 'update_memory',
      arguments: {
        targetBuddyId: specialists[0].id,
        doc: 'working',
        baseVersion: 1,
        content: 'Evidence-backed hypothesis',
        reasoning: 'Import approved handoff',
        key: `memory:${specialists[0].id}`,
      },
    });
    assert.equal(replay.isError, true);
  } finally {
    await client.close();
    await server.close();
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
