import { BUDDY_REVIEW_RESULT_RE } from './buddy-review-message';

/**
 * Legacy provider-output adapters. These markers are transport compatibility
 * only; callers receive typed segments and never need to understand delimiters.
 * New provider-native events should normalize to the same segment union.
 */
export const ASK_USER_QUESTION_RE = /<!--ask_user_question:(.*?)-->/s;

export const OOMPA_RUN_TOOL_FRAGMENT_RE =
  /⚡\s+(?:bash|shell|run_shell_command)\s+(?:(?:oompa\s+(?:run|swarm)\s+::|(?:env\s+(?:-\w+\s+\S+\s+)*)?oompa\s+(?:run|swarm)\s)[^\n]*|(?:env\s+(?:-\w+\s+\S+\s+)*)?oompa\s+\S+\.json[^\n]*)/i;

export type StructuredMessageSegment =
  | { type: 'text'; content: string }
  | { type: 'ask_user_question'; json: string }
  | { type: 'buddy_review_result'; json: string }
  | { type: 'buddy_builder_result'; json: string }
  | { type: 'oompa_run' };

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
    ...collectMatches(content, 'ask_user_question', ASK_USER_QUESTION_RE, 1),
    ...collectMatches(content, 'buddy_review_result', BUDDY_REVIEW_RESULT_RE, 1),
    ...collectMatches(content, 'buddy_builder_result', /<!--buddy_builder_result:(.*?)-->/s, 1),
    ...collectMatches(content, 'oompa_run', OOMPA_RUN_TOOL_FRAGMENT_RE),
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
    } else if (match.type === 'buddy_review_result' || match.type === 'buddy_builder_result') {
      segments.push({ type: match.type, json: match.payload ?? '' });
    } else {
      segments.push({ type: match.type });
    }
    lastIndex = match.index + match.length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) });
  }
  return segments;
}
