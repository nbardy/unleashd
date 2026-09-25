/**
 * client/src/components/buddies/BuddyTabContent.tsx
 *
 * Everything below a Buddy page's hero, shared by the desktop BuddiesDashboard
 * and mobile BuddyDetailMobile (mobile may import components/buddies/, gate
 * G3). The shells differ only in their hero; each tab is one handler here.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BuddyBackgroundTasks } from './BuddyBackgroundTasks';
import { BuddyConversationList } from './BuddyConversationList';
import { BuddyMemory } from './BuddyMemory';
import { BuddyMessages } from './BuddyMessages';
import { BuddySchedules } from './BuddySchedules';
import { BuddySettings } from './BuddySettings';
import { BuddyWork } from './BuddyWork';
import { buddyAction, errorText } from './api';
import { buddyNamesOf, directReportsOf, findBuddy, isActive } from './roster';
import type { Buddy, BuddyDetail, BuddyOverview, EmployeeTab, WorkspaceRoster } from './types';

/** What every tab reads: the detail bundle, the overview it names people from, and actions. */
export interface BuddyPageModel {
  detail: BuddyDetail;
  overview: BuddyOverview;
  workspace: WorkspaceRoster;
  talk: () => void;
  refresh: () => Promise<void>;
}

const TABS: { [K in EmployeeTab]: (page: BuddyPageModel) => ReactElement } = {
  conversations: (page) => (
    <section className="buddy-panel" aria-label="Conversations">
      <div className="buddy-panel__title">
        <h2>Conversations</h2>
        <button type="button" onClick={page.talk}>
          Start conversation
        </button>
      </div>
      <BuddyConversationList buddyId={page.detail.buddy.id} />
    </section>
  ),
  work: (page) => (
    <BuddyWork
      buddyId={page.detail.buddy.id}
      tasks={page.detail.tasks}
      names={buddyNamesOf(page.overview)}
      refresh={page.refresh}
    />
  ),
  mailbox: (page) => (
    <BuddyMessages
      buddyId={page.detail.buddy.id}
      workspaceId={page.detail.buddy.workspaceId}
      names={buddyNamesOf(page.overview)}
    />
  ),
  background: (page) => (
    <BuddyBackgroundTasks
      buddyId={page.detail.buddy.id}
      runs={page.detail.runs}
      refresh={page.refresh}
    />
  ),
  memory: (page) => (
    <BuddyMemory buddyId={page.detail.buddy.id} workspaceId={page.detail.buddy.workspaceId} />
  ),
  schedules: (page) => (
    <BuddySchedules
      buddyId={page.detail.buddy.id}
      schedules={page.detail.schedules}
      runs={page.detail.runs}
      refresh={page.refresh}
    />
  ),
  settings: (page) => (
    <BuddySettings
      buddy={page.detail.buddy}
      managers={page.workspace.buddies.filter(
        (candidate) => isActive(candidate) && candidate.id !== page.detail.buddy.id
      )}
      refresh={page.refresh}
    />
  ),
};

/** Thin dispatcher: one handler per tab, exhaustive by the mapped type. */
export function BuddyTabContent({ tab, page }: { tab: EmployeeTab; page: BuddyPageModel }) {
  return TABS[tab](page);
}

/** Who the Buddy reports to and who reports to it, as links. */
export function BuddyRelations({ buddy, overview }: { buddy: Buddy; overview: BuddyOverview }) {
  const manager = buddy.managerId === undefined ? undefined : findBuddy(overview, buddy.managerId);
  const reports = directReportsOf(overview, buddy.id);
  return (
    <div className="buddy-relations">
      <span>
        Reports to{' '}
        {manager ? (
          <Link to={`/buddies/${encodeURIComponent(manager.id)}`}>{manager.name}</Link>
        ) : (
          <strong>you</strong>
        )}
      </span>
      {reports.length > 0 && (
        <span className="buddy-relations__reports">
          {reports.length === 1 ? '1 report:' : `${reports.length} reports:`}
          {reports.map((report) => (
            <Link key={report.id} to={`/buddies/${encodeURIComponent(report.id)}`}>
              {report.name}
            </Link>
          ))}
        </span>
      )}
    </div>
  );
}

type DirectAction = { kind: 'idle' } | { kind: 'pending' } | { kind: 'done'; message: string };

/**
 * Start a new chat, open the owner's ongoing chat with the Buddy (`/direct`),
 * or wake it (`/wake` queues a catch-up turn in that chat). Buttons, not links:
 * the click creates or resolves the thread, so there is no id for an href yet.
 */
export function BuddyPageActions({
  buddy,
  talk,
  openConversation,
}: {
  buddy: Buddy;
  talk: () => void;
  openConversation: (conversationId: string) => void;
}) {
  const [state, setState] = useState<DirectAction>({ kind: 'idle' });
  const base = `/api/buddies/${encodeURIComponent(buddy.id)}`;
  const request = (path: 'direct' | 'wake', then: (conversationId: string) => string | null) => {
    setState({ kind: 'pending' });
    buddyAction<{ conversationId: string }>(`${base}/${path}`)
      .then(({ conversationId }) => {
        const message = then(conversationId);
        setState(message === null ? { kind: 'idle' } : { kind: 'done', message });
      })
      .catch((cause) => setState({ kind: 'done', message: errorText(cause) }));
  };
  const pending = state.kind === 'pending';
  return (
    <div className="buddy-page-actions">
      <button type="button" disabled={pending} onClick={talk}>
        Start conversation
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          request('direct', (conversationId) => {
            openConversation(conversationId);
            return null;
          })
        }
      >
        Chat
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => request('wake', () => `${buddy.name} is catching up in your chat.`)}
      >
        Wake
      </button>
      {state.kind === 'done' && <output>{state.message}</output>}
    </div>
  );
}
