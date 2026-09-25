import { useEffect, useState } from 'react';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { actorName } from './BuddyTaskComments';
import { buddyApi, buddyWrite } from './api';
import type { Actor, ChannelUnread, Inbox, Post, PostPage } from './types';
import { ActionError, useBuddyAction } from './useBuddyAction';

export const inboxUrl = (workspaceId: string): string =>
  `/api/buddies/workspaces/${encodeURIComponent(workspaceId)}/inbox`;

const channelPostsUrl = (channelId: string): string =>
  `/api/buddies/channels/${encodeURIComponent(channelId)}/posts?limit=50`;

const isMember = (members: readonly Actor[], buddyId: string) =>
  members.some((member) => member.kind === 'buddy' && member.id === buddyId);

/** The owner↔Buddy DM: the direct channel whose members are exactly the owner and this Buddy. */
export function ownerDirectChannel(inbox: Inbox, buddyId: string): ChannelUnread | undefined {
  return inbox.channels.find(
    ({ channel }) =>
      channel.kind.type === 'direct' &&
      channel.kind.members.length === 2 &&
      channel.kind.members.some((member) => member.kind === 'owner') &&
      isMember(channel.kind.members, buddyId)
  );
}

/** A request's lifecycle as a label; `none` is an ordinary post and shows nothing. */
const REQUEST_LABEL: { [K in Post['request']['state']]: string | null } = {
  none: null,
  awaiting: 'Awaiting an answer',
  answered: 'Answered',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

function AnswerForm({ request, refresh }: { request: Post; refresh: () => Promise<void> }) {
  const [body, setBody] = useState('');
  const action = useBuddyAction(refresh);
  return (
    <form
      className="buddy-panel__form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run('answer', () =>
          buddyWrite(`/api/buddies/posts/${encodeURIComponent(request.id)}/answer`, 'POST', {
            body,
          })
        );
      }}
    >
      <textarea
        aria-label="Answer"
        rows={3}
        placeholder="Your answer"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <button type="submit" disabled={action.busy || !body.trim()}>
        Send answer
      </button>
      <ActionError state={action.state} />
    </form>
  );
}

function SendForm({ buddyId, refresh }: { buddyId: string; refresh: () => Promise<void> }) {
  const [body, setBody] = useState('');
  const [request, setRequest] = useState(false);
  const action = useBuddyAction(refresh);
  return (
    <form
      className="buddy-panel__form"
      onSubmit={(event) => {
        event.preventDefault();
        void action
          .run('send', () =>
            buddyWrite('/api/buddies/direct/posts', 'POST', {
              members: [buddyId],
              body,
              kind: request ? 'request' : 'inform',
            })
          )
          .then((ok) => ok && setBody(''));
      }}
    >
      <textarea
        aria-label="Message"
        rows={3}
        placeholder="Message this Buddy"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <label className="buddy-panel__check">
        <input
          type="checkbox"
          checked={request}
          onChange={(event) => setRequest(event.target.checked)}
        />
        Ask for an answer
      </label>
      <button type="submit" disabled={action.busy || !body.trim()}>
        Send
      </button>
      <ActionError state={action.state} />
    </form>
  );
}

/** The DM's top-level posts, oldest first, with the owner's answer forms under open requests. */
export function BuddyDirectPosts({
  posts,
  awaitingOwner,
  names,
  refresh,
}: {
  posts: readonly Post[];
  awaitingOwner: ReadonlySet<string>;
  names: Readonly<Record<string, string>>;
  refresh: () => Promise<void>;
}) {
  if (posts.length === 0) return <p className="buddy-panel__empty">No messages yet.</p>;
  return (
    <ol className="buddy-post-list">
      {[...posts].reverse().map((post) => {
        const label = REQUEST_LABEL[post.request.state];
        return (
          <li key={post.id} data-request={post.request.state}>
            <div className="buddy-post-list__meta">
              <strong>{actorName(post.author, names)}</strong>
              {label && <span className="buddy-dm__request">{label}</span>}
              <time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleString()}</time>
            </div>
            <p className="buddy-post-list__body">{post.body}</p>
            {post.evidence.length > 0 && (
              <ul className="buddy-post-list__evidence">
                {post.evidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {awaitingOwner.has(post.id) && <AnswerForm request={post} refresh={refresh} />}
          </li>
        );
      })}
    </ol>
  );
}

function DirectChannel({
  direct,
  inbox,
  names,
  refreshInbox,
}: {
  direct: ChannelUnread;
  inbox: Inbox;
  names: Readonly<Record<string, string>>;
  refreshInbox: () => Promise<void>;
}) {
  const channelId = direct.channel.id;
  const page = usePolledFetch<PostPage>(channelPostsUrl(channelId), 30_000);
  const newest = page.data?.posts[0]?.id;
  // Seeing the DM reads it through the newest post rendered; a later post stays unread.
  useEffect(() => {
    if (newest === undefined || direct.unread === 0) return;
    void buddyApi(`/api/buddies/channels/${encodeURIComponent(channelId)}/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postId: newest }),
    }).catch((error: unknown) => console.warn('[buddies] could not mark the DM read:', error));
  }, [channelId, newest, direct.unread]);
  const awaitingOwner = new Set(
    inbox.requests.filter((post) => post.channelId === channelId).map((post) => post.id)
  );
  const refresh = async () => {
    await Promise.all([page.refetch(), refreshInbox()]);
  };
  switch (page.kind) {
    case 'idle':
    case 'loading':
      return <p className="buddy-panel__empty">Loading messages…</p>;
    case 'failed':
      return (
        <p className="buddy-panel__error" role="alert">
          {page.error.message}
        </p>
      );
    case 'ready':
    case 'stale':
      return (
        <BuddyDirectPosts
          posts={page.data.posts}
          awaitingOwner={awaitingOwner}
          names={names}
          refresh={refresh}
        />
      );
  }
}

/**
 * The Messages tab: the owner's DM with this Buddy. Requests are posts whose
 * `request.state` is tracked; the ones awaiting the owner come from the inbox.
 */
export function BuddyMessages({
  buddyId,
  workspaceId,
  names,
}: {
  buddyId: string;
  workspaceId: string;
  names: Readonly<Record<string, string>>;
}) {
  const inbox = usePolledFetch<Inbox>(inboxUrl(workspaceId), 30_000);
  const direct = inbox.data ? ownerDirectChannel(inbox.data, buddyId) : undefined;
  return (
    <section className="buddy-panel" aria-label="Messages">
      <div className="buddy-panel__title">
        <h2>Messages</h2>
      </div>
      <SendForm buddyId={buddyId} refresh={inbox.refetch} />
      {inbox.kind === 'failed' && (
        <p className="buddy-panel__error" role="alert">
          {inbox.error.message}
        </p>
      )}
      {(inbox.kind === 'loading' || inbox.kind === 'idle') && (
        <p className="buddy-panel__empty">Loading messages…</p>
      )}
      {inbox.data && direct === undefined && <p className="buddy-panel__empty">No messages yet.</p>}
      {inbox.data && direct && (
        <DirectChannel
          direct={direct}
          inbox={inbox.data}
          names={names}
          refreshInbox={inbox.refetch}
        />
      )}
    </section>
  );
}
