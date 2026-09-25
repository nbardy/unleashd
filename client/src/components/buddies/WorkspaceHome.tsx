import { useAtomValue } from 'jotai';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { recentDirectoriesAtom } from '../../atoms/conversations';
import { useBuddyOverview } from '../../hooks/useBuddyData';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { useTimeTick } from '../../hooks/useTimeTick';
import { shortenHomePath } from '../../utils/directories';
import { formatTimeAgo } from '../../utils/time';
import { PathAutocomplete } from '../PathAutocomplete';
import { BuddySigil } from './BuddySigil';
import { buddyApi } from './api';
import { ownerUnreadTotal, useOwnerUnread } from './channel-data';
import {
  type WorkspaceActivity,
  type WorkspaceHomeRow,
  type WorkspaceRecord,
  workspaceHomeSections,
} from './workspace-home';
import './WorkspaceHome.css';

export const WORKSPACES_PATH = '/api/buddies/workspaces';

const WorkspaceRecordSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  root_path: z.string().min(1),
});

const WorkspaceListSchema = z.object({
  workspaces: z.array(WorkspaceRecordSchema),
});

const workspacesResource = resource(WORKSPACES_PATH, async (signal) =>
  WorkspaceListSchema.parse(await buddyApi(WORKSPACES_PATH, { signal }))
);

const EMPTY_WORKSPACES: WorkspaceRecord[] = [];

// Desktop `/` renders outside the shell (no conversations sidebar), so this
// bar is its way to the other top-level pages. Phones keep the tab bar and
// hide it in CSS.
const DESTINATIONS = [
  { to: '/chats', label: 'Chats' },
  { to: '/buddies', label: 'Buddies' },
  { to: '/workers', label: 'Workers' },
] as const;

function channelsPath(workspaceId: string): string {
  return `/buddies/workspaces/${encodeURIComponent(workspaceId)}/channels`;
}

export function WorkspaceHome() {
  const workspaces = usePolledFetch(workspacesResource, 30_000);
  const unread = useOwnerUnread();
  const overview = useBuddyOverview(30_000);
  const [creating, setCreating] = useState(false);

  const records = workspaces.data?.workspaces ?? EMPTY_WORKSPACES;
  const totals = new Map(
    records.map((workspace) => [workspace.id, ownerUnreadTotal(unread.data, workspace.id)])
  );
  const { recent, rest } = workspaceHomeSections(records, totals, overview.data?.recentRuns ?? []);

  return (
    <div className="workspace-home">
      <nav className="workspace-home-nav" aria-label="Pages">
        <span className="workspace-home-brand">unleashd</span>
        <span className="workspace-home-nav-links">
          {DESTINATIONS.map((destination) => (
            <Link key={destination.to} to={destination.to}>
              {destination.label}
            </Link>
          ))}
        </span>
      </nav>

      <main className="workspace-home-body">
        <header className="workspace-home-header">
          <h1>
            Workspaces
            {records.length > 0 && <span className="workspace-home-count">{records.length}</span>}
          </h1>
          <button
            type="button"
            className="workspace-home-button workspace-home-button--primary"
            onClick={() => setCreating(true)}
            disabled={creating}
          >
            New workspace
          </button>
        </header>

        {creating && (
          <CreateWorkspace onClose={() => setCreating(false)} onCreated={workspaces.refetch} />
        )}

        {workspaces.kind === 'failed' && (
          <p className="workspace-home-error" role="alert">
            {workspaces.error.message}{' '}
            <button
              type="button"
              className="workspace-home-button"
              onClick={() => void workspaces.refetch()}
            >
              Retry
            </button>
          </p>
        )}
        {(workspaces.kind === 'loading' || workspaces.kind === 'idle') && (
          <p className="workspace-home-status">Loading…</p>
        )}
        {workspaces.data && records.length === 0 && (
          <p className="workspace-home-status">No workspaces yet. Create one from a folder.</p>
        )}

        {recent.length > 0 && (
          <section aria-labelledby="workspace-home-recent">
            <h2 id="workspace-home-recent" className="workspace-home-section">
              Recent
            </h2>
            <ul className="workspace-home-tiles">
              {recent.map((row) => (
                <li key={row.id}>
                  <WorkspaceTile row={row} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {rest.length > 0 && (
          <section aria-labelledby="workspace-home-rest">
            <h2 id="workspace-home-rest" className="workspace-home-section">
              {recent.length > 0 ? 'Other workspaces' : 'All workspaces'}
            </h2>
            <ul className="workspace-home-list">
              {rest.map((row) => (
                <li key={row.id}>
                  <WorkspaceListRow row={row} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

function WorkspaceTile({ row }: { row: WorkspaceHomeRow }) {
  return (
    <Link className="workspace-home-tile" to={channelsPath(row.id)}>
      <span className="workspace-home-tile-top">
        <BuddySigil className="workspace-home-icon workspace-home-icon--large" name={row.name} />
        <Notifications row={row} />
      </span>
      <span className="workspace-home-name">{row.name}</span>
      <span className="workspace-home-path">{shortenHomePath(row.root_path)}</span>
      <Activity activity={row.activity} />
    </Link>
  );
}

function WorkspaceListRow({ row }: { row: WorkspaceHomeRow }) {
  return (
    <Link className="workspace-home-row" to={channelsPath(row.id)}>
      <BuddySigil className="workspace-home-icon" name={row.name} />
      <span className="workspace-home-row-copy">
        <span className="workspace-home-name">{row.name}</span>
        <span className="workspace-home-path">{shortenHomePath(row.root_path)}</span>
      </span>
      <Activity activity={row.activity} />
      <Notifications row={row} />
    </Link>
  );
}

/** Replies waiting on you are a count; channels with new posts are a dot. */
function Notifications({ row }: { row: WorkspaceHomeRow }) {
  if (row.repliesToYou > 0) {
    const label = `${row.repliesToYou} ${row.repliesToYou === 1 ? 'reply' : 'replies'} to you`;
    return (
      <span className="workspace-home-badge" title={label} aria-label={label}>
        {row.repliesToYou}
      </span>
    );
  }
  if (row.unreadChannels > 0) {
    const label = `New posts in ${row.unreadChannels} ${row.unreadChannels === 1 ? 'channel' : 'channels'}`;
    return <span className="workspace-home-dot" title={label} aria-label={label} />;
  }
  return <span className="workspace-home-badge-slot" aria-hidden="true" />;
}

function Activity({ activity }: { activity: WorkspaceActivity }) {
  switch (activity.kind) {
    case 'active':
      return <ActiveBuddies activity={activity} />;
    case 'quiet':
      return null;
  }
}

function ActiveBuddies({ activity }: { activity: Extract<WorkspaceActivity, { kind: 'active' }> }) {
  useTimeTick();
  const names = activity.buddies.map((buddy) => buddy.name).join(', ');
  return (
    <span className="workspace-home-activity" title={`Recently active: ${names}`}>
      <span className="workspace-home-faces">
        {activity.buddies.map((buddy) => (
          <BuddySigil key={buddy.id} className="workspace-home-face" name={buddy.name} />
        ))}
      </span>
      <time dateTime={activity.lastActiveAt}>{formatTimeAgo(new Date(activity.lastActiveAt))}</time>
    </span>
  );
}

function CreateWorkspace({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const recentDirectories = useAtomValue(recentDirectoriesAtom);
  const [finderOpen, setFinderOpen] = useState(false);
  const [name, setName] = useState('');
  const [directory, setDirectory] = useState('');
  const [valid, setValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folder = directory.trim();
  const folderName = folder.replace(/\/+$/, '').split('/').pop() ?? '';
  // PathAutocomplete reports an empty input as valid, so a folder is required on top.
  const ready = valid && folder.length > 0;

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await buddyApi<{ workspace: WorkspaceRecord }>(WORKSPACES_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rootPath: folder, ...(name.trim() ? { name: name.trim() } : {}) }),
      });
      await onCreated().catch(() => undefined);
      navigate(channelsPath(payload.workspace.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <form className="workspace-home-create" onSubmit={(event) => void handleCreate(event)}>
      <div className="workspace-home-field">
        <span className="workspace-home-label">Folder</span>
        {finderOpen ? (
          <PathAutocomplete
            value={directory}
            onChange={setDirectory}
            recentDirectories={recentDirectories}
            placeholder="Search recent folders or type a path…"
            className="workspace-home-directory"
            onValidationChange={setValid}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="workspace-home-button workspace-home-folder"
            onClick={() => setFinderOpen(true)}
          >
            <FolderGlyph />
            <span>{folder ? shortenHomePath(folder) : 'Choose a folder'}</span>
          </button>
        )}
      </div>
      <label className="workspace-home-field">
        <span className="workspace-home-label">Name</span>
        <input
          className="workspace-home-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onFocus={() => setFinderOpen(false)}
          placeholder={folderName || 'Defaults to the folder name'}
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
        />
      </label>
      {error && (
        <p className="workspace-home-error" role="alert">
          {error}
        </p>
      )}
      <div className="workspace-home-actions">
        <button type="button" className="workspace-home-button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="submit"
          className="workspace-home-button workspace-home-button--primary"
          disabled={!ready || busy}
        >
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </div>
    </form>
  );
}

function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.75 3.5h4.2l1.5 1.5h6.8v7.75H1.75z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
