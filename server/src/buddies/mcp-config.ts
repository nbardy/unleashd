import fs from 'node:fs';
import path from 'node:path';
import type { McpServerSpec } from '@nbardy/agent-cli';
import type { BuddyContext } from '@unleashd/shared';

export const BUDDY_MCP_SERVER_NAME = 'unleashd_buddy';
export const BUDDY_AUTOMATION_CLAIM_TOKEN_ENV = 'UNLEASHD_BUDDY_AUTOMATION_CLAIM_TOKEN';

export interface BuddyMcpLaunch {
  command: string;
  args: string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
}

export function resolveBuddyMcpLaunch(): BuddyMcpLaunch {
  const compiledEntrypoint = path.resolve(__dirname, '../buddies/mcp-server.js');
  if (fs.existsSync(compiledEntrypoint)) {
    return {
      command: process.execPath,
      args: [compiledEntrypoint],
      cwd: path.resolve(__dirname, '../..'),
    };
  }

  const sourceEntrypoint = path.resolve(__dirname, '../buddies/mcp-server.ts');
  return {
    command: process.execPath,
    args: ['--import', 'tsx', sourceEntrypoint],
    cwd: path.resolve(__dirname, '../..'),
    // tsx inherits TSX_TSCONFIG_PATH. A relative value from the parent test or
    // supervisor is resolved again from this MCP cwd and can become
    // server/server/tsconfig.json. Pin the source launcher to its own config.
    env: { TSX_TSCONFIG_PATH: path.resolve(__dirname, '../../tsconfig.json') },
  };
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
      ...(launch.env || controlEnv ? { env: { ...launch.env, ...controlEnv } } : {}),
      // Employee state is an authority boundary. Never start a Buddy turn after
      // silently dropping this server.
      required: true,
    },
  };
}

export function buddyBuilderMcpServers(
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): Readonly<Record<string, McpServerSpec>> {
  return {
    [BUDDY_MCP_SERVER_NAME]: {
      command: launch.command,
      args: [...launch.args, '--builder', '--conversation', conversationId],
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
      ...(launch.env ? { env: launch.env } : {}),
      required: true,
    },
  };
}
