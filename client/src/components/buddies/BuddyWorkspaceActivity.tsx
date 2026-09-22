import { type BuddyWorkspaceActiveJob, BuddyWorkspaceActivitySchema } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { allConversationIdsAtom, conversationAtomFamily } from '../../atoms/conversations';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { formatTimeAgo } from '../../utils/time';
import './BuddyWorkspaceActivity.css';
import { ChannelBrowser } from './ChannelBrowser';

const NO_CONVERSATION_ID = '__workspace_job_without_conversation__';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function compactPath(path: string | null): string {
  return path?.replace(/^\/Users\/[^/]+/, '~') ?? 'No folder path';
}

function conversationTitle(messages: Array<{ role?: string; content?: string }>): string | null {
  const source = messages.find((message) => message.role === 'user') ?? messages[0];
  const firstLine = source?.content?.split('\n')[0]?.trim();
  if (!firstLine) return null;
  return firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;
}

function JobRow({
  job,
  available,
}: {
  job: BuddyWorkspaceActiveJob;
  available: boolean;
}) {
  const conversation = useAtomValue(
    conversationAtomFamily(job.conversationId ?? NO_CONVERSATION_ID)
  );
  const title = conversationTitle(conversation?.messages ?? []) ?? job.label;
  const status =
    job.status === 'claimed'
      ? 'Starting'
      : job.status === 'cancel_requested'
        ? 'Stopping'
        : 'Running';
  const body = (
    <>
      <span className="buddy-workspace-job-dot" aria-hidden="true" />
      <span className={`buddy-workspace-job-kind buddy-workspace-job-kind--${job.kind}`}>
        {job.kind}
      </span>
      <span className="buddy-workspace-job-title">{title}</span>
      <span className="buddy-workspace-job-meta">
        {status}
        {job.startedAt ? ` · ${formatTimeAgo(new Date(job.startedAt))}` : ''}
      </span>
    </>
  );

  return job.conversationId && available ? (
    <Link className="buddy-workspace-job" to={`/chat/${job.conversationId}`}>
      {body}
    </Link>
  ) : (
    <div className="buddy-workspace-job">{body}</div>
  );
}

export function BuddyWorkspaceActivity() {
  const { workspaceId } = useParams();
  const conversationIds = useAtomValue(allConversationIdsAtom);
  const availableConversationIds = useMemo(() => new Set(conversationIds), [conversationIds]);
  const loadActivity = useMemo(() => {
    if (!workspaceId) return null;
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
  }, [workspaceId]);
  const { data, loading, error, refetch } = usePolledFetch(loadActivity, 2_000);
  const activeCount = data?.members.reduce((sum, member) => sum + member.jobs.length, 0) ?? 0;
  const buddyNames = useMemo(
    () => Object.fromEntries((data?.members ?? []).map((member) => [member.id, member.name])),
    [data]
  );

  return (
    <main className="buddy-workspace-page">
      <header className="buddy-workspace-header">
        <Link className="buddy-workspace-back" to="/buddies">
          ← Buddies
        </Link>
        <div className="buddy-workspace-heading-row">
          <div>
            <p className="buddy-workspace-eyebrow">Workspace</p>
            <h1>{data?.workspace.name ?? 'Workspace activity'}</h1>
            {data && <p className="buddy-workspace-path">{compactPath(data.workspace.rootPath)}</p>}
          </div>
          {data && (
            <div className="buddy-workspace-active-summary" aria-live="polite">
              <span className={activeCount ? 'is-running' : ''} aria-hidden="true" />
              {activeCount ? `${activeCount} running` : 'No active jobs'}
            </div>
          )}
        </div>
      </header>

      {loading && !data && <p className="buddy-workspace-state">Loading workspace activity…</p>}
      {error && !data && (
        <div className="buddy-workspace-state buddy-workspace-state--error" role="alert">
          <p>{error.message}</p>
          <button type="button" onClick={refetch}>
            Retry
          </button>
        </div>
      )}
      {data && (
        <section className="buddy-workspace-members" aria-label="Buddies and active jobs">
          {data.members.map((member) => (
            <article className="buddy-workspace-member" key={member.id}>
              <div className="buddy-workspace-member-header">
                <span className="buddy-workspace-avatar" aria-hidden="true">
                  {initials(member.name)}
                </span>
                <div className="buddy-workspace-identity">
                  <Link to={`/buddies/${member.id}`}>{member.name}</Link>
                  <span>{member.role}</span>
                </div>
                <span className="buddy-workspace-member-count">
                  {member.jobs.length ? `${member.jobs.length} active` : 'Idle'}
                </span>
              </div>
              <div className="buddy-workspace-jobs">
                {member.jobs.length ? (
                  member.jobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      available={
                        !!job.conversationId && availableConversationIds.has(job.conversationId)
                      }
                    />
                  ))
                ) : (
                  <p className="buddy-workspace-idle">No foreground or background jobs running.</p>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
      {workspaceId && (
        <ChannelBrowser
          workspaceId={workspaceId}
          buddyNames={buddyNames}
          availableConversationIds={availableConversationIds}
        />
      )}
    </main>
  );
}
