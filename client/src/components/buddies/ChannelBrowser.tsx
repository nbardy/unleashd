import { useState } from 'react';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { type BuddyMailingListSummary, ChannelFeed } from './BuddyMessages';
import './BuddyMessages.css';

// Workspace-level channel browser: the same Slack-like feed as the Mailbox
// Lists section, but owner-scoped with no sender Buddy, so it is read-only.
// Owner-authored posts need a sender Buddy, which the spec leaves out.
export function ChannelBrowser({
  workspaceId,
  buddyNames = {},
  availableConversationIds,
}: {
  workspaceId?: string;
  buddyNames?: Readonly<Record<string, string>>;
  availableConversationIds: ReadonlySet<string>;
}) {
  const { data, error } = usePolledFetch<BuddyMailingListSummary[]>(
    workspaceId ? `/api/buddies/lists?workspaceId=${encodeURIComponent(workspaceId)}` : null,
    5000
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data?.find((list) => list.id === selectedId) ?? data?.[0] ?? null;
  return (
    <section className="buddy-messages-list-section" aria-label="Channels">
      <h3>Channels</h3>
      <p>Public workspace streams for standups, handoffs, and announcements.</p>
      {error && <p role="alert">Channels could not refresh: {error.message}</p>}
      {!data || data.length === 0 ? (
        <p className="empty-state">No channels yet.</p>
      ) : (
        <div className="buddy-messages-list-panes">
          <ul className="buddy-messages-list-chips" aria-label="Channels">
            {data.map((list) => (
              <li key={list.id}>
                <button
                  type="button"
                  aria-pressed={selected?.id === list.id}
                  onClick={() => setSelectedId(list.id)}
                >
                  {list.name} · {list.postCount}
                </button>
              </li>
            ))}
          </ul>
          <div className="buddy-messages-list-main">
            {selected && (
              <ChannelFeed
                key={selected.id}
                list={selected}
                workspaceId={workspaceId}
                channelNameById={new Map(data.map((entry) => [entry.id, entry.name]))}
                buddyNames={buddyNames}
                availableConversationIds={availableConversationIds}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
