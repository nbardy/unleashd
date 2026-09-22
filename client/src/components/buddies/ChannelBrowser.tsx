import { type BuddyWorkspaceActivity, BuddyWorkspaceActivitySchema } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { allConversationIdsAtom } from '../../atoms/conversations';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { type BuddyMailingListSummary, ChannelFeed } from './BuddyMessages';
import './BuddyMessages.css';

export function workspaceActivityResource(workspaceId: string) {
  const path = `/api/buddies/workspaces/${encodeURIComponent(workspaceId)}/activity`;
  return resource(path, async (signal: AbortSignal) => {
    const response = await fetch(path, { signal });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        payload.error ?? `Unable to load workspace activity (HTTP ${response.status})`
      );
    }
    return BuddyWorkspaceActivitySchema.parse(await response.json());
  });
}

// Full Slack layout: sidebar with the workspace name and every channel,
// conversation panels across the full right side. Read-only: posting stays
// in a Buddy mailbox because posts require a sender Buddy.
export function ChannelBrowser({
  workspaceId,
  workspaceName,
  buddyNames = {},
  availableConversationIds,
}: {
  workspaceId?: string;
  workspaceName?: string;
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
    <div className="buddy-workspace-slack" aria-label="Channels">
      <aside className="buddy-workspace-slack-sidebar">
        <Link
          className="buddy-workspace-slack-back"
          to={workspaceId ? `/buddies/workspaces/${encodeURIComponent(workspaceId)}` : '/buddies'}
        >
          ← Workspace
        </Link>
        <h1 className="buddy-workspace-slack-name">{workspaceName ?? 'Channels'}</h1>
        {error && <p role="alert">Channels could not refresh: {error.message}</p>}
        {!data || data.length === 0 ? (
          <p className="empty-state">No channels yet.</p>
        ) : (
          <ul className="buddy-workspace-slack-channels">
            {data.map((list) => (
              <li key={list.id}>
                <button
                  type="button"
                  aria-pressed={selected?.id === list.id}
                  onClick={() => setSelectedId(list.id)}
                >
                  # {list.name} · {list.postCount}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <div className="buddy-workspace-slack-main">
        {selected && (
          <ChannelFeed
            key={selected.id}
            list={selected}
            workspaceId={workspaceId}
            channelNameById={new Map(data?.map((entry) => [entry.id, entry.name]) ?? [])}
            buddyNames={buddyNames}
            availableConversationIds={availableConversationIds}
          />
        )}
      </div>
    </div>
  );
}

export function WorkspaceSlack() {
  const { workspaceId } = useParams();
  const conversationIds = useAtomValue(allConversationIdsAtom);
  const availableConversationIds = useMemo(() => new Set(conversationIds), [conversationIds]);
  const loadActivity = useMemo(
    () => (workspaceId ? workspaceActivityResource(workspaceId) : null),
    [workspaceId]
  );
  const { data } = usePolledFetch<BuddyWorkspaceActivity>(loadActivity, 2_000);
  const buddyNames = useMemo(
    () => Object.fromEntries((data?.members ?? []).map((member) => [member.id, member.name])),
    [data]
  );
  return (
    <main className="buddy-workspace-slack-page">
      <ChannelBrowser
        workspaceId={workspaceId}
        workspaceName={data?.workspace.name}
        buddyNames={buddyNames}
        availableConversationIds={availableConversationIds}
      />
    </main>
  );
}
