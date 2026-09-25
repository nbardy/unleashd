import { atom, useAtomValue } from 'jotai';
import { atomFamily } from 'jotai-family';
import { Link, useLocation } from 'react-router-dom';
import { connectionAtom, listField, loadCompleteOf, rowFamily } from '../../atoms/conversations';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { isRowRunning } from '../../utils/conversation-row';
import { getConversationLastActivity } from '../../utils/time';
import { BuddyRunList } from './BuddyRunList';
import { conversationPath } from './buddy-tabs';
import type { Run } from './types';
import './BuddyBackgroundTasks.css';

// One Buddy's background rows (list index `buddyThreads`, running first).
const backgroundRowsFamily = atomFamily((buddyId: string) =>
  atom((get) => {
    const ids = get(listField('buddyThreads')).get(buddyId)?.background ?? [];
    const conversations = ids.flatMap((id) => get(rowFamily(id)) ?? []);
    return { conversations, runningCount: conversations.filter(isRowRunning).length };
  })
);

/**
 * A Buddy's background work: its background conversations (held by the
 * client, so every row is openable) and its recent runs from the detail read.
 */
export function BuddyBackgroundTasks({
  buddyId,
  runs,
  refresh,
}: {
  buddyId: string;
  runs: readonly Run[];
  refresh: () => Promise<void>;
}) {
  const location = useLocation();
  const routeState = mobileConversationRouteState(location);
  const { conversations, runningCount } = useAtomValue(backgroundRowsFamily(buddyId));
  const loaded = loadCompleteOf(useAtomValue(connectionAtom).server);

  return (
    <section className="buddy-background-tasks" aria-label="Background tasks">
      <div className="buddy-background-tasks-heading">
        <div>
          <h2>Background tasks</h2>
          <p>
            {runningCount} running · {conversations.length} conversations
          </p>
        </div>
      </div>
      {conversations.length === 0 ? (
        <div className="buddy-background-tasks-empty">
          <p>{loaded ? 'No background conversations yet.' : 'Loading background conversations…'}</p>
        </div>
      ) : (
        <ul className="buddy-background-tasks-list">
          {conversations.map((conversation) => {
            const preview = conversation.label;
            const running = isRowRunning(conversation);
            return (
              <li key={conversation.id}>
                <Link
                  className="buddy-background-tasks-conversation"
                  to={conversationPath(conversation.id)}
                  state={routeState}
                >
                  <div className="buddy-background-tasks-row">
                    <strong>Background conversation</strong>
                    <span className={running ? 'buddy-background-tasks-running' : ''}>
                      {running ? 'Running' : 'Not running'}
                    </span>
                  </div>
                  {preview && <p className="buddy-background-tasks-preview">{preview}</p>}
                  <div className="buddy-background-tasks-row buddy-background-tasks-meta ui-muted">
                    <span>
                      {conversation.provider} ·{' '}
                      {getConversationLastActivity(conversation).toLocaleString()}
                    </span>
                    <span>Open conversation →</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="buddy-panel__heading">Recent runs</h3>
      <BuddyRunList runs={runs} refresh={refresh} empty="No runs yet." />
    </section>
  );
}
