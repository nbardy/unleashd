import { parseTeamConfigurationProposal } from '@unleashd/shared';
import type { BuddiesStorePort } from './contract';

/** Public UI projections omit archived identities; durable history stays intact. */
export function visibleBuddyPayload(value: unknown, store: BuddiesStorePort): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => visibleBuddyPayload(item, store)).filter((item) => item !== null);
  }
  if (!value || typeof value !== 'object') return value;
  let record = value as Record<string, unknown>;
  if (record.to_buddy_id === null && typeof record.body === 'string') {
    const attachment = parseTeamConfigurationProposal(record.body);
    if (attachment)
      record = { ...record, body: attachment.body, team_configuration: attachment.proposal };
  }
  const references = [
    'buddyId',
    'buddy_id',
    'from_buddy_id',
    'to_buddy_id',
    'reviewer_buddy_id',
    'subject_buddy_id',
    'fromBuddyId',
    'toBuddyId',
  ];
  const buddy = record.buddy as { status?: string } | undefined;
  if (
    buddy?.status === 'archived' ||
    record.status === 'archived' ||
    references.some(
      (key) => typeof record[key] === 'string' && store.getBuddy(record[key])?.status === 'archived'
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, visibleBuddyPayload(item, store)])
  );
}
