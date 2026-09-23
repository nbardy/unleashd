import { type BuddyWorkspaceActivity, BuddyWorkspaceActivitySchema } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { type CSSProperties, useEffect, useMemo, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { buddySidebarChannelsAtom } from '../../atoms/buddy-sidebar';
import { allConversationIdsAtom } from '../../atoms/conversations';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import {
  type BuddyMailingListPost,
  type BuddyMailingListSummary,
  taskChannelFeedUrl,
} from './BuddyMessages';
import './ChannelBrowser.css';

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

export function channelPostsUrl(listId: string): string {
  return `/api/buddies/lists/${encodeURIComponent(listId)}/posts?limit=50`;
}

// =============================================================================
// Transcript rows: D = Day ⊕ Lead ⊕ Continuation.
// A Lead opens a sender run (avatar + name); a Continuation is a later post by
// the same instance (Buddy AND conversation) within GROUP_WINDOW_MS, so two
// concurrent conversations running as one Buddy never merge into one run.
// =============================================================================
type ChannelRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'lead'; key: string; post: BuddyMailingListPost }
  | { kind: 'continuation'; key: string; post: BuddyMailingListPost };

const GROUP_WINDOW_MS = 5 * 60_000;

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function sameInstance(a: BuddyMailingListPost, b: BuddyMailingListPost): boolean {
  return a.fromBuddyId === b.fromBuddyId && a.senderConversationId === b.senderConversationId;
}

// Posts arrive newest-first; a Slack transcript reads oldest-first with the
// newest message at the bottom, next to where a composer would be.
export function channelRows(newestFirst: readonly BuddyMailingListPost[]): ChannelRow[] {
  const posts = [...newestFirst].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const rows: ChannelRow[] = [];
  let previous: BuddyMailingListPost | null = null;
  for (const post of posts) {
    const newDay = previous === null || dayKey(previous.createdAt) !== dayKey(post.createdAt);
    if (newDay) {
      rows.push({
        kind: 'day',
        key: `day:${dayKey(post.createdAt)}`,
        label: new Date(post.createdAt).toLocaleDateString([], {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        }),
      });
    }
    const continues =
      previous !== null &&
      !newDay &&
      sameInstance(previous, post) &&
      new Date(post.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS;
    rows.push({ kind: continues ? 'continuation' : 'lead', key: post.id, post });
    previous = post;
  }
  return rows;
}

const AVATAR_ACCENTS = [
  'var(--theme-ai)',
  'var(--theme-user)',
  'var(--theme-primary)',
  'var(--theme-meta)',
  'var(--theme-warning)',
  'var(--theme-success)',
  'var(--theme-queue)',
];

function avatarAccent(buddyId: string): string {
  let hash = 0;
  for (const char of buddyId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_ACCENTS[hash % AVATAR_ACCENTS.length];
}

function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function shortTaskId(projectId: string): string {
  return projectId.replace(/^buddy_project_/, '').slice(0, 8);
}

type RowContext = {
  buddyNames: Readonly<Record<string, string>>;
  channelNameById: ReadonlyMap<string, string>;
  showChannel: boolean;
  availableConversationIds: ReadonlySet<string>;
};

// Instance label: which conversation, of possibly several running as the same
// Buddy, wrote the post. A link only when the client still holds the thread
// (AGENTS.md: "open this conversation" affordances are availability-checked).
function InstanceTag({
  conversationId,
  available,
}: {
  conversationId: string;
  available: boolean;
}) {
  const label = `conv ${conversationId.slice(0, 8)}`;
  return available ? (
    <Link
      className="channel-browser-instance"
      to={`/chat/${encodeURIComponent(conversationId)}`}
      title={`Open conversation ${conversationId}`}
    >
      {label}
    </Link>
  ) : (
    <span className="channel-browser-instance" title={conversationId}>
      {label}
    </span>
  );
}

function PostMeta({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  return (
    <>
      <span className="channel-browser-purpose">{post.purpose}</span>
      {context.showChannel && (
        <span className="channel-browser-channel-tag">
          #{context.channelNameById.get(post.listId) ?? post.listId}
        </span>
      )}
      {post.senderConversationId && (
        <InstanceTag
          conversationId={post.senderConversationId}
          available={context.availableConversationIds.has(post.senderConversationId)}
        />
      )}
    </>
  );
}

function LeadRow({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  const name = context.buddyNames[post.fromBuddyId] ?? post.fromBuddyId;
  return (
    <li className="channel-browser-message channel-browser-message--lead">
      <span
        className="channel-browser-avatar"
        style={{ '--channel-avatar': avatarAccent(post.fromBuddyId) } as CSSProperties}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      <div className="channel-browser-message-content">
        <div className="channel-browser-message-heading">
          <Link
            className="channel-browser-author"
            to={`/buddies/${encodeURIComponent(post.fromBuddyId)}`}
          >
            {name}
          </Link>
          <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>
            {clockTime(post.createdAt)}
          </time>
          <PostMeta post={post} context={context} />
        </div>
        <p className="channel-browser-body">{post.body}</p>
      </div>
    </li>
  );
}

function ContinuationRow({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  return (
    <li className="channel-browser-message channel-browser-message--continuation">
      <time
        className="channel-browser-gutter-time"
        dateTime={post.createdAt}
        title={new Date(post.createdAt).toLocaleString()}
      >
        {clockTime(post.createdAt)}
      </time>
      <div className="channel-browser-message-content">
        <p className="channel-browser-body">
          <span className="channel-browser-inline-meta">
            <PostMeta post={post} context={context} />
          </span>
          {post.body}
        </p>
      </div>
    </li>
  );
}

function DayRow({ label }: { label: string }) {
  return (
    <li className="channel-browser-day" aria-label={label}>
      <span>{label}</span>
    </li>
  );
}

function renderRow(row: ChannelRow, context: RowContext) {
  switch (row.kind) {
    case 'day':
      return <DayRow key={row.key} label={row.label} />;
    case 'lead':
      return <LeadRow key={row.key} post={row.post} context={context} />;
    case 'continuation':
      return <ContinuationRow key={row.key} post={row.post} context={context} />;
  }
}

function ChannelPane({
  list,
  workspaceId,
  channelNameById,
  buddyNames,
  availableConversationIds,
  taskFilter,
  onTaskFilter,
}: {
  list: BuddyMailingListSummary;
  workspaceId: string;
  channelNameById: ReadonlyMap<string, string>;
  buddyNames: Readonly<Record<string, string>>;
  availableConversationIds: ReadonlySet<string>;
  taskFilter: string | null;
  onTaskFilter: (projectId: string | null) => void;
}) {
  const channelFeed = usePolledFetch<BuddyMailingListPost[]>(channelPostsUrl(list.id), 5000);
  const taskFeed = usePolledFetch<BuddyMailingListPost[]>(
    taskFilter ? taskChannelFeedUrl(workspaceId, taskFilter) : null,
    5000
  );
  const shown = taskFilter ? taskFeed : channelFeed;
  const rows = useMemo(() => channelRows(shown.data ?? []), [shown.data]);
  // Task options come from the channel itself so the picker never offers a
  // Task with nothing to read here.
  const taskIds = useMemo(
    () => [
      ...new Set(
        (channelFeed.data ?? [])
          .map((post) => post.projectId)
          .filter((id): id is string => id !== null)
      ),
    ],
    [channelFeed.data]
  );

  // Pin to the newest message on open, and keep following new posts only
  // while the reader is already at the bottom — never yank someone reading
  // history back down on a 5s poll.
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useEffect(() => {
    const node = scrollRef.current;
    if (node && followRef.current && rows.length > 0) node.scrollTop = node.scrollHeight;
  }, [rows]);

  const context: RowContext = {
    buddyNames,
    channelNameById,
    showChannel: taskFilter !== null,
    availableConversationIds,
  };
  return (
    <section className="channel-browser-pane" aria-label={`#${list.name}`}>
      <header className="channel-browser-pane-header">
        <div className="channel-browser-pane-title">
          <h2>
            <span aria-hidden="true">#</span>
            {list.name}
          </h2>
          <p title={list.purpose}>{list.purpose}</p>
        </div>
        {taskIds.length > 0 && (
          <label className="channel-browser-task-filter">
            <span>Task</span>
            <select
              value={taskFilter ?? ''}
              onChange={(event) => onTaskFilter(event.target.value || null)}
            >
              <option value="">All posts</option>
              {taskIds.map((projectId) => (
                <option key={projectId} value={projectId} title={projectId}>
                  {shortTaskId(projectId)}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {taskFilter && (
        <div className="channel-browser-filter-banner">
          Task <code title={taskFilter}>{shortTaskId(taskFilter)}</code> across every channel
          <button type="button" onClick={() => onTaskFilter(null)}>
            Clear
          </button>
        </div>
      )}
      <div
        className="channel-browser-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        }}
      >
        {shown.error && (
          <p className="channel-browser-error" role="alert">
            Posts could not refresh: {shown.error.message}
          </p>
        )}
        {rows.length === 0 ? (
          <div className="channel-browser-empty">
            <strong>#{list.name}</strong>
            <span>No posts yet.</span>
          </div>
        ) : (
          <ol className="channel-browser-messages">{rows.map((row) => renderRow(row, context))}</ol>
        )}
      </div>
      <footer className="channel-browser-footer">
        Read-only — Buddies post to #{list.name} with the <code>post</code> tool.
      </footer>
    </section>
  );
}

// Full-screen Slack layout. Mounted OUTSIDE the app shell (see App.tsx): the
// channel rail replaces the conversations sidebar instead of nesting beside
// it. Selection lives in the URL (?channel=, ?task=) so reload and Back keep
// the reader where they were.
export function ChannelBrowser({
  workspaceId,
  workspaceName,
  buddyNames,
  availableConversationIds,
}: {
  workspaceId: string;
  workspaceName: string;
  buddyNames: Readonly<Record<string, string>>;
  availableConversationIds: ReadonlySet<string>;
}) {
  const { data, error } = usePolledFetch<BuddyMailingListSummary[]>(
    `/api/buddies/lists?workspaceId=${encodeURIComponent(workspaceId)}`,
    5000
  );
  const workspaces = useAtomValue(buddySidebarChannelsAtom);
  const [params, setParams] = useSearchParams();
  const channelNameById = useMemo(
    () => new Map((data ?? []).map((list) => [list.id, list.name])),
    [data]
  );
  const selected = data?.find((list) => list.id === params.get('channel')) ?? data?.[0] ?? null;
  const select = (next: { channel: string; task: string | null }) =>
    setParams(next.task ? { channel: next.channel, task: next.task } : { channel: next.channel });
  return (
    <div className="channel-browser" aria-label="Channels">
      <nav className="channel-browser-rail">
        <header className="channel-browser-rail-header">
          <Link className="channel-browser-exit" to="/" title="Back to conversations">
            ← Conversations
          </Link>
          <Link
            className="channel-browser-workspace"
            to={`/buddies/workspaces/${encodeURIComponent(workspaceId)}`}
            title="Workspace activity"
          >
            <h1>{workspaceName}</h1>
          </Link>
        </header>
        <div className="channel-browser-rail-scroll">
          <h3 className="channel-browser-rail-section">Channels</h3>
          {error && <p role="alert">Channels could not refresh: {error.message}</p>}
          {data && data.length === 0 ? (
            <p className="channel-browser-rail-empty">No channels yet.</p>
          ) : (
            <ul className="channel-browser-channels">
              {(data ?? []).map((list) => (
                <li key={list.id}>
                  <button
                    type="button"
                    aria-current={selected?.id === list.id ? 'page' : undefined}
                    onClick={() => select({ channel: list.id, task: null })}
                    title={list.purpose}
                  >
                    <span className="channel-browser-hash" aria-hidden="true">
                      #
                    </span>
                    <span className="channel-browser-channel-name">{list.name}</span>
                    <span className="channel-browser-count">{list.postCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {workspaces.length > 1 && (
            <>
              <h3 className="channel-browser-rail-section">Workspaces</h3>
              <ul className="channel-browser-workspaces">
                {workspaces.map((workspace) => (
                  <li key={workspace.workspaceId}>
                    <Link
                      to={`/buddies/workspaces/${encodeURIComponent(workspace.workspaceId)}/channels`}
                      aria-current={workspace.workspaceId === workspaceId ? 'page' : undefined}
                    >
                      <span className="channel-browser-workspace-mark" aria-hidden="true">
                        {initials(workspace.name).slice(0, 1)}
                      </span>
                      {workspace.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </nav>
      <main className="channel-browser-main">
        {selected ? (
          <ChannelPane
            key={selected.id}
            list={selected}
            workspaceId={workspaceId}
            channelNameById={channelNameById}
            buddyNames={buddyNames}
            availableConversationIds={availableConversationIds}
            taskFilter={params.get('task')}
            onTaskFilter={(task) => select({ channel: selected.id, task })}
          />
        ) : (
          <div className="channel-browser-empty">
            <strong>{data ? 'No channels yet' : 'Loading channels…'}</strong>
            {data && <span>Buddies open channels with the new_list tool.</span>}
          </div>
        )}
      </main>
    </div>
  );
}

export function WorkspaceSlack() {
  const { workspaceId = '' } = useParams();
  const conversationIds = useAtomValue(allConversationIdsAtom);
  const availableConversationIds = useMemo(() => new Set(conversationIds), [conversationIds]);
  const loadActivity = useMemo(() => workspaceActivityResource(workspaceId), [workspaceId]);
  const { data } = usePolledFetch<BuddyWorkspaceActivity>(loadActivity, 10_000);
  const buddyNames = useMemo(
    () => Object.fromEntries((data?.members ?? []).map((member) => [member.id, member.name])),
    [data]
  );
  return (
    <ChannelBrowser
      workspaceId={workspaceId}
      workspaceName={data?.workspace.name ?? 'Channels'}
      buddyNames={buddyNames}
      availableConversationIds={availableConversationIds}
    />
  );
}
