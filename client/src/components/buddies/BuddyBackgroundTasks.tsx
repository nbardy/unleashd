import { getBuddyContext } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { buddyBackgroundConversationsAtomFamily } from '../../atoms/buddy-background';
import {
  availableConversationIdSetAtom,
  conversationLoadCompleteAtom,
} from '../../atoms/conversations';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { getConversationLastActivity } from '../../utils/time';
import { conversationPath } from './buddy-tabs';
import type { Workspace } from './types';

export function BuddyBackgroundTasks({
  buddyId,
  workspaces,
}: {
  buddyId: string;
  workspaces: Workspace[];
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const routeState = mobileConversationRouteState(location);
  // An empty `?workspace=` (sidebar link for a buddy with no workspace) is
  // "All workspaces", not a workspace literally named "". Without this,
  // the filter matches nothing and the tab reads empty while the badge
  // counts show work — background threads look hidden everywhere, since the
  // Conversations tab hides background placement by design.
  const workspaceParam = searchParams.get('workspace');
  const workspaceId = workspaceParam ? workspaceParam : null;
  const { conversations, runningCount } = useAtomValue(
    buddyBackgroundConversationsAtomFamily({ buddyId, workspaceId })
  );
  const unfiltered = useAtomValue(
    buddyBackgroundConversationsAtomFamily({ buddyId, workspaceId: null })
  );
  const availableIds = useAtomValue(availableConversationIdSetAtom);
  const loaded = useAtomValue(conversationLoadCompleteAtom);

  return (
    <section className="buddy-background-tasks" aria-label="Background tasks">
      <div className="buddy-background-tasks-heading">
        <div>
          <h2>Background tasks</h2>
          <p>
            {runningCount} running · {conversations.length} conversations
          </p>
        </div>
        <label>
          Workspace
          <select
            value={workspaceId ?? ''}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              if (event.target.value) next.set('workspace', event.target.value);
              else next.delete('workspace');
              setSearchParams(next);
            }}
          >
            <option value="">All workspaces</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {conversations.length === 0 ? (
        <div className="buddy-background-tasks-empty">
          <p>{loaded ? 'No background conversations yet.' : 'Loading background conversations…'}</p>
          {loaded && workspaceId && unfiltered.conversations.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete('workspace');
                setSearchParams(next);
              }}
            >
              Show all workspaces ({unfiltered.conversations.length})
            </button>
          )}
        </div>
      ) : (
        <ul className="buddy-background-tasks-list">
          {conversations.map((conversation) => {
            if (!availableIds.has(conversation.id)) return null;
            const context = getBuddyContext(conversation)!;
            const workspace = workspaces.find((item) => item.id === context.workspaceId);
            const preview = conversation.messages.at(-1)?.content.trim();
            return (
              <li key={conversation.id}>
                <Link
                  className="buddy-background-tasks-conversation"
                  to={conversationPath(conversation.id)}
                  state={routeState}
                >
                  <div className="buddy-background-tasks-row">
                    <strong>{workspace?.name ?? 'Background conversation'}</strong>
                    <span
                      className={conversation.isRunning ? 'buddy-background-tasks-running' : ''}
                    >
                      {conversation.isRunning ? 'Running' : 'Not running'}
                    </span>
                  </div>
                  {preview && <p className="buddy-background-tasks-preview">{preview}</p>}
                  <div className="buddy-background-tasks-row buddy-background-tasks-meta">
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
    </section>
  );
}
