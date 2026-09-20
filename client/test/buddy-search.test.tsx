import assert from 'node:assert/strict';
import test from 'node:test';
// biome-ignore lint/correctness/noUnusedImports: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BuddyDirectory } from '../src/components/buddies/BuddyDirectory';
import type { BuddyOverview, BuddyOverviewEmployee } from '../src/components/buddies/types';
import { filterDirectoryEmployees } from '../src/components/buddies/ui-contract';

const employee: BuddyOverviewEmployee = {
  buddy: {
    id: 'buddy-product',
    name: 'Product Lead',
    role: 'Owns roadmap and release planning',
    status: 'active',
    manager_id: null,
    soul_path: null,
    memory_path: null,
    provider: 'codex',
    model: 'gpt-6-astra',
    reasoning_effort: 'high',
  },
  employment: { kind: 'top_level' },
  workspaces: [{ id: 'workspace-1', name: 'Unleashd', root_path: '/tmp/unleashd' }],
  team: [{ id: 'buddy-design', name: 'Design Buddy', role: 'Design', status: 'active' }],
  currentWork: { open: 2, active: 1, blocked: 0, review: 0, nextActionMissing: 0 },
};

const overview: BuddyOverview = {
  generatedAt: '2026-09-06T00:00:00.000Z',
  employees: [employee],
  topLevel: [employee],
  recentRuns: [],
};

function renderDirectoryWithTeam(team: BuddyOverviewEmployee['team']) {
  const manager = { ...employee, team };
  const view = { ...overview, employees: [manager], topLevel: [manager] };
  return renderToStaticMarkup(
    <MemoryRouter>
      <BuddyDirectory overview={view} onOpen={() => {}} onNew={() => {}} creating={false} />
    </MemoryRouter>
  );
}

test('Buddy directory exposes a search control in its rendered page', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <BuddyDirectory overview={overview} onOpen={() => {}} onNew={() => {}} creating={false} />
    </MemoryRouter>
  );

  assert.match(html, /placeholder="Search buddies…"/);
  assert.match(html, /Product Lead/);
});

test('Buddy directory search matches role, workspace, and report metadata', () => {
  assert.deepEqual(filterDirectoryEmployees([employee], 'release planning'), [employee]);
  assert.deepEqual(filterDirectoryEmployees([employee], 'unleashd'), [employee]);
  assert.deepEqual(filterDirectoryEmployees([employee], 'design buddy'), [employee]);
  assert.deepEqual(filterDirectoryEmployees([employee], 'missing'), []);
});

test('Buddy directory omits the report badge when every direct report is archived', () => {
  const html = renderDirectoryWithTeam([
    { id: 'buddy-former', name: 'Former Buddy', role: 'Design', status: 'archived' },
  ]);

  assert.match(html, /Product Lead/);
  assert.doesNotMatch(html, />\d+ reports</);
});

test('Buddy directory counts active and paused reports but excludes archived reports', () => {
  const html = renderDirectoryWithTeam([
    { id: 'buddy-active', name: 'Active Buddy', role: 'Design', status: 'active' },
    { id: 'buddy-paused', name: 'Paused Buddy', role: 'Research', status: 'paused' },
    { id: 'buddy-archived', name: 'Archived Buddy', role: 'Writing', status: 'archived' },
  ]);

  assert.match(html, />2 reports</);
  assert.doesNotMatch(html, />3 reports</);
});
