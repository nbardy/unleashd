import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
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
