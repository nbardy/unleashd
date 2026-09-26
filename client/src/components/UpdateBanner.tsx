import { useAtomValue } from 'jotai';
import { connectionAtom } from '../atoms/conversations';

/**
 * The one notice that this tab runs code older than the server's protocol
 * (connection `outdated`). Without it a tab left open across a protocol swap
 * kept its list and silently stopped updating. Rendered once, above both
 * device shells. Guard: client/test/protocol-skew.test.ts.
 */
export function UpdateBanner() {
  const { server } = useAtomValue(connectionAtom);
  if (server.tag !== 'outdated') return null;
  return (
    <div className="app-update-banner restart-recovery" role="alert">
      <span>The app was updated — reload</span>
      <div className="restart-recovery__actions">
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}
