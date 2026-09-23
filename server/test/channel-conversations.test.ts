import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import express from 'express';
import { createChannelResponder } from '../src/buddies/channel-responder';
import { registerChannelRoutes } from '../src/buddies/channel-routes';
import type { BuddiesStorePort, BuddyMailingListPost } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { registerBuddyRoutes } from '../src/buddies/routes';
import type { ConversationRuntime } from '../src/conversations/runtime';

// End-to-end channel conversation: owner posts through the real routes into a
// real store, @mentions start a turn, and the Buddy's final answer lands in the
// thread. The provider turn is the only stand-in (the model is the external
// boundary); the fake runtime exposes exactly the surface the responder drives.

class FakeTurnRuntime extends EventEmitter {
  isRunning = false;
  queue: unknown[] = [];
  prompts: Array<{ content: string; ownerInput: unknown }> = [];
  constructor(readonly id: string) {
    super();
  }
  hasActiveProcess() {
    return false;
  }
  async waitForTurnDrain() {}
  sendMessage(content: string, ownerInput: unknown) {
    this.prompts.push({ content, ownerInput });
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
      getConversation: (id) => runtimes.get(id) as unknown as ConversationRuntime | undefined,
      ensureConversationReady: async (conversation) => conversation,
      createConversation: async (input) => {
        created.push(input.conversationId);
        const runtime = new FakeTurnRuntime(input.conversationId);
        runtimes.set(input.conversationId, runtime);
        return runtime as unknown as ConversationRuntime;
      },
      uploadsRoot: () => uploadsRoot,
      logger: { warn: () => undefined },
    }),
  });
  return { raw, workspace, lead, outsider, scratch, uploadsRoot, runtimes, created, app };
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
