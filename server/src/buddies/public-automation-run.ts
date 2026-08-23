import {
  BuddyAutomationRunSchema,
  type BuddyAutomationRun as PublicBuddyAutomationRun,
} from '@unleashd/shared';
import type { BuddyAutomationRun } from './contract';

/**
 * The store row contains executor credentials; every outward-facing boundary
 * uses this single projection so adding a route or MCP response cannot silently
 * serialize them. See invariant I3 and the rejected alternatives in
 * agent_notes/2026-08-24_automation-execution-ownership-design.md.
 */
export function publicAutomationRun(run: BuddyAutomationRun): PublicBuddyAutomationRun {
  const { claim_token: _claimToken, claim_acquired: _claimAcquired, ...publicRun } = run;
  return BuddyAutomationRunSchema.parse(publicRun);
}
