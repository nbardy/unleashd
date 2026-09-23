/**
 * client/src/components/buddies/channel-text.ts
 *
 * Pure text rules for channel posts. Pure and CSS-free so mobile may import it.
 *
 * A post body is markdown. References are markdown links with app schemes:
 *   `[@Name](buddy:<id>)`   a mention — an OWNER mention starts that Buddy's turn
 *   `[Title](task:<id>)`    a Task, rendered as a live status chip
 *   `![alt](/abs/path)`     inline image or video, served through /api/files
 *
 * The composer never shows raw tokens: picking from the universal @ menu
 * inserts `@Label` and records the reference; `encodeReferences` swaps the
 * labels for tokens on send.
 */

export type ChannelReference =
  | { kind: 'buddy'; id: string; label: string; detail: string }
  | { kind: 'task'; id: string; label: string; detail: string; status: string };

// ── Fuzzy matching ─────────────────────────────────────────────────────────

/**
 * Subsequence match, scored so that word starts and consecutive runs win:
 * "pdl" ranks "Product Development Lead" above "Upload deadline". Null when
 * the query is not a subsequence of the text.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.toLowerCase().replace(/\s+/g, '');
  const haystack = text.toLowerCase();
  if (needle.length === 0) return 0;
  let score = 0;
  let previous = -2;
  let position = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, position);
    if (found < 0) return null;
    const atWordStart = found === 0 || /[\s_\-/.:]/.test(haystack[found - 1]);
    score += found === previous + 1 ? 6 : 1;
    if (atWordStart) score += 8;
    if (found === 0) score += 4;
    previous = found;
    position = found + 1;
  }
  // Prefer shorter texts among equal matches.
  return score - haystack.length * 0.05;
}

export function rankReferences(
  query: string,
  references: readonly ChannelReference[],
  limit = 8
): ChannelReference[] {
  return references
    .map((reference) => ({ reference, score: fuzzyScore(query, reference.label) }))
    .filter(
      (entry): entry is { reference: ChannelReference; score: number } => entry.score !== null
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.reference);
}

// ── The @ trigger ──────────────────────────────────────────────────────────

const MAX_QUERY_LENGTH = 40;

/**
 * The @-query under the caret, if the caret sits in one: an `@` at the start
 * of the text or after whitespace, followed by up to 40 characters with no
 * newline. Spaces are allowed so Task titles can be typed ("@fix login").
 */
export function activeReferenceQuery(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY_LENGTH || query.includes('\n')) return null;
  return { start: at, query };
}

export function insertReference(
  text: string,
  trigger: { start: number; query: string },
  reference: ChannelReference
): { text: string; caret: number } {
  const inserted = `@${reference.label} `;
  const end = trigger.start + 1 + trigger.query.length;
  return {
    text: text.slice(0, trigger.start) + inserted + text.slice(end),
    caret: trigger.start + inserted.length,
  };
}

// ── Encoding ───────────────────────────────────────────────────────────────

function linkText(label: string): string {
  return label.replace(/[[\]]/g, '');
}

export function referenceToken(reference: ChannelReference): string {
  switch (reference.kind) {
    case 'buddy':
      return `[@${linkText(reference.label)}](buddy:${reference.id})`;
    case 'task':
      return `[${linkText(reference.label)}](task:${reference.id})`;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace every `@Label` the user picked with its token. Longer labels go
 * first and a label must end at a word boundary, so picking both "Lead" and
 * "Lead Designer" never turns "@Lead Designer" into "[@Lead](…) Designer".
 * References whose label was deleted from the text simply do not appear.
 */
export function encodeReferences(text: string, references: readonly ChannelReference[]): string {
  const unique = new Map(
    references.map((reference) => [`${reference.kind}:${reference.id}`, reference])
  );
  const ordered = [...unique.values()].sort((a, b) => b.label.length - a.label.length);
  if (ordered.length === 0) return text;
  const pattern = new RegExp(
    `(^|\\s)@(${ordered.map((reference) => escapeRegExp(reference.label)).join('|')})(?=$|[\\s.,:;!?)])`,
    'g'
  );
  const byLabel = new Map(ordered.map((reference) => [reference.label, reference]));
  return text.replace(pattern, (_whole, lead: string, label: string) => {
    const reference = byLabel.get(label);
    return reference ? `${lead}${referenceToken(reference)}` : _whole;
  });
}

// ── Media ──────────────────────────────────────────────────────────────────

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);

export function mediaMarkdown(file: { originalName: string; absolutePath: string }): string {
  const alt = linkText(file.originalName.replace(/\.[^.]+$/, ''));
  return `![${alt}](${file.absolutePath})`;
}

/** Local absolute paths render through the authenticated file route. */
export function mediaUrl(source: string): string {
  return source.startsWith('/') && !source.startsWith('/api/')
    ? `/api/files?path=${encodeURIComponent(source)}`
    : source;
}

export function isVideoSource(source: string): boolean {
  const path = source.split(/[?#]/)[0].toLowerCase();
  const dot = path.lastIndexOf('.');
  return dot >= 0 && VIDEO_EXTENSIONS.has(path.slice(dot));
}

// Readable one-line text for previews (reply summaries, the thread header).
export function plainChannelText(body: string): string {
  return body
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_whole, alt: string) => `[${alt || 'image'}]`)
    .replace(/\[@([^\]]+)\]\(buddy:[^)]+\)/g, '@$1')
    .replace(/\[([^\]]+)\]\(task:[^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Tasks ──────────────────────────────────────────────────────────────────

/** GET /api/buddies/workspaces/:id/tasks — the chip and @-picker index. */
export type ChannelTask = {
  id: string;
  title: string;
  status: string;
  ownerBuddyId: string;
  ownerName: string;
  todosDone: number;
  todosTotal: number;
  nextAction: string | null;
  updatedAt: string;
};

export function workspaceTasksUrl(workspaceId: string): string {
  return `/api/buddies/workspaces/${encodeURIComponent(workspaceId)}/tasks`;
}

/** App links inside a post body: D = Buddy ⊕ Task ⊕ Web. */
export type ChannelLink =
  | { kind: 'buddy'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'web'; href: string };

export function parseChannelLink(href: string): ChannelLink {
  if (href.startsWith('buddy:')) return { kind: 'buddy', id: href.slice('buddy:'.length) };
  if (href.startsWith('task:')) return { kind: 'task', id: href.slice('task:'.length) };
  return { kind: 'web', href };
}
