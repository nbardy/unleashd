import {
  type BuddyTeamAccessView,
  BuddyTeamAccessViewSchema,
  type BuddyTeamCapability,
  type ConfigureTeamInput,
  ProviderSchema,
  type TeamConfiguration,
  type TeamSetupResult,
  TeamSetupResultSchema,
} from '@unleashd/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createConversation } from '../../atoms/actions';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { newId } from '../../utils/ids';
import { buddyApi } from './api';
import { buildBuddyContextForTalk } from './buddies-shaping';
import type { Buddy, Workspace } from './types';
import './BuddyTeamConfiguration.css';

type SetupRequest = Pick<ConfigureTeamInput, 'key' | 'configuration'>;
const NO_GRANTS: BuddyTeamAccessView['grants'] = [];
const PRIVATE_RESOURCES = [
  { key: 'profile', label: 'Identity profile' },
  { key: 'soul', label: 'Soul' },
  { key: 'memory', label: 'Private memory' },
] as const;

type AccessGrant = BuddyTeamAccessView['grants'][number];
interface PermissionDraft {
  baseRevision: number;
  capabilities: ReadonlySet<BuddyTeamCapability>;
  createdBuddyIncoming: boolean;
  expiresAt: string;
  sourceExpiresAt: string | null;
  reason: string;
  dirty: boolean;
}

function localExpiry(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, -1)
    .replace(/\.?0+$/, '')
    .replace(/:00$/, '');
}

function permissionDraftFromGrant(grant: AccessGrant | undefined): PermissionDraft {
  return {
    baseRevision: grant?.revision ?? 0,
    capabilities: new Set(grant?.capabilities ?? []),
    createdBuddyIncoming: grant?.created_buddy_incoming ?? false,
    expiresAt: localExpiry(grant?.expires_at),
    sourceExpiresAt: grant?.expires_at ?? null,
    reason: '',
    dirty: false,
  };
}

async function configureTeam(
  input: ConfigureTeamInput,
  signal?: AbortSignal
): Promise<TeamSetupResult> {
  return TeamSetupResultSchema.parse(
    await buddyApi('/api/buddies/team-configuration', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    })
  );
}

function TalkToConfiguredBuddy({
  buddyId,
  name,
  workspaceId,
}: { buddyId: string; name: string; workspaceId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function talk() {
    setBusy(true);
    setError(null);
    try {
      const detail = await buddyApi<{ buddy: Buddy; workspaces: Workspace[] }>(
        `/api/buddies/${encodeURIComponent(buddyId)}`
      );
      const workspace = detail.workspaces.find((candidate) => candidate.id === workspaceId);
      if (detail.buddy.status !== 'active' || !workspace) {
        throw new Error(
          'This Buddy is no longer active in this workspace. Refresh its profile before starting a conversation.'
        );
      }
      const id = createConversation({
        workingDirectory: workspace.root_path,
        config: {
          provider: ProviderSchema.parse(detail.buddy.provider ?? 'codex'),
          model: detail.buddy.model
            ? { mode: 'explicit', modelId: detail.buddy.model }
            : { mode: 'default' },
          reasoning: detail.buddy.reasoning_effort
            ? { mode: 'explicit', effort: detail.buddy.reasoning_effort }
            : { mode: 'default' },
        },
        buddyContext: buildBuddyContextForTalk({ buddyId, workspaceId }),
      });
      navigate(`/chat/${id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="buddy-team-configuration__talk"
        disabled={busy}
        onClick={() => void talk()}
      >
        {busy ? 'Opening…' : `Talk to ${name}`}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}

/** The same receipt is used by Settings, owner proposals and both chat shells. */
export function BuddyTeamConfigurationResult({
  result,
  workspaceId,
}: {
  result: TeamSetupResult;
  workspaceId?: string;
}) {
  const livePath = `/api/buddies/team-configuration?workspaceId=${encodeURIComponent(workspaceId ?? '')}&key=${encodeURIComponent(result.key)}`;
  const source = useMemo(
    () =>
      resource(livePath, async (signal: AbortSignal) =>
        TeamSetupResultSchema.parse(await buddyApi(livePath, { signal }))
      ),
    [livePath]
  );
  const live = usePolledFetch(source, 5000, !!workspaceId && !!result.receipt);
  // The workspace and setup key ARE the cache key, so a value read back here
  // is always for this receipt — no `live.data.key === result.key` guard.
  const view = live.data ?? result;
  const nameFor = (id: string) =>
    view.resolvedBuddies.find((buddy) => buddy.id === id)?.name ??
    view.readiness.participants.find((buddy) => buddy.buddyId === id)?.name ??
    id;

  return (
    <article className="buddy-team-configuration__result" aria-label="Team setup result">
      <header>
        <strong>{view.receipt ? 'Team configuration saved' : 'Team configuration preview'}</strong>
        {view.receipt?.replayed && <span>Existing receipt</span>}
      </header>
      <p>
        {view.receipt
          ? 'Configuration is saved. Work starts and completion are shown separately below.'
          : 'Review the exact changes and the existing work they affect.'}
      </p>
      {view.drift && (
        <output>
          Settings have changed since this receipt. Replaying it will not restore old access.
        </output>
      )}
      {live.error && <p role="alert">Work status could not refresh: {live.error.message}</p>}
      {view.blockers.length > 0 && (
        <div role="alert">
          <strong>Configuration blockers</strong>
          <ul>
            {view.blockers.map((blocker, index) => (
              <li key={`${blocker.path}:${blocker.code}:${index}`}>
                <strong>{blocker.reason}</strong> {blocker.remedy}
                <small>
                  {blocker.path} · {blocker.code} · {blocker.resolvableBy}
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="buddy-team-configuration__people">
        {view.resolvedBuddies.map((buddy, index) => (
          <li key={buddy.id ?? `new:${index}`}>
            {buddy.id ? (
              <Link to={`/buddies/${encodeURIComponent(buddy.id)}`}>{buddy.name}</Link>
            ) : (
              `${buddy.name} (new Buddy)`
            )}
            {buddy.id &&
              view.receipt &&
              view.readiness.participants.some(
                (participant) => participant.buddyId === buddy.id && participant.active
              ) && (
                <TalkToConfiguredBuddy
                  buddyId={buddy.id}
                  name={buddy.name}
                  workspaceId={view.workspaceId}
                />
              )}
          </li>
        ))}
      </ul>
      {view.effects.length > 0 && (
        <details>
          <summary>Exact changes ({view.effects.length})</summary>
          {view.effects.map((effect, index) => (
            <div
              key={`${effect.resource}:${effect.id}:${index}`}
              className="buddy-team-configuration__effect"
            >
              <strong>
                {effect.resource} · {nameFor(effect.id)}
              </strong>
              <div className="buddy-team-configuration__diff">
                <div>
                  <span>Before</span>
                  <pre>{JSON.stringify(effect.before, null, 2)}</pre>
                </div>
                <div>
                  <span>After</span>
                  <pre>{JSON.stringify(effect.after, null, 2)}</pre>
                </div>
              </div>
            </div>
          ))}
        </details>
      )}
      <h4>Incoming work and replies</h4>
      <ul>
        {view.readiness.participants.map((participant) => (
          <li key={participant.buddyId}>
            <strong>{participant.name}</strong>: incoming work{' '}
            {participant.incoming ? 'enabled' : 'disabled'}
            {' · '}dispatch {participant.dispatch ? 'enabled' : 'disabled'}
            {!participant.active && ' · inactive'}
            {participant.readAllWork && ' · can see workspace work'}
          </li>
        ))}
      </ul>
      {view.readiness.blockers.length > 0 && (
        <ul className="buddy-team-configuration__blockers">
          {view.readiness.blockers.map((blocker, index) => (
            <li key={`${blocker.path}:${blocker.code}:${index}`}>
              <strong>{blocker.reason}</strong> {blocker.remedy}
              <small>
                {blocker.path} · {blocker.code} · {blocker.resolvableBy}
              </small>
            </li>
          ))}
        </ul>
      )}
      <h4>Existing task requests</h4>
      {view.affectedWork.length === 0 && (
        <p>No existing task requests are affected. Saving configuration does not create work.</p>
      )}
      <ul>
        {view.affectedWork.map((work) => {
          const message = view.readiness.messages.find(
            (candidate) => candidate.messageId === work.messageId
          );
          return (
            <li key={work.messageId}>
              <strong>
                {nameFor(work.recipientId)} · {work.state}
              </strong>
              {work.code && <span> · {work.code}</span>}
              <small>
                Request {work.messageId}
                {work.runId ? ` · Run ${work.runId}` : ' · No run observed'}
              </small>
              {work.acknowledgedAt && <span>Acknowledged {work.acknowledgedAt}.</span>}
              {work.acceptedAt && <span> Project accepted {work.acceptedAt}.</span>}
              {work.projectId && (
                <Link to={`/buddies/${encodeURIComponent(work.recipientId)}/work`}>
                  Open assigned work
                </Link>
              )}
              {!!work.completionEvidence?.length && (
                <p>Completion evidence: {work.completionEvidence.join(' · ')}</p>
              )}
              {message?.returnBuddyId && (
                <span>
                  Replies return to {nameFor(message.returnBuddyId)}: incoming work{' '}
                  {message.returnIncoming ? 'enabled' : 'disabled'}.
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {view.queuedRuns.length > 0 && (
        <details>
          <summary>Queue included in this setup ({view.queuedRuns.length})</summary>
          <ul>
            {view.queuedRuns.map((run) => (
              <li key={run.runId}>
                {nameFor(run.buddyId)} · {run.inputKind} · {run.state}
                <small>
                  Run {run.runId} · Input {run.inputId}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}
      {view.receipt && (
        <small>
          Saved {view.receipt.appliedAt} · Audit {view.receipt.auditId}
        </small>
      )}
    </article>
  );
}

export function BuddyTeamConfigurationRequest({
  request,
  messageId,
  applied = false,
  refreshing = false,
  onApplied,
  onEdit,
}: {
  request: SetupRequest;
  messageId?: string;
  applied?: boolean;
  refreshing?: boolean;
  onApplied?(result: TeamSetupResult): void;
  onEdit?(): void;
}) {
  const [result, setResult] = useState<TeamSetupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewSource = useMemo(
    () =>
      resource(
        `team-configuration-preview:${applied ? 'applied' : messageId ? `message:${messageId}` : 'request'}:${request.key}`,
        (signal: AbortSignal) =>
          applied
            ? buddyApi(
                `/api/buddies/team-configuration?workspaceId=${encodeURIComponent(request.configuration.workspaceId)}&key=${encodeURIComponent(request.key)}`,
                { signal }
              ).then((value) => TeamSetupResultSchema.parse(value))
            : messageId
              ? buddyApi(
                  `/api/buddies/messages/${encodeURIComponent(messageId)}/team-configuration`,
                  {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ preview: true }),
                    signal,
                  }
                ).then((value) => TeamSetupResultSchema.parse(value))
              : configureTeam({ ...request, preview: true }, signal)
      ),
    [request, messageId, applied]
  );
  const previewResult = usePolledFetch(previewSource, 0);
  const shownResult = result ?? previewResult.data;
  async function submit(preview: boolean) {
    setBusy(true);
    setError(null);
    try {
      const next = messageId
        ? TeamSetupResultSchema.parse(
            await buddyApi(
              `/api/buddies/messages/${encodeURIComponent(messageId)}/team-configuration`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  preview,
                  ...(preview ? {} : { expectedPlanHash: shownResult?.planHash }),
                }),
              }
            )
          )
        : await configureTeam({
            ...request,
            preview,
            ...(preview ? {} : { expectedPlanHash: shownResult?.planHash }),
          });
      setResult(next);
      if (next.receipt) onApplied?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="buddy-team-configuration">
      <p>{request.configuration.reason}</p>
      <details>
        <summary>Requested setup</summary>
        <pre className="buddy-team-configuration__request">
          {JSON.stringify(request.configuration, null, 2)}
        </pre>
      </details>
      {shownResult && (
        <BuddyTeamConfigurationResult
          result={shownResult}
          workspaceId={request.configuration.workspaceId}
        />
      )}
      {!shownResult && previewResult.loading && <output>Checking team setup…</output>}
      {!shownResult?.receipt && !applied && (
        <div className="buddy-team-configuration__actions">
          <button
            type="button"
            disabled={busy || previewResult.loading}
            onClick={() => void submit(true)}
          >
            {busy ? 'Checking…' : 'Refresh preview'}
          </button>
          {shownResult && (
            <button
              type="button"
              disabled={busy || previewResult.loading || !shownResult.canApply}
              onClick={() => void submit(false)}
            >
              Apply this team setup
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert">{error} You can retry the same setup request without duplicating it.</p>
      )}
      {previewResult.error && <p role="alert">{previewResult.error.message}</p>}
      {onEdit && (
        <button
          type="button"
          disabled={busy || previewResult.loading || (refreshing && !!shownResult?.receipt)}
          onClick={onEdit}
        >
          {shownResult?.receipt
            ? refreshing
              ? 'Refreshing saved permissions…'
              : 'Configure more'
            : 'Edit setup'}
        </button>
      )}
    </div>
  );
}

/** Roster and permission edits share the same canonical preview, apply and receipt. */
export function BuddyTeamSetup({
  buddyId,
  workspaceId,
  targets,
  grants = NO_GRANTS,
  initialTargetId,
  initialMode = 'roster',
  refreshing = false,
  onApplied,
}: {
  buddyId: string;
  workspaceId: string;
  targets: BuddyTeamAccessView['targets'];
  grants?: BuddyTeamAccessView['grants'];
  initialTargetId?: string;
  initialMode?: 'roster' | 'permissions';
  refreshing?: boolean;
  onApplied(): void;
}) {
  const [request, setRequest] = useState<SetupRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState(initialMode);
  const initialPermissionTarget = initialTargetId ?? workspaceId;
  const [targetId, setTargetId] = useState(initialPermissionTarget);
  const [rosterReason, setRosterReason] = useState('');
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, PermissionDraft>>(() => ({
    [initialPermissionTarget]: permissionDraftFromGrant(
      grants.find((entry) => entry.target_id === initialPermissionTarget)
    ),
  }));
  const grant = grants.find((entry) => entry.target_id === targetId);
  const permissionDraft = permissionDrafts[targetId] ?? permissionDraftFromGrant(grant);
  const target = targets.find((entry) => entry.id === targetId);
  const permissionsEditable =
    targetId === workspaceId || (target && target.permissionsEditable !== false);
  const savedRevision = grant?.revision ?? 0;
  const draftIsStale = permissionDraft.baseRevision !== savedRevision;
  const otherDirtyDrafts = Object.entries(permissionDrafts).filter(
    ([id, draft]) => id !== targetId && draft.dirty
  ).length;

  useEffect(() => {
    setPermissionDrafts((current) => {
      const existing = current[targetId];
      if (existing?.dirty || existing?.baseRevision === savedRevision) return current;
      return { ...current, [targetId]: permissionDraftFromGrant(grant) };
    });
  }, [grant, savedRevision, targetId]);

  const updatePermissionDraft = (update: (current: PermissionDraft) => PermissionDraft) => {
    setPermissionDrafts((current) => ({
      ...current,
      [targetId]: update(current[targetId] ?? permissionDraftFromGrant(grant)),
    }));
  };
  const setCapability = (capability: BuddyTeamCapability, enabled: boolean) => {
    updatePermissionDraft((current) => {
      const capabilities = new Set(current.capabilities);
      if (enabled) capabilities.add(capability);
      else capabilities.delete(capability);
      return { ...current, capabilities, dirty: true };
    });
  };
  return (
    <section className="buddy-team-configuration" aria-label="Configure team">
      <h3>Team settings</h3>
      <p>
        Choose existing Buddies to coordinate their work together. Their identities, documents and
        existing tasks are preserved.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          if (mode === 'permissions') {
            const revoke =
              (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'revoke';
            const enabled = (capability: BuddyTeamCapability) =>
              !revoke && permissionDraft.capabilities.has(capability);
            const permission = (resource: 'profile' | 'soul' | 'memory') =>
              enabled(`${resource}.write`)
                ? enabled(`${resource}.read`)
                  ? ('write' as const)
                  : ('write_only' as const)
                : enabled(`${resource}.read`)
                  ? ('read' as const)
                  : ('none' as const);
            const expiry = permissionDraft.expiresAt;
            const expiresAt = revoke
              ? null
              : expiry === localExpiry(permissionDraft.sourceExpiresAt)
                ? permissionDraft.sourceExpiresAt
                : expiry
                  ? new Date(expiry).toISOString()
                  : null;
            const configuration: TeamConfiguration = {
              workspaceId,
              reason: String(form.get('reason')).trim(),
              ...(targetId === workspaceId
                ? {
                    staffing: [
                      {
                        grantee: { id: buddyId },
                        enabled: enabled('staff.create'),
                        createdBuddyIncoming:
                          enabled('staff.create') && permissionDraft.createdBuddyIncoming,
                        baseRevision: permissionDraft.baseRevision,
                        expiresAt,
                      },
                    ],
                  }
                : {
                    access: [
                      {
                        grantee: { id: buddyId },
                        target: { id: targetId },
                        profile: permission('profile'),
                        soul: permission('soul'),
                        memory: permission('memory'),
                        relationships: enabled('relationship.write'),
                        incoming: enabled('execution.manage'),
                        schedules: enabled('schedule.manage'),
                        baseRevision: permissionDraft.baseRevision,
                        expiresAt,
                      },
                    ],
                  }),
            };
            setError(null);
            setRequest({ key: newId(), configuration });
            return;
          }
          const selected = form.getAll('report').map(String);
          if (!selected.length) {
            setError('Choose at least one team member.');
            return;
          }
          setError(null);
          const incoming = form.has('incoming');
          const privateDocuments = form.has('privateDocuments');
          const configuration: TeamConfiguration = {
            workspaceId,
            reason: String(form.get('reason')).trim(),
            memberships: [buddyId, ...selected].map((id) => ({
              buddy: { id },
              present: true,
              dispatch: true,
              ...(incoming ? { incoming: true } : {}),
            })),
            relationships: selected.map((id) => ({
              from: { id: buddyId },
              to: { id },
              kind: 'manager',
              present: true,
            })),
            access: selected.map((id) => ({
              grantee: { id: buddyId },
              target: { id },
              relationships: true,
              incoming: true,
              ...(form.has('profiles') ? { profile: 'write' as const } : {}),
              ...(privateDocuments ? { soul: 'write' as const, memory: 'write' as const } : {}),
            })),
          };
          setRequest({ key: newId(), configuration });
        }}
      >
        <fieldset disabled={!!request}>
          <label>
            Change
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as 'roster' | 'permissions');
                setError(null);
              }}
            >
              <option value="roster">Team members and responsibilities</option>
              <option value="permissions">This lead’s permissions</option>
            </select>
          </label>
          {mode === 'roster' ? (
            <>
              <fieldset>
                <legend>Direct reports</legend>
                {targets.map((target) =>
                  target.id === buddyId || target.permissionsEditable === false ? null : (
                    <label key={target.id}>
                      <input
                        type="checkbox"
                        name="report"
                        value={target.id}
                        defaultChecked={target.id === initialTargetId}
                      />
                      <span>
                        {target.name}
                        {target.managerId === buddyId
                          ? ' · already reports to this lead'
                          : target.managerId
                            ? ' · will change manager'
                            : ''}
                      </span>
                    </label>
                  )
                )}
              </fieldset>
              <fieldset>
                <legend>Responsibilities</legend>
                <p>
                  Work coordination includes assigning work, arranging these reports and managing
                  their incoming work.
                </p>
                <label>
                  <input type="checkbox" name="profiles" />
                  Maintain these members’ profiles
                </label>
                <label>
                  <input type="checkbox" name="privateDocuments" />
                  Maintain these members’ soul and private memory
                </label>
                <p>
                  Profile and private document access applies to each Buddy across its workspaces.
                  Granting access does not import handoffs.
                </p>
                <label>
                  <input type="checkbox" name="incoming" />
                  Enable incoming work for these members and this lead now
                </label>
                <p>
                  Existing eligible requests may start immediately, and future permitted requests
                  can run. Finish required handoff imports before enabling incoming work.
                </p>
              </fieldset>
            </>
          ) : (
            <>
              <label>
                For
                <select
                  value={targetId}
                  onChange={(event) => {
                    setTargetId(event.target.value);
                    setError(null);
                  }}
                >
                  <option value={workspaceId}>New Buddies in this workspace</option>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                  {grants.map((entry) =>
                    entry.target_id === workspaceId ||
                    targets.some((target) => target.id === entry.target_id) ? null : (
                      <option key={entry.target_id} value={entry.target_id}>
                        {entry.target_id} · no longer active here
                      </option>
                    )
                  )}
                </select>
              </label>
              {otherDirtyDrafts > 0 && (
                <output>
                  Unsaved changes for {otherDirtyDrafts}{' '}
                  {otherDirtyDrafts === 1 ? 'other target is' : 'other targets are'} preserved.
                </output>
              )}
              {permissionDraft.dirty && (
                <output>
                  Unsaved permission changes are preserved for this target. Draft based on revision{' '}
                  {permissionDraft.baseRevision}.
                </output>
              )}
              {draftIsStale && (
                <p role="alert">
                  Saved permissions are now revision {savedRevision}. This draft remains based on
                  revision {permissionDraft.baseRevision}; reviewing it will report a conflict, not
                  overwrite the newer settings. Reset to inspect the saved values.
                </p>
              )}
              {!permissionsEditable && (
                <p>This Buddy is no longer active in this team. Its saved access can be revoked.</p>
              )}
              <fieldset disabled={!permissionsEditable}>
                <legend>Permissions</legend>
                {targetId === workspaceId ? (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        name="staff.create"
                        checked={permissionDraft.capabilities.has('staff.create')}
                        onChange={(event) => setCapability('staff.create', event.target.checked)}
                      />
                      Create and import new Buddy identities
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        name="createdBuddyIncoming"
                        checked={permissionDraft.createdBuddyIncoming}
                        disabled={!permissionDraft.capabilities.has('staff.create')}
                        onChange={(event) =>
                          updatePermissionDraft((current) => ({
                            ...current,
                            createdBuddyIncoming: event.target.checked,
                            dirty: true,
                          }))
                        }
                      />
                      Allow new hires to receive work immediately
                    </label>
                  </>
                ) : (
                  <>
                    {PRIVATE_RESOURCES.map((resource) => (
                      <fieldset key={resource.key}>
                        <legend>{resource.label}</legend>
                        {(['read', 'write'] as const).map((action) => (
                          <label key={action}>
                            <input
                              type="checkbox"
                              name={`${resource.key}.${action}`}
                              checked={permissionDraft.capabilities.has(
                                `${resource.key}.${action}`
                              )}
                              onChange={(event) =>
                                setCapability(`${resource.key}.${action}`, event.target.checked)
                              }
                            />
                            {action === 'read' ? 'Read' : 'Edit (requires read access to use)'}
                          </label>
                        ))}
                      </fieldset>
                    ))}
                    <label>
                      <input
                        type="checkbox"
                        name="relationship.write"
                        checked={permissionDraft.capabilities.has('relationship.write')}
                        onChange={(event) =>
                          setCapability('relationship.write', event.target.checked)
                        }
                      />
                      Arrange reporting relationships
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        name="execution.manage"
                        checked={permissionDraft.capabilities.has('execution.manage')}
                        onChange={(event) =>
                          setCapability('execution.manage', event.target.checked)
                        }
                      />
                      Manage incoming work (requires profile read access to use)
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        name="schedule.manage"
                        checked={permissionDraft.capabilities.has('schedule.manage')}
                        onChange={(event) => setCapability('schedule.manage', event.target.checked)}
                      />
                      Activate recurring schedules
                    </label>
                    <p>
                      Profile, soul and private memory access applies across this Buddy’s
                      workspaces.
                    </p>
                  </>
                )}
                <label>
                  Expires at (your local time)
                  <input
                    type="datetime-local"
                    name="expiresAt"
                    step="any"
                    value={permissionDraft.expiresAt}
                    onChange={(event) =>
                      updatePermissionDraft((current) => ({
                        ...current,
                        expiresAt: event.target.value,
                        dirty: true,
                      }))
                    }
                  />
                </label>
                <p>Leave expiry blank for no expiry. Uncheck every permission to revoke access.</p>
              </fieldset>
              <button
                type="button"
                onClick={() =>
                  setPermissionDrafts((current) => ({
                    ...current,
                    [targetId]: permissionDraftFromGrant(grant),
                  }))
                }
              >
                Reset to saved revision {savedRevision}
              </button>
            </>
          )}
          <label>
            Reason for this change
            <input
              name="reason"
              required
              maxLength={4000}
              placeholder="What this lead should coordinate"
              value={mode === 'permissions' ? permissionDraft.reason : rosterReason}
              onChange={(event) => {
                if (mode === 'permissions') {
                  updatePermissionDraft((current) => ({
                    ...current,
                    reason: event.target.value,
                    dirty: true,
                  }));
                } else {
                  setRosterReason(event.target.value);
                }
              }}
            />
          </label>
          <p>
            Schedules, training, spending and external actions keep their separate authorization.
          </p>
          <div className="buddy-team-configuration__actions">
            <button type="submit" disabled={mode === 'permissions' && !permissionsEditable}>
              {mode === 'roster' ? 'Review team setup' : 'Review permissions'}
            </button>
            {mode === 'permissions' && grant && (
              <button type="submit" name="action" value="revoke">
                Review revocation
              </button>
            )}
          </div>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {request && (
        <BuddyTeamConfigurationRequest
          key={request.key}
          request={request}
          refreshing={refreshing}
          onApplied={() => {
            if (mode === 'permissions') {
              setPermissionDrafts((current) => {
                const next = { ...current };
                delete next[targetId];
                return next;
              });
            }
            onApplied();
          }}
          onEdit={() => {
            setRequest(null);
            onApplied();
          }}
        />
      )}
    </section>
  );
}

export function BuddyTeamSettings({
  buddyId,
  workspaceId,
  initialTargetId,
}: { buddyId: string; workspaceId: string; initialTargetId?: string }) {
  const accessPath = `/api/buddies/${encodeURIComponent(buddyId)}/access/${encodeURIComponent(workspaceId)}`;
  const source = useMemo(
    () =>
      resource(accessPath, async (signal: AbortSignal) =>
        BuddyTeamAccessViewSchema.parse(await buddyApi(accessPath, { signal }))
      ),
    [accessPath]
  );
  const { data, loading, error, refetch } = usePolledFetch(source, 0);
  if (error)
    return (
      <p role="alert">
        {error.message}{' '}
        <button type="button" onClick={refetch}>
          Reload team settings
        </button>
      </p>
    );
  if (!data) return <output>Loading team settings…</output>;
  return (
    <BuddyTeamSetup
      key={`${buddyId}:${workspaceId}:${initialTargetId ?? ''}`}
      buddyId={buddyId}
      workspaceId={workspaceId}
      targets={data.targets}
      grants={data.grants}
      initialTargetId={initialTargetId}
      initialMode={initialTargetId ? 'permissions' : 'roster'}
      refreshing={loading}
      onApplied={refetch}
    />
  );
}

export function InlineBuddyTeamConfiguration({ payload }: { payload: string }) {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(payload));
    const result = TeamSetupResultSchema.parse(parsed);
    return <BuddyTeamConfigurationResult result={result} workspaceId={result.workspaceId} />;
  } catch {
    return <p role="alert">Could not display this team configuration result.</p>;
  }
}
