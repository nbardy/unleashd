import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeCommand } from '@nbardy/agent-cli';
import type { BuddyControlServer } from './control-server';
import { resolveBuddyMcpLaunch } from './mcp-config';
import {
  MEMORY_REVIEW_EFFORT,
  MEMORY_REVIEW_INSTRUCTIONS,
  MEMORY_REVIEW_MODEL,
  type MemoryReviewRunner,
} from './memory-review';
import { MEMORY_REVIEW_TOOLS } from './memory-review-tools';

/** Fresh CLI process, no Buddy MCP/session/goal, no repository or user-config instructions. */
export function createMemoryReviewRunner(
  control: Pick<BuddyControlServer, 'issueMemoryReview'>,
  execute: typeof executeCommand = executeCommand
): MemoryReviewRunner {
  return async ({ prompt, signal, executeTool }) => {
    signal.throwIfAborted();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-memory-review-'));
    const instructionsPath = path.join(directory, 'instructions.md');
    let capability: ReturnType<BuddyControlServer['issueMemoryReview']> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;
    try {
      fs.writeFileSync(instructionsPath, MEMORY_REVIEW_INSTRUCTIONS, { mode: 0o600 });
      capability = control.issueMemoryReview(executeTool, signal);
      const launch = resolveBuddyMcpLaunch('memory-review-mcp');
      const turn = execute({
        harness: 'codex',
        mode: 'conversation',
        model: MEMORY_REVIEW_MODEL,
        reasoningEffort: MEMORY_REVIEW_EFFORT,
        cwd: directory,
        prompt,
        yolo: false,
        detached: true,
        mcpServers: {
          unleashd_memory: {
            ...launch,
            env: { ...launch.env, ...capability.env },
            required: true,
          },
        },
        extraArgs: [
          '--ignore-user-config',
          '--ignore-rules',
          '--ephemeral',
          '-s',
          'read-only',
          '-c',
          `model_instructions_file=${JSON.stringify(instructionsPath)}`,
          '-c',
          'project_doc_max_bytes=0',
          '-c',
          'web_search="disabled"',
          '-c',
          'tools.update_plan.enabled=false',
          '-c',
          'tools.experimental_request_user_input.enabled=false',
          '-c',
          'orchestrator.skills.enabled=false',
          '-c',
          // This server carries only the memory capability authorized for this review.
          'mcp_servers.unleashd_memory.default_tools_approval_mode="approve"',
          // Keep the code-mode host: the CLI uses it to transport scoped MCP calls.
          ...[
            'shell_tool',
            'unified_exec',
            'multi_agent',
            'multi_agent_v2',
            'apps',
            'plugins',
            'browser_use',
            'computer_use',
            'image_generation',
            'memories',
            'hooks',
            'goals',
            'view_image',
            'skill_search',
            'sleep_tool',
          ].flatMap((feature) => ['--disable', feature]),
        ],
      });
      stop = () => {
        turn.stop();
        killTimer ??= setTimeout(() => turn.stop('SIGKILL'), 2_000);
      };
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
      let failure: string | undefined;
      let output = '';
      const consumed = (async () => {
        for await (const event of turn.events) {
          if (
            event.type === 'tool.use' &&
            event.name !== 'mcp_tool' &&
            !Object.keys(MEMORY_REVIEW_TOOLS).some(
              (name) => event.name === name || event.name === `mcp__unleashd_memory__${name}`
            )
          ) {
            failure = `Memory reviewer attempted a non-memory tool: ${event.name}`;
            stop!();
          } else if (event.type === 'error') {
            failure = event.message;
          } else if (event.type === 'text.delta') {
            output = (output + event.text).slice(-4000);
          }
        }
      })();
      // Retain process ownership until the CLI has exited AND its normalized events drain.
      const [completion, events] = await Promise.allSettled([turn.completed, consumed]);
      signal.throwIfAborted();
      if (events.status === 'rejected') throw events.reason;
      if (completion.status === 'rejected') throw completion.reason;
      if (failure || completion.value.reason !== 'success' || completion.value.exitCode !== 0) {
        throw new Error(
          failure ??
            `Memory reviewer exited: ${completion.value.reason} (${completion.value.exitCode})`
        );
      }
      return output;
    } finally {
      capability?.revoke();
      if (stop) signal.removeEventListener('abort', stop);
      if (killTimer) clearTimeout(killTimer);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}
