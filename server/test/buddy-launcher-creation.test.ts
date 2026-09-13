import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { BuddyRunExecutor } from '../src/buddies/run-executor';
import { createBuddyCreationService } from '../src/conversations/buddy-creation-service';
import { ConversationConfigService } from '../src/conversations/config-service';
import { ConversationConfigStore } from '../src/conversations/config-store';
import type { ConversationRuntime } from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

for (const failure of [
  'before persistence',
  'after persistence',
  'after registration',
  'deleted before retry',
  'registered then deleted',
] as const) {
  test(`explicit retry of a fresh Buddy creation: ${failure}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'buddy-launcher-creation-'));
    const raw = new BuddiesStore(':memory:');
    const store = coordinationStore(raw as unknown as BuddiesStorePort);
    const workspace = raw.createWorkspace({ name: 'Launcher fixture', rootPath: root });
    const chief = raw.createBuddy({ project: workspace.id, name: 'Chief', role: 'Coordinate' });
    const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Review' });
    store.setCoordinationMembership(lead.id, workspace.id, { background_enabled: true });
    const configStore = new ConversationConfigStore({ appDataRoot: root });
    const configService = new ConversationConfigService({
      store: configStore,
      resolver: { resolve: async (value) => resolveConfigAgainstProviderCatalog(value) },
    });
    const conversations = new Map<string, ConversationRuntime>();
    let failCreation = true;
    let providerTurns = 0;
    let linked = false;
    let linkAttempts = 0;
    const creation = createBuddyCreationService({
      configService,
      getConversation: (id) => conversations.get(id),
      resolveBuddyConversation: async (context) => {
        if (failCreation && failure === 'before persistence')
          throw new Error('fixture creation failure');
        return {
          context,
          briefing: 'Fixture',
          workingDirectory: root,
          provider: 'codex',
          model: 'gpt-5.6-sol',
        };
      },
      resolveWorkingDirectory: (directory) => directory,
      isProviderAvailable: () => true,
      createId: () => assert.fail('Executor supplies stable identity'),
      createConversation: (options) => {
        const conversation = {
          id: options.id,
          buddyContext: options.buddyContext,
          placement: options.placement,
          hasActiveProcess: () => false,
          isRunning: false,
          queue: [],
          stop: () => {},
          waitForTurnDrain: async () => {},
          toJSON: (() => ({ id: options.id })) as ConversationRuntime['toJSON'],
          enqueueMessage: () => assert.fail('Creation must not enqueue outside run authority'),
          runCoordinationMessage: async (prompt, context, token, settle) => {
            assert.ok(linked, 'No input admission before successful linkage');
            providerTurns++;
            assert.match(prompt, /Read the handoff/);
            const run = store.getBuddyRun(context.coordinationRunId!)!;
            assert.equal(run.status, 'running');
            new BuddyOperationsService(
              store,
              {
                ...context,
                conversationId: options.id,
                allowedOperations: context.allowedBuddyOperations,
              },
              { automationClaimToken: token }
            ).execute('buddy.reply', {
              messageId: run.input_id,
              outcome: 'complete',
              body: 'Read the handoff',
              evidence: ['fixture: acknowledged under the current claim'],
            });
            settle?.('complete', 'Reply saved');
            return 'Reply saved';
          },
        } satisfies Partial<ConversationRuntime>;
        return conversation as ConversationRuntime;
      },
      registerConversation: (conversation) => {
        if (failCreation && !['after registration', 'registered then deleted'].includes(failure))
          throw new Error('fixture creation failure');
        conversations.set(conversation.id, conversation);
      },
      createConversationLink: async () => {
        linkAttempts++;
        if (failCreation) throw new Error('fixture creation failure');
        linked = true;
      },
      updateConversationStatus: () => {},
      broadcast: () => {},
    });
    const executor = new BuddyRunExecutor({
      store,
      getConversation: (id) => conversations.get(id),
      createConversation: creation.createServerBuddyConversation,
      ensureConversationReady: creation.ensureConversationReady,
    });
    const drain = async () => {
      for (let n = 0; n < 200 && executor.activeRunIds.length; n++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(executor.activeRunIds.length, 0);
    };
    try {
      const message = store.sendCoordinatedMessage(
        {
          fromBuddy: chief.id,
          to: lead.id,
          workspace: workspace.id,
          purpose: 'review',
          body: 'Read the handoff',
          key: 'review',
        },
        { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
      );
      executor.poll();
      await drain();
      const original = store.listBuddyRuns({ buddyId: lead.id })[0];
      assert.equal(original.status, 'failed');
      assert.match(original.error!, /fixture creation failure/);
      assert.equal(store.getMessage(message.id)?.child_conversation_id, null);
      assert.equal(providerTurns, 0);
      const record = await configStore.getByConversationId(original.conversation_id!);
      assert.equal(!!record, failure !== 'before persistence');
      if (record) assert.equal(record.creation?.initialMessage, undefined);
      failCreation = false;
      executor.poll();
      await drain();
      assert.equal(providerTurns, 0, 'polling alone must not retry failed work');
      if (failure === 'deleted before retry' || failure === 'registered then deleted')
        await configStore.delete(original.conversation_id!);
      const retry = store.retryBuddyRun(original.id, {
        key: 'explicit-retry',
        actor: chief.id,
        reason: 'Creation fixed',
      });
      executor.poll();
      await drain();
      const retried = store.getBuddyRun(retry.id)!;
      assert.equal(retried.conversation_id, original.conversation_id);
      if (failure === 'deleted before retry' || failure === 'registered then deleted') {
        assert.equal(retried.status, 'failed');
        assert.match(retried.error!, /deleted/i);
        assert.equal(providerTurns, 0);
        assert.equal(conversations.size, failure === 'registered then deleted' ? 1 : 0);
        assert.equal(
          (await configStore.getByConversationId(original.conversation_id!))?.status,
          'deleted'
        );
      } else {
        assert.equal(retried.status, 'complete', retried.error ?? undefined);
        assert.equal(providerTurns, 1);
        assert.equal(linkAttempts, failure === 'after registration' ? 2 : 1);
        assert.equal(conversations.size, 1);
        assert.equal(store.getMessage(message.id)?.status, 'replied');
        const saved = await configStore.getByConversationId(original.conversation_id!);
        assert.equal(saved?.creation?.commandId, `coordination-${original.id}`);
        assert.equal(saved?.creation?.initialMessage, undefined);
        assert.equal(saved?.creation?.placement, 'background');
        await creation.dispatchInitialMessageIfPending(
          conversations.get(original.conversation_id!)!
        );
        assert.equal(providerTurns, 1, 'startup dispatch cannot replay the run prompt');
      }
    } finally {
      executor.stop();
      raw.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
