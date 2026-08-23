import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';
import { BuddyBuilderService, type BuddyBuilderStore, CreateBuddyInputSchema } from './builder';

interface ToolServer {
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

const EmptyInputSchema = z.object({}).strict();
const WorkspaceFilterSchema = z.object({ workspaceId: z.string().min(1).optional() }).strict();

function success(value: unknown, key: string): Record<string, unknown> {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: { [key]: value },
  };
}

/**
 * Builder conversations deliberately get only these three tools. Keep this
 * server separate from employee tools so adding a normal Buddy operation can
 * never broaden the hiring flow by accident.
 */
export function createBuddyBuilderMcpServer(
  store: BuddyBuilderStore,
  conversationId: string
): McpServer {
  const builder = new BuddyBuilderService(store, conversationId);
  const server = new McpServer({ name: 'unleashd-buddy-builder', version: '1.0.0' });
  const tools = server as unknown as ToolServer;

  tools.registerTool(
    'list_workspaces',
    {
      description: 'List registered home workspaces for a new Buddy.',
      inputSchema: EmptyInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => success(builder.listWorkspaces(), 'workspaces')
  );

  tools.registerTool(
    'list_buddies',
    {
      description:
        'List existing Buddies, optionally within one registered workspace, before proposing a duplicate role.',
      inputSchema: WorkspaceFilterSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: unknown) => {
      const { workspaceId } = WorkspaceFilterSchema.parse(input);
      return success(builder.listBuddies(workspaceId), 'buddies');
    }
  );

  tools.registerTool(
    'create_buddy',
    {
      description:
        'Create or replay one Buddy with a home workspace, optional explicit workspace assignments, and an execution profile. The result includes follow-up questions when the role brief is still sparse.',
      inputSchema: CreateBuddyInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: unknown) => {
      try {
        return success(builder.createBuddy(input), 'result');
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        };
      }
    }
  );

  return server;
}
