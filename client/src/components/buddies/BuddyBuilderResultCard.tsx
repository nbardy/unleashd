import { type BuddyBuilderResult, BuddyBuilderResultsSchema } from '@unleashd/shared';
import { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createConversation } from '../../atoms/actions';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import './BuddyBuilderResultCard.css';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function BuddyCreatedCard({ result }: { result: BuddyBuilderResult }) {
  const navigate = useNavigate();
  const { buddy } = result;
  const buddyQuestions = result.followUpQuestions;
  const runtime = [buddy.model ?? buddy.provider, buddy.reasoning_effort]
    .filter(Boolean)
    .join(' · ');
  const route = `/buddies/${buddy.id}`;
  const startConversation = () => {
    const id = createConversation({
      workingDirectory: result.homeWorkspace.root_path,
      config: {
        provider: buddy.provider ?? 'codex',
        model: buddy.model ? { mode: 'explicit', modelId: buddy.model } : { mode: 'default' },
        reasoning: buddy.reasoning_effort
          ? { mode: 'explicit', effort: buddy.reasoning_effort }
          : { mode: 'default' },
      },
      buddyContext: {
        buddyId: buddy.id,
        workspaceId: result.homeWorkspace.id,
        buddyProjectId: null,
      },
    });
    navigate(`/chat/${id}`);
  };

  return (
    <article className="buddy-created-card">
      <header>
        <div className="buddy-created-card__avatar" aria-hidden="true">
          {initials(buddy.name)}
        </div>
        <div>
          <span>Buddy created</span>
          <h3>{buddy.name}</h3>
          <p>{buddy.role}</p>
        </div>
        <span className="buddy-created-card__status">{buddy.status}</span>
      </header>
      {runtime && <p className="buddy-created-card__runtime">{runtime}</p>}
      {buddyQuestions.length > 0 && (
        <div className="buddy-created-card__questions">
          <span>Questions to sharpen this Buddy</span>
          <ul>
            {buddyQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="buddy-created-card__actions">
        <Link to={route}>Open Buddy</Link>
        <button type="button" onClick={startConversation}>
          Start conversation
        </button>
      </div>
    </article>
  );
}

export function BuddyBuilderResultCard({
  conversationId,
  isRunning,
}: {
  conversationId: string;
  isRunning: boolean;
}) {
  const source = useCallback(
    async (signal: AbortSignal) => {
      const response = await fetch(
        `/api/buddies/builder/${encodeURIComponent(conversationId)}/results`,
        { signal }
      );
      if (!response.ok) throw new Error(`Builder results failed (${response.status})`);
      return BuddyBuilderResultsSchema.parse(await response.json());
    },
    [conversationId]
  );
  const { data, error } = usePolledFetch(source, isRunning ? 2000 : 0);
  return (
    <>
      {data?.conversationId === conversationId &&
        data.results.map((result) => <BuddyCreatedCard key={result.buddy.id} result={result} />)}
      {error && <p role="alert">Could not load created Buddies. {error.message}</p>}
    </>
  );
}
