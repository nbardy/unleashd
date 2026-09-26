import { Link } from 'react-router-dom';

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Opens the conversation that wrote a channel post, when the client still holds it. */
export function ConversationEye({
  conversationId,
  available,
  className,
}: {
  conversationId: string | null;
  available: boolean;
  className: string;
}) {
  if (!conversationId || !available) return null;
  return (
    <Link
      className={className}
      to={`/chat/${encodeURIComponent(conversationId)}`}
      title="Open the conversation"
      aria-label="Open the conversation"
    >
      <EyeIcon />
    </Link>
  );
}
