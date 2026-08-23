import fs from 'node:fs';
import path from 'node:path';
import type { McpServerSpec } from '@nbardy/agent-cli';
import type { BuddyContext } from '@unleashd/shared';

export const BUDDY_MCP_SERVER_NAME = 'unleashd_buddy';

export interface BuddyMcpLaunch {
  command: string;
  args: string[];
  cwd?: string;
}

function buddyApiBaseUrl(): string {
  const configured = process.env.UNLEASHD_BUDDY_API_BASE?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const port = process.env.PORT?.trim() || '7489';
  return `http://127.0.0.1:${port}`;
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
    '--api-base',
    buddyApiBaseUrl(),
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
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): Readonly<Record<string, McpServerSpec>> {
  return {
    [BUDDY_MCP_SERVER_NAME]: {
      command: launch.command,
      args: buildBuddyServerArgs(context, conversationId, launch),
      // This is the Unleashd server directory, not the Buddy workspace:
      // source-mode launch needs it to resolve the tsx loader and MCP entrypoint.
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
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
      required: true,
    },
  };
}
