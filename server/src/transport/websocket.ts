import fs from 'node:fs';
import type {
  ConfigError,
  Conversation,
  GeneralCommandError,
  ServerMessage,
} from '@unleashd/shared';
import { WebSocket } from 'ws';

export function sendToClient(ws: WebSocket, data: ServerMessage): void {
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

export function sendCommandRejected(
  ws: WebSocket,
  input: {
    commandId: string;
    conversationId?: string;
    error: ConfigError | GeneralCommandError;
    authoritativeConversation?: Conversation;
  }
): void {
  sendToClient(ws, {
    type: 'command_rejected',
    commandId: input.commandId,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    error: input.error,
    ...(input.authoritativeConversation
      ? { authoritativeConversation: input.authoritativeConversation }
      : {}),
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
  ws.on('pong', () => {
    answeredSinceLastPing = true;
  });
  const timer = setInterval(() => {
    if (!answeredSinceLastPing) {
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

export function sendCommandAccepted(
  ws: WebSocket,
  input: { commandId: string; conversationId: string }
): void {
  sendToClient(ws, { type: 'command_accepted', ...input });
}
