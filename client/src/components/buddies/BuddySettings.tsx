import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hideArchivedBuddy } from '../../atoms/buddy-visibility';
import { useProviderCatalog } from '../../hooks/useProviderCatalog';
import { buddyAction, buddyWrite } from './api';
import type { Buddy } from './types';
import { ActionError, useBuddyAction } from './useBuddyAction';
import './BuddySettings.css';

/** The editable profile, as form strings. '' is "not set" (only offered while unset). */
type ProfileFields = {
  name: string;
  role: string;
  provider: string;
  model: string;
  reasoningEffort: string;
  managerId: string;
  backgroundEnabled: boolean;
  maxActiveRuns: number;
};

const fieldsOf = (buddy: Buddy): ProfileFields => ({
  name: buddy.name,
  role: buddy.role,
  provider: buddy.provider ?? '',
  model: buddy.model ?? '',
  reasoningEffort: buddy.reasoningEffort ?? '',
  managerId: buddy.managerId ?? '',
  backgroundEnabled: buddy.backgroundEnabled,
  maxActiveRuns: buddy.maxActiveRuns,
});

/**
 * PATCH body: only the changed fields. `managerId` '' is "reports to the owner"
 * (null on the wire). Provider, model and effort cannot be cleared once set —
 * the route has no "unset" — so their '' option exists only while they are unset.
 */
export function profileChanges(before: ProfileFields, after: ProfileFields) {
  const changed = <K extends keyof ProfileFields>(key: K) => before[key] !== after[key];
  return {
    ...(changed('name') ? { name: after.name } : {}),
    ...(changed('role') ? { role: after.role } : {}),
    ...(changed('provider') ? { provider: after.provider } : {}),
    ...(changed('model') ? { model: after.model } : {}),
    ...(changed('reasoningEffort') ? { reasoningEffort: after.reasoningEffort } : {}),
    ...(changed('managerId') ? { managerId: after.managerId === '' ? null : after.managerId } : {}),
    ...(changed('backgroundEnabled') ? { backgroundEnabled: after.backgroundEnabled } : {}),
    ...(changed('maxActiveRuns') ? { maxActiveRuns: after.maxActiveRuns } : {}),
  };
}

function ProfileForm({
  buddy,
  managers,
  refresh,
}: {
  buddy: Buddy;
  managers: readonly Buddy[];
  refresh: () => Promise<void>;
}) {
  const initial = fieldsOf(buddy);
  const [fields, setFields] = useState(initial);
  const { catalog, error } = useProviderCatalog();
  const action = useBuddyAction(refresh);
  const set = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) =>
    setFields((previous) => ({ ...previous, [key]: value }));
  const providerInfo = catalog?.providers.find((candidate) => candidate.id === fields.provider);
  const providers = catalog?.providers.filter(
    (candidate) => candidate.supportsRequiredMcp || candidate.id === fields.provider
  );
  const selectedModel = providerInfo?.models.find((candidate) => candidate.id === fields.model);
  const changes = profileChanges(initial, fields);
  const unset = (value: string, label: string) =>
    value === '' ? <option value="">{label}</option> : null;

  return (
    <form
      className="buddy-panel__form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run('profile', () =>
          buddyWrite(`/api/buddies/${encodeURIComponent(buddy.id)}`, 'PATCH', changes)
        );
      }}
    >
      <label>
        Name
        <input required value={fields.name} onChange={(event) => set('name', event.target.value)} />
      </label>
      <label>
        Role
        <textarea
          required
          rows={3}
          value={fields.role}
          onChange={(event) => set('role', event.target.value)}
        />
      </label>
      <label>
        Reports to
        <select value={fields.managerId} onChange={(event) => set('managerId', event.target.value)}>
          <option value="">You (the owner)</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="buddy-panel__error">Provider catalog unavailable: {error.message}</p>}
      <label>
        Provider
        <select
          value={fields.provider}
          onChange={(event) => {
            // A new provider starts on its own default model and effort, so the
            // patch never carries a model of the previous provider.
            const next = catalog?.providers.find(
              (candidate) => candidate.id === event.target.value
            );
            const model = next?.models.find((candidate) => candidate.id === next.defaultModelId);
            set('provider', event.target.value);
            set('model', model?.id ?? '');
            set('reasoningEffort', model?.reasoning?.defaultEffort ?? '');
          }}
        >
          {unset(initial.provider, 'Server default')}
          {(providers ?? []).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.displayName}
              {candidate.supportsRequiredMcp ? '' : ' (unsupported for Buddy turns)'}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        <select value={fields.model} onChange={(event) => set('model', event.target.value)}>
          {unset(fields.model, 'Provider default')}
          {providerInfo?.models.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reasoning
        <select
          value={fields.reasoningEffort}
          onChange={(event) => set('reasoningEffort', event.target.value)}
        >
          {unset(fields.reasoningEffort, 'Model default')}
          {(selectedModel?.reasoning?.levels ?? []).map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </select>
      </label>
      <label>
        Concurrent runs
        <input
          type="number"
          min={1}
          value={fields.maxActiveRuns}
          onChange={(event) => set('maxActiveRuns', Number(event.target.value))}
        />
      </label>
      <label className="buddy-panel__check">
        <input
          type="checkbox"
          checked={fields.backgroundEnabled}
          onChange={(event) => set('backgroundEnabled', event.target.checked)}
        />
        Background work enabled
      </label>
      <button type="submit" disabled={action.busy || Object.keys(changes).length === 0}>
        {action.busy ? 'Saving…' : 'Save settings'}
      </button>
      <ActionError state={action.state} />
    </form>
  );
}

function ArchiveBuddy({ buddy }: { buddy: Buddy }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const action = useBuddyAction(async () => {
    hideArchivedBuddy(buddy.id);
    navigate('/buddies', { replace: true });
  });
  const archive = () =>
    void action.run('archive', () =>
      buddyAction(`/api/buddies/${encodeURIComponent(buddy.id)}`, 'DELETE')
    );
  return (
    <section className="buddy-settings" aria-labelledby="buddy-settings-title">
      <h2 id="buddy-settings-title">Archive Buddy</h2>
      <p>
        Archive {buddy.name}: its queued runs are cancelled and it leaves the roster. Its posts,
        docs and history are kept.
      </p>
      {confirming ? (
        <div className="buddy-settings-actions">
          <button type="button" disabled={action.busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="buddy-settings-delete"
            disabled={action.busy}
            onClick={archive}
          >
            {action.busy ? 'Archiving…' : `Archive ${buddy.name}`}
          </button>
        </div>
      ) : (
        <button type="button" className="buddy-settings-delete" onClick={() => setConfirming(true)}>
          Archive
        </button>
      )}
      <ActionError state={action.state} />
    </section>
  );
}

/**
 * Settings, one form for both shells. `managers`: the active Buddies of the
 * same workspace other than this one (the server refuses a reporting cycle).
 */
export function BuddySettings({
  buddy,
  managers,
  refresh,
}: {
  buddy: Buddy;
  managers: readonly Buddy[];
  refresh: () => Promise<void>;
}) {
  return (
    <section className="buddy-panel" aria-label="Settings">
      <div className="buddy-panel__title">
        <h2>Settings</h2>
      </div>
      {/* Keyed by every stored field: a save (or another device's) resets the draft. */}
      <ProfileForm
        key={JSON.stringify(fieldsOf(buddy))}
        buddy={buddy}
        managers={managers}
        refresh={refresh}
      />
      <ArchiveBuddy buddy={buddy} />
    </section>
  );
}
