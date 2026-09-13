import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { BuddyTeamExecution } from '../../src/components/buddies/BuddyTeamExecution';
import '../../src/index.css';
import '../../src/App.css';
import '../../src/components/buddies/BuddyTeamExecution.css';
const context = await fetch('/qa-context').then((r) => r.json());
const available = new Set(['lead', 'worker']);
function App() {
  const [workspace, setWorkspace] = useState(context.workspaceId);
  return (
    <MemoryRouter>
      <h1>CEO workflow verification</h1>
      <button type="button" onClick={() => setWorkspace(context.workspaceId)}>
        Wave workspace
      </button>
      <button type="button" onClick={() => setWorkspace(context.otherWorkspaceId)}>
        Second workspace
      </button>
      <BuddyTeamExecution
        buddyId={context.buddyId}
        workspaceId={workspace}
        availableConversationIds={available}
      />
    </MemoryRouter>
  );
}
const style = document.createElement('style');
style.textContent =
  'body{overflow:auto}#root{height:auto;max-width:1080px;padding:24px;margin:auto}';
document.head.append(style);
createRoot(document.getElementById('root')!).render(<App />);
