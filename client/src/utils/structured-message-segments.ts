/**
 * Legacy provider-output adapters. These markers are transport compatibility
 * only; callers receive typed segments and never need to understand delimiters.
 * New provider-native events should normalize to the same segment union.
 */
export const ASK_USER_QUESTION_RE = /<!--\s*ask_user_question\s*:(.*?)\s*-->/s;

export const OOMPA_RUN_TOOL_FRAGMENT_RE =
  /⚡\s+(?:bash|shell|run_shell_command)\s+(?:(?:oompa\s+(?:run|swarm)\s+::|(?:env\s+(?:-\w+\s+\S+\s+)*)?oompa\s+(?:run|swarm)\s)[^\n]*|(?:env\s+(?:-\w+\s+\S+\s+)*)?oompa\s+\S+\.json[^\n]*)/i;

// Capturing copy: channel rendering keeps the fragment's source text so an
// oompa run line reads exactly as before, while chat keeps its widget.
const OOMPA_RUN_CAPTURE_RE = new RegExp(`(${OOMPA_RUN_TOOL_FRAGMENT_RE.source})`, 'i');

// Provider markers are transport compatibility only; the model, history
// rewraps, and Markdown soft breaks can all leave whitespace inside the
// `<!-- … -->` delimiters, so every marker pattern tolerates it. Writers keep
// emitting the canonical compact form.

// Markers of retired Buddy features (review results and team configuration,
// removed with the v2 Buddy server, T11). Old transcripts and channel posts
// still carry them; they render as nothing rather than as a raw blob.
const RETIRED_MARKER_RE =
  /(?:^[ \t]*🔧[ \t]+mcp_tool[ \t]*\r?\n\s*)?<!--\s*buddy_team_configuration\s*:.*?\s*-->|<!-- unleashd:buddy-review-result -->\r?\n[\s\S]*?\r?\n<!-- \/unleashd:buddy-review-result -->/m;

export type StructuredMessageSegment =
  | { type: 'text'; content: string }
  | { type: 'ask_user_question'; json: string }
  | { type: 'buddy_builder_result'; json: string }
  | { type: 'retired_marker' }
  | { type: 'buddy_worker_thread'; json: string }
  | { type: 'oompa_run'; content: string };

interface SegmentMatch {
  type: Exclude<StructuredMessageSegment['type'], 'text'>;
  index: number;
  length: number;
  payload?: string;
}

function collectMatches(
  content: string,
  type: SegmentMatch['type'],
  pattern: RegExp,
  payloadGroup?: number
): SegmentMatch[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const scanner = new RegExp(pattern.source, flags);
  const matches: SegmentMatch[] = [];
  let match = scanner.exec(content);
  while (match !== null) {
    matches.push({
      type,
      index: match.index,
      length: match[0].length,
      ...(payloadGroup === undefined ? {} : { payload: match[payloadGroup] }),
    });
    match = scanner.exec(content);
  }
  return matches;
}

export function splitStructuredMessageContent(content: string): StructuredMessageSegment[] {
  const matches = [
    ...collectMatches(
      content,
      'buddy_worker_thread',
      /<!--\s*buddy_worker_thread\s*:(.*?)\s*-->/s,
      1
    ),
    ...collectMatches(content, 'ask_user_question', ASK_USER_QUESTION_RE, 1),
    ...collectMatches(
      content,
      'buddy_builder_result',
      /(?:^[ \t]*🔧[ \t]+mcp_tool[ \t]*\r?\n\s*)?<!--\s*buddy_builder_result\s*:(.*?)\s*-->/ms,
      1
    ),
    ...collectMatches(content, 'oompa_run', OOMPA_RUN_CAPTURE_RE, 1),
    ...collectMatches(content, 'retired_marker', RETIRED_MARKER_RE),
  ].sort((a, b) => a.index - b.index);

  const segments: StructuredMessageSegment[] = [];
  let lastIndex = 0;
  for (const match of matches) {
    if (match.index < lastIndex) continue;
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    if (match.type === 'ask_user_question') {
      segments.push({ type: match.type, json: match.payload ?? '' });
    } else if (match.type === 'buddy_builder_result' || match.type === 'buddy_worker_thread') {
      segments.push({ type: match.type, json: match.payload ?? '' });
    } else if (match.type === 'retired_marker') {
      segments.push({ type: match.type });
    } else if (match.type === 'oompa_run') {
      segments.push({ type: match.type, content: match.payload ?? '' });
    } else {
      // Unreachable: every segment type is handled above. Fail closed so a
      // future variant errors loudly instead of rejoining text or vanishing.
      throw new Error(`unhandled structured segment ${(match as SegmentMatch).type}`);
    }
    lastIndex = match.index + match.length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) });
  }
  return segments;
}
