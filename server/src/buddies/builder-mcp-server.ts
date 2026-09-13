import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type BuddyBuilderEvent, BuddySoulUpdateSchema } from '@unleashd/shared';
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';
import {
  BuddyBuilderService,
  type BuddyBuilderStore,
  BuilderProjectInputSchema,
  BuilderRelationshipInputSchema,
  CreateBuddyInputSchema,
  UpdateBuddyProfileInputSchema,
} from './builder';
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

function success(value: unknown, key: string, event?: BuddyBuilderEvent): Record<string, unknown> {
  const structuredContent = { [key]: value, ...(event ? { buddyBuilderEvent: event } : {}) };
  return {
    content: [{ type: 'text', text: JSON.stringify(event ? structuredContent : value, null, 2) }],
    structuredContent,
  };
}

/** Execute a validated Builder operation inside the host's admitted owner turn. */
export function executeBuddyBuilderTool(
  store: BuddyBuilderStore,
  conversationId: string,
  name: string,
  input: unknown
): Record<string, unknown> {
  const builder = new BuddyBuilderService(store, conversationId);
  try {
    switch (name) {
      case 'get_soul':
      case 'update_soul': {
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
        const result = builder.getResults().results.find((item) => item.buddy.id === buddy.id)!;
        return success(
          soul,
          'soul',
          name === 'update_soul'
            ? { action: 'updated', result, revision: soul.revision }
            : undefined
        );
      }
      case 'update_profile':
        return success(builder.updateProfile(UpdateBuddyProfileInputSchema.parse(input)), 'buddy');
      case 'list_workspaces':
        EmptyInputSchema.parse(input);
        return success(builder.listWorkspaces(), 'workspaces');
      case 'list_buddies': {
        const { workspaceId } = WorkspaceFilterSchema.parse(input);
        return success(builder.listBuddies(workspaceId), 'buddies');
      }
      case 'list_created_buddies':
        EmptyInputSchema.parse(input);
        return success(builder.getResults(), 'result');
      case 'set_relationship':
        return success(
          builder.setRelationship(BuilderRelationshipInputSchema.parse(input)),
          'relationship'
        );
      case 'new_project': {
        const { project, result } = builder.createProject(BuilderProjectInputSchema.parse(input));
        return success(project, 'project', { action: 'work_created', project, result });
      }
      case 'create_buddy': {
        const result = builder.createBuddy(CreateBuddyInputSchema.parse(input));
        return success(result, 'result', { action: 'created', result });
      }
      default:
        throw new Error(`Unknown Builder operation: ${name}`);
    }
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

/** Production callbacks cross the revocable host owner boundary; local execution is for trusted host callers/tests. */
export function createBuddyBuilderMcpServer(
  store: BuddyBuilderStore,
  conversationId: string,
  execute?: (name: string, input: unknown) => Promise<Record<string, unknown>>,
  publicContract: 'resources' | 'legacy' = 'resources'
): McpServer {
  const server = new McpServer({ name: 'unleashd-buddy-builder', version: '1.0.0' });
  const tools = server as unknown as ToolServer;
  const definitions: Array<{
    name: string;
    description: string;
    schema: ZodTypeAny;
    readOnly?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
  }> = [
    {
      name: 'get_soul',
      schema: SoulTargetSchema,
      readOnly: true,
      idempotent: true,
      description:
        'Read a saved soul and revision. Pass buddyId from create_buddy or list_created_buddies; it may be omitted only when this conversation has exactly one hire.',
    },
    {
      name: 'update_soul',
      schema: BuilderSoulUpdateSchema,
      destructive: true,
      description:
        'Refine a Buddy created in this conversation. Pass its buddyId, complete soul, reason and current revision. Preserves unrelated preferences; cannot target another conversation’s hires or change permissions.',
    },
    {
      name: 'update_profile',
      schema: UpdateBuddyProfileInputSchema,
      idempotent: true,
      description:
        'Update provider, model or reasoningEffort defaults for a Buddy created in this Builder conversation. Omitted fields stay unchanged for the same provider; changing provider resets omitted model/effort. Null clears an override. Affects future conversations; does not change identity, soul, workspaces or permissions.',
    },
    {
      name: 'list_workspaces',
      schema: EmptyInputSchema,
      readOnly: true,
      idempotent: true,
      description: 'List registered home workspaces for a new Buddy.',
    },
    {
      name: 'list_buddies',
      schema: WorkspaceFilterSchema,
      readOnly: true,
      idempotent: true,
      description:
        'List existing Buddies, optionally within one registered workspace. Resolve existing identities before creating a missing role; use their IDs for owner configure_team.',
    },
    {
      name: 'list_created_buddies',
      schema: EmptyInputSchema,
      readOnly: true,
      idempotent: true,
      description:
        'Recover hires saved by this Builder conversation, including stable creation keys and Buddy IDs. Use before continuing setup or refining a member.',
    },
    {
      name: 'set_relationship',
      schema: BuilderRelationshipInputSchema,
      idempotent: true,
      description:
        'Connect two active hires created in this conversation. kind manager means fromBuddyId manages toBuddyId; consults records collaboration. Use owner configure_team for a complete team setup with exact permissions and incoming settings. A Buddy has one manager; cycles and missing workspace scope are rejected.',
    },
    {
      name: 'new_project',
      schema: BuilderProjectInputSchema,
      idempotent: true,
      description:
        'Save initial work for an active hire created in this conversation. Stable keys recover current saved work. A parent project must belong to a hire from this conversation in the same workspace. Save missing prerequisites as blocked with an exact blockedReason. Creates work records only; never starts conversations or external actions.',
    },
    {
      name: 'create_buddy',
      schema: CreateBuddyInputSchema,
      idempotent: true,
      description:
        'Create one missing persistent Buddy with workspace, profile and initial soul. Reuse an unchanged stable creationKey to recover this hire; do not recreate existing staff. For team onboarding keep backgroundEnabled false until required imports and setup are verified, then use owner configure_team with saved IDs to attach relationships, authorize exact responsibilities and enable incoming work. No new task message or schedule is created.',
    },
  ];
  for (const definition of definitions) {
    if (
      publicContract !== 'legacy' &&
      !['list_workspaces', 'list_buddies', 'list_created_buddies'].includes(definition.name)
    )
      continue;
    tools.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: definition.schema,
        annotations: {
          readOnlyHint: definition.readOnly ?? false,
          destructiveHint: definition.destructive ?? false,
          idempotentHint: definition.idempotent ?? false,
          openWorldHint: false,
        },
      },
      async (input) =>
        execute
          ? execute(definition.name, input)
          : executeBuddyBuilderTool(store, conversationId, definition.name, input)
    );
  }
  return server;
}

/** Historical Builder sessions retain their original operation contract. */
export function createLegacyBuddyBuilderMcpServer(
  ...args: Parameters<typeof createBuddyBuilderMcpServer>
) {
  return createBuddyBuilderMcpServer(args[0], args[1], args[2], 'legacy');
}
