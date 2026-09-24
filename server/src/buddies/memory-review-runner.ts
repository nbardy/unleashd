import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExecuteCommandRequest, McpServerSpec } from '@nbardy/agent-cli';
import { executeCommand } from '@nbardy/agent-cli';
import type { BuddyControlServer } from './control-server';
import { discardCursorTranscript } from './cursor-ephemeral';
import { resolveBuddyMcpLaunch } from './mcp-config';
import {
  MEMORY_REVIEW_INSTRUCTIONS,
  MEMORY_REVIEW_MODELS,
  type MemoryReviewModelChoice,
  type MemoryReviewRunner,
} from './memory-review';
import { MEMORY_REVIEW_TOOLS } from './memory-review-tools';

/** The one MCP server a reviewer is ever given; also the namespace its tool names carry. */
const MEMORY_MCP_SERVER = 'unleashd_memory';
const MEMORY_TOOL_PREFIX = `mcp__${MEMORY_MCP_SERVER}__`;
const MEMORY_TOOL_NAMES = new Set(Object.keys(MEMORY_REVIEW_TOOLS));

function isMemoryTool(name: string): boolean {
  return (
    MEMORY_TOOL_NAMES.has(name) ||
    (name.startsWith(MEMORY_TOOL_PREFIX) &&
      MEMORY_TOOL_NAMES.has(name.slice(MEMORY_TOOL_PREFIX.length)))
  );
}

interface ReviewLaunch {
  readonly choice: MemoryReviewModelChoice;
  /** The EVIDENCE_JSON payload, kept separate from the curation contract. */
  readonly evidence: string;
  readonly instructionsPath: string;
  readonly directory: string;
  readonly memoryServer: McpServerSpec;
}

/**
 * One handler per reviewer harness. Each owns the whole launch for its CLI and
 * the predicate for which `tool.use` names that CLI may legitimately emit —
 * both are harness-shaped, so neither belongs in the shared attempt loop.
 */
interface ReviewHarnessHandler {
  request(launch: ReviewLaunch): ExecuteCommandRequest;
  authorizes(toolName: string): boolean;
  /**
   * Present only where the CLI cannot be told not to persist the run (cursor):
   * erase the transcript after exit so the review never surfaces as a chat.
   */
  discardSession?(sessionId: string): void;
}

const CODEX_DISABLED_FEATURES = [
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
];

const codexHandler: ReviewHarnessHandler = {
  request: ({ choice, evidence, instructionsPath, directory, memoryServer }) => ({
    harness: 'codex',
    mode: 'conversation',
    model: choice.model,
    reasoningEffort: choice.reasoningEffort,
    cwd: directory,
    prompt: evidence,
    yolo: false,
    detached: true,
    mcpServers: { [MEMORY_MCP_SERVER]: memoryServer },
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
      ...CODEX_DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
    ],
  }),
  // `mcp_tool` is codex's generic transport frame, not a distinct tool.
  authorizes: (toolName) => toolName === 'mcp_tool' || isMemoryTool(toolName),
};

/**
 * Muse USED TO emit three tool.use-shaped records per MCP call -- the model
 * step (`model.meta.response`), the task lifecycle for the call
 * (`tool:mcp__unleashd_memory__echo`) and the call itself. Only the last was an
 * invocation; the other two were `task.lifecycle.*` bookkeeping that the muse
 * parser reshaped into tool.use, and treating them as unauthorized tools killed
 * every fallback review on its first model step.
 *
 * The parser now classifies them at the source: model steps leave as hidden
 * `progress`, and a `tool:` intent becomes the single bare-named tool.use for
 * that call. So these two exceptions should no longer fire.
 *
 * They are kept deliberately. This guard's failure mode is killing a review
 * mid-write over muse's own bookkeeping, so tolerating a shape we know is not
 * an invocation costs nothing, while dropping the exceptions would re-arm that
 * failure the next time muse's event shape moves under us.
 */
const MUSE_MODEL_STEP = /^model\./;
const MUSE_LIFECYCLE_TOOL_PREFIX = 'tool:';

const museHandler: ReviewHarnessHandler = {
  request: ({ choice, evidence, directory, memoryServer }) => ({
    harness: 'muse',
    mode: 'conversation',
    model: choice.model,
    reasoningEffort: choice.reasoningEffort,
    cwd: directory,
    // Muse exposes no system-instructions file (codex's `model_instructions_file`
    // has no counterpart in `muse exec --help`), so the curation contract rides
    // ahead of the evidence, which stays fenced behind its EVIDENCE_JSON marker.
    prompt: `${MEMORY_REVIEW_INSTRUCTIONS}\n\n${evidence}`,
    yolo: false,
    detached: true,
    mcpServers: { [MEMORY_MCP_SERVER]: memoryServer },
    extraArgs: [
      // Muse does not trust a workspace unless asked, so its skills and rules
      // are already excluded; this drops the user's personal ones too.
      '--no-foreign-personal-context',
      '--no-session-log',
      '--disable-web-tools',
      '--disable-shell',
      '--disable-write',
      // Never prompt (verified: tool calls execute rather than being denied).
      // Safe here because the only tools left are this one scoped MCP server's,
      // and the event guard below still kills the run on anything else.
      '--approval-mode',
      'never',
    ],
  }),
  authorizes: (toolName) =>
    toolName === 'mcp_tool' ||
    MUSE_MODEL_STEP.test(toolName) ||
    isMemoryTool(
      toolName.startsWith(MUSE_LIFECYCLE_TOOL_PREFIX)
        ? toolName.slice(MUSE_LIFECYCLE_TOOL_PREFIX.length)
        : toolName
    ),
};

/**
 * Claude's built-in tools stay reachable even when `--allowedTools` names only
 * the MCP ones: that flag governs approval, not availability. Measured on Claude
 * Code 2.1.267, an allow-listed run still called `ToolSearch` before the MCP
 * tool, which the event guard correctly reads as a non-memory tool and kills the
 * review over. Denying the built-ins by name leaves exactly one tool.use on the
 * wire — the MCP call — so this rung needs no guard exception at all.
 */
const CLAUDE_DENIED_TOOLS = [
  'ToolSearch',
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'Agent',
  'NotebookEdit',
  'TodoWrite',
  'Skill',
];

const claudeHandler: ReviewHarnessHandler = {
  request: ({ choice, evidence, directory, memoryServer }) => ({
    harness: 'claude',
    mode: 'conversation',
    model: choice.model,
    reasoningEffort: choice.reasoningEffort,
    cwd: directory,
    prompt: evidence,
    yolo: false,
    detached: true,
    mcpServers: { [MEMORY_MCP_SERVER]: memoryServer },
    extraArgs: [
      // The only rung that can deliver the contract as a real system prompt;
      // codex needs a file and muse has no counterpart at all.
      '--system-prompt',
      MEMORY_REVIEW_INSTRUCTIONS,
      // Load no user, project or local settings — the CLAUDE.md equivalent of
      // codex's --ignore-user-config/--ignore-rules.
      '--setting-sources',
      '',
      '--allowedTools',
      ...[...MEMORY_TOOL_NAMES].map((name) => `${MEMORY_TOOL_PREFIX}${name}`),
      '--disallowedTools',
      ...CLAUDE_DENIED_TOOLS,
    ],
  }),
  authorizes: (toolName) => isMemoryTool(toolName),
};

/**
 * Cursor (grok-4.7-low rung). Print mode executes an MCP call only under
 * `--force` — without it the call is auto-rejected ("User rejected MCP",
 * measured 2026-09-24) — so `yolo` is on and `--mode ask` (read-only: no
 * shell, no edits) is what keeps the reviewer a reviewer. The event guard
 * below still kills the run on any non-memory tool. Like muse, Cursor has no
 * system-prompt flag, so the contract rides ahead of the evidence.
 *
 * `getMcpTools` is Cursor's schema-discovery frame: the model calls it to read
 * a tool's input schema before the real call. It reaches no server capability.
 */
const cursorHandler: ReviewHarnessHandler = {
  request: ({ choice, evidence, directory, memoryServer }) => ({
    harness: 'cursor',
    mode: 'conversation',
    model: choice.model,
    cwd: directory,
    prompt: `${MEMORY_REVIEW_INSTRUCTIONS}\n\n${evidence}`,
    yolo: true,
    detached: true,
    mcpServers: { [MEMORY_MCP_SERVER]: memoryServer },
    extraArgs: ['--mode', 'ask'],
  }),
  authorizes: (toolName) => toolName === 'getMcpTools' || isMemoryTool(toolName),
  discardSession: (sessionId) => discardCursorTranscript(sessionId),
};

const REVIEW_HARNESSES: Record<MemoryReviewModelChoice['harness'], ReviewHarnessHandler> = {
  codex: codexHandler,
  cursor: cursorHandler,
  muse: museHandler,
  claude: claudeHandler,
};

type AttemptOutcome =
  | { kind: 'success'; output: string }
  | { kind: 'out_of_tokens'; message: string };

/** Fresh CLI process, no Buddy MCP/session/goal, no repository or user-config instructions. */
export function createMemoryReviewRunner(
  control: Pick<BuddyControlServer, 'issueMemoryReview'>,
  execute: typeof executeCommand = executeCommand,
  logger: Pick<Console, 'warn'> = console
): MemoryReviewRunner {
  return async ({ prompt, signal, executeTool, beginAttempt }) => {
    signal.throwIfAborted();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-memory-review-'));
    const instructionsPath = path.join(directory, 'instructions.md');
    try {
      fs.writeFileSync(instructionsPath, MEMORY_REVIEW_INSTRUCTIONS, { mode: 0o600 });
      const launch = resolveBuddyMcpLaunch('memory-review-mcp');
      let exhausted = '';
      for (const [index, choice] of MEMORY_REVIEW_MODELS.entries()) {
        signal.throwIfAborted();
        beginAttempt(choice);
        const outcome = await runAttempt(REVIEW_HARNESSES[choice.harness], {
          control,
          execute,
          signal,
          executeTool,
          launch,
          choice,
          evidence: prompt,
          instructionsPath,
          directory,
        });
        if (outcome.kind === 'success') return outcome.output;
        exhausted = outcome.message;
        const next = MEMORY_REVIEW_MODELS[index + 1];
        if (!next) break;
        // Loud on purpose: console.warn is captured by the error journal, so an
        // exhausted primary stays visible even though the review still lands.
        logger.warn(
          `[buddies] ${choice.model} is out of credits for memory review; falling back to ${next.model}: ${exhausted}`
        );
      }
      throw new Error(exhausted);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

async function runAttempt(
  handler: ReviewHarnessHandler,
  input: {
    control: Pick<BuddyControlServer, 'issueMemoryReview'>;
    execute: typeof executeCommand;
    signal: AbortSignal;
    executeTool: (operation: string, input: unknown) => unknown;
    launch: ReturnType<typeof resolveBuddyMcpLaunch>;
    choice: MemoryReviewModelChoice;
    evidence: string;
    instructionsPath: string;
    directory: string;
  }
): Promise<AttemptOutcome> {
  const { control, execute, signal, executeTool, launch, choice } = input;
  // One capability per attempt: a killed process can never reach the next one's.
  const capability = control.issueMemoryReview(executeTool, signal);
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  try {
    const turn = execute(
      handler.request({
        choice,
        evidence: input.evidence,
        instructionsPath: input.instructionsPath,
        directory: input.directory,
        memoryServer: {
          ...launch,
          env: { ...launch.env, ...capability.env },
          required: true,
        },
      })
    );
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
        if (event.type === 'tool.use' && !handler.authorizes(event.name)) {
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
    if (completion.status === 'fulfilled') handler.discardSession?.(completion.value.sessionId);
    signal.throwIfAborted();
    if (events.status === 'rejected') throw events.reason;
    if (completion.status === 'rejected') throw completion.reason;
    if (failure || completion.value.reason !== 'success' || completion.value.exitCode !== 0) {
      const message =
        failure ??
        `Memory reviewer exited: ${completion.value.reason} (${completion.value.exitCode})`;
      // Credit exhaustion is the one failure the ladder can answer; a tool
      // violation or a crash still ends the review on this model.
      if (!failure && completion.value.reason === 'out_of_tokens')
        return { kind: 'out_of_tokens', message };
      throw new Error(message);
    }
    return { kind: 'success', output };
  } finally {
    capability.revoke();
    if (stop) signal.removeEventListener('abort', stop);
    if (killTimer) clearTimeout(killTimer);
  }
}
