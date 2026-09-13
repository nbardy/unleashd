import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';

for (const audience of ['workspace', 'project', 'owner', 'addressed-request'] as const) {
  test(`native readiness receipts respect the ${audience} message audience`, async () => {
    const raw = new BuddiesStore(':memory:');
    const store = raw as unknown as BuddiesStorePort;
    const workspace = raw.createWorkspace({ name: 'Readiness privacy', rootPath: '/tmp' });
    const worker = raw.createBuddy({ project: workspace.id, name: 'Worker', role: 'Inspect' });
    const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Coordinate' });
    raw.setBuddyRelationship({ fromBuddy: lead.id, toBuddy: worker.id, kind: 'manager' });
    raw.setCoordinationMembership(worker.id, workspace.id, { background_enabled: true });
    const project = raw.createCoordinatedProject(
      {
        workspaceId: workspace.id,
        ownerId: worker.id,
        title: 'Shared work',
        definitionOfDone: 'Evidence',
      },
      { actor: worker.id, key: 'project' }
    );
    const makeRequest = (key: string, visibility: 'participants' | 'project', fail: boolean) => {
      const message = raw.sendCoordinatedMessage(
        {
          fromBuddy: lead.id,
          to: worker.id,
          workspace: workspace.id,
          project: project.id,
          purpose: 'Inspect',
          body: `${key}_BODY_CANARY`,
          key,
          visibility,
        },
        { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
      );
      const run = raw
        .listBuddyRuns({ buddyId: worker.id })
        .find((entry) => entry.input_id === message.id)!;
      const claimed = raw.claimBuddyRun(run.id, {
        claimToken: `${key}-claim`,
        conversationId: `${key}_CONVERSATION_CANARY`,
        maxRuntimeSeconds: 60,
      });
      assert.ok(claimed);
      raw.startBuddyRun(run.id, claimed.claim_token);
      if (fail)
        raw.finishBuddyRun(run.id, {
          claimToken: claimed.claim_token,
          status: 'failed',
          error: `${key}_FAILURE_CANARY`,
        });
      return { message, run, token: claimed.claim_token };
    };
    const privateRequest = makeRequest('PRIVATE', 'participants', true);
    const publishedRequest = makeRequest('PUBLISHED', 'project', true);
    const addressed =
      audience === 'addressed-request' ? makeRequest('ADDRESSED', 'participants', false) : null;
    const context = {
      buddyId: worker.id,
      workspaceId: workspace.id,
      conversationId: 'inspection-thread',
      ...(audience !== 'owner' ? { delegatedByBuddyId: lead.id } : {}),
      ...(audience === 'project' || addressed ? { buddyProjectId: project.id } : {}),
      ...(addressed ? { coordinationRunId: addressed.run.id } : {}),
    };
    const server = createBuddyMcpServer(store, context, { automationClaimToken: addressed?.token });
    const client = new Client({ name: 'readiness-privacy', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(a), server.connect(b)]);
      const detail = await client.callTool({
        name: 'get_message',
        arguments: { messageId: privateRequest.message.id },
      });
      assert.equal(!!detail.isError, audience !== 'owner');
      const result = await client.callTool({
        name: 'get_capabilities',
        arguments: {
          intent: 'coordinate',
          messageIds: [
            privateRequest.message.id,
            publishedRequest.message.id,
            ...(addressed ? [addressed.message.id] : []),
          ],
        },
      });
      assert.ok(!result.isError, JSON.stringify(result));
      const readiness = (
        result.structuredContent as {
          data: {
            readiness: {
              messages: Array<{ messageId: string }>;
              blockers: Array<{ code: string; path: string }>;
            };
          };
        }
      ).data.readiness;
      const ids = readiness.messages.map((entry) => entry.messageId);
      assert.ok(ids.includes(publishedRequest.message.id), 'Published work remains inspectable');
      assert.match(JSON.stringify(result), /PUBLISHED_FAILURE_CANARY/);
      if (addressed)
        assert.ok(
          ids.includes(addressed.message.id),
          'The current addressed request remains inspectable'
        );
      if (audience === 'owner') {
        assert.ok(ids.includes(privateRequest.message.id));
        assert.match(JSON.stringify(result), /PRIVATE_FAILURE_CANARY/);
      } else {
        assert.ok(!ids.includes(privateRequest.message.id));
        assert.doesNotMatch(JSON.stringify(result), /PRIVATE_(BODY|FAILURE|CONVERSATION)_CANARY/);
        assert.ok(
          readiness.blockers.some(
            (entry) =>
              entry.code === 'message_scope' &&
              entry.path === `messages.${privateRequest.message.id}`
          )
        );
        assert.equal(
          readiness.blockers.filter((entry) =>
            entry.path.startsWith(`messages.${privateRequest.message.id}`)
          ).length,
          1,
          'Denied messages must not feed private errors, run policies or return routes into blockers'
        );
      }
    } finally {
      await client.close();
      await server.close();
      raw.close();
    }
  });
}
