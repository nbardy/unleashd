import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BuddyContext } from '@unleashd/shared';
import type { BuddyBuilderStore } from './builder';
import { executeBuddyBuilderTool } from './builder-mcp-server';
import type { BuddiesStorePort } from './contract';
import {
  type BuddyOperationName,
  BuddyOperationsService,
  type PreparedBuddyMessage,
} from './operations';
import { type OwnerResourceName, executeOwnerResource } from './owner-resources';
import {
  type OwnerTeamAuthority,
  type OwnerTurnInput,
  configureOwnerTeam,
} from './owner-team-configuration';

const MAX_BODY_BYTES = 256 * 1024;
const CAPABILITY_TTL_MS = 25 * 60 * 60 * 1000;

export const BUDDY_CONTROL_URL_ENV = 'UNLEASHD_BUDDY_CONTROL_URL';
export const BUDDY_CONTROL_TOKEN_ENV = 'UNLEASHD_BUDDY_CONTROL_TOKEN';
export const MEMORY_REVIEW_URL_ENV = 'UNLEASHD_MEMORY_REVIEW_URL';
export const MEMORY_REVIEW_TOKEN_ENV = 'UNLEASHD_MEMORY_REVIEW_TOKEN';
export const OWNER_CONTROL_URL_ENV = 'UNLEASHD_OWNER_CONTROL_URL';
export const OWNER_CONTROL_TOKEN_ENV = 'UNLEASHD_OWNER_CONTROL_TOKEN';

type Capability = {
  context: BuddyContext;
  conversationId: string;
  automationClaimToken?: string;
  expiresAt: number;
  controller: AbortController;
};

export interface BuddyControlServerDependencies {
  getStore(): Promise<BuddiesStorePort>;
  isConversationActive(conversationId: string): boolean;
  dispatchMessage(
    context: BuddyContext,
    input: PreparedBuddyMessage,
    automationClaimToken?: string,
    signal?: AbortSignal
  ): Promise<unknown>;
}

/**
 * Private capability transport for operations that must re-enter the owning
 * server process (currently Buddy message dispatch).
 *
 * This is deliberately a separate loopback listener, not an exemption in the
 * public Express auth or reload mutation gates. The admitted turn's old server
 * owns this listener until that turn drains. The harness may observe its token,
 * so the token grants only the same checked operations as that one active turn;
 * it is not a broader application credential. See
 * agent_notes/2026-08-24_automation-execution-ownership-design.md.
 */
export class BuddyControlServer {
  private readonly server: http.Server;
  private readonly capabilities = new Map<string, Capability>();
  private readonly tokenByConversation = new Map<string, string>();
  private readonly memoryReviewCapabilities = new Map<
    string,
    { signal: AbortSignal; execute(operation: string, input: unknown): unknown }
  >();
  private baseUrl: string | null = null;
  private readonly ownerCapabilities = new Map<
    string,
    {
      authority: OwnerTeamAuthority;
      expiresAt: number;
      controller: AbortController;
      resolveWorkspaceIds?: () => readonly string[];
      builder: boolean;
    }
  >();
  private readonly ownerTokenByConversation = new Map<string, string>();

  constructor(private readonly dependencies: BuddyControlServerDependencies) {
    this.server = http.createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        console.error('[buddies-control] Unhandled request failure:', error);
        this.respond(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  async start(): Promise<void> {
    if (this.baseUrl) return;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once('error', onError);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', onError);
        resolve();
      });
    });
    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  issue(
    context: BuddyContext,
    conversationId: string,
    automationClaimToken?: string
  ): Readonly<Record<string, string>> {
    if (!this.baseUrl) throw new Error('Buddy internal control server is not ready');
    const previous = this.tokenByConversation.get(conversationId);
    if (previous) this.revoke(conversationId);
    const token = crypto.randomBytes(32).toString('base64url');
    this.tokenByConversation.set(conversationId, token);
    this.capabilities.set(token, {
      context,
      conversationId,
      automationClaimToken,
      expiresAt: Date.now() + CAPABILITY_TTL_MS,
      controller: new AbortController(),
    });
    return {
      [BUDDY_CONTROL_URL_ENV]: this.baseUrl,
      [BUDDY_CONTROL_TOKEN_ENV]: token,
    };
  }

  revoke(conversationId: string): void {
    this.revokeOwner(conversationId);
    const token = this.tokenByConversation.get(conversationId);
    if (!token) return;
    this.capabilities.get(token)?.controller.abort(new Error('Buddy turn ended'));
    this.tokenByConversation.delete(conversationId);
    this.capabilities.delete(token);
  }

  /** Only the authenticated input producer calls this; no request-body flag can enter it. */
  issueOwner(
    input: OwnerTurnInput,
    conversationId: string,
    workspaceIds: readonly string[],
    resolveWorkspaceIds?: () => readonly string[],
    builder = false
  ) {
    if (!this.baseUrl) throw new Error('Owner control server is not ready');
    if (input.origin !== 'owner_input' || !input.inputId)
      throw new Error('Owner input provenance required');
    this.revokeOwner(conversationId);
    const token = crypto.randomBytes(32).toString('base64url');
    this.ownerTokenByConversation.set(conversationId, token);
    this.ownerCapabilities.set(token, {
      resolveWorkspaceIds,
      builder,
      authority: Object.freeze({
        ownerInputId: input.inputId,
        conversationId,
        workspaceIds: Object.freeze([...workspaceIds]),
      }),
      expiresAt: Date.now() + CAPABILITY_TTL_MS,
      controller: new AbortController(),
    });
    return {
      [OWNER_CONTROL_URL_ENV]: `${this.baseUrl}/v1/owner/team-configuration`,
      [OWNER_CONTROL_TOKEN_ENV]: token,
    };
  }

  private revokeOwner(conversationId: string) {
    const token = this.ownerTokenByConversation.get(conversationId);
    if (!token) return;
    this.ownerCapabilities.get(token)?.controller.abort(new Error('Owner turn ended'));
    this.ownerCapabilities.delete(token);
    this.ownerTokenByConversation.delete(conversationId);
  }

  /** Maintenance capability: it cannot enter any of the Buddy dispatch routes. */
  issueMemoryReview(execute: (operation: string, input: unknown) => unknown, signal: AbortSignal) {
    if (!this.baseUrl) throw new Error('Buddy internal control server is not ready');
    signal.throwIfAborted();
    const token = crypto.randomBytes(32).toString('base64url');
    const revoke = () => {
      this.memoryReviewCapabilities.delete(token);
      signal.removeEventListener('abort', revoke);
    };
    this.memoryReviewCapabilities.set(token, { signal, execute });
    signal.addEventListener('abort', revoke, { once: true });
    return {
      env: {
        [MEMORY_REVIEW_URL_ENV]: `${this.baseUrl}/v1/memory-review`,
        [MEMORY_REVIEW_TOKEN_ENV]: token,
      },
      revoke,
    };
  }

  async close(): Promise<void> {
    if (!this.baseUrl) return;
    this.baseUrl = null;
    for (const capability of this.capabilities.values())
      capability.controller.abort(new Error('Buddy control server closed'));
    this.capabilities.clear();
    this.memoryReviewCapabilities.clear();
    for (const conversationId of this.ownerTokenByConversation.keys())
      this.revokeOwner(conversationId);
    this.tokenByConversation.clear();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    if (request.method !== 'POST') {
      this.respond(response, 404, { error: 'Not found' });
      return;
    }
    const token = this.bearerToken(request);
    if (
      request.url === '/v1/owner/resource' ||
      request.url === '/v1/owner/team-configuration' ||
      request.url === '/v1/owner/builder-operation'
    ) {
      const capability = token ? this.ownerCapabilities.get(token) : undefined;
      const valid = () =>
        capability &&
        !capability.controller.signal.aborted &&
        capability.expiresAt > Date.now() &&
        this.ownerCapabilities.get(token!) === capability &&
        this.dependencies.isConversationActive(capability.authority.conversationId!);
      if (!valid()) {
        this.respond(response, 403, {
          code: 'OWNER_CONTROL_REQUIRED',
          error: 'This active turn has no owner configuration authority.',
        });
        return;
      }
      const body = await this.readJson(request);
      const store = await this.dependencies.getStore();
      // Both awaits can race cancellation/replacement. Commit only after a fresh check.
      if (!valid()) {
        this.respond(response, 403, {
          code: 'OWNER_CONTROL_REVOKED',
          error: 'Owner turn authority expired or was revoked.',
        });
        return;
      }
      try {
        if (request.url === '/v1/owner/resource') {
          const input = body as { operation: OwnerResourceName; input: unknown };
          const authority = capability!.resolveWorkspaceIds
            ? { ...capability!.authority, workspaceIds: capability!.resolveWorkspaceIds() }
            : capability!.authority;
          this.respond(response, 200, {
            data: executeOwnerResource(store, input.operation, input.input, authority),
          });
        } else if (request.url === '/v1/owner/builder-operation') {
          if (!capability!.builder || !capability!.resolveWorkspaceIds)
            throw Object.assign(
              new Error(
                'Builder operations require an active owner Builder input with registered-workspace scope.'
              ),
              { code: 'OWNER_BUILDER_SCOPE_REQUIRED' }
            );
          const input = body as { operation?: unknown; input?: unknown };
          if (typeof input.operation !== 'string') throw new Error('Builder operation is required');
          const data = executeBuddyBuilderTool(
            store as unknown as BuddyBuilderStore,
            capability!.authority.conversationId!,
            input.operation,
            input.input
          );
          this.respond(response, 200, { data });
        } else {
          this.respond(response, 200, {
            data: configureOwnerTeam(
              store,
              body,
              capability!.resolveWorkspaceIds
                ? { ...capability!.authority, workspaceIds: capability!.resolveWorkspaceIds() }
                : capability!.authority
            ),
          });
        }
      } catch (error) {
        const detail = error as { code?: string; details?: unknown };
        this.respond(response, 400, {
          error: error instanceof Error ? error.message : String(error),
          code: detail.code,
          details: detail.details,
        });
      }
      return;
    }
    if (request.url === '/v1/memory-review') {
      const capability = token ? this.memoryReviewCapabilities.get(token) : undefined;
      if (!capability || capability.signal.aborted) {
        this.respond(response, 401, { error: 'Memory review capability is invalid or expired' });
        return;
      }
      const body = (await this.readJson(request)) as { operation?: unknown; input?: unknown };
      // Cancellation may occur while the body streams. Never use a previously checked grant.
      if (capability.signal.aborted || this.memoryReviewCapabilities.get(token!) !== capability) {
        this.respond(response, 401, { error: 'Memory review capability was revoked' });
        return;
      }
      try {
        if (typeof body.operation !== 'string')
          throw new Error('Memory review operation is required');
        this.respond(response, 200, { data: capability.execute(body.operation, body.input) });
      } catch (error) {
        const detail = error as {
          code?: string;
          currentVersion?: number;
          currentBody?: string;
          documentKind?: string;
        };
        this.respond(response, 400, {
          error: error instanceof Error ? error.message : String(error),
          ...(detail.code === 'STALE_MEMORY_WRITE'
            ? {
                code: 'MEMORY_STALE',
                details: {
                  current_version: detail.currentVersion,
                  current_content: detail.currentBody,
                  document_kind: detail.documentKind,
                },
              }
            : {}),
        });
      }
      return;
    }
    const capability = token ? this.capabilities.get(token) : undefined;
    if (
      !capability ||
      capability.expiresAt <= Date.now() ||
      this.tokenByConversation.get(capability.conversationId) !== token ||
      !this.dependencies.isConversationActive(capability.conversationId)
    ) {
      if (token) this.capabilities.delete(token);
      this.respond(response, 401, { error: 'Buddy control capability is invalid or expired' });
      return;
    }

    const store = await this.dependencies.getStore();
    const context = {
      ...capability.context,
      conversationId: capability.conversationId,
      allowedOperations: capability.context.allowedBuddyOperations
        ? [...capability.context.allowedBuddyOperations]
        : undefined,
    };
    const operations = new BuddyOperationsService(store, context, {
      automationClaimToken: capability.automationClaimToken,
    });
    const body = await this.readJson(request);
    const dispatch = async (callback: (signal: AbortSignal) => Promise<unknown>) => {
      const disconnected = new AbortController();
      const onClose = () => {
        if (!response.writableEnded) disconnected.abort(new Error('Message caller disconnected'));
      };
      response.once('close', onClose);
      if (response.destroyed || request.aborted) onClose();
      try {
        this.respond(
          response,
          200,
          await callback(AbortSignal.any([capability.controller.signal, disconnected.signal]))
        );
      } finally {
        response.off('close', onClose);
      }
    };
    if (request.url === '/v1/messages') {
      this.requireAllowed(capability.context, 'buddy.send');
      this.requireAutomationOwner(store, capability, 'buddy.send');
      const prepared = operations.prepareMessage(body);
      await dispatch((signal) =>
        this.dependencies.dispatchMessage(
          capability.context,
          prepared,
          capability.automationClaimToken,
          signal
        )
      );
      return;
    }
    this.respond(response, 404, { error: 'Not found' });
  }

  private requireAllowed(context: BuddyContext, operation: BuddyOperationName): void {
    if (context.allowedBuddyOperations && !context.allowedBuddyOperations.includes(operation)) {
      throw new Error(`${operation} is not allowed in this delegated conversation`);
    }
  }

  private requireAutomationOwner(
    store: BuddiesStorePort,
    capability: Capability,
    operation: BuddyOperationName
  ): void {
    if (!capability.context.automationRunId) return;
    store.assertAutomationOperationAllowed(
      capability.context.automationRunId,
      operation,
      capability.automationClaimToken ?? ''
    );
  }

  private bearerToken(request: http.IncomingMessage): string | null {
    const authorization = request.headers.authorization;
    return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
  }

  private async readJson(request: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) throw new Error('Buddy control request is too large');
      chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  private respond(response: http.ServerResponse, status: number, body: unknown): void {
    if (response.headersSent) return;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  }
}
