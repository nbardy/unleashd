import type { BuddyMailingListPost, BuddyOwnerPostResult } from '@unleashd/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { BuddyMailingListSummary } from '../../components/buddies/BuddyMessages';
import { BuddySigil } from '../../components/buddies/BuddySigil';
import { ChannelAuthor } from '../../components/buddies/ChannelAuthor';
import { ChannelComposer } from '../../components/buddies/ChannelComposer';
import { ChannelMarkdown, TypingDots } from '../../components/buddies/ChannelMarkdown';
import { WakeIcon, WakeIndicator } from '../../components/buddies/WakeIndicator';
import { useBuddyDirectActions } from '../../components/buddies/buddy-direct-actions';
import {
  type ChannelMember,
  type ChannelRow,
  type WorkspaceDirectory,
  channelPostsResource,
  channelRows,
  channelThreadResource,
  clockTime,
  createChannel,
  joinNames,
  listsUrl,
  postPurposeLabel,
  postPurposeTag,
  useChannelResponding,
  useFollowBottom,
  useWorkspaceDirectory,
} from '../../components/buddies/channel-data';
import type { BuddyOverview } from '../../components/buddies/types';
import { useBuddyOverview } from '../../hooks/useBuddyData';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import {
  MobileEmptyPanel,
  MobileHeaderAction,
  MobilePage,
  MobileSection,
} from '../components/MobileUI';
import { type MobileChannelScreen, channelsHref, mobileChannelScreen } from './channel-route';

// Channels on a phone, following Slack's mobile app: one screen at a time.
//   Home    — channel list + Buddies (Slack's DMs), tab bar visible
//   Channel — full-height transcript, composer pinned, no tab bar
//   Thread  — the root, its replies, a reply composer
// Same URL as desktop (/buddies/workspaces/:id/channels?channel=&thread=), so
// a link opens the right place on either device. Desktop hover affordances
// become visible taps here (docs/mobile-ui.md: hover needs a touch counterpart).

type OverviewWorkspace = { id: string; name: string; lastActiveAt: string };

// Most recently active workspace first (by its Buddies' latest runs), then by
// name: the Channels tab opens where the team is working, not whichever
// workspace sorts first alphabetically (that was often an empty one).
export function overviewWorkspaces(overview: BuddyOverview | null): OverviewWorkspace[] {
  const lastActive = new Map<string, string>();
  for (const run of overview?.recentRuns ?? []) {
    const seen = lastActive.get(run.workspaceId);
    if (seen === undefined || run.lastActiveAt > seen)
      lastActive.set(run.workspaceId, run.lastActiveAt);
  }
  const byId = new Map<string, OverviewWorkspace>();
  for (const employee of overview?.employees ?? [])
    for (const workspace of employee.workspaces)
      byId.set(workspace.id, {
        id: workspace.id,
        name: workspace.name,
        lastActiveAt: lastActive.get(workspace.id) ?? '',
      });
  return [...byId.values()].sort(
    (a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt) || a.name.localeCompare(b.name)
  );
}

/** /channels — the tab's entry: open the first workspace's channels. */
export function ChannelsIndex() {
  const overview = useBuddyOverview();
  const [first] = overviewWorkspaces(overview.data);
  if (first) return <Navigate to={channelsHref(first.id, { kind: 'home' })} replace />;
  return (
    <MobilePage title="Channels" subtitle={overview.data ? 'No workspaces' : 'Loading…'}>
      {overview.data && (
        <MobileEmptyPanel>Create a Buddy in a workspace to start its channels.</MobileEmptyPanel>
      )}
    </MobilePage>
  );
}

export function ChannelsMobile() {
  const { workspaceId = '' } = useParams();
  const location = useLocation();
  const screen = mobileChannelScreen(location.search);
  const directory = useWorkspaceDirectory(workspaceId);
  const lists = usePolledFetch<BuddyMailingListSummary[]>(listsUrl(workspaceId), 5000);
  return renderScreen(screen, {
    workspaceId,
    directory,
    lists: lists.data ?? null,
    refetchLists: lists.refetch,
  });
}

type ScreenContext = {
  workspaceId: string;
  directory: WorkspaceDirectory;
  lists: readonly BuddyMailingListSummary[] | null;
  refetchLists(): Promise<void>;
};

function renderScreen(screen: MobileChannelScreen, context: ScreenContext) {
  switch (screen.kind) {
    case 'home':
      return <ChannelsHome context={context} />;
    case 'channel':
      return <ChannelScreen key={screen.listId} listId={screen.listId} context={context} />;
    case 'thread':
      return (
        <ThreadScreen
          key={screen.rootId}
          listId={screen.listId}
          rootId={screen.rootId}
          context={context}
        />
      );
  }
}

// ── Home ────────────────────────────────────────────────────────────────────

function ChannelsHome({ context }: { context: ScreenContext }) {
  const overview = useBuddyOverview();
  const workspaces = overviewWorkspaces(overview.data);
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);
  const { workspaceId, directory, lists } = context;
  return (
    <MobilePage
      title={directory.workspaceName}
      subtitle="Channels and Buddies"
      headerAside={
        workspaces.length > 1 ? (
          <MobileHeaderAction
            aria-expanded={switching}
            onClick={() => setSwitching((value) => !value)}
          >
            Switch
          </MobileHeaderAction>
        ) : null
      }
    >
      {switching && (
        <ul className="mobile-channels-list mobile-channels-workspaces">
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link
                className="mobile-channels-row"
                to={channelsHref(workspace.id, { kind: 'home' })}
                replace
                aria-current={workspace.id === workspaceId ? 'page' : undefined}
                onClick={() => setSwitching(false)}
              >
                <span className="mobile-channels-row__mark" aria-hidden="true">
                  {workspace.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="mobile-channels-row__name">{workspace.name}</span>
                {workspace.id === workspaceId && <span aria-hidden="true">✓</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <MobileSection title="Channels">
        <ul className="mobile-channels-list">
          {(lists ?? []).map((list) => (
            <li key={list.id}>
              <Link
                className="mobile-channels-row"
                to={channelsHref(workspaceId, { kind: 'channel', listId: list.id })}
              >
                <span className="mobile-channels-row__hash" aria-hidden="true">
                  #
                </span>
                <span className="mobile-channels-row__name">{list.name}</span>
                <span className="mobile-channels-row__meta">{list.postCount}</span>
              </Link>
            </li>
          ))}
          <li>
            {creating ? (
              <NewChannelForm
                workspaceId={workspaceId}
                onCancel={() => setCreating(false)}
                onCreated={() => {
                  setCreating(false);
                  void context.refetchLists();
                }}
              />
            ) : (
              <button
                type="button"
                className="mobile-channels-row mobile-channels-row--add"
                onClick={() => setCreating(true)}
              >
                <span className="mobile-channels-row__hash" aria-hidden="true">
                  +
                </span>
                <span className="mobile-channels-row__name">Add channel</span>
              </button>
            )}
          </li>
        </ul>
        {lists === null && <MobileEmptyPanel>Loading channels…</MobileEmptyPanel>}
      </MobileSection>
      <MobileSection title="Buddies" meta="Tap to message · ☀ to wake">
        <ul className="mobile-channels-list">
          {directory.activeMembers.map((member) => (
            <BuddyRow key={member.id} member={member} workspaceId={workspaceId} />
          ))}
        </ul>
      </MobileSection>
    </MobilePage>
  );
}

// Slack's DM row: tapping the Buddy opens the conversation (its one ongoing
// DM, history kept). Wake is a visible button, since touch has no hover.
function BuddyRow({ member, workspaceId }: { member: ChannelMember; workspaceId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const direct = useBuddyDirectActions(member.id, workspaceId);
  const { action } = direct;
  // Back from the DM returns here, not to the Buddies tab.
  const origin = mobileConversationRouteState(location);
  return (
    <li className="mobile-channels-buddy" data-failed={action.kind === 'failed' || undefined}>
      <button
        type="button"
        className="mobile-channels-row"
        disabled={action.kind === 'pending'}
        onClick={() =>
          direct.openDm((conversationId) =>
            navigate(`/chat/${encodeURIComponent(conversationId)}`, { state: origin })
          )
        }
      >
        <BuddySigil className="mobile-channels-row__sigil" name={member.name} />
        <span className="mobile-channels-row__stack">
          <span className="mobile-channels-row__name">{member.name}</span>
          <span className="mobile-channels-row__detail">
            {action.kind === 'failed' ? action.message : member.role}
          </span>
        </span>
      </button>
      {direct.woken && (
        <WakeIndicator
          key={direct.woken.attempt}
          conversationId={direct.woken.conversationId}
          name={member.name}
          className="mobile-channels-wake-status"
          doneClassName="mobile-channels-wake-done"
          linkState={origin}
        />
      )}
      <button
        type="button"
        className="mobile-channels-wake"
        aria-label={`Wake ${member.name}: catch up on the channels and act`}
        disabled={action.kind === 'pending'}
        onClick={direct.wake}
      >
        <WakeIcon />
      </button>
    </li>
  );
}

function NewChannelForm({
  workspaceId,
  onCreated,
  onCancel,
}: {
  workspaceId: string;
  onCreated(): void;
  onCancel(): void;
}) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cleanName = name.trim().replace(/^#/, '');
  return (
    <form
      className="mobile-channels-new"
      onSubmit={(event) => {
        event.preventDefault();
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
      <input
        value={name}
        maxLength={80}
        placeholder="# channel-name"
        aria-label="Channel name"
        onChange={(event) => setName(event.target.value)}
      />
      <input
        value={purpose}
        maxLength={400}
        placeholder="What is it for?"
        aria-label="Channel purpose"
        onChange={(event) => setPurpose(event.target.value)}
      />
      {problem && (
        <p className="mobile-channels-new__problem" role="alert">
          {problem}
        </p>
      )}
      <div className="mobile-channels-new__actions">
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

// ── Transcript rows ─────────────────────────────────────────────────────────

// Where a row sits: in the channel (tap "N replies"/Reply to open its thread,
// see who is replying) or inside the thread already. D = Channel ⊕ Thread.
type RowPlace =
  | {
      kind: 'channel';
      threadHref(rootId: string): string;
      responding: ReadonlyMap<string, readonly string[]>;
    }
  | { kind: 'thread' };

type RowContext = { workspaceId: string; directory: WorkspaceDirectory; place: RowPlace };

function PostPurpose({ post }: { post: BuddyMailingListPost }) {
  const label = postPurposeLabel(post);
  return label === null ? null : (
    <span className="mobile-channel-post__purpose" data-purpose={postPurposeTag(post)}>
      {label}
    </span>
  );
}

function PostFooter({ post, context }: { post: BuddyMailingListPost; context: RowContext }) {
  switch (context.place.kind) {
    case 'thread':
      return null;
    case 'channel': {
      const place = context.place;
      const replying = (place.responding.get(post.id) ?? []).map(
        (buddyId) => context.directory.buddyNames[buddyId] ?? buddyId
      );
      const rootId = post.threadRootId ?? post.id;
      return (
        <div className="mobile-channel-post__footer">
          {post.replyCount > 0 ? (
            <Link className="mobile-channel-post__replies" to={place.threadHref(rootId)}>
              {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
              {post.latestReplyAt && <span> · {clockTime(post.latestReplyAt)}</span>}
            </Link>
          ) : (
            <Link className="mobile-channel-post__reply" to={place.threadHref(rootId)}>
              Reply
            </Link>
          )}
          {replying.length > 0 && (
            <span className="mobile-channel-post__replying">
              <TypingDots /> {joinNames(replying)} {replying.length === 1 ? 'is' : 'are'} replying…
            </span>
          )}
        </div>
      );
    }
  }
}

function authorName(post: BuddyMailingListPost, directory: WorkspaceDirectory): string {
  switch (post.author.kind) {
    case 'owner':
      return 'You';
    case 'buddy':
      return directory.buddyNames[post.author.buddyId] ?? post.author.buddyId;
  }
}

function Row({ row, context }: { row: ChannelRow; context: RowContext }) {
  switch (row.kind) {
    case 'day':
      return (
        <li className="mobile-channel-day">
          <span>{row.label}</span>
        </li>
      );
    case 'lead':
      return (
        <li
          className="mobile-channel-post mobile-channel-post--lead"
          data-purpose={postPurposeTag(row.post)}
        >
          <BuddySigil
            className="mobile-channel-post__avatar"
            name={authorName(row.post, context.directory)}
          />
          <div className="mobile-channel-post__content">
            <div className="mobile-channel-post__heading">
              <ChannelAuthor
                className="mobile-channel-post__author"
                author={row.post.author}
                buddyNames={context.directory.buddyNames}
                workspaceId={context.workspaceId}
              />
              <time dateTime={row.post.createdAt}>{clockTime(row.post.createdAt)}</time>
              <PostPurpose post={row.post} />
            </div>
            <ChannelMarkdown
              body={row.post.body}
              buddyNames={context.directory.buddyNames}
              tasks={context.directory.taskById}
            />
            <PostFooter post={row.post} context={context} />
          </div>
        </li>
      );
    case 'continuation':
      return (
        <li
          className="mobile-channel-post mobile-channel-post--continuation"
          data-purpose={postPurposeTag(row.post)}
        >
          <div className="mobile-channel-post__content">
            <PostPurpose post={row.post} />
            <ChannelMarkdown
              body={row.post.body}
              buddyNames={context.directory.buddyNames}
              tasks={context.directory.taskById}
            />
            <PostFooter post={row.post} context={context} />
          </div>
        </li>
      );
  }
}

function ScreenHeader({
  backTo,
  title,
  subtitle,
}: {
  backTo: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="mobile-channel-header">
      <Link className="mobile-channel-header__back" to={backTo} aria-label="Back">
        ‹
      </Link>
      <div className="mobile-channel-header__heading">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </header>
  );
}

// ── Channel ─────────────────────────────────────────────────────────────────

function ChannelScreen({ listId, context }: { listId: string; context: ScreenContext }) {
  const { workspaceId, directory, lists } = context;
  const list = lists?.find((candidate) => candidate.id === listId) ?? null;
  const feed = usePolledFetch(channelPostsResource(listId), 5000);
  const responding = useChannelResponding(listId);
  const rows = useMemo(() => channelRows(feed.data ?? []), [feed.data]);
  const follow = useFollowBottom(rows.length, feed.data);
  useRefetchWhenRepliesLand(responding.count, feed.refetch);
  const rowContext: RowContext = {
    workspaceId,
    directory,
    place: {
      kind: 'channel',
      threadHref: (rootId) => channelsHref(workspaceId, { kind: 'thread', listId, rootId }),
      responding: responding.byRoot,
    },
  };
  // The mailing list's own description — unrelated to the conversation field gate G2 guards.
  const { name, purpose: description } = list ?? { name: 'channel', purpose: '' };
  return (
    <div className="mobile-channel">
      <ScreenHeader
        backTo={channelsHref(workspaceId, { kind: 'home' })}
        title={`# ${name}`}
        subtitle={description}
      />
      <div className="mobile-channel__scroll" ref={follow.scrollRef} onScroll={follow.onScroll}>
        {feed.error && (
          <p className="mobile-channel__error" role="alert">
            Posts could not refresh: {feed.error.message}
          </p>
        )}
        {rows.length === 0 && !feed.loading ? (
          <MobileEmptyPanel>No posts yet. @mention a Buddy to ask it something.</MobileEmptyPanel>
        ) : (
          <ol className="mobile-channel__posts">
            {rows.map((row) => (
              <Row key={row.key} row={row} context={rowContext} />
            ))}
          </ol>
        )}
      </div>
      <ChannelComposer
        listId={listId}
        threadRootId={null}
        placeholder={`Message #${name}`}
        references={directory.references}
        submit="button"
        onPosted={(_result: BuddyOwnerPostResult) => {
          follow.pin();
          void feed.refetch();
          void responding.refetch();
        }}
      />
    </div>
  );
}

// ── Thread ──────────────────────────────────────────────────────────────────

function ThreadScreen({
  listId,
  rootId,
  context,
}: {
  listId: string;
  rootId: string;
  context: ScreenContext;
}) {
  const { workspaceId, directory, lists } = context;
  const list = lists?.find((candidate) => candidate.id === listId) ?? null;
  const thread = usePolledFetch(channelThreadResource(listId, rootId), 3000);
  const responding = useChannelResponding(listId);
  const replying = (responding.byRoot.get(rootId) ?? []).map(
    (buddyId) => directory.buddyNames[buddyId] ?? buddyId
  );
  const replyRows = useMemo(() => channelRows(thread.data?.replies ?? []), [thread.data]);
  const follow = useFollowBottom(replyRows.length + replying.length, thread.data);
  useRefetchWhenRepliesLand(responding.count, thread.refetch);
  const rowContext: RowContext = { workspaceId, directory, place: { kind: 'thread' } };
  const root = thread.data?.root;
  return (
    <div className="mobile-channel">
      <ScreenHeader
        backTo={channelsHref(workspaceId, { kind: 'channel', listId })}
        title="Thread"
        subtitle={`# ${list?.name ?? 'channel'}`}
      />
      <div className="mobile-channel__scroll" ref={follow.scrollRef} onScroll={follow.onScroll}>
        {thread.error && (
          <p className="mobile-channel__error" role="alert">
            Thread could not refresh: {thread.error.message}
          </p>
        )}
        {root && (
          <ol className="mobile-channel__posts">
            <Row row={{ kind: 'lead', key: root.id, post: root }} context={rowContext} />
          </ol>
        )}
        {root && (
          <div className="mobile-channel-divider">
            {root.replyCount} {root.replyCount === 1 ? 'reply' : 'replies'}
          </div>
        )}
        <ol className="mobile-channel__posts">
          {replyRows.map((row) => (
            <Row key={row.key} row={row} context={rowContext} />
          ))}
        </ol>
        {replying.length > 0 && (
          <p className="mobile-channel__replying">
            <TypingDots /> {joinNames(replying)} {replying.length === 1 ? 'is' : 'are'} replying…
          </p>
        )}
      </div>
      <ChannelComposer
        listId={listId}
        threadRootId={rootId}
        placeholder="Reply…"
        references={directory.references}
        submit="button"
        onPosted={() => {
          follow.pin();
          void thread.refetch();
          void responding.refetch();
        }}
      />
    </div>
  );
}

// A mention reply is already written when its responder entry disappears:
// fetch it now rather than on the next poll.
function useRefetchWhenRepliesLand(respondingCount: number, refetch: () => Promise<void>) {
  const previous = useRef(respondingCount);
  useEffect(() => {
    if (respondingCount < previous.current) void refetch();
    previous.current = respondingCount;
  }, [respondingCount, refetch]);
}
