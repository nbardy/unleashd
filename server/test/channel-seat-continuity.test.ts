import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddyContext } from '@unleashd/shared';
import { type StableConversationPorts, slotOf } from '../src/buddies/buddy-conversation-slots';
import { createChannelResponder, threadConversationId } from '../src/buddies/channel-responder';
import { chatRunAdmission } from '../src/buddies/chat-run-admission';
import type { BuddiesStorePort, BuddyMailingListPost } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddiesIntegration } from '../src/buddies/integration';
import { BuddyOperationInputSchemas, BuddyOperationsService } from '../src/buddies/operations';
import { createBuddyCreationService } from '../src/conversations/buddy-creation-service';
import { ConversationConfigService } from '../src/conversations/config-service';
import { ConversationConfigStore } from '../src/conversations/config-store';
import {
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

// A Buddy's thread seat must keep its provider session while its audience only
// GROWS, and must start fresh, shown the whole thread, when access narrows.
// 2026-09-25 03:30Z: the Buddy filed a Task from inside its seat; the audience
// hash changed, the next turn ran without --resume, and the responder sent that
// fresh session only "Replies since then (0)".
//
// Everything is real — responder, runtime (queue, run admission, audience
// check), Buddies integration and a Buddies store on disk — except the provider
// process, the external boundary. A second boot() over the same stores is a
// server restart.

type ProviderRequest = Parameters<NonNullable<ConversationRuntimeDependencies['executeTurn']>>[0];
type TurnAuthority = { context: BuddyContext; conversationId: string; token: string };

async function until<T>(read: () => T | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function world() {
  const scratch = mkdtempSync(join(tmpdir(), 'seat-continuity-'));
  // Only the injected store is used; a default one must still never be ~/.buddies.
  process.env.BUDDIES_HOME = join(scratch, 'buddies-home');
  const raw = new BuddiesStore(join(scratch, 'buddies.sqlite'));
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const workspace = raw.createWorkspace({ name: 'Team', rootPath: scratch });
  const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Answer' });
  const designer = raw.createBuddy({ project: workspace.id, name: 'Designer', role: 'UI' });
  const list = raw.createList({
    workspace: workspace.id,
    author: { kind: 'owner' },
    key: 'general',
    name: 'general',
    purpose: 'Team chat',
  }).list;
  // The provider: each turn opens or resumes a native session. `during` runs
  // inside a turn, as the Buddy's tool calls would, with that turn's authority.
  const requests: ProviderRequest[] = [];
  const during = new Map<number, (authority: TurnAuthority) => void>();
  let authority: TurnAuthority | null = null;
  const executeTurn = ((request: ProviderRequest) => {
    requests.push(request);
    const turn = requests.length;
    const turnAuthority = authority!;
    const sessionId = request.resumeSessionId ?? `native-${turn}`;
    return {
      child: { exitCode: 0 },
      events: (async function* () {
        yield { type: 'session.started' as const, sessionId };
        yield { type: 'turn.started' as const };
        during.get(turn)?.(turnAuthority);
        yield { type: 'text.delta' as const, text: `Answer ${turn}` };
        yield { type: 'turn.complete' as const, reason: 'success' as const };
      })(),
      completed: Promise.resolve({ exitCode: 0, signal: null, sessionId, reason: 'success' }),
      stop: () => undefined,
    };
  }) as unknown as NonNullable<ConversationRuntimeDependencies['executeTurn']>;

  function boot() {
    const configService = new ConversationConfigService({
      store: new ConversationConfigStore({ appDataRoot: join(scratch, 'config') }),
      resolver: { resolve: async (config) => resolveConfigAgainstProviderCatalog(config) },
    });
    const conversations = new Map<string, ConversationRuntime>();
    const integration = createBuddiesIntegration({
      store,
      getConversation: (id) => conversations.get(id),
    });
    const Conversation = createConversationRuntime({
      broadcast: () => undefined,
      registerSessionAlias: () => undefined,
      unregisterSessionAlias: () => undefined,
      clearExternalRunningStatus: () => undefined,
      clearLocalCompletionSuppression: () => undefined,
      markLocalCompletionSuppression: () => undefined,
      persistCurrentSession: (conversation, sessionId, buddyAudienceKey) =>
        creation.persistCurrentSession(conversation, sessionId, buddyAudienceKey),
      updateBuddyStatus: () => undefined,
      settleBuddyDelegation: () => undefined,
      getConversation: (id) => conversations.get(id),
      readLatestOompaRuntime: () => ({ available: false, run: null, reason: 'fixture' }),
      createSessionId: () => `provisional-${requests.length}`,
      readCurrentBuddyContext: integration.readCurrentConversation,
      ...chatRunAdmission(
        () => store,
        () => Object.keys(BuddyOperationInputSchemas)
      ),
      finishBuddyChatRun: (id, token, status, detail) => {
        store.finishBuddyRun(id, {
          claimToken: token,
          status,
          outcome: status === 'complete' ? detail : undefined,
          error: status === 'failed' ? detail : undefined,
        });
      },
      issueBuddyControlCapability: (context, conversationId, token) => {
        authority = { context, conversationId, token: token! };
        return {};
      },
      executeTurn,
    });
    const creation = createBuddyCreationService({
      configService,
      resolveBuddyConversation: integration.resolveConversation,
      resolveWorkingDirectory: (directory) => directory,
      isProviderAvailable: () => true,
      createId: () => {
        throw new Error('Seats have derived ids');
      },
      getConversation: (id) => conversations.get(id),
      createConversation: (options) => new Conversation(options),
      registerConversation: (conversation) => conversations.set(conversation.id, conversation),
      createConversationLink: async () => undefined,
      updateConversationStatus: () => undefined,
      broadcast: () => undefined,
    });
    // Production wiring (server.ts buddyConversations).
    const ports: StableConversationPorts = {
      slot: async (id) => slotOf(await configService.getRecord(id)),
      getConversation: (id) => conversations.get(id),
      ensureConversationReady: creation.ensureConversationReady,
      createConversation: (input) => creation.createServerBuddyConversation(input),
    };
    const responder = createChannelResponder({
      getStore: async () => store,
      conversations: ports,
      uploadsRoot: () => join(scratch, 'uploads'),
      gate: async () => ({ kind: 'pass' }),
      channelChanged: () => undefined,
      logger: { warn: () => undefined },
    });
    return { responder, configService };
  }

  const replies = (root: string) =>
    raw.listThread({ root }).replies.filter((post) => post.author.kind === 'buddy');
  const seatRecord = (root: BuddyMailingListPost) =>
    app.configService.getRecord(threadConversationId(root.id, lead.id, 0));
  let app = boot();
  let posts = 0;
  return {
    raw,
    store,
    lead,
    designer,
    workspace,
    requests,
    during,
    restart() {
      app = boot();
    },
    /** The owner @mentions Lead; resolves once Lead's reply lands in the thread. */
    async mention(text: string, root?: BuddyMailingListPost): Promise<BuddyMailingListPost> {
      const { post } = raw.createPost({
        list: list.id,
        author: { kind: 'owner' },
        key: `owner-${++posts}`,
        purpose: 'message',
        body: `[@Lead](buddy:${lead.id}) ${text}`,
        evidence: [],
        threadRoot: root?.id ?? null,
        conversationId: null,
        runId: null,
      });
      const threadRoot = root ?? post;
      const answered = replies(threadRoot.id).length + 1;
      assert.deepEqual(await app.responder.respondToOwnerPost(list, post, new Map()), [
        { buddyId: lead.id, status: 'started' },
      ]);
      await until(() => replies(threadRoot.id).length === answered, `Lead's reply to "${text}"`);
      return post;
    },
    savedAudienceKey: async (root: BuddyMailingListPost) =>
      (await seatRecord(root))!.currentSession!.buddyAudienceKey,
    setSavedAudienceKey: async (root: BuddyMailingListPost, buddyAudienceKey: string) => {
      const record = (await seatRecord(root))!;
      await app.configService.setCurrentSession(record.conversationId, {
        ...record.currentSession!,
        buddyAudienceKey,
      });
    },
    /** Owner-only grant of read access (host API; no MCP tool can mutate grants). */
    grantRead(capabilities: string[], baseRevision: number) {
      raw.setBuddyAccess({
        granteeId: lead.id,
        workspaceId: workspace.id,
        targetBuddyId: designer.id,
        capabilities: capabilities as never,
        baseRevision,
        key: `grant-${baseRevision}`,
        reason: 'Review the designer',
      });
    },
    close() {
      raw.close();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

test('a seat keeps its provider session when its Buddy files a Task or gains a read grant', async () => {
  const w = world();
  try {
    // The Buddy files a Task from inside its seat, through the real operation.
    w.during.set(1, ({ context, conversationId, token }) => {
      new BuddyOperationsService(
        w.store,
        { ...context, conversationId, allowedOperations: context.allowedBuddyOperations },
        { automationClaimToken: token }
      ).execute('buddy.new_project', {
        key: 'filed-from-thread',
        title: 'Filed from the thread',
        definitionOfDone: 'Docs shipped',
      });
    });
    const root = await w.mention('ROOT_QUESTION how should we ship?');
    assert.equal(w.requests[0].resumeSessionId, undefined);
    const builtUnder = await w.savedAudienceKey(root);
    assert.equal(
      w.raw.listBuddyOwnedProjects({ buddy: w.lead.id, workspace: w.workspace.id }).length,
      1
    );

    await w.mention('FOLLOW_UP_ONE and the docs?', root);
    assert.equal(
      w.requests[1].resumeSessionId,
      'native-1',
      'a new readable Task keeps the session'
    );
    // Non-vacuous: the audience really changed, and the session adopted it.
    assert.notEqual(await w.savedAudienceKey(root), builtUnder);
    // Resumed, it is sent only what is new: the root is already in its session.
    assert.match(w.requests[1].prompt, /Replies since then/);
    assert.doesNotMatch(w.requests[1].prompt, /ROOT_QUESTION/);

    w.grantRead(['memory.read'], 0);
    await w.mention('FOLLOW_UP_TWO check the designer notes', root);
    assert.equal(w.requests[2].resumeSessionId, 'native-1', 'a new read grant keeps the session');
  } finally {
    w.close();
  }
});

test('a seat whose access narrows starts a fresh session and is shown the whole thread', async () => {
  const w = world();
  try {
    w.grantRead(['memory.read'], 0);
    const root = await w.mention('ROOT_QUESTION how should we ship?');
    await w.mention('FOLLOW_UP_ONE and the docs?', root);
    assert.equal(w.requests[1].resumeSessionId, 'native-1');
    assert.match(w.requests[1].prompt, /Replies since then/);

    w.grantRead([], 1);
    await w.mention('AFTER_REVOKE where are we?', root);
    // Its transcript may hold what the narrowed audience cannot read.
    assert.equal(w.requests[2].resumeSessionId, undefined, 'narrowed access starts fresh');
    // A fresh session remembers nothing, so it gets the thread, not a delta.
    assert.doesNotMatch(w.requests[2].prompt, /Replies since then/);
    assert.match(w.requests[2].prompt, /ROOT_QUESTION/);
    assert.match(w.requests[2].prompt, /FOLLOW_UP_ONE/);
    assert.match(w.requests[2].prompt, /Answer 2/);
  } finally {
    w.close();
  }
});

test('a restored seat is judged against the audience it last grew into; a legacy key starts fresh', async () => {
  const w = world();
  try {
    const root = await w.mention('ROOT_QUESTION how should we ship?');
    w.grantRead(['memory.read'], 0);
    // Resumed under the grown audience: the session may now hold its content.
    await w.mention('FOLLOW_UP_ONE check the designer notes', root);
    assert.equal(w.requests[1].resumeSessionId, 'native-1');

    w.restart();
    w.grantRead([], 1);
    await w.mention('AFTER_REVOKE where are we?', root);
    // Compared with the restored pre-grant key this would look contained; the
    // persisted key must be the grown one, so the revoke starts fresh.
    assert.equal(w.requests[2].resumeSessionId, undefined, 'restored grown key, then narrowed');

    // A key saved before descriptors (a bare revision hash) cannot be compared.
    await w.setSavedAudienceKey(root, 'a'.repeat(64));
    w.restart();
    await w.mention('AFTER_UPGRADE still there?', root);
    assert.equal(w.requests[3].resumeSessionId, undefined, 'a legacy saved key starts fresh');
    assert.match(w.requests[3].prompt, /ROOT_QUESTION/);
  } finally {
    w.close();
  }
});
