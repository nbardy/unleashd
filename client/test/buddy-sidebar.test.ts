import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultConversationConfig, type Conversation } from '@unleashd/shared';
import { createStore } from 'jotai';
import {
  buddySidebarOverviewAtom,
  buddySidebarProjectsAtom,
  buddySidebarCountAtom,
  buddySidebarGroupsAtom,
  buddyBuilderConversationsAtom,
  sidebarRunningCountByFolderAtom,
} from '../src/atoms/buddy-sidebar';
import {
  allConversationIdsAtom,
  conversationAtomFamily,
  conversationsAtom,
  pendingCreationsAtom,
} from '../src/atoms/conversations';

test('only roster memberships create workspace rows; orphan history remains accessible', () => {
  const store = createStore();
  const make = (id: string, buddyId: string, workspaceId: string) =>
    ({
      id,
      kind: { kind: 'buddy' as const, buddyId, workspaceId },
      createdAt: new Date('2026-09-13'),
      messages: [] as Conversation['messages'],
      isRunning: true,
    }) as Conversation;
  const live = make('owner-thread', 'lead', 'work');
  const orphan = make('imported-test', 'missing', 'project_uuid');
  const detached = make('detached-thread', 'lead', 'other');
  const wrongBuddy = make('missing-buddy-thread', 'missing', 'work');
  const conversations = new Map([live, orphan, detached, wrongBuddy].map((c) => [c.id, c]));
  store.set(conversationsAtom, conversations);
  // WS history may arrive before the roster. Never flash synthetic folders.
  assert.deepEqual(store.get(buddySidebarProjectsAtom), []);
  const pending = [live, orphan, detached].map((c) => ({
    kind: 'create_conversation' as const,
    commandId: `create-${c.id}`,
    conversationId: `pending-${c.id}`,
    buddyContext: {
      buddyId: c.id === orphan.id ? 'missing' : 'lead',
      workspaceId: c.id === orphan.id ? 'project_uuid' : c.id === detached.id ? 'other' : 'work',
    },
    config: createDefaultConversationConfig('codex'),
    workingDirectory: '/work',
    createdAt: new Date('2026-09-13'),
  }));
  store.set(pendingCreationsAtom, new Map(pending.map((p) => [p.conversationId, p])));
  const overview = {
    employees: [
      {
        buddy: { id: 'lead', name: 'Real Lead' },
        workspaces: [{ id: 'work', name: 'Real workspace', root_path: '/work' }],
      },
      {
        buddy: { id: 'other-lead', name: 'Other Lead' },
        workspaces: [{ id: 'other', name: 'Other' }],
      },
    ],
    recentRuns: pending.map((p) => ({
      conversationId: p.conversationId,
      buddyId: p.buddyContext.buddyId,
      workspaceId: p.buddyContext.workspaceId,
      buddyName: 'Stale name',
      workspaceName: 'Stale workspace',
      status: 'completed',
      lastActiveAt: '2026-09-13',
    })),
  };
  store.set(buddySidebarOverviewAtom, overview);
  const projects = store.get(buddySidebarProjectsAtom);
  assert.deepEqual(
    projects.map((p) => p.name),
    ['Real workspace', 'Other']
  );
  assert.equal(projects[0].items[0].buddyName, 'Real Lead');
  assert.equal(projects[0].items[0].workingDirectory, '/work');
  assert.deepEqual(
    projects[0].items[0].conversations.map((c) => c.id),
    [live.id]
  );
  assert.equal(projects[0].items[0].pendingCreation?.conversationId, pending[0].conversationId);
  assert.equal(projects[0].runningCount, 1);
  assert.deepEqual(
    projects[1].items.map((i) => i.buddyId),
    ['other-lead']
  );
  assert.equal(projects[1].runningCount, 0);
  assert.equal(store.get(buddySidebarCountAtom), 2);
  assert.equal(store.get(conversationAtomFamily(orphan.id)), orphan);
  assert.equal(store.get(allConversationIdsAtom).length, 4);

  // Newly saved membership makes an already-imported thread visible on refresh.
  store.set(buddySidebarOverviewAtom, {
    ...overview,
    employees: [
      ...overview.employees,
      {
        buddy: { id: 'missing', name: 'Recovered Lead' },
        workspaces: [{ id: 'project_uuid', name: 'Recovered workspace' }],
      },
    ],
  });
  const recovered = store
    .get(buddySidebarProjectsAtom)
    .find((p) => p.workspaceId === 'project_uuid');
  assert.equal(recovered?.name, 'Recovered workspace');
  assert.deepEqual(
    recovered?.items[0].conversations.map((c) => c.id),
    [orphan.id]
  );

  // Removing that membership and receiving another snapshot cannot resurrect it.
  store.set(buddySidebarOverviewAtom, overview);
  store.set(conversationsAtom, new Map(conversations));
  assert.deepEqual(
    store.get(buddySidebarProjectsAtom).map((p) => p.name),
    ['Real workspace', 'Other']
  );
  assert.equal(store.get(conversationAtomFamily(orphan.id)), orphan);
});

test('sidebar groups memberships and scopes recency and threads to each project', () => {
  const store = createStore();
  store.set(buddySidebarOverviewAtom, {
    employees: [
      {
        buddy: { id: 'lead', name: 'Lead' },
        workspaces: [
          { id: 'a', name: 'Alpha', root_path: '/alpha' },
          { id: 'b', name: 'Beta', root_path: '/beta' },
        ],
      },
      {
        buddy: { id: 'new', name: 'New Buddy' },
        workspaces: [{ id: 'c', name: 'Cold', root_path: '/cold' }],
      },
      { buddy: { id: 'free', name: 'Free Buddy' }, workspaces: [] },
    ],
    recentRuns: [],
  });
  const conversation = (id: string, workspaceId: string, date: string) =>
    ({
      id,
      kind: { kind: 'buddy' as const, buddyId: 'lead', workspaceId },
      createdAt: new Date(date),
      messages: [] as Conversation['messages'],
      workingDirectory: `/${workspaceId}`,
    }) as Conversation;
  const a = conversation('thread-a', 'a', '2026-09-01');
  const b = conversation('thread-b', 'b', '2026-09-08');
  store.set(
    conversationsAtom,
    new Map([
      [a.id, a],
      [b.id, b],
    ])
  );
  const projects = store.get(buddySidebarProjectsAtom);
  assert.deepEqual(
    projects.map((p) => p.name),
    ['Beta', 'Alpha', 'Cold', 'Unassigned']
  );
  assert.deepEqual(
    projects.slice(0, 2).map((p) => p.items.map((i) => i.buddyId)),
    [['lead'], ['lead']]
  );
  assert.deepEqual(
    projects[0].items[0].conversations.map((c) => c.id),
    ['thread-b']
  );
  assert.deepEqual(
    projects[1].items[0].conversations.map((c) => c.id),
    ['thread-a']
  );
  assert.equal(projects[0].items[0].workspaceId, 'b');
  assert.equal(projects[0].items[0].workingDirectory, '/beta');
  assert.equal(store.get(buddySidebarCountAtom), 3);
  assert.equal(projects[2].items[0].latestConversation, null);
  store.set(
    conversationsAtom,
    new Map([
      [a.id, { ...a, messages: [{ timestamp: new Date('2026-09-09') }] } as Conversation],
      [b.id, b],
    ])
  );
  assert.equal(store.get(buddySidebarProjectsAtom)[0].name, 'Alpha');
});

test('Builder joins project recency ordering and moves when an older thread receives a message', () => {
  const store = createStore();
  store.set(buddySidebarOverviewAtom, {
    employees: [
      { buddy: { id: 'lead', name: 'Lead' }, workspaces: [{ id: 'project', name: 'Project' }] },
    ],
    recentRuns: [],
  });
  const conversation = (id: string, date: string, builder = false) =>
    ({
      id,
      ...(builder
        ? { kind: { kind: 'buddy_builder' as const } }
        : { kind: { kind: 'buddy' as const, buddyId: 'lead', workspaceId: 'project' } }),
      createdAt: new Date(date),
      messages: [] as Conversation['messages'],
    }) as Conversation;
  const project = conversation('project-thread', '2026-09-08');
  const older = conversation('older-builder', '2026-09-01', true);
  const newer = conversation('newer-builder', '2026-09-07', true);
  const hiddenWorker = { ...conversation('worker', '2026-09-10', true), isWorker: true };
  const child = { ...conversation('child', '2026-09-10', true), parentConversationId: older.id };
  const conversations = new Map([project, older, newer, hiddenWorker, child].map((c) => [c.id, c]));
  store.set(conversationsAtom, conversations);
  assert.deepEqual(
    store.get(buddySidebarGroupsAtom).map((group) => group.kind),
    ['project', 'builder']
  );
  assert.deepEqual(
    store.get(buddyBuilderConversationsAtom).map((c) => c.id),
    ['newer-builder', 'older-builder']
  );

  store.set(
    conversationsAtom,
    new Map(conversations).set(older.id, {
      ...older,
      messages: [{ timestamp: new Date('2026-09-09') }],
    } as Conversation)
  );
  assert.deepEqual(
    store.get(buddySidebarGroupsAtom).map((group) => group.kind),
    ['builder', 'project']
  );
  assert.deepEqual(
    store.get(buddyBuilderConversationsAtom).map((c) => c.id),
    ['older-builder', 'newer-builder']
  );

  store.set(conversationsAtom, new Map([[project.id, project]]));
  assert.deepEqual(
    store.get(buddySidebarGroupsAtom).map((group) => group.kind),
    ['project']
  );
});

test('sidebar exposes active process counts at project-folder scope', () => {
  const store = createStore();
  store.set(buddySidebarOverviewAtom, {
    employees: [
      {
        buddy: { id: 'lead', name: 'Lead' },
        workspaces: [{ id: 'wave', name: 'wave_sim', root_path: '/repo/wave_sim' }],
      },
    ],
    recentRuns: [],
  });
  const conversation = (input: Partial<Conversation> & Pick<Conversation, 'id'>) =>
    ({
      createdAt: new Date('2026-09-12T00:00:00.000Z'),
      messages: [] as Conversation['messages'],
      workingDirectory: '/repo/wave_sim',
      ...input,
    }) as Conversation;
  const buddyForeground = conversation({
    id: 'buddy-foreground',
    isRunning: true,
    buddyContext: { buddyId: 'lead', workspaceId: 'wave', buddyProjectId: null },
  });
  const buddyBackground = conversation({
    id: 'buddy-background',
    isRunning: true,
    placement: 'background',
    buddyContext: { buddyId: 'lead', workspaceId: 'wave', buddyProjectId: null },
  });
  const regular = conversation({ id: 'regular', isRunning: true });
  store.set(
    conversationsAtom,
    new Map([buddyForeground, buddyBackground, regular].map((entry) => [entry.id, entry] as const))
  );

  assert.equal(store.get(buddySidebarProjectsAtom)[0].runningCount, 2);
  const item = store.get(buddySidebarProjectsAtom)[0].items[0];
  assert.equal(item.foregroundRunningCount, 1);
  assert.equal(item.backgroundRunningCount, 1);
  assert.equal(item.backgroundConversationCount, 1);
  assert.equal(store.get(sidebarRunningCountByFolderAtom).get('/repo/wave_sim'), 1);

  // A background task linked to an owner chat still counts. Idle history and
  // a task in another workspace do not inflate this Buddy row's live counts.
  store.set(
    conversationsAtom,
    new Map([
      [buddyForeground.id, { ...buddyForeground, isRunning: false }],
      [buddyBackground.id, { ...buddyBackground, parentConversationId: buddyForeground.id }],
      ['past', { ...buddyBackground, id: 'past', isRunning: false }],
      [
        'other-workspace',
        {
          ...buddyBackground,
          id: 'other-workspace',
          buddyContext: { buddyId: 'lead', workspaceId: 'other', buddyProjectId: null },
        },
      ],
    ])
  );
  const updated = store.get(buddySidebarProjectsAtom)[0];
  assert.equal(updated.runningCount, 1);
  assert.equal(updated.items[0].foregroundRunningCount, 0);
  assert.equal(updated.items[0].backgroundRunningCount, 1);
  assert.equal(updated.items[0].backgroundConversationCount, 2);
});
