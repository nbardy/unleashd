import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import {
  BUDDY_TEAM_CONTRACT_VERSION,
  type BuddyCapabilityDecision,
  parseTeamConfigurationProposal,
} from '@unleashd/shared';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createLegacyBuddyMcpServer as createBuddyMcpServer } from '../src/buddies/mcp-server';
import { type BuddyOperationContext, BuddyOperationsService } from '../src/buddies/operations';

async function fixture(overrides: Partial<BuddyOperationContext> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'buddy-employee-contracts-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const workspace = raw.createWorkspace({ name: 'Primary', rootPath: root });
  const lead = raw.createBuddyFromBuilder({
    project: workspace.id,
    conversationId: 'setup',
    creationKey: 'chief',
    requestFingerprint: 'chief',
    name: 'Chief',
    role: 'Coordinate',
    soul: 'Chief soul',
  }).buddy;
  const context = {
    buddyId: lead.id,
    workspaceId: workspace.id,
    conversationId: 'owner-chief',
    ...overrides,
  };
  const server = createBuddyMcpServer(raw as unknown as BuddiesStorePort, context, {
    dispatchMessage: async (input) => {
      // Match the real transport's second preparation and prove attachment encoding is idempotent.
      const { parentConversationId: _parent, ...body } = input;
      const prepared = new BuddyOperationsService(
        raw as unknown as BuddiesStorePort,
        context
      ).prepareMessage(body);
      const message = raw.sendCoordinatedMessage(
        {
          ...prepared,
          fromBuddy: lead.id,
          workspace: context.workspaceId,
          project: prepared.projectId,
        },
        { policy: { allowed_operations: ['buddy.get_current_work', 'buddy.reply'] } }
      );
      return {
        operation: 'buddy.send',
        data: { message },
        audit: { recordedAtomicallyByStore: true },
      };
    },
  });
  const client = new Client({ name: 'employee-contract-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  return {
    root,
    raw,
    workspace,
    lead,
    client,
    context,
    async call<T>(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return (result.structuredContent as { data: T }).data;
    },
    async close() {
      await client.close();
      await server.close();
      raw.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

type Contacts = {
  contacts: Array<{
    id: string;
    name: string;
    workspace: { id: string };
    route: { dispatchAllowed: boolean };
  }>;
  nextCursor: string | null;
};

test('real MCP directory searches only permitted routes with stable cursor and compatible legacy arrays', async () => {
  const f = await fixture();
  try {
    const otherRoot = join(f.root, 'other');
    mkdirSync(otherRoot);
    const foreignRoot = join(f.root, 'foreign');
    mkdirSync(foreignRoot);
    const other = f.raw.createWorkspace({ name: 'Permitted', rootPath: otherRoot });
    const foreign = f.raw.createWorkspace({ name: 'Foreign', rootPath: foreignRoot });
    f.raw.assignBuddyToWorkspace({ buddy: f.lead.id, workspace: other.id });
    const a = f.raw.createBuddy({
      project: other.id,
      name: 'Product lead A',
      role: 'Product design',
    });
    const b = f.raw.createBuddy({
      project: f.workspace.id,
      name: 'Product lead B',
      role: 'Product research',
    });
    f.raw.createBuddy({
      project: foreign.id,
      name: 'Product confidential',
      role: 'Foreign private contact',
    });
    f.raw.setCoordinationMembership(f.lead.id, other.id, { dispatch: false });
    const first = await f.call<Contacts>('list_buddies', {
      scope: 'permitted',
      query: 'Product',
      limit: 1,
    });
    assert.equal(first.contacts.length, 1);
    assert.ok(first.nextCursor);
    // Changing labels between pages cannot duplicate or skip identities in stable identity order.
    f.raw.updateBuddy(first.contacts[0].id, { name: 'Product renamed' });
    const second = await f.call<Contacts>('list_buddies', {
      scope: 'permitted',
      query: 'Product',
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.equal(second.nextCursor, null);
    assert.deepEqual([first.contacts[0].id, second.contacts[0].id].sort(), [a.id, b.id].sort());
    assert.equal(
      [first, second].flatMap((page) => page.contacts).find((contact) => contact.id === a.id)?.route
        .dispatchAllowed,
      false
    );
    const legacy = await f.call<Array<{ id: string }>>('list_buddies', { limit: 1, offset: 1 });
    assert.ok(Array.isArray(legacy));
    assert.equal(legacy.length, 1);
    for (const args of [
      { workspaceId: foreign.id },
      { scope: 'permitted', workspaceId: other.id },
      { scope: 'permitted', query: 'changed', cursor: first.nextCursor },
      { scope: 'permitted', cursor: first.nextCursor, offset: 0 },
    ])
      assert.equal(
        (await f.client.callTool({ name: 'list_buddies', arguments: args })).isError,
        true
      );
  } finally {
    await f.close();
  }
});

test('real MCP advertises all automation actions and validates their canonical combinations', async () => {
  const f = await fixture();
  try {
    const tools = (await f.client.listTools()).tools;
    const schema = tools.find((tool) => tool.name === 'set_automation')!.inputSchema;
    for (const field of [
      'action',
      'automationId',
      'key',
      'baseRevision',
      'name',
      'scheduleKind',
      'scheduleExpression',
      'policy',
      'jobPayload',
    ])
      assert.ok(schema.properties?.[field], field);
    assert.ok(schema.required?.includes('action'));
    assert.ok(
      tools.find((tool) => tool.name === 'get_capabilities')!.inputSchema.properties?.targetBuddyIds
    );
    assert.ok(tools.find((tool) => tool.name === 'list_buddies')!.inputSchema.properties?.cursor);
    const created = await f.call<{ id: string; enabled: boolean }>('set_automation', {
      action: 'create',
      key: 'daily',
      name: 'Daily review',
      scheduleKind: 'interval',
      scheduleExpression: '3600',
      jobPayload: { prompt: 'Review current work' },
    });
    assert.equal(created.enabled, false);
    for (const args of [
      { action: 'enable', automationId: created.id },
      { action: 'disable', automationId: created.id, name: 'not valid for disable' },
      { action: 'create', name: 'No schedule' },
    ])
      assert.equal(
        (await f.client.callTool({ name: 'set_automation', arguments: args })).isError,
        true
      );
    await f.call('set_automation', {
      action: 'update',
      automationId: created.id,
      name: 'Renamed daily',
    });
    await f.call('set_automation', { action: 'disable', automationId: created.id });
    assert.equal(f.raw.listAutomations({ buddy: f.lead.id }).length, 1);
  } finally {
    await f.close();
  }
});

test('document previews expose only the requested document, require current revision and write no content', async () => {
  const f = await fixture();
  try {
    const initial = f.raw.readBuddyMemory(f.lead.id);
    f.raw.updateMemory(f.lead.id, {
      doc: 'working',
      content: 'Current working fact',
      baseVersion: initial.workingRevision,
      reasoning: 'fixture',
    });
    f.raw.updateMemory(f.lead.id, {
      doc: 'long_term',
      content: 'PRIVATE_LONG_TERM_SENTINEL',
      baseVersion: initial.longTermRevision,
      reasoning: 'fixture',
    });
    const before = f.raw.readBuddyMemory(f.lead.id);
    const preview = await f.call<{ diff: { removed: string[]; added: string[] }; doc: string }>(
      'update_memory',
      {
        doc: 'working',
        preview: true,
        content: 'Updated working fact',
        baseVersion: before.workingRevision,
        reasoning: 'Refresh evidence',
      }
    );
    assert.equal(preview.doc, 'working');
    assert.deepEqual(preview.diff.removed, ['Current working fact']);
    assert.deepEqual(preview.diff.added, ['Updated working fact']);
    assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_LONG_TERM_SENTINEL/);
    assert.deepEqual(f.raw.readBuddyMemory(f.lead.id), before);
    assert.equal(
      (
        await f.client.callTool({
          name: 'update_memory',
          arguments: {
            doc: 'working',
            preview: true,
            content: 'Stale draft',
            baseVersion: 0,
            reasoning: 'fixture',
          },
        })
      ).isError,
      true
    );
    const target = f.raw.createBuddy({
      project: f.workspace.id,
      name: 'Specialist',
      role: 'Research',
    });
    f.raw.setBuddyAccess({
      granteeId: f.lead.id,
      workspaceId: f.workspace.id,
      targetBuddyId: target.id,
      capabilities: ['memory.write'],
      baseRevision: 0,
      key: 'write-only',
      reason: 'Fixture write-only grant',
    });
    const denied = await f.client.callTool({
      name: 'update_memory',
      arguments: {
        targetBuddyId: target.id,
        doc: 'working',
        preview: true,
        content: 'Draft',
        baseVersion: 1,
        reasoning: 'fixture',
      },
    });
    assert.equal(denied.isError, true);
    f.raw.setBuddyAccess({
      granteeId: f.lead.id,
      workspaceId: f.workspace.id,
      targetBuddyId: target.id,
      capabilities: ['memory.read', 'memory.write'],
      baseRevision: 1,
      key: 'read-write',
      reason: 'Fixture explicit private access',
    });
    const head = await f.call<{ revision: number }>('get_memory', {
      targetBuddyId: target.id,
      doc: 'working',
    });
    const teamPreview = await f.call<{ diff: { added: string[] } }>('update_memory', {
      targetBuddyId: target.id,
      doc: 'working',
      preview: true,
      content: 'Draft',
      baseVersion: head.revision,
      reasoning: 'fixture',
    });
    assert.deepEqual(teamPreview.diff.added, ['Draft']);
  } finally {
    await f.close();
  }
});

type Capabilities = {
  contractVersion: string;
  ownerControls: { available: boolean; compatible: boolean };
  targets: Array<{
    targetBuddyId: string;
    operations: Record<
      string,
      BuddyCapabilityDecision & {
        prerequisites?: Array<BuddyCapabilityDecision & { capability: string }>;
      }
    >;
  }>;
  readiness: {
    ready: boolean;
    blockers: Array<{ path: string; code: string }>;
    messages: Array<{ messageId: string; execution: { runId: string } }>;
  };
};

test('typed owner proposal survives MCP dispatch exactly once and cannot configure or leak foreign identities', async () => {
  const f = await fixture();
  try {
    const pixel = f.raw.createBuddy({ project: f.workspace.id, name: 'Pixel', role: 'Research' });
    const proposal = {
      key: 'configure-pixel',
      configuration: {
        workspaceId: f.workspace.id,
        reason: 'Owner proposal only',
        relationships: [
          { from: { id: f.lead.id }, to: { id: pixel.id }, kind: 'manager', present: true },
        ],
      },
    };
    const input = {
      key: 'propose-pixel',
      to: 'owner',
      purpose: 'team_setup',
      body: 'Configure this reporting edge.',
      teamConfiguration: proposal,
    };
    const result = await f.call<{ message: { id: string; body: string } }>('send', input);
    assert.deepEqual(parseTeamConfigurationProposal(result.message.body)?.proposal, proposal);
    assert.equal(result.message.body.split('<!--buddy_team_proposal:').length, 2);
    assert.equal(
      (await f.call<{ message: { id: string } }>('send', input)).message.id,
      result.message.id
    );
    assert.equal(f.raw.isCoordinationManager(f.lead.id, pixel.id), false);
    assert.equal(f.raw.getBuddyAccess(f.lead.id, f.workspace.id, pixel.id), null);
    const foreignRoot = join(f.root, 'foreign');
    mkdirSync(foreignRoot);
    const foreign = f.raw.createWorkspace({ name: 'Foreign', rootPath: foreignRoot });
    const outsider = f.raw.createBuddy({ project: foreign.id, name: 'Private', role: 'Private' });
    for (const args of [
      { ...input, to: pixel.id },
      { ...input, visibility: 'project' },
      { ...input, body: 'Embedded <!--buddy_team_proposal:malformed' },
      {
        ...input,
        teamConfiguration: {
          ...proposal,
          configuration: {
            ...proposal.configuration,
            memberships: [{ buddy: { id: outsider.id }, present: true }],
          },
        },
      },
      {
        ...input,
        teamConfiguration: {
          ...proposal,
          configuration: {
            ...proposal.configuration,
            memberships: [{ buddy: { creationKey: 'missing' }, present: true }],
          },
        },
      },
      {
        ...input,
        teamConfiguration: {
          ...proposal,
          configuration: {
            ...proposal.configuration,
            create: [
              { creationKey: 'large', name: 'Large', role: 'Research', soul: 'x'.repeat(32000) },
            ],
          },
        },
      },
    ])
      assert.equal((await f.client.callTool({ name: 'send', arguments: args })).isError, true);
    assert.equal(f.raw.listMessages({ buddy: f.lead.id, workspace: f.workspace.id }).length, 1);
  } finally {
    await f.close();
  }
});

test('readiness reports simultaneous team, admission, immutable policy and return blockers without changing original work', async () => {
  const f = await fixture({
    allowedOperations: ['buddy.get_capabilities'],
    ownerControlAvailable: true,
    ownerControlContractVersion: BUDDY_TEAM_CONTRACT_VERSION,
  });
  try {
    const pixel = f.raw.createBuddy({ project: f.workspace.id, name: 'Pixel', role: 'Research' });
    const path = f.raw.createBuddy({ project: f.workspace.id, name: 'Path', role: 'Research' });
    const message = f.raw.sendCoordinatedMessage(
      {
        fromBuddy: f.lead.id,
        to: pixel.id,
        workspace: f.workspace.id,
        parentConversationId: f.context.conversationId,
        purpose: 'audit',
        body: 'Bounded research audit',
        key: 'original',
      },
      { policy: { allowed_operations: ['buddy.get_current_work'] } }
    );
    const runId = f.raw.getMessageExecution(message.id).runId;
    const before = f.raw.getMessage(message.id);
    const caps = await f.call<Capabilities>('get_capabilities', {
      targetBuddyIds: [pixel.id, path.id],
      messageIds: [message.id],
      intent: 'coordinate',
    });
    assert.equal(caps.readiness.ready, false);
    assert.equal(caps.ownerControls.compatible, true);
    for (const code of ['owner_grant_required', 'background_disabled', 'run_policy'])
      assert.ok(
        caps.readiness.blockers.some((blocker) => blocker.code === code),
        code
      );
    assert.ok(caps.readiness.blockers.some((blocker) => blocker.path === 'returnPath.admission'));
    for (const target of caps.targets) {
      const needed = target.operations['update_profile.backgroundEnabled'].prerequisites!;
      assert.deepEqual(
        needed
          .filter((entry) => entry.code === 'owner_grant_required')
          .map((entry) => entry.capability),
        ['profile.read', 'execution.manage']
      );
      assert.ok(!needed.some((entry) => entry.capability === 'profile.write'));
    }
    assert.equal(caps.readiness.messages[0].execution.runId, runId);
    assert.deepEqual(f.raw.getMessage(message.id), before);
    assert.equal(
      (
        await f.client.callTool({
          name: 'get_capabilities',
          arguments: { targetBuddyId: pixel.id, targetBuddyIds: [path.id] },
        })
      ).isError,
      true
    );
  } finally {
    await f.close();
  }
});
