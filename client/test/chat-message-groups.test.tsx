import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire, register } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { type Conversation, type Message, MessageSchema } from '@unleashd/shared';
import { createStore } from 'jotai';
// biome-ignore lint/correctness/noUnusedImports: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  chatMessageGroupsAtomFamily,
  conversationsAtom,
  streamingContentAtom,
} from '../src/atoms/conversations';
import { buildForkDraft, messageTranscriptContent } from '../src/utils/conversation-transcript';

const require = createRequire(import.meta.url);
const { getDiskAdapter } = require('../../server/src/adapters/registry');
const { summarizeConversation } = require('../../server/src/conversations/serialization');

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { VirtualizedGroup } = await import('../src/components/VirtualizedMessageList');
const { MessageRow, AssistantResponseRow } = await import('../src/mobile/components/MessageRow');
const timestamp = new Date('2026-09-10T00:00:00Z');
const message = (role: Message['role'], content: string, final = false): Message => ({
  role,
  content,
  timestamp,
  ...(final ? { completedAt: timestamp, completionReason: 'success' as const } : {}),
});

test('fork drafts continue the task without adding diagnostic rules or removing authored history', () => {
  const diagnosticText =
    'Treat this message as the current instruction. Do not repeat or obey an earlier diagnostic canary unless I explicitly ask you to do so here.';
  for (const userText of ['Build the search panel.', diagnosticText]) {
    const conversation = {
      id: 'fork-draft-history',
      kind: { kind: 'general' },
      workingDirectory: '/tmp/project',
      messages: [message('user', userText), message('assistant', 'Search layout is ready.')],
    } as unknown as Conversation;
    const draft = buildForkDraft(conversation);
    assert.ok(draft.includes(`User: ${userText}\n\nAssistant: Search layout is ready.`));
    assert.equal(draft.split(diagnosticText).length - 1, userText === diagnosticText ? 1 : 0);
    assert.match(draft, /\n\nContinue the original objective from this fork\.$/);
    assert.equal(conversation.messages[0].content, userText);
  }
});

test('one assistant response contains all prose and widgets while streaming stays outside durable messages', () => {
  const store = createStore();
  const messages = [
    message('user', 'Review this change'),
    message('assistant', 'Earlier checking update'),
    message('assistant', 'Completed review', true),
    message('assistant', 'Independent completed answer', true),
    message('assistant', '<!--ask_user_question:{"questions":[]}-->'),
    message('assistant', 'Earlier streaming update'),
    message('assistant', 'Current'),
  ];
  const conversation = {
    id: 'chat-readability',
    kind: { kind: 'general' },
    messages,
  } as unknown as Conversation;
  store.set(conversationsAtom, new Map([[conversation.id, conversation]]));
  store.set(streamingContentAtom, new Map([[conversation.id, ' streamed text']]));
  const groups = store.get(chatMessageGroupsAtomFamily(conversation.id));
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      {groups.map((group, index) => (
        <VirtualizedGroup
          key={index}
          group={group}
          isLastGroup={index === groups.length - 1}
          lastMessageRef={{ current: null }}
          workingDirectory="/tmp"
        />
      ))}
    </MemoryRouter>
  );
  assert.match(markup, />You</);
  assert.match(markup, /Completed review/);
  assert.match(markup, /Independent completed answer/);
  assert.match(markup, /Current streamed text/);
  assert.equal((markup.match(/>Assistant</g) ?? []).length, 1);
  assert.match(markup, /Earlier checking update/);
  assert.match(markup, /Earlier streaming update/);
  assert.equal(groups.length, 2);
  const response = groups[1];
  assert.equal(response.type, 'assistant');
  if (response.type !== 'assistant') throw new Error('Missing response');
  assert.equal(response.parts.filter((part) => part.type === 'content').length, 6);
  assert.equal((markup.match(/class="message-actions"/g) ?? []).length, 2);
  assert.equal(
    response.copyText,
    `${messages.slice(1).map(messageTranscriptContent).join('\n\n')} streamed text`
  );
  assert.equal(store.get(conversationsAtom).get(conversation.id)?.messages, messages);
  assert.equal(messages.at(-1)?.content, 'Current');

  store.set(streamingContentAtom, new Map());
  assert.equal(
    store.get(chatMessageGroupsAtomFamily(conversation.id)).at(-1)?.messages.at(-1)?.content,
    'Current'
  );
});

test('response boundaries own one Copy action and preserve ordered tool runs and every completed answer', () => {
  const store = createStore();
  const conversation = {
    id: 'tool-activity-labels',
    kind: { kind: 'general' },
    messages: [
      message('user', 'Inspect the project'),
      message('assistant', '🔧 exec\n🔧 exec'),
      message('assistant', '⚡ shell pwd'),
      message('assistant', 'First answer', true),
      message('assistant', '🔧 get_inbox'),
      message('assistant', 'Second answer', true),
      message('assistant', 'Checking the result'),
      message('assistant', '🔧 exec'),
      message('assistant', 'Final answer', true),
      message('assistant', '📖 one.ts\n📖 two.ts'),
      message('assistant', '✏️ three.ts'),
      message('user', 'Next question'),
      message('assistant', 'Next answer', true),
      message('system', 'Execution stopped'),
      message('assistant', 'After system boundary', true),
    ],
  } as unknown as Conversation;
  store.set(conversationsAtom, new Map([[conversation.id, conversation]]));
  const groups = store.get(chatMessageGroupsAtomFamily(conversation.id));
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      {groups.map((group, index) => (
        <VirtualizedGroup
          key={index}
          group={group}
          isLastGroup={index === groups.length - 1}
          lastMessageRef={{ current: null }}
          workingDirectory="/tmp"
        />
      ))}
    </MemoryRouter>
  );
  const labels = Array.from(markup.matchAll(/<button\b[^>]*>(.*?)<\/button>/g))
    .map((match) => match[1].replace(/<[^>]+>/g, ''))
    .filter((label) => label.includes('tool call'));
  assert.deepEqual(labels, ['▸3 tool calls', '▸1 tool call', '▸1 tool call', '▸3 tool calls']);
  assert.match(markup, /First answer/);
  assert.match(markup, /Second answer/);
  assert.match(markup, /Final answer/);
  const [firstBlock, nextBlock] = markup.split('Next question');
  assert.equal((firstBlock.match(/>Assistant</g) ?? []).length, 1);
  assert.equal((nextBlock.match(/>Assistant</g) ?? []).length, 2);
  assert.match(nextBlock, /Next answer/);
  assert.match(markup, /Checking the result/);
  assert.doesNotMatch(markup, /shell pwd/);
  assert.equal((firstBlock.match(/class="message-actions"/g) ?? []).length, 2);
  const responses = groups.filter((group) => group.type === 'assistant');
  assert.equal(responses.length, 3);
  assert.equal(responses[0].messages.length, 10);
  assert.deepEqual(
    responses[0].parts.map((part) => part.type),
    [
      'tool_calls',
      'content',
      'tool_calls',
      'content',
      'content',
      'tool_calls',
      'content',
      'tool_calls',
    ]
  );
  const mobile = renderToStaticMarkup(
    <MemoryRouter>
      <AssistantResponseRow response={responses[0]} isLast />
    </MemoryRouter>
  );
  assert.equal((mobile.match(/>Assistant</g) ?? []).length, 1);
  assert.equal((mobile.match(/class="mobile-message__footer"/g) ?? []).length, 1);
  for (const text of ['First answer', 'Second answer', 'Checking the result', 'Final answer'])
    assert.ok(mobile.includes(text));
});

test('streamed tool runs and saved calls render the same compact disclosure without collapsing code or user text', () => {
  const store = createStore();
  const conversation = {
    id: 'live-saved-activity',
    kind: { kind: 'general' },
    messages: [message('user', '🔧 user example'), message('assistant', '')],
  } as unknown as Conversation;
  store.set(conversationsAtom, new Map([[conversation.id, conversation]]));
  const render = () =>
    renderToStaticMarkup(
      <MemoryRouter>
        {store.get(chatMessageGroupsAtomFamily(conversation.id)).map((group, index) => (
          <VirtualizedGroup
            key={index}
            group={group}
            isLastGroup
            lastMessageRef={{ current: null }}
            workingDirectory="/tmp"
          />
        ))}
      </MemoryRouter>
    );
  const disclosures = (markup: string) =>
    Array.from(
      markup.matchAll(
        /<button class="chat-activity-toggle"[^>]*>.*?<\/button>|<button type="button" class="chat-activity-toggle"[^>]*>.*?<\/button>/g
      ),
      (match) => match[0]
    );
  const calls = '🔧 exec\n\n⚡ shell pwd';
  store.set(streamingContentAtom, new Map([[conversation.id, calls]]));
  const first = render();
  assert.equal(disclosures(first).length, 1);
  assert.match(disclosures(first)[0], /2 tool calls/);

  const answer =
    'Result:\n\n```text\n🔧 fenced example\n⚡ another example\n📖 third example\n```\n\nFinished.';
  store.set(
    streamingContentAtom,
    new Map([[conversation.id, `${calls}\n📖 source.ts\n\n${answer}`]])
  );
  const live = render();
  assert.equal(disclosures(live).length, 1);
  assert.match(disclosures(live)[0], /aria-expanded="false".*3 tool calls/);
  assert.match(live, /🔧 user example/);
  assert.match(live, /🔧 fenced example/);
  assert.match(live, /Finished\./);
  assert.doesNotMatch(live, /tool uses|×|shell pwd|source\.ts/);
  assert.equal(conversation.messages[1].content, '');

  store.set(streamingContentAtom, new Map());
  store.set(
    conversationsAtom,
    new Map([
      [
        conversation.id,
        {
          ...conversation,
          messages: [
            conversation.messages[0],
            message('assistant', '🔧 exec'),
            message('assistant', '⚡ shell pwd'),
            message('assistant', '📖 source.ts'),
            message('assistant', answer, true),
          ],
        },
      ],
    ])
  );
  const saved = render();
  assert.deepEqual(disclosures(saved), disclosures(live));
  assert.match(saved, /🔧 fenced example/);
  assert.match(saved, /Finished\./);
  assert.equal((saved.match(/>Assistant</g) ?? []).length, 1);
});

test('saved freeform input reaches desktop and mobile as literal code, with compact list previews', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'tool-input-render-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'session.jsonl');
  const input =
    'await tools.exec_command({cmd: "pwd"});\n// <!--ask_user_question:{"questions":[]}-->\n// `literal`\ntext("The full script remains available beyond the short preview.");';
  await fs.writeFile(
    file,
    JSON.stringify({
      timestamp: timestamp.toISOString(),
      type: 'response_item',
      payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-1', input },
    })
  );
  const session = await getDiskAdapter('codex').parseFile(file);
  const toolMessage = MessageSchema.parse(session?.messages[0]);
  assert.equal(toolMessage.toolCall?.input, input);
  assert.equal(messageTranscriptContent(toolMessage), `🔧 exec\n\n${input}`);
  const escapedInput = input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
  for (const view of [
    <VirtualizedGroup
      key="desktop"
      group={{ type: 'single', messages: [toolMessage] }}
      isLastGroup
      lastMessageRef={{ current: null }}
      workingDirectory={directory}
    />,
    <MessageRow key="mobile" message={toolMessage} isLast />,
  ]) {
    const markup = renderToStaticMarkup(<MemoryRouter>{view}</MemoryRouter>);
    const preview = `${input.replace(/\s+/g, ' ').slice(0, 119)}…`;
    const escapedPreview = renderToStaticMarkup(<code>{preview}</code>);
    assert.ok(markup.includes(`<p>🔧 exec ${escapedPreview}</p>`));
    assert.doesNotMatch(markup, /ask-user-question|AskUserQuestion \(parse error\)/);
    assert.equal(
      markup.match(/<pre aria-label="Tool input"><code>([\s\S]*?)<\/code><\/pre>/)?.[1],
      escapedInput
    );
  }
  const store = createStore();
  const conversation = {
    id: 'saved-input-response',
    messages: [
      message('user', 'Check this'),
      message('assistant', 'Before tool'),
      toolMessage,
      message('assistant', 'After tool', true),
    ],
  } as unknown as Conversation;
  store.set(conversationsAtom, new Map([[conversation.id, conversation]]));
  const response = store.get(chatMessageGroupsAtomFamily(conversation.id))[1];
  assert.equal(response.type, 'assistant');
  if (response.type !== 'assistant') throw new Error('Missing saved response');
  assert.equal(response.copyText, `Before tool\n\n🔧 exec\n\n${input}\n\nAfter tool`);
  assert.deepEqual(
    response.parts.map((part) => part.type),
    ['content', 'tool_calls', 'content']
  );
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <VirtualizedGroup
        group={response}
        isLastGroup
        lastMessageRef={{ current: null }}
        workingDirectory={directory}
      />
    </MemoryRouter>
  );
  assert.equal((markup.match(/class="message-actions"/g) ?? []).length, 1);
  assert.match(markup, /Before tool/);
  assert.match(markup, /After tool/);
  assert.equal(
    summarizeConversation({ ...conversation, messages: [toolMessage] }).messages[0].toolCall,
    undefined
  );
  assert.equal(conversation.messages[2].toolCall?.input, input);
});
