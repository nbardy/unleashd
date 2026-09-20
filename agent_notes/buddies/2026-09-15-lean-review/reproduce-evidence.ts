// Read-only product review: all mutations target a disposable in-memory fixture.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { BuddiesStore } from '@nbardy/buddies';
import { createBuddyMcpServer } from '../../../server/src/buddies/mcp-server';

const require = createRequire(new URL('../../../server/package.json', import.meta.url));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

async function main() {
  const raw = new BuddiesStore(':memory:');
  const workspace = raw.createWorkspace({ name: 'Lean review fixture', rootPath: '/tmp' });
  const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Review' });
  const worker = raw.createBuddy({ project: workspace.id, name: 'Worker', role: 'Implement' });
  raw.setBuddyRelationship({ fromBuddy: lead.id, toBuddy: worker.id, kind: 'manager' });
  const server = createBuddyMcpServer(raw as never, {
    buddyId: lead.id,
    workspaceId: workspace.id,
    conversationId: 'disposable-review-owner',
  });
  const client = new Client({ name: 'lean-review', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent.data;
  }
  const observations = [];
  try {
    for (const [label, ownerId] of [['self', lead.id], ['supervised', worker.id]]) {
      const created = await call('new_project', {
        key: `fixture-${label}`, ownerId, title: `${label} Task`,
        definitionOfDone: 'Original criteria',
        todos: [{ title: 'Step', definitionOfDone: 'Original step criteria' }],
      });
      const read = async () => (await call('get_current_work', {
        projectId: created.id, includeClosed: true, view: 'full',
      })).items[0];
      let project = await read();
      await call('update_project', {
        projectId: project.id, baseRevision: project.revision, key: `seed-${label}`,
        evidence: ['saved-project-artifact'],
        todoOperations: [{ operation: 'update', todoId: project.todos[0].id,
          evidence: ['saved-step-artifact'] }],
      });
      project = await read();
      const before = { project: project.completion_evidence, todo: project.todos[0].completion_evidence };
      await call('update_project', {
        projectId: project.id, baseRevision: project.revision, key: `title-${label}`,
        title: `${label} Task renamed`,
      });
      project = await read();
      const titleOnly = { project: project.completion_evidence, todo: project.todos[0].completion_evidence };
      assert.deepEqual(titleOnly, before, 'Title-only control preserves evidence');
      await call('update_project', {
        projectId: project.id, baseRevision: project.revision, key: `criteria-${label}`,
        definitionOfDone: 'Clarified criteria',
        todoOperations: [{ operation: 'update', todoId: project.todos[0].id,
          definitionOfDone: 'Clarified step criteria' }],
      });
      project = await read();
      const after = { project: project.completion_evidence, todo: project.todos[0].completion_evidence };
      observations.push({ label, before, titleOnly, after,
        evidencePreserved: JSON.stringify(after) === JSON.stringify(before) });
    }
    console.log(JSON.stringify({ observedAt: new Date().toISOString(),
      boundary: 'real native MCP over disposable BuddiesStore(:memory:)', observations }, null, 2));
    assert.equal(observations.filter(x => !x.evidencePreserved).length, 2,
      'The recorded defect reproduces for self and supervised edits');
  } finally {
    await client.close();
    await server.close();
    raw.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
