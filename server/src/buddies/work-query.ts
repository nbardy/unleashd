import { createHash } from 'node:crypto';
import { GetBuddyWorkResourceSchema, workPageInput } from '@unleashd/shared';

/** Run only after audience filtering. A changed result set invalidates pagination. */
export function queryBuddyWork(
  rows: unknown[],
  input: Omit<ReturnType<typeof workPageInput>, 'snapshot'> & { snapshot?: string },
  audience: unknown
) {
  const { order, statuses, updatedSince } = GetBuddyWorkResourceSchema.parse({
    order: input.order,
    statuses: input.statuses,
    updatedSince: input.updatedSince,
  });
  const allowedStatuses = statuses ? new Set<string>(statuses) : null;
  const items = (rows as Array<{ id: string; status: string; updated_at: string }>).filter(
    (p) =>
      (!allowedStatuses || allowedStatuses.has(p.status)) &&
      (!updatedSince || Date.parse(p.updated_at) >= Date.parse(updatedSince))
  );
  if (order === 'recent')
    items.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  const snapshot = createHash('sha256')
    .update(
      JSON.stringify([
        audience,
        input.targetBuddyId,
        input.workspaceId,
        input.projectId,
        input.includeClosed,
        order,
        statuses,
        updatedSince,
        items,
      ])
    )
    .digest('hex')
    .slice(0, 32);
  if (input.snapshot && input.snapshot !== snapshot)
    throw Object.assign(
      new Error(
        'Work or access changed during pagination. Restart without cursor; no changes have been acknowledged.'
      ),
      {
        code: 'STALE_WORK_CURSOR',
      }
    );
  return { items: items.slice(input.offset, input.offset + input.limit), snapshot };
}
