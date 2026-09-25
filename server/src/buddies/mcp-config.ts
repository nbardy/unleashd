import type { McpServerSpec } from '@nbardy/agent-cli';
import { specFromEnv } from './policy-port';

// Legacy shim: the names runtime.ts imports today, over the one HTTP endpoint (mcp.ts). There
// are no helper processes any more: every spec is `{kind:'http'}` with the turn's grant, which
// the env record from `issueBuddyControlCapability` carries (policy-port.ts). Delete with the
// post-T08 wiring, when BuddyTurnPolicy calls `BuddyPolicyPort.mcpServers` directly.

/** runtime.ts still writes the run's lease token under this name; the HTTP spec ignores it. */
export const BUDDY_AUTOMATION_CLAIM_TOKEN_ENV = 'UNLEASHD_BUDDY_LEASE_TOKEN';

export function buddyMcpServers(
  _context: unknown,
  _conversationId: string,
  _unused?: undefined,
  env: Readonly<Record<string, string>> = {}
): Record<string, McpServerSpec> {
  return specFromEnv(env);
}

export function buddyBuilderMcpServers(
  _conversationId: string,
  _unused?: undefined,
  env: Readonly<Record<string, string>> = {}
): Record<string, McpServerSpec> {
  return specFromEnv(env);
}

/** Owner authority is the promoted grant of the one server: no second server. */
export function buddyOwnerMcpServers(
  _env: Readonly<Record<string, string>>
): Record<string, McpServerSpec> {
  return {};
}
