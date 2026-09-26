/**
 * client/src/components/buddies/BuddyTabContent.tsx
 *
 * Everything below a Buddy page's hero (BuddyPage.tsx, mounted by both trees).
 * Each tab is one handler here.
 */
import type { ReactElement } from 'react';
import { BuddyBackgroundTasks } from './BuddyBackgroundTasks';
import { BuddyConversationList } from './BuddyConversationList';
import { BuddyMemory } from './BuddyMemory';
import { BuddyMessages } from './BuddyMessages';
import { BuddySchedules } from './BuddySchedules';
import { BuddySettings } from './BuddySettings';
import { BuddyWork } from './BuddyWork';
import { buddyNamesOf, isActive } from './roster';
import type { BuddyDetail, BuddyOverview, EmployeeTab, WorkspaceRoster } from './types';

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
      <div className="buddy-panel__title ui-row">
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
