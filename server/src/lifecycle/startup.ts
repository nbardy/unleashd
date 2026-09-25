import { exec } from 'node:child_process';
import type { Server } from 'node:http';
import { ensureAvailablePort } from './port-guard';
import { askQuestion, checkPort, killProcessOnPort } from './system-ports';

export interface StartupOptions {
  port: number;
  host: string;
  development: boolean;
  developmentClientPort: number;
  /**
   * Whether a production start opens the app in the browser. Only a server a
   * human launched in a terminal should: `server/test/auth.test.ts` boots the
   * real server on port 7527 with piped stdio, and every run of it (agents run
   * the suite constantly) popped http://localhost:7527/ open — which read to
   * the user as "opens the page on every hot reload" (2026-09-25).
   */
  browser: 'open' | 'none';
}

export interface StartupPorts {
  server: Server;
  initialize(): Promise<void>;
  startOptionalScheduler(): Promise<void>;
  pauseOptionalScheduler(): void;
  isStartupActive(): boolean;
  markReady(): boolean;
  abortStartup(): void;
  loadConversations(): Promise<void>;
  startPolling(): void;
}

export async function runServerStartup(
  options: StartupOptions,
  ports: StartupPorts
): Promise<void> {
  await ports.initialize();
  await ensureAvailablePort(options.port, {
    checkPort,
    askQuestion,
    killProcessOnPort,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    exit: (code) => process.exit(code),
  });

  ports.server.listen(options.port, options.host, () => {
    const localPort = options.development ? options.developmentClientPort : options.port;
    const startUrl = `http://localhost:${localPort}`;
    if (options.development) {
      console.log(`Server running on http://localhost:${options.port} (frontend on ${startUrl})`);
      return;
    }
    console.log(`Server running on ${startUrl} (backend on ${options.host}:${options.port})`);
    if (options.browser === 'none') return;
    const command =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${command} ${startUrl}`);
  });

  // Barrier is intentional (59da781): authoritative init + single mtime
  // baseline. WS `init` streams summaries with loading:true; Phase 1 was
  // 38s before batches (composite opencode) — now single-stat in loader.ts.
  console.log('Loading conversations before accepting WebSocket commands...');
  await ports.loadConversations();
  if (!ports.isStartupActive()) {
    ports.abortStartup();
    return;
  }
  await ports.startOptionalScheduler();
  if (!ports.markReady()) {
    ports.pauseOptionalScheduler();
    return;
  }
  console.log('Initial load complete; WebSocket handlers unblocked');
  ports.startPolling();
  console.log('File polling started (5s interval)');
}
