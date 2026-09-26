import { randomBytes } from 'node:crypto';
import type { Actor } from '@unleashd/buddies-core';
import { OWNER, buddyActor } from './core';

/**
 * What one turn may do through the MCP endpoint. The token is readable by the agent's own
 * shell (T07: it sits in the CLI's env, or a 0600 file for muse), so a grant lives exactly as
 * long as its turn: revoked at settle, cancel or expiry, never reused.
 *
 * `author` is who posts and answers are written as. `principal` is whose authority task, doc,
 * run, schedule and team writes use. Only an owner-authored input makes the principal the
 * Owner (B1, T03: a seat answering another Buddy's post never holds owner authority).
 * The crate's `authorize` decides every call; the role only picks which tools are listed.
 */
// Pattern: capability-grants (docs/patterns.md#capability-grants)
export type Role = 'worker' | 'owner' | 'reviewer' | 'builder';

interface GrantBase {
  readonly token: string;
  readonly conversationId: string;
  readonly expiresAt: number;
  readonly author: Actor;
  readonly principal: Actor;
  /** Called before each tool call; the reviewer counts calls and records its reads here. */
  readonly observe: (tool: string, input: unknown) => void;
}

/** A Buddy's turn: a worker, an owner-authored turn, or the post-turn memory reviewer. */
export interface BuddyGrant extends GrantBase {
  readonly role: 'worker' | 'owner' | 'reviewer';
  readonly buddyId: string;
  readonly workspaceId: string;
  readonly runId: string | null;
}

/** The owner's Buddy Builder chat: no Buddy of its own; it may only read and edit the team. */
export interface BuilderGrant extends GrantBase {
  readonly role: 'builder';
}

export type TurnGrant = BuddyGrant | BuilderGrant;

export type BuddyGrantInput = {
  role: 'worker' | 'reviewer';
  buddyId: string;
  workspaceId: string;
  conversationId: string;
  runId: string | null;
  observe?: (tool: string, input: unknown) => void;
};

const ignore = () => undefined;

export type Grants = ReturnType<typeof createGrants>;

export function createGrants(options: { ttlMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const byToken = new Map<string, TurnGrant>();
  const token = () => randomBytes(32).toString('base64url');

  function put(grant: TurnGrant): TurnGrant {
    byToken.set(grant.token, grant);
    return grant;
  }

  return {
    issueBuddy(input: BuddyGrantInput): BuddyGrant {
      return put({
        ...input,
        token: token(),
        expiresAt: now() + options.ttlMs,
        author: buddyActor(input.buddyId),
        principal: buddyActor(input.buddyId),
        observe: input.observe ?? ignore,
      }) as BuddyGrant;
    },

    issueBuilder(conversationId: string): BuilderGrant {
      return put({
        role: 'builder',
        token: token(),
        conversationId,
        expiresAt: now() + options.ttlMs,
        author: OWNER,
        principal: OWNER,
        observe: ignore,
      }) as BuilderGrant;
    },

    /**
     * The owner wrote this turn's input: the conversation's worker grant becomes an owner grant.
     * Only the runtime calls this, and only for origin 'owner_input' (runtime.ts B1 rule).
     */
    promoteToOwner(conversationId: string): void {
      for (const grant of byToken.values()) {
        if (grant.conversationId !== conversationId || grant.role !== 'worker') continue;
        byToken.set(grant.token, { ...grant, role: 'owner', principal: OWNER });
      }
    },

    lookup(bearer: string): TurnGrant | null {
      const grant = byToken.get(bearer);
      if (!grant) return null;
      if (grant.expiresAt > now()) return grant;
      byToken.delete(bearer);
      return null;
    },

    revoke(bearer: string): void {
      byToken.delete(bearer);
    },

    revokeConversation(conversationId: string): void {
      for (const grant of [...byToken.values()])
        if (grant.conversationId === conversationId) byToken.delete(grant.token);
    },

    revokeRun(runId: string): void {
      for (const grant of [...byToken.values()])
        if (grant.role !== 'builder' && grant.runId === runId) byToken.delete(grant.token);
    },

    size(): number {
      return byToken.size;
    },
  };
}
