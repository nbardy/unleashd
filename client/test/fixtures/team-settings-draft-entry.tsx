import { Provider, useAtomValue } from 'jotai';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { handleMessage, setWsStatus } from '../../src/atoms/actions';
import { conversationLoadCompleteAtom, wsStatusAtom } from '../../src/atoms/conversations';
import { jotaiStore } from '../../src/atoms/store';
import { BuddyTeamSettings } from '../../src/components/buddies/BuddyTeamConfiguration';
import '../../src/index.css';
import '../../src/App.css';

interface FixtureContext {
  buddyId: string;
  workspaceId: string;
  targetId: string;
}

const context = (await fetch('/qa-context').then((response) => response.json())) as FixtureContext;

handleMessage({
  type: 'init',
  conversations: [],
  defaultCwd: '',
  loading: false,
} as never);
setWsStatus('connected');

function App() {
  const [refreshStatus, setRefreshStatus] = useState('No external refresh yet.');
  const wsStatus = useAtomValue(wsStatusAtom);
  const loadComplete = useAtomValue(conversationLoadCompleteAtom);

  async function externalRefresh() {
    const response = await fetch('/qa-external-change', { method: 'POST' });
    const payload = (await response.json()) as { revision: number };
    setRefreshStatus(`Server advanced to revision ${payload.revision}; reconnecting…`);
    setWsStatus('disconnected');
    window.setTimeout(() => {
      setWsStatus('connected');
      setRefreshStatus(`Reconnect fetched revision ${payload.revision}.`);
    }, 1_500);
  }

  return (
    <MemoryRouter>
      <main className="fixture-shell">
        <header>
          <h1>Permission draft refresh fixture</h1>
          <button
            type="button"
            data-testid="external-refresh"
            onClick={() => void externalRefresh()}
          >
            Change saved grant and reconnect
          </button>
          <output data-testid="refresh-status">{refreshStatus}</output>
          <output data-testid="ws-status">
            WebSocket {wsStatus}; initial load {loadComplete ? 'complete' : 'pending'}.
          </output>
        </header>
        <BuddyTeamSettings
          buddyId={context.buddyId}
          workspaceId={context.workspaceId}
          initialTargetId={context.targetId}
        />
      </main>
    </MemoryRouter>
  );
}

const style = document.createElement('style');
style.textContent = `
  body { overflow: auto; }
  .fixture-shell { max-width: 760px; margin: 0 auto; padding: 32px; }
  .fixture-shell > header { display: grid; gap: 12px; margin-bottom: 24px; }
`;
document.head.append(style);

createRoot(document.getElementById('root')!).render(
  <Provider store={jotaiStore}>
    <App />
  </Provider>
);
