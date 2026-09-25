import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { availableConversationIdSetAtom, conversationAtomFamily } from '../../atoms/conversations';
import { useBuddyOverview } from '../../hooks/useBuddyData';
import { rowBuddy } from '../../utils/conversation-row';
import { Chat } from '../Chat';
import { BuddyRailRow } from './BuddyRailRow';
import { BuddySigil } from './BuddySigil';
import { ChannelAuthor, type OpenDm } from './ChannelAuthor';
import { ChannelComposer } from './ChannelComposer';
import { ChannelHistory, ChannelLoader } from './ChannelLoader';
import { ChannelMarkdown, TypingDots } from './ChannelMarkdown';
import { CopyLinkButton } from './CopyLinkButton';
import { errorText } from './api';
import {
  type ChannelHeading,
  type ChannelRow,
  type WorkspaceDirectory,
  authorName,
  channelFeed,
  channelHeading,
  channelRequestCount,
  channelRows,
  channelUnreadAttr,
  clockTime,
  createChannel,
  feedPhase,
  newestServedId,
  postPurposeLabel,
  postPurposeTag,
  railChannels,
  renderFeed,
  threadFeed,
  useChannelFeed,
  useChannelResponding,
  useFollowBottom,
  useMarkChannelRead,
  useWarmChannelPosts,
  useWithOutbox,
  useWorkspaceDirectory,
  useWorkspaceInbox,
} from './channel-data';
import { channelLinkPath, postLink } from './channel-link';
import { plainChannelText } from './channel-text';
import type { ChannelUnread, Post } from './types';
import { initials } from './ui-contract';
import './ChannelBrowser.css';

// Where a row renders decides what its thread affordance does:
// D = Channel(open a thread, show who is replying) ⊕ Thread(already inside one).
type RowPlace =
  | {
      kind: 'channel';
      openThread(rootId: string): void;
      responding: ReadonlyMap<string, string>;
    }
  | { kind: 'thread' };

type RowContext = {
  workspaceId: string;
  // The post a permalink named (`?post=`); its row is highlighted.
  linkedPostId: string | null;
  directory: WorkspaceDirectory;
  availableConversationIds: ReadonlySet<string>;
  openDm: OpenDm;
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

function PostPurpose({ post }: { post: Post }) {
  const label = postPurposeLabel(post);
  return label === null ? null : (
    <span className="channel-browser-purpose" data-purpose={postPurposeTag(post)}>
      {label}
    </span>
  );
}

function PostMeta({ post, context }: { post: Post; context: RowContext }) {
  return (
    <>
      <PostPurpose post={post} />
      {post.conversationId && (
        <InstanceTag
          conversationId={post.conversationId}
          available={context.availableConversationIds.has(post.conversationId)}
        />
      )}
    </>
  );
}

function Replying({ text }: { text: string }) {
  return (
    <span className="channel-browser-replying" aria-live="polite">
      <TypingDots />
      {text}
    </span>
  );
}

// Who is replying in a root's thread, under the root in the channel. Posts
// carry no reply count (the API has none), so every root offers its thread
// through the hover toolbar and this line shows only live replies.
function ThreadSummary({ post, context }: { post: Post; context: RowContext }) {
  switch (context.place.kind) {
    case 'thread':
      return null;
    case 'channel': {
      const place = context.place;
      const replying = place.responding.get(post.id);
      if (replying === undefined) return null;
      return (
        <div className="channel-browser-thread-summary">
          <button type="button" onClick={() => place.openThread(post.id)}>
            <strong>Open thread</strong>
          </button>
          <Replying text={replying} />
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

function ReplyAction({ post, context }: { post: Post; context: RowContext }) {
  switch (context.place.kind) {
    case 'thread':
      return null;
    case 'channel': {
      const place = context.place;
      return (
        <button
          type="button"
          className="channel-browser-message-action"
          onClick={() => place.openThread(post.rootId ?? post.id)}
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
function MessageActions({ post, context }: { post: Post; context: RowContext }) {
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

function PostBody({ post, context }: { post: Post; context: RowContext }) {
  return (
    <ChannelMarkdown
      body={post.body}
      buddyNames={context.directory.buddyNames}
      tasks={context.directory.taskById}
    />
  );
}

function LeadRow({ post, context }: { post: Post; context: RowContext }) {
  return (
    <li
      className="channel-browser-message channel-browser-message--lead"
      data-purpose={postPurposeTag(post)}
      data-post-id={post.id}
      data-linked={post.id === context.linkedPostId ? 'true' : undefined}
    >
      <BuddySigil
        className="channel-browser-avatar"
        name={authorName(post.author, context.directory.buddyNames)}
      />
      <div className="channel-browser-message-content">
        <div className="channel-browser-message-heading">
          <ChannelAuthor
            className="channel-browser-author"
            author={post.author}
            buddyNames={context.directory.buddyNames}
            openDm={context.openDm}
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

function ContinuationRow({ post, context }: { post: Post; context: RowContext }) {
  return (
    <li
      className="channel-browser-message channel-browser-message--continuation"
      data-purpose={postPurposeTag(post)}
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
  entry,
  heading,
  rootId,
  context,
  replying,
  onClose,
}: {
  entry: ChannelUnread;
  heading: ChannelHeading;
  rootId: string;
  context: RowContext;
  replying: string | undefined;
  onClose(): void;
}) {
  const channelId = entry.channel.id;
  const thread = useChannelFeed(threadFeed(rootId));
  const root = thread.latest.data?.root;
  const replies = useWithOutbox(channelId, rootId, thread.posts);
  const replyRows = useMemo(() => channelRows(replies ?? []), [replies]);
  const follow = useFollowBottom(
    replyRows.length + (replying === undefined ? 0 : 1),
    thread.posts,
    context.linkedPostId
  );
  useMarkChannelRead(channelId, entry.unread, newestServedId(thread.posts) ?? root?.id ?? null);
  return (
    <aside className="channel-thread" aria-label="Thread">
      <header className="channel-thread-header">
        <div>
          <h2>Thread</h2>
          <p>
            {heading.mark}
            {heading.name}
          </p>
        </div>
        <div className="channel-thread-header-actions">
          <CopyLinkButton
            className="channel-browser-header-action"
            path={channelLinkPath(context.workspaceId, { kind: 'thread', channelId, rootId })}
            label="Copy link to thread"
          />
          <button type="button" onClick={onClose} aria-label="Close thread" title="Close thread">
            ✕
          </button>
        </div>
      </header>
      <div className="channel-browser-scroll" ref={follow.scrollRef} onScroll={follow.onScroll}>
        {(thread.latest.kind === 'failed' || thread.latest.kind === 'stale') && (
          <p className="channel-browser-error" role="alert">
            Thread could not refresh: {thread.latest.error.message}
          </p>
        )}
        {thread.latest.kind === 'loading' && <ChannelLoader label="Loading thread…" />}
        {root && (
          <ol className="channel-browser-messages channel-thread-root">
            <LeadRow post={root} context={context} />
          </ol>
        )}
        {root && (
          <div className="channel-thread-divider">
            <span>Replies</span>
          </div>
        )}
        {root && (
          <ChannelHistory
            edge={thread.edge}
            scrollRef={follow.scrollRef}
            onReach={() => void thread.loadOlder(follow.hold)}
          />
        )}
        <ol className="channel-browser-messages">
          {replyRows.map((row) => renderRow(row, context))}
        </ol>
        {replying !== undefined && (
          <div className="channel-thread-replying">
            <Replying text={replying} />
          </div>
        )}
      </div>
      <ChannelComposer
        key={rootId}
        channelId={channelId}
        rootId={rootId}
        placeholder={root ? `Reply to ${plainChannelText(root.body).slice(0, 40)}…` : 'Reply…'}
        references={context.directory.references}
        submit="enter"
        onPosted={() => {
          follow.pin();
          void thread.latest.refetch();
        }}
      />
    </aside>
  );
}

function ChannelPane({
  entry,
  workspaceId,
  directory,
  availableConversationIds,
  threadId,
  linkedPostId,
  onThread,
  openDm,
}: {
  entry: ChannelUnread;
  workspaceId: string;
  directory: WorkspaceDirectory;
  availableConversationIds: ReadonlySet<string>;
  threadId: string | null;
  linkedPostId: string | null;
  onThread: (rootId: string | null) => void;
  openDm: OpenDm;
}) {
  const channelId = entry.channel.id;
  const heading = channelHeading(entry.channel.kind, directory.buddyNames);
  const feed = useChannelFeed(channelFeed(channelId));
  const respondingByRoot = useChannelResponding(channelId, directory.buddyNames);
  const posts = useWithOutbox(channelId, null, feed.posts);
  const rows = useMemo(() => channelRows(posts ?? []), [posts]);
  const follow = useFollowBottom(rows.length, posts, null);
  useMarkChannelRead(channelId, entry.unread, newestServedId(feed.posts));
  const base = { workspaceId, directory, availableConversationIds, linkedPostId, openDm };
  const channelContext: RowContext = {
    ...base,
    place: { kind: 'channel', openThread: onThread, responding: respondingByRoot },
  };
  const threadContext: RowContext = { ...base, place: { kind: 'thread' } };
  return (
    <div className="channel-browser-panes" data-thread={threadId ? 'open' : undefined}>
      <section className="channel-browser-pane" aria-label={`${heading.mark}${heading.name}`}>
        <header className="channel-browser-pane-header">
          <div className="channel-browser-pane-title">
            <h2>
              <span aria-hidden="true">{heading.mark}</span>
              {heading.name}
            </h2>
            <p title={heading.about}>{heading.about}</p>
          </div>
          <CopyLinkButton
            className="channel-browser-header-action"
            path={channelLinkPath(workspaceId, { kind: 'channel', channelId })}
            label="Copy link to channel"
          />
        </header>
        <div className="channel-browser-scroll" ref={follow.scrollRef} onScroll={follow.onScroll}>
          {(feed.latest.kind === 'failed' || feed.latest.kind === 'stale') && (
            <p className="channel-browser-error" role="alert">
              Posts could not refresh: {feed.latest.error.message}
            </p>
          )}
          {renderFeed(feedPhase(feed.latest.kind, posts), {
            loading: () => <ChannelLoader label={`Loading ${heading.mark}${heading.name}…`} />,
            failed: () => null,
            empty: () => (
              <div className="channel-browser-empty">
                <strong>
                  {heading.mark}
                  {heading.name}
                </strong>
                <span>No posts yet. Say hello, or @mention a Buddy to ask it something.</span>
              </div>
            ),
            posts: () => (
              <>
                <ChannelHistory
                  edge={feed.edge}
                  scrollRef={follow.scrollRef}
                  onReach={() => void feed.loadOlder(follow.hold)}
                />
                <ol className="channel-browser-messages">
                  {rows.map((row) => renderRow(row, channelContext))}
                </ol>
              </>
            ),
          })}
        </div>
        <ChannelComposer
          channelId={channelId}
          rootId={null}
          placeholder={`Message ${heading.mark}${heading.name}`}
          references={directory.references}
          submit="enter"
          onPosted={(result) => {
            follow.pin();
            void feed.latest.refetch();
            // Mentioning a Buddy opens the thread its reply will land in.
            if (result.mentions.some((mention) => mention.status === 'started'))
              onThread(result.post.id);
          }}
        />
      </section>
      {threadId && (
        <ThreadPane
          key={threadId}
          entry={entry}
          heading={heading}
          rootId={threadId}
          context={threadContext}
          replying={respondingByRoot.get(threadId)}
          onClose={() => onThread(null)}
        />
      )}
    </div>
  );
}

// A DM inside the channels view: the ordinary chat, beside the rail, the way
// Slack opens a DM. Mounted only once the client holds the conversation — the
// DM may be created by the click that opened it, and Chat bounces to '/' when
// it cannot find its conversation (AGENTS.md: availability-check every
// "open this conversation" affordance).
function DmPane({ conversationId, available }: { conversationId: string; available: boolean }) {
  return (
    <section className="channel-browser-dm" aria-label="Direct message">
      {available ? <Chat id={conversationId} /> : <ChannelLoader label="Opening DM…" />}
    </section>
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
  const workspaces = useBuddyOverview().data ?? [];
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
              <li key={workspace.id}>
                <Link
                  role="menuitem"
                  to={`/buddies/workspaces/${encodeURIComponent(workspace.id)}/channels`}
                  aria-current={workspace.id === workspaceId ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span className="channel-browser-workspace-mark" aria-hidden="true">
                    {initials(workspace.name).slice(0, 1)}
                  </span>
                  {workspace.name}
                  {workspace.id === workspaceId && (
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
  onCreated(channelId: string): void;
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
          .then((channel) => onCreated(channel.id))
          .catch((cause: unknown) => setProblem(errorText(cause)))
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

// The red count is only what waits on the owner: requests in a DM.
function RequestsBadge({ count }: { count: number }) {
  return count === 0 ? null : (
    <span className="channel-browser-badge" aria-label={`${count} requests waiting on you`}>
      {count}
    </span>
  );
}

function RailChannel({
  entry,
  heading,
  requests,
  current,
  onSelect,
}: {
  entry: ChannelUnread;
  heading: ChannelHeading;
  requests: number;
  current: boolean;
  onSelect(): void;
}) {
  return (
    <li>
      <button
        type="button"
        data-unread={channelUnreadAttr(entry.unread)}
        aria-current={current ? 'page' : undefined}
        onClick={onSelect}
        title={heading.about}
      >
        <span className="channel-browser-hash" aria-hidden="true">
          {heading.mark}
        </span>
        <span className="channel-browser-channel-name">{heading.name}</span>
        <RequestsBadge count={requests} />
      </button>
    </li>
  );
}

// Full-screen Slack layout. Mounted OUTSIDE the app shell (see App.tsx): the
// channel rail replaces the conversations sidebar instead of nesting beside
// it. Selection lives in the URL (?channel=, ?thread=, ?post=, ?dm=) so
// reload and Back keep the reader where they were, and any of it can be shared
// as a permalink (channel-link.ts). Selecting anything drops `post`: the
// highlight belongs to the link that was opened, not to later navigation.
// `?channel=` names a public channel or a DM channel; `?dm=` is the owner's
// ongoing chat with a Buddy (a conversation, not a channel).
export function ChannelBrowser({
  workspaceId,
  directory,
  availableConversationIds,
}: {
  workspaceId: string;
  directory: WorkspaceDirectory;
  availableConversationIds: ReadonlySet<string>;
}) {
  const inbox = useWorkspaceInbox(workspaceId);
  const rail = useMemo(() => railChannels(inbox.data), [inbox.data]);
  useWarmChannelPosts(rail.channels);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const listed = [...rail.channels, ...rail.direct];
  const selected =
    listed.find((entry) => entry.channel.id === params.get('channel')) ?? rail.channels[0] ?? null;
  const select = (next: { channel: string; thread: string | null }) =>
    setParams({ channel: next.channel, ...(next.thread ? { thread: next.thread } : {}) });
  // An open DM replaces the channel in the main pane; picking a channel closes it.
  const dm = params.get('dm');
  const openDm: OpenDm = (conversationId) => setParams({ dm: conversationId });
  const dmConversation = useAtomValue(conversationAtomFamily(dm ?? ''));
  const dmBuddyId = rowBuddy(dmConversation)?.buddyId;
  const railRow = (entry: ChannelUnread) => (
    <RailChannel
      key={entry.channel.id}
      entry={entry}
      heading={channelHeading(entry.channel.kind, directory.buddyNames)}
      requests={channelRequestCount(inbox.data, entry.channel.id)}
      current={!dm && selected?.channel.id === entry.channel.id}
      onSelect={() => select({ channel: entry.channel.id, thread: null })}
    />
  );
  return (
    <div className="channel-browser" aria-label="Channels">
      <nav className="channel-browser-rail">
        <header className="channel-browser-rail-header">
          <Link className="channel-browser-exit" to="/" title="Back to conversations">
            ← Conversations
          </Link>
          <WorkspaceSwitcher workspaceId={workspaceId} workspaceName={directory.workspaceName} />
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
              onCreated={(channelId) => {
                setCreating(false);
                void inbox.refetch();
                select({ channel: channelId, thread: null });
              }}
            />
          )}
          {(inbox.kind === 'failed' || inbox.kind === 'stale') && (
            <p role="alert">Channels could not refresh: {inbox.error.message}</p>
          )}
          {inbox.data && rail.channels.length === 0 ? (
            <p className="channel-browser-rail-empty">No channels yet.</p>
          ) : (
            <ul className="channel-browser-channels">{rail.channels.map(railRow)}</ul>
          )}
          {rail.direct.length > 0 && (
            <>
              <h3 className="channel-browser-rail-section">Direct messages</h3>
              <ul className="channel-browser-channels">{rail.direct.map(railRow)}</ul>
            </>
          )}
          {directory.activeMembers.length > 0 && (
            <>
              <h3 className="channel-browser-rail-section">Buddies</h3>
              <ul className="channel-browser-buddies">
                {directory.activeMembers.map((member) => (
                  <BuddyRailRow
                    key={member.id}
                    member={member}
                    openDm={openDm}
                    current={member.id === dmBuddyId}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </nav>
      <main className="channel-browser-main">
        {dm ? (
          <DmPane conversationId={dm} available={availableConversationIds.has(dm)} />
        ) : selected ? (
          <ChannelPane
            key={selected.channel.id}
            entry={selected}
            workspaceId={workspaceId}
            directory={directory}
            availableConversationIds={availableConversationIds}
            threadId={params.get('thread')}
            linkedPostId={params.get('post')}
            onThread={(thread) => select({ channel: selected.channel.id, thread })}
            openDm={openDm}
          />
        ) : (
          <div className="channel-browser-empty">
            <strong>{inbox.data ? 'No channels yet' : 'Loading channels…'}</strong>
            {inbox.data && (
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
  const availableConversationIds = useAtomValue(availableConversationIdSetAtom);
  const directory = useWorkspaceDirectory(workspaceId);
  return (
    <ChannelBrowser
      workspaceId={workspaceId}
      directory={directory}
      availableConversationIds={availableConversationIds}
    />
  );
}
