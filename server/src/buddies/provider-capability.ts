import { harnessMcpCapability } from '@nbardy/agent-cli';
import type { Provider } from '@unleashd/shared';

/**
 * Buddy identity is an authority boundary, so Buddy turns require a harness
 * with an explicit required-MCP contract rather than best-effort injection.
 * Keep this one predicate shared by runtime, profile and Builder admission. See
 * invariant I11 in
 * agent_notes/2026-08-24_automation-execution-ownership-design.md.
 */
export function assertBuddyProviderSupportsMcp(provider: Provider): void {
  if (harnessMcpCapability(provider) === 'required') return;
  throw new Error(
    `Provider "${provider}" cannot start Buddy conversations because its harness cannot guarantee required Buddy state tools.`
  );
}
