import { useAtomValue } from 'jotai';
import { useCallback, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { archivedBuddyIdsAtom } from '../atoms/buddy-visibility';
import { useBuddyOverview, useBuddyPage } from '../hooks/useBuddyData';
import type { UsePolledFetchResult } from '../hooks/usePolledFetch';
import { BuddyDirectory } from './buddies/BuddyDirectory';
import { BuddySectionNav } from './buddies/BuddySectionNav';
import { BuddyPageActions, BuddyRelations, BuddyTabContent } from './buddies/BuddyTabContent';
import { errorText } from './buddies/api';
import { buddyTabPath, parseEmployeeTab } from './buddies/buddy-tabs';
import { createBuddyViaBuilder } from './buddies/create-buddy-builder';
import { initials } from './buddies/ui-contract';
import './BuddiesDashboard.css';

/** Only a read that never loaded replaces the page; a failed refresh is a notice beside it. */
function RefreshNotice({ read }: { read: UsePolledFetchResult<unknown> }) {
  return read.kind === 'stale' ? (
    <p>
      <output>Could not refresh: {read.error.message}</output>{' '}
      <button type="button" onClick={read.refetch}>
        Retry
      </button>
    </p>
  ) : null;
}

function Centered({ children }: { children: string }) {
  return (
    <div className="buddies-dashboard buddies-dashboard--centered">
      <div className="buddies-loading">{children}</div>
    </div>
  );
}

function Directory() {
  const navigate = useNavigate();
  const overview = useBuddyOverview();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openBuddyBuilder = async () => {
    setCreating(true);
    setError(null);
    try {
      const conversationId = await createBuddyViaBuilder();
      navigate(`/chat/${conversationId}?helper=buddies`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setCreating(false);
    }
  };
  if (overview.kind === 'failed') return <Centered>{overview.error.message}</Centered>;
  if (overview.data === null) return <Centered>Loading Buddies…</Centered>;
  return (
    <div className="buddies-dashboard">
      {error && <div className="buddies-error">{error}</div>}
      <BuddyDirectory
        overview={overview.data}
        onOpen={(id) => navigate(`/buddies/${id}`)}
        onNew={() => void openBuddyBuilder()}
        creating={creating}
        notice={<RefreshNotice read={overview} />}
      />
    </div>
  );
}

function BuddyPage({ buddyId }: { buddyId: string }) {
  const navigate = useNavigate();
  const { tab: tabSegment } = useParams();
  const archived = useAtomValue(archivedBuddyIdsAtom);
  const openConversation = useCallback((id: string) => navigate(`/chat/${id}`), [navigate]);
  const { detail, overview, workspace, talk } = useBuddyPage(buddyId, openConversation);
  // The tab is the URL, not state (components/buddies/buddy-tabs.ts).
  const tab = parseEmployeeTab(tabSegment);

  if (archived.has(buddyId)) return <Navigate to="/buddies" replace />;
  // Canonicalise `/buddies/:id` (and any junk tab segment) onto a real tab URL;
  // `replace` keeps Back pointing at whatever linked here.
  if (tab === null) return <Navigate to={buddyTabPath(buddyId, 'conversations')} replace />;
  if (detail.kind === 'failed') return <Centered>{detail.error.message}</Centered>;
  if (overview.kind === 'failed') return <Centered>{overview.error.message}</Centered>;
  if (detail.data === null || overview.data === null) return <Centered>Loading Buddy…</Centered>;
  const { buddy } = detail.data;
  if (workspace === null)
    return <Centered>{`Workspace ${buddy.workspaceId} is not in the Buddy overview.`}</Centered>;

  return (
    <div className="buddies-dashboard">
      <header className="buddies-hero">
        <div className="buddies-hero-main">
          <div className="buddy-identity">
            <button
              type="button"
              className="buddy-back-button"
              onClick={() => navigate('/buddies')}
              aria-label="Back to all Buddies"
            >
              ←
            </button>
            <div className="buddy-avatar" aria-hidden="true">
              {initials(buddy.name)}
            </div>
            <div className="buddy-identity-copy">
              <div className="buddy-identity-title">
                <h1>{buddy.name}</h1>
                <span>{buddy.status}</span>
              </div>
              <details className="buddy-detail-about">
                <summary>About this Buddy</summary>
                <p>{buddy.role}</p>
                <BuddyRelations buddy={buddy} overview={overview.data} />
              </details>
              <RefreshNotice read={detail} />
            </div>
          </div>
          <BuddyPageActions buddy={buddy} talk={talk} openConversation={openConversation} />
        </div>
        <BuddySectionNav buddyId={buddy.id} activeTab={tab} />
      </header>
      <main className="buddies-content">
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
      </main>
    </div>
  );
}

/** `/buddies` is the directory; `/buddies/:buddyId/:tab` one Buddy's page. */
export function BuddiesDashboard() {
  const { buddyId } = useParams();
  return buddyId ? <BuddyPage key={buddyId} buddyId={buddyId} /> : <Directory />;
}
