import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import {
  type BuddyBuilderProject,
  BuddyBuilderProjectSchema,
  type BuddyBuilderResult,
  BuddyBuilderResultSchema,
  BuddyBuilderResultsSchema,
  parseBuddyBuilderToolResult,
} from '@unleashd/shared';
import { BuddyBuilderService, type BuddyBuilderStore } from '../src/buddies/builder';
import { createLegacyBuddyBuilderMcpServer as createBuddyBuilderMcpServer } from '../src/buddies/builder-mcp-server';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { startChatRun } from './fixtures/chat-run';

const CONVERSATION_ID = 'wave-sim-team-builder-fixture';
const SEGMENTS = [
  'Wave pool design',
  'Surfboard design',
  'Boat hull design',
  'Hydrofoil design',
  'Coastal Engineering',
];
const PRODUCT_BRIEF = `wave_sim serves ${SEGMENTS.join(', ')}. Customer interview emails ONLY AFTER WE HAVE DEMO VIDEOS. Shared inbox folder under ~/git is unidentified. Coastal Engineering being biggest market is an owner hypothesis.`;

test('Builder saves the eight-person wave_sim team, initial work and relationships without starting work', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'unleashd-wave-sim-team-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspaceRoot = join(root, 'wave_sim');
  const database = join(root, 'buddies.sqlite');
  mkdirSync(workspaceRoot);
  let store = new BuddiesStore(database);
  const workspace = store.createWorkspace({ name: 'wave_sim', rootPath: workspaceRoot });
  const server = createBuddyBuilderMcpServer(
    store as unknown as BuddyBuilderStore,
    CONVERSATION_ID
  );
  const client = new Client({ name: 'wave-sim-builder-fixture', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const hires = new Map<string, BuddyBuilderResult>();
  const hireRequests = new Map<string, Record<string, unknown>>();
  const projects = new Map<string, BuddyBuilderProject>();
  const projectRequests = new Map<string, Record<string, unknown>>();
  const relationships: Record<string, unknown>[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    assert.notEqual(response.isError, true, `${name}: ${JSON.stringify(response.content)}`);
    return response;
  };
  const reject = async (name: string, args: Record<string, unknown>) => {
    assert.equal((await client.callTool({ name, arguments: args })).isError, true, name);
  };
  const id = (key: string) => hires.get(key)!.buddy.id;
  const create = async (key: string, name: string, role: string, manager?: string) => {
    const request = {
      creationKey: key,
      workspaceId: workspace.id,
      name,
      role,
      soul: `${PRODUCT_BRIEF}\nYour responsibility: ${role}. Keep findings and evidence available to your manager.`,
      backgroundEnabled: true,
      ...(manager ? { managerBuddyId: id(manager) } : {}),
    };
    hireRequests.set(key, request);
    const result = BuddyBuilderResultSchema.parse(
      (await call('create_buddy', request)).structuredContent?.result
    );
    hires.set(key, result);
    const soul = (await call('get_soul', { buddyId: result.buddy.id })).structuredContent?.soul as {
      body: string;
    };
    for (const segment of SEGMENTS) assert.ok(soul.body.includes(segment));
    assert.match(soul.body, /Customer interview emails ONLY AFTER WE HAVE DEMO VIDEOS/);
    assert.match(soul.body, /Shared inbox folder under ~\/git is unidentified/);
    assert.match(soul.body, /Coastal Engineering being biggest market is an owner hypothesis/);
    assert.ok(soul.body.includes(role));
    return result;
  };
  const work = async (
    key: string,
    owner: string,
    title: string,
    parent?: string,
    blocked = false
  ) => {
    const request = {
      key,
      buddyId: id(owner),
      title,
      objective: PRODUCT_BRIEF,
      definitionOfDone: `${title} has a saved artifact and concrete validation evidence.`,
      status: blocked ? 'blocked' : 'ready',
      nextAction: blocked
        ? 'Locate and configure the shared inbox; check demo video evidence before sending. Drafting may proceed.'
        : `Prepare ${title.toLowerCase()}.`,
      ...(parent ? { parentProjectId: projects.get(parent)!.id } : {}),
      ...(blocked
        ? {
            blockedReason:
              'Demo videos and an identified, configured shared inbox are required before customer interview emails.',
          }
        : {}),
    };
    projectRequests.set(key, request);
    const response = await call('new_project', request);
    const project = BuddyBuilderProjectSchema.parse(response.structuredContent?.project);
    const event = parseBuddyBuilderToolResult(response);
    assert.equal(event?.action, 'work_created');
    assert.equal(event?.result.buddy.id, id(owner));
    assert.ok(event?.result.projects?.some((saved) => saved.id === project.id));
    projects.set(key, project);
    return project;
  };
  const assertNoWorkStarted = () => {
    assert.deepEqual(store.listAutomations(), []);
    assert.deepEqual(store.listMessages(), []);
    assert.deepEqual(store.listBuddyRuns(), []);
    assert.deepEqual(store.listNonterminalAutomationRuns(), []);
    for (const hire of hires.values())
      assert.deepEqual(store.listConversationLinks(hire.buddy.id), []);
  };
  try {
    await create(
      'lead',
      'Project Lead',
      'Coordinate product delivery and make the working demo useful.'
    );
    await create(
      'gtm',
      'GTM',
      'Research buyer needs and draft outreach; send customer interview emails only after demo videos exist and the shared inbox is configured.',
      'lead'
    );
    await create(
      'product',
      'Product',
      'Own the demo roadmap and coordinate engineering and design.',
      'lead'
    );
    await create(
      'simulation',
      'Simulation',
      'Validate wave simulation accuracy and performance.',
      'lead'
    );
    await create(
      'frontier',
      'Frontier',
      'Explore sub/non-volumetric theory, document evidence, and hand useful findings to Simulation and Product.',
      'lead'
    );
    await create(
      'researcher',
      'Researcher',
      'Research the five product segments and cite evidence.'
    );
    await create(
      'engineer',
      'Engineer',
      'Implement a working interactive demo with useful validation.',
      'product'
    );
    await create(
      'designer',
      'Designer',
      'Critically assess demo usability within a tight scope; improve interactions and communicate simulation results.',
      'product'
    );

    relationships.push(
      {
        key: 'gtm-researcher',
        fromBuddyId: id('gtm'),
        toBuddyId: id('researcher'),
        kind: 'manager',
      },
      {
        key: 'product-researcher',
        fromBuddyId: id('product'),
        toBuddyId: id('researcher'),
        kind: 'consults',
      }
    );
    for (const relationship of relationships) await call('set_relationship', relationship);
    await work('root', 'lead', 'Deliver the wave_sim demo');
    await work('gtm-work', 'gtm', 'Prepare a demo-led market plan', 'root');
    await work('product-work', 'product', 'Specify the working demo', 'root');
    await work('simulation-work', 'simulation', 'Validate wave behavior', 'root');
    await work('frontier-work', 'frontier', 'Record frontier simulation experiments', 'root');
    await work('researcher-work', 'researcher', 'Research the five buyer segments', 'gtm-work');
    await work('engineer-work', 'engineer', 'Implement the interactive demo', 'product-work');
    await work('designer-work', 'designer', 'Design the demo experience', 'product-work');
    await work('outreach', 'gtm', 'Send demo-backed outreach emails', 'gtm-work', true);

    assert.equal(store.listBuddies().length, 8);
    assert.equal(store.listBuddyOwnedProjects({ includeClosed: true }).length, 9);
    for (const hire of hires.values()) {
      assert.equal(
        store.getCoordinationMembership(hire.buddy.id, workspace.id)?.background_enabled,
        1
      );
    }
    assertNoWorkStarted();

    const port = coordinationStore(store as unknown as BuddiesStorePort);
    const engineerProject = projects.get('engineer-work')!;
    assert.equal(port.canReadCoordinationProject(id('lead'), engineerProject.id), true);
    assert.equal(port.canManageCoordinationProject(id('lead'), engineerProject.id), true);
    const currentWork = new BuddyOperationsService(port, {
      buddyId: id('lead'),
      workspaceId: workspace.id,
    }).execute('buddy.get_current_work', { workspaceId: workspace.id }).data as Array<{
      id: string;
    }>;
    assert.ok(currentWork.some((project) => project.id === engineerProject.id));
    assert.ok(currentWork.some((project) => project.id === projects.get('researcher-work')!.id));

    for (const [key, request] of hireRequests) {
      assert.equal(
        BuddyBuilderResultSchema.parse(
          (await call('create_buddy', request)).structuredContent?.result
        ).buddy.id,
        id(key)
      );
    }
    for (const relationship of relationships) await call('set_relationship', relationship);
    for (const [key, request] of projectRequests) {
      assert.equal(
        BuddyBuilderProjectSchema.parse(
          (await call('new_project', request)).structuredContent?.project
        ).id,
        projects.get(key)!.id
      );
    }
    await reject('create_buddy', { ...hireRequests.get('engineer'), name: 'Changed Engineer' });
    await reject('new_project', {
      ...projectRequests.get('engineer-work'),
      title: 'Changed assignment',
    });
    await reject('set_relationship', { ...relationships[0], toBuddyId: id('designer') });
    assert.equal(store.listBuddies().length, 8);
    assert.equal(store.listBuddyOwnedProjects({ includeClosed: true }).length, 9);
    assertNoWorkStarted();

    const otherBuilder = new BuddyBuilderService(
      store as unknown as BuddyBuilderStore,
      'other-builder'
    );
    const outsider = otherBuilder.createBuddy({
      workspaceId: workspace.id,
      name: 'Outside hire',
      role: 'Outside this Builder team',
      soul: 'Keep separate work.',
    });
    const outsiderProject = otherBuilder.createProject({
      key: 'outside',
      buddyId: outsider.buddy.id,
      title: 'Outside project',
      definitionOfDone: 'Saved result.',
    }).project;
    const otherRoot = join(root, 'other-workspace');
    mkdirSync(otherRoot);
    const otherWorkspace = store.createWorkspace({ name: 'Other', rootPath: otherRoot });
    await reject('new_project', {
      ...projectRequests.get('engineer-work'),
      key: 'outside-target',
      buddyId: outsider.buddy.id,
    });
    await reject('new_project', {
      ...projectRequests.get('engineer-work'),
      key: 'outside-parent',
      parentProjectId: outsiderProject.id,
    });
    await reject('new_project', {
      ...projectRequests.get('engineer-work'),
      key: 'outside-workspace',
      workspaceId: otherWorkspace.id,
    });
    await reject('create_buddy', {
      ...hireRequests.get('engineer'),
      creationKey: 'outside-manager',
      managerBuddyId: outsider.buddy.id,
    });
    await reject('set_relationship', {
      key: 'outside-edge',
      fromBuddyId: outsider.buddy.id,
      toBuddyId: id('engineer'),
      kind: 'manager',
    });
    assert.equal(store.listBuddies().length, 9);
    assert.equal(store.listBuddyOwnedProjects({ includeClosed: true }).length, 10);
    assertNoWorkStarted();
  } finally {
    await client.close();
    await server.close();
    store.close();
  }

  store = new BuddiesStore(database);
  try {
    const builder = new BuddyBuilderService(store as unknown as BuddyBuilderStore, CONVERSATION_ID);
    const recovered = BuddyBuilderResultsSchema.parse(builder.getResults());
    assert.equal(recovered.results.length, 8);
    for (const [key, manager] of [
      ['gtm', 'lead'],
      ['product', 'lead'],
      ['simulation', 'lead'],
      ['frontier', 'lead'],
      ['researcher', 'gtm'],
      ['engineer', 'product'],
      ['designer', 'product'],
    ]) {
      const hire = recovered.results.find((result) => result.buddy.id === id(key))!;
      assert.deepEqual(hire.teamState?.employment, {
        kind: 'direct_report',
        managerId: id(manager),
      });
      assert.equal(hire.teamState?.manager?.id, id(manager));
      assert.ok(hire.projects?.length);
    }
    const lead = recovered.results.find((result) => result.buddy.id === id('lead'))!;
    assert.deepEqual(lead.teamState?.employment, { kind: 'top_level' });
    assert.deepEqual(
      lead.teamState?.team.map((member) => member.id).sort(),
      ['gtm', 'product', 'simulation', 'frontier'].map(id).sort()
    );
    const researcherEdges = store.listBuddyRelationships(id('researcher'));
    const researcher = recovered.results.find((result) => result.buddy.id === id('researcher'))!;
    assert.deepEqual(
      researcher.relationships,
      researcherEdges.map(({ id, from_buddy_id, to_buddy_id, kind }) => ({
        id,
        from_buddy_id,
        to_buddy_id,
        kind,
      }))
    );
    assert.equal(
      researcherEdges.filter(
        (edge) => edge.kind === 'manager' && edge.to_buddy_id === id('researcher')
      ).length,
      1
    );
    assert.ok(
      researcherEdges.some(
        (edge) =>
          edge.kind === 'consults' &&
          edge.from_buddy_id === id('product') &&
          edge.to_buddy_id === id('researcher')
      )
    );
    assert.equal(store.getBuddyProject(projects.get('outreach')!.id)?.status, 'blocked');
    assert.match(
      store.getBuddyProject(projects.get('outreach')!.id)?.blocked_reason ?? '',
      /Demo videos and an identified, configured shared inbox/
    );
    for (const [key, request] of hireRequests)
      assert.equal(builder.createBuddy(request).buddy.id, id(key));
    for (const [key, request] of projectRequests)
      assert.equal(builder.createProject(request).project.id, projects.get(key)!.id);
    assertNoWorkStarted();

    // Setup has finished. A separate bounded store-level exercise demonstrates
    // that a lead handoff is eligible under the saved background setting.
    const port = coordinationStore(store as unknown as BuddiesStorePort);
    const source = startChatRun(port, {
      buddyId: id('lead'),
      workspaceId: workspace.id,
      conversationId: 'fixture-lead',
      projectId: projects.get('root')!.id,
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
    });
    const message = port.withBuddyRunAuthority(source.id, source.claim_token!, 'buddy.send', () =>
      port.sendCoordinatedMessage(
        {
          fromBuddy: id('lead'),
          to: id('engineer'),
          workspace: workspace.id,
          project: projects.get('engineer-work')!.id,
          parentConversationId: 'fixture-lead',
          key: 'fixture-handoff',
          purpose: 'Implement demo',
          body: 'Implement the saved demo assignment.',
        },
        {
          runId: source.id,
          sourceProjectId: projects.get('root')!.id,
          sourceWorkspaceId: workspace.id,
          policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS },
        }
      )
    );
    const queued = port.listBuddyRuns({ buddyId: id('engineer') })[0];
    assert.equal(queued.status, 'queued');
    const claimed = port.claimBuddyRun(queued.id, {
      claimToken: 'fixture-engineer-claim',
      conversationId: 'fixture-engineer',
    });
    assert.ok(claimed, 'the saved membership permits the queued handoff');
    port.startBuddyRun(claimed.id, claimed.claim_token!);
    new BuddyOperationsService(
      port,
      {
        buddyId: id('engineer'),
        workspaceId: workspace.id,
        buddyProjectId: projects.get('engineer-work')!.id,
        conversationId: 'fixture-engineer',
        coordinationRunId: claimed.id,
        allowedOperations: MESSAGE_BUDDY_OPERATIONS,
      },
      { automationClaimToken: claimed.claim_token! }
    ).execute('buddy.reply', {
      messageId: message.id,
      outcome: 'done',
      body: 'Fixture demo ready.',
      evidence: ['fixture:demo'],
    });
    assert.equal(store.getMessage(message.id)?.status, 'replied');
    const returned = port
      .listBuddyRuns({ buddyId: id('lead') })
      .find((run) => run.input_kind === 'message_reply');
    assert.equal(returned?.conversation_id, 'fixture-lead');
    assert.equal(returned?.project_id, projects.get('root')!.id);
    assert.equal(returned?.status, 'queued');
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
