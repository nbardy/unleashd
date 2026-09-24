import type {
  ConfigError,
  ConfigResolution,
  ConversationConfig,
  ConversationConfigState,
  Result,
} from '@unleashd/shared';
import type { ConfigUpdateCommand, ConversationConfigService } from './config-service';

// The slice of a live conversation a configuration change reads and writes.
export interface ConfigurableRuntime {
  readonly id: string;
  readonly config: ConversationConfig;
  readonly configRevision: number;
  readonly configResolution: ConfigResolution;
  readonly isRunning: boolean;
  readonly queue: { readonly length: number };
  hasStartedSession(): boolean;
  applyConfigState(state: ConversationConfigState): void;
}

/**
 * The one path that changes a live conversation's configuration: validate the
 * patch against the runtime's state (a started session locks the provider),
 * persist the next revision, then apply it to the runtime. The owner's
 * `set_conversation_config` command and a channel mention's model choice both
 * go through here, so both enforce the same lock and the same resolution.
 */
export async function updateRuntimeConfig(
  configService: Pick<ConversationConfigService, 'update'>,
  conversation: ConfigurableRuntime,
  command: ConfigUpdateCommand
): Promise<Result<ConversationConfigState, ConfigError>> {
  const result = await configService.update(
    {
      config: conversation.config,
      revision: conversation.configRevision,
      resolution: conversation.configResolution,
    },
    {
      isRunning: conversation.isRunning,
      queueDepth: conversation.queue.length,
      hasStartedSession: conversation.hasStartedSession(),
    },
    command
  );
  if (!result.ok) return result;
  conversation.applyConfigState(result.value.next);
  return { ok: true, value: result.value.next };
}
