import { Link } from 'react-router-dom';
import {
  EMPLOYEE_TABS,
  EMPLOYEE_TAB_LABELS,
  EMPLOYEE_TAB_LABELS_SHORT,
  buddyTabPath,
} from './buddy-tabs';
import type { EmployeeTab } from './types';

const PRIMARY: EmployeeTab[] = ['conversations', 'work', 'mailbox'];
const SECONDARY = EMPLOYEE_TABS.filter((tab) => !PRIMARY.includes(tab));
export function BuddySectionNav({
  buddyId,
  activeTab,
  compact = false,
}: { buddyId: string; activeTab: EmployeeTab; compact?: boolean }) {
  const labels = compact ? EMPLOYEE_TAB_LABELS_SHORT : EMPLOYEE_TAB_LABELS;
  const link = (tab: EmployeeTab) => (
    <Link
      key={tab}
      to={buddyTabPath(buddyId, tab)}
      aria-current={activeTab === tab ? 'page' : undefined}
    >
      {tab === 'conversations' ? 'Chats' : EMPLOYEE_TAB_LABELS[tab]}
    </Link>
  );
  return (
    <nav className="buddy-detail-nav" aria-label="Buddy sections">
      {PRIMARY.map(link)}
      <details key={activeTab} className="buddy-detail-nav__more">
        <summary aria-current={SECONDARY.includes(activeTab) ? 'true' : undefined}>
          {SECONDARY.includes(activeTab) ? labels[activeTab] : 'More'}{' '}
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="buddy-detail-nav__menu ui-card">{SECONDARY.map(link)}</div>
      </details>
    </nav>
  );
}
