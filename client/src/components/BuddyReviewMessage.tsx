import type { BuddyReviewRequest, BuddyReviewResult } from '../utils/buddy-review-message';
import './BuddyReviewMessage.css';

function shortId(value: string): string {
  const prefix = value.split('_')[0];
  const opaque = value.slice(prefix.length + 1);
  return opaque ? `${prefix}_${opaque.slice(0, 8)}` : value.slice(0, 12);
}

function EvidenceDetails({
  evidence,
}: {
  evidence: BuddyReviewRequest['evidence'] | BuddyReviewResult['evidence'];
}) {
  return (
    <details className="buddy-review-details">
      <summary>
        {evidence.length} evidence {evidence.length === 1 ? 'source' : 'sources'}
      </summary>
      <div className="buddy-review-evidence">
        {evidence.map((item, index) => (
          <div
            className="buddy-review-evidence__item"
            key={`${item.kind}-${item.reference}-${index}`}
          >
            <div className="buddy-review-evidence__reference">
              <span>{item.kind}</span>
              <code>{item.reference}</code>
            </div>
            <p>{item.observation}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

export function BuddyReviewRequestCard({ request }: { request: BuddyReviewRequest }) {
  return (
    <article className="buddy-review-card buddy-review-card--request">
      <header className="buddy-review-card__header">
        <div>
          <span className="buddy-review-card__eyebrow">Review request</span>
          <h3>Independent employee review</h3>
        </div>
        <span className="buddy-review-card__state">Awaiting verdict</span>
      </header>

      <p className="buddy-review-card__summary">{request.purpose}</p>

      <div className="buddy-review-card__meta">
        <span>
          <strong>Subject</strong> {shortId(request.subjectBuddyId)}
        </span>
        <span>
          <strong>Project</strong> {request.projectId ? shortId(request.projectId) : 'Not selected'}
        </span>
      </div>

      <EvidenceDetails evidence={request.evidence} />

      <details className="buddy-review-details buddy-review-details--technical">
        <summary>Technical details</summary>
        <dl>
          <div>
            <dt>Review</dt>
            <dd>{request.reviewId}</dd>
          </div>
          {request.requestedByBuddyId && (
            <div>
              <dt>Requested by</dt>
              <dd>{request.requestedByBuddyId}</dd>
            </div>
          )}
          {request.allowedOperations.length > 0 && (
            <div>
              <dt>Allowed operations</dt>
              <dd>{request.allowedOperations.join(', ')}</dd>
            </div>
          )}
        </dl>
      </details>
    </article>
  );
}

const VERDICT_LABELS: Record<BuddyReviewResult['verdict'], string> = {
  pass: 'Pass',
  needs_work: 'Needs work',
  fail: 'Fail',
};

export function BuddyReviewResultCard({ result }: { result: BuddyReviewResult }) {
  return (
    <article className={`buddy-review-card buddy-review-card--result verdict-${result.verdict}`}>
      <header className="buddy-review-card__header">
        <div>
          <span className="buddy-review-card__eyebrow">Review result</span>
          <h3>{VERDICT_LABELS[result.verdict]}</h3>
        </div>
        {result.score !== null && (
          <span className="buddy-review-card__score">
            <strong>{result.score}</strong>
            <span>/100</span>
          </span>
        )}
      </header>

      <p className="buddy-review-card__summary">{result.summary}</p>

      {result.requiredActions.length > 0 ? (
        <div className="buddy-review-actions">
          <strong>Required actions</strong>
          <ul>
            {result.requiredActions.map((action, index) => (
              <li key={`${action}-${index}`}>{action}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="buddy-review-card__clear">No required follow-up</div>
      )}

      <EvidenceDetails evidence={result.evidence} />
    </article>
  );
}
