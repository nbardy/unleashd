import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hideArchivedBuddy } from '../../atoms/buddy-visibility';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { BuddyApiError, buddyApi } from './api';
import './BuddySettings.css';

export function BuddySettings({ buddyId, name }: { buddyId: string; name: string }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/buddies/${encodeURIComponent(buddyId)}`;
  const checkAvailability = useMemo(
    () =>
      resource('/api/buddies/capabilities/archive#available', async (signal: AbortSignal) => {
        const response = await fetch('/api/buddies/capabilities/archive', { signal });
        if (response.status === 404) return false;
        if (!response.ok) throw new Error('Could not check whether deletion is available.');
        const payload: unknown = await response.json().catch(() => null);
        return (
          !!payload &&
          typeof payload === 'object' &&
          'available' in payload &&
          payload.available === true
        );
      }),
    []
  );
  const availability = usePolledFetch(checkAvailability, 5_000);
  // Only a check that just succeeded enables Delete; a failed recheck (`stale`)
  // does not ride on the last answer.
  const canDelete = availability.kind === 'ready' && availability.data;
  async function archive() {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    try {
      await buddyApi(path, { method: 'DELETE' });
      hideArchivedBuddy(buddyId);
      navigate('/buddies', { replace: true });
    } catch (cause) {
      setError(
        cause instanceof BuddyApiError && cause.status === 404
          ? 'Deletion is unavailable on the running server, or this Buddy was already archived. Reload the page after the server updates.'
          : cause instanceof Error
            ? cause.message
            : String(cause)
      );
      availability.refetch();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="buddy-settings" aria-labelledby="buddy-settings-title">
      <h2 id="buddy-settings-title">Delete Buddy</h2>
      <p>
        Archive {name} and hide it and its conversations from the app. Automations will be disabled
        and active conversations stopped. Its records and memory are preserved.
      </p>
      {confirming ? (
        <div>
          <p>Delete {name}?</p>
          <div className="buddy-settings-actions">
            <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="buddy-settings-delete"
              disabled={busy || !canDelete}
              onClick={() => void archive()}
            >
              {busy ? 'Deleting…' : 'Delete Buddy'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="buddy-settings-delete"
          disabled={!canDelete}
          onClick={() => setConfirming(true)}
        >
          Delete
        </button>
      )}
      {availability.data === false && (
        <p role="status">
          Delete is waiting for the server update. Active agent turns must finish before the server
          can reload safely. This button will enable automatically.
        </p>
      )}
      {availability.kind === 'loading' && <p role="status">Checking availability…</p>}
      {(availability.kind === 'failed' || availability.kind === 'stale') && (
        <p role="alert">{availability.error.message}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
