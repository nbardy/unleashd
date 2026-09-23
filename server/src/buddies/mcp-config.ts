import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { McpServerSpec } from '@nbardy/agent-cli';
import type { BuddyContext } from '@unleashd/shared';
import { APP_DATA_DIR_ENV, appDataDirectory } from '../app-data';

export const BUDDY_MCP_SERVER_NAME = 'unleashd_buddy';
export const BUDDY_AUTOMATION_CLAIM_TOKEN_ENV = 'UNLEASHD_BUDDY_AUTOMATION_CLAIM_TOKEN';

export interface BuddyMcpLaunch {
  command: string;
  args: string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
}

export function resolveBuddyMcpLaunch(
  entrypoint: 'mcp-server' | 'memory-review-mcp' | 'owner-mcp' = 'mcp-server'
): BuddyMcpLaunch {
  const compiledEntrypoint = path.resolve(__dirname, `../buddies/${entrypoint}.js`);
  if (fs.existsSync(compiledEntrypoint)) {
    return {
      command: process.execPath,
      args: [compiledEntrypoint],
      cwd: path.resolve(__dirname, '../..'),
    };
  }

  const sourceEntrypoint = path.resolve(__dirname, `../buddies/${entrypoint}.ts`);
  return {
    command: process.execPath,
    args: ['--import', resolveTsxLoader(), sourceEntrypoint],
    cwd: path.resolve(__dirname, '../..'),
    // tsx inherits TSX_TSCONFIG_PATH. A relative value from the parent test or
    // supervisor is resolved again from this MCP cwd and can become
    // server/server/tsconfig.json. Pin the source launcher to its own config.
    env: { TSX_TSCONFIG_PATH: path.resolve(__dirname, '../../tsconfig.json') },
  };
}

/**
 * Absolute tsx loader for the source-mode MCP entrypoint. `--import tsx`
 * resolves against the CHILD's cwd, so harnesses that cannot forward cwd
 * (muse takes no per-server cwd) crash with ERR_MODULE_NOT_FOUND when the
 * conversation workspace has no tsx. An absolute loader path makes the
 * server cwd-independent — the store already is (BUDDIES_HOME/HOME-derived).
 */
function resolveTsxLoader(): string {
  try {
    const serverRoot = path.resolve(__dirname, '../..');
    const serverRequire = createRequire(path.join(serverRoot, 'package.json'));
    return serverRequire.resolve('tsx');
  } catch {
    return 'tsx';
  }
}

function buildBuddyServerArgs(
  context: BuddyContext,
  conversationId: string,
  launch: BuddyMcpLaunch
): string[] {
  const args = [
    ...launch.args,
    '--buddy',
    context.buddyId,
    '--workspace',
    context.workspaceId,
    '--conversation',
    conversationId,
  ];
  if (context.buddyProjectId) {
    args.push('--project', context.buddyProjectId);
  }
  if (context.automationRunId) {
    args.push('--automation-run', context.automationRunId);
  }
  if (context.delegatedByBuddyId) {
    args.push('--delegated-by', context.delegatedByBuddyId);
  }
  for (const operation of context.allowedBuddyOperations ?? []) {
    args.push('--allowed-operation', operation);
  }
  return args;
}

export function buddyMcpServers(
  context: BuddyContext,
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch(),
  controlEnv?: Readonly<Record<string, string>>
): Readonly<Record<string, McpServerSpec>> {
  return {
    [BUDDY_MCP_SERVER_NAME]: {
      command: launch.command,
      args: buildBuddyServerArgs(context, conversationId, launch),
      // This is the Unleashd server directory, not the Buddy workspace:
      // source-mode launch needs it to resolve the tsx loader and MCP entrypoint.
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
      env: {
        ...launch.env,
        ...controlEnv,
        // Channel media lands under the server's uploads directory; see app-data.ts.
        [APP_DATA_DIR_ENV]: appDataDirectory(),
        ...(context.knowledgeScope
          ? { UNLEASHD_BUDDY_KNOWLEDGE_SCOPE: JSON.stringify(context.knowledgeScope) }
          : {}),
      },
      // Employee state is an authority boundary. Never start a Buddy turn after
      // silently dropping this server.
      required: true,
    },
  };
}

export function buddyBuilderMcpServers(
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch(),
  controlEnv?: Readonly<Record<string, string>>
): Readonly<Record<string, McpServerSpec>> {
  return {
    [BUDDY_MCP_SERVER_NAME]: {
      command: launch.command,
      args: [...launch.args, '--builder', '--conversation', conversationId],
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
      ...(launch.env || controlEnv ? { env: { ...launch.env, ...controlEnv } } : {}),
      required: true,
    },
  };
}

export function buddyOwnerMcpServers(
  controlEnv: Readonly<Record<string, string>>,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch('owner-mcp')
): Readonly<Record<string, McpServerSpec>> {
  return {
    unleashd_owner: {
      command: launch.command,
      args: [...launch.args],
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
      env: { ...launch.env, ...controlEnv },
      required: true,
    },
  };
}
