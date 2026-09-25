import { useState } from 'react';
import { BuddyRunList } from './BuddyRunList';
import { buddyAction, buddyWrite } from './api';
import type { Run, Schedule } from './types';
import { ActionError, useBuddyAction } from './useBuddyAction';

type ScheduleFields = Pick<Schedule, 'name' | 'cron' | 'timezone' | 'prompt' | 'enabled'>;

const NEW_SCHEDULE = (): ScheduleFields => ({
  name: '',
  cron: '0 9 * * 1-5',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  prompt: '',
  enabled: true,
});

const fieldsOf = (schedule: Schedule): ScheduleFields => ({
  name: schedule.name,
  cron: schedule.cron,
  timezone: schedule.timezone,
  prompt: schedule.prompt,
  enabled: schedule.enabled,
});

const schedulesUrl = (buddyId: string) => `/api/buddies/${encodeURIComponent(buddyId)}/schedules`;

/** Create (POST) or replace (PUT) a schedule; disabling is `enabled: false` — there is no delete. */
function ScheduleForm({
  initial,
  submitLabel,
  save,
  refresh,
}: {
  initial: ScheduleFields;
  submitLabel: string;
  save: (fields: ScheduleFields) => Promise<unknown>;
  refresh: () => Promise<void>;
}) {
  const [fields, setFields] = useState(initial);
  const action = useBuddyAction(refresh);
  const set = <K extends keyof ScheduleFields>(key: K, value: ScheduleFields[K]) =>
    setFields((previous) => ({ ...previous, [key]: value }));
  return (
    <form
      className="buddy-panel__form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run('save', () => save(fields));
      }}
    >
      <label>
        Name
        <input required value={fields.name} onChange={(event) => set('name', event.target.value)} />
      </label>
      <label>
        Cron
        <input required value={fields.cron} onChange={(event) => set('cron', event.target.value)} />
      </label>
      <label>
        Time zone
        <input
          required
          value={fields.timezone}
          onChange={(event) => set('timezone', event.target.value)}
        />
      </label>
      <label>
        Prompt
        <textarea
          required
          rows={4}
          value={fields.prompt}
          onChange={(event) => set('prompt', event.target.value)}
        />
      </label>
      <label className="buddy-panel__check">
        <input
          type="checkbox"
          checked={fields.enabled}
          onChange={(event) => set('enabled', event.target.checked)}
        />
        Enabled
      </label>
      <button type="submit" disabled={action.busy}>
        {submitLabel}
      </button>
      <ActionError state={action.state} />
    </form>
  );
}

function ScheduleCard({
  schedule,
  runs,
  refresh,
}: {
  schedule: Schedule;
  runs: readonly Run[];
  refresh: () => Promise<void>;
}) {
  const action = useBuddyAction(refresh);
  const url = `${schedulesUrl(schedule.buddyId)}/${encodeURIComponent(schedule.id)}`;
  const history = runs.filter(
    (run) => run.input.kind === 'schedule' && run.input.scheduleId === schedule.id
  );
  return (
    <details className="buddy-work-disclosure">
      <summary>
        <strong>{schedule.name}</strong>
        <span>
          {schedule.enabled ? 'Enabled' : 'Disabled'} · {schedule.cron} ({schedule.timezone})
          {schedule.nextRunAt ? ` · next ${new Date(schedule.nextRunAt).toLocaleString()}` : ''}
        </span>
      </summary>
      <div className="buddy-panel__actions">
        <button
          type="button"
          disabled={action.busy}
          onClick={() => void action.run('run', () => buddyAction(`${url}/run`))}
        >
          Run now
        </button>
      </div>
      <ActionError state={action.state} />
      <ScheduleForm
        key={`${schedule.id}:${schedule.enabled}:${schedule.cron}:${schedule.name}`}
        initial={fieldsOf(schedule)}
        submitLabel="Save schedule"
        save={(fields) => buddyWrite(url, 'PUT', fields)}
        refresh={refresh}
      />
      <h4 className="buddy-panel__heading">History</h4>
      <BuddyRunList runs={history} refresh={refresh} empty="This schedule has not run yet." />
    </details>
  );
}

/** A Buddy's schedules (they replaced automations); history is its schedule-input runs. */
export function BuddySchedules({
  buddyId,
  schedules,
  runs,
  refresh,
}: {
  buddyId: string;
  schedules: readonly Schedule[];
  runs: readonly Run[];
  refresh: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(0);
  const live = schedules.filter((schedule) => schedule.archivedAt === undefined);
  return (
    <section className="buddy-panel" aria-label="Schedules">
      <div className="buddy-panel__title">
        <h2>Schedules</h2>
        <span>{live.filter((schedule) => schedule.enabled).length} enabled</span>
      </div>
      {live.length === 0 && <p className="buddy-panel__empty">No schedules yet.</p>}
      {live.map((schedule) => (
        <ScheduleCard key={schedule.id} schedule={schedule} runs={runs} refresh={refresh} />
      ))}
      <details className="buddy-work-history">
        <summary>New schedule</summary>
        <ScheduleForm
          key={creating}
          initial={NEW_SCHEDULE()}
          submitLabel="Create schedule"
          save={async (fields) => {
            await buddyWrite(schedulesUrl(buddyId), 'POST', fields);
            setCreating((count) => count + 1);
          }}
          refresh={refresh}
        />
      </details>
    </section>
  );
}
