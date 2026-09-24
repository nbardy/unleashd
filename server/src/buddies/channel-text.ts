import type { BuddiesStorePort, BuddyListAuthor, BuddyMailingListPost } from './contract';

// How a channel post reads to a model: the @mention launch prompt and the
// search_posts / get_thread tools share these, so an agent sees one format
// whether a post arrived in its prompt or through a tool.

// Mentions are markdown links with a buddy: target, inserted by the composer
// as `[@Name](buddy:<id>)`. Tasks use `[Title](task:<id>)`.
const MENTION = /\[@([^\]]+)\]\(buddy:([A-Za-z0-9_-]+)\)/g;
const TASK_REFERENCE = /\[([^\]]+)\]\(task:([A-Za-z0-9_-]+)\)/g;

const MAX_TRANSCRIPT_POST_CHARS = 4000;
const SNIPPET_CHARS = 280;

export function mentionedBuddyIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((match) => match[2]))];
}

// What a reader (human or model) sees for a token: `@Name`, `Title (task <id>)`.
export function readableChannelText(body: string): string {
  return body
    .replace(MENTION, (_whole, name: string) => `@${name}`)
    .replace(TASK_REFERENCE, (_whole, title: string, id: string) => `${title} (task ${id})`);
}

export function authorLabel(author: BuddyListAuthor, store: BuddiesStorePort): string {
  switch (author.kind) {
    case 'owner':
      return 'Owner';
    case 'buddy':
      return store.getBuddy(author.buddyId)?.name ?? author.buddyId;
  }
}

// One transcript line. The post id is always shown so the reader can pass it
// to get_thread; a root with replies stays COLLAPSED to a count — expanding
// every thread would bury the channel's recent flow under old side threads.
export function transcriptLine(post: BuddyMailingListPost, store: BuddiesStorePort): string {
  const text = readableChannelText(post.body);
  const clipped =
    text.length > MAX_TRANSCRIPT_POST_CHARS
      ? `${text.slice(0, MAX_TRANSCRIPT_POST_CHARS)}… [truncated]`
      : text;
  const replies =
    post.replyCount > 0
      ? ` [thread: ${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}, latest ${post.latestReplyAt}]`
      : '';
  return `[${post.createdAt}] ${authorLabel(post.author, store)} (${post.id}): ${clipped}${replies}`;
}

// A window of readable text around the first query term, so a search hit
// shows why it matched without returning a 32 KB body.
export function searchSnippet(body: string, query: string): string {
  const text = readableChannelText(body).replace(/\s+/g, ' ').trim();
  if (text.length <= SNIPPET_CHARS) return text;
  const first = query.trim().split(/\s+/)[0].toLowerCase();
  const at = Math.max(0, text.toLowerCase().indexOf(first));
  const start = Math.max(0, Math.min(at - SNIPPET_CHARS / 3, text.length - SNIPPET_CHARS));
  const window = text.slice(start, start + SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${window}${start + SNIPPET_CHARS < text.length ? '…' : ''}`;
}
