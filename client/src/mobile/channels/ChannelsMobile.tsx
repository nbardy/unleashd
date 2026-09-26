import {
  type BuddyMailingListPost,
  type BuddyOwnerPostResult,
  type OwnerListUnread,
  getBuddyId,
  isBuddyBuilderConversation,
} from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { buddyBuilderConversationsAtom } from '../../atoms/buddy-sidebar';
import { availableConversationIdSetAtom, conversationAtomFamily } from '../../atoms/conversations';
import { BuddySigil } from '../../components/buddies/BuddySigil';
import { ChannelAuthor, type OpenDm } from '../../components/buddies/ChannelAuthor';
import { ChannelDm } from '../../components/buddies/ChannelDm';
import { ChannelHistory, ChannelLoader } from '../../components/buddies/ChannelLoader';
import { ChannelMarkdown, TypingDots } from '../../components/buddies/ChannelMarkdown';
import { ConversationEye } from '../../components/buddies/ConversationEye';
import { CopyLinkButton } from '../../components/buddies/CopyLinkButton';
import { OutOfTokensChannelRetry } from '../../components/buddies/HarnessRetry';
import { latestActiveBuddyBuilder } from '../../components/buddies/channel-buddy-builder';
import { setConversationDone } from '../../atoms/actions';
import { WakeIcon, WakeIndicator } from '../../components/buddies/WakeIndicator';
import {
  useBuddyDirectActions,
  useChannelNewBuddy,
} from '../../components/buddies/buddy-direct-actions';
import {
  type BuddyMailingListSummary,
  CHANNEL_BACKSTOP_MS,
  type ChannelMember,
  type ChannelRow,
  type WorkspaceDirectory,
  arrivalMarks,
  authorName,
  channelPostFeed,
  channelRows,
  channelUnreadAttr,
  clockTime,
  createChannel,
  feedPhase,
  listsUrl,
  ownerUnreadByList,
  postPurposeLabel,
  postPurposeTag,
  renderFeed,
  threadPostFeed,
  useChannelFeed,
  useChannelResponding,
  useFollowBottom,
  useOwnerChannelVisit,
  useOwnerUnread,
  useWarmChannelPosts,
  useWithOutbox,
  useWorkspaceDirectory,
} from '../../components/buddies/channel-data';
import { channelLinkPath } from '../../components/buddies/channel-link';
import { useBuddyOverview } from '../../hooks/useBuddyData';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import {
  MobileEmptyPanel,
  MobileHeaderAction,
  MobilePage,
  MobileSection,
} from '../components/MobileUI';
import { ChannelComposerMobile, MobileChannelComposeFrame } from './ChannelComposerMobile';
import { overviewWorkspaces } from './ChannelsIndex';
import { type MobileChannelScreen, channelsHref, mobileChannelScreen } from './channel-route';

// Channels on a phone, following Slack's mobile app: one screen at a time.
//   Home    — channel list + Buddies (Slack's DMs), tab bar visible
//   Channel — full-height transcript, composer pinned, no tab bar
//   Thread  — the root, its replies, a reply composer
// Same URL as desktop (/buddies/workspaces/:id/channels?channel=&thread=), so
// a link opens the right place on either device. Desktop hover affordances
// become visible taps here (docs/mobile-ui.md: hover needs a touch counterpart).

export function ChannelsMobile() {
  const { workspaceId = '' } = useParams();
  const location = useLocation();
  const screen = mobileChannelScreen(location.search);
  const directory = useWorkspaceDirectory(workspaceId);
  const lists = usePolledFetch<BuddyMailingListSummary[]>(
    listsUrl(workspaceId),
    CHANNEL_BACKSTOP_MS
  );
  useWarmChannelPosts(lists.data);
  const ownerUnread = useOwnerUnread();
  const availableConversationIds = useAtomValue(availableConversationIdSetAtom);
  const unreadByList = useMemo(
    () => ownerUnreadByList(ownerUnread.data, workspaceId),
    [ownerUnread.data, workspaceId]
  );
  return renderScreen(screen, {
    workspaceId,
    directory,
    lists: lists.data ?? null,
    refetchLists: lists.refetch,
    unreadByList,
    availableConversationIds,
  });
}

type ScreenContext = {
  workspaceId: string;
  directory: WorkspaceDirectory;
  lists: readonly BuddyMailingListSummary[] | null;
  refetchLists(): Promise<void>;
  unreadByList: ReadonlyMap<string, OwnerListUnread>;
  availableConversationIds: ReadonlySet<string>;
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
          linkedPostId={screen.linkedPostId}
          context={context}
        />
      );
    case 'dm':
      return (
        <DmScreen
          key={screen.conversationId}
          conversationId={screen.conversationId}
          context={context}
        />
      );
  }
}

// Stay inside Channels. The previous channel query is kept so Back (dropping
// `dm`) returns to it; a DM opened from Home has nothing else in the query.
function useChannelsOpenDm(workspaceId: string): OpenDm {
  const navigate = useNavigate();
  const location = useLocation();
  return (conversationId) => {
    const params = new URLSearchParams(location.search);
    params.delete('thread');
    params.delete('post');
    params.delete('task');
    params.set('dm', conversationId);
    navigate(`/buddies/workspaces/${encodeURIComponent(workspaceId)}/channels?${params}`);
  };
}

// A Buddy DM uses the thread transcript and composer. The Builder is the hire
// flow, so it still opens the conversation page; Back returns to Channels
// without the `dm` param (that screen would only redirect here again).
function DmScreen({
  conversationId,
  context,
}: {
  conversationId: string;
  context: ScreenContext;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const conversation = useAtomValue(conversationAtomFamily(conversationId));
  const builders = useAtomValue(buddyBuilderConversationsAtom);
  const builder =
    builders.some((entry) => entry.id === conversationId && !entry.done) ||
    (conversation !== null && isBuddyBuilderConversation(conversation));
  useEffect(() => {
    if (!builder) return;
    const params = new URLSearchParams(location.search);
    params.delete('dm');
    const search = params.toString();
    navigate(`/chat/${encodeURIComponent(conversationId)}`, {
      replace: true,
      state: mobileConversationRouteState({
        pathname: location.pathname,
        search: search ? `?${search}` : '',
        hash: location.hash,
        state: location.state,
      }),
    });
  }, [builder, conversationId, location, navigate]);
  const backParams = new URLSearchParams(location.search);
  backParams.delete('dm');
  const backQuery = backParams.toString();
  const backTo = `/buddies/workspaces/${encodeURIComponent(context.workspaceId)}/channels${
    backQuery ? `?${backQuery}` : ''
  }`;
  const member = context.directory.activeMembers.find(
    (item) => item.id === getBuddyId(conversation)
  );
  const name = member?.name ?? 'Buddy';
  if (builder) return <ChannelLoader label="Opening Buddy Builder…" />;
  return (
    <ChannelDm
      conversationId={conversationId}
      workspaceId={context.workspaceId}
      buddyName={name}
      buddyRole={member?.role ?? 'Direct message'}
      buddyNames={context.directory.buddyNames}
      tasks={context.directory.taskById}
      frame="mobile"
      backTo={backTo}
      onConversation={(nextId) =>
        navigate(channelsHref(context.workspaceId, { kind: 'dm', conversationId: nextId }))
      }
      composeShell={(composer) => (
        <MobileChannelComposeFrame title={name}>{composer}</MobileChannelComposeFrame>
      )}
    />
  );
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
                data-unread={channelUnreadAttr(context.unreadByList.get(list.id))}
                to={channelsHref(workspaceId, { kind: 'channel', listId: list.id })}
              >
                <span className="mobile-channels-row__hash" aria-hidden="true">
                  #
                </span>
                <span className="mobile-channels-row__name">{list.name}</span>
                <RepliesBadge unread={context.unreadByList.get(list.id)} />
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
        <BuddySection workspaceId={workspaceId} directory={directory} />
      </MobileSection>
    </MobilePage>
  );
}

// The red count is only what waits on the owner: replies in their threads.
function RepliesBadge({ unread }: { unread: OwnerListUnread | undefined }) {
  const count = unread?.repliesToYou ?? 0;
  return count === 0 ? null : (
    <span className="mobile-channels-row__badge" aria-label={`${count} new replies to you`}>
      {count}
    </span>
  );
}

function BuddySection({
  workspaceId,
  directory,
}: {
  workspaceId: string;
  directory: WorkspaceDirectory;
}) {
  const openDm = useChannelsOpenDm(workspaceId);
  const newBuddy = useChannelNewBuddy(openDm);
  const creatingBuddy = latestActiveBuddyBuilder(useAtomValue(buddyBuilderConversationsAtom));
  return (
    <>
      <button
        type="button"
        className="mobile-channels-row mobile-channels-row--add"
        disabled={newBuddy.pending}
        onClick={newBuddy.start}
      >
        <span className="mobile-channels-row__hash" aria-hidden="true">
          +
        </span>
        <span className="mobile-channels-row__name">New Buddy</span>
      </button>
      {newBuddy.error && (
        <p className="mobile-channels-new__problem" role="alert">
          {newBuddy.error}
        </p>
      )}
      <ul className="mobile-channels-list">
        {creatingBuddy && (
          <li className="mobile-channels-buddy">
            <button
              type="button"
              className="mobile-channels-row"
              onClick={() => openDm(creatingBuddy.id)}
            >
              <BuddySigil className="mobile-channels-row__sigil" name="Creating buddy" />
              <span className="mobile-channels-row__stack">
                <span className="mobile-channels-row__name mobile-channels-creating-label">
                  Creating buddy
                </span>
              </span>
            </button>
            <button
              type="button"
              className="mobile-channels-archive"
              aria-label="Archive Buddy setup"
              title="Archive this setup chat"
              onClick={() => setConversationDone(creatingBuddy.id, true)}
            >
              ×
            </button>
          </li>
        )}
        {directory.activeMembers.map((member) => (
          <BuddyRow key={member.id} member={member} workspaceId={workspaceId} />
        ))}
      </ul>
    </>
  );
}

// Slack's DM row: tapping the Buddy opens the DM inside Channels. Wake is a
// visible button, since touch has no hover.
function BuddyRow({ member, workspaceId }: { member: ChannelMember; workspaceId: string }) {
  // Back from the DM returns here, not to the Buddies tab.
  const openDm = useChannelsOpenDm(workspaceId);
  const direct = useBuddyDirectActions(member.id, workspaceId);
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
      responding: ReadonlyMap<string, string>;
      // Roots with replies the owner had not seen when they arrived.
      unreadThreads: ReadonlySet<string>;
    }
  | { kind: 'thread' };

type RowContext = {
  workspaceId: string;
  directory: WorkspaceDirectory;
  place: RowPlace;
  availableConversationIds: ReadonlySet<string>;
  // The reply a permalink named (`?post=`); its row is highlighted.
  linkedPostId: string | null;
};

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
      const replying = place.responding.get(post.id);
      const rootId = post.threadRootId ?? post.id;
      return (
        <div className="mobile-channel-post__footer">
          {post.replyCount > 0 ? (
            <Link
              className="mobile-channel-post__replies"
              data-unread={place.unreadThreads.has(rootId) || undefined}
              to={place.threadHref(rootId)}
            >
              {place.unreadThreads.has(rootId) && (
                <span className="mobile-channel-post__unread-dot" aria-label="New replies" />
              )}
              {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
              {post.latestReplyAt && <span> · {clockTime(post.latestReplyAt)}</span>}
            </Link>
          ) : (
            <Link className="mobile-channel-post__reply" to={place.threadHref(rootId)}>
              Reply
            </Link>
          )}
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
  const openDm = useChannelsOpenDm(context.workspaceId);
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
                workspaceId={context.workspaceId}
                openDm={openDm}
              />
              <time dateTime={row.post.createdAt}>{clockTime(row.post.createdAt)}</time>
              <PostPurpose post={row.post} />
              <ConversationEye
                className="mobile-channel-post__eye"
                conversationId={row.post.senderConversationId}
                available={context.availableConversationIds.has(
                  row.post.senderConversationId ?? ''
                )}
              />
            </div>
            <ChannelMarkdown
              body={row.post.body}
              buddyNames={context.directory.buddyNames}
              tasks={context.directory.taskById}
            />
            <OutOfTokensChannelRetry post={row.post} />
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
            <ConversationEye
              className="mobile-channel-post__eye"
              conversationId={row.post.senderConversationId}
              available={context.availableConversationIds.has(row.post.senderConversationId ?? '')}
            />
            <ChannelMarkdown
              body={row.post.body}
              buddyNames={context.directory.buddyNames}
              tasks={context.directory.taskById}
            />
            <OutOfTokensChannelRetry post={row.post} />
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

function ChannelScreen({ listId, context }: { listId: string; context: ScreenContext }) {
  const { workspaceId, directory, lists } = context;
  const list = lists?.find((candidate) => candidate.id === listId) ?? null;
  const channel = useChannelFeed(channelPostFeed(listId));
  const feed = channel.feed;
  const responding = useChannelResponding(listId, directory.buddyNames);
  const posts = useWithOutbox(workspaceId, listId, null, feed.data);
  const rows = useMemo(() => channelRows(posts ?? []), [posts]);
  const follow = useFollowBottom(rows.length, feed.data, null);
  const visit = useOwnerChannelVisit(listId, context.unreadByList.get(listId));
  const arrival = arrivalMarks(visit, feed.data ?? []);
  const rowContext: RowContext = {
    workspaceId,
    directory,
    place: {
      kind: 'channel',
      threadHref: (rootId) =>
        channelsHref(workspaceId, { kind: 'thread', listId, rootId, linkedPostId: null }),
      responding,
      unreadThreads: new Set(arrival.unreadThreads),
    },
    availableConversationIds: context.availableConversationIds,
    linkedPostId: null,
  };
  // The mailing list's own description — unrelated to the conversation field gate G2 guards.
  const { name, purpose: description } = list ?? { name: 'channel', purpose: '' };
  return (
    <div className="mobile-channel">
      <ScreenHeader
        backTo={channelsHref(workspaceId, { kind: 'home' })}
        title={`# ${name}`}
        subtitle={description}
        link={{
          path: channelLinkPath(workspaceId, { kind: 'channel', listId }),
          label: 'Copy link to channel',
        }}
      />
      <div className="mobile-channel__scroll" ref={follow.scrollRef} onScroll={follow.onScroll}>
        {(feed.kind === 'failed' || feed.kind === 'stale') && (
          <p className="mobile-channel__error" role="alert">
            Posts could not refresh: {feed.error.message}
          </p>
        )}
        {renderFeed(feedPhase(feed), {
          loading: () => <ChannelLoader label={`Loading # ${name}…`} />,
          failed: () => null,
          empty: () => (
            <MobileEmptyPanel>No posts yet. @mention a Buddy to ask it something.</MobileEmptyPanel>
          ),
          posts: () => (
            <>
              <ChannelHistory
                edge={channel.edge}
                scrollRef={follow.scrollRef}
                onReach={() => void channel.loadOlder(follow.hold)}
              />
              <ol className="mobile-channel__posts">
                {rows.map((row) => [
                  row.kind !== 'day' && row.post.id === arrival.firstUnread && (
                    <li key="new-messages" className="mobile-channel-new-messages">
                      <span>New messages</span>
                    </li>
                  ),
                  <Row key={row.key} row={row} context={rowContext} />,
                ])}
              </ol>
            </>
          ),
        })}
      </div>
      <ChannelComposerMobile
        title={`# ${name}`}
        listId={listId}
        threadRootId={null}
        placeholder={`Message #${name}`}
        references={directory.references}
        submit="button"
        onPosted={(_result: BuddyOwnerPostResult) => {
          follow.pin();
          void feed.refetch();
        }}
      />
    </div>
  );
}

// ── Thread ──────────────────────────────────────────────────────────────────

function ThreadScreen({
  listId,
  rootId,
  linkedPostId,
  context,
}: {
  listId: string;
  rootId: string;
  linkedPostId: string | null;
  context: ScreenContext;
}) {
  const { workspaceId, directory, lists } = context;
  const list = lists?.find((candidate) => candidate.id === listId) ?? null;
  const paged = useChannelFeed(threadPostFeed(listId, rootId, linkedPostId));
  const thread = paged.feed;
  const replying = useChannelResponding(listId, directory.buddyNames).get(rootId);
  const replies = useWithOutbox(workspaceId, listId, rootId, thread.data?.replies ?? null);
  const replyRows = useMemo(() => channelRows(replies ?? []), [replies]);
  const follow = useFollowBottom(
    replyRows.length + (replying === undefined ? 0 : 1),
    thread.data,
    linkedPostId
  );
  const rowContext: RowContext = {
    workspaceId,
    directory,
    place: { kind: 'thread' },
    availableConversationIds: context.availableConversationIds,
    linkedPostId,
  };
  const root = thread.data?.root;
  return (
    <div className="mobile-channel">
      <ScreenHeader
        backTo={channelsHref(workspaceId, { kind: 'channel', listId })}
        title="Thread"
        subtitle={`# ${list?.name ?? 'channel'}`}
        link={{
          path: channelLinkPath(workspaceId, { kind: 'thread', listId, rootId }),
          label: 'Copy link to thread',
        }}
      />
      <div className="mobile-channel__scroll" ref={follow.scrollRef} onScroll={follow.onScroll}>
        {(thread.kind === 'failed' || thread.kind === 'stale') && (
          <p className="mobile-channel__error" role="alert">
            Thread could not refresh: {thread.error.message}
          </p>
        )}
        {thread.kind === 'loading' && <ChannelLoader label="Loading thread…" />}
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
        {root && (
          <ChannelHistory
            edge={paged.edge}
            scrollRef={follow.scrollRef}
            onReach={() => void paged.loadOlder(follow.hold)}
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
      <ChannelComposerMobile
        title={`Thread in # ${list?.name ?? 'channel'}`}
        listId={listId}
        threadRootId={rootId}
        placeholder="Reply…"
        references={directory.references}
        seats={thread.data?.seats}
        submit="button"
        onPosted={() => {
          follow.pin();
          void thread.refetch();
        }}
      />
    </div>
  );
}
