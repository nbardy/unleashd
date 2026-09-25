import { randomUUID } from 'node:crypto';
import type { McpServerSpec } from '@nbardy/agent-cli';
import type { BuddyContext } from '@unleashd/shared';
import type { ConversationRuntimeDependencies } from '../conversations/runtime';
import type { Briefings, ResolvedBuddyConversation } from './briefing';
import { docScopeFor } from './core';
import type { Grants, TurnGrant } from './grants';
import { MCP_SERVER_NAME } from './mcp';
import type { CompletedBuddyTurn, MemoryReviewer } from './memory-review';
import type { ChatAdmission, Runner } from './runner';

/**
 * The narrow interface the conversation runtime's BuddyTurnPolicy (T08) calls for one Buddy turn.
 * Everything Buddy-specific a turn needs goes through here: the briefing, run admission, the one
 * MCP server (an HTTP spec carrying a fresh per-turn grant), settle, and the post-turn hook.
 */
export interface BuddyPolicyPort {
  /** Compose the briefing for this turn's audience (and cache it for a synchronous read). */
  briefing(context: BuddyContext): Promise<ResolvedBuddyConversation>;
  /** Line a chat turn up behind its Buddy's run limit; poll `admission` with the returned id. */
  enqueueChat(context: BuddyContext, conversationId: string): string;
  admission(turnId: string): ChatAdmission;
  abandon(turnId: string): void;
  /**
   * The MCP servers of one turn. `owner` is true only for an owner-authored input (B1): it is
   * the one thing that turns the principal into the Owner.
   */
  mcpServers(turn: { context: BuddyContext; conversationId: string; owner: boolean }): Record<
    string,
    McpServerSpec
  >;
  builderMcpServers(conversationId: string): Record<string, McpServerSpec>;
  /** The turn ended: settle its run and revoke its grants. */
  settle(
    runId: string,
    leaseToken: string,
    status: 'complete' | 'failed' | 'cancelled',
    detail: string
  ): void;
  revoke(conversationId: string): void;
  /** After a successful turn: memory review. */
  afterTurn(turn: CompletedBuddyTurn): void;
}

export function createBuddyPolicyPort(deps: {
  runner: Runner;
  grants: Grants;
  briefings: Briefings;
  reviewer: MemoryReviewer;
  spec(grant: TurnGrant): McpServerSpec;
}): BuddyPolicyPort {
  const { runner, grants, briefings } = deps;
  return {
    briefing: (context) => briefings.warm(context),
    enqueueChat(context, conversationId) {
      const turnId = randomUUID();
      runner.enqueueChat(context, conversationId, turnId);
      return turnId;
    },
    admission: (turnId) => runner.chatAdmission(turnId),
    abandon: (turnId) => runner.abandonChat(turnId),
    mcpServers({ context, conversationId, owner }) {
      const grant = grants.issueBuddy({
        role: 'worker',
        buddyId: context.buddyId,
        workspaceId: context.workspaceId,
        conversationId,
        scope: docScopeFor(context),
        runId: context.coordinationRunId ?? null,
      });
      if (owner) grants.promoteToOwner(conversationId);
      return { [MCP_SERVER_NAME]: deps.spec(grant) };
    },
    builderMcpServers: (conversationId) => ({
      [MCP_SERVER_NAME]: deps.spec(grants.issueBuilder(conversationId)),
    }),
    settle(runId, leaseToken, status, detail) {
      const outcome =
        status === 'complete'
          ? ({ kind: 'complete', text: detail } as const)
          : status === 'failed'
            ? ({ kind: 'failed', code: 'execution_failed', error: detail } as const)
            : ({ kind: 'cancelled', reason: detail } as const);
      void runner
        .finishChat(runId, leaseToken, outcome)
        .catch((error) => console.error('[buddies] settle failed', runId, error));
    },
    revoke: (conversationId) => grants.revokeConversation(conversationId),
    afterTurn: (turn) => deps.reviewer.enqueue(turn),
  };
}

// ---- Legacy adapter: today's runtime.ts hooks over the port. Delete in the post-T08 wiring. ----
//
// runtime.ts (untouched by T11) asks for MCP servers through `mcp-config.ts` with env records it
// got from `issueBuddyControlCapability` / `issueOwnerControlCapability`. The adapter passes the
// endpoint URL and the grant token through those env records, and the shim builds the HTTP spec
// from them. Owner authority rides on the same grant (promoted), so the owner server is empty.

export const GRANT_URL_ENV = 'UNLEASHD_BUDDY_MCP_URL';
export const GRANT_TOKEN_ENV = 'UNLEASHD_BUDDY_MCP_TOKEN';

export function specFromEnv(env: Readonly<Record<string, string>>): Record<string, McpServerSpec> {
  const url = env[GRANT_URL_ENV];
  const token = env[GRANT_TOKEN_ENV];
  if (!url || !token)
    throw new Error('A Buddy turn has no MCP grant: issue one before building its MCP servers');
  return {
    [MCP_SERVER_NAME]: {
      kind: 'http',
      url,
      headers: { Authorization: `Bearer ${token}` },
      required: true,
    },
  };
}

type BuddyHooks = Pick<
  ConversationRuntimeDependencies,
  | 'readCurrentBuddyContext'
  | 'reviewCompletedBuddyTurn'
  | 'enqueueBuddyChatRun'
  | 'startBuddyChatRun'
  | 'abandonBuddyChatRun'
  | 'finishBuddyChatRun'
  | 'issueBuddyControlCapability'
  | 'revokeBuddyControlCapability'
  | 'issueOwnerControlCapability'
  | 'updateBuddyStatus'
  | 'settleBuddyDelegation'
>;

export function legacyRuntimeHooks(
  port: BuddyPolicyPort,
  deps: {
    briefings: Briefings;
    grants: Grants;
    leaseMs: number;
    isBuilder(conversationId: string): boolean;
  }
): BuddyHooks {
  const envOf = (servers: Record<string, McpServerSpec>): Record<string, string> => {
    const spec = servers[MCP_SERVER_NAME];
    if (spec?.kind !== 'http') throw new Error('Buddy MCP spec must be HTTP');
    return {
      [GRANT_URL_ENV]: spec.url,
      [GRANT_TOKEN_ENV]: spec.headers!.Authorization.slice('Bearer '.length),
    };
  };
  return {
    // Warmed by the runner as it admits the turn (briefing.ts): synchronous here by contract.
    readCurrentBuddyContext: (context) => deps.briefings.current(context),
    reviewCompletedBuddyTurn: (turn) => port.afterTurn(turn),
    enqueueBuddyChatRun: (context, conversationId) => ({
      id: port.enqueueChat(context, conversationId),
    }),
    startBuddyChatRun(turnId, _conversationId, maxRuntimeMs) {
      // A lease shorter than the turn budget would kill a healthy turn (2026-09-10 incident).
      if (maxRuntimeMs > deps.leaseMs)
        throw new Error(
          `Buddy run lease ${deps.leaseMs} ms is shorter than the turn budget ${maxRuntimeMs} ms`
        );
      return port.admission(turnId);
    },
    abandonBuddyChatRun: (turnId) => port.abandon(turnId),
    finishBuddyChatRun: (runId, leaseToken, status, detail) =>
      port.settle(runId, leaseToken, status, detail ?? ''),
    issueBuddyControlCapability: (context, conversationId) =>
      envOf(port.mcpServers({ context, conversationId, owner: false })),
    revokeBuddyControlCapability: (conversationId) => port.revoke(conversationId),
    // runtime.ts calls this only for origin 'owner_input' (the B1 rule lives there and in channels.ts).
    issueOwnerControlCapability(_input, conversationId) {
      if (deps.isBuilder(conversationId)) return envOf(port.builderMcpServers(conversationId));
      deps.grants.promoteToOwner(conversationId);
      return {};
    },
    // Conversation link status and delegation settlement are gone with their tables.
    updateBuddyStatus: () => undefined,
    settleBuddyDelegation: () => undefined,
  };
}
