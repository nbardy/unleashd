import fs from 'node:fs';
import path from 'node:path';
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

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(',')}]`;
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
  launch: BuddyMcpLaunch,
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

function buddyMcpServerJson(
  context: BuddyContext,
  conversationId: string,
  launch: BuddyMcpLaunch,
): string {
  const serverArgs = buildBuddyServerArgs(context, conversationId, launch);
  const server: Record<string, unknown> = {
    command: launch.command,
    args: serverArgs,
  };
  if (launch.cwd) server.cwd = launch.cwd;
  return JSON.stringify({
    mcpServers: {
      [BUDDY_MCP_SERVER_NAME]: server,
    },
  });
}

function buddyBuilderMcpServerJson(
  conversationId: string,
  launch: BuddyMcpLaunch,
): string {
  const serverArgs = [...launch.args, '--builder', '--conversation', conversationId];
  const server: Record<string, unknown> = {
    command: launch.command,
    args: serverArgs,
  };
  if (launch.cwd) server.cwd = launch.cwd;
  return JSON.stringify({
    mcpServers: {
      [BUDDY_MCP_SERVER_NAME]: server,
    },
  });
}

export function buddyCodexMcpArgs(
  context: BuddyContext,
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): string[] {
  const args = buildBuddyServerArgs(context, conversationId, launch);
  const config = [
    '-c',
    `mcp_servers.${BUDDY_MCP_SERVER_NAME}.command=${tomlString(launch.command)}`,
    '-c',
    `mcp_servers.${BUDDY_MCP_SERVER_NAME}.args=${tomlStringArray(args)}`,
    '-c',
    `mcp_servers.${BUDDY_MCP_SERVER_NAME}.enabled=true`,
    '-c',
    `mcp_servers.${BUDDY_MCP_SERVER_NAME}.required=true`,
  ];
  if (launch.cwd) {
    config.push('-c', `mcp_servers.${BUDDY_MCP_SERVER_NAME}.cwd=${tomlString(launch.cwd)}`);
  }
  return config;
}

export function buddyBuilderCodexMcpArgs(
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): string[] {
  const args = [...launch.args, '--builder', '--conversation', conversationId];
  const config = [
    '-c',
    `mcp_servers.${BUDDY_MCP_SERVER_NAME}.command=${tomlString(launch.command)}`,
    '-c',
    `mcp_servers.${BUDDY_MCP_SERVER_NAME}.args=${tomlStringArray(args)}`,
    '-c',
    `mcp_servers.${BUDDY_MCP_SERVER_NAME}.enabled=true`,
    '-c',
    `mcp_servers.${BUDDY_MCP_SERVER_NAME}.required=true`,
  ];
  if (launch.cwd) {
    config.push('-c', `mcp_servers.${BUDDY_MCP_SERVER_NAME}.cwd=${tomlString(launch.cwd)}`);
  }
  return config;
}

// --- Generic / Claude / Muse / Opencode support ---
// Claude supports --mcp-config <json-or-file> (space-separated, supports --strict-mcp-config).
// Muse and Opencode are wired via the same JSON shape so the shared agent CLI can
// forward it once their CLIs expose a --mcp-config flag. Until then the JSON
// helper is still the canonical source for tests and for the temp-file fallback.

export function buddyClaudeMcpArgs(
  context: BuddyContext,
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): string[] {
  return ['--mcp-config', buddyMcpServerJson(context, conversationId, launch), '--strict-mcp-config'];
}

export function buddyBuilderClaudeMcpArgs(
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): string[] {
  return ['--mcp-config', buddyBuilderMcpServerJson(conversationId, launch), '--strict-mcp-config'];
}

export function buddyMuseMcpArgs(
  context: BuddyContext,
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): string[] {
  // Muse exec currently has no --mcp-config flag (verified via `muse exec --help`).
  // We keep the JSON helper for tests and for the future temp-file wiring,
  // but return no CLI args until the binary exposes --mcp-config or an
  // equivalent env/config-file hook. Enable by returning
  // ['--mcp-config', buddyMcpServerJson(context, conversationId, launch)] once supported.
  void buddyMcpServerJson(context, conversationId, launch);
  return [];
}

export function buddyBuilderMuseMcpArgs(
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): string[] {
  void buddyBuilderMcpServerJson(conversationId, launch);
  return [];
}

export function buddyOpencodeMcpArgs(
  context: BuddyContext,
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): string[] {
  // Opencode run has no --mcp-config flag (verified via `opencode run --help`).
  // Keep helper for future file-based wiring; return no args until CLI supports it.
  void buddyMcpServerJson(context, conversationId, launch);
  return [];
}

export function buddyBuilderOpencodeMcpArgs(
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): string[] {
  void buddyBuilderMcpServerJson(conversationId, launch);
  return [];
}

export function buddyGeminiMcpArgs(
  context: BuddyContext,
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): string[] {
  return ['--mcp-config', buddyMcpServerJson(context, conversationId, launch)];
}

export function buddyBuilderGeminiMcpArgs(
  conversationId: string,
  launch: BuddyMcpLaunch = resolveBuddyMcpLaunch()
): string[] {
  return ['--mcp-config', buddyBuilderMcpServerJson(conversationId, launch)];
}
