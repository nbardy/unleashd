export const BUDDY_REVIEW_RESULT_START = '<!-- unleashd:buddy-review-result -->';
export const BUDDY_REVIEW_RESULT_END = '<!-- /unleashd:buddy-review-result -->';

export interface BuddyReviewEvidence {
  kind: 'file' | 'conversation' | 'project' | 'metric';
  reference: string;
  observation: string;
}

export interface BuddyReviewRequest {
  requestedByBuddyId: string | null;
  reviewId: string;
  subjectBuddyId: string;
  projectId: string | null;
  purpose: string;
  evidence: BuddyReviewEvidence[];
  allowedOperations: string[];
}

export interface BuddyReviewResult {
  verdict: 'pass' | 'needs_work' | 'fail';
  score: number | null;
  summary: string;
  evidence: BuddyReviewEvidence[];
  requiredActions: string[];
}

function lineValue(content: string, label: string): string | null {
  const line = content.split(/\r?\n/).find((candidate) => candidate.startsWith(`${label}:`));
  return line ? line.slice(label.length + 1).trim() : null;
}

function isReviewEvidence(value: unknown): value is BuddyReviewEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Record<string, unknown>;
  return (
    ['file', 'conversation', 'project', 'metric'].includes(String(evidence.kind)) &&
    typeof evidence.reference === 'string' &&
    evidence.reference.length > 0 &&
    typeof evidence.observation === 'string' &&
    evidence.observation.length > 0
  );
}

function parseEvidence(value: unknown): BuddyReviewEvidence[] | null {
  if (!Array.isArray(value) || !value.every(isReviewEvidence)) return null;
  return value;
}

/**
 * Parse the generated first message of a Buddy review conversation. Ordinary
 * user prompts are deliberately ignored even if they happen to mention review.
 */
export function parseBuddyReviewRequest(content: string): BuddyReviewRequest | null {
  const requester = content.match(/^Review requested by Buddy ([^\s.]+)\.\r?$/m)?.[1];
  const reviewId = lineValue(content, 'Review id');
  const subject = content.match(/^Review Buddy ([^\s.]+)\.\r?$/m)?.[1];
  const purpose = lineValue(content, 'Review purpose');
  const evidenceJson = lineValue(content, 'Input evidence');
  const operations = lineValue(content, 'Allowed Buddy operations');
  if (!reviewId || !subject || !purpose) {
    return null;
  }

  let evidence: BuddyReviewEvidence[] = [];
  if (evidenceJson) {
    let evidenceValue: unknown;
    try {
      evidenceValue = JSON.parse(evidenceJson);
    } catch {
      return null;
    }
    const parsedEvidence = parseEvidence(evidenceValue);
    if (!parsedEvidence) return null;
    evidence = parsedEvidence;
  }

  const project =
    content.match(/^Reviewed project id: ([^\s.]+)\.\r?$/m)?.[1] ??
    (content.includes('No Buddy project was selected.') || !requester ? null : undefined);
  if (project === undefined) return null;

  return {
    requestedByBuddyId: requester ?? null,
    reviewId: reviewId.replace(/\.$/, ''),
    subjectBuddyId: subject,
    projectId: project,
    purpose,
    evidence,
    allowedOperations: operations
      ? operations
          .replace(/\.$/, '')
          .split(',')
          .map((operation) => operation.trim())
          .filter(Boolean)
      : [],
  };
}

export function parseBuddyReviewResult(json: string): BuddyReviewResult | null {
  let value: unknown;
  try {
    value = JSON.parse(json.trim());
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (!['pass', 'needs_work', 'fail'].includes(String(result.verdict))) return null;
  if (typeof result.summary !== 'string' || result.summary.length === 0) return null;
  const evidence = parseEvidence(result.evidence);
  if (!evidence) return null;
  if (
    !Array.isArray(result.requiredActions) ||
    !result.requiredActions.every((action) => typeof action === 'string' && action.length > 0)
  ) {
    return null;
  }
  if (
    result.score !== undefined &&
    result.score !== null &&
    (typeof result.score !== 'number' || result.score < 0 || result.score > 100)
  ) {
    return null;
  }

  return {
    verdict: result.verdict as BuddyReviewResult['verdict'],
    score: typeof result.score === 'number' ? result.score : null,
    summary: result.summary,
    evidence,
    requiredActions: result.requiredActions as string[],
  };
}

/**
 * No global flag: callers create a local global copy when scanning content so
 * concurrent React renders cannot share RegExp.lastIndex.
 */
export const BUDDY_REVIEW_RESULT_RE =
  /<!-- unleashd:buddy-review-result -->\r?\n([\s\S]*?)\r?\n<!-- \/unleashd:buddy-review-result -->/;
