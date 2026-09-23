import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { conversationAtomFamily } from '../../atoms/conversations';
import { BuddySigil } from './BuddySigil';
import { buddyApi } from './api';

// One Buddy in the channels rail: the name opens the Buddy page; on hover,
// DM opens the ongoing owner chat (history kept, server-owned id) and Wake
// asks the Buddy to catch up on the channels inside that DM.
// Server: server/src/buddies/buddy-direct.ts.

type RowAction =
  | { kind: 'idle' }
  | { kind: 'pending'; action: 'dm' | 'wake' }
  | { kind: 'failed'; message: string };

export function BuddyRailRow({
  member,
  workspaceId,
}: {
  member: { id: string; name: string; role: string };
  workspaceId: string;
}) {
  const navigate = useNavigate();
  const [action, setAction] = useState<RowAction>({ kind: 'idle' });
  // Each wake remounts its status (key = attempt) so a second wake starts fresh.
  const [woken, setWoken] = useState<{ conversationId: string; attempt: number } | null>(null);
  const request = (path: 'direct' | 'wake') =>
    buddyApi<{ conversationId: string }>(`/api/buddies/${encodeURIComponent(member.id)}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    });
  const fail = (cause: unknown) =>
    setAction({ kind: 'failed', message: cause instanceof Error ? cause.message : String(cause) });

  return (
    <li className="channel-browser-buddy" data-failed={action.kind === 'failed' || undefined}>
      <Link
        className="channel-browser-buddy-link"
        to={`/buddies/${encodeURIComponent(member.id)}`}
        title={action.kind === 'failed' ? action.message : member.role}
      >
        <BuddySigil className="channel-browser-buddy-sigil" name={member.name} />
        <span className="channel-browser-channel-name">{member.name}</span>
      </Link>
      {woken && (
        <WakeStatus key={woken.attempt} conversationId={woken.conversationId} name={member.name} />
      )}
      <span className="channel-browser-buddy-actions">
        <button
          type="button"
          title={`Message ${member.name}`}
          aria-label={`Message ${member.name}`}
          disabled={action.kind === 'pending'}
          onClick={() => {
            setAction({ kind: 'pending', action: 'dm' });
            request('direct')
              .then(({ conversationId }) => navigate(`/chat/${encodeURIComponent(conversationId)}`))
              .catch(fail);
          }}
        >
          <DmIcon />
        </button>
        <button
          type="button"
          title={`Wake ${member.name}: catch up on the channels and act`}
          aria-label={`Wake ${member.name}`}
          disabled={action.kind === 'pending'}
          onClick={() => {
            setAction({ kind: 'pending', action: 'wake' });
            request('wake')
              .then(({ conversationId }) => {
                setWoken((current) => ({ conversationId, attempt: (current?.attempt ?? 0) + 1 }));
                setAction({ kind: 'idle' });
              })
              .catch(fail);
          }}
        >
          <WakeIcon />
        </button>
      </span>
    </li>
  );
}

// Wake progress, read from the DM's own run state. The queued message may
// reach the client a beat after the HTTP reply, so "waiting" holds until the
// DM is first seen busy; only a busy → idle edge means the check finished.
type WakePhase = 'waiting' | 'running' | 'done';

function WakeStatus({
  conversationId,
  name,
}: {
  conversationId: string;
  name: string;
}) {
  const conversation = useAtomValue(conversationAtomFamily(conversationId));
  const busy = conversation !== null && (conversation.isRunning || conversation.queue.length > 0);
  const [phase, setPhase] = useState<WakePhase>('waiting');
  useEffect(() => {
    if (busy) setPhase('running');
    else setPhase((current) => (current === 'running' ? 'done' : current));
  }, [busy]);
  switch (phase) {
    case 'waiting':
    case 'running':
      return (
        <span
          className="channel-browser-buddy-status"
          title={`${name} is checking the channels`}
          aria-live="polite"
        >
          <span className="channel-browser-replying-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </span>
      );
    case 'done':
      // Availability-checked: the atom is null once the client no longer holds it.
      return conversation ? (
        <Link
          className="channel-browser-buddy-status channel-browser-buddy-done"
          to={`/chat/${encodeURIComponent(conversationId)}`}
          title={`${name} finished checking — read the summary`}
        >
          ✓
        </Link>
      ) : null;
  }
}

function DmIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WakeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
