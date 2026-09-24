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
import { slotOf } from '../src/buddies/buddy-conversation-slots';
import { WAKE_MESSAGE, createBuddyDirect } from '../src/buddies/buddy-direct';
import { onChannelPost } from '../src/buddies/channel-post-feed';
import {
  type GateVerdict,
  createCliReplyGate,
  parseGateVerdict,
} from '../src/buddies/channel-reply-gate';
import { createChannelResponder, threadConversationId } from '../src/buddies/channel-responder';
import { registerChannelRoutes } from '../src/buddies/channel-routes';
import type { BuddiesStorePort, BuddyMailingListPost } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { BuddyOperationsService } from '../src/buddies/operations';
import { registerBuddyRoutes } from '../src/buddies/routes';
import { configFromProviderPreferences } from '../src/conversations/config-mapping';
import { ConversationConfigService } from '../src/conversations/config-service';
import { ConversationConfigStore } from '../src/conversations/config-store';
import type { ConversationRuntime } from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

// End-to-end channel conversation: owner posts through the real routes into a
// real store, @mentions start a turn, and the Buddy's final answer lands in the
// thread. The provider turn is the only stand-in (the model is the external
// boundary); the fake runtime exposes exactly the surface the responder drives.
// The follow-up gate is the same boundary: each question is held open until
// the test answers it.

// Configuration is real: the runtime holds the config state persisted when the
// conversation was created (the mention's pick, else the profile default).
class FakeTurnRuntime extends EventEmitter {
  isRunning = false;
  queue: unknown[] = [];
  prompts: Array<{ content: string; ownerInput: unknown }> = [];
  answered?: number;
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
  // Who is asked is read off the prompt ("You are <Name> (<role>)…").
  const gates: Array<{
    name: string;
    config: ConversationConfig;
    prompt: string;
    answer(verdict: GateVerdict): void;
  }> = [];
  // A deleted id is a tombstone, exactly as the config record reports it.
  const conversations = {
    slot: async (id: string) =>
      deleted.has(id) ? ({ kind: 'deleted' } as const) : slotOf(await configService.getRecord(id)),
    getConversation: getRuntime,
    ensureConversationReady: async (conversation: ConversationRuntime) => conversation,
    createConversation: createRuntime,
  };
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
  const responder = createChannelResponder({
    getStore: async () => store,
    conversations,
    uploadsRoot: () => uploadsRoot,
    gate: ({ config, prompt }) =>
      new Promise<GateVerdict>((answer) =>
        gates.push({ name: /^You are (\S+)/.exec(prompt)![1], config, prompt, answer })
      ),
    logger: { warn: () => undefined },
  });
  const unsubscribe = onChannelPost((post) => void responder.considerThreadPost(post));
  registerChannelRoutes(app, {
    getStore: async () => store,
    uploadsRoot,
    sendError,
    responder,
    direct: createBuddyDirect({ getStore: async () => store, conversations }),
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
    gates,
    app,
    close() {
      unsubscribe();
      raw.close();
    },
  };
}

test('owner @mention runs a turn and the answer lands in the thread with its media', async () => {
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

    // A follow-up mention in the same thread RESUMES the Buddy's seat there
    // (its memory of the thread); a failed turn is reported in the thread,
    // never swallowed.
    const followUp = await call(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'owner' },
      key: 'follow-up',
      purpose: 'message',
      body: `[@Lead](buddy:${h.lead.id}) and the mobile view?`,
      threadRootId: root.id,
    });
    assert.equal(followUp.json.mentions[0].conversationId, leadMention.conversationId);
    const second = await until(() => runtime.prompts[1], 'follow-up prompt');
    assert.match(second.content, /Close — fixed the spacing/);
    runtime.emit('buddy-turn-failed', 'Buddy provider is unavailable: codex');
    const failed = await until(() => {
      const read = h.raw.listThread({ root: root.id }).replies;
      return read.find((post) => post.purpose === 'reply_failed');
    }, 'failure reply');
    assert.match(failed.body, /provider is unavailable/);
    assert.equal(failed.senderConversationId, leadMention.conversationId);
    assert.deepEqual(h.created, [leadMention.conversationId]);

    // Buddy-authored mentions never start turns.
    const buddyMention = await call(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'buddy', buddyId: h.lead.id },
      key: 'buddy-mention',
      purpose: 'message',
      body: `[@Lead](buddy:${h.lead.id}) note to self`,
    });
    assert.deepEqual(buddyMention.json.mentions, []);
    assert.equal(h.created.length, 1);

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
    h.close();
    rmSync(h.scratch, { recursive: true, force: true });
  }
});

// The owner's harness pick is saved as the Buddy's seat in the thread and
// every later reply there keeps it. Regression, conv 0f1dfb23 (2026-09-24): a
// resumed seat refused a later pick of another harness ("Provider cannot change
// after the conversation has started"), so a different pick opens a NEW seat
// generation. (That conversation's `out_of_tokens` was Codex's usage limit,
// not transcript growth — resuming itself was never the problem.)
test('a picked harness sticks for the Buddy in the thread; a different pick opens a new seat', async () => {
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
    const claude: ConversationConfig = {
      provider: 'claude',
      model: { mode: 'explicit', modelId: 'fable' },
      reasoning: { mode: 'default' },
    };
    const codex = configFromProviderPreferences({ provider: 'codex' });
    const replies = (root: string) =>
      h.raw.listThread({ root }).replies.filter((reply) => reply.author.kind === 'buddy');
    // Answers the next turn sent to a conversation.
    const answer = async (conversationId: string, text: string) => {
      const runtime = await until(() => h.runtimes.get(conversationId), 'runtime');
      const count = runtime.answered ?? 0;
      const prompt = await until(() => runtime.prompts[count], 'prompt');
      runtime.answered = count + 1;
      runtime.emit('buddy-turn-complete', text);
      return { runtime, prompt: prompt.content };
    };
    const ask = (key: string, body: string, extra: Record<string, unknown>) =>
      post(`/api/buddies/lists/${list.id}/posts`, {
        author: { kind: 'owner' },
        key,
        purpose: 'message',
        body: `${mention} ${body}`,
        ...extra,
      });

    // First mention: the Buddy's profile is Codex; the owner picked Claude.
    const asked = await ask('ask', 'review this', {
      mentionConfigs: [{ buddyId: h.lead.id, config: claude }],
    });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    const root = asked.json.post.id;
    const seat = asked.json.mentions[0].conversationId;
    assert.equal(seat, threadConversationId(root, h.lead.id, 0));
    const first = await answer(seat, 'Looks fine on Claude.');
    assert.deepEqual(first.runtime.config, claude);
    await until(() => replies(root).length === 1, 'first reply');

    // An unpicked mention later in the thread resumes the Claude seat.
    const again = await ask('again', 'and the edge cases?', { threadRootId: root });
    assert.equal(again.json.mentions[0].conversationId, seat);
    await answer(seat, 'Edge cases fine too.');
    await until(() => replies(root).length === 2, 'second reply');

    // Picking another harness opens seat generation 1 on it, seeded with the
    // thread; later unpicked mentions keep that one.
    const switched = await ask('switch-harness', 'try it on codex', {
      threadRootId: root,
      mentionConfigs: [{ buddyId: h.lead.id, config: codex }],
    });
    const codexSeat = switched.json.mentions[0].conversationId;
    assert.equal(codexSeat, threadConversationId(root, h.lead.id, 1));
    const second = await answer(codexSeat, 'Also fine on Codex.');
    assert.deepEqual(second.runtime.config, codex);
    assert.match(second.prompt, /Looks fine on Claude\./);
    await until(() => replies(root).length === 3, 'third reply');
    const after = await ask('after', 'ship it?', { threadRootId: root });
    assert.equal(after.json.mentions[0].conversationId, codexSeat);
    assert.deepEqual(h.created, [seat, codexSeat]);

    // A choice for a Buddy the post does not mention would vanish: 400.
    const stray = await post(`/api/buddies/lists/${list.id}/posts`, {
      author: { kind: 'owner' },
      key: 'stray',
      purpose: 'message',
      body: 'nobody mentioned',
      mentionConfigs: [{ buddyId: h.lead.id, config: claude }],
    });
    assert.equal(stray.status, 400);
    assert.match(stray.json.error, /not mentioned/);
  } finally {
    server.close();
    h.close();
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
    h.close();
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
    h.close();
    rmSync(h.scratch, { recursive: true, force: true });
  }
});

// Thread follow-ups: every new thread post asks each OTHER Buddy who has posted
// there "respond or leave it?". Only <yes> starts a reply; Buddy replies are
// posts too, so they ask again — until three Buddy posts in a row, when the
// thread waits for the owner. Without that bound two agreeable Buddies would
// answer each other forever.
test('a thread post asks the other Buddies in it; <yes> replies, <no> stays quiet, Buddy chains stop at three', async () => {
  const h = harness();
  const designer = h.raw.createBuddy({ project: h.workspace.id, name: 'Designer', role: 'UI' });
  const server = h.app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { list } = h.raw.createList({
      workspace: h.workspace.id,
      author: { kind: 'owner' },
      key: 'launch',
      name: 'launch',
      purpose: 'Launch',
    });
    const write = async (author: unknown, key: string, body: string, threadRootId?: string) => {
      const response = await fetch(`${base}/api/buddies/lists/${list.id}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ author, key, purpose: 'message', body, threadRootId }),
      });
      assert.equal(response.status, 201);
      return ((await response.json()) as any).post as BuddyMailingListPost;
    };
    const owner = { kind: 'owner' };
    const gate = (index: number) => until(() => h.gates[index], `gate ${index}`);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
    // Answers the next turn in the Buddy's seat for this thread.
    const replyIn = async (root: BuddyMailingListPost, buddyId: string, text: string) => {
      const runtime = await until(
        () => h.runtimes.get(threadConversationId(root.id, buddyId, 0)),
        `seat for ${buddyId}`
      );
      const count = runtime.answered ?? 0;
      const prompt = await until(() => runtime.prompts[count], 'seat prompt');
      runtime.answered = count + 1;
      runtime.emit('buddy-turn-complete', text);
      return prompt.content;
    };
    const newestReply = (root: string) => h.raw.listThread({ root }).replies.at(-1)!;

    const root = await write(owner, 'root', 'Launch plan?');
    // Lead is the only Buddy in the thread and wrote the post: nobody to ask.
    await write({ kind: 'buddy', buddyId: h.lead.id }, 'lead-1', 'I own the backend.', root.id);
    await settle();
    assert.equal(h.gates.length, 0);
    // Designer's post asks Lead, who passes: no conversation, no reply.
    await write({ kind: 'buddy', buddyId: designer.id }, 'designer-1', 'I own the UI.', root.id);
    (await gate(0)).answer({ kind: 'pass' });
    assert.equal(h.gates[0].name, 'Lead');

    // The owner's question asks both Buddies, with the thread as context.
    const question = await write(owner, 'ask', 'Is the login page ready?', root.id);
    await gate(2);
    const asked = new Map(h.gates.slice(1).map((entry) => [entry.name, entry]));
    const toDesigner = asked.get('Designer')!;
    assert.match(toDesigner.prompt, /I own the backend\.[\s\S]*Is the login page ready\?/);
    assert.match(toDesigner.prompt, /should you respond, or leave it to another team member\?/);
    assert.match(toDesigner.prompt, /exactly <yes> or <no>/);
    asked.get('Lead')!.answer({ kind: 'pass' });
    toDesigner.answer({ kind: 'respond' });
    const followUpPrompt = await replyIn(root, designer.id, 'Login ships Friday.');
    assert.match(followUpPrompt, /you chose to reply/);
    assert.match(followUpPrompt, /from Owner:\nIs the login page ready\?/);
    await until(() => newestReply(root.id).body === 'Login ships Friday.', 'designer reply');
    // Lead passed: no seat was opened for it.
    assert.equal(h.runtimes.has(threadConversationId(root.id, h.lead.id, 0)), false);

    // Buddy chain: Designer's reply (1) asks Lead, Lead's reply (2) asks
    // Designer, Designer's reply (3) asks nobody.
    (await gate(3)).answer({ kind: 'respond' });
    assert.equal(h.gates[3].name, 'Lead');
    await replyIn(root, h.lead.id, 'Backend is ready too.');
    await until(() => newestReply(root.id).body === 'Backend is ready too.', 'lead reply');
    (await gate(4)).answer({ kind: 'respond' });
    assert.equal(h.gates[4].name, 'Designer');
    // Designer's second reply resumes its seat: the same conversation.
    await replyIn(root, designer.id, 'Great, shipping.');
    await until(() => newestReply(root.id).body === 'Great, shipping.', 'third buddy post');
    await settle();
    assert.equal(h.gates.length, 5, 'three Buddy posts in a row: the thread waits for the owner');

    // The owner speaking again reopens the thread to both Buddies.
    await write(owner, 'thanks', 'Thanks both, one more thing.', root.id);
    await gate(6);
  } finally {
    server.close();
    h.close();
  }
});

// Follow-ups use the Buddy's seat, so the owner's pick on an earlier mention
// carries over — gate question included (a gate on the profile harness would
// fail whenever that harness is down) — while a Buddy never picked for stays
// on its profile.
test('a follow-up keeps the harness the owner picked for that Buddy earlier in the thread', async () => {
  const h = harness();
  const designer = h.raw.createBuddy({ project: h.workspace.id, name: 'Designer', role: 'UI' });
  const server = h.app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { list } = h.raw.createList({
      workspace: h.workspace.id,
      author: { kind: 'owner' },
      key: 'sticky',
      name: 'sticky',
      purpose: 'Sticky model',
    });
    const write = async (body: Record<string, unknown>) => {
      const response = await fetch(`${base}/api/buddies/lists/${list.id}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ author: { kind: 'owner' }, purpose: 'message', ...body }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as any;
    };
    const claude: ConversationConfig = {
      provider: 'claude',
      model: { mode: 'explicit', modelId: 'fable' },
      reasoning: { mode: 'default' },
    };
    const gate = (index: number) => until(() => h.gates[index], `gate ${index}`);

    const root = (await write({ key: 'root', body: 'Plan?' })).post;
    await write({
      key: 'lead-1',
      author: { kind: 'buddy', buddyId: h.lead.id },
      body: 'Backend is mine.',
      threadRootId: root.id,
    });
    // The owner mentions Designer on Claude; Lead (profile) is asked and passes.
    const mentioned = await write({
      key: 'mention',
      body: `[@Designer](buddy:${designer.id}) mock up the login page`,
      threadRootId: root.id,
      mentionConfigs: [{ buddyId: designer.id, config: claude }],
    });
    (await gate(0)).answer({ kind: 'pass' });
    const mentionRuntime = await until(
      () => h.runtimes.get(mentioned.mentions[0].conversationId),
      'mention runtime'
    );
    await until(() => mentionRuntime.prompts[0], 'mention prompt');
    mentionRuntime.emit('buddy-turn-complete', 'Mockup attached.');
    (await gate(1)).answer({ kind: 'pass' });

    // A plain owner reply: Designer is asked on Claude, Lead on its profile.
    await write({ key: 'risks', body: 'Any risks?', threadRootId: root.id });
    await gate(3);
    const asked = new Map(h.gates.slice(2).map((entry) => [entry.name, entry]));
    assert.deepEqual(asked.get('Designer')!.config, claude);
    assert.deepEqual(
      asked.get('Lead')!.config,
      configFromProviderPreferences({ provider: 'codex' })
    );
    asked.get('Lead')!.answer({ kind: 'pass' });
    asked.get('Designer')!.answer({ kind: 'respond' });
    // The reply resumes the Claude seat the mention opened.
    const followUp = await until(() => mentionRuntime.prompts[1], 'follow-up prompt');
    assert.match(followUp.content, /Any risks\?/);
    assert.deepEqual(mentionRuntime.config, claude);
    assert.equal(h.created.length, 1);
  } finally {
    server.close();
    h.close();
  }
});

// "Let it do a few tokens": the gate is a strict parse, and a model that keeps
// talking past `<yes>`/`<no>` is stopped rather than billed to the end and then
// read as a yes.
test('the reply gate accepts only a bare <yes>/<no> and stops a rambling run', async () => {
  assert.deepEqual(parseGateVerdict(' <yes>\n'), { kind: 'respond' });
  assert.deepEqual(parseGateVerdict('<no>'), { kind: 'pass' });
  assert.equal(parseGateVerdict('<yes> because I own it').kind, 'unparseable');

  let stopped = false;
  const gate = createCliReplyGate({
    resolveExecution: async () => ({ provider: 'claude', modelId: 'sonnet' }),
    execute: (() => {
      let finish: (value: unknown) => void = () => undefined;
      const completed = new Promise((resolve) => {
        finish = resolve;
      });
      async function* events() {
        for (const text of ['Let me think about ', 'whether this thread ', 'needs me. <yes>']) {
          if (stopped) break;
          yield { type: 'text.delta', text };
        }
        finish({ reason: stopped ? 'killed' : 'success', exitCode: 0 });
      }
      return () => ({
        events: events(),
        completed,
        stop: () => {
          stopped = true;
        },
      });
    })() as never,
  });
  const verdict = await gate({
    config: configFromProviderPreferences({ provider: 'claude' }),
    prompt: 'p',
  });
  assert.equal(stopped, true);
  assert.equal(verdict.kind, 'unparseable');
});
