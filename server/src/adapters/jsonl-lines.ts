import * as fs from 'node:fs';

const NEWLINE = 0x0a;
const READ_CHUNK_BYTES = 1024 * 1024;

/** One line of a JSONL source, with the byte offset just past it. */
export interface JsonlLine {
  text: string;
  /** Byte offset of the first byte after this line (after its newline when terminated). */
  end: number;
  /**
   * False only for a final fragment with no newline yet. A writer may be
   * mid-append, so the caller decides whether the fragment is a record.
   */
  terminated: boolean;
}

/**
 * Lines of `filePath` starting at byte `start`, with exact byte offsets.
 *
 * readline cannot report byte positions, and an append-only resume point
 * must be a byte offset: the tail read starts at `createReadStream({ start })`.
 * Each line is decoded as its own UTF-8 slice, so a multi-byte character is
 * never split across a chunk boundary.
 */
export async function* readJsonlLines(filePath: string, start: number): AsyncGenerator<JsonlLine> {
  const stream = fs.createReadStream(filePath, { start, highWaterMark: READ_CHUNK_BYTES });
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let offset = start;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let lineStart = 0;
    for (
      let newline = chunk.indexOf(NEWLINE, lineStart);
      newline !== -1;
      newline = chunk.indexOf(NEWLINE, lineStart)
    ) {
      const piece = chunk.subarray(lineStart, newline);
      const line =
        pendingBytes === 0
          ? piece
          : Buffer.concat([...pending, piece], pendingBytes + piece.length);
      offset += newline + 1 - lineStart;
      pending = [];
      pendingBytes = 0;
      lineStart = newline + 1;
      yield { text: line.toString('utf8'), end: offset, terminated: true };
    }
    if (lineStart < chunk.length) {
      const rest = chunk.subarray(lineStart);
      pending.push(rest);
      pendingBytes += rest.length;
      offset += rest.length;
    }
  }
  if (pendingBytes > 0) {
    yield {
      text: Buffer.concat(pending, pendingBytes).toString('utf8'),
      end: offset,
      terminated: false,
    };
  }
}
