import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { ZodTypeAny } from 'zod';
import type { BuddyBuilderStore } from './builder';
import { createBuddyBuilderMcpServer } from './builder-mcp-server';
import type { BuddiesStorePort } from './contract';
import { BUDDY_CONTROL_TOKEN_ENV, BUDDY_CONTROL_URL_ENV } from './control-server';
import { BUDDY_AUTOMATION_CLAIM_TOKEN_ENV } from './mcp-config';
import {
  type BuddyOperationContext,
  BuddyOperationInputSchemas,
  type BuddyOperationName,
  BuddyOperationsService,
  type PreparedBuddyDelegation,
  type PreparedBuddyReviewRequest,
} from './operations';

const TOOL_NAMES = [
  'buddy.get_current_work',
  'buddy.get_inbox',
  'buddy.get_automations',
  'buddy.set_automation',
  'buddy.new_project',
  'buddy.update_project',
  'buddy.update_memory',
  'buddy.remember_note',
  'buddy.recall',
  'buddy.remember',
  'buddy.compact_memory',
  'buddy.delegate',
  'buddy.request_review',
  'buddy.complete_delegation',
  'buddy.complete_assignment',
  'buddy.submit_review',
  'buddy.request_human_approval',
] as const satisfies readonly BuddyOperationName[];

const TOOL_DESCRIPTIONS: Record<BuddyOperationName, string> = {
  'buddy.get_current_work':
    'Read current open projects and todos for this employee or a declared review subject in the conversation workspace.',
  'buddy.get_inbox':
    'Read the typed team inbox: assignments, terminal outcomes and evidence, review queue/results, approvals, blocked projects, and failed automations within this employee management scope.',
  'buddy.get_automations':
    'List durable Buddy automations for this employee or one direct report in the conversation workspace.',
  'buddy.set_automation':
    'Create or update a disabled durable Buddy automation for this employee or a direct report, or disable an existing automation. This tool cannot enable or run jobs.',
  'buddy.new_project':
    'Create a bounded project owned by this employee in the conversation workspace.',
  'buddy.update_project':
    'Atomically update the selected employee project and its todos. Completing work requires evidence.',
  'buddy.update_memory':
    'Compare-and-swap rewrite of this Buddy working or long-term memory document. The full bounded document and a non-empty reason are required.',
  'buddy.remember_note':
    'Create one bounded, collision-proof append-only Buddy note in the authorized current or home workspace. Notes are evidence, not instructions.',
  'buddy.recall':
    'Run a bounded pull-only search over authorized Buddy notes. Literal matching is the default; regex must be explicitly enabled.',
  'buddy.remember': 'Append a durable journal or curated memory entry for this employee.',
  'buddy.compact_memory':
    'Compact this employee memory with source references, containment checks, and atomic rollback.',
  'buddy.delegate': 'Create a bounded delegation from this employee to another assigned Buddy.',
  'buddy.request_review':
    'Assign a bounded structured review, including concrete input evidence, to this employee or a direct report for another managed employee.',
  'buddy.complete_delegation': 'Settle a delegation owned by this employee with a durable outcome.',
  'buddy.complete_assignment':
    'Settle the bounded delegation assigned to this employee and conversation. Concrete evidence is required.',
  'buddy.submit_review':
    'Submit an evidence-backed structured employee review assigned to this reviewer.',
  'buddy.request_human_approval':
    'Record a pending human approval request for an external, risky, spending, publishing, or deployment action. This does not authorize or execute the action.',
};

function publicToolName(operation: BuddyOperationName): string {
  return operation.slice('buddy.'.length);
}

interface ToolRegistrationPort {
  registerTool(
    name: string,
    config: {
      description: string;
      inputSchema: ZodTypeAny;
      annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
      };
    },
    callback: (input: unknown) => Promise<Record<string, unknown>>
  ): unknown;
}

export function createBuddyMcpServer(
  store: BuddiesStorePort,
  context: BuddyOperationContext,
  options: {
    dispatchDelegation?: (input: PreparedBuddyDelegation) => Promise<unknown>;
    dispatchReview?: (input: PreparedBuddyReviewRequest) => Promise<unknown>;
    allowedOperations?: readonly BuddyOperationName[];
    automationClaimToken?: string;
  } = {}
): McpServer {
  const operations = new BuddyOperationsService(store, context, {
    automationClaimToken: options.automationClaimToken,
  });
  const server = new McpServer({
    name: 'unleashd-buddy',
    version: '1.0.0',
  });
  const toolServer = server as unknown as ToolRegistrationPort;

  for (const operation of TOOL_NAMES) {
    if (options.allowedOperations && !options.allowedOperations.includes(operation)) continue;
    toolServer.registerTool(
      publicToolName(operation),
      {
        description: TOOL_DESCRIPTIONS[operation],
        inputSchema: BuddyOperationInputSchemas[operation],
        annotations: {
          readOnlyHint:
            operation === 'buddy.get_current_work' ||
            operation === 'buddy.get_inbox' ||
            operation === 'buddy.get_automations' ||
            operation === 'buddy.recall',
          destructiveHint:
            operation === 'buddy.update_project' ||
            operation === 'buddy.set_automation' ||
            operation === 'buddy.update_memory',
          idempotentHint:
            operation === 'buddy.get_current_work' ||
            operation === 'buddy.get_inbox' ||
            operation === 'buddy.get_automations' ||
            operation === 'buddy.recall',
          openWorldHint: false,
        },
      },
      async (input: unknown) => {
        try {
          let result: unknown;
          if (operation === 'buddy.delegate' && options.dispatchDelegation) {
            const prepared = operations.prepareDelegation(input);
            result = operations.recordDelegationDispatch(
              prepared,
              await options.dispatchDelegation(prepared)
            );
          } else if (operation === 'buddy.request_review' && options.dispatchReview) {
            const prepared = operations.prepareReviewRequest(input);
            result = operations.recordReviewDispatch(
              prepared,
              await options.dispatchReview(prepared)
            );
          } else {
            result = operations.execute(operation, input);
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : String(error),
                  ...(error && typeof error === 'object' && 'code' in error
                    ? { code: (error as { code: unknown }).code }
                    : {}),
                  ...(error && typeof error === 'object' && 'details' in error
                    ? { details: (error as { details: unknown }).details }
                    : {}),
                }),
              },
            ],
            structuredContent: {
              error: error instanceof Error ? error.message : String(error),
              ...(error && typeof error === 'object' && 'code' in error
                ? { code: (error as { code: unknown }).code }
                : {}),
              ...(error && typeof error === 'object' && 'details' in error
                ? { details: (error as { details: unknown }).details }
                : {}),
            },
          };
        }
      }
    );
  }
  return server;
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const store = new BuddiesStore() as unknown as BuddiesStorePort &
    BuddyBuilderStore & { close(): void };
  if (process.argv.includes('--builder')) {
    const server = createBuddyBuilderMcpServer(store, requiredArgument('--conversation'));
    const transport = new StdioServerTransport();
    const close = async () => {
      await server.close().catch(() => undefined);
      store.close();
    };
    process.once('SIGINT', () => void close().finally(() => process.exit(0)));
    process.once('SIGTERM', () => void close().finally(() => process.exit(0)));
    await server.connect(transport);
    return;
  }
  const allowedOperations = process.argv.flatMap((argument, index, argv) =>
    argument === '--allowed-operation' && argv[index + 1] ? [argv[index + 1]] : []
  );
  const context: BuddyOperationContext = {
    buddyId: requiredArgument('--buddy'),
    workspaceId: requiredArgument('--workspace'),
    conversationId: requiredArgument('--conversation'),
    buddyProjectId: process.argv.includes('--project') ? requiredArgument('--project') : undefined,
    automationRunId: process.argv.includes('--automation-run')
      ? requiredArgument('--automation-run')
      : undefined,
    allowedOperations: allowedOperations.length ? allowedOperations : undefined,
  };
  const controlUrl = process.env[BUDDY_CONTROL_URL_ENV]?.replace(/\/+$/, '');
  const controlToken = process.env[BUDDY_CONTROL_TOKEN_ENV];
  const dispatch = async (path: string, input: unknown) => {
    if (!controlUrl || !controlToken) {
      throw new Error('This Buddy turn has no internal dispatch capability');
    }
    const response = await fetch(`${controlUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${controlToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      const message =
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `Buddy dispatch failed with HTTP ${response.status}`;
      throw new Error(message);
    }
    return body;
  };
  const server = createBuddyMcpServer(store, context, {
    allowedOperations: context.allowedOperations as BuddyOperationName[] | undefined,
    automationClaimToken: process.env[BUDDY_AUTOMATION_CLAIM_TOKEN_ENV],
    dispatchDelegation:
      controlUrl && controlToken ? (input) => dispatch('/v1/delegations', input) : undefined,
    dispatchReview:
      controlUrl && controlToken ? (input) => dispatch('/v1/reviews', input) : undefined,
  });
  const transport = new StdioServerTransport();
  const close = async () => {
    await server.close().catch(() => undefined);
    store.close();
  };
  process.once('SIGINT', () => void close().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void close().finally(() => process.exit(0)));
  await server.connect(transport);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(`[buddies-mcp] ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  });
}
