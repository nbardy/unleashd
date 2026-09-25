import { useAtomValue } from 'jotai';
import { useCallback, useMemo } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { archivedBuddyIdsAtom } from '../../atoms/buddy-visibility';
import { BuddySectionNav } from '../../components/buddies/BuddySectionNav';
import {
  BuddyPageActions,
  BuddyRelations,
  BuddyTabContent,
} from '../../components/buddies/BuddyTabContent';
import { buddyTabPath, parseEmployeeTab } from '../../components/buddies/buddy-tabs';
import { initials } from '../../components/buddies/ui-contract';
import { useBuddyPage } from '../../hooks/useBuddyData';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { EmptyState } from '../components/EmptyState';
import { MobileRefreshNotice } from '../components/MobileUI';

/**
 * BuddyDetailMobile — one Buddy at /buddies/:buddyId/:tab (mobile). Same page
 * model and cache keys as the desktop BuddiesDashboard (hooks/useBuddyData.ts),
 * so Back onto a Buddy renders from cache; the tab bodies are the shared
 * components/buddies/BuddyTabContent. Only the hero is mobile's own.
 */
export function BuddyDetailMobile() {
  const { buddyId = '', tab: tabSegment } = useParams<{ buddyId: string; tab: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const chatRouteState = useMemo(() => mobileConversationRouteState(location), [location]);
  const archived = useAtomValue(archivedBuddyIdsAtom);
  const openConversation = useCallback(
    (id: string) => navigate(`/chat/${id}`, { state: chatRouteState }),
    [chatRouteState, navigate]
  );
  const { detail, overview, workspace, talk } = useBuddyPage(buddyId, openConversation);
  // The tab is the URL, not state (components/buddies/buddy-tabs.ts).
  const tab = parseEmployeeTab(tabSegment);

  if (archived.has(buddyId)) return <Navigate to="/buddies" replace />;
  if (tab === null) return <Navigate to={buddyTabPath(buddyId, 'conversations')} replace />;

  // A failed background refresh is `stale` and keeps the page (notice in the
  // hero). Until 2026-09-25 this tested the refresh's error before the data,
  // and one "Failed to fetch" replaced a loaded page with "Could not load buddy".
  const failed =
    detail.kind === 'failed' ? detail.error : overview.kind === 'failed' ? overview.error : null;
  if (failed)
    return (
      <div className="mobile-hub">
        <EmptyState
          icon="⚠"
          title="Could not load buddy"
          message={failed.message}
          actionLabel="Back to Buddies"
          onAction={() => navigate('/buddies')}
        />
      </div>
    );
  if (detail.data === null || overview.data === null)
    return (
      <div className="mobile-hub" aria-live="polite" aria-busy="true">
        <p className="mobile-empty__message">Loading buddy…</p>
      </div>
    );
  const { buddy } = detail.data;
  if (workspace === null)
    return (
      <div className="mobile-hub">
        <EmptyState
          icon="⚠"
          title="Could not load buddy"
          message={`Workspace ${buddy.workspaceId} is not in the Buddy overview.`}
        />
      </div>
    );

  return (
    <div className="mobile-hub mobile-buddy-detail">
      <header className="mobile-buddy-detail__hero">
        <Link
          to="/buddies"
          className="mobile-buddy-detail__back ui-inline-row"
          aria-label="Back to Buddies"
        >
          ← Buddies
        </Link>
        <div className="mobile-buddy-detail__identity">
          <span className="mobile-buddy-card__avatar" aria-hidden="true">
            {initials(buddy.name)}
          </span>
          <div className="mobile-buddy-detail__copy">
            <h1 className="mobile-buddy-detail__name">{buddy.name}</h1>
            <details className="mobile-buddy-detail__description">
              <summary>About this buddy</summary>
              <p className="mobile-buddy-detail__role ui-muted">{buddy.role}</p>
              <BuddyRelations buddy={buddy} overview={overview.data} />
            </details>
          </div>
        </div>
        <BuddyPageActions buddy={buddy} talk={talk} openConversation={openConversation} />
        {detail.kind === 'stale' && (
          <MobileRefreshNotice error={detail.error} onRetry={detail.refetch} />
        )}
      </header>

      <BuddySectionNav buddyId={buddy.id} activeTab={tab} compact />

      <BuddyTabContent
        tab={tab}
        page={{
          detail: detail.data,
          overview: overview.data,
          workspace,
          talk,
          refresh: detail.refetch,
        }}
      />
    </div>
  );
}
