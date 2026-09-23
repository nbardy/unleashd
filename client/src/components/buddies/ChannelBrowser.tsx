import { type BuddyWorkspaceActivity, BuddyWorkspaceActivitySchema } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { type UIEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { buddySidebarChannelsAtom } from '../../atoms/buddy-sidebar';
import { allConversationIdsAtom } from '../../atoms/conversations';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { newId } from '../../utils/ids';
import {
  type BuddyListAuthor,
  type BuddyMailingListPost,
  type BuddyMailingListSummary,
  PostAuthor,
  authorKey,
  taskChannelFeedUrl,
} from './BuddyMessages';
import { BuddySigil } from './BuddySigil';
import { ChannelComposer, type PostResult } from './ChannelComposer';
import { ChannelMarkdown } from './ChannelMarkdown';
import { buddyApi } from './api';
import {
  type ChannelReference,
  type ChannelTask,
  plainChannelText,
  workspaceTasksUrl,
} from './channel-text';
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

function threadUrl(listId: string, rootId: string): string {
  return `/api/buddies/lists/${encodeURIComponent(listId)}/threads/${encodeURIComponent(rootId)}`;
}

function respondingUrl(listId: string): string {
  return `/api/buddies/lists/${encodeURIComponent(listId)}/responding`;
}

function listsUrl(workspaceId: string): string {
  return `/api/buddies/lists?workspaceId=${encodeURIComponent(workspaceId)}`;
}

// Every workspace member names posts (archived authors included); only active
// ones appear in the rail and the @ menu.
export type ChannelMember = { id: string; name: string; role: string; status: string };

type ChannelThread = { root: BuddyMailingListPost; replies: BuddyMailingListPost[] };
type ChannelResponse = { threadRootId: string; buddyId: string; conversationId: string };

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
  if (!a.author || !b.author) return false;
  return (
    authorKey(a.author) === authorKey(b.author) && a.senderConversationId === b.senderConversationId
  );
}

// Posts arrive newest-first; a Slack transcript reads oldest-first with the
// newest message at the bottom, next to the composer.
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

// Conversational purposes read as plain chat; every other purpose (standup,
// handoff, decision, reply_failed…) is a label worth showing.
const CONVERSATIONAL_PURPOSES: ReadonlySet<string> = new Set(['message', 'reply']);

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

function authorName(
  author: BuddyListAuthor | undefined,
  buddyNames: Readonly<Record<string, string>>
) {
  if (!author) return 'Unknown';
  switch (author.kind) {
    case 'owner':
      return 'You';
    case 'buddy':
      return buddyNames[author.buddyId] ?? author.buddyId;
  }
}

function joinNames(names: readonly string[]): string {
  return names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function Replying({ names }: { names: readonly string[] }) {
  return (
    <span className="channel-browser-replying" aria-live="polite">
      <span className="channel-browser-replying-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
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

function ReplyAction({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  switch (context.place.kind) {
    case 'thread':
      return null;
    case 'channel': {
      const place = context.place;
      return (
        <button
          type="button"
          className="channel-browser-reply-action"
          onClick={() => place.openThread(post.threadRootId ?? post.id)}
          title="Reply in thread"
        >
          Reply
        </button>
      );
    }
  }
}

function PostBody({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  return <ChannelMarkdown body={post.body} buddyNames={context.buddyNames} tasks={context.tasks} />;
}

function LeadRow({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  return (
    <li
      className="channel-browser-message channel-browser-message--lead"
      data-purpose={post.purpose}
    >
      <BuddySigil
        className="channel-browser-avatar"
        name={authorName(post.author, context.buddyNames)}
      />
      <div className="channel-browser-message-content">
        <div className="channel-browser-message-heading">
          <PostAuthor
            className="channel-browser-author"
            author={post.author}
            buddyNames={context.buddyNames}
          />
          <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>
            {clockTime(post.createdAt)}
          </time>
          <PostMeta post={post} context={context} />
        </div>
        <PostBody post={post} context={context} />
        <ThreadSummary post={post} context={context} />
      </div>
      <ReplyAction post={post} context={context} />
    </li>
  );
}

function ContinuationRow({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  return (
    <li
      className="channel-browser-message channel-browser-message--continuation"
      data-purpose={post.purpose}
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
      <ReplyAction post={post} context={context} />
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

// Pin to the newest message on open, and keep following new posts only while
// the reader is already at the bottom — never yank someone reading history
// back down on a poll.
function useFollowBottom(rowCount: number, version: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the re-pin trigger
  useEffect(() => {
    const node = scrollRef.current;
    if (node && followRef.current && rowCount > 0) node.scrollTop = node.scrollHeight;
  }, [rowCount, version]);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  };
  const pin = () => {
    followRef.current = true;
  };
  return { scrollRef, onScroll, pin };
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
  const thread = usePolledFetch<ChannelThread>(threadUrl(list.id, rootId), 3000);
  const replyRows = useMemo(() => channelRows(thread.data?.replies ?? []), [thread.data]);
  const follow = useFollowBottom(replyRows.length + replying.length, thread.data);
  // A reply that just finished is already written; fetch it now, not on the next poll.
  const replyingCount = replying.length;
  const previousReplying = useRef(replyingCount);
  useEffect(() => {
    if (replyingCount < previousReplying.current) void thread.refetch();
    previousReplying.current = replyingCount;
  }, [replyingCount, thread.refetch]);
  const root = thread.data?.root;
  return (
    <aside className="channel-thread" aria-label="Thread">
      <header className="channel-thread-header">
        <div>
          <h2>Thread</h2>
          <p>#{list.name}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close thread" title="Close thread">
          ✕
        </button>
      </header>
      <div className="channel-browser-scroll" ref={follow.scrollRef} onScroll={follow.onScroll}>
        {thread.error && (
          <p className="channel-browser-error" role="alert">
            Thread could not refresh: {thread.error.message}
          </p>
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
  onThread: (rootId: string | null) => void;
}) {
  const channelFeed = usePolledFetch<BuddyMailingListPost[]>(channelPostsUrl(list.id), 5000);
  const taskFeed = usePolledFetch<BuddyMailingListPost[]>(
    taskFilter ? taskChannelFeedUrl(workspaceId, taskFilter) : null,
    5000
  );
  const responding = usePolledFetch<ChannelResponse[]>(respondingUrl(list.id), 2500);
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
  const respondingByRoot = useMemo(() => {
    const byRoot = new Map<string, string[]>();
    for (const row of responding.data ?? [])
      byRoot.set(row.threadRootId, [...(byRoot.get(row.threadRootId) ?? []), row.buddyId]);
    return byRoot;
  }, [responding.data]);
  // When a reply finishes, its post already exists: refresh reply counts now.
  const respondingCount = responding.data?.length ?? 0;
  const previousResponding = useRef(respondingCount);
  useEffect(() => {
    if (respondingCount < previousResponding.current) void channelFeed.refetch();
    previousResponding.current = respondingCount;
  }, [respondingCount, channelFeed.refetch]);

  const follow = useFollowBottom(rows.length, shown.data);
  const base = {
    buddyNames,
    tasks,
    channelNameById,
    showChannel: taskFilter !== null,
    availableConversationIds,
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
          {rows.length === 0 ? (
            <div className="channel-browser-empty">
              <strong>#{list.name}</strong>
              <span>No posts yet. Say hello, or @mention a Buddy to ask it something.</span>
            </div>
          ) : (
            <ol className="channel-browser-messages">
              {rows.map((row) => renderRow(row, channelContext))}
            </ol>
          )}
        </div>
        <ChannelComposer
          listId={list.id}
          threadRootId={null}
          placeholder={`Message #${list.name}`}
          references={references}
          onPosted={(result: PostResult) => {
            follow.pin();
            void channelFeed.refetch();
            void responding.refetch();
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
        void buddyApi<{ list: { id: string } }>('/api/buddies/lists', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            author: { kind: 'owner' },
            key: newId(),
            name: cleanName,
            purpose: purpose.trim(),
          }),
        })
          .then((result) => onCreated(result.list.id))
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

const TASK_STATUS_LABELS: Readonly<Record<string, string>> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In progress',
  review: 'In review',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

// The universal @ menu: Buddies first by name, then Tasks by title; the fuzzy
// ranker orders them together by match quality.
function channelReferences(
  members: readonly ChannelMember[],
  tasks: readonly ChannelTask[]
): ChannelReference[] {
  return [
    ...members
      .filter((member) => member.status === 'active')
      .map(
        (member): ChannelReference => ({
          kind: 'buddy',
          id: member.id,
          label: member.name,
          detail: member.role,
        })
      ),
    ...tasks
      .filter((task) => task.status !== 'cancelled')
      .map(
        (task): ChannelReference => ({
          kind: 'task',
          id: task.id,
          label: task.title,
          status: task.status,
          detail: `${TASK_STATUS_LABELS[task.status] ?? task.status} · ${task.ownerName}`,
        })
      ),
  ];
}

// Full-screen Slack layout. Mounted OUTSIDE the app shell (see App.tsx): the
// channel rail replaces the conversations sidebar instead of nesting beside
// it. Selection lives in the URL (?channel=, ?task=, ?thread=) so reload and
// Back keep the reader where they were.
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
  const lists = usePolledFetch<BuddyMailingListSummary[]>(listsUrl(workspaceId), 5000);
  const { data, error } = lists;
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
                  <li key={member.id}>
                    <Link to={`/buddies/${encodeURIComponent(member.id)}`} title={member.role}>
                      <BuddySigil className="channel-browser-buddy-sigil" name={member.name} />
                      <span className="channel-browser-channel-name">{member.name}</span>
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
            tasks={taskById}
            references={references}
            availableConversationIds={availableConversationIds}
            taskFilter={params.get('task')}
            onTaskFilter={(task) =>
              select({ channel: selected.id, task, thread: params.get('thread') })
            }
            threadId={params.get('thread')}
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

const NO_TASKS: readonly ChannelTask[] = [];

export function WorkspaceSlack() {
  const { workspaceId = '' } = useParams();
  const conversationIds = useAtomValue(allConversationIdsAtom);
  const availableConversationIds = useMemo(() => new Set(conversationIds), [conversationIds]);
  const loadActivity = useMemo(() => workspaceActivityResource(workspaceId), [workspaceId]);
  const { data } = usePolledFetch<BuddyWorkspaceActivity>(loadActivity, 10_000);
  const tasks = usePolledFetch<ChannelTask[]>(workspaceTasksUrl(workspaceId), 15_000);
  const members = useMemo(
    () =>
      (data?.members ?? []).map((member) => ({
        id: member.id,
        name: member.name,
        role: member.role,
        status: member.status,
      })),
    [data]
  );
  return (
    <ChannelBrowser
      workspaceId={workspaceId}
      workspaceName={data?.workspace.name ?? 'Channels'}
      members={members}
      tasks={tasks.data ?? NO_TASKS}
      availableConversationIds={availableConversationIds}
    />
  );
}
