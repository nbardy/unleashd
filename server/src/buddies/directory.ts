import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { BuddiesStorePort } from './contract';
import { coordinationStore } from './coordination-store';
import type { BuddyOperationContext } from './operations';

export const BuddyDirectoryInputSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    scope: z.enum(['current', 'permitted']).optional(),
    query: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).optional(),
    cursor: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .refine((input) => !(input.cursor && input.offset !== undefined), {
    message: 'Choose cursor or offset, not both',
  })
  .refine((input) => !(input.scope === 'permitted' && input.workspaceId), {
    message: 'Choose permitted scope or an explicit workspace, not both',
  });

const CursorSchema = z
  .object({ version: z.literal(1), scope: z.string(), after: z.string() })
  .strict();

export function listBuddyContacts(
  source: BuddiesStorePort,
  context: BuddyOperationContext,
  input: z.infer<typeof BuddyDirectoryInputSchema>
) {
  const store = coordinationStore(source);
  const ownWorkspaces = source.listBuddyWorkspaces(context.buddyId) as Array<{
    id: string;
    name: string;
  }>;
  const selected = input.workspaceId ?? context.workspaceId;
  const workspaces =
    input.scope === 'permitted'
      ? ownWorkspaces.filter((workspace) =>
          store.getCoordinationMembership(context.buddyId, workspace.id)
        )
      : ownWorkspaces.filter(
          (workspace) =>
            workspace.id === selected &&
            store.getCoordinationMembership(context.buddyId, workspace.id)
        );
  if (input.scope !== 'permitted' && !workspaces.length)
    throw new Error('Workspace membership is required');
  const query = (input.query ?? '').toLocaleLowerCase('en-US');
  // The cursor binds its filters, never authority. Membership is rechecked on every page.
  const scope = createHash('sha256')
    .update(
      JSON.stringify([
        context.buddyId,
        input.scope ?? 'current',
        input.scope === 'permitted' ? null : selected,
        query,
      ])
    )
    .digest('hex');
  let after: string | undefined;
  if (input.cursor) {
    try {
      const cursor = CursorSchema.parse(
        JSON.parse(Buffer.from(input.cursor, 'base64url').toString())
      );
      if (cursor.scope !== scope) throw new Error('scope');
      after = cursor.after;
    } catch {
      throw new Error('Invalid directory cursor or changed search filters');
    }
  }
  const buddies = source.listBuddies();
  const visible = new Map(
    workspaces.map((workspace) => [
      workspace.id,
      new Set(
        buddies
          .filter((buddy) => store.getCoordinationMembership(buddy.id, workspace.id))
          .map((buddy) => buddy.id)
      ),
    ])
  );
  const rows = buddies
    .filter(
      (buddy) =>
        !query ||
        `${buddy.name}\n${buddy.role}\n${buddy.id}`.toLocaleLowerCase('en-US').includes(query)
    )
    .flatMap((buddy) =>
      workspaces
        .filter((workspace) => visible.get(workspace.id)?.has(buddy.id))
        .map((workspace) => {
          const relationships = (
            source.listBuddyRelationships(buddy.id) as Array<{
              from_buddy_id: string;
              to_buddy_id: string;
            }>
          ).filter(
            (edge) =>
              visible.get(workspace.id)?.has(edge.from_buddy_id) &&
              visible.get(workspace.id)?.has(edge.to_buddy_id)
          );
          const actor = store.getCoordinationMembership(context.buddyId, workspace.id);
          const canDispatch =
            source.getBuddy(context.buddyId)?.status === 'active' &&
            buddy.status === 'active' &&
            !!actor?.dispatch;
          return {
            order: `${buddy.id}\u0000${workspace.id}`,
            contact: {
              id: buddy.id,
              name: buddy.name,
              role: buddy.role,
              status: buddy.status,
              relationships,
              workspace: { id: workspace.id, name: workspace.name },
              route: {
                workspaceId: workspace.id,
                dispatchAllowed: canDispatch,
                code: canDispatch ? null : 'dispatch_unavailable',
              },
            },
          };
        })
    )
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .filter((row) => after === undefined || row.order > after);
  const start = input.offset ?? 0;
  const page = rows.slice(start, start + input.limit);
  if (input.scope === undefined && input.query === undefined && input.cursor === undefined) {
    // Preserve the original array contract while clients migrate to cursor discovery.
    return page.map(({ contact: { workspace: _workspace, route: _route, ...contact } }) => contact);
  }
  return {
    contacts: page.map((row) => row.contact),
    nextCursor:
      rows.length > start + input.limit && page.length
        ? Buffer.from(
            JSON.stringify({ version: 1, scope, after: page[page.length - 1].order })
          ).toString('base64url')
        : null,
  };
}
