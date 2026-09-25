import assert from 'node:assert/strict';
import test from 'node:test';
import { type ConversationRow, createDefaultConversationConfig } from '@unleashd/shared';
import { createStore } from 'jotai';
import { buddySidebarAtom, buddySidebarOverviewAtom } from '../src/atoms/buddy-sidebar';
import {
  type CreateCommand,
  commandsAtom,
  listIndexAtom,
  rowFamily,
  rowsAtom,
} from '../src/atoms/conversations';
import { syntheticConversation } from './fixtures/synthetic-conversations';

// The sidebar's overview slice: workspaces with their Buddies (status decides the roster).
const roster = (
  id: string,
  name: string,
  rootPath: string,
  buddies: Array<[id: string, name: string]>
) => ({
  id,
  name,
  rootPath,
  buddies: buddies.map(([buddyId, buddyName]) => ({
    id: buddyId,
    name: buddyName,
    status: 'active' as const,
  })),
});

test('only roster memberships create workspace rows; orphan history remains accessible', () => {
  const store = createStore();
  const make = (id: string, buddyId: string, workspaceId: string) =>
    buddyRow(id, buddyId, workspaceId, { run: 'running' });
  const live = make('owner-thread', 'lead', 'work');
  const orphan = make('imported-test', 'missing', 'project_uuid');
  const detached = make('detached-thread', 'lead', 'other');
  const wrongBuddy = make('missing-buddy-thread', 'missing', 'work');
  const conversations = new Map([live, orphan, detached, wrongBuddy].map((c) => [c.id, c]));
  store.set(rowsAtom, conversations);
  // WS history may arrive before the roster. Never flash synthetic folders.
  assert.deepEqual(store.get(buddySidebarAtom).projects, []);
  const pending = [live, orphan, detached].map(
    (c): CreateCommand => ({
      tag: 'create',
      commandId: `create-${c.id}`,
      conversationId: `pending-${c.id}`,
      args: {
        kind: {
          t: 'buddy',
          context: {
            buddyId: c.id === orphan.id ? 'missing' : 'lead',
            workspaceId:
              c.id === orphan.id ? 'project_uuid' : c.id === detached.id ? 'other' : 'work',
          },
        },
        config: createDefaultConversationConfig('codex'),
        workingDirectory: '/work',
      },
      createdAt: Date.parse('2026-09-13'),
      state: { tag: 'sent' },
    })
  );
  store.set(commandsAtom, new Map(pending.map((p) => [p.commandId, p])));
  const overview = [
    roster('work', 'Real workspace', '/work', [['lead', 'Real Lead']]),
    roster('other', 'Other', '/other', [['other-lead', 'Other Lead']]),
  ];
  store.set(buddySidebarOverviewAtom, overview);
  const projects = store.get(buddySidebarAtom).projects;
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
  assert.equal(store.get(buddySidebarAtom).buddyCount, 2);
  assert.equal(store.get(rowFamily(orphan.id)), orphan);
  assert.equal(store.get(listIndexAtom).order.length, 4);

  // Newly saved membership makes an already-imported thread visible on refresh.
  store.set(buddySidebarOverviewAtom, [
    ...overview,
    roster('project_uuid', 'Recovered workspace', '/recovered', [['missing', 'Recovered Lead']]),
  ]);
  const recovered = store
    .get(buddySidebarAtom)
    .projects.find((p) => p.workspaceId === 'project_uuid');
  assert.equal(recovered?.name, 'Recovered workspace');
  assert.deepEqual(
    recovered?.items[0].conversations.map((c) => c.id),
    [orphan.id]
  );

  // Removing that membership and receiving another snapshot cannot resurrect it.
  store.set(buddySidebarOverviewAtom, overview);
  store.set(rowsAtom, new Map(conversations));
  assert.deepEqual(
    store.get(buddySidebarAtom).projects.map((p) => p.name),
    ['Real workspace', 'Other']
  );
  assert.equal(store.get(rowFamily(orphan.id)), orphan);
});

test('sidebar groups Buddies by workspace and orders projects by their threads', () => {
  const store = createStore();
  store.set(buddySidebarOverviewAtom, [
    roster('a', 'Alpha', '/alpha', [['lead-a', 'Lead A']]),
    roster('b', 'Beta', '/beta', [['lead-b', 'Lead B']]),
    roster('c', 'Cold', '/cold', [['new', 'New Buddy']]),
  ]);
  const conversation = (id: string, workspaceId: string, date: string) =>
    buddyRow(id, `lead-${workspaceId}`, workspaceId, {
      createdAt: Date.parse(date),
      activityAt: Date.parse(date),
      cwd: `/${workspaceId}`,
    });
  const a = conversation('thread-a', 'a', '2026-09-01');
  const b = conversation('thread-b', 'b', '2026-09-08');
  store.set(
    rowsAtom,
    new Map([
      [a.id, a],
      [b.id, b],
    ])
  );
  const projects = store.get(buddySidebarAtom).projects;
  assert.deepEqual(
    projects.map((p) => p.name),
    ['Beta', 'Alpha', 'Cold']
  );
  assert.deepEqual(
    projects.slice(0, 2).map((p) => p.items.map((i) => i.buddyId)),
    [['lead-b'], ['lead-a']]
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
  assert.equal(store.get(buddySidebarAtom).buddyCount, 3);
  assert.equal(projects[2].items[0].latestConversation, null);
  store.set(
    rowsAtom,
    new Map([
      [a.id, { ...a, activityAt: Date.parse('2026-09-09') }],
      [b.id, b],
    ])
  );
  assert.equal(store.get(buddySidebarAtom).projects[0].name, 'Alpha');
});

test('Builder joins project recency ordering and moves when an older thread receives a message', () => {
  const store = createStore();
  store.set(buddySidebarOverviewAtom, [
    roster('project', 'Project', '/project', [['lead', 'Lead']]),
  ]);
  const conversation = (id: string, date: string, builder = false) =>
    buddyRow(id, 'lead', 'project', {
      ...(builder ? { kind: { t: 'builder' as const } } : {}),
      createdAt: Date.parse(date),
      activityAt: Date.parse(date),
    });
  const project = conversation('project-thread', '2026-09-08');
  const older = conversation('older-builder', '2026-09-01', true);
  const newer = conversation('newer-builder', '2026-09-07', true);
  const hiddenWorker = {
    ...conversation('worker', '2026-09-10', true),
    kind: { t: 'worker' as const, swarmId: null, workerId: null, role: null },
  };
  const child = { ...conversation('child', '2026-09-10', true), parent: older.id };
  const conversations = new Map([project, older, newer, hiddenWorker, child].map((c) => [c.id, c]));
  store.set(rowsAtom, conversations);
  assert.deepEqual(
    store.get(buddySidebarAtom).groups.map((group) => group.kind),
    ['project', 'builder']
  );
  assert.deepEqual(
    store.get(listIndexAtom).builders.map((c) => c.id),
    ['newer-builder', 'older-builder']
  );

  store.set(
    rowsAtom,
    new Map(conversations).set(older.id, { ...older, activityAt: Date.parse('2026-09-09') })
  );
  assert.deepEqual(
    store.get(buddySidebarAtom).groups.map((group) => group.kind),
    ['builder', 'project']
  );
  assert.deepEqual(
    store.get(listIndexAtom).builders.map((c) => c.id),
    ['older-builder', 'newer-builder']
  );

  store.set(rowsAtom, new Map([[project.id, project]]));
  assert.deepEqual(
    store.get(buddySidebarAtom).groups.map((group) => group.kind),
    ['project']
  );
});

test('sidebar exposes active process counts at project-folder scope', () => {
  const store = createStore();
  store.set(buddySidebarOverviewAtom, [
    roster('wave', 'wave_sim', '/repo/wave_sim', [['lead', 'Lead']]),
  ]);
  const conversation = (input: Partial<ConversationRow> & Pick<ConversationRow, 'id'>) =>
    syntheticConversation(1, {
      createdAt: Date.parse('2026-09-12T00:00:00.000Z'),
      activityAt: Date.parse('2026-09-12T00:00:00.000Z'),
      cwd: '/repo/wave_sim',
      kind: { t: 'chat' },
      ...input,
    });
  const buddyForeground = conversation({
    id: 'buddy-foreground',
    run: 'running',
    kind: { t: 'buddy', buddyId: 'lead', workspaceId: 'wave', visibility: 'foreground' },
  });
  const buddyBackground = conversation({
    id: 'buddy-background',
    run: 'running',
    kind: { t: 'buddy', buddyId: 'lead', workspaceId: 'wave', visibility: 'background' },
  });
  const regular = conversation({ id: 'regular', run: 'running' });
  store.set(
    rowsAtom,
    new Map([buddyForeground, buddyBackground, regular].map((entry) => [entry.id, entry] as const))
  );

  assert.equal(store.get(buddySidebarAtom).projects[0].runningCount, 2);
  const item = store.get(buddySidebarAtom).projects[0].items[0];
  assert.equal(item.foregroundRunningCount, 1);
  assert.equal(item.backgroundRunningCount, 1);
  assert.equal(item.backgroundConversationCount, 1);
  assert.equal(store.get(listIndexAtom).runningByFolder.get('/repo/wave_sim'), 1);

  // A background task linked to an owner chat still counts. Idle history and
  // a task in another workspace do not inflate this Buddy row's live counts.
  store.set(
    rowsAtom,
    new Map([
      [buddyForeground.id, { ...buddyForeground, run: 'idle' as const }],
      [buddyBackground.id, { ...buddyBackground, parent: buddyForeground.id }],
      ['past', { ...buddyBackground, id: 'past', run: 'idle' as const }],
      [
        'other-workspace',
        {
          ...buddyBackground,
          id: 'other-workspace',
          kind: {
            t: 'buddy' as const,
            buddyId: 'lead',
            workspaceId: 'other',
            visibility: 'background' as const,
          },
        },
      ],
    ])
  );
  const updated = store.get(buddySidebarAtom).projects[0];
  assert.equal(updated.runningCount, 1);
  assert.equal(updated.items[0].foregroundRunningCount, 0);
  assert.equal(updated.items[0].backgroundRunningCount, 1);
  assert.equal(updated.items[0].backgroundConversationCount, 2);
});

function buddyRow(
  id: string,
  buddyId: string,
  workspaceId: string,
  overrides: Partial<ConversationRow> = {}
): ConversationRow {
  return syntheticConversation(1, {
    id,
    kind: { t: 'buddy', buddyId, workspaceId, visibility: 'foreground' },
    createdAt: Date.parse('2026-09-13'),
    activityAt: Date.parse('2026-09-13'),
    ...overrides,
  });
}
