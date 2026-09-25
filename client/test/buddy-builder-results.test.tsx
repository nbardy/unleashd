import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import {
  type BuddyBuilderProject,
  type BuddyBuilderResult,
  formatBuddyBuilderToolResult,
} from '@unleashd/shared';
import { Provider, createStore } from 'jotai';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { archivedBuddyIdsAtom } from '../src/atoms/buddy-visibility';
import { splitStructuredMessageContent } from '../src/utils/structured-message-segments';

// Node renders the real card and router; stylesheet assets are handled by Vite in the app.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { InlineBuddyBuilderResult } = await import(
  '../src/components/buddies/BuddyBuilderResultCard'
);

const result: BuddyBuilderResult = {
  conversationId: 'builder-wave',
  creationKey: 'product',
  buddy: {
    id: 'product',
    project_id: 'wave',
    slug: 'product',
    name: 'Product Lead',
    role: 'Keep the product focused on useful design workflows',
    status: 'active',
    provider: 'codex',
    model: null,
    reasoning_effort: null,
  },
  homeWorkspace: {
    id: 'wave',
    slug: 'wave',
    name: 'Wave simulator',
    root_path: '/tmp/wave_sim',
  },
  workspaces: [],
  followUpQuestions: [],
};

const outreach: BuddyBuilderProject = {
  id: 'outreach',
  buddy_id: 'gtm',
  workspace_id: 'wave',
  parent_project_id: null,
  title: 'Interview customers after demos are ready',
  objective: null,
  definition_of_done: 'Customer interviews completed with recorded findings',
  status: 'blocked',
  blocked_reason: 'Demo videos and the shared inbox must be configured',
  next_action: null,
};

function renderToolResult(value: unknown, archivedIds: string[] = []): string {
  const marker = formatBuddyBuilderToolResult(value);
  assert.ok(marker, 'a successful canonical Builder result reaches the transcript renderer');
  const payload = marker.match(/^<!--buddy_builder_result:(.*)-->$/)?.[1];
  assert.ok(payload);
  const store = createStore();
  store.set(archivedBuddyIdsAtom, new Set(archivedIds));
  return renderToStaticMarkup(
    <Provider store={store}>
      <MemoryRouter>
        <InlineBuddyBuilderResult payload={payload} />
      </MemoryRouter>
    </Provider>
  );
}

test('legacy Builder results still render creation and brief updates without team fields', () => {
  const created = renderToolResult(result);
  assert.match(created, /Created/);
  assert.match(created, /Snapshot when saved/);
  assert.match(created, /href="\/buddies\/product"/);
  const updated = renderToolResult({
    structuredContent: { buddyBuilderEvent: { action: 'updated', result, revision: 2 } },
  });
  assert.match(updated, /Updated/);
  assert.match(updated, /Working brief saved/);
});

test('saved reporting relationships link available staff without linking archived staff', () => {
  const event = {
    action: 'created',
    result: {
      ...result,
      backgroundEnabled: true,
      teamState: {
        employment: { kind: 'direct_report', managerId: 'lead' },
        manager: { id: 'lead', name: 'Project Lead', role: 'Lead', status: 'active' },
        team: [
          { id: 'engineer', name: 'Product Engineer', role: 'Engineer', status: 'active' },
          { id: 'designer', name: 'Product Designer', role: 'Designer', status: 'archived' },
        ],
        hiring: { quota: 2, held: 1, available: 1 },
      },
    },
  };
  const visible = renderToolResult({ buddyBuilderEvent: event });
  assert.match(visible, /Reports to <a[^>]*href="\/buddies\/lead"/);
  assert.match(visible, /Can respond to team messages/);
  assert.match(visible, /href="\/buddies\/engineer"/);
  assert.match(visible, /Product Designer \(archived\)/);
  assert.doesNotMatch(visible, /href="\/buddies\/designer"/);
  const locallyArchived = renderToolResult({ buddyBuilderEvent: event }, ['lead', 'engineer']);
  assert.doesNotMatch(locallyArchived, /href="\/buddies\/(lead|engineer)"/);
});

test('saved work renders canonical blockers and the Work route without claiming a brief update', () => {
  const html = renderToolResult({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          buddyBuilderEvent: {
            action: 'work_created',
            result: { ...result, projects: [outreach] },
            project: outreach,
          },
        }),
      },
    ],
  });
  assert.match(html, /Work saved/);
  assert.match(html, /Snapshot when saved/);
  assert.match(html, /href="\/buddies\/gtm\/work"/);
  assert.match(html, /Blocked: Demo videos and the shared inbox must be configured/);
  assert.equal((html.match(/>Interview customers after demos are ready<\/a>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Working brief saved|Buddy updated/);
});

test('the compact result replaces only its adjacent generic MCP tool label', () => {
  const marker = formatBuddyBuilderToolResult(result)!;
  const segments = splitStructuredMessageContent(
    `Before\n🔧 unrelated_tool\n🔧 mcp_tool\n\n${marker}\nAfter`
  );
  assert.equal(segments.filter((segment) => segment.type === 'buddy_builder_result').length, 1);
  const text = segments
    .filter((segment) => segment.type === 'text')
    .map((segment) => segment.content)
    .join('');
  assert.doesNotMatch(text, /mcp_tool/);
  assert.match(text, /unrelated_tool/);
  assert.match(text, /Before/);
  assert.match(text, /After/);
  assert.deepEqual(splitStructuredMessageContent('🔧 mcp_tool\nTool failed'), [
    { type: 'text', content: '🔧 mcp_tool\nTool failed' },
  ]);
  const html = renderToolResult(result);
  assert.match(html, /popover="auto"/);
  assert.match(html, /popoverTarget=/i);
  assert.match(html, /aria-label="Details for Product Lead"/);
  assert.match(html, /Saved configuration/);
});
