import { useAtomValue } from 'jotai';
import { Link } from 'react-router-dom';
import { listField } from '../../atoms/conversations';
import type { Post } from './types';

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

/**
 * The way into the conversation that wrote a post (desktop hover toolbar, phone post heading),
 * while the client holds it: a reply is what the Buddy chose to post, so its reasoning lives
 * there. Availability-checked against the one id Set, since a deleted conversation would bounce
 * `/chat/:id` to the list (AGENTS.md). `linkState` carries the phone's Back target.
 */
export function ConversationEye({
  post,
  className,
  linkState,
}: {
  post: Post;
  className: string;
  linkState: unknown;
}) {
  const available = useAtomValue(listField('idSet'));
  if (!post.conversationId || !available.has(post.conversationId)) return null;
  return (
    <Link
      className={className}
      to={`/chat/${encodeURIComponent(post.conversationId)}`}
      state={linkState}
      title="Open the conversation"
      aria-label="Open the conversation"
    >
      <EyeIcon />
    </Link>
  );
}
