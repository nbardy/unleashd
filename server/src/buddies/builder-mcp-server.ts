import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BuddySoulUpdateSchema } from '@unleashd/shared';
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';
import { BuddyBuilderService, type BuddyBuilderStore, CreateBuddyInputSchema } from './builder';
import type { BuddiesStorePort } from './contract';
import { readBuddySoul, updateBuddySoul } from './soul';

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
const SoulTargetSchema = z.object({ buddyId: z.string().min(1).optional() }).strict();
const BuilderSoulUpdateSchema = BuddySoulUpdateSchema.extend(SoulTargetSchema.shape);

function success(value: unknown, key: string): Record<string, unknown> {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: { [key]: value },
  };
}

/**
 * Builder tools can create multiple Buddies and refine those hires' souls. Keep this
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

  for (const name of ['get_soul', 'update_soul'] as const) {
    tools.registerTool(
      name,
      {
        description:
          name === 'get_soul'
            ? 'Read a saved soul and revision. Pass buddyId from create_buddy or list_created_buddies; it may be omitted only when this conversation has exactly one hire.'
            : 'Refine a Buddy created in this conversation. Pass its buddyId, the complete soul, a reason and the revision returned by get_soul. Cannot target hires from another conversation or change permissions.',
        inputSchema: name === 'get_soul' ? SoulTargetSchema : BuilderSoulUpdateSchema,
        annotations: {
          readOnlyHint: name === 'get_soul',
          destructiveHint: name === 'update_soul',
          idempotentHint: name === 'get_soul',
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const { buddyId, ...update } = (
            name === 'get_soul' ? SoulTargetSchema : BuilderSoulUpdateSchema
          ).parse(input);
          const buddy = builder.getSoulTarget(buddyId);
          const soulStore = store as unknown as BuddiesStorePort;
          const soul =
            name === 'get_soul'
              ? readBuddySoul(soulStore, buddy.id)
              : updateBuddySoul(soulStore, buddy.id, update, `owner:builder:${conversationId}`, {
                  source: 'buddy-builder',
                  conversation_id: conversationId,
                });
          return success(soul, 'soul');
        } catch (error) {
          const detail = error as { code?: string; details?: unknown };
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : String(error),
                  code: detail.code,
                  details: detail.details,
                }),
              },
            ],
          };
        }
      }
    );
  }

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
    'list_created_buddies',
    {
      description:
        'Recover all hires saved by this Builder conversation, including their creation keys and Buddy IDs. Use before continuing a team or refining a member.',
      inputSchema: EmptyInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => success(builder.getResults(), 'result')
  );

  tools.registerTool(
    'create_buddy',
    {
      description:
        'Create one member of a team with a home workspace, optional explicit workspace assignments, execution profile and soul. Use a distinct stable creationKey per member; reuse that key and unchanged arguments to retry safely. Omitted creationKey uses the legacy default slot. Call again with another key to add more members in this chat.',
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
        return success(result, 'result');
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
