import type { BuddyListAuthor, BuddyMailingListPost, BuddyOwnerPostResult } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { buddySidebarChannelsAtom } from '../../atoms/buddy-sidebar';
import { allConversationIdsAtom } from '../../atoms/conversations';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { BuddyRailRow } from './BuddyRailRow';
import { BuddySigil } from './BuddySigil';
import { ChannelAuthor } from './ChannelAuthor';
import { ChannelComposer } from './ChannelComposer';
import { ChannelLoader } from './ChannelLoader';
import { ChannelMarkdown, TypingDots } from './ChannelMarkdown';
import { CopyLinkButton } from './CopyLinkButton';
import {
  type BuddyMailingListSummary,
  CHANNEL_BACKSTOP_MS,
  CONVERSATIONAL_PURPOSES,
  type ChannelMember,
  type ChannelRow,
  channelPostsResource,
  channelReferences,
  channelRows,
  channelThreadResource,
  clockTime,
  createChannel,
  feedPhase,
  joinNames,
  listsUrl,
  postsResource,
  renderFeed,
  taskChannelFeedUrl,
  useChannelResponding,
  useFollowBottom,
  useWarmChannelPosts,
  useWithOutbox,
  useWorkspaceDirectory,
} from './channel-data';
import { channelLinkPath, postLink } from './channel-link';
import { type ChannelReference, type ChannelTask, plainChannelText } from './channel-text';
import './ChannelBrowser.css';

function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

function shortTaskId(projectId: string): string {
  return projectId.replace(/^buddy_project_/, '').slice(0, 8);
}

// Where a row renders decides what its thread affordance does:
// D = Channel(open a thread, show who is replying) ⊕ Thread(already inside one).
type RowPlace =
  | {
      kind: 'channel';
      openThread(rootId: string): void;
      responding: ReadonlyMap<string, readonly string[]>;
    }
  | { kind: 'thread' };

type RowContext = {
  workspaceId: string;
  // The post a permalink named (`?post=`); its row is highlighted.
  linkedPostId: string | null;
  buddyNames: Readonly<Record<string, string>>;
  tasks: ReadonlyMap<string, ChannelTask>;
  channelNameById: ReadonlyMap<string, string>;
  showChannel: boolean;
  availableConversationIds: ReadonlySet<string>;
  place: RowPlace;
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
      {!CONVERSATIONAL_PURPOSES.has(post.purpose) && (
        <span className="channel-browser-purpose" data-purpose={post.purpose}>
          {post.purpose.replaceAll('_', ' ')}
        </span>
      )}
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

function authorName(author: BuddyListAuthor, buddyNames: Readonly<Record<string, string>>) {
  switch (author.kind) {
    case 'owner':
      return 'You';
    case 'buddy':
      return buddyNames[author.buddyId] ?? author.buddyId;
  }
}

function Replying({ names }: { names: readonly string[] }) {
  return (
    <span className="channel-browser-replying" aria-live="polite">
      <TypingDots />
      {joinNames(names)} {names.length === 1 ? 'is' : 'are'} replying…
    </span>
  );
}

// "N replies · last reply 10:42" under a thread root in the channel, plus the
// live replying indicator. Inside the thread pane there is nothing to show.
function ThreadSummary({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  switch (context.place.kind) {
    case 'thread':
      return null;
    case 'channel': {
      const place = context.place;
      const replying = (place.responding.get(post.id) ?? []).map(
        (buddyId) => context.buddyNames[buddyId] ?? buddyId
      );
      if (post.replyCount === 0 && replying.length === 0) return null;
      return (
        <div className="channel-browser-thread-summary">
          {post.replyCount > 0 && (
            <button type="button" onClick={() => place.openThread(post.id)}>
              <strong>
                {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
              </strong>
              {post.latestReplyAt && <span>Last reply {clockTime(post.latestReplyAt)}</span>}
            </button>
          )}
          {replying.length > 0 && <Replying names={replying} />}
        </div>
      );
    }
  }
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7l-3 2.5v-2.5h0a2 2 0 0 1-1.5-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplyAction({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  switch (context.place.kind) {
    case 'thread':
      return null;
    case 'channel': {
      const place = context.place;
      return (
        <button
          type="button"
          className="channel-browser-message-action"
          onClick={() => place.openThread(post.threadRootId ?? post.id)}
          title="Reply in thread"
          aria-label="Reply in thread"
        >
          <ReplyIcon />
        </button>
      );
    }
  }
}

// Slack's hover toolbar: a small floating group pinned to the message's
// top-right corner, straddling its top edge so it never covers the text.
function MessageActions({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  return (
    <div className="channel-browser-message-actions" role="toolbar" aria-label="Message actions">
      <ReplyAction post={post} context={context} />
      <CopyLinkButton
        className="channel-browser-message-action"
        path={channelLinkPath(context.workspaceId, postLink(post))}
        label="Copy link to message"
      />
    </div>
  );
}

function PostBody({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  return <ChannelMarkdown body={post.body} buddyNames={context.buddyNames} tasks={context.tasks} />;
}

function LeadRow({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  return (
    <li
      className="channel-browser-message channel-browser-message--lead"
      data-purpose={post.purpose}
      data-post-id={post.id}
      data-linked={post.id === context.linkedPostId ? 'true' : undefined}
    >
      <BuddySigil
        className="channel-browser-avatar"
        name={authorName(post.author, context.buddyNames)}
      />
      <div className="channel-browser-message-content">
        <div className="channel-browser-message-heading">
          <ChannelAuthor
            className="channel-browser-author"
            author={post.author}
            buddyNames={context.buddyNames}
            workspaceId={context.workspaceId}
          />
          <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>
            {clockTime(post.createdAt)}
          </time>
          <PostMeta post={post} context={context} />
        </div>
        <PostBody post={post} context={context} />
        <ThreadSummary post={post} context={context} />
      </div>
      <MessageActions post={post} context={context} />
    </li>
  );
}

function ContinuationRow({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  return (
    <li
      className="channel-browser-message channel-browser-message--continuation"
      data-purpose={post.purpose}
      data-post-id={post.id}
      data-linked={post.id === context.linkedPostId ? 'true' : undefined}
    >
      <time
        className="channel-browser-gutter-time"
        dateTime={post.createdAt}
        title={new Date(post.createdAt).toLocaleString()}
      >
        {clockTime(post.createdAt)}
      </time>
      <div className="channel-browser-message-content">
        <span className="channel-browser-inline-meta">
          <PostMeta post={post} context={context} />
        </span>
        <PostBody post={post} context={context} />
        <ThreadSummary post={post} context={context} />
      </div>
      <MessageActions post={post} context={context} />
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

function ThreadPane({
  list,
  rootId,
  context,
  references,
  replying,
  onClose,
}: {
  list: BuddyMailingListSummary;
  rootId: string;
  context: RowContext;
  references: readonly ChannelReference[];
  replying: readonly string[];
  onClose(): void;
}) {
  const thread = usePolledFetch(channelThreadResource(list.id, rootId), CHANNEL_BACKSTOP_MS);
  const replies = useWithOutbox(list.workspaceId, list.id, rootId, thread.data?.replies ?? null);
  const replyRows = useMemo(() => channelRows(replies ?? []), [replies]);
  const follow = useFollowBottom(
    replyRows.length + replying.length,
    thread.data,
    context.linkedPostId
  );
  const root = thread.data?.root;
  return (
    <aside className="channel-thread" aria-label="Thread">
      <header className="channel-thread-header">
        <div>
          <h2>Thread</h2>
          <p>#{list.name}</p>
        </div>
        <div className="channel-thread-header-actions">
          <CopyLinkButton
            className="channel-browser-header-action"
            path={channelLinkPath(context.workspaceId, {
              kind: 'thread',
              listId: list.id,
              rootId,
            })}
            label="Copy link to thread"
          />
          <button type="button" onClick={onClose} aria-label="Close thread" title="Close thread">
            ✕
          </button>
        </div>
      </header>
      <div className="channel-browser-scroll" ref={follow.scrollRef} onScroll={follow.onScroll}>
        {thread.error && (
          <p className="channel-browser-error" role="alert">
            Thread could not refresh: {thread.error.message}
          </p>
        )}
        {feedPhase({ data: thread.data?.replies ?? null, error: thread.error }) === 'loading' && (
          <ChannelLoader label="Loading thread…" />
        )}
        {root && (
          <ol className="channel-browser-messages channel-thread-root">
            <LeadRow post={root} context={context} />
          </ol>
        )}
        {root && (
          <div className="channel-thread-divider">
            <span>
              {root.replyCount} {root.replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </div>
        )}
        <ol className="channel-browser-messages">
          {replyRows.map((row) => renderRow(row, context))}
        </ol>
        {replying.length > 0 && (
          <div className="channel-thread-replying">
            <Replying names={replying} />
          </div>
        )}
      </div>
      <ChannelComposer
        key={rootId}
        listId={list.id}
        threadRootId={rootId}
        placeholder={root ? `Reply to ${plainChannelText(root.body).slice(0, 40)}…` : 'Reply…'}
        references={references}
        submit="enter"
        onPosted={() => {
          follow.pin();
          void thread.refetch();
        }}
      />
    </aside>
  );
}

function ChannelPane({
  list,
  workspaceId,
  channelNameById,
  buddyNames,
  tasks,
  references,
  availableConversationIds,
  taskFilter,
  onTaskFilter,
  threadId,
  linkedPostId,
  onThread,
}: {
  list: BuddyMailingListSummary;
  workspaceId: string;
  channelNameById: ReadonlyMap<string, string>;
  buddyNames: Readonly<Record<string, string>>;
  tasks: ReadonlyMap<string, ChannelTask>;
  references: readonly ChannelReference[];
  availableConversationIds: ReadonlySet<string>;
  taskFilter: string | null;
  onTaskFilter: (projectId: string | null) => void;
  threadId: string | null;
  linkedPostId: string | null;
  onThread: (rootId: string | null) => void;
}) {
  const channelFeed = usePolledFetch(channelPostsResource(list.id), CHANNEL_BACKSTOP_MS);
  const taskFeed = usePolledFetch(
    taskFilter ? postsResource(taskChannelFeedUrl(workspaceId, taskFilter)) : null,
    CHANNEL_BACKSTOP_MS
  );
  const respondingByRoot = useChannelResponding(list.id);
  const channelPosts = useWithOutbox(workspaceId, list.id, null, channelFeed.data);
  const shown = taskFilter ? taskFeed : { ...channelFeed, data: channelPosts };
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
  const follow = useFollowBottom(rows.length, shown.data, null);
  const base = {
    workspaceId,
    buddyNames,
    tasks,
    channelNameById,
    showChannel: taskFilter !== null,
    availableConversationIds,
    linkedPostId,
  };
  const channelContext: RowContext = {
    ...base,
    place: { kind: 'channel', openThread: onThread, responding: respondingByRoot },
  };
  const threadContext: RowContext = { ...base, showChannel: false, place: { kind: 'thread' } };
  return (
    <div className="channel-browser-panes" data-thread={threadId ? 'open' : undefined}>
      <section className="channel-browser-pane" aria-label={`#${list.name}`}>
        <header className="channel-browser-pane-header">
          <div className="channel-browser-pane-title">
            <h2>
              <span aria-hidden="true">#</span>
              {list.name}
            </h2>
            <p title={list.purpose}>{list.purpose}</p>
          </div>
          <CopyLinkButton
            className="channel-browser-header-action"
            path={channelLinkPath(workspaceId, { kind: 'channel', listId: list.id })}
            label="Copy link to channel"
          />
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
                    {tasks.get(projectId)?.title ?? shortTaskId(projectId)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        {taskFilter && (
          <div className="channel-browser-filter-banner">
            Task{' '}
            <code title={taskFilter}>
              {tasks.get(taskFilter)?.title ?? shortTaskId(taskFilter)}
            </code>{' '}
            across every channel
            <button type="button" onClick={() => onTaskFilter(null)}>
              Clear
            </button>
          </div>
        )}
        <div className="channel-browser-scroll" ref={follow.scrollRef} onScroll={follow.onScroll}>
          {shown.error && (
            <p className="channel-browser-error" role="alert">
              Posts could not refresh: {shown.error.message}
            </p>
          )}
          {renderFeed(feedPhase(shown), {
            loading: () => <ChannelLoader label={`Loading #${list.name}…`} />,
            failed: () => null,
            empty: () => (
              <div className="channel-browser-empty">
                <strong>#{list.name}</strong>
                <span>No posts yet. Say hello, or @mention a Buddy to ask it something.</span>
              </div>
            ),
            posts: () => (
              <ol className="channel-browser-messages">
                {rows.map((row) => renderRow(row, channelContext))}
              </ol>
            ),
          })}
        </div>
        <ChannelComposer
          listId={list.id}
          threadRootId={null}
          placeholder={`Message #${list.name}`}
          references={references}
          submit="enter"
          onPosted={(result: BuddyOwnerPostResult) => {
            follow.pin();
            void channelFeed.refetch();
            // Mentioning a Buddy opens the thread its reply will land in.
            if (result.mentions.some((mention) => mention.status === 'started'))
              onThread(result.post.id);
          }}
        />
      </section>
      {threadId && (
        <ThreadPane
          key={threadId}
          list={list}
          rootId={threadId}
          context={threadContext}
          references={references}
          replying={(respondingByRoot.get(threadId) ?? []).map(
            (buddyId) => buddyNames[buddyId] ?? buddyId
          )}
          onClose={() => onThread(null)}
        />
      )}
    </div>
  );
}

// Workspace switcher: the name at the top left is a button; its menu lists
// every workspace with channels plus the workspace activity page.
function WorkspaceSwitcher({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const workspaces = useAtomValue(buddySidebarChannelsAtom);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !rootRef.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="channel-browser-switcher" ref={rootRef}>
      <button
        type="button"
        className="channel-browser-workspace"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <h1>{workspaceName}</h1>
        <span className="channel-browser-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="channel-browser-switcher-menu" role="menu">
          <ul>
            {workspaces.map((workspace) => (
              <li key={workspace.workspaceId}>
                <Link
                  role="menuitem"
                  to={`/buddies/workspaces/${encodeURIComponent(workspace.workspaceId)}/channels`}
                  aria-current={workspace.workspaceId === workspaceId ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span className="channel-browser-workspace-mark" aria-hidden="true">
                    {initials(workspace.name).slice(0, 1)}
                  </span>
                  {workspace.name}
                  {workspace.workspaceId === workspaceId && (
                    <span className="channel-browser-switcher-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            role="menuitem"
            className="channel-browser-switcher-activity"
            to={`/buddies/workspaces/${encodeURIComponent(workspaceId)}`}
            onClick={() => setOpen(false)}
          >
            Workspace activity
          </Link>
        </div>
      )}
    </div>
  );
}

function NewChannelForm({
  workspaceId,
  onCreated,
  onCancel,
}: {
  workspaceId: string;
  onCreated(listId: string): void;
  onCancel(): void;
}) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cleanName = name.trim().replace(/^#/, '');
  return (
    <form
      className="channel-browser-new-channel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!cleanName || !purpose.trim()) return;
        setBusy(true);
        setProblem(null);
        void createChannel(workspaceId, cleanName, purpose.trim())
          .then(onCreated)
          .catch((cause: unknown) =>
            setProblem(cause instanceof Error ? cause.message : String(cause))
          )
          .finally(() => setBusy(false));
      }}
    >
      <label>
        <span className="channel-browser-hash" aria-hidden="true">
          #
        </span>
        <input
          autoFocus
          value={name}
          maxLength={80}
          placeholder="channel-name"
          aria-label="Channel name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && onCancel()}
        />
      </label>
      <input
        value={purpose}
        maxLength={400}
        placeholder="What is it for?"
        aria-label="Channel purpose"
        onChange={(event) => setPurpose(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      />
      {problem && (
        <p className="channel-browser-new-channel-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="channel-browser-new-channel-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !cleanName || !purpose.trim()}>
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}

// Full-screen Slack layout. Mounted OUTSIDE the app shell (see App.tsx): the
// channel rail replaces the conversations sidebar instead of nesting beside
// it. Selection lives in the URL (?channel=, ?task=, ?thread=, ?post=) so
// reload and Back keep the reader where they were, and any of it can be shared
// as a permalink (channel-link.ts). Selecting anything drops `post`: the
// highlight belongs to the link that was opened, not to later navigation.
export function ChannelBrowser({
  workspaceId,
  workspaceName,
  members,
  tasks,
  availableConversationIds,
}: {
  workspaceId: string;
  workspaceName: string;
  members: readonly ChannelMember[];
  tasks: readonly ChannelTask[];
  availableConversationIds: ReadonlySet<string>;
}) {
  const lists = usePolledFetch<BuddyMailingListSummary[]>(
    listsUrl(workspaceId),
    CHANNEL_BACKSTOP_MS
  );
  const { data, error } = lists;
  useWarmChannelPosts(data);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const channelNameById = useMemo(
    () => new Map((data ?? []).map((list) => [list.id, list.name])),
    [data]
  );
  const buddyNames = useMemo(
    () => Object.fromEntries(members.map((member) => [member.id, member.name])),
    [members]
  );
  const activeMembers = useMemo(
    () => members.filter((member) => member.status === 'active'),
    [members]
  );
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const references = useMemo(() => channelReferences(members, tasks), [members, tasks]);
  const selected = data?.find((list) => list.id === params.get('channel')) ?? data?.[0] ?? null;
  const select = (next: { channel: string; task: string | null; thread: string | null }) =>
    setParams({
      channel: next.channel,
      ...(next.task ? { task: next.task } : {}),
      ...(next.thread ? { thread: next.thread } : {}),
    });
  return (
    <div className="channel-browser" aria-label="Channels">
      <nav className="channel-browser-rail">
        <header className="channel-browser-rail-header">
          <Link className="channel-browser-exit" to="/" title="Back to conversations">
            ← Conversations
          </Link>
          <WorkspaceSwitcher workspaceId={workspaceId} workspaceName={workspaceName} />
        </header>
        <div className="channel-browser-rail-scroll">
          <div className="channel-browser-rail-section-row">
            <h3 className="channel-browser-rail-section">Channels</h3>
            <button
              type="button"
              className="channel-browser-rail-add"
              onClick={() => setCreating(true)}
              title="New channel"
              aria-label="New channel"
            >
              +
            </button>
          </div>
          {creating && (
            <NewChannelForm
              workspaceId={workspaceId}
              onCancel={() => setCreating(false)}
              onCreated={(listId) => {
                setCreating(false);
                void lists.refetch();
                select({ channel: listId, task: null, thread: null });
              }}
            />
          )}
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
                    onClick={() => select({ channel: list.id, task: null, thread: null })}
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
          {activeMembers.length > 0 && (
            <>
              <h3 className="channel-browser-rail-section">Buddies</h3>
              <ul className="channel-browser-buddies">
                {activeMembers.map((member) => (
                  <BuddyRailRow key={member.id} member={member} workspaceId={workspaceId} />
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
            tasks={taskById}
            references={references}
            availableConversationIds={availableConversationIds}
            taskFilter={params.get('task')}
            onTaskFilter={(task) =>
              select({ channel: selected.id, task, thread: params.get('thread') })
            }
            threadId={params.get('thread')}
            linkedPostId={params.get('post')}
            onThread={(thread) =>
              select({ channel: selected.id, task: params.get('task'), thread })
            }
          />
        ) : (
          <div className="channel-browser-empty">
            <strong>{data ? 'No channels yet' : 'Loading channels…'}</strong>
            {data && (
              <button
                type="button"
                className="channel-browser-empty-action"
                onClick={() => setCreating(true)}
              >
                Create the first channel
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// The desktop route: the full-screen Slack surface for one workspace.
export function WorkspaceSlack() {
  const { workspaceId = '' } = useParams();
  const conversationIds = useAtomValue(allConversationIdsAtom);
  const availableConversationIds = useMemo(() => new Set(conversationIds), [conversationIds]);
  const directory = useWorkspaceDirectory(workspaceId);
  return (
    <ChannelBrowser
      workspaceId={workspaceId}
      workspaceName={directory.workspaceName}
      members={directory.members}
      tasks={directory.tasks}
      availableConversationIds={availableConversationIds}
    />
  );
}
