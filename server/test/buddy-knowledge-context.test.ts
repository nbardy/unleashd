import assert from 'node:assert/strict';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddiesIntegration } from '../src/buddies/integration';
import { BuddyOperationsService } from '../src/buddies/operations';
import { executeDocumentResource } from '../src/buddies/resources';

test('production composer and resource reads isolate private and project audiences, including compatibility tools', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = raw as unknown as BuddiesStorePort;
  try {
    const w = raw.createWorkspace({ name: 'Research', rootPath: '/tmp' });
    const b = raw.createBuddy({ project: w.id, name: 'Researcher', role: 'Compare evidence' });
    const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
    const p = raw.createCoordinatedProject(
      { workspaceId: w.id, ownerId: b.id, title: 'Published work', definitionOfDone: 'Evidence' },
      { actor: b.id, key: 'p' }
    );
    const other = raw.createCoordinatedProject(
      {
        workspaceId: w.id,
        ownerId: b.id,
        title: 'OTHER_PROJECT_PRIVATE_TITLE',
        definitionOfDone: 'Evidence',
      },
      { actor: b.id, key: 'other' }
    );
    const memory = raw.readBuddyMemory(b.id);
    raw.updateMemory(b.id, {
      documentKind: 'working',
      baseVersion: memory.workingRevision,
      content: 'GLOBAL_PRIVATE_CANARY',
      reasoning: 'Private context',
    });
    const scope = { kind: 'project' as const, projectId: p.id };
    const ref = { kind: 'working' as const, targetBuddyId: b.id, scope };
    raw.replaceKnowledgeDocument(
      ref,
      { key: 'publish', baseRevision: 0, content: 'APPROVED_HANDOFF', reason: 'Owner disclosure' },
      { actor: 'owner', workspaceId: w.id }
    );
    const integration = createBuddiesIntegration({
      getConversation: () => undefined,
      store,
    });
    const owner = await integration.resolveConversation({
      buddyId: b.id,
      workspaceId: w.id,
      knowledgeScope: { kind: 'owner_thread', conversationId: 'private' },
    });
    const shared = await integration.resolveConversation({
      buddyId: b.id,
      workspaceId: w.id,
      buddyProjectId: p.id,
      knowledgeScope: scope,
      delegatedByBuddyId: lead.id,
    });
    assert.match(owner.briefing, /GLOBAL_PRIVATE_CANARY/);
    assert.match(shared.briefing, /APPROVED_HANDOFF/);
    assert.doesNotMatch(shared.briefing, /GLOBAL_PRIVATE_CANARY|OTHER_PROJECT_PRIVATE_TITLE/);
    // A private owner thread and a team project audience never continue each other.
    assert.equal(shared.audience!.continuityFrom(owner.audience!.key), 'changed');
    const review = new BuddyOperationsService(store, {
      buddyId: b.id,
      workspaceId: w.id,
      conversationId: 'background-review',
      delegatedByBuddyId: lead.id,
      knowledgeScope: { kind: 'owner_thread', conversationId: 'private' },
    });
    assert.match(
      JSON.stringify(review.execute('buddy.recall', { pattern: 'CANARY' })),
      /GLOBAL_PRIVATE_CANARY/
    );
    assert.throws(
      () =>
        executeDocumentResource('get_document', { ref }, (name, input) =>
          review.execute(name, input)
        ),
      /unavailable/
    );
    const ops = new BuddyOperationsService(store, {
      buddyId: b.id,
      workspaceId: w.id,
      buddyProjectId: p.id,
      delegatedByBuddyId: lead.id,
      conversationId: 'team',
    });
    assert.throws(() => ops.execute('buddy.get_memory', { doc: 'working' }), /unavailable/);
    const read = executeDocumentResource('get_document', { ref }, (name, input) =>
      ops.execute(name, input)
    );
    assert.equal(read.data.content, 'APPROVED_HANDOFF');
    assert.throws(
      () =>
        executeDocumentResource(
          'get_document',
          { ref: { ...ref, scope: { kind: 'project', projectId: other.id } } },
          (name, input) => ops.execute(name, input)
        ),
      /unavailable/
    );
    assert.doesNotMatch(
      JSON.stringify(ops.execute('buddy.recall', { pattern: 'CANARY' })),
      /GLOBAL_PRIVATE_CANARY/
    );
  } finally {
    raw.close();
  }
});
