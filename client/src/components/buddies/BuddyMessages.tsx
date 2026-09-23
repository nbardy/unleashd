import type { BuddyMessage } from '@unleashd/shared';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { newId } from '../../utils/ids';
import { BuddyTeamConfigurationRequest } from './BuddyTeamConfiguration';
import { buddyApi } from './api';

const EMPTY_NAMES: Readonly<Record<string, string>> = {};

export interface BuddyOwnerReply {
  outcome: string;
  body: string;
  evidence: string[];
}

export function BuddyMessages({
  buddyId,
  buddyNames = EMPTY_NAMES,
  messages,
  availableConversationIds,
  onReply,
  workspaceId,
}: {
  buddyId?: string;
  buddyNames?: Readonly<Record<string, string>>;
  messages: BuddyMessage[];
  availableConversationIds: ReadonlySet<string>;
  onReply(messageId: string, reply: BuddyOwnerReply): Promise<void>;
  workspaceId?: string;
}) {
  const { data, error, refetch } = usePolledFetch<BuddyMessage[]>(
    buddyId ? `/api/buddies/messages?buddyId=${encodeURIComponent(buddyId)}` : null,
    5000
  );
  const visibleMessages = data ?? messages;
  return (
    <section className="buddy-messages" aria-label="Mailbox">
      <h2>Mailbox</h2>
      <p>Messages, replies, and requests for your approval.</p>
      {error && <p role="alert">Mailbox could not refresh: {error.message}</p>}
      {visibleMessages.length === 0 && <p>No messages yet.</p>}
      {visibleMessages.map((message) => (
        <BuddyMessageCard
          key={message.id}
          message={message}
          buddyNames={buddyNames}
          availableConversationIds={availableConversationIds}
          onChanged={refetch}
          onReply={async (id, reply) => {
            await onReply(id, reply);
            refetch();
          }}
        />
      ))}
      <BuddyListsSection
        workspaceId={workspaceId}
        buddyId={buddyId}
        buddyNames={buddyNames}
        availableConversationIds={availableConversationIds}
      />
    </section>
  );
}

// Author = Buddy | Owner (the owner posts as themself, never as a stand-in Buddy).
export type BuddyListAuthor = { kind: 'buddy'; buddyId: string } | { kind: 'owner' };

export interface BuddyMailingListSummary {
  id: string;
  workspaceId: string;
  name: string;
  purpose: string;
  createdBy: BuddyListAuthor;
  createdAt: string;
  postCount: number;
  latestPostAt: string | null;
}

export interface BuddyMailingListPost {
  id: string;
  listId: string;
  workspaceId: string;
  author: BuddyListAuthor;
  // null: a top-level channel post. Threads are one level deep.
  threadRootId: string | null;
  replyCount: number;
  latestReplyAt: string | null;
  purpose: string;
  body: string;
  evidence: string[];
  projectId: string | null;
  createdAt: string;
  senderConversationId: string | null;
  senderRunId: string | null;
}

export function authorKey(author: BuddyListAuthor): string {
  switch (author.kind) {
    case 'owner':
      return 'owner';
    case 'buddy':
      return author.buddyId;
  }
}

export function PostAuthor({
  author,
  buddyNames,
  className,
}: {
  author: BuddyListAuthor | undefined;
  buddyNames: Readonly<Record<string, string>>;
  className?: string;
}) {
  if (!author) return <span className={className}>Unknown</span>;
  switch (author.kind) {
    case 'owner':
      return <span className={className}>You</span>;
    case 'buddy':
      return (
        <Link className={className} to={`/buddies/${encodeURIComponent(author.buddyId)}`}>
          {buddyNames[author.buddyId] ?? author.buddyId}
        </Link>
      );
  }
}

function BuddyListsSection({
  workspaceId,
  buddyId,
  buddyNames,
  availableConversationIds,
}: {
  workspaceId?: string;
  buddyId?: string;
  buddyNames: Readonly<Record<string, string>>;
  availableConversationIds: ReadonlySet<string>;
}) {
  const { data, error, refetch } = usePolledFetch<BuddyMailingListSummary[]>(
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
              <BuddyListFeed
                key={selected.id}
                list={selected}
                workspaceId={workspaceId}
                channelNameById={new Map(data.map((entry) => [entry.id, entry.name]))}
                buddyId={buddyId}
                buddyNames={buddyNames}
                availableConversationIds={availableConversationIds}
                onPosted={refetch}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// A Task filter reads the workspace-wide feed so one Task's discussion is
// visible across every channel, not just the selected one.
export function taskChannelFeedUrl(workspaceId: string, projectId: string): string {
  return `/api/buddies/posts?workspaceId=${encodeURIComponent(workspaceId)}&projectId=${encodeURIComponent(projectId)}&limit=50`;
}

export function ChannelPostItem({
  post,
  channelName,
  buddyNames,
  availableConversationIds,
}: {
  post: BuddyMailingListPost;
  channelName: string | null;
  buddyNames: Readonly<Record<string, string>>;
  availableConversationIds: ReadonlySet<string>;
}) {
  return (
    <li className="buddy-messages-list-post">
      <div className="buddy-messages-list-post-heading">
        <strong>{post.purpose}</strong>
        {channelName && <span> · #{channelName}</span>}
        <span>
          <PostAuthor author={post.author} buddyNames={buddyNames} />
          {post.senderConversationId && <> · conv {post.senderConversationId.slice(0, 8)}</>}
          {' · '}
          {new Date(post.createdAt).toLocaleString()}
          {post.senderConversationId && availableConversationIds.has(post.senderConversationId) && (
            <>
              {' · '}
              <Link to={`/chat/${encodeURIComponent(post.senderConversationId)}`}>
                Open conversation
              </Link>
            </>
          )}
        </span>
      </div>
      <p>{post.body}</p>
    </li>
  );
}

export function ChannelFeed({
  list,
  workspaceId,
  channelNameById,
  buddyNames,
  availableConversationIds,
  composer,
}: {
  list: BuddyMailingListSummary;
  workspaceId?: string;
  channelNameById: ReadonlyMap<string, string>;
  buddyNames: Readonly<Record<string, string>>;
  availableConversationIds: ReadonlySet<string>;
  composer?: (refetch: () => void) => ReactNode;
}) {
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const { data, error, refetch } = usePolledFetch<BuddyMailingListPost[]>(
    projectFilter && workspaceId
      ? taskChannelFeedUrl(workspaceId, projectFilter)
      : `/api/buddies/lists/${encodeURIComponent(list.id)}/posts?limit=20`,
    5000
  );
  const sortedPosts = useMemo(
    () =>
      [...(data ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [data]
  );
  const projectIds = useMemo(
    () => [
      ...new Set(
        sortedPosts.map((post) => post.projectId).filter((id): id is string => id !== null)
      ),
    ],
    [sortedPosts]
  );
  const visiblePosts = projectFilter
    ? sortedPosts.filter((post) => post.projectId === projectFilter)
    : sortedPosts;
  return (
    <article className="buddy-messages-list-feed">
      <h4>{list.name}</h4>
      <p>{list.purpose}</p>
      {error && <p role="alert">Posts could not refresh: {error.message}</p>}
      {projectIds.length > 0 && (
        <div className="buddy-messages-list-filter">
          <span>Task</span>
          <ul className="buddy-messages-list-filter-options">
            <li key="all">
              <button
                type="button"
                aria-pressed={projectFilter === null}
                onClick={() => setProjectFilter(null)}
              >
                All
              </button>
            </li>
            {projectIds.map((projectId) => (
              <li key={projectId}>
                <button
                  type="button"
                  aria-pressed={projectFilter === projectId}
                  onClick={() => setProjectFilter(projectId)}
                >
                  {projectId}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {visiblePosts.length === 0 ? (
        <p className="empty-state">No posts yet.</p>
      ) : (
        <ul className="buddy-messages-list-posts">
          {visiblePosts.map((post) => (
            <ChannelPostItem
              key={post.id}
              post={post}
              channelName={projectFilter ? (channelNameById.get(post.listId) ?? post.listId) : null}
              buddyNames={buddyNames}
              availableConversationIds={availableConversationIds}
            />
          ))}
        </ul>
      )}
      {composer?.(refetch)}
    </article>
  );
}

function ChannelComposer({
  list,
  buddyId,
  onPosted,
  refetch,
}: {
  list: BuddyMailingListSummary;
  buddyId: string;
  onPosted(): void;
  refetch(): void;
}) {
  const [purpose, setPurpose] = useState('standup');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <form
        className="buddy-messages-list-composer"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setProblem(null);
          void buddyApi(`/api/buddies/lists/${encodeURIComponent(list.id)}/posts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              author: { kind: 'buddy', buddyId },
              key: newId(),
              purpose: purpose.trim(),
              body: body.trim(),
            }),
          })
            .then(() => {
              setBody('');
              refetch();
              onPosted();
            })
            .catch((cause: unknown) => {
              setProblem(cause instanceof Error ? cause.message : String(cause));
            })
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Kind
          <input
            required
            value={purpose}
            maxLength={200}
            onChange={(event) => setPurpose(event.target.value)}
            disabled={busy}
            placeholder="standup, handoff, announcement, decision"
          />
        </label>
        <label>
          Post
          <textarea
            required
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={busy}
          />
        </label>
        <button type="submit" disabled={busy || !purpose.trim() || !body.trim()}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </form>
      {problem && <p role="alert">{problem}</p>}
    </>
  );
}

function BuddyListFeed({
  list,
  workspaceId,
  channelNameById,
  buddyId,
  buddyNames,
  availableConversationIds,
  onPosted,
}: {
  list: BuddyMailingListSummary;
  workspaceId?: string;
  channelNameById: ReadonlyMap<string, string>;
  buddyId?: string;
  buddyNames: Readonly<Record<string, string>>;
  availableConversationIds: ReadonlySet<string>;
  onPosted(): void;
}) {
  return (
    <ChannelFeed
      list={list}
      workspaceId={workspaceId}
      channelNameById={channelNameById}
      buddyNames={buddyNames}
      availableConversationIds={availableConversationIds}
      composer={
        buddyId
          ? (refetch) => (
              <ChannelComposer
                list={list}
                buddyId={buddyId}
                onPosted={onPosted}
                refetch={refetch}
              />
            )
          : undefined
      }
    />
  );
}

function BuddyMessageCard({
  message,
  buddyNames,
  availableConversationIds,
  onReply,
  onChanged,
}: {
  message: BuddyMessage;
  buddyNames: Readonly<Record<string, string>>;
  availableConversationIds: ReadonlySet<string>;
  onReply(messageId: string, reply: BuddyOwnerReply): Promise<void>;
  onChanged(): void;
}) {
  const [outcome, setOutcome] = useState('answered');
  const [body, setBody] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomingEnabled, setIncomingEnabled] = useState(false);
  const conversationId = message.child_conversation_id ?? message.parent_conversation_id;
  const canReply =
    message.expects_reply !== 0 &&
    message.to_buddy_id === null &&
    ['pending', 'active'].includes(message.status);
  return (
    <article className="buddy-messages__card">
      <div className="buddy-messages__heading">
        <strong>{message.purpose}</strong>
        <span>
          Request {message.status}
          {message.execution ? ` · Execution ${message.execution.state}` : ''}
          {message.to_buddy_id === null ? ' · To you' : ''}
        </span>
      </div>
      {message.approval && (
        <div>
          <strong>Approval: {message.approval.operation}</strong>
          <pre>{JSON.stringify(message.approval.arguments, null, 2)}</pre>
          <p>Expires {message.approval.expires_at}. Reply with outcome approved or rejected.</p>
        </div>
      )}
      <p className="buddy-messages__participants">
        <Link to={`/buddies/${encodeURIComponent(message.from_buddy_id)}`}>
          {buddyNames[message.from_buddy_id] ?? message.from_buddy_id}
        </Link>
        {' → '}
        {message.to_buddy_id === null ? (
          'You'
        ) : (
          <Link to={`/buddies/${encodeURIComponent(message.to_buddy_id)}`}>
            {buddyNames[message.to_buddy_id] ?? message.to_buddy_id}
          </Link>
        )}
      </p>
      <p className="buddy-messages__body">{message.body}</p>
      {message.execution && (
        <details className="buddy-messages__receipt">
          <summary>Delivery and execution details</summary>
          {message.execution.reason && <p>{message.execution.reason}</p>}
          {message.execution.remedy && <p>{message.execution.remedy}</p>}
          {message.execution.code === 'background_disabled' && message.to_buddy_id && (
            <div>
              <p>
                Enable incoming work for this recipient to admit existing queued tasks. Recurring
                schedules and document permissions stay separately controlled.
              </p>
              <button
                type="button"
                disabled={busy || incomingEnabled}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void buddyApi(
                    `/api/buddies/${encodeURIComponent(message.to_buddy_id!)}/memberships/${encodeURIComponent(message.workspace_id)}`,
                    {
                      method: 'PATCH',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ background_enabled: true }),
                    }
                  )
                    .then(() => {
                      setIncomingEnabled(true);
                      onChanged();
                    })
                    .catch((cause: unknown) => {
                      setError(cause instanceof Error ? cause.message : String(cause));
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {incomingEnabled
                  ? 'Incoming work enabled; awaiting admission'
                  : 'Enable incoming work'}
              </button>
            </div>
          )}
          {message.execution.acknowledgedAt && (
            <p>Input admitted {new Date(message.execution.acknowledgedAt).toLocaleString()}.</p>
          )}
          {message.execution.projectSnapshot && (
            <p>
              Current project: {message.execution.projectSnapshot.status} · revision{' '}
              {message.execution.projectSnapshot.revision} ·{' '}
              {message.execution.projectSnapshot.evidenceCount} evidence references. This is current
              project state, separate from this request.
            </p>
          )}
          {message.execution.delivery?.map((delivery) => (
            <p key={delivery.runId}>
              {delivery.mailboxOnly
                ? 'Saved in mailbox. No automated turn was started in your chat.'
                : `Return delivery: ${delivery.kind} · ${delivery.state} · attempt ${delivery.attempt}`}
              {delivery.error ? ` · ${delivery.error}` : ''}
            </p>
          ))}
          {message.execution.acceptedAt && (
            <p>Reply recorded {new Date(message.execution.acceptedAt).toLocaleString()}.</p>
          )}
          {message.execution.completionEvidence.length > 0 && (
            <p>Reply evidence: {message.execution.completionEvidence.join(' · ')}</p>
          )}
        </details>
      )}
      {message.team_configuration &&
        (canReply || message.outcome === 'team_configuration_applied') && (
          <BuddyTeamConfigurationRequest
            key={`${message.id}:${message.team_configuration.key}`}
            request={message.team_configuration}
            messageId={message.id}
            applied={message.outcome === 'team_configuration_applied'}
            onApplied={onChanged}
          />
        )}
      {message.evidence.length > 0 && (
        <details>
          <summary>Evidence</summary>
          <ul>
            {message.evidence.map((item, index) => (
              <li key={`${index}:${item}`}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      {message.reply_body && (
        <div className="buddy-messages__reply">
          <strong>{message.outcome ?? 'Reply'}</strong>
          <p className="buddy-messages__body">{message.reply_body}</p>
          {message.reply_evidence.length > 0 && (
            <ul>
              {message.reply_evidence.map((item, index) => (
                <li key={`${index}:${item}`}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {message.wait_status === 'timed_out' && (
        <p>The sender stopped waiting. A reply can still be recorded.</p>
      )}
      {conversationId && availableConversationIds.has(conversationId) && (
        <Link to={`/chat/${encodeURIComponent(conversationId)}`}>Open conversation</Link>
      )}
      {canReply && (
        <details className="buddy-messages__decision">
          <summary>{message.team_configuration ? 'Decline setup' : 'Reply'}</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              void onReply(message.id, {
                outcome: message.team_configuration ? 'rejected' : outcome,
                body: body.trim(),
                evidence: message.team_configuration
                  ? [message.id]
                  : evidence
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean),
              })
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : String(cause));
                })
                .finally(() => setBusy(false));
            }}
          >
            {!message.team_configuration && (
              <label>
                Outcome
                <input
                  required
                  value={outcome}
                  maxLength={200}
                  onChange={(event) => setOutcome(event.target.value)}
                  disabled={busy}
                  placeholder="For example: approved, rejected, or answered"
                />
              </label>
            )}
            <label>
              {message.team_configuration ? 'Reason for declining' : 'Reply'}
              <textarea
                required
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={busy}
              />
            </label>
            {!message.team_configuration && (
              <label>
                Evidence or decision basis
                <textarea
                  required
                  placeholder="One reference or observation per line"
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            <button
              type="submit"
              disabled={
                busy ||
                !body.trim() ||
                (!message.team_configuration && (!outcome.trim() || !evidence.trim()))
              }
            >
              {busy ? 'Saving…' : message.team_configuration ? 'Decline setup' : 'Send reply'}
            </button>
          </form>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
