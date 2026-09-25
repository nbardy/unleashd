/**
 * The one handle HTTP routes use to reach the running ingest store (crates/unleashd-ingest).
 *
 * Boot owns `Ingest.start` and calls `provideIngest` once the initial scan is committed; readers
 * take an `IngestAccessor` parameter and never import the crate or the slot directly, so the boot
 * and the read models can change independently. Until boot provides it the slot is `starting`,
 * and each reader answers that state explicitly (the usage route: 503; the context meter: no
 * provider reading), never a guessed number.
 */

import type { Ingest } from '@unleashd/ingest';

/** The read models routes use. A `Pick` so a test can pass a real `Ingest` or a tiny fake. */
export type IngestReads = Pick<Ingest, 'usage' | 'latestContext' | 'session' | 'search'>;

export type IngestSlot = { t: 'starting' } | { t: 'ready'; ingest: IngestReads };

export type IngestAccessor = () => IngestSlot;

let slot: IngestSlot = { t: 'starting' };

/** Boot calls this once `Ingest.start` resolved. */
export function provideIngest(ingest: IngestReads): void {
  slot = { t: 'ready', ingest };
}

/** The process's accessor; pass it to route registration. */
export const currentIngest: IngestAccessor = () => slot;
