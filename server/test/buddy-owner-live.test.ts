import { createBuddiesIntegration } from '../src/buddies/integration';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { executeCommand } from '@nbardy/agent-cli';
import { BuddiesStore } from '@nbardy/buddies';
import {
  type BuddyContext,
  createDefaultConversationConfig,
  BUDDY_RESOURCE_CONTRACT_VERSION,
} from '@unleashd/shared';
import type { BuddiesStorePort } from '../src/buddies/contract';
import {
  BuddyControlServer,
  OWNER_CONTROL_TOKEN_ENV,
  OWNER_CONTROL_URL_ENV,
} from '../src/buddies/control-server';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddyDispatchService } from '../src/buddies/dispatch-service';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { BuddyRunExecutor } from '../src/buddies/run-executor';
import {
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';
import { createBuddyCreationService } from '../src/conversations/buddy-creation-service';
import { ConversationConfigService } from '../src/conversations/config-service';
import { ConversationConfigStore } from '../src/conversations/config-store';

test(
  'live provider configures isolated staff and delivers a bounded completion to the lead',
  { skip: process.env.UNLEASHD_LIVE_OWNER_TEAM !== '1', timeout: 600_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'buddy-owner-e2e-'));
    const raw = new BuddiesStore(join(root, 'buddies.sqlite'));
    const store = coordinationStore(raw as unknown as BuddiesStorePort);
    const w = raw.createWorkspace({
      name: 'Background runtime',
      rootPath: root,
    });
    const buddy = raw.createBuddy({ project: w.id, name: 'Engineer', role: 'Deliver' });
    const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
    const project = (
      new BuddyOperationsService(store, { buddyId: buddy.id, workspaceId: w.id }).execute(
        'buddy.new_project',
        {
          key: 'work',
          title: 'Arithmetic audit',
          definitionOfDone: 'Confirm 2 + 2 = 4 and record arithmetic evidence',
          todos: [{ title: 'Verify sum', definitionOfDone: '2 + 2 = 4 verified' }],
        }
      ) as { data: { id: string } }
    ).data;
    const conversations = new Map<string, ConversationRuntime>();
    const integration = createBuddiesIntegration({
      getConversation: (id) => conversations.get(id),
      store,
    });
    await integration.getStore();
    const visits: string[] = [];
    let input!: { context: BuddyContext; conversationId: string; token: string };
    let workerTurns = 0;
    let returnTurns = 0;
    let ownerTurns = 0;
    const origins: string[] = [];
    let ownerEnv: Readonly<Record<string, string>> = {};
    const control = new BuddyControlServer({
      getStore: async () => store,
      isConversationActive: (id) => conversations.get(id)?.isRunning === true,
      dispatchDelegation: async () => {
        throw new Error('unused');
      },
      dispatchReview: async () => {
        throw new Error('unused');
      },
    });
    await control.start();
    const setup = {
      workspaceId: w.id,
      reason: 'Owner requested lead and engineer',
      relationships: [
        { from: { id: lead.id }, to: { id: buddy.id }, kind: 'manager', present: true },
      ],
      memberships: [lead, buddy].map((member) => ({
        buddy: { id: member.id },
        present: true,
        incoming: false,
        dispatch: true,
      })),
      access: [
        {
          grantee: { id: lead.id },
          target: { id: buddy.id },
          profile: 'read',
          soul: 'write',
          memory: 'write',
          incoming: true,
        },
      ],
    };
    const config = createDefaultConversationConfig('codex');
    const Conversation = createConversationRuntime({
      broadcast: () => {},
      registerSessionAlias: () => {},
      unregisterSessionAlias: () => {},
      clearExternalRunningStatus: () => {},
      clearLocalCompletionSuppression: () => {},
      markLocalCompletionSuppression: () => {},
      persistCurrentSession: async () => {},
      updateBuddyStatus: () => {},
      settleBuddyDelegation: () => {},
      getConversation: (id) => conversations.get(id),
      readLatestOompaRuntime: () => ({ available: false, run: null, reason: 'fixture' }),
      createSessionId: () => `session-${visits.length}`,
      readCurrentBuddyContext: integration.readCurrentConversation,
      beginBuddyChatRun: (context, conversationId, maxRuntimeMs) => {
        const run = store.beginBuddyChatRun({
          buddyId: context.buddyId,
          workspaceId: context.workspaceId,
          conversationId,
          allowedOperations: MESSAGE_BUDDY_OPERATIONS,
          maxRuntimeSeconds: maxRuntimeMs / 1000,
        });
        return { id: run.id, claim_token: run.claim_token!, deadline: run.deadline! };
      },
      finishBuddyChatRun: (id, token, status, detail) => {
        store.finishBuddyRun(id, { claimToken: token, status, outcome: detail });
      },
      recordBuddyTurnOrigin: (_id, source) => {
        origins.push(source.origin);
      },
      issueOwnerControlCapability: (source, conversationId) => {
        ownerEnv = control.issueOwner(source, conversationId, [w.id]);
        return ownerEnv;
      },
      revokeBuddyControlCapability: (id) => control.revoke(id),
      issueBuddyControlCapability: (context, conversationId, token) => {
        input = { context, conversationId, token: token! };
        return control.issue(context, conversationId, token);
      },
      executeTurn: ((request) => {
        const current = input;
        const run = store.getBuddyRun(current.context.coordinationRunId!)!;
        const ownerRequest = 'unleashd_owner' in (request.mcpServers ?? {});
        if (ownerRequest) ownerTurns++;
        else if (run.input_kind === 'message_reply') returnTurns++;
        else workerTurns++;
        visits.push(current.conversationId);
        if (!ownerRequest) {
          assert.equal(request.mcpServers?.unleashd_owner, undefined);
          assert.equal(
            request.resumeSessionId,
            undefined,
            'Team callback must start a fresh audience context'
          );
          assert.equal(request.prompt.includes('OWNER_PRIVATE_CANARY'), false);
        }
        const servers = Object.fromEntries(
          Object.entries(request.mcpServers ?? {}).map(([name, spec]) => [
            name,
            { ...spec, env: { ...spec.env, BUDDIES_HOME: root } },
          ])
        );
        const turn = executeCommand({ ...request, cwd: root, mcpServers: servers });
        const timer = setTimeout(() => turn.stop(), 180_000);
        const completed = turn.completed.finally(() => clearTimeout(timer));
        return { ...turn, completed };
      }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
    });
    const configStore = new ConversationConfigStore({ appDataRoot: root });
    const creation = createBuddyCreationService({
      configService: new ConversationConfigService({
        store: configStore,
        resolver: { resolve: async (value) => resolveConfigAgainstProviderCatalog(value) },
      }),
      getConversation: (id) => conversations.get(id),
      resolveBuddyConversation: async (context) => ({
        ...(await integration.resolveConversation(context)),
        provider: 'codex',
        model: 'gpt-5.6-sol',
      }),
      resolveWorkingDirectory: (directory) => directory,
      isProviderAvailable: () => true,
      createId: () => assert.fail('Explicit fixture conversation identity required'),
      createConversation: (options) => new Conversation(options),
      registerConversation: (conversation) => {
        conversations.set(conversation.id, conversation);
      },
      createConversationLink: async (conversation) => {
        raw.linkConversation({
          buddy: conversation.buddyContext!.buddyId,
          workspace: conversation.buddyContext!.workspaceId,
          provider: 'codex',
          unleashdConversationId: conversation.id,
        });
      },
      updateConversationStatus: () => {},
      broadcast: () => {},
    });
    const owner = await creation.createServerBuddyConversation({
      context: { buddyId: lead.id, workspaceId: w.id },
      conversationId: 'owner-thread',
      commandId: 'fixture-chief',
      deferInitialMessage: true,
    });
    const executor = new BuddyRunExecutor({
      store,
      getConversation: (id) => conversations.get(id),
      createConversation: creation.createServerBuddyConversation,
      ensureConversationReady: creation.ensureConversationReady,
    });
    const dispatch = createBuddyDispatchService({
      getStore: async () => store,
      createConversation: async () => {
        throw new Error('durable producer must not start provider');
      },
      dispatchInitialMessage: async () => {},
      abandonConversation: () => {},
      createId: () => 'unused',
    });
    let originalMessageId = '';
    try {
      owner.sendMessage(
        `Owner integration test in isolated temporary workspace. Use ONLY native MCP tools. Preview then apply unleashd_owner.configure_team key owner-setup configuration ${JSON.stringify(setup)}. Do not enable incoming yet. Do not ask approval: this exact setup is authorized. After apply get_capabilities for the engineer. Also use owner get_document/update_document to publish a working handoff with scope {kind:"project",projectId:"${project.id}"}, targetBuddyId "${buddy.id}" and content "Audit 2+2=4 against the assigned criteria". Use the read revision, key imported-audit-handoff, reason owner-directed import, preview true then false. Incoming remains disabled. OWNER_PRIVATE_CANARY is private to this owner chat and must not appear in any published document. Final briefly report receipt.`,
        { origin: 'owner_input', inputId: 'owner-onboarding' }
      );
      await owner.waitForTurnDrain();
      assert.equal(ownerTurns, 1);
      const context = { buddyId: lead.id, workspaceId: w.id };
      const operations = new BuddyOperationsService(store, {
        ...context,
        conversationId: 'owner-thread',
      });
      const prepared = operations.prepareMessage({
        to: buddy.id,
        projectId: project.id,
        key: 'background-start',
        purpose: 'deliver',
        body: 'Perform a bounded arithmetic audit: verify 2+2=4. Read the assigned project and todos, mark the todo and project done with concrete arithmetic completion evidence using update_project; then reply done. Only native Buddy tools; no filesystem or other changes. Do not request additional work.',
        execution: { mode: 'until_done', maxRuns: 3, maxDurationSeconds: 600 },
        expectsReply: true,
      });
      const first = (await dispatch.send(context, prepared)) as {
        data: { message: { id: string } };
      };
      const repeated = (await dispatch.send(context, prepared)) as {
        data: { message: { id: string } };
      };
      assert.equal(first.data.message.id, repeated.data.message.id);
      originalMessageId = first.data.message.id;
      assert.equal(raw.getMessageExecution(originalMessageId).code, 'background_disabled');
      for (const membership of setup.memberships) membership.incoming = true;
      owner.sendMessage(
        `Owner authorizes activation now. Preview and apply unleashd_owner.configure_team key owner-activation with configuration ${JSON.stringify(setup)}. Inspect original queued message ${originalMessageId}; do not resend, wait or do the arithmetic yourself. Final briefly report applied receipt.`,
        { origin: 'owner_input', inputId: 'real-owner-command' }
      );
      await owner.waitForTurnDrain();
      assert.equal(ownerTurns, 2);
      assert.equal(
        (
          await fetch(ownerEnv[OWNER_CONTROL_URL_ENV], {
            method: 'POST',
            headers: { authorization: `Bearer ${ownerEnv[OWNER_CONTROL_TOKEN_ENV]}` },
            body: '{}',
          })
        ).status,
        403
      );
      for (let i = 0; i < 1200; i++) {
        executor.poll();
        if (workerTurns > 0 && executor.activeRunIds.length === 0 && store.listBuddyRuns({ limit: 100 }).some((run) => run.input_kind === 'message_reply' && run.status === 'complete')) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.ok(workerTurns >= 1 && workerTurns <= 3);
      assert.deepEqual(origins.slice(0, 2), ['owner_input', 'owner_input']);
      assert.ok(origins.slice(2).every((origin) => origin === 'buddy_message'));
      assert.equal(returnTurns, 0, 'the owner reads worker results from the mailbox');
      const delivery = store.listBuddyRuns({ limit: 100 }).find((run) => run.input_kind === 'message_reply')!;
      assert.equal(delivery.outcome, 'mailbox_only');
      assert.equal(delivery.acknowledged_at, null);
      assert.equal(conversations.size, 2);
      assert.equal(new Set(visits.filter((id) => id !== 'owner-thread')).size, 1);
      assert.equal(store.getMessage(first.data.message.id)?.status, 'replied');
      const execution = raw.getMessageExecution(first.data.message.id);
      assert.equal(execution.background?.disposition, 'done');
      assert.equal(execution.background?.runsUsed, workerTurns);
      assert.equal(
        store.listBuddyRuns({ limit: 100 }).length,
        ownerTurns + workerTurns + returnTurns
      );
      assert.ok(store.listBuddyRuns({ limit: 100 }).every((run) => run.status === 'complete'));
      console.log(
        JSON.stringify({
          verified: true,
          projectId: project.id,
          messageId: originalMessageId,
          ownerTurns,
          workerTurns,
          returnTurns,
          evidence: raw.getBuddyProject(project.id)?.completion_evidence,
          resourceContract: BUDDY_RESOURCE_CONTRACT_VERSION,
          teamContract: raw.getTeamContractVersion(),
        })
      );
    } finally {
      executor.stop();
      for (const conversation of conversations.values()) {
        if (conversation.isRunning) conversation.stop();
      }
      await Promise.all(
        [...conversations.values()].map((conversation) => conversation.waitForTurnDrain())
      );
      await control.close();
      raw.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
);
