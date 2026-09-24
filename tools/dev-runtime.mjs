// The dev runtime's long-lived tools, hosted in ONE process.
//
// Until 2026-09-25 `pnpm dev` ran them through concurrently plus a `pnpm
// --filter …` wrapper per tool: 18 processes, ~7 of which only launched
// another. Here the supervisor process itself runs
//   - the three TypeScript watch compilers (shared ESM, shared CJS, agent-cli-tool),
//   - the Vite dev server,
//   - the backend runner (tools/watch-server.mjs),
// through their JavaScript APIs. The backend stays a child process: it is the
// unit that restarts, and it owns the provider pipes of running agent turns.
//
// Order matters: the backend and Vite start only after every compiler's first
// pass. A watcher that starts beside the backend rewrites dist/ while the
// backend loads it, which is what restarted a backend mid-startup on
// 2026-09-25 (see tools/watch-server.mjs).
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBackendRunner, esbuildCheck } from './watch-server.mjs';

/** Prefix every line of a chunk, for tools that print through one stdout. */
export function linePrefixer(prefix, write) {
  let partial = '';
  return (chunk) => {
    const text = partial + chunk;
    const lines = text.split('\n');
    partial = lines.pop();
    for (const line of lines) write(`${prefix} ${line}\n`);
  };
}

/**
 * One `tsc --watch` equivalent through the TypeScript API of the package that
 * owns `configPath`. Resolves `ready` after the first full pass, whatever its
 * error count: type errors are reported, not fatal, exactly as `tsc --watch`.
 */
export function startCompiler({ name, configPath, log }) {
  const ts = createRequire(configPath)('typescript');
  const host = ts.sys;
  const format = {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: host.getCurrentDirectory,
    getNewLine: () => '\n',
  };
  let markReady;
  const ready = new Promise((resolve) => {
    markReady = resolve;
  });
  const report = (diagnostic) =>
    log(`[${name}] ${ts.formatDiagnostic(diagnostic, format).trimEnd()}`);
  const watchHost = ts.createWatchCompilerHost(
    configPath,
    {},
    host,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    report,
    (diagnostic, _newLine, _options, errorCount) => {
      log(`[${name}] ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
      // errorCount is passed only with the "Found N errors" status that ends a pass.
      if (errorCount !== undefined) markReady();
    }
  );
  const program = ts.createWatchProgram(watchHost);
  return { ready, close: () => program.close() };
}

/** Vite's dev server, with the client's own vite.config.ts (`overrides` merge over it). */
export async function startVite({ clientRoot, overrides = {} }) {
  const entry = createRequire(path.join(clientRoot, 'package.json')).resolve('vite');
  const { createServer } = await import(pathToFileURL(entry).href);
  const server = await createServer({
    root: clientRoot,
    configFile: path.join(clientRoot, 'vite.config.ts'),
    ...overrides,
  });
  await server.listen();
  server.printUrls();
  return server;
}

/** The backend runner; its output is prefixed like the other tools. */
export function startBackend({ repositoryRoot, env, log }) {
  const serverRoot = path.join(repositoryRoot, 'server');
  const runner = createBackendRunner({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/server.ts'],
    cwd: serverRoot,
    env,
    watchRoot: repositoryRoot,
    check: esbuildCheck('src/server.ts', serverRoot),
    output: linePrefixer('[server]', (line) => process.stdout.write(line)),
    log: (line) => log(`[server-watch] ${line}`),
    logError: (line) => log(`[server-watch] ${line}`),
  });
  runner.start();
  return runner;
}
