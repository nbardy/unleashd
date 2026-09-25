import { randomUUID } from 'node:crypto';
import type { McpServerSpec } from '@nbardy/agent-cli';
import type { BuddyContext } from '@unleashd/shared';
import { TURN_MAX_RUNTIME_MS } from '../constants/timeouts';
import type { Briefings, ResolvedBuddyConversation } from './briefing';
import { docScopeFor } from './core';
import type { Grants, TurnGrant } from './grants';
import { MCP_SERVER_NAME } from './mcp';
import type { CompletedBuddyTurn, MemoryReviewer } from './memory-review';
import type { ChatAdmission, Runner } from './runner';

/**
 * The narrow interface BuddyTurnPolicy (buddies/turn-policy.ts) calls for one Buddy turn.
 * Everything Buddy-specific a turn needs goes through here: the briefing, run admission, the one
 * MCP server (an HTTP spec carrying a fresh per-turn grant), settle, and the post-turn hook.
 */
export interface BuddyPolicyPort {
  /** The briefing composed for this context right before its turn (synchronous; see briefing.ts). */
  currentBriefing(context: BuddyContext): ResolvedBuddyConversation;
  /** Line a chat turn up behind its Buddy's run limit; poll `admission` with the returned id. */
  enqueueChat(context: BuddyContext, conversationId: string): string;
  admission(turnId: string): ChatAdmission;
  abandon(turnId: string): void;
  /**
   * The MCP servers of one turn: one server, one fresh grant. `owner` is true only for an
   * owner-authored input (B1); it is the one thing that makes the principal the Owner. A grant
   * is issued whole, so there is no issue order to keep (T08 had to issue the Buddy grant before
   * the owner grant because issuing revoked the conversation's earlier grants).
   */
  mcpServers(turn: {
    context: BuddyContext;
    conversationId: string;
    owner: boolean;
  }): Record<string, McpServerSpec>;
  builderMcpServers(conversationId: string): Record<string, McpServerSpec>;
  /** The turn ended: settle its run (which also revokes the run's grants). */
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
  // A chat's deadline is its run's lease. A lease shorter than the turn budget killed healthy
  // owner chats at 600 s on 2026-09-10; refuse to build that. Guard: buddies-v2.test.ts.
  if (runner.leaseMs < TURN_MAX_RUNTIME_MS)
    throw new Error(`Buddy run lease ${runner.leaseMs} ms < TURN_MAX_RUNTIME_MS`);
  return {
    currentBriefing: (context) => briefings.current(context),
    enqueueChat(context, conversationId) {
      const turnId = randomUUID();
      runner.enqueueChat(context, conversationId, turnId);
      return turnId;
    },
    admission: (turnId) => runner.chatAdmission(turnId),
    abandon: (turnId) => runner.abandonChat(turnId),
    mcpServers({ context, conversationId, owner }) {
      // A new turn's grant replaces whatever this conversation still held.
      grants.revokeConversation(conversationId);
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
    builderMcpServers(conversationId) {
      grants.revokeConversation(conversationId);
      return { [MCP_SERVER_NAME]: deps.spec(grants.issueBuilder(conversationId)) };
    },
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
