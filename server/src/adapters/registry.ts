import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { codexTurnInterruptionNotices, extractCodexTurnLifecycle } from './codex-turn-lifecycle';
import type { DiskAdapter, ParsedSession } from './disk-adapter';
import { sessionLookupKeys } from './disk-adapter';
import {
  CLAUDE_PROJECTS_DIR,
  CODEX_SESSIONS_DIR,
  CURSOR_PROJECTS_DIR,
  GEMINI_SESSIONS_DIR,
  OPENCODE_MESSAGE_DIR,
  OPENCODE_PART_DIR,
  extractCodexSessionIdFromFilename,
  extractMessagesFromCodexEntries,
  extractMessagesFromEntries,
  extractSubAgentsFromEntries,
  getCodexSessionDirectories,
  getCursorSessionFiles,
  getGeminiSessionFiles,
  getOpenCodeSessionDirectories,
  getOpenCodeSessionMetadataIndex,
  getOpenCodeSessionMtime,
  getProjectDirectories,
  inferProviderFromModel,
  parseCodexJsonlFile,
  parseCursorTranscriptFile,
  parseGeminiSessionFile,
  parseJsonlFile,
  parseOpenCodeSessionDirectory,
  scanSessionDirectory,
} from './jsonl';
import { museAdapter } from './muse-adapter';

// Oompa's gemini harness uses GEMINI_CLI_HOME=~/.gemini-sandbox/acc{N} to isolate
// multiple gemini workers. Their sessions live under {home}/tmp/ instead of ~/.gemini/tmp/.
const GEMINI_SANDBOX_DIR = path.join(os.homedir(), '.gemini-sandbox');

async function discoverGeminiSandboxDirs(): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(GEMINI_SANDBOX_DIR, { withFileTypes: true });
    return (
      entries
        .filter((e) => e.isDirectory())
        // Gemini CLI stores sessions under $GEMINI_CLI_HOME/.gemini/tmp/, not $GEMINI_CLI_HOME/tmp/
        .map((e) => path.join(GEMINI_SANDBOX_DIR, e.name, '.gemini', 'tmp'))
    );
  } catch {
    return [];
  }
}

// =============================================================================
// Claude adapter
//
// Reads ~/.claude/projects/{encoded-path}/*.jsonl
// Provider is inferred from the model name (most sessions are 'claude', but
// some may be 'codex' or 'gemini' depending on model).
// =============================================================================

const claudeAdapter: DiskAdapter = {
  provider: 'claude',
  sessionFileKeys: (filePath) => [path.basename(filePath, '.jsonl')],

  async discoverFiles(): Promise<string[]> {
    const projectDirs = await getProjectDirectories(CLAUDE_PROJECTS_DIR);
    const fileLists = await Promise.all(projectDirs.map((dir) => scanSessionDirectory(dir)));
    return fileLists.flat();
  },

  async parseFile(filePath: string): Promise<ParsedSession | null> {
    const session = await parseJsonlFile(filePath);
    if (session.entries.length === 0) return null;

    const messages = extractMessagesFromEntries(session.entries);
    const provider = inferProviderFromModel(session.model);
    const subAgents = extractSubAgentsFromEntries(session.entries, provider);

    return {
      sessionId: session.sessionId,
      filePath: session.filePath,
      workingDirectory: session.workingDirectory,
      provider,
      model: session.model,
      createdAt: session.createdAt,
      modifiedAt: session.modifiedAt,
      messages,
      subAgents,
      parentSessionId: null,
      title: session.title ?? null,
    };
  },
};

// =============================================================================
// Codex adapter
//
// Reads ~/.codex/sessions/YYYY/MM/DD/*.jsonl
// Provider is always 'codex'. Extracts parentSessionId for thread nesting.
// =============================================================================

const codexAdapter: DiskAdapter = {
  provider: 'codex',
  sessionFileKeys: (filePath) => {
    const sessionId = extractCodexSessionIdFromFilename(filePath);
    return sessionId ? [sessionId] : [];
  },

  async discoverFiles(): Promise<string[]> {
    const dayDirs = await getCodexSessionDirectories(CODEX_SESSIONS_DIR);
    const fileLists = await Promise.all(dayDirs.map((dir) => scanSessionDirectory(dir)));
    return fileLists.flat();
  },

  async parseFile(filePath: string): Promise<ParsedSession | null> {
    const session = await parseCodexJsonlFile(filePath);
    if (session.entries.length === 0) return null;

    const messages = extractMessagesFromCodexEntries(session.entries);
    const lifecycle = extractCodexTurnLifecycle(session.entries);
    for (const notice of codexTurnInterruptionNotices(lifecycle)) {
      messages.push({
        role: 'system',
        content: notice.content,
        timestamp: notice.timestamp,
      });
    }
    messages.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

    return {
      sessionId: session.sessionId,
      filePath: session.filePath,
      workingDirectory: session.workingDirectory,
      provider: 'codex',
      model: session.model,
      createdAt: session.createdAt,
      modifiedAt: session.modifiedAt,
      messages,
      subAgents: [],
      parentSessionId: session.parentSessionId,
    };
  },
};

// =============================================================================
// OpenCode adapter
//
// Reads ~/.local/share/opencode/storage/message/{session-id}/ directories.
// Each "file" is actually a session directory containing message JSON files.
// The session metadata index (session ID → metadata path) is built lazily on
// first discoverFiles() call and reused across all subsequent parseFile() calls
// within that discovery cycle.
//
// NOTE: The adapter object holds a mutable `_sessionIndex` field so that the
// index is computed once per discovery cycle, not once per parseFile() call.
// This is safe because loader.ts calls discoverFiles() before any parseFile().
// =============================================================================

const opencodeAdapter: DiskAdapter & { _sessionIndex: Map<string, string> | null } = {
  provider: 'opencode',
  sessionFileKeys: (filePath) => [path.basename(filePath)],
  _sessionIndex: null,

  async discoverFiles(): Promise<string[]> {
    // Rebuild the session metadata index on each discovery pass so that new
    // sessions added between polls are picked up.
    this._sessionIndex = await getOpenCodeSessionMetadataIndex();
    const sessionDirs = await getOpenCodeSessionDirectories(OPENCODE_MESSAGE_DIR);
    return sessionDirs;
  },

  async parseFile(dirPath: string): Promise<ParsedSession | null> {
    // Use the index built during discoverFiles(); fall back to empty map if
    // parseFile() is somehow called without a prior discoverFiles().
    const sessionIndex = this._sessionIndex ?? new Map<string, string>();
    const session = await parseOpenCodeSessionDirectory(dirPath, OPENCODE_PART_DIR, sessionIndex);
    if (session.messages.length === 0) return null;

    return {
      sessionId: session.sessionId,
      filePath: session.filePath,
      workingDirectory: session.workingDirectory,
      provider: 'opencode',
      model: session.model,
      createdAt: session.createdAt,
      modifiedAt: session.modifiedAt,
      messages: session.messages,
      subAgents: [],
      parentSessionId: null,
    };
  },
};

// =============================================================================
// Gemini adapter
//
// Reads ~/.gemini/tmp/{project}/chats/session-*.json files.
// Provider is always 'gemini'.
// =============================================================================

const geminiAdapter: DiskAdapter = {
  provider: 'gemini',
  sessionFileKeys(filePath) {
    const stem = path.basename(filePath, '.json');
    // Gemini also uses session-{timestamp}-{first eight id characters}, so every
    // suffix after a '-' is a key (sessionLookupKeys also asks for the first
    // eight). A prefix collision only selects a candidate; its JSON sessionId
    // still wins.
    const keys = [stem];
    for (let index = stem.indexOf('-'); index !== -1; index = stem.indexOf('-', index + 1)) {
      keys.push(stem.slice(index + 1));
    }
    return keys;
  },

  async discoverFiles(): Promise<string[]> {
    const mainFiles = await getGeminiSessionFiles(GEMINI_SESSIONS_DIR);
    const sandboxDirs = await discoverGeminiSandboxDirs();
    const sandboxFiles = await Promise.all(sandboxDirs.map((d) => getGeminiSessionFiles(d)));
    return [...mainFiles, ...sandboxFiles.flat()];
  },

  async parseFile(filePath: string): Promise<ParsedSession | null> {
    const session = await parseGeminiSessionFile(filePath);
    if (session.messages.length === 0) return null;

    return {
      sessionId: session.sessionId,
      filePath: session.filePath,
      workingDirectory: session.workingDirectory,
      provider: 'gemini',
      model: session.model,
      createdAt: session.createdAt,
      modifiedAt: session.modifiedAt,
      messages: [...session.messages],
      subAgents: [...session.subAgents],
      parentSessionId: null,
    };
  },
};

// =============================================================================
// Cursor adapter
//
// Hydrates readable IDE agent-transcripts from:
//   ~/.cursor/projects/{encoded-project}/agent-transcripts/{sessionId}/*.jsonl
//
// The companion Composer storage at ~/.cursor/chats - store.db is a
// content-addressed Merkle blob store (blobs + meta tables) -- opaque and not
// a stable JSON rehydration source, intentionally excluded.
// The headless `cursor-agent` CLI is cloud-backed (api2.cursor.sh) --
// `cursor-agent --resume <chatId>` hits the Cursor cloud -- so CLI sessions
// spawned by unleashd remain ephemeral (in-memory only) and are not on-disk.
// This adapter covers only the local, readable IDE agent-transcripts JSONL.
// =============================================================================

const cursorAdapter: DiskAdapter = {
  provider: 'cursor',
  sessionFileKeys: (filePath) => [path.basename(filePath, '.jsonl')],

  async discoverFiles(): Promise<string[]> {
    return getCursorSessionFiles(CURSOR_PROJECTS_DIR);
  },

  async parseFile(filePath: string): Promise<ParsedSession | null> {
    const session = await parseCursorTranscriptFile(filePath);
    if (session.messages.length === 0) return null;

    return {
      sessionId: session.sessionId,
      filePath: session.filePath,
      workingDirectory: session.workingDirectory,
      provider: 'cursor',
      model: session.model,
      createdAt: session.createdAt,
      modifiedAt: session.modifiedAt,
      messages: session.messages,
      subAgents: [],
      parentSessionId: null,
    };
  },
};

// =============================================================================
// Registry — ordered list of all adapters
//
// To add a new provider (e.g. Grok): implement DiskAdapter, append here.
// The load/poll loop in loader.ts iterates this list with no other changes.
// Cursor's adapter hydrates local IDE agent-transcripts only; see the
// Cursor adapter comment above for why chats/store.db and cloud CLI sessions
// are excluded.
// =============================================================================

export const diskAdapters: DiskAdapter[] = [
  claudeAdapter,
  codexAdapter,
  opencodeAdapter,
  geminiAdapter,
  cursorAdapter,
  museAdapter,
];

export function getDiskAdapter(provider: DiskAdapter['provider']): DiskAdapter {
  const adapter = diskAdapters.find((candidate) => candidate.provider === provider);
  if (!adapter) throw new Error(`No disk adapter registered for provider '${provider}'`);
  return adapter;
}

// =============================================================================
// Re-export per-adapter helpers needed by loader.ts for polling
// (mtime computation for OpenCode sessions, session ID extraction for Codex)
// =============================================================================

export { getOpenCodeSessionMtime, OPENCODE_PART_DIR, getOpenCodeSessionMetadataIndex };

// Export adapter type for tests / extension points
export type { DiskAdapter };

/** Resolve only a parsed native identity, never a guessed filename or another session. */
export async function resolveSessionTranscript(
  provider: DiskAdapter['provider'],
  sessionId: string,
  adapter: DiskAdapter = getDiskAdapter(provider)
): Promise<string | null> {
  if (adapter.provider !== provider) return null;
  try {
    const lookupKeys = sessionLookupKeys(sessionId);
    for (const file of await adapter.discoverFiles()) {
      if (!adapter.sessionFileKeys(file).some((key) => lookupKeys.includes(key))) continue;
      try {
        const parsed = await adapter.parseFile(file);
        if (parsed?.provider === provider && parsed.sessionId === sessionId) return parsed.filePath;
      } catch {
        /* A disappearing or unreadable candidate is unavailable evidence. */
      }
    }
  } catch {
    /* Unsupported or inaccessible native storage has no readable reference. */
  }
  return null;
}
