import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import type { ConversationConfig, ConversationConfigState } from '@unleashd/shared';
import express from 'express';
import { WAKE_MESSAGE, createBuddyDirect } from '../src/buddies/buddy-direct';
import { createChannelResponder } from '../src/buddies/channel-responder';
import { registerChannelRoutes } from '../src/buddies/channel-routes';
import type { BuddiesStorePort, BuddyMailingListPost } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { BuddyOperationsService } from '../src/buddies/operations';
import { registerBuddyRoutes } from '../src/buddies/routes';
import { configFromProviderPreferences } from '../src/conversations/config-mapping';
import { ConversationConfigService } from '../src/conversations/config-service';
import { ConversationConfigStore } from '../src/conversations/config-store';
import type { ConversationRuntime } from '../src/conversations/runtime';
import { updateRuntimeConfig } from '../src/conversations/runtime-config';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

// End-to-end channel conversation: owner posts through the real routes into a
// real store, @mentions start a turn, and the Buddy's final answer lands in the
// thread. The provider turn is the only stand-in (the model is the external
// boundary); the fake runtime exposes exactly the surface the responder drives.

// Configuration is real: the runtime holds the persisted config state and the
// responder changes it through the same updateRuntimeConfig path as the chat.
class FakeTurnRuntime extends EventEmitter {
  isRunning = false;
  queue: unknown[] = [];
  prompts: Array<{ content: string; ownerInput: unknown }> = [];
  enqueued: Array<{ content: string; ownerInput: unknown }> = [];
  config!: ConversationConfig;
  configRevision = 0;
  configResolution!: ConversationConfigState['resolution'];
  constructor(readonly id: string) {
    super();
  }
  applyConfigState(state: ConversationConfigState) {
    this.config = state.config;
    this.configRevision = state.revision;
    this.configResolution = state.resolution;
  }
  // A provider session exists once the first turn was sent.
  hasStartedSession() {
    return this.prompts.length > 0;
  }
  hasActiveProcess() {
    return false;
  }
  async waitForTurnDrain() {}
  sendMessage(content: string, ownerInput: unknown) {
    this.prompts.push({ content, ownerInput });
  }
  enqueueMessage(content: string, ownerInput: unknown) {
    this.enqueued.push({ content, ownerInput });
  }
}

async function until<T>(read: () => T | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function harness() {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const workspace = raw.createWorkspace({ name: 'Team', rootPath: '/tmp/team' });
  const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Answer' });
  const elsewhere = raw.createWorkspace({ name: 'Other', rootPath: '/tmp/other' });
  const outsider = raw.createBuddy({ project: elsewhere.id, name: 'Outsider', role: 'Other' });
  const scratch = mkdtempSync(join(tmpdir(), 'channel-conv-'));
  const uploadsRoot = join(scratch, 'uploads');
  const runtimes = new Map<string, FakeTurnRuntime>();
  const created: string[] = [];
  const deleted = new Set<string>();
  const configService = new ConversationConfigService({
    store: new ConversationConfigStore({ appDataRoot: join(scratch, 'config') }),
    resolver: { resolve: async (config) => resolveConfigAgainstProviderCatalog(config) },
  });
  // Mirrors createServerBuddyConversation: an explicit config wins, else the
  // Buddy profile default (these test Buddies have none, so Codex).
  const createRuntime = async (input: { conversationId: string; config?: ConversationConfig }) => {
    created.push(input.conversationId);
    const runtime = new FakeTurnRuntime(input.conversationId);
    runtime.applyConfigState(
      await configService.create({
        conversationId: input.conversationId,
        config: input.config ?? configFromProviderPreferences({ provider: 'codex' }),
      })
    );
    runtimes.set(input.conversationId, runtime);
    return runtime as unknown as ConversationRuntime;
  };
  const getRuntime = (id: string) => runtimes.get(id) as unknown as ConversationRuntime | undefined;
  const app = express();
  app.use(express.json());
  const sendError = (response: express.Response, error: unknown, fallbackStatus: number) =>
    response
      .status(fallbackStatus)
      .json({ error: error instanceof Error ? error.message : String(error) });
  registerBuddyRoutes(app, {
    getStore: async () => store,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('not used');
    },
    sendError,
    getNextAutomationRunAt: () => new Date().toISOString(),
    createId: () => 'test-id',
    isConversationDeleted: async () => false,
  });
  registerChannelRoutes(app, {
    getStore: async () => store,
    uploadsRoot,
    sendError,
    responder: createChannelResponder({
      getStore: async () => store,
      getConversation: getRuntime,
      ensureConversationReady: async (conversation) => conversation,
      createConversation: createRuntime,
      setConversationConfig: (conversation, config) =>
        updateRuntimeConfig(configService, conversation, {
          conversationId: conversation.id,
          commandId: `test-${conversation.configRevision}`,
          expectedRevision: conversation.configRevision,
          patch: { kind: 'replace', config },
        }),
      uploadsRoot: () => uploadsRoot,
      logger: { warn: () => undefined },
    }),
    direct: createBuddyDirect({
      getStore: async () => store,
      getConversation: getRuntime,
      ensureConversationReady: async (conversation) => conversation,
      createConversation: createRuntime,
      isConversationDeleted: async (id) => deleted.has(id),
    }),
  });
  return {
    raw,
    workspace,
    lead,
    outsider,
    scratch,
    uploadsRoot,
    runtimes,
    created,
    deleted,
    app,
  };
}

test('owner @mention runs one turn per thread and the answer lands in the thread with its media', async () => {
  const h = harness();
  const server = h.app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (path: string, body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: (await response.json()) as any };
    };

    const { json: listResult } = await call('/api/buddies/lists', {
      workspaceId: h.workspace.id,
      author: { kind: 'owner' },
      key: 'general',
      name: 'general',
      purpose: 'Team chat',
    });
    const list = listResult.list;
    assert.deepEqual(list.createdBy, { kind: 'owner' });
    await call(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'buddy', buddyId: h.lead.id },
      key: 'earlier',
      purpose: 'standup',
      body: 'Shipped the settings page yesterday.',
    });

    const screenshot = join(h.scratch, 'before.png');
    writeFileSync(screenshot, 'png-bytes-before');
    const posted = await call(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'owner' },
      key: 'ask',
      purpose: 'message',
      body: `[@Lead](buddy:${h.lead.id}) does this look right? ![before](${screenshot}) cc [@Outsider](buddy:${h.outsider.id})`,
    });
    assert.equal(posted.status, 201, JSON.stringify(posted.json));
    const root: BuddyMailingListPost = posted.json.post;
    // Local media is copied into the channel and the body points at the copy.
    assert.ok(!root.body.includes(screenshot));
    const copied = /!\[before\]\(([^)]+)\)/.exec(root.body)?.[1] ?? '';
    assert.ok(copied.startsWith(join(h.uploadsRoot, 'channels', list.id)), copied);
    assert.ok(existsSync(copied));
    const [leadMention, outsiderMention] = posted.json.mentions;
    assert.equal(leadMention.status, 'started');
    assert.deepEqual(outsiderMention, {
      buddyId: h.outsider.id,
      status: 'rejected',
      reason: 'Buddy is outside this workspace',
    });

    const runtime = await until(() => h.runtimes.get(leadMention.conversationId), 'runtime');
    const first = await until(() => runtime.prompts[0], 'first prompt');
    assert.deepEqual(first.ownerInput, { origin: 'owner_input', inputId: root.id });
    // Channel context and readable mentions reach the model.
    assert.match(first.content, /Shipped the settings page yesterday/);
    assert.match(first.content, /@Lead does this look right\?/);
    const responding = await call(`/api/buddies/lists/${list.id}/responding`);
    assert.deepEqual(
      responding.json.map((row: { buddyId: string; threadRootId: string }) => [
        row.buddyId,
        row.threadRootId,
      ]),
      [[h.lead.id, root.id]]
    );

    const after = join(h.scratch, 'after.png');
    writeFileSync(after, 'png-bytes-after');
    runtime.emit('buddy-turn-complete', `Close — fixed the spacing. ![after](${after})`);
    const replies = await until(() => {
      const read = h.raw.listThread({ root: root.id }).replies;
      return read.length === 1 ? read : undefined;
    }, 'reply post');
    const [reply] = replies;
    assert.deepEqual(reply.author, { kind: 'buddy', buddyId: h.lead.id });
    assert.equal(reply.purpose, 'reply');
    assert.equal(reply.senderConversationId, leadMention.conversationId);
    assert.ok(!reply.body.includes(after));
    assert.match(reply.body, new RegExp(`channels/${list.id}/[0-9a-f]+\\.png`));
    // The responder clears its entry once the reply is written.
    for (let attempt = 0; ; attempt += 1) {
      const rows = (await call(`/api/buddies/lists/${list.id}/responding`)).json;
      if (rows.length === 0) break;
      assert.ok(attempt < 100, 'responding entry never cleared');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // A follow-up mention in the same thread continues the same transcript;
    // a failed turn is reported in the thread, never swallowed.
    const followUp = await call(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'owner' },
      key: 'follow-up',
      purpose: 'message',
      body: `[@Lead](buddy:${h.lead.id}) and the mobile view?`,
      threadRootId: root.id,
    });
    assert.equal(followUp.json.mentions[0].conversationId, leadMention.conversationId);
    const second = await until(() => runtime.prompts[1], 'second prompt');
    assert.match(second.content, /Close — fixed the spacing/);
    runtime.emit('buddy-turn-failed', 'Buddy provider is unavailable: codex');
    const failed = await until(() => {
      const read = h.raw.listThread({ root: root.id }).replies;
      return read.find((post) => post.purpose === 'reply_failed');
    }, 'failure reply');
    assert.match(failed.body, /provider is unavailable/);
    assert.deepEqual(h.created, [leadMention.conversationId]);

    // Buddy-authored mentions never start turns.
    const buddyMention = await call(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'buddy', buddyId: h.lead.id },
      key: 'buddy-mention',
      purpose: 'message',
      body: `[@Lead](buddy:${h.lead.id}) note to self`,
    });
    assert.deepEqual(buddyMention.json.mentions, []);
    assert.equal(runtime.prompts.length, 2);

    // A missing local file rejects an author-controlled post outright.
    const missing = await call(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'owner' },
      key: 'missing-media',
      purpose: 'message',
      body: `![gone](${join(h.scratch, 'gone.png')})`,
    });
    assert.equal(missing.status, 400);
    assert.match(missing.json.error, /missing/);
  } finally {
    server.close();
    h.raw.close();
    rmSync(h.scratch, { recursive: true, force: true });
  }
});

// The model picked on a mention chip must reach the turn, stick for later
// mentions in the thread, and never silently switch a started thread's
// harness (the provider session cannot move) — that is a visible failure.
test('a mention’s chosen model runs the turn, sticks for the thread, and a harness switch fails visibly', async () => {
  const h = harness();
  const server = h.app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, json: (await response.json()) as any };
    };
    const list = (
      await post('/api/buddies/lists', {
        workspaceId: h.workspace.id,
        author: { kind: 'owner' },
        key: 'models',
        name: 'models',
        purpose: 'Model choice',
      })
    ).json.list;
    const mention = `[@Lead](buddy:${h.lead.id})`;
    const claude = (modelId: string): ConversationConfig => ({
      provider: 'claude',
      model: { mode: 'explicit', modelId },
      reasoning: { mode: 'default' },
    });
    // Buddy-authored thread replies (the owner's follow-ups are replies too).
    const replies = (root: string) =>
      h.raw.listThread({ root }).replies.filter((reply) => reply.author.kind === 'buddy');

    // First mention: the Buddy's profile is Codex; the owner picked Claude.
    const asked = await post(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'owner' },
      key: 'ask',
      purpose: 'message',
      body: `${mention} review this`,
      mentionConfigs: [{ buddyId: h.lead.id, config: claude('fable') }],
    });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    const root = asked.json.post.id;
    const runtime = await until(
      () => h.runtimes.get(asked.json.mentions[0].conversationId),
      'runtime'
    );
    await until(() => runtime.prompts[0], 'first prompt');
    assert.deepEqual(runtime.config, claude('fable'));
    runtime.emit('buddy-turn-complete', 'Looks fine.');
    await until(() => replies(root).length === 1, 'first reply');

    // Same harness, another model: applied before the next turn.
    await post(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'owner' },
      key: 'switch-model',
      purpose: 'message',
      body: `${mention} again, more carefully`,
      threadRootId: root,
      mentionConfigs: [{ buddyId: h.lead.id, config: claude('sonnet') }],
    });
    await until(() => runtime.prompts[1], 'second prompt');
    assert.deepEqual(runtime.config, claude('sonnet'));
    runtime.emit('buddy-turn-complete', 'Checked twice.');
    await until(() => replies(root).length === 2, 'second reply');

    // No choice: the thread keeps what it runs, not the profile's Codex.
    await post(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'owner' },
      key: 'no-choice',
      purpose: 'message',
      body: `${mention} one more`,
      threadRootId: root,
    });
    await until(() => runtime.prompts[2], 'third prompt');
    assert.deepEqual(runtime.config, claude('sonnet'));
    runtime.emit('buddy-turn-complete', 'Done.');
    await until(() => replies(root).length === 3, 'third reply');

    // Another harness on a started thread: no turn, a visible failure reply.
    await post(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'owner' },
      key: 'switch-harness',
      purpose: 'message',
      body: `${mention} try it on codex`,
      threadRootId: root,
      mentionConfigs: [
        { buddyId: h.lead.id, config: configFromProviderPreferences({ provider: 'codex' }) },
      ],
    });
    const failed = await until(
      () => replies(root).find((reply) => reply.purpose === 'reply_failed'),
      'harness failure reply'
    );
    assert.match(failed.body, /keeps its harness/);
    assert.equal(runtime.prompts.length, 3);
    assert.deepEqual(runtime.config, claude('sonnet'));

    // A choice for a Buddy the post does not mention would vanish: 400.
    const stray = await post(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'owner' },
      key: 'stray',
      purpose: 'message',
      body: 'nobody mentioned',
      mentionConfigs: [{ buddyId: h.lead.id, config: claude('fable') }],
    });
    assert.equal(stray.status, 400);
    assert.match(stray.json.error, /not mentioned/);
  } finally {
    server.close();
    h.raw.close();
    rmSync(h.scratch, { recursive: true, force: true });
  }
});

// DM + wake: one ongoing owner conversation per Buddy, reopened with its
// history; wake queues the catch-up instruction there as owner input. Deleting
// the DM must not strand the Buddy — the next open starts a fresh one.
test('DM reopens one conversation, wake queues the catch-up there, and a deleted DM is replaced', async () => {
  const h = harness();
  const server = h.app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, json: (await response.json()) as any };
    };
    const workspace = { workspaceId: h.workspace.id };
    const first = await post(`/api/buddies/${h.lead.id}/direct`, workspace);
    const again = await post(`/api/buddies/${h.lead.id}/direct`, workspace);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(again.json.conversationId, first.json.conversationId);
    assert.deepEqual(h.created, [first.json.conversationId]);

    const woken = await post(`/api/buddies/${h.lead.id}/wake`, workspace);
    assert.equal(woken.status, 202);
    assert.equal(woken.json.conversationId, first.json.conversationId);
    const [queued] = h.runtimes.get(first.json.conversationId)?.enqueued ?? [];
    assert.equal(queued.content, WAKE_MESSAGE);
    assert.equal((queued.ownerInput as { origin: string }).origin, 'owner_input');

    // The owner deletes the DM: its id is tombstoned, the next open is new.
    h.runtimes.delete(first.json.conversationId);
    h.deleted.add(first.json.conversationId);
    const replacement = await post(`/api/buddies/${h.lead.id}/direct`, workspace);
    assert.notEqual(replacement.json.conversationId, first.json.conversationId);
    assert.equal(h.created.length, 2);

    const outsider = await post(`/api/buddies/${h.outsider.id}/wake`, workspace);
    assert.equal(outsider.status, 400);
    assert.match(outsider.json.error, /outside this workspace/);
  } finally {
    server.close();
    h.raw.close();
    rmSync(h.scratch, { recursive: true, force: true });
  }
});

// Posts in one millisecond order by random id; context tests need a real order.
function nextMillisecond() {
  const start = Date.now();
  while (Date.now() === start) {}
}

// The launch prompt is deliberately SHORT: the 10 latest messages with side
// threads collapsed. Anything older is reached through search_posts and
// get_thread, so this test walks that path to a decision buried in a reply
// that the prompt omitted — the case a longer prompt used to paper over.
test('mention context is the latest 10 messages, threads collapsed; search and get_thread reach the rest', async () => {
  const h = harness();
  const server = h.app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ownerPost = async (listId: string, body: Record<string, unknown>) => {
      const response = await fetch(`${base}/api/buddies/lists/${listId}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ author: { kind: 'owner' }, purpose: 'message', ...body }),
      });
      return (await response.json()) as any;
    };
    const { list } = h.raw.createList({
      workspace: h.workspace.id,
      author: { kind: 'owner' },
      key: 'general',
      name: 'general',
      purpose: 'Team chat',
    });
    const lead = { kind: 'buddy', buddyId: h.lead.id } as const;
    const updates: BuddyMailingListPost[] = [];
    for (let n = 1; n <= 12; n += 1) {
      nextMillisecond();
      updates.push(
        h.raw.createPost({
          list: list.id,
          author: lead,
          key: `update-${n}`,
          purpose: 'standup',
          body: `status update ${n}`,
        }).post
      );
    }
    const busy = updates[10];
    for (let n = 1; n <= 12; n += 1) {
      nextMillisecond();
      h.raw.createPost({
        list: list.id,
        author: lead,
        key: `reply-${n}`,
        purpose: 'reply',
        body: n === 2 ? 'Decision: ship on Monday after the review' : `side note ${n}`,
        threadRoot: busy.id,
      });
    }

    nextMillisecond();
    const top = await ownerPost(list.id, {
      key: 'ask',
      body: `[@Lead](buddy:${h.lead.id}) status?`,
    });
    const topRuntime = await until(() => h.runtimes.get(top.mentions[0].conversationId), 'runtime');
    const channelPrompt = (await until(() => topRuntime.prompts[0], 'channel prompt')).content;
    assert.match(channelPrompt, /status update 12\b/);
    assert.match(channelPrompt, /status update 3\b/);
    assert.doesNotMatch(channelPrompt, /status update 2\b/);
    assert.match(
      channelPrompt,
      new RegExp(`\\(${busy.id}\\): status update 11 \\[thread: 12 replies`)
    );
    assert.doesNotMatch(channelPrompt, /side note/);
    topRuntime.emit('buddy-turn-complete', 'All green.');

    nextMillisecond();
    const inThread = await ownerPost(list.id, {
      key: 'thread-ask',
      body: `[@Lead](buddy:${h.lead.id}) when do we ship?`,
      threadRootId: busy.id,
    });
    const threadRuntime = await until(
      () => h.runtimes.get(inThread.mentions[0].conversationId),
      'thread runtime'
    );
    const threadPrompt = (await until(() => threadRuntime.prompts[0], 'thread prompt')).content;
    assert.match(threadPrompt, /status update 11/);
    assert.match(threadPrompt, /2 earlier replies omitted/);
    assert.match(threadPrompt, /side note 12/);
    assert.doesNotMatch(threadPrompt, /ship on Monday/);
    threadRuntime.emit('buddy-turn-complete', 'Checking.');

    await until(
      () => h.raw.listThread({ root: busy.id }).replies.find((post) => post.body === 'Checking.'),
      'thread reply'
    );

    // The Buddy's way back to the omitted decision.
    const operations = new BuddyOperationsService(h.raw as unknown as BuddiesStorePort, {
      buddyId: h.lead.id,
      workspaceId: h.workspace.id,
    });
    const found = operations.execute('buddy.search_posts', { query: 'MONDAY ship' }).data as any;
    assert.equal(found.matches.length, 1);
    const [hit] = found.matches;
    assert.equal(hit.threadRootId, busy.id);
    assert.equal(hit.listName, 'general');
    const thread = operations.execute('buddy.get_thread', { postId: hit.postId }).data as any;
    assert.equal(thread.root.id, busy.id);
    assert.equal(thread.focusPostId, hit.postId);
    assert.ok(
      thread.replies.some((post: BuddyMailingListPost) => /ship on Monday/.test(post.body))
    );
    const bodies = (posts: BuddyMailingListPost[]) => posts.map((post) => post.body);

    // A reply opens centred on itself and pages forward to the end.
    const centred = operations.execute('buddy.get_thread', { postId: hit.postId, limit: 4 })
      .data as any;
    assert.deepEqual(bodies(centred.replies), [
      'side note 1',
      'Decision: ship on Monday after the review',
      'side note 3',
      'side note 4',
    ]);
    assert.equal(centred.older, null);
    const rest = operations.execute('buddy.get_thread', {
      postId: hit.postId,
      after: centred.newer,
      limit: 20,
    }).data as any;
    assert.equal(rest.replies.length, 10);
    assert.equal(rest.replies.at(-1).body, 'Checking.');
    assert.equal(rest.newer, null);

    // The same hit placed in its channel: a reply sits at its root, and the
    // older anchor keeps paging back.
    const around = operations.execute('buddy.get_list', {
      listId: list.id,
      around: hit.postId,
      limit: 4,
    }).data as any;
    assert.deepEqual(bodies(around.posts), [
      `[@Lead](buddy:${h.lead.id}) status?`,
      'status update 12',
      'status update 11',
      'status update 10',
      'status update 9',
    ]);
    assert.equal(around.newer, null);
    const older = operations.execute('buddy.get_list', {
      listId: list.id,
      before: around.older,
      limit: 3,
    }).data as any;
    assert.deepEqual(bodies(older.posts), [
      'status update 8',
      'status update 7',
      'status update 6',
    ]);

    // "Where was I mentioned?" needs no keyword.
    const mentioned = operations.execute('buddy.search_posts', { mentions: 'me' }).data as any;
    assert.deepEqual(
      mentioned.matches.map((match: { postId: string }) => match.postId),
      [inThread.post.id, top.post.id]
    );
    assert.throws(() => operations.execute('buddy.search_posts', {}), /query, mentions/);

    // Channels are public to the workspace and no wider.
    const foreignList = h.raw.createList({
      workspace: h.raw.createWorkspace({ name: 'Foreign', rootPath: '/tmp/foreign' }).id,
      author: { kind: 'owner' },
      key: 'foreign',
      name: 'foreign',
      purpose: 'Elsewhere',
    }).list;
    const foreign = h.raw.createPost({
      list: foreignList.id,
      author: { kind: 'owner' },
      key: 'foreign-post',
      purpose: 'message',
      body: 'ship on Monday elsewhere',
    }).post;
    assert.equal(
      (operations.execute('buddy.search_posts', { query: 'ship monday' }).data as any).matches
        .length,
      1
    );
    assert.throws(
      () => operations.execute('buddy.get_thread', { postId: foreign.id }),
      /unavailable in this workspace/
    );
  } finally {
    server.close();
    h.raw.close();
    rmSync(h.scratch, { recursive: true, force: true });
  }
});
