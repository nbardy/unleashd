import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExecuteCommandRequest } from '@nbardy/agent-cli';
import { executeCommand } from '@nbardy/agent-cli';
import type { ConversationConfig, ResolvedExecutionConfig } from '@unleashd/shared';
import { discardCursorTranscript } from './cursor-ephemeral';

// The thread follow-up gate: "should you respond, or leave it to another team
// member?" asked of one Buddy about one new thread post. It is a bare CLI run
// on the Buddy's seat model — no Buddy MCP, no tools, no session files,
// a scratch cwd so no repository instructions load — and it may answer only
// `<yes>` or `<no>`. Anything else is `unparseable`, never read as a guess:
// a Buddy that rambles past GATE_MAX_CHARS is stopped and stays silent.

export type GateVerdict =
  | { kind: 'respond' }
  | { kind: 'pass' }
  | { kind: 'unparseable'; output: string }
  | { kind: 'failed'; reason: string };

// `config` is the Buddy's seat config in the thread (channel-responder.ts), so
// a Buddy the owner moved onto another harness is asked there too — not on a
// profile harness that may be down.
export type ReplyGate = (input: {
  config: ConversationConfig;
  prompt: string;
}) => Promise<GateVerdict>;

// `<yes>` / `<no>` plus whitespace. Past this the answer is already invalid, so
// the run is stopped rather than left to spend tokens.
const GATE_MAX_CHARS = 32;
const GATE_TIMEOUT_MS = 90_000;

export function parseGateVerdict(output: string): GateVerdict {
  switch (output.trim()) {
    case '<yes>':
      return { kind: 'respond' };
    case '<no>':
      return { kind: 'pass' };
    case '':
      // A finished run with no text is a harness failure, not a `<no>`. An
      // owner post then gets the same visible notice as any other failed gate.
      return { kind: 'failed', reason: 'no answer' };
    default:
      return { kind: 'unparseable', output };
  }
}

// One request shape per harness a Buddy can run on (provider-capability.ts
// admits only required-MCP harnesses). Each flag set drops tools, user and
// project instructions, and session persistence — a persisted gate transcript
// would be imported by the disk adapters and show up as a conversation.
type GateHarness = 'claude' | 'codex' | 'muse' | 'cursor';

function gateRequest(
  harness: GateHarness,
  execution: ResolvedExecutionConfig,
  prompt: string,
  cwd: string
): ExecuteCommandRequest {
  const base = {
    mode: 'conversation',
    prompt,
    cwd,
    model: execution.modelId,
    reasoningEffort: execution.reasoningEffort,
    yolo: false,
    detached: true,
  } as const;
  switch (harness) {
    case 'claude':
      return {
        ...base,
        harness,
        extraArgs: ['--tools', '', '--setting-sources', '', '--no-session-persistence'],
      };
    case 'codex':
      return {
        ...base,
        harness,
        extraArgs: ['--ephemeral', '--ignore-user-config', '--ignore-rules', '-s', 'read-only'],
      };
    case 'muse':
      return {
        ...base,
        harness,
        extraArgs: [
          '--no-session-log',
          '--no-foreign-personal-context',
          '--disable-shell',
          '--disable-write',
          '--disable-web-tools',
        ],
      };
    // Cursor has no flag to drop tools or persistence. `--mode ask` makes it
    // read-only and, without `--force`, nothing needing approval executes; any
    // tool.use still ends the gate as unparseable. Its transcript is deleted
    // after exit (discardGateSession), and effort lives in the model id.
    case 'cursor':
      return {
        mode: 'conversation',
        prompt,
        cwd,
        model: execution.modelId,
        yolo: false,
        detached: true,
        harness,
        extraArgs: ['--mode', 'ask'],
      };
  }
}

/** Only cursor persists a run it cannot be told to skip; see cursor-ephemeral.ts. */
function discardGateSession(harness: GateHarness, sessionId: string): void {
  switch (harness) {
    case 'cursor':
      return discardCursorTranscript(sessionId);
    case 'claude':
    case 'codex':
    case 'muse':
      return;
  }
}

function gateHarness(provider: ResolvedExecutionConfig['provider']): GateHarness | null {
  switch (provider) {
    case 'claude':
    case 'codex':
    case 'muse':
    case 'cursor':
      return provider;
    case 'opencode':
    case 'gemini':
      return null;
  }
}

async function runGate(
  execute: typeof executeCommand,
  harness: GateHarness,
  request: ExecuteCommandRequest
): Promise<GateVerdict> {
  const turn = execute(request);
  let output = '';
  let providerError = '';
  let violation: GateVerdict | null = null;
  const stop = (verdict: GateVerdict) => {
    violation ??= verdict;
    turn.stop();
  };
  const timer = setTimeout(
    () => stop({ kind: 'failed', reason: `no answer within ${GATE_TIMEOUT_MS / 1000}s` }),
    GATE_TIMEOUT_MS
  );
  const killTimer = setTimeout(() => turn.stop('SIGKILL'), GATE_TIMEOUT_MS + 5_000);
  try {
    const consumed = (async () => {
      for await (const event of turn.events) {
        if (event.type === 'text.delta') {
          output += event.text;
          if (output.length > GATE_MAX_CHARS) stop({ kind: 'unparseable', output });
        } else if (event.type === 'error' || event.type === 'out_of_tokens') {
          providerError = event.message;
        } else if (event.type === 'tool.use') {
          stop({ kind: 'unparseable', output: `(called tool ${event.name})` });
        }
      }
    })();
    const [completion, events] = await Promise.allSettled([turn.completed, consumed]);
    if (completion.status === 'fulfilled') discardGateSession(harness, completion.value.sessionId);
    if (violation) return violation;
    if (events.status === 'rejected') throw events.reason;
    if (completion.status === 'rejected') throw completion.reason;
    if (completion.value.reason !== 'success')
      return {
        kind: 'failed',
        reason: `gate run ended: ${completion.value.reason}${providerError ? ` (${providerError})` : ''}`,
      };
    return parseGateVerdict(output);
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
  }
}

export function createCliReplyGate(ports: {
  resolveExecution(config: ConversationConfig): Promise<ResolvedExecutionConfig>;
  execute?: typeof executeCommand;
}): ReplyGate {
  const execute = ports.execute ?? executeCommand;
  return async ({ config, prompt }) => {
    const execution = await ports.resolveExecution(config);
    const harness = gateHarness(execution.provider);
    if (!harness)
      return { kind: 'failed', reason: `no reply gate for provider ${execution.provider}` };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-reply-gate-'));
    try {
      return await runGate(execute, harness, gateRequest(harness, execution, prompt, directory));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}
