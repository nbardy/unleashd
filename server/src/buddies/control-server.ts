import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BuddyContext } from '@unleashd/shared';
import type { BuddiesStorePort } from './contract';
import {
  type BuddyOperationName,
  BuddyOperationsService,
  type PreparedBuddyDelegation,
  type PreparedBuddyReviewRequest,
} from './operations';

const MAX_BODY_BYTES = 256 * 1024;
const CAPABILITY_TTL_MS = 25 * 60 * 60 * 1000;

export const BUDDY_CONTROL_URL_ENV = 'UNLEASHD_BUDDY_CONTROL_URL';
export const BUDDY_CONTROL_TOKEN_ENV = 'UNLEASHD_BUDDY_CONTROL_TOKEN';

type Capability = {
  context: BuddyContext;
  conversationId: string;
  automationClaimToken?: string;
  expiresAt: number;
};

export interface BuddyControlServerDependencies {
  getStore(): Promise<BuddiesStorePort>;
  isConversationActive(conversationId: string): boolean;
  dispatchDelegation(
    context: BuddyContext,
    input: PreparedBuddyDelegation,
    automationClaimToken?: string
  ): Promise<unknown>;
  dispatchReview(
    context: BuddyContext,
    input: PreparedBuddyReviewRequest,
    automationClaimToken?: string
  ): Promise<unknown>;
}

/**
 * Private capability transport for operations that must re-enter the owning
 * server process (currently delegation and review conversation creation).
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
  private baseUrl: string | null = null;

  constructor(private readonly dependencies: BuddyControlServerDependencies) {
    this.server = http.createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
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
    if (previous) this.capabilities.delete(previous);
    const token = crypto.randomBytes(32).toString('base64url');
    this.tokenByConversation.set(conversationId, token);
    this.capabilities.set(token, {
      context,
      conversationId,
      automationClaimToken,
      expiresAt: Date.now() + CAPABILITY_TTL_MS,
    });
    return {
      [BUDDY_CONTROL_URL_ENV]: this.baseUrl,
      [BUDDY_CONTROL_TOKEN_ENV]: token,
    };
  }

  revoke(conversationId: string): void {
    const token = this.tokenByConversation.get(conversationId);
    if (!token) return;
    this.tokenByConversation.delete(conversationId);
    this.capabilities.delete(token);
  }

  async close(): Promise<void> {
    if (!this.baseUrl) return;
    this.baseUrl = null;
    this.capabilities.clear();
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
    };
    const operations = new BuddyOperationsService(store, context, {
      automationClaimToken: capability.automationClaimToken,
    });
    const body = await this.readJson(request);
    if (request.url === '/v1/delegations') {
      this.requireAllowed(capability.context, 'buddy.delegate');
      this.requireAutomationOwner(store, capability, 'buddy.delegate');
      const prepared = operations.prepareDelegation(body);
      this.respond(
        response,
        200,
        await this.dependencies.dispatchDelegation(
          capability.context,
          prepared,
          capability.automationClaimToken
        )
      );
      return;
    }
    if (request.url === '/v1/reviews') {
      this.requireAllowed(capability.context, 'buddy.request_review');
      this.requireAutomationOwner(store, capability, 'buddy.request_review');
      const prepared = operations.prepareReviewRequest(body);
      this.respond(
        response,
        200,
        await this.dependencies.dispatchReview(
          capability.context,
          prepared,
          capability.automationClaimToken
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
