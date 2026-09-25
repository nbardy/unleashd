/**
 * The dev backend launches Buddy MCP helpers from an esbuild bundle instead of
 * `node --import tsx <entry>.ts` (2.5-4.5 s per helper per turn). The bundle
 * is only an improvement if each helper still starts and serves its tools, so
 * this builds the real bundle, resolves the launch exactly as a turn does, and
 * completes the MCP handshake with every entrypoint from a bare cwd.
 *
 * What would re-break: an entrypoint (or a module it imports) reading a file
 * relative to __dirname, a `require.main === module` guard in a shared module
 * (a bundle makes every guard true), bundling `@nbardy/buddies` instead of
 * resolving it from server/node_modules, or the launch ignoring a ready bundle.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BuddiesStore } from '@nbardy/buddies';
import {
  MCP_BUNDLE_DIRECTORY,
  type McpEntrypoint,
  mcpBundleState,
  startMcpBundleWatch,
} from '../src/buddies/mcp-bundle';
import { resolveBuddyMcpLaunch } from '../src/buddies/mcp-config';

async function waitForBundle(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const state = mcpBundleState();
    if (state.kind === 'ready') return;
    if (state.kind === 'failed') throw new Error(state.message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('MCP bundle did not finish');
}

test('every bundled Buddy MCP helper starts from a bare cwd and serves its tools', async () => {
  // Inside server/ so the external @nbardy/buddies resolves the way the real
  // bundle's does; a tmpdir would have no node_modules above it.
  mkdirSync(MCP_BUNDLE_DIRECTORY, { recursive: true });
  const bundleDirectory = mkdtempSync(join(MCP_BUNDLE_DIRECTORY, 'test-'));
  const home = mkdtempSync(join(tmpdir(), 'buddy-mcp-bundle-'));
  const bareCwd = join(home, 'cwd');
  mkdirSync(bareCwd, { recursive: true });
  const store = new BuddiesStore(join(home, 'buddies.sqlite'));
  const workspace = store.createWorkspace({ name: 'Workspace', rootPath: join(home, 'ws') });
  const lead = store.createBuddy({ project: workspace.id, name: 'Lead', role: 'Bundle probe' });
  store.close();

  const stop = await startMcpBundleWatch(bundleDirectory);
  try {
    await waitForBundle();
    const helperArgs: Record<McpEntrypoint, string[]> = {
      'mcp-server': ['--buddy', lead.id, '--workspace', workspace.id, '--conversation', 'c-1'],
      'owner-mcp': [],
      'memory-review-mcp': [],
    };
    const expectedServer: Record<McpEntrypoint, string> = {
      'mcp-server': 'unleashd-buddy',
      'owner-mcp': 'unleashd-owner',
      'memory-review-mcp': 'unleashd-memory-review',
    };
    for (const entrypoint of Object.keys(helperArgs) as McpEntrypoint[]) {
      const launch = resolveBuddyMcpLaunch(entrypoint);
      assert.deepEqual(launch.args, [join(bundleDirectory, `${entrypoint}.cjs`)]);
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] =>
            entry[1] !== undefined && !entry[0].startsWith('UNLEASHD_')
        )
      );
      env.BUDDIES_HOME = home;
      // The review proxy refuses to start without a capability; it is not called here.
      env.UNLEASHD_MEMORY_REVIEW_URL = 'http://127.0.0.1:9/unused';
      env.UNLEASHD_MEMORY_REVIEW_TOKEN = 'unused';
      const transport = new StdioClientTransport({
        command: launch.command,
        args: [...launch.args, ...helperArgs[entrypoint]],
        cwd: bareCwd,
        env,
        stderr: 'pipe',
      });
      let diagnostics = '';
      transport.stderr?.on('data', (chunk) => {
        diagnostics += String(chunk);
      });
      const client = new Client({ name: 'bundle-test', version: '1' });
      try {
        await client.connect(transport).catch((error) => {
          throw new Error(`${entrypoint}: ${error}: ${diagnostics}`);
        });
        assert.equal(client.getServerVersion()?.name, expectedServer[entrypoint]);
        assert.ok((await client.listTools()).tools.length > 0, `${entrypoint} serves no tools`);
      } finally {
        await client.close();
      }
    }
  } finally {
    await stop();
    rmSync(bundleDirectory, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
