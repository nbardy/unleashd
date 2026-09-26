import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { type TeamSetupResult, formatBuddyTeamConfigurationToolResult } from '@unleashd/shared';
// biome-ignore lint/correctness/noUnusedImports: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { ChannelMarkdown } = await import('../src/components/buddies/ChannelMarkdown');

// Regression, #buddies-dev 2026-09-24: a mention reply is the Buddy's final
// assistant message with the provider's tool summaries embedded, and the
// channel painted every `🔧 …` / `⚡ Bash …` line raw above the answer. Runs
// must collapse into the chat's "N tool calls" disclosure, closed by default.
test('tool-call lines in a post collapse into the chat activity disclosure', () => {
  const body = [
    '🔧 ToolSearch select:mcp__unleashd_buddy__get_thread,mcp__unleashd_buddy__get_inbox',
    '🔧 mcp__unleashd_buddy__get_thread',
    '⚡ Bash cd /Users/nicholasbardy/git/unleashd; rg -n "new_list" product/buddies',
    'Four channels are up. Next I am posting each open Task.',
    '🔧 mcp__unleashd_buddy__post',
    '🔧 mcp__unleashd_buddy__post',
    'Because only one has ever been **created**.',
  ].join('\n');
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ChannelMarkdown body={body} buddyNames={{}} tasks={new Map()} />
    </MemoryRouter>
  );
  const toggles = [...html.matchAll(/class="chat-activity-toggle"[^>]*>(.*?)<\/button>/g)].map(
    (match) => match[1].replace(/<[^>]+>/g, '').replace('▸', '')
  );
  assert.deepEqual(toggles, ['3 tool calls', '2 tool calls']);
  assert.doesNotMatch(html, /mcp__unleashd_buddy/);
  assert.doesNotMatch(html, /🔧|⚡/);
  assert.match(html, /Four channels are up/);
  assert.match(html, /<strong>created<\/strong>/);
});

// Owner report, #buddies-dev 2026-09-24: a Task ref inside a sentence was a
// full-width wrapping pill that stranded ", marked ready." on its own line.
// In a sentence it must stay one inline chip in the same paragraph; alone on
// its line it becomes the card (title, status, owner, todo progress).
test('a Task ref is an inline chip in a sentence and a card on its own line', () => {
  const task = {
    id: 'buddy_project_1',
    title: 'Mention replies post the tool-call trace into the channel',
    status: 'ready',
    ownerBuddyId: 'lead',
    ownerName: 'Buddies Development Lead',
    todosDone: 1,
    todosTotal: 5,
    nextAction: null,
    updatedAt: '2026-09-24T10:00:00.000Z',
  };
  const ref = `[${task.title}](task:${task.id})`;
  const render = (body: string) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <ChannelMarkdown body={body} buddyNames={{}} tasks={new Map([[task.id, task]])} />
      </MemoryRouter>
    );

  const inline = render(`I filed that as ${ref}, marked ready.`);
  assert.match(
    inline,
    /^<div class="channel-markdown"><p>I filed that as <button[^>]*class="channel-task-chip"/
  );
  assert.match(inline, /<\/button>, marked ready\.<\/p>/);
  assert.doesNotMatch(inline, /href="\/buddies\//);
  assert.doesNotMatch(inline, /channel-task-block/);

  for (const body of [ref, `- ${ref}\n- ${ref}`]) {
    const block = render(body);
    assert.doesNotMatch(block, /channel-task-chip/);
    assert.match(block, /class="channel-task-block"/);
    assert.match(block, /Ready<span class="channel-task-card-owner"> · Buddies Development Lead/);
    assert.match(block, /width:20%.*1\/5 todos/);
  }
});

const teamResult: TeamSetupResult = {
  workspaceId: 'project_956e40d6',
  contractVersion: '2026-09-12.2',
  key: 'hire-basketball-project-manager-2026-09-24',
  planHash: '0'.repeat(64),
  canApply: true,
  blockers: [],
  effects: [],
  resolvedBuddies: [],
  affectedWork: [],
  receipt: { auditId: 'audit-1', appliedAt: '2026-09-24T15:24:00Z', replayed: false },
  queuedRuns: [],
  readiness: { ready: true, blockers: [], participants: [], messages: [] },
  drift: false,
};

function teamMarker(): string {
  const marker = formatBuddyTeamConfigurationToolResult({
    structuredContent: { teamSetup: teamResult },
  });
  assert.ok(marker, 'canonical team setup formats to a marker');
  return marker;
}

const renderChannel = (body: string) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ChannelMarkdown body={body} buddyNames={{}} tasks={new Map()} />
    </MemoryRouter>
  );

// Owner report 2026-09-24 (#general thread): a mention reply showed the raw
// `<!--buddy_team_configuration:%7B%22…-->` blob under "6 tool calls". The
// /chat path strips structured markers via splitStructuredMessageContent, but
// the channel path only split tool-activity lines, so the marker fell through
// into Markdown and painted raw. Channels must render the same card as chat.
test('a team configuration marker renders the chat card, not the raw blob', () => {
  const html = renderChannel(`Hired the coordinator.\n${teamMarker()}\nWelcome aboard.`);
  assert.match(html, /Team configuration saved/);
  assert.match(html, /Hired the coordinator/);
  assert.match(html, /Welcome aboard/);
  assert.doesNotMatch(html, /buddy_team_configuration/);
  assert.doesNotMatch(html, /%22workspaceId%22/);
});

// Same incident: the painted blob wrapped as `<!--` + newline +
// `buddy_team_configuration:…`, so parsing must tolerate whitespace inside the
// comment delimiters, not just the canonical compact form the server writes.
test('a whitespace-wrapped team configuration marker still renders the card', () => {
  const wrapped = teamMarker().replace('<!--', '<!--\n').replace('-->', '\n-->');
  const html = renderChannel(`Hired the coordinator.\n${wrapped}\nWelcome aboard.`);
  assert.match(html, /Team configuration saved/);
  assert.doesNotMatch(html, /buddy_team_configuration/);
  assert.doesNotMatch(html, /%22workspaceId%22/);
});

// Sibling markers ride the same server injection path (runtime tool.result),
// so none of them may paint raw in a channel either.
test('sibling structured markers never paint raw in channels', () => {
  const question = `<!--ask_user_question:${JSON.stringify({
    questions: [{ question: 'Which opening?', options: [{ label: 'Zone' }] }],
  })}-->`;
  const worker = '<!--buddy_worker_thread:{"conversationId":"w1"}-->';
  const review = [
    '<!-- unleashd:buddy-review-result -->',
    '{"verdict":"pass","summary":"Looks good","evidence":[],"requiredActions":[]}',
    '<!-- /unleashd:buddy-review-result -->',
  ].join('\n');
  const html = renderChannel(`${question}\n${worker}\n${review}\nTip-off at nine.`);
  assert.match(html, /Which opening\?/);
  assert.match(html, /Review result/);
  assert.match(html, /Tip-off at nine/);
  assert.doesNotMatch(html, /ask_user_question/);
  assert.doesNotMatch(html, /buddy_worker_thread/);
  assert.doesNotMatch(html, /buddy-review-result/);
});
