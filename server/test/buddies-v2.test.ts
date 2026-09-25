import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerSpec } from '@nbardy/agent-cli';
import {
  BuddiesCore,
  type Buddy,
  type Inbox,
  type Post,
  type ThreadStat,
} from '@unleashd/buddies-core';
import { createDefaultConversationConfig } from '@unleashd/shared';
import express from 'express';
import { BUDDY_TOOL_GUIDE, createBriefings } from '../src/buddies/briefing';
import { type StableConversationPorts, slotOf } from '../src/buddies/buddy-conversation-slots';
import {
  type GateVerdict,
  createCliReplyGate,
  parseGateVerdict,
} from '../src/buddies/channel-reply-gate';
import { createChannels } from '../src/buddies/channels';
import { OWNER, buddiesLocation, buddyActor, openBuddiesCore } from '../src/buddies/core';
import { type BuddyEvent, createBuddyEvents } from '../src/buddies/events';
import { createGrants } from '../src/buddies/grants';
import { startMcpEndpoint } from '../src/buddies/mcp';
import { createMemoryReviewer } from '../src/buddies/memory-review';
import { createBuddyPolicyPort } from '../src/buddies/policy-port';
import { registerBuddyRoutes } from '../src/buddies/routes';
import { createRunner } from '../src/buddies/runner';
import { TURN_MAX_RUNTIME_MS } from '../src/constants/timeouts';
import { createBuddyCreationService } from '../src/conversations/buddy-creation-service';
import { ConversationConfigService } from '../src/conversations/config-service';
import {
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';
import { recordStore } from './fixtures/records';

// The Buddy server end to end through its real boundaries: the crate on a temp DB, the HTTP MCP
// endpoint, the runner, the channels responder, the creation service and the conversation
// runtime. Only the provider process is faked. A fake turn calls tools the way a CLI would: over
// HTTP, with the exact MCP spec (URL + bearer) the runtime handed the provider.

type ProviderRequest = Parameters<NonNullable<ConversationRuntimeDependencies['executeTurn']>>[0];
type Turn = { n: number; request: ProviderRequest; mcp: McpServerSpec };

async function until<T>(
  read: () => T | undefined | false | Promise<T | undefined | false>,
  what: string
): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function connect(spec: McpServerSpec): Promise<Client> {
  assert.equal(spec.kind, 'http');
  if (spec.kind !== 'http') throw new Error('unreachable');
  const client = new Client({ name: 'fake-cli', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(spec.url), {
      requestInit: { headers: { ...spec.headers } },
    })
  );
  return client;
}

async function call(spec: McpServerSpec, name: string, args: Record<string, unknown>) {
  const client = await connect(spec);
  try {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    const text = result.content[0].text;
    const isError = result.isError === true;
    return { isError, text, value: isError ? null : JSON.parse(text) };
  } finally {
    await client.close();
  }
}

async function toolNames(spec: McpServerSpec): Promise<string[]> {
  const client = await connect(spec);
  try {
    return (await client.listTools()).tools.map((t) => t.name).sort();
  } finally {
    await client.close();
  }
}

/** A raw HTTP probe, as a CLI's startup probe sends it: 401 means the grant is gone. */
async function probe(spec: McpServerSpec): Promise<number> {
  if (spec.kind !== 'http') throw new Error('http only');
  const response = await fetch(spec.url, {
    method: 'POST',
    headers: {
      ...spec.headers,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'probe', version: '1' },
      },
    }),
  });
  await response.text();
  return response.status;
}

async function world() {
  const scratch = mkdtempSync(join(tmpdir(), 'buddies-v2-'));
  const dbPath = join(scratch, 'buddies-v3.sqlite');
  const core = await BuddiesCore.open(dbPath);
  const ws = (await core.createWorkspace(OWNER, { name: 'Team', rootPath: scratch })).id;
  const hire = (slug: string, name: string) =>
    core.createBuddy(OWNER, {
      workspaceId: ws,
      slug,
      name,
      role: `${name} role`,
      manager: { kind: 'nobody' },
      backgroundEnabled: true,
      provider: 'codex',
      key: slug,
    });
  const lead = await hire('lead', 'Lead');
  const designer = await hire('designer', 'Designer');
  const general = await core.createChannel(OWNER, {
    workspaceId: ws,
    name: 'general',
    purpose: 'Team chat',
    key: 'general',
  });

  const events = createBuddyEvents();
  const seen: BuddyEvent[] = [];
  events.on((event) => seen.push(event));
  const grants = createGrants({ ttlMs: TURN_MAX_RUNTIME_MS });
  const briefings = createBriefings(core);
  const endpoint = await startMcpEndpoint({
    core,
    events,
    grants,
    uploadsRoot: () => join(scratch, 'uploads'),
  });

  // The provider. `during(turn)` runs inside turn n, as the model's tool calls would.
  const turns: Turn[] = [];
  const during = new Map<number, (turn: Turn) => Promise<void>>();
  const answers = new Map<number, string>();
  const executeTurn = ((request: ProviderRequest) => {
    const turn: Turn = { n: turns.length + 1, request, mcp: request.mcpServers!.unleashd_buddy };
    turns.push(turn);
    const sessionId = request.resumeSessionId ?? `native-${turn.n}`;
    let finish!: (value: {
      exitCode: number;
      signal: null;
      sessionId: string;
      reason: 'success';
    }) => void;
    const completed = new Promise<{
      exitCode: number;
      signal: null;
      sessionId: string;
      reason: 'success';
    }>((resolve) => {
      finish = resolve;
    });
    return {
      child: { exitCode: 0 },
      events: (async function* () {
        yield { type: 'session.started' as const, sessionId };
        yield { type: 'turn.started' as const };
        await during.get(turn.n)?.(turn);
        yield { type: 'text.delta' as const, text: answers.get(turn.n) ?? `Answer ${turn.n}` };
        yield { type: 'turn.complete' as const, reason: 'success' as const };
        finish({ exitCode: 0, signal: null, sessionId, reason: 'success' });
      })(),
      completed,
      stop: () => undefined,
    };
  }) as unknown as NonNullable<ConversationRuntimeDependencies['executeTurn']>;

  const gate: { verdict: GateVerdict; calls: number } = { verdict: { kind: 'pass' }, calls: 0 };
  const reviewer = createMemoryReviewer({
    core,
    grants,
    spec: endpoint.spec,
    execute: () => {
      throw new Error('no review in this world');
    },
  });
  const conversations = new Map<string, ConversationRuntime>();
  const configService = new ConversationConfigService({
    store: recordStore(join(scratch, 'config')),
    resolver: { resolve: async (config) => resolveConfigAgainstProviderCatalog(config) },
  });
  const runner = createRunner({
    core,
    grants,
    events,
    briefings,
    leaseMs: TURN_MAX_RUNTIME_MS,
    backgroundTurnMs: 60_000,
    backstopMs: 200,
    logger: { warn: () => undefined, log: () => undefined },
    host: {
      placement: (id) => {
        const conversation = conversations.get(id);
        if (!conversation) return 'absent';
        return conversation.kind.t === 'buddy' && conversation.kind.visibility === 'background'
          ? 'background'
          : 'foreground';
      },
      openBackground: async ({ conversationId, context, commandId }) => {
        await creation.createServerBuddyConversation({
          context,
          conversationId,
          commandId,
          deferInitialMessage: true,
          visibility: 'background',
        });
      },
      runTurn: async ({ conversationId, context, prompt, leaseToken }) =>
        conversations.get(conversationId)!.runCoordinationMessage(prompt, context, leaseToken),
      stop: (id) => conversations.get(id)?.stop(),
    },
  });
  const port = createBuddyPolicyPort({ runner, grants, briefings, reviewer, spec: endpoint.spec });
  const Conversation = createConversationRuntime({
    buddies: port,
    broadcast: () => undefined,
    registerSessionAlias: () => undefined,
    unregisterSessionAlias: () => undefined,
    clearExternalRunningStatus: () => undefined,
    clearLocalCompletionSuppression: () => undefined,
    markLocalCompletionSuppression: () => undefined,
    persistCurrentSession: (conversation, sessionId, key) =>
      creation.persistCurrentSession(conversation, sessionId, key),
    getConversation: (id) => conversations.get(id),
    readLatestOompaRuntime: async () => ({ available: false, run: null, reason: 'fixture' }),
    createSessionId: () => `provisional-${turns.length}`,
    executeTurn,
  });
  let ids = 0;
  const creation = createBuddyCreationService({
    configService,
    resolveBuddyConversation: (context) => briefings.warm(context),
    resolveWorkingDirectory: (directory) => directory,
    isProviderAvailable: () => true,
    createId: () => `conversation-${++ids}`,
    getConversation: (id) => conversations.get(id),
    createConversation: (options) => new Conversation(options),
    registerConversation: (conversation) => conversations.set(conversation.id, conversation),
    createConversationLink: async () => undefined,
    updateConversationStatus: () => undefined,
    broadcast: () => undefined,
  });
  const stable: StableConversationPorts = {
    slot: async (id) => slotOf(await configService.getRecord(id)),
    getConversation: (id) => conversations.get(id),
    ensureConversationReady: creation.ensureConversationReady,
    createConversation: (input) => creation.createServerBuddyConversation(input),
  };
  const channels = createChannels({
    core,
    events,
    conversations: stable,
    uploadsRoot: () => join(scratch, 'uploads'),
    gate: async () => {
      gate.calls += 1;
      return gate.verdict;
    },
    channelChanged: () => undefined,
    logger: { warn: () => undefined },
  });
  await runner.start();
  return {
    core,
    ws,
    lead,
    designer,
    general,
    events: seen,
    emit: events.emit,
    grants,
    endpoint,
    turns,
    during,
    answers,
    gate,
    channels,
    creation,
    conversations,
    runner,
    scratch,
    runs: (buddyId: string) => core.listRuns({ kind: 'buddy', buddyId }, 50),
    async close() {
      runner.stop();
      await endpoint.close();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

test('one full chat turn: an owner chat asks another Buddy, it answers, the return is delivered; grants die with their turns', async () => {
  const w = await world();
  try {
    let request!: Post;
    w.during.set(1, async (turn) => {
      // Owner-authored input: the grant is the owner's, so team_admin is listed.
      assert.ok((await toolNames(turn.mcp)).includes('team_admin'));
      assert.equal(await probe(turn.mcp), 200);
      const posted = await call(turn.mcp, 'post', {
        channel: { direct: [w.designer.id] },
        kind: 'request',
        body: 'Draw the logo',
        key: 'ask-logo',
      });
      assert.equal(posted.isError, false, posted.text);
      request = posted.value;
    });
    w.during.set(2, async (turn) => {
      assert.match(turn.request.prompt, /Draw the logo/);
      const answered = await call(turn.mcp, 'answer', {
        requestId: request.id,
        body: 'Logo drawn',
        evidence: ['logo.png'],
        key: 'answer-logo',
      });
      assert.equal(answered.isError, false, answered.text);
    });
    const chat = await w.creation.createServerBuddyConversation({
      context: { buddyId: w.lead.id, workspaceId: w.ws },
      conversationId: 'owner-chat',
      commandId: 'owner-chat',
      deferInitialMessage: true,
    });
    chat.sendMessage('Get Designer to draw the logo', {
      origin: 'owner_input',
      inputId: 'owner-1',
    });

    const designerRun = await until(
      async () => (await w.runs(w.designer.id)).find((r) => r.status === 'complete'),
      "Designer's request run"
    );
    assert.deepEqual(designerRun.input, { kind: 'post', postId: request.id });
    const done = await w.core.getPost(OWNER, request.id);
    assert.equal(done.request.state, 'answered');
    const answer = await w.core.getPost(OWNER, (done.request as { answerId: string }).answerId);
    assert.equal(answer.body, 'Logo drawn');
    assert.deepEqual(answer.author, buddyActor(w.designer.id));

    // The answer returns to the conversation the request was sent from: Lead's owner chat, a
    // human chat, so it is delivered to the DM (Lead's inbox) without an automated turn.
    const leadRuns = await until(async () => {
      const runs = await w.runs(w.lead.id);
      return runs.every((r) => r.status === 'complete') && runs.length === 2 && runs;
    }, "Lead's chat run and its return");
    const back = leadRuns.find((r) => r.input.kind === 'reply')!;
    assert.equal(back.conversationId, 'owner-chat');
    assert.match(back.outcome ?? '', /delivered to the DM/);
    assert.equal(w.turns.length, 2, 'no automated turn in the owner chat');

    // A chat run's lease IS the foreground deadline: exactly TURN_MAX_RUNTIME_MS (the 2026-09-10
    // incident killed healthy owner chats at an inherited 600 s).
    const chatRun = leadRuns.find((r) => r.input.kind === 'chat')!;
    const leased = Date.parse(chatRun.leaseExpiresAt!) - Date.parse(chatRun.startedAt!);
    assert.ok(Math.abs(leased - TURN_MAX_RUNTIME_MS) < 1_000, `lease ${leased} ms`);

    // Tokens are readable by the agent's shell, so a settled turn's grant must be dead.
    for (const turn of w.turns)
      assert.equal(await probe(turn.mcp), 401, `turn ${turn.n}'s grant outlived its turn`);
    assert.equal(w.grants.size(), 0);
  } finally {
    await w.close();
  }
});

test('an MCP write fires the change bus in this process (B2)', async () => {
  const w = await world();
  try {
    const grant = w.grants.issueBuddy({
      role: 'worker',
      buddyId: w.lead.id,
      workspaceId: w.ws,
      conversationId: 'c',
      scope: { kind: 'buddy' },
      runId: null,
    });
    const before = w.events.length;
    const posted = await call(w.endpoint.spec(grant), 'post', {
      channel: { id: w.general.id },
      body: 'standup: shipped',
      key: 'standup',
    });
    assert.equal(posted.isError, false, posted.text);
    const fired = w.events.slice(before);
    assert.ok(
      fired.some((e) => e.kind === 'posted' && e.post.id === posted.value.id),
      'posted'
    );
    assert.ok(
      fired.some((e) => e.kind === 'changed'),
      'changed'
    );
  } finally {
    await w.close();
  }
});

test('B1: a seat turn holds owner authority only when the owner wrote its trigger post', async () => {
  const w = await world();
  try {
    const soulOfDesigner = {
      buddyId: w.designer.id,
      kind: 'soul',
      scope: 'buddy',
      content: 'rewritten',
      baseRevision: 0,
      reason: 'x',
    };
    w.during.set(1, async (turn) => {
      assert.ok((await toolNames(turn.mcp)).includes('team_admin'), 'owner mention: owner tools');
      const write = await call(turn.mcp, 'doc_write', { ...soulOfDesigner, key: 'owner-turn' });
      assert.equal(write.isError, false, `the owner may write any soul: ${write.text}`);
    });
    const root = await w.core.post(
      OWNER,
      { kind: 'id', id: w.general.id },
      {
        kind: 'inform',
        body: `[@Lead](buddy:${w.lead.id}) plan the launch`,
        evidence: [],
        key: 'owner-1',
      }
    );
    assert.deepEqual(await w.channels.respondToOwnerPost(w.general, root, new Map()), [
      { buddyId: w.lead.id, status: 'started' },
    ]);
    const leadReplies = async () =>
      (await w.core.listPosts(OWNER, { kind: 'thread', rootId: root.id }, null, 50)).posts.filter(
        (p) => p.author.kind === 'buddy' && p.author.id === w.lead.id
      );
    await until(async () => (await leadReplies()).length === 1, "Lead's reply to the owner");

    // Designer (a Buddy) posts in the thread; the gate says respond; Lead runs a follow-up.
    w.gate.verdict = { kind: 'respond' };
    w.during.set(2, async (turn) => {
      assert.ok(
        !(await toolNames(turn.mcp)).includes('team_admin'),
        'Buddy-authored trigger: no owner tools'
      );
      const write = await call(turn.mcp, 'doc_write', {
        ...soulOfDesigner,
        baseRevision: 1,
        key: 'buddy-turn',
      });
      assert.equal(write.isError, true);
      assert.match(
        write.text,
        /^\[denied\]/,
        'the crate refuses: Lead neither is nor manages Designer'
      );
    });
    const designerPost = await w.core.post(
      buddyActor(w.designer.id),
      { kind: 'id', id: w.general.id },
      {
        kind: 'inform',
        body: 'Lead, which date?',
        replyToId: root.id,
        evidence: [],
        key: 'designer-1',
      }
    );
    w.emit({ kind: 'posted', post: designerPost, channel: w.general });
    await until(async () => (await leadReplies()).length === 2, "Lead's follow-up");
    assert.equal(w.turns.length, 2);
    assert.equal(w.turns[1].request.resumeSessionId, 'native-1', 'the follow-up resumes the seat');
    assert.match(
      w.turns[1].request.prompt,
      /Replies since then/,
      'a resumed seat is sent only what is new'
    );
  } finally {
    await w.close();
  }
});

test('a scheduled run asks for help in the background and its answer comes back as a turn there', async () => {
  const w = await world();
  try {
    let requestId = '';
    w.during.set(1, async (turn) => {
      assert.match(turn.request.prompt, /Scheduled run "daily"/);
      const posted = await call(turn.mcp, 'post', {
        channel: { direct: [w.designer.id] },
        kind: 'request',
        body: 'Summarize the metrics',
        key: 'daily-ask',
      });
      requestId = posted.value.id;
    });
    // Designer ends its turn without calling `answer`: its final text is posted as the answer.
    w.answers.set(2, 'Metrics are up 4%');
    const schedule = await w.core.putSchedule(OWNER, {
      buddyId: w.lead.id,
      name: 'daily',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'Run the daily review',
      limits: '{}',
      enabled: true,
      key: 'daily',
    });
    await w.core.enqueueRun(OWNER, {
      buddyId: w.lead.id,
      input: { kind: 'schedule', scheduleId: schedule.id, slot: new Date().toISOString() },
    });
    w.emit({ kind: 'changed' });
    const returned = await until(() => w.turns[2], "Lead's return turn");
    assert.match(returned.request.prompt, /Metrics are up 4%/);
    assert.equal(
      returned.request.resumeSessionId,
      'native-1',
      'the return runs in the conversation that asked'
    );
    const answered = await w.core.getPost(OWNER, requestId);
    assert.equal(answered.request.state, 'answered');
    await until(
      async () => (await w.runs(w.lead.id)).every((r) => r.status === 'complete'),
      "Lead's runs settle"
    );
  } finally {
    await w.close();
  }
});

test('the reviewer climbs the ladder on credit exhaustion and curates memory on the same endpoint', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'buddies-review-'));
  const dbPath = join(scratch, 'db.sqlite');
  const core = await BuddiesCore.open(dbPath);
  const ws = (await core.createWorkspace(OWNER, { name: 'Team', rootPath: scratch })).id;
  const lead = await core.createBuddy(OWNER, {
    workspaceId: ws,
    slug: 'lead',
    name: 'Lead',
    role: 'r',
    manager: { kind: 'nobody' },
    backgroundEnabled: true,
    key: 'lead',
  });
  const events = createBuddyEvents();
  const grants = createGrants({ ttlMs: 60_000 });
  const endpoint = await startMcpEndpoint({ core, events, grants, uploadsRoot: () => scratch });
  const harnesses: string[] = [];
  let spec!: McpServerSpec;
  const reviewer = createMemoryReviewer({
    core,
    grants,
    spec: endpoint.spec,
    logger: { warn: () => undefined },
    execute: ((request: ProviderRequest) => {
      harnesses.push(request.harness);
      spec = request.mcpServers!.unleashd_memory;
      const exhausted = request.harness === 'codex';
      const completed = (async () => {
        if (!exhausted) {
          const read = await call(spec, 'doc_read', { kind: 'working' });
          assert.equal(read.isError, false, read.text);
          const write = await call(spec, 'doc_write', {
            kind: 'working',
            content: 'Owner prefers dark mode',
            baseRevision: 0,
            reason: 'owner said so',
            key: 'w1',
          });
          assert.equal(write.isError, false, write.text);
          assert.ok(
            (await toolNames(spec)).every((name) => name === 'doc_read' || name === 'doc_write'),
            'reviewer tools only'
          );
        }
        return {
          exitCode: exhausted ? 1 : 0,
          signal: null,
          sessionId: 's',
          reason: exhausted ? 'out_of_tokens' : 'success',
        };
      })();
      return {
        child: { exitCode: 0 },
        // The reviewer reads only tool.use / error events; this CLI emits none.
        events: (async function* () {
          await completed;
          yield* [];
        })(),
        completed,
        stop: () => undefined,
      };
    }) as never,
  });
  try {
    reviewer.start();
    reviewer.enqueue({
      attemptId: 'a1',
      conversationId: 'chat',
      context: { buddyId: lead.id, workspaceId: ws },
      completedAt: new Date().toISOString(),
      messages: [{ role: 'user', content: 'I prefer dark mode' }],
    });
    const receipt = await until(
      async () =>
        (await core.listEvents(lead.id, Number.MAX_SAFE_INTEGER, 20)).find(
          (e) => e.op === 'memory_review'
        ),
      'the review receipt'
    );
    const body = JSON.parse(receipt.payload);
    assert.deepEqual(harnesses, ['codex', 'cursor'], 'each rung bills a different provider');
    assert.equal(body.status, 'complete');
    assert.equal(body.model, 'grok-4.7-low');
    assert.equal(body.fallbackFrom, 'gpt-6-luna');
    assert.equal(body.writes.working, 1);
    const working = await core.readDoc(OWNER, {
      buddyId: lead.id,
      scope: { kind: 'buddy' },
      kind: 'working',
      name: '',
    });
    assert.equal(working?.content, 'Owner prefers dark mode');
    assert.equal(await probe(spec), 401, "the reviewer's grant dies with its attempt");
  } finally {
    reviewer.stop();
    await endpoint.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});

// A missing new-schema file means two different things (core.ts `buddiesLocation`): the owner
// still has the v33 file (import it, never run empty over it), or this is a first-time install
// (nothing to import; before 2026-09-26 it was told to import anyway and never got Buddies).
test('a missing Buddies database with the v33 file present names the import command', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'buddies-location-'));
  try {
    const legacy = join(scratch, 'buddies.sqlite');
    writeFileSync(legacy, '');
    const file = join(scratch, 'buddies-v3.sqlite');
    await assert.rejects(
      openBuddiesCore(buddiesLocation(file, legacy)),
      /buddies-import import --from/
    );
    assert.equal(existsSync(file), false, 'no empty database is created over an unimported one');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('a first-time install with no Buddies database at all opens an empty one', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'buddies-location-'));
  try {
    const file = join(scratch, 'nested', 'buddies-v3.sqlite');
    const core = await openBuddiesCore(buddiesLocation(file, join(scratch, 'buddies.sqlite')));
    assert.deepEqual(await core.listWorkspaces(), []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('the briefing tool guide stays inside its budget', () => {
  // A runtime throw on this budget failed every owner-thread turn on 2026-09-21; it is a test now.
  assert.ok(BUDDY_TOOL_GUIDE.length <= 3_000, `${BUDDY_TOOL_GUIDE.length} chars`);
});

// 2026-09-25 (92e8692): Claude reports a session-limit 429 as a successful
// result with no text. The gate read the empty answer as `unparseable` and an
// untagged owner follow-up stayed quiet instead of showing "Couldn't reply".
// Only the CLI process is stubbed.
test('a reply gate with no answer, or out of tokens, fails with the provider message', async () => {
  assert.deepEqual(parseGateVerdict('  \n'), { kind: 'failed', reason: 'no answer' });
  assert.equal(parseGateVerdict('<yes> because I own it').kind, 'unparseable');
  const gate = createCliReplyGate({
    resolveExecution: async () => ({ provider: 'claude', modelId: 'claude-opus-5-5' }),
    execute: (() => {
      async function* events() {
        yield {
          type: 'out_of_tokens',
          message: "Out of tokens: You've hit your session limit · resets 2am (Asia/Makassar)",
        };
        yield { type: 'turn.complete', reason: 'out_of_tokens' };
      }
      return {
        events: events(),
        completed: Promise.resolve({ reason: 'out_of_tokens', sessionId: 'gate-session' }),
        stop: () => undefined,
      };
    }) as never,
  });
  const verdict = await gate({ config: createDefaultConversationConfig('claude'), prompt: 'p' });
  assert.equal(verdict.kind, 'failed');
  assert.match(verdict.kind === 'failed' ? verdict.reason : '', /out_of_tokens.*session limit/);
});

test('follow-ups stop after three Buddy posts in a row, and a failed gate on an owner post is shown', async () => {
  const w = await world();
  try {
    const say = (author: 'owner' | string, body: string, replyToId?: string) =>
      w.core.post(
        author === 'owner' ? OWNER : buddyActor(author),
        { kind: 'id', id: w.general.id },
        { kind: 'inform', body, replyToId, evidence: [], key: `${author}:${body}` }
      );
    const root = await say('owner', 'Who owns the launch?');
    // Lead, Designer, Lead: two Buddies may exchange a question, an answer and one more turn…
    await w.channels.considerThreadPost(w.general, await say(w.lead.id, 'I can', root.id));
    await w.channels.considerThreadPost(
      w.general,
      await say(w.designer.id, 'Lead, which date?', root.id)
    );
    await until(() => w.gate.calls === 1, 'Lead is asked about Designer’s question');
    // …but the third Buddy post in a row asks nobody, until the owner speaks again.
    await w.channels.considerThreadPost(w.general, await say(w.lead.id, 'Friday', root.id));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(w.gate.calls, 1, 'the chain stops at three Buddy posts');

    // The owner waits on an answer, so a gate that could not run is posted in the thread
    // (2026-09-24: every gate failed on a Codex usage limit and the thread stayed silent).
    w.gate.verdict = { kind: 'failed', reason: 'usage limit' };
    await w.channels.considerThreadPost(w.general, await say('owner', 'Is Friday final?', root.id));
    const notices = await until(async () => {
      const thread = await w.core.listPosts(OWNER, { kind: 'thread', rootId: root.id }, null, 50);
      const failed = thread.posts.filter((p) => p.purpose === 'reply_failed');
      return failed.length === 2 && failed;
    }, 'one failure notice per Buddy in the thread');
    for (const notice of notices)
      assert.match(notice.body, /could not decide whether to reply \(usage limit\)/);
  } finally {
    await w.close();
  }
});

/** The owner routes over real HTTP on a world's crate. */
async function ownerHttp(w: Awaited<ReturnType<typeof world>>) {
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    core: w.core,
    events: { emit: w.emit, on: () => () => undefined },
    runner: w.runner,
    channels: w.channels,
    uploadsRoot: () => join(w.scratch, 'uploads'),
    channelChanged: () => undefined,
    onBuddyArchived: () => undefined,
    createBuilderConversation: async () => ({ conversationId: 'builder' }),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const http = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as { error: string; requests: Post[] },
    };
  };
  return { server, http };
}

test('owner routes: a DM request is answered over HTTP, typed errors keep their status, and literal paths are never read as a buddy id', async () => {
  const w = await world();
  const { server, http } = await ownerHttp(w);
  try {
    // /api/buddies/tasks and /runs are registered before /api/buddies/:buddyId (it would swallow them).
    assert.equal((await http('GET', `/api/buddies/tasks?buddyId=${w.lead.id}`)).status, 200);
    assert.equal((await http('GET', `/api/buddies/runs?buddyId=${w.lead.id}`)).status, 200);
    assert.deepEqual((await http('GET', '/api/buddies/buddy_missing')).status, 404);
    // The Buddy's request to the owner lands in the owner's inbox; the owner answers over HTTP.
    const ask = await w.core.post(
      buddyActor(w.lead.id),
      { kind: 'direct', members: [buddyActor(w.lead.id), OWNER] },
      { kind: 'request', body: 'May I deploy?', evidence: [], key: 'ask' }
    );
    const inbox = await http('GET', `/api/buddies/workspaces/${w.ws}/inbox`);
    assert.deepEqual(
      inbox.body.requests.map((p: Post) => p.id),
      [ask.id]
    );
    const answered = await http('POST', `/api/buddies/posts/${ask.id}/answer`, {
      body: 'Yes',
      key: 'yes',
    });
    assert.equal(answered.status, 201, JSON.stringify(answered.body));
    assert.equal((await w.core.getPost(OWNER, ask.id)).request.state, 'answered');
    const again = await http('POST', `/api/buddies/posts/${ask.id}/answer`, {
      body: 'Yes again',
      key: 'yes-2',
    });
    assert.equal(again.status, 400, 'one answer per request');
    assert.match(again.body.error, /^\[invalid\]/);
    // A stale soul write is a conflict the editor can reconcile, not a 500.
    const first = await http('PUT', `/api/buddies/${w.lead.id}/docs/soul`, {
      content: 'v1',
      baseRevision: 0,
      reason: 'r',
      key: 's1',
    });
    assert.equal(first.status, 200);
    const stale = await http('PUT', `/api/buddies/${w.lead.id}/docs/soul`, {
      content: 'v2',
      baseRevision: 0,
      reason: 'r',
      key: 's2',
    });
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /^\[revision_conflict\]/);

    // The owner posts a standup AS a Buddy (the pre-T11 Messages tab did); a Buddy's @mention in
    // it starts no turn. Search finds it, over HTTP and through the channel_read tool.
    const asBuddy = await http('POST', `/api/buddies/channels/${w.general.id}/posts`, {
      asBuddyId: w.designer.id,
      purpose: 'standup',
      body: `Shipped the quarterly logo [@Lead](buddy:${w.lead.id})`,
      key: 'standup-as-designer',
    });
    assert.equal(asBuddy.status, 201, JSON.stringify(asBuddy.body));
    const written = asBuddy.body as unknown as { post: Post; mentions: unknown[] };
    assert.deepEqual(written.post.author, buddyActor(w.designer.id));
    assert.deepEqual(written.mentions, [], "a Buddy's mention dispatches nothing");
    const found = await http('GET', `/api/buddies/workspaces/${w.ws}/search?q=quarterly%20LOGO`);
    assert.deepEqual(
      (found.body as unknown as Post[]).map((post) => post.id),
      [written.post.id]
    );
    const grant = w.grants.issueBuddy({
      role: 'worker',
      buddyId: w.lead.id,
      workspaceId: w.ws,
      conversationId: 'c',
      scope: { kind: 'buddy' },
      runId: null,
    });
    const searched = await call(w.endpoint.spec(grant), 'channel_read', {
      read: { search: 'quarterly' },
    });
    assert.deepEqual(
      searched.value.map((post: Post) => post.id),
      [written.post.id]
    );

    // The Builder saves a new hire's first task (it has no Buddy of its own: ownerId is required).
    const builder = w.endpoint.spec(w.grants.issueBuilder('builder-chat'));
    assert.ok((await toolNames(builder)).includes('task_write'));
    const task = await call(builder, 'task_write', {
      write: { kind: 'create', ownerId: w.designer.id, title: 'Logo v2', doneCriteria: 'Shipped' },
      key: 'builder-task',
    });
    assert.equal(task.isError, false, task.text);
    assert.equal(task.value.ownerId, w.designer.id);
    const ownerless = await call(builder, 'task_write', {
      write: { kind: 'create', title: 'Nobody', doneCriteria: 'x' },
      key: 'builder-task-2',
    });
    assert.equal(ownerless.isError, true);
  } finally {
    server.close();
    await w.close();
  }
});

test('owner routes restore what the T11 client migration dropped: reply stats, the read cursor, reply permalinks, the Task filter, clearing a profile field and directory task counts', async () => {
  const w = await world();
  const { server, http } = await ownerHttp(w);
  const json = async <T>(method: string, path: string, body?: unknown) => {
    const answer = await http(method, path, body);
    assert.ok(
      answer.status < 300,
      `${method} ${path}: ${answer.status} ${JSON.stringify(answer.body)}`
    );
    return answer.body as unknown as T;
  };
  try {
    const task = await w.core.upsertTask(OWNER, {
      kind: 'create',
      ownerId: w.lead.id,
      title: 'Launch',
      doneCriteria: 'Shipped',
      key: 'launch',
    });
    const say = (body: string, replyToId?: string, taskId?: string) =>
      w.core.post(
        buddyActor(w.lead.id),
        { kind: 'id', id: w.general.id },
        { kind: 'inform', body, replyToId, taskId, evidence: [], key: body }
      );
    const root = await say('Launch plan', undefined, task.id);
    const replies = [];
    for (let i = 0; i < 4; i += 1) replies.push(await say(`step ${i}`, root.id));
    // 1. A channel page carries each root's reply count and newest reply.
    type Page = { posts: Post[]; next?: { ord: string }; threads: ThreadStat[] };
    const page = await json<Page>('GET', `/api/buddies/channels/${w.general.id}/posts?limit=50`);
    assert.deepEqual(
      page.threads.map((t) => [t.rootId, t.replies, t.lastReplyOrd]),
      [[root.id, 4, replies[3].ord]]
    );
    // 2. The inbox names the owner's read cursor, which "New messages" is drawn against.
    await json('POST', `/api/buddies/channels/${w.general.id}/read`, { postId: replies[1].id });
    const inbox = await json<Inbox>('GET', `/api/buddies/workspaces/${w.ws}/inbox`);
    const general = inbox.channels.find((entry) => entry.channel.id === w.general.id);
    assert.equal(general?.lastReadOrd, replies[1].ord);
    // 3. A reply permalink's page starts at the reply, however many replies are newer.
    const linked = await json<Page & { root: Post }>(
      'GET',
      `/api/buddies/posts/${root.id}/thread?from=${replies[0].id}&limit=2`
    );
    assert.deepEqual(
      linked.posts.map((post) => post.id),
      [replies[1].id, replies[0].id]
    );
    assert.equal(
      (await http('GET', `/api/buddies/posts/${root.id}/thread?from=${root.id}`)).status,
      400,
      'a root is not one of its own replies'
    );
    // 4. The Task filter reads one Task's posts across channels.
    const about = await json<Page>('GET', `/api/buddies/tasks/${task.id}/posts?limit=50`);
    assert.deepEqual(
      about.posts.map((post) => post.id),
      [root.id]
    );
    // 9. Settings can put a profile field back to the default; absent fields stay.
    const set = await json<Buddy>('PATCH', `/api/buddies/${w.lead.id}`, {
      provider: 'codex',
      model: 'gpt-x',
      key: 'profile-set',
    });
    assert.equal(set.model, 'gpt-x');
    const cleared = await json<Buddy>('PATCH', `/api/buddies/${w.lead.id}`, {
      model: null,
      key: 'profile-clear',
    });
    assert.equal(cleared.model, undefined);
    assert.equal(cleared.provider, 'codex');
    // 8. Directory cards: the overview counts each Buddy's unfinished top-level tasks.
    await w.core.upsertTask(OWNER, {
      kind: 'update',
      taskId: task.id,
      baseRevision: task.revision,
      changes: { status: 'blocked', blockedReason: 'waiting on design' },
      key: 'launch-blocked',
    });
    await w.core.upsertTask(OWNER, {
      kind: 'create',
      ownerId: w.lead.id,
      parentId: task.id,
      title: 'A todo is not a task on the card',
      doneCriteria: 'd',
      key: 'launch-todo',
    });
    type Roster = { id: string; taskCounts: { buddyId: string; open: number; blocked: number }[] };
    const overview = await json<Roster[]>('GET', '/api/buddies/overview');
    assert.deepEqual(overview.find((ws) => ws.id === w.ws)?.taskCounts, [
      { buddyId: w.lead.id, open: 1, blocked: 1 },
    ]);
  } finally {
    server.close();
    await w.close();
  }
});

// Port of 6d04860 (workspace home "New workspace"): the crate reuses a workspace only on an
// IDENTICAL root_path string, so a trailing slash or a symlink used to register the same folder
// twice. A file, a missing folder or `/` must be a 400, never a workspace.
test('New workspace from a folder: the name defaults to the folder, any spelling of it reuses one workspace', async () => {
  const w = await world();
  const { server, http } = await ownerHttp(w);
  try {
    const folder = join(w.scratch, 'Atlas');
    mkdirSync(folder);
    symlinkSync(folder, join(w.scratch, 'atlas-link'));
    writeFileSync(join(w.scratch, 'notes.txt'), 'x');
    const created = await http('POST', '/api/buddies/workspaces', { rootPath: `${folder}/` });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const workspace = created.body as unknown as { id: string; name: string };
    assert.equal(workspace.name, 'Atlas');
    const again = await http('POST', '/api/buddies/workspaces', {
      rootPath: join(w.scratch, 'atlas-link'),
      name: 'Other name',
    });
    assert.equal((again.body as unknown as { id: string }).id, workspace.id);
    for (const rootPath of [join(w.scratch, 'notes.txt'), join(w.scratch, 'missing'), '/', 'rel'])
      assert.equal(
        (await http('POST', '/api/buddies/workspaces', { rootPath })).status,
        400,
        rootPath
      );
  } finally {
    server.close();
    await w.close();
  }
});
