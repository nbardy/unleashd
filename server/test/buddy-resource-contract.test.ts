import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { createOwnerTeamMcpServer } from '../src/buddies/owner-mcp';
import { executeOwnerResource } from '../src/buddies/owner-resources';
import { configureOwnerTeam } from '../src/buddies/owner-team-configuration';

test('resource MCP adopts existing staff, imports revisioned handoffs, preserves replay and exact schema variants', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-resources-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const store = raw as unknown as BuddiesStorePort;
  const w = raw.createWorkspace({ name: 'Setup', rootPath: root });
  const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
  const worker = raw.createBuddy({ project: w.id, name: 'Existing worker', role: 'Inspect' });
  const authority = {
    ownerInputId: 'owner-setup',
    conversationId: 'builder',
    workspaceIds: [w.id],
  };
  const owner = createOwnerTeamMcpServer(
    (input) => Promise.resolve(configureOwnerTeam(store, input, authority)),
    (name, input) => Promise.resolve(executeOwnerResource(store, name, input, authority))
  );
  const employee = createBuddyMcpServer(store, {
    buddyId: lead.id,
    workspaceId: w.id,
    conversationId: 'lead',
  });
  const client = new Client({ name: 'resource-client', version: '1' });
  const ownerClient = new Client({ name: 'owner-client', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const [c, d] = InMemoryTransport.createLinkedPair();
  const call = async (client: Client, name: string, input: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: input });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent as { data: Record<string, any> };
  };
  try {
    await Promise.all([
      employee.connect(b),
      client.connect(a),
      owner.connect(d),
      ownerClient.connect(c),
    ]);
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some((t) => t.name === 'get_document'));
    assert.ok(
      !tools.some((t) =>
        ['get_soul', 'get_memory', 'update_memory', 'hire_direct_report'].includes(t.name)
      )
    );
    const schedule = tools.find((t) => t.name === 'set_automation')!;
    assert.ok(schedule.inputSchema.properties?.command);
    assert.ok(!schedule.inputSchema.properties?.automationId);
    assert.equal(
      (
        await client.callTool({
          name: 'set_automation',
          arguments: { command: { action: 'enable', name: 'wrong variant' } },
        })
      ).isError,
      true
    );
    const capabilities = await call(client, 'get_capabilities', {});
    assert.equal(capabilities.data.readiness.state, 'not_evaluated');
    assert.equal(capabilities.data.targetBuddyId, undefined);
    assert.equal(capabilities.data.targets.length, 1);
    assert.ok(JSON.stringify(capabilities).length < 12000);
    const mapping = capabilities.data.documentOperationMapping;
    assert.equal(mapping.get_document.soul, 'get_soul');
    assert.equal(mapping.update_document.soul, 'update_soul');
    for (const kind of ['working', 'long_term', 'shared', 'note']) {
      assert.equal(mapping.get_document[kind], 'get_memory');
      assert.equal(mapping.update_document[kind], 'update_memory');
    }
    const selfPermissions = capabilities.data.targets[0];
    assert.ok(selfPermissions.allowedOperations.includes(mapping.get_document.working));
    const selfRef = {
      kind: 'working',
      targetBuddyId: lead.id,
      scope: { kind: 'owner_thread', conversationId: 'lead' },
    };
    const selfHead = await call(client, 'get_document', { ref: selfRef });
    assert.equal(typeof selfHead.data.revision, 'string');
    const targetCapabilities = await call(client, 'get_capabilities', {
      targetBuddyId: worker.id,
    });
    const denied = targetCapabilities.data.targets[0].deniedOperations;
    assert.equal(denied[mapping.get_document.working].code, 'owner_grant_required');
    assert.equal(denied[mapping.update_document.soul].code, 'owner_grant_required');
    // A readable self mapping does not widen the permitted document audience.
    assert.equal(
      (
        await client.callTool({
          name: 'get_document',
          arguments: {
            ref: { ...selfRef, scope: { kind: 'owner_thread', conversationId: 'private-other' } },
          },
        })
      ).isError,
      true
    );
    const page = await call(client, 'list_buddies', {});
    assert.ok(Array.isArray(page.data.items));
    assert.equal(page.data.nextCursor, null);
    assert.ok(tools.find((t) => t.name === 'send')?.inputSchema.properties?.delivery);
    const sendDescription = tools.find((t) => t.name === 'send')!.description!;
    assert.match(sendDescription, /typed delivery/);
    assert.match(sendDescription, /outstanding child requests suspend the parent/);
    assert.match(sendDescription, /Do not schedule a parallel self-successor/);
    assert.match(sendDescription, /does not grant additional permissions/);
    assert.doesNotMatch(sendDescription, /until_done|expectsReply/);
    assert.equal(
      (
        await client.callTool({
          name: 'send',
          arguments: {
            key: 'bad',
            to: worker.id,
            purpose: 'task',
            body: 'Do work',
            expectsReply: true,
          },
        })
      ).isError,
      true
    );
    assert.equal(
      (
        await client.callTool({
          name: 'send',
          arguments: {
            key: 'bad',
            to: worker.id,
            purpose: 'task',
            body: 'Do work',
            delivery: { kind: 'work' },
          },
        })
      ).isError,
      true
    );
    const ref = { kind: 'working', targetBuddyId: worker.id };
    assert.equal(
      (await client.callTool({ name: 'get_document', arguments: { ref } })).isError,
      true
    );
    const before = await call(ownerClient, 'get_document', { workspaceId: w.id, ref });
    const edit = {
      workspaceId: w.id,
      ref,
      key: 'import-handoff',
      revision: before.data.revision,
      content: 'A scoped handoff imported before incoming work.',
      reason: 'Owner requested setup',
      preview: true,
    };
    const preview = await call(ownerClient, 'update_document', edit);
    assert.deepEqual(preview.data.diff.added, [edit.content]);
    assert.equal(
      (await call(ownerClient, 'get_document', { workspaceId: w.id, ref })).data.revision,
      before.data.revision
    );
    const applied = await call(ownerClient, 'update_document', { ...edit, preview: false });
    assert.notEqual(applied.data.revision, before.data.revision);
    assert.deepEqual(
      await call(ownerClient, 'update_document', { ...edit, preview: false }),
      applied
    );
    assert.equal(
      (
        await ownerClient.callTool({
          name: 'update_document',
          arguments: {
            ...edit,
            key: 'wrong-document',
            ref: { kind: 'soul', targetBuddyId: worker.id },
          },
        })
      ).isError,
      true
    );
    assert.equal(
      (
        await ownerClient.callTool({
          name: 'get_document',
          arguments: { workspaceId: 'outside', ref },
        })
      ).isError,
      true
    );
    const project = await call(ownerClient, 'new_project', {
      workspaceId: w.id,
      ownerId: worker.id,
      key: 'work',
      title: 'Inspect imported geometry evidence',
      definitionOfDone: 'Return references and qualification gaps',
    });
    const work = await call(ownerClient, 'get_current_work', {
      workspaceId: w.id,
      targetBuddyId: worker.id,
    });
    assert.equal(work.data.items[0].id, project.data.id);
    const otherProject = await call(ownerClient, 'new_project', {
      workspaceId: w.id,
      ownerId: worker.id,
      key: 'other-work',
      title: 'Unrelated inspection',
      definitionOfDone: 'Return its independent inspection evidence',
    });
    const selected = await call(ownerClient, 'get_current_work', {
      workspaceId: w.id,
      targetBuddyId: worker.id,
      projectId: project.data.id,
    });
    assert.deepEqual(
      selected.data.items.map((item: { id: string }) => item.id),
      [project.data.id]
    );
    assert.notEqual(otherProject.data.id, project.data.id);
    assert.equal(
      (
        await client.callTool({
          name: 'new_project',
          arguments: { title: 'Missing replay key', definitionOfDone: 'Return evidence' },
        })
      ).isError,
      true
    );
    assert.equal(
      (
        await client.callTool({
          name: 'update_project',
          arguments: { key: 'missing-revision', title: 'Unsafe blind edit' },
        })
      ).isError,
      true
    );
    const currentProfile = await call(ownerClient, 'get_profile', {
      workspaceId: w.id,
      targetBuddyId: worker.id,
    });
    const profileChange = {
      workspaceId: w.id,
      targetBuddyId: worker.id,
      baseRevision: currentProfile.data.revision,
      key: 'rename-existing',
      reason: 'Owner clarified role name',
      changes: { name: 'Existing specialist' },
    };
    const changed = await call(ownerClient, 'update_profile', profileChange);
    assert.deepEqual(await call(ownerClient, 'update_profile', profileChange), changed);
    assert.equal(raw.getBuddy(worker.id)?.name, 'Existing specialist');
    const scopedRef = {
      kind: 'working',
      targetBuddyId: worker.id,
      scope: { kind: 'project', projectId: project.data.id },
    };
    const scopedHead = await call(ownerClient, 'get_document', {
      workspaceId: w.id,
      ref: scopedRef,
    });
    const scopedEdit = {
      workspaceId: w.id,
      ref: scopedRef,
      revision: scopedHead.data.revision,
      key: 'publish-current-audience',
      content: 'Approved project handoff',
      reason: 'Owner publication',
      preview: false,
    };
    const scopedSaved = await call(ownerClient, 'update_document', scopedEdit);
    assert.deepEqual(await call(ownerClient, 'update_document', scopedEdit), scopedSaved);
    const employeeWork = await call(client, 'get_current_work', {});
    assert.ok(Array.isArray(employeeWork.data.items));
    assert.equal(employeeWork.data.nextCursor, null);
    assert.equal(raw.getCoordinationMembership(worker.id, w.id)?.background_enabled, 0);
    assert.equal(raw.listBuddies().length, 2);
  } finally {
    await Promise.all([client.close(), ownerClient.close(), employee.close(), owner.close()]);
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
