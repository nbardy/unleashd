import fs from 'node:fs';
import type { CommandError, GeneralCommandError, ServerMessageInput } from '@unleashd/shared';
import { WebSocket } from 'ws';

export function sendToClient(ws: WebSocket, data: ServerMessageInput): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

export function sendProtocolError(ws: WebSocket, message: string): void {
  sendToClient(ws, { type: 'error', message });
}

export function validateWorkingDirectory(
  workingDirectory: string
): GeneralCommandError | undefined {
  try {
    return fs.statSync(workingDirectory).isDirectory()
      ? undefined
      : { code: 'invalid_directory', message: 'Path is not a directory' };
  } catch {
    return {
      code: 'invalid_directory',
      message: `No matching folder: ${workingDirectory}`,
    };
  }
}

export function sendAck(
  ws: WebSocket,
  commandId: string,
  result: Extract<ServerMessageInput, { type: 'ack' }>['result']
): void {
  sendToClient(ws, { type: 'ack', commandId, result });
}

/**
 * A rejection never carries a snapshot (v2 embedded the whole conversation,
 * messages included). Callers send the authoritative field as a patch first.
 */
export function sendCommandRejected(
  ws: WebSocket,
  input: { commandId: string; conversationId?: string; error: CommandError }
): void {
  sendAck(ws, input.commandId, {
    t: 'rejected',
    conversationId: input.conversationId ?? null,
    error: input.error,
  });
}

export const WS_LIVENESS_INTERVAL_MS = 20_000;

/**
 * Ping the peer every `intervalMs` and terminate() a socket that has not
 * ponged since the previous ping. A laptop that slept, or a connection held
 * open by the dev port proxy after the far end vanished, leaves a half-open
 * socket: no FIN ever arrives, so neither side sees `close`, broadcasts go
 * nowhere, and the client never reconnects — which is the only path that
 * gets a fresh `init` and resends pending creations. terminate() emits
 * `close` on this side, which clears the timer; a live browser answers pings
 * at the protocol level with no app code.
 */
export function superviseLiveness(ws: WebSocket, intervalMs: number): void {
  let answeredSinceLastPing = true;
  let lastTickAt = Date.now();
  let lastBufferedAmount = 0;
  ws.on('pong', () => {
    answeredSinceLastPing = true;
  });
  const timer = setInterval(() => {
    const now = Date.now();
    // Two ways a LIVE peer misses a pong, both confirmed by review of 4d2b990:
    // - our own event loop stalled (seconds, see the 2026-09-25 audit): the
    //   overdue tick runs before the poll phase reads a pong that already
    //   arrived, so a late tick is our fault, not the peer's;
    // - a slow link still downloading the 2.4MB `init`: our ping sits behind
    //   it in the send buffer. A shrinking buffer means bytes are flowing.
    // A half-open socket shows neither: ticks on time, buffer flat or growing.
    const tickWasLate = now - lastTickAt > intervalMs * 1.5;
    const sendBufferDraining = ws.bufferedAmount > 0 && ws.bufferedAmount < lastBufferedAmount;
    lastTickAt = now;
    lastBufferedAmount = ws.bufferedAmount;
    if (!answeredSinceLastPing && !tickWasLate && !sendBufferDraining) {
      ws.terminate();
      return;
    }
    answeredSinceLastPing = false;
    ws.ping();
  }, intervalMs);
  // The HTTP server keeps the process alive; a heartbeat must not.
  timer.unref();
  ws.on('close', () => clearInterval(timer));
}

export function sendCommandAccepted(ws: WebSocket, input: { commandId: string }): void {
  sendAck(ws, input.commandId, { t: 'accepted' });
}
