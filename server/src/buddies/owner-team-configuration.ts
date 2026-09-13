import {
  type ConfigureTeamInput,
  ConfigureTeamInputSchema,
  ProviderSchema,
  type TeamSetupResult,
  TeamSetupResultSchema,
  isEffortValidForProvider,
  isModelIdValidForProvider,
} from '@unleashd/shared';
import type { BuddiesStorePort } from './contract';
import { assertBuddyProviderSupportsMcp } from './provider-capability';
import { teamStore } from './team-access';

/** Host provenance, never accepted in an employee operation or conversation config patch. */
export type OwnerTurnInput = Readonly<{ origin: 'owner_input'; inputId: string }>;
export type OwnerTeamAuthority = Readonly<{
  ownerInputId: string;
  conversationId: string | null;
  workspaceIds: readonly string[];
}>;

interface OwnerConfigurationStore {
  listWorkspaces(): Array<{ id: string }>;
  prepareTeamConfiguration(input: Pick<ConfigureTeamInput, 'key' | 'configuration'>): unknown;
  applyTeamConfiguration(
    input: Omit<ConfigureTeamInput, 'preview'>,
    provenance: { ownerInputId: string; conversationId: string | null }
  ): unknown;
  getTeamConfiguration(input: { workspaceId: string; key: string }): unknown;
}

function configurationStore(store: BuddiesStorePort): OwnerConfigurationStore {
  const candidate = teamStore(store) as unknown as OwnerConfigurationStore;
  if (
    typeof candidate.prepareTeamConfiguration !== 'function' ||
    typeof candidate.applyTeamConfiguration !== 'function' ||
    typeof candidate.getTeamConfiguration !== 'function'
  ) {
    throw Object.assign(new Error('Install the matching owner team configuration package.'), {
      code: 'OWNER_TEAM_CONTRACT_UNAVAILABLE',
    });
  }
  return candidate;
}

export function ownerWorkspaceIds(store: BuddiesStorePort): string[] {
  return (store as unknown as OwnerConfigurationStore).listWorkspaces().map((w) => w.id);
}

function requireOwnerScope(authority: OwnerTeamAuthority, workspaceId: string) {
  if (!authority.ownerInputId || !authority.workspaceIds.includes(workspaceId)) {
    throw Object.assign(new Error('Team configuration is outside this owner control scope.'), {
      code: 'OWNER_SCOPE_DENIED',
    });
  }
}

export function configureOwnerTeam(
  store: BuddiesStorePort,
  input: unknown,
  authority: OwnerTeamAuthority
): TeamSetupResult {
  const parsed = ConfigureTeamInputSchema.parse(input);
  requireOwnerScope(authority, parsed.configuration.workspaceId);
  for (const entry of parsed.configuration.create ?? []) {
    const provider = ProviderSchema.parse(entry.provider ?? 'codex');
    assertBuddyProviderSupportsMcp(provider);
    if (entry.model && !isModelIdValidForProvider(provider, entry.model))
      throw Object.assign(new Error(`Unsupported model for ${entry.name}: ${entry.model}`), {
        code: 'TEAM_PROVIDER_INVALID',
      });
    if (entry.reasoningEffort && !isEffortValidForProvider(provider, entry.reasoningEffort))
      throw Object.assign(
        new Error(`Unsupported effort for ${entry.name}: ${entry.reasoningEffort}`),
        { code: 'TEAM_PROVIDER_INVALID' }
      );
  }
  const service = configurationStore(store);
  return TeamSetupResultSchema.parse(
    parsed.preview
      ? service.prepareTeamConfiguration(parsed)
      : service.applyTeamConfiguration(parsed, authority)
  );
}

export function getOwnerTeamConfiguration(
  store: BuddiesStorePort,
  input: { workspaceId: string; key: string },
  authority: OwnerTeamAuthority
): TeamSetupResult {
  requireOwnerScope(authority, input.workspaceId);
  return TeamSetupResultSchema.parse(configurationStore(store).getTeamConfiguration(input));
}
