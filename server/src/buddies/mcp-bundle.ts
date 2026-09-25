import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Prebuilt Buddy MCP helpers for DEV (source-mode) backends.
 *
 * A packaged backend runs from server/dist, where the compiled `.js` helpers
 * sit next to it and `resolveBuddyMcpLaunch` launches them directly. A dev
 * backend runs `src/*.ts` through tsx, so there is no compiled helper and every
 * Buddy turn started each MCP helper as `node --import tsx <entry>.ts`, which
 * transpiles the helper's whole import graph on every start: 2.5-4.5 s per
 * helper per turn, measured 2026-09-25 (02-buddies-server.md §2.1).
 *
 * Instead the dev backend bundles the three entrypoints with esbuild into
 * `server/.mcp-bundle/` (gitignored) and keeps them fresh with esbuild's own
 * watch mode, which polls from esbuild's Go process, not the event loop.
 * `@nbardy/buddies` stays external and resolves from `server/node_modules`
 * relative to the bundle file, so the launch does not depend on the child's
 * cwd (muse forwards none; see buddy-mcp.test.ts "cwd without resolvable
 * tooling").
 *
 * The state is a sum type because the launch must know WHY there is no bundle:
 * each non-ready state falls back to tsx and says so loudly (mcp-config.ts).
 */

export type McpEntrypoint = 'mcp-server' | 'memory-review-mcp' | 'owner-mcp';
export const MCP_ENTRYPOINTS: readonly McpEntrypoint[] = [
  'mcp-server',
  'memory-review-mcp',
  'owner-mcp',
];

export const MCP_BUNDLE_DIRECTORY = path.resolve(__dirname, '../../.mcp-bundle');

export type McpBundleState =
  | { kind: 'not_started' }
  | { kind: 'building' }
  | { kind: 'ready'; directory: string }
  | { kind: 'failed'; message: string };

let state: McpBundleState = { kind: 'not_started' };

export function mcpBundleState(): McpBundleState {
  return state;
}

export function bundledEntrypointPath(directory: string, entrypoint: McpEntrypoint): string {
  return path.join(directory, `${entrypoint}.cjs`);
}

interface EsbuildResult {
  errors: { text: string }[];
}
interface EsbuildPluginBuild {
  onEnd(callback: (result: EsbuildResult) => void): void;
}
interface EsbuildContext {
  watch(): Promise<void>;
  dispose(): Promise<void>;
}
interface Esbuild {
  context(options: Record<string, unknown>): Promise<EsbuildContext>;
}

/** esbuild ships with tsx (a server devDependency); resolve it through tsx, as tools/watch-server.mjs does. */
function loadEsbuild(): Esbuild {
  const serverRequire = createRequire(path.resolve(__dirname, '../../package.json'));
  return createRequire(serverRequire.resolve('tsx'))('esbuild') as Esbuild;
}

/**
 * Bundle the helpers now and again whenever one of their inputs changes.
 * Resolves once watching has started (the first build runs in the background);
 * the returned function stops the watcher.
 */
export async function startMcpBundleWatch(
  directory: string = MCP_BUNDLE_DIRECTORY
): Promise<() => Promise<void>> {
  state = { kind: 'building' };
  const context = await createContext(directory).catch((error: unknown) => {
    state = { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
    throw error;
  });
  await context.watch();
  return async () => {
    await context.dispose();
    state = { kind: 'not_started' };
  };
}

function createContext(directory: string): Promise<EsbuildContext> {
  return loadEsbuild().context({
    entryPoints: Object.fromEntries(
      MCP_ENTRYPOINTS.map((entrypoint) => [entrypoint, path.resolve(__dirname, `${entrypoint}.ts`)])
    ),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: `node${process.versions.node.split('.')[0]}`,
    external: ['@nbardy/buddies'],
    outdir: directory,
    outExtension: { '.js': '.cjs' },
    logLevel: 'silent',
    plugins: [
      {
        name: 'unleashd-mcp-bundle-state',
        // A rebuild keeps the previous `ready` until it ends: the old files stay
        // valid on disk until esbuild replaces them, and a ~50 ms rebuild should
        // not push the turns that start meanwhile onto tsx.
        setup(build: EsbuildPluginBuild) {
          build.onEnd((result) => {
            if (result.errors.length === 0) {
              state = { kind: 'ready', directory };
              return;
            }
            const message = result.errors.map((error) => error.text).join('; ');
            state = { kind: 'failed', message };
            console.error(`[buddies-mcp] Prebuilt MCP helper bundle failed: ${message}`);
          });
        },
      },
    ],
  });
}
