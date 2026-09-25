import {
  type BuddyAccessStanding,
  BuddyInactiveAccessSchema,
  type BuddyInactiveAccess as InactiveAccess,
} from '@unleashd/shared';
import { useMemo, useState } from 'react';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { BuddyTeamSettings } from './BuddyTeamConfiguration';
import { buddyApi } from './api';

type Entry = InactiveAccess['entries'][number];

const STANDING_LABEL: Record<BuddyAccessStanding, string> = {
  member: '',
  archived: ' · archived',
  detached: ' · left this workspace',
};

function targetLabel(entry: Entry): string {
  return entry.target.kind === 'workspace'
    ? 'New Buddies in this workspace'
    : `${entry.target.name}${STANDING_LABEL[entry.target.standing]}`;
}

/**
 * Saved grants whose grantee or target is archived or detached. Neither party
 * has a settings entry anywhere else — archived Buddies 404 on their own page and
 * BuddyCoordination lists current memberships only — so this is how the owner
 * finds them. Opening a row mounts the ordinary BuddyTeamSettings for that exact
 * (grantee, target) pair: revocation is the existing preview/apply, nothing new.
 */
export function BuddyInactiveAccess({ workspaceId }: { workspaceId: string }) {
  const path = `/api/buddies/workspaces/${encodeURIComponent(workspaceId)}/inactive-access`;
  const source = useMemo(
    () =>
      resource(path, async (signal: AbortSignal) =>
        BuddyInactiveAccessSchema.parse(await buddyApi(path, { signal }))
      ),
    [path]
  );
  const access = usePolledFetch(source, 5_000);
  const { data, refetch } = access;
  const error = access.kind === 'failed' || access.kind === 'stale' ? access.error : null;
  // The open pair is held apart from the list: a successful revocation drops
  // the row on the next poll, and the receipt must stay on screen when it does.
  const [open, setOpen] = useState<Entry | null>(null);
  if (!error && !data?.entries.length && !open) return null;
  return (
    <section className="buddy-inactive-access" aria-label="Access held outside the team">
      <h2>Access held outside the team</h2>
      <p>
        These saved permissions belong to Buddies that were archived or left this workspace, or
        point at one. Review each and revoke what is no longer needed. Revoking never restores
        membership.
      </p>
      {error && <p role="alert">{error.message}</p>}
      {!!data?.entries.length && (
        <ul className="buddy-inactive-access__list">
          {data.entries.map((entry) => (
            <li key={`${entry.grant.grantee_id}:${entry.grant.target_id}`}>
              <span className="buddy-inactive-access__pair">
                <strong>
                  {entry.grantee.name}
                  {STANDING_LABEL[entry.grantee.standing]}
                </strong>
                {' → '}
                {targetLabel(entry)}
              </span>
              <span className="buddy-inactive-access__capabilities">
                {entry.grant.capabilities.join(', ')}
              </span>
              <button type="button" onClick={() => setOpen(entry)}>
                Review
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && data.omitted > 0 && (
        <p>{data.omitted} older grants are not shown. Revoke these to see the rest.</p>
      )}
      {open && (
        <div className="buddy-inactive-access__panel">
          <p>
            <strong>{open.grantee.name}</strong> → {targetLabel(open)}{' '}
            <button
              type="button"
              onClick={() => {
                setOpen(null);
                refetch();
              }}
            >
              Close
            </button>
          </p>
          <BuddyTeamSettings
            key={`${open.grant.grantee_id}:${open.grant.target_id}`}
            buddyId={open.grant.grantee_id}
            workspaceId={workspaceId}
            initialTargetId={open.grant.target_id}
          />
        </div>
      )}
    </section>
  );
}
