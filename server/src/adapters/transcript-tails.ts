/**
 * Resume points for append-only transcripts the poller keeps re-reading.
 *
 * Why this exists: pollForChanges re-parsed every changed transcript from
 * byte 0. An external Claude session that is still running changes every
 * poll, and one 120MB transcript cost ~1.2s of parsing (up to ~230ms of
 * unbroken event-loop stall) every 5 seconds on 2026-09-25, which queued
 * every WebSocket command, including create_conversation, behind it. Resuming
 * from the previous read's byte offset makes a poll of that file cost only
 * the bytes appended since.
 *
 * A resume is taken only when the file provably only grew; every other case
 * is a named full read (see ReadPlan), never a guess.
 */

import * as fs from 'node:fs';
import type { AppendableRead, ParsedSession, SourceGrowth } from './disk-adapter';

/**
 * Bytes just before the resume offset, re-checked before resuming. Same
 * inode + no shrink cannot see a file truncated and rewritten past its old
 * length between two polls; the bytes a resume would build on can.
 */
const FINGERPRINT_BYTES = 64;

/** Only still-growing transcripts are kept; each holds its folded messages. */
const DEFAULT_CAPACITY = 16;

interface Checkpoint {
  read: AppendableRead;
  dev: number;
  ino: number;
  fingerprint: Buffer;
}

/** Why a changed transcript was read from byte 0 instead of resumed. */
export type FullReadReason = 'unseen' | 'replaced' | 'shrank' | 'rewritten';

type ReadPlan =
  | { kind: 'resume'; checkpoint: Checkpoint }
  | { kind: 'full'; reason: FullReadReason };

type AppendedGrowth = Extract<SourceGrowth, { kind: 'appended' }>;

export class TranscriptTails {
  /** Map insertion order is recency: a read re-inserts its path at the end. */
  private readonly checkpoints = new Map<string, Checkpoint>();

  constructor(private readonly capacity = DEFAULT_CAPACITY) {}

  async read(filePath: string, growth: AppendedGrowth): Promise<ParsedSession | null> {
    // Taken out before reading: extend() advances the fold in place, so a read
    // that throws halfway must not leave that half-advanced state resumable.
    const checkpoint = this.checkpoints.get(filePath);
    this.checkpoints.delete(filePath);
    const stat = await fs.promises.stat(filePath);
    const plan = await planRead(filePath, stat, checkpoint);
    const read =
      plan.kind === 'resume' ? await plan.checkpoint.read.extend() : await growth.read(filePath);
    this.checkpoints.set(filePath, {
      read,
      dev: stat.dev,
      ino: stat.ino,
      fingerprint: await readFingerprint(filePath, read.offset),
    });
    for (const stale of this.checkpoints.keys()) {
      if (this.checkpoints.size <= this.capacity) break;
      this.checkpoints.delete(stale);
    }
    return read.session;
  }
}

async function planRead(
  filePath: string,
  stat: fs.Stats,
  checkpoint: Checkpoint | undefined
): Promise<ReadPlan> {
  if (!checkpoint) return { kind: 'full', reason: 'unseen' };
  if (stat.dev !== checkpoint.dev || stat.ino !== checkpoint.ino) {
    return { kind: 'full', reason: 'replaced' };
  }
  if (stat.size < checkpoint.read.offset) return { kind: 'full', reason: 'shrank' };
  const fingerprint = await readFingerprint(filePath, checkpoint.read.offset);
  if (!fingerprint.equals(checkpoint.fingerprint)) return { kind: 'full', reason: 'rewritten' };
  return { kind: 'resume', checkpoint };
}

async function readFingerprint(filePath: string, offset: number): Promise<Buffer> {
  const start = Math.max(0, offset - FINGERPRINT_BYTES);
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(offset - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
