import { BuddySectionNav } from '../../components/buddies/BuddySectionNav';
import '../../components/buddies/BuddyTeamExecution.css';
import { archivedBuddyIdsAtom } from '../../atoms/buddy-visibility';
import { BuddySettings } from '../../components/buddies/BuddySettings';
import { BuddyTeamExecution } from '../../components/buddies/BuddyTeamExecution';
import '../../components/buddies/BuddyMessages.css';
import '../../components/buddies/BuddyCoordination.css';
import '../../components/buddies/BuddySoulConflict.css';
import { useAtomValue } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BuddyBackgroundTasks } from '../../components/buddies/BuddyBackgroundTasks';
import '../../components/buddies/BuddyBackgroundTasks.css';
import { availableConversationIdSetAtom } from '../../atoms/conversations';
import { BuddyCoordination } from '../../components/buddies/BuddyCoordination';
import { BuddyMemoryWorkspace } from '../../components/buddies/BuddyMemoryWorkspace';
import { BuddyMessages } from '../../components/buddies/BuddyMessages';
import { buddyApi } from '../../components/buddies/api';
import { buddyTabPath, parseEmployeeTab } from '../../components/buddies/buddy-tabs';
import type { EmployeeTab } from '../../components/buddies/types';
import { initials } from '../../components/buddies/ui-contract';
import { useBuddyPage } from '../../hooks/useBuddyData';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { EmptyState } from '../components/EmptyState';
import { AutomationsTab } from './BuddyDetailAutomationsTab';
import { ConversationsTab } from './BuddyDetailConversationsTab';
import { BuddyProfileEditor } from './BuddyDetailProfileEditor';
import { WorkTab } from './BuddyDetailWorkTab';

/**
 * BuddyDetailMobile — per-buddy detail at /buddies/:buddyId (mobile).
 *
 * Orchestrator: tab components are now sibling files (BuddyDetail*Tab.tsx)
 * to keep this file ~480 lines. Each tab imports only via sanctioned seams
 * (components/buddies/*, atoms, hooks, utils) — never desktop components.
 *
 * Tabs: work / conversations / memory / automations (EmployeeTab).
 * - All data via components/buddies/{api,types,ui-contract,buddies-shaping}
 *   imported verbatim — never desktop components.
 * - Conversation awareness ONLY via getConversationKind/matchConversationKind
 *   inside buddies-shaping helpers. No raw buddyContext field reads in this file
 *   (grep gate, PLANNING §4).
 * - Provider/model/effort are pass-through strings (no translation) using
 *   atoms/config-actions for conversation config and buddyApi PATCH for the
 *   buddy profile. Strings travel verbatim to the upstream CLI.
 */

export function BuddyDetailMobile() {
  const { buddyId, tab: tabSegment } = useParams<{ buddyId: string; tab: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const chatRouteState = useMemo(() => mobileConversationRouteState(location), [location]);
  const availableIds = useAtomValue(availableConversationIdSetAtom);

  // The tab is the URL, not state (see components/buddies/buddy-tabs.ts).
  // `routedTab === null` means the URL is not canonical yet — redirect below.
  const archived = useAtomValue(archivedBuddyIdsAtom);
  const routedTab = parseEmployeeTab(tabSegment);
  const activeTab: EmployeeTab = routedTab ?? 'conversations';
  const [busy, setBusy] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Same hooks, cache keys and page model as the desktop BuddiesDashboard
  // (hooks/useBuddyData.ts): Back onto a Buddy renders from cache, no spinner.
  const openConversation = useCallback(
    (id: string) => navigate(`/chat/${id}`, { state: chatRouteState }),
    [chatRouteState, navigate]
  );
  const {
    detail,
    employee,
    automationsFetch,
    automations,
    automationError,
    setSelectedWorkspaceId,
    showReviewConversations,
    setShowReviewConversations,
    workspace,
    workspaceProjects,
    legacyWork,
    primaryProject,
    reviewConversationCount: reviewCount,
    automationConversations,
    latestWorkspaceConversation,
    talk,
    openProjectConversation,
  } = useBuddyPage(buddyId, activeTab, availableIds, openConversation);
  const loading = detail.loading;
  const error = detail.error?.message ?? null;

  if (!buddyId) {
    return (
      <div className="mobile-hub">
        <EmptyState icon="◎" message="No buddy selected." />
      </div>
    );
  }

  if (buddyId && archived.has(buddyId)) return <Navigate to="/buddies" replace />;

  // Canonicalise `/buddies/:id` (and any junk tab segment) onto a real tab URL.
  if (routedTab === null) {
    return <Navigate to={buddyTabPath(buddyId, activeTab)} replace />;
  }

  if (loading) {
    return (
      <div className="mobile-hub" aria-live="polite" aria-busy="true">
        <p className="mobile-empty__message">Loading buddy…</p>
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="mobile-hub">
        <EmptyState
          icon="⚠"
          title="Could not load buddy"
          message={error ?? 'Buddy not found.'}
          actionLabel="Back to Buddies"
          onAction={() => navigate('/buddies')}
        />
      </div>
    );
  }

  return (
    <div className="mobile-hub mobile-buddy-detail">
      <header className="mobile-buddy-detail__hero">
        <Link to="/buddies" className="mobile-buddy-detail__back" aria-label="Back to Buddies">
          ← Buddies
        </Link>
        <div className="mobile-buddy-detail__identity">
          <span className="mobile-buddy-card__avatar" aria-hidden="true">
            {initials(employee.buddy.name)}
          </span>
          <div className="mobile-buddy-detail__copy">
            <h1 className="mobile-buddy-detail__name">{employee.buddy.name}</h1>
            <details className="mobile-buddy-detail__description">
              <summary>About this buddy</summary>
              <p className="mobile-buddy-detail__role">{employee.buddy.role}</p>
            </details>
          </div>
        </div>
      </header>

      <BuddySectionNav buddyId={buddyId} activeTab={activeTab} compact />

      {activeTab === 'mailbox' && (
        <BuddyMessages
          key={employee.buddy.id}
          buddyId={employee.buddy.id}
          workspaceId={workspace?.id}
          buddyNames={Object.fromEntries(
            [
              employee.buddy,
              ...employee.directReports,
              ...(employee.manager ? [employee.manager] : []),
            ].map((member) => [member.id, member.name])
          )}
          messages={employee.messages}
          availableConversationIds={availableIds}
          onReply={async (messageId, reply) => {
            await buddyApi(`/api/buddies/messages/${encodeURIComponent(messageId)}/reply`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(reply),
            });
            await detail.refetch();
          }}
        />
      )}

      {activeTab === 'work' && (
        <WorkTab
          employee={employee}
          workspace={workspace}
          workspaces={employee.workspaces}
          onSelectWorkspace={setSelectedWorkspaceId}
          workspaceProjects={workspaceProjects}
          legacyWork={legacyWork}
          primaryProject={primaryProject}
          latestWorkspaceConversation={latestWorkspaceConversation}
          onTalk={talk}
          onOpenProjectConversation={openProjectConversation}
        />
      )}

      {activeTab === 'conversations' && (
        <ConversationsTab
          conversations={employee.conversations}
          reviewCount={reviewCount}
          showReviewConversations={showReviewConversations}
          onToggleReviews={() => setShowReviewConversations((value) => !value)}
          workspace={workspace}
          onTalk={() => workspace && talk(workspace)}
        />
      )}

      {activeTab === 'background' && (
        <BuddyBackgroundTasks buddyId={employee.buddy.id} workspaces={employee.workspaces} />
      )}

      {activeTab === 'memory' && (
        <BuddyMemoryWorkspace
          key={`${employee.buddy.id}:${workspace?.id}`}
          buddy={employee.buddy}
          workspaceId={workspace?.id ?? ''}
          variant="mobile"
        />
      )}

      {activeTab === 'team' && (
        <>
          {/* Sub-buddies get their own block rather than inline links in the meta
            row, where they ran together as one unbroken string ("3 reports:
            AliceBobCarol") and read as prose instead of navigation. This is the
            ONLY route to a sub-buddy: the Buddies directory lists `topLevel`
            only, i.e. buddies with no manager. */}
          {employee.directReports.length > 0 && (
            <div className="mobile-buddy-reports">
              <span className="mobile-buddy-reports__title">
                {employee.directReports.length}{' '}
                {employee.directReports.length === 1 ? 'direct report' : 'direct reports'}
              </span>
              <div className="mobile-buddy-reports__list">
                {employee.directReports.map((report) => (
                  <Link
                    key={report.id}
                    className="mobile-buddy-reports__item"
                    to={`/buddies/${encodeURIComponent(report.id)}`}
                  >
                    {report.name}
                    {report.status === 'archived' ? ' · Archived' : ''}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {workspace && (
            <BuddyTeamExecution
              key={`${employee.buddy.id}:${workspace.id}`}
              buddyId={employee.buddy.id}
              workspaceId={workspace.id}
              availableConversationIds={availableIds}
            />
          )}
        </>
      )}
      {activeTab === 'settings' && (
        <>
          <h2 className="mobile-buddy-settings-title">Settings</h2>
          <div className="mobile-buddy-detail__meta">
            <span>
              Reports to{' '}
              {employee.manager ? (
                <Link to={`/buddies/${encodeURIComponent(employee.manager.id)}`}>
                  {employee.manager.name}
                </Link>
              ) : (
                <strong>Owner</strong>
              )}
            </span>
            <span>
              {employee.skills.length} {employee.skills.length === 1 ? 'skill' : 'skills'}
            </span>
          </div>

          <BuddyProfileEditor
            workspaceId={workspace?.id}
            buddy={employee.buddy}
            busy={busy === 'profile'}
            error={profileError}
            onBusy={(value) => setBusy(value ? 'profile' : null)}
            onError={setProfileError}
            onSaved={() => void detail.refetch()}
          />

          <BuddyCoordination
            key={employee.buddy.id}
            buddyId={employee.buddy.id}
            availableConversationIds={availableIds}
          />
          <BuddySettings buddyId={employee.buddy.id} name={employee.buddy.name} />
        </>
      )}

      {activeTab === 'automations' && (
        <AutomationsTab
          buddyId={employee.buddy.id}
          workspaceId={workspace?.id}
          automations={automations}
          automationConversations={automationConversations}
          busy={busy}
          setBusy={setBusy}
          error={automationError}
          availableIds={availableIds}
          onRefresh={() => void automationsFetch.refetch()}
        />
      )}
    </div>
  );
}
import '../../components/buddies/BuddyProjectExecution.css';
