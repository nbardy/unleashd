import { type BuddyBuilderEvent, BuddyBuilderEventSchema } from '@unleashd/shared';
import { Link, useNavigate } from 'react-router-dom';
import { createConversation } from '../../atoms/actions';
import './BuddyBuilderResultCard.css';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function BuddyBuilderResultCard({ event }: { event: BuddyBuilderEvent }) {
  const navigate = useNavigate();
  const { result } = event;
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
          <span>{event.action === 'created' ? 'Buddy created' : 'Buddy updated'}</span>
          <h3>{buddy.name}</h3>
          <p>{buddy.role}</p>
        </div>
        <span className="buddy-created-card__status">{buddy.status}</span>
      </header>
      {runtime && <p className="buddy-created-card__runtime">{runtime}</p>}
      {event.action === 'updated' && (
        <p className="buddy-created-card__update">Working brief saved</p>
      )}
      {event.action === 'created' && buddyQuestions.length > 0 && (
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

export function InlineBuddyBuilderResult({ payload }: { payload: string }) {
  try {
    const event = BuddyBuilderEventSchema.parse(JSON.parse(decodeURIComponent(payload)));
    return <BuddyBuilderResultCard event={event} />;
  } catch {
    return <p role="alert">Could not display this Buddy result.</p>;
  }
}
