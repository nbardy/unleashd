/**
 * The context meter's file path: the latest request's provider-counted context, read from each
 * harness's own session log. The live path (agent-cli's `usage` event, stored on the
 * conversation) is fresher and wins when present; this one is RETROACTIVE, so a thread idle
 * since before the live event shipped still shows a real number.
 *
 * Pattern: one-write-path (docs/patterns.md#one-write-path)
 * The reading is a read model of the ingest store (`Ingest.latestContext`), filled by the same
 * single parse that fills usage. Until 2026-09-26 this module re-read the transcript itself
 * (421 lines, one parser per harness, 72-93 ms per cache miss on a 28 MB Claude session) and
 * never found Muse child sessions (95 of 198 on the dev machine, T13a).
 * Guard: server/test/usage-context-async-parity.test.ts.
 *
 * It is the LATEST request, never a sum: the two diverge at every compaction, which is why a
 * cumulative number can never drive a fullness meter.
 */

import type { ContextReading } from '@unleashd/ingest';
import type { IngestReads } from '../ingest/instance';

/** A provider-side compaction the harness recorded with its own marker record. */
export interface CompactionMarker {
  count: number;
  preTokens: number | null;
  postTokens: number | null;
  trigger: string | null;
}

/** What the meter reads: the crate's reading with its absent fields made explicit. */
export interface SessionContextReading {
  contextTokens: number;
  /** null: the harness reports no window (Claude); resolve it from the model id. */
  contextWindow: number | null;
  /** null: the harness recorded no compaction for this session. */
  compaction: CompactionMarker | null;
}

function toMeterReading(r: ContextReading): SessionContextReading {
  return {
    contextTokens: r.contextTokens,
    contextWindow: r.contextWindow ?? null,
    compaction: r.compaction
      ? {
          count: r.compaction.count,
          preTokens: r.compaction.preTokens ?? null,
          postTokens: r.compaction.postTokens ?? null,
          trigger: r.compaction.trigger ?? null,
        }
      : null,
  };
}

/** null: no transcript of that session id records a request. */
export async function lookupSessionContext(
  ingest: IngestReads,
  sessionId: string
): Promise<SessionContextReading | null> {
  const reading = await ingest.latestContext(sessionId);
  return reading ? toMeterReading(reading) : null;
}
