import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { BuddySigil } from '../../components/buddies/BuddySigil';
import { ChannelAuthor, useChatPageDm } from '../../components/buddies/ChannelAuthor';
import { ChannelComposer } from '../../components/buddies/ChannelComposer';
import { ChannelHistory, ChannelLoader } from '../../components/buddies/ChannelLoader';
import { ChannelMarkdown, TypingDots } from '../../components/buddies/ChannelMarkdown';
import { CopyLinkButton } from '../../components/buddies/CopyLinkButton';
import { WakeIcon, WakeIndicator } from '../../components/buddies/WakeIndicator';
import { errorText } from '../../components/buddies/api';
import { useBuddyDirectActions } from '../../components/buddies/buddy-direct-actions';
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
} from '../../components/buddies/channel-data';
import { channelLinkPath } from '../../components/buddies/channel-link';
import type { Buddy, ChannelUnread, Inbox, Post } from '../../components/buddies/types';
import { useBuddyOverview } from '../../hooks/useBuddyData';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import {
  MobileEmptyPanel,
  MobileHeaderAction,
  MobilePage,
  MobileSection,
} from '../components/MobileUI';
import { buddyWorkspaceActivityAtom, overviewWorkspaces } from './ChannelsIndex';
import { type MobileChannelScreen, channelsHref, mobileChannelScreen } from './channel-route';

// Channels on a phone, following Slack's mobile app: one screen at a time.
//   Home    — channels, DMs and Buddies, tab bar visible
//   Channel — full-height transcript, composer pinned, no tab bar
//   Thread  — the root, its replies, a reply composer
// Same URL as desktop (/buddies/workspaces/:id/channels?channel=&thread=), so
// a link opens the right place on either device. `channel` names a public
// channel or a DM channel. Desktop hover affordances become visible taps here
// (docs/mobile-ui.md: hover needs a touch counterpart).

export function ChannelsMobile() {
  const { workspaceId = '' } = useParams();
  const location = useLocation();
  const screen = mobileChannelScreen(location.search);
  const directory = useWorkspaceDirectory(workspaceId);
  const inbox = useWorkspaceInbox(workspaceId);
  const rail = useMemo(() => railChannels(inbox.data), [inbox.data]);
  useWarmChannelPosts(rail.channels);
  return renderScreen(screen, {
    workspaceId,
    directory,
    inbox: inbox.data,
    listed: [...rail.channels, ...rail.direct],
    refetchInbox: inbox.refetch,
  });
}

type ScreenContext = {
  workspaceId: string;
  directory: WorkspaceDirectory;
  inbox: Inbox | null;
  /** Public channels, then DMs: what Home lists and a channel screen can open. */
  listed: readonly ChannelUnread[];
  refetchInbox(): Promise<void>;
};

function renderScreen(screen: MobileChannelScreen, context: ScreenContext) {
  switch (screen.kind) {
    case 'home':
      return <ChannelsHome context={context} />;
    case 'channel':
      return (
        <ChannelScreen key={screen.channelId} channelId={screen.channelId} context={context} />
      );
    case 'thread':
      return (
        <ThreadScreen
          key={screen.rootId}
          channelId={screen.channelId}
          rootId={screen.rootId}
          linkedPostId={screen.linkedPostId}
          context={context}
        />
      );
  }
}

/** The screen's channel as the inbox lists it; a channel the inbox has not listed yet reads as unknown. */
function listedEntry(context: ScreenContext, channelId: string): ChannelUnread | null {
  return context.listed.find((entry) => entry.channel.id === channelId) ?? null;
}

const LOADING_HEADING: ChannelHeading = { mark: '#', name: 'channel', about: '' };

// ── Home ────────────────────────────────────────────────────────────────────

function ChannelsHome({ context }: { context: ScreenContext }) {
  const overview = useBuddyOverview();
  const workspaces = overviewWorkspaces(overview.data, useAtomValue(buddyWorkspaceActivityAtom));
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);
  const { workspaceId, directory, inbox } = context;
  const rail = railChannels(inbox);
  const row = (entry: ChannelUnread) => {
    const heading = channelHeading(entry.channel.kind, directory.buddyNames);
    const requests = channelRequestCount(inbox, entry.channel.id);
    return (
      <li key={entry.channel.id}>
        <Link
          className="mobile-channels-row"
          data-unread={channelUnreadAttr(entry.unread)}
          to={channelsHref(workspaceId, { kind: 'channel', channelId: entry.channel.id })}
        >
          <span className="mobile-channels-row__hash" aria-hidden="true">
            {heading.mark}
          </span>
          <span className="mobile-channels-row__name">{heading.name}</span>
          {requests > 0 && (
            <span
              className="mobile-channels-row__badge"
              aria-label={`${requests} requests waiting on you`}
            >
              {requests}
            </span>
          )}
        </Link>
      </li>
    );
  };
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
          {rail.channels.map(row)}
          <li>
            {creating ? (
              <NewChannelForm
                workspaceId={workspaceId}
                onCancel={() => setCreating(false)}
                onCreated={() => {
                  setCreating(false);
                  void context.refetchInbox();
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
        {inbox === null && <MobileEmptyPanel>Loading channels…</MobileEmptyPanel>}
      </MobileSection>
      {rail.direct.length > 0 && (
        <MobileSection title="Direct messages">
          <ul className="mobile-channels-list">{rail.direct.map(row)}</ul>
        </MobileSection>
      )}
      <MobileSection title="Buddies" meta="Tap to message · ☀ to wake">
        <ul className="mobile-channels-list">
          {directory.activeMembers.map((member) => (
            <BuddyRow key={member.id} member={member} />
          ))}
        </ul>
      </MobileSection>
    </MobilePage>
  );
}

// Slack's DM row: tapping the Buddy opens the conversation (its one ongoing
// DM, history kept). Wake is a visible button, since touch has no hover.
function BuddyRow({ member }: { member: Buddy }) {
  // Back from the DM returns here, not to the Buddies tab.
  const openDm = useChatPageDm();
  const location = useLocation();
  const direct = useBuddyDirectActions(member.id);
  const { action } = direct;
  return (
    <li className="mobile-channels-buddy" data-failed={action.kind === 'failed' || undefined}>
      <button
        type="button"
        className="mobile-channels-row"
        disabled={action.kind === 'pending'}
        onClick={() => direct.openDm(openDm)}
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
          linkState={mobileConversationRouteState(location)}
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
          .catch((cause: unknown) => setProblem(errorText(cause)))
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

// Where a row sits: in the channel (tap Thread to open its thread, see who is
// replying) or inside the thread already. D = Channel ⊕ Thread.
type RowPlace =
  | {
      kind: 'channel';
      threadHref(rootId: string): string;
      responding: ReadonlyMap<string, string>;
    }
  | { kind: 'thread' };

type RowContext = {
  directory: WorkspaceDirectory;
  place: RowPlace;
  // The reply a permalink named (`?post=`); its row is highlighted.
  linkedPostId: string | null;
};

function PostPurpose({ post }: { post: Post }) {
  const label = postPurposeLabel(post);
  return label === null ? null : (
    <span className="mobile-channel-post__purpose" data-purpose={postPurposeTag(post)}>
      {label}
    </span>
  );
}

// Posts carry no reply count (the API has none): every root offers its thread.
function PostFooter({ post, context }: { post: Post; context: RowContext }) {
  switch (context.place.kind) {
    case 'thread':
      return null;
    case 'channel': {
      const place = context.place;
      const replying = place.responding.get(post.id);
      return (
        <div className="mobile-channel-post__footer">
          <Link
            className="mobile-channel-post__reply"
            to={place.threadHref(post.rootId ?? post.id)}
          >
            Thread
          </Link>
          {replying !== undefined && (
            <span className="mobile-channel-post__replying">
              <TypingDots /> {replying}
            </span>
          )}
        </div>
      );
    }
  }
}

function Row({ row, context }: { row: ChannelRow; context: RowContext }) {
  const openDm = useChatPageDm();
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
          data-post-id={row.post.id}
          data-linked={row.post.id === context.linkedPostId ? 'true' : undefined}
        >
          <BuddySigil
            className="mobile-channel-post__avatar"
            name={authorName(row.post.author, context.directory.buddyNames)}
          />
          <div className="mobile-channel-post__content">
            <div className="mobile-channel-post__heading">
              <ChannelAuthor
                className="mobile-channel-post__author"
                author={row.post.author}
                buddyNames={context.directory.buddyNames}
                openDm={openDm}
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
          data-post-id={row.post.id}
          data-linked={row.post.id === context.linkedPostId ? 'true' : undefined}
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
  link,
}: {
  backTo: string;
  title: string;
  subtitle: string;
  link: { path: string; label: string };
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
      <CopyLinkButton className="mobile-channel-header__link" path={link.path} label={link.label} />
    </header>
  );
}

// ── Channel ─────────────────────────────────────────────────────────────────

function ChannelScreen({ channelId, context }: { channelId: string; context: ScreenContext }) {
  const { workspaceId, directory } = context;
  const entry = listedEntry(context, channelId);
  const heading = entry
    ? channelHeading(entry.channel.kind, directory.buddyNames)
    : LOADING_HEADING;
  const feed = useChannelFeed(channelFeed(channelId));
  const responding = useChannelResponding(channelId, directory.buddyNames);
  const posts = useWithOutbox(channelId, null, feed.posts);
  const rows = useMemo(() => channelRows(posts ?? []), [posts]);
  const follow = useFollowBottom(rows.length, posts, null);
  useMarkChannelRead(channelId, entry?.unread, newestServedId(feed.posts));
  const rowContext: RowContext = {
    directory,
    place: {
      kind: 'channel',
      threadHref: (rootId) =>
        channelsHref(workspaceId, { kind: 'thread', channelId, rootId, linkedPostId: null }),
      responding,
    },
    linkedPostId: null,
  };
  const title = `${heading.mark} ${heading.name}`;
  return (
    <div className="mobile-channel">
      <ScreenHeader
        backTo={channelsHref(workspaceId, { kind: 'home' })}
        title={title}
        subtitle={heading.about}
        link={{
          path: channelLinkPath(workspaceId, { kind: 'channel', channelId }),
          label: 'Copy link to channel',
        }}
      />
      <div className="mobile-channel__scroll" ref={follow.scrollRef} onScroll={follow.onScroll}>
        {(feed.latest.kind === 'failed' || feed.latest.kind === 'stale') && (
          <p className="mobile-channel__error" role="alert">
            Posts could not refresh: {feed.latest.error.message}
          </p>
        )}
        {renderFeed(feedPhase(feed.latest.kind, posts), {
          loading: () => <ChannelLoader label={`Loading ${title}…`} />,
          failed: () => null,
          empty: () => (
            <MobileEmptyPanel>No posts yet. @mention a Buddy to ask it something.</MobileEmptyPanel>
          ),
          posts: () => (
            <>
              <ChannelHistory
                edge={feed.edge}
                scrollRef={follow.scrollRef}
                onReach={() => void feed.loadOlder(follow.hold)}
              />
              <ol className="mobile-channel__posts">
                {rows.map((row) => (
                  <Row key={row.key} row={row} context={rowContext} />
                ))}
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
        submit="button"
        onPosted={() => {
          follow.pin();
          void feed.latest.refetch();
        }}
      />
    </div>
  );
}

// ── Thread ──────────────────────────────────────────────────────────────────

function ThreadScreen({
  channelId,
  rootId,
  linkedPostId,
  context,
}: {
  channelId: string;
  rootId: string;
  linkedPostId: string | null;
  context: ScreenContext;
}) {
  const { workspaceId, directory } = context;
  const entry = listedEntry(context, channelId);
  const heading = entry
    ? channelHeading(entry.channel.kind, directory.buddyNames)
    : LOADING_HEADING;
  const thread = useChannelFeed(threadFeed(rootId));
  const root = thread.latest.data?.root;
  const replying = useChannelResponding(channelId, directory.buddyNames).get(rootId);
  const replies = useWithOutbox(channelId, rootId, thread.posts);
  const replyRows = useMemo(() => channelRows(replies ?? []), [replies]);
  const follow = useFollowBottom(
    replyRows.length + (replying === undefined ? 0 : 1),
    thread.posts,
    linkedPostId
  );
  useMarkChannelRead(channelId, entry?.unread, newestServedId(thread.posts) ?? root?.id ?? null);
  const rowContext: RowContext = { directory, place: { kind: 'thread' }, linkedPostId };
  return (
    <div className="mobile-channel">
      <ScreenHeader
        backTo={channelsHref(workspaceId, { kind: 'channel', channelId })}
        title="Thread"
        subtitle={`${heading.mark} ${heading.name}`}
        link={{
          path: channelLinkPath(workspaceId, { kind: 'thread', channelId, rootId }),
          label: 'Copy link to thread',
        }}
      />
      <div className="mobile-channel__scroll" ref={follow.scrollRef} onScroll={follow.onScroll}>
        {(thread.latest.kind === 'failed' || thread.latest.kind === 'stale') && (
          <p className="mobile-channel__error" role="alert">
            Thread could not refresh: {thread.latest.error.message}
          </p>
        )}
        {thread.latest.kind === 'loading' && <ChannelLoader label="Loading thread…" />}
        {root && (
          <ol className="mobile-channel__posts">
            <Row row={{ kind: 'lead', key: root.id, post: root }} context={rowContext} />
          </ol>
        )}
        {root && <div className="mobile-channel-divider">Replies</div>}
        {root && (
          <ChannelHistory
            edge={thread.edge}
            scrollRef={follow.scrollRef}
            onReach={() => void thread.loadOlder(follow.hold)}
          />
        )}
        <ol className="mobile-channel__posts">
          {replyRows.map((row) => (
            <Row key={row.key} row={row} context={rowContext} />
          ))}
        </ol>
        {replying !== undefined && (
          <p className="mobile-channel__replying">
            <TypingDots /> {replying}
          </p>
        )}
      </div>
      <ChannelComposer
        channelId={channelId}
        rootId={rootId}
        placeholder="Reply…"
        references={directory.references}
        submit="button"
        onPosted={() => {
          follow.pin();
          void thread.latest.refetch();
        }}
      />
    </div>
  );
}
