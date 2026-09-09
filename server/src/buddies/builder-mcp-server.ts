import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BuddyBuilderEvent } from '@unleashd/shared';
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';
import {
  BuddyBuilderService,
  type BuddyBuilderStore,
  CreateBuddyInputSchema,
  UpdateBuilderSoulSchema,
} from './builder';

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

function success(value: unknown, key: string, event?: BuddyBuilderEvent): Record<string, unknown> {
  const structuredContent = { [key]: value, ...(event ? { buddyBuilderEvent: event } : {}) };
  return {
    content: [{ type: 'text', text: JSON.stringify(event ? structuredContent : value, null, 2) }],
    structuredContent,
  };
}

/**
 * Builder conversations deliberately get only hiring and refinement tools. Keep this
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
        'Create or replay one Buddy with a home workspace, optional explicit workspace assignments, an execution profile, and a soul behavior contract drafted from the hiring conversation. The result includes follow-up questions when the role brief is still sparse.',
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
        const result = builder.createBuddy(input);
        return success(result, 'result', { action: 'created', result });
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        };
      }
    }
  );

  for (const name of ['get_soul', 'update_soul'] as const) {
    tools.registerTool(
      name,
      {
        description:
          name === 'get_soul'
            ? 'Read the current soul and revision of the Buddy created in this conversation.'
            : 'Save an owner-requested refinement to this conversation’s Buddy. Supply the complete soul, reasoning and the baseVersion returned by get_soul.',
        inputSchema: name === 'get_soul' ? EmptyInputSchema : UpdateBuilderSoulSchema,
        annotations: {
          readOnlyHint: name === 'get_soul',
          destructiveHint: name === 'update_soul',
          idempotentHint: name === 'get_soul',
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const result = builder.getResult();
          if (!result) throw new Error('Create a Buddy in this conversation first');
          const soul = name === 'get_soul' ? builder.getSoul() : builder.updateSoul(input);
          return success(
            soul,
            'soul',
            name === 'update_soul'
              ? { action: 'updated', result, revision: soul.revision }
              : undefined
          );
        } catch (error) {
          return {
            isError: true,
            content: [
              { type: 'text', text: error instanceof Error ? error.message : String(error) },
            ],
          };
        }
      }
    );
  }

  return server;
}
