import { TeamSetupResultSchema } from './buddy-team-configuration.js';

/** Created from a validated tool result by the host, never requested from model prose. */
export function formatBuddyTeamConfigurationToolResult(output: unknown): string | null {
  let payload = output;
  try {
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    if (record.structuredContent)
      return formatBuddyTeamConfigurationToolResult(record.structuredContent);
    if (Array.isArray(record.content)) {
      for (const block of record.content) {
        if (block?.type === 'text') {
          const result = formatBuddyTeamConfigurationToolResult(block.text);
          if (result) return result;
        }
      }
    }
    const parsed = TeamSetupResultSchema.safeParse(record.teamSetup);
    if (!parsed.success) return null;
    return `<!--buddy_team_configuration:${encodeURIComponent(JSON.stringify(parsed.data))}-->`;
  } catch {
    return null;
  }
}
