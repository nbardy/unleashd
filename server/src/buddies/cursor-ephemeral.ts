import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CURSOR_PROJECTS_DIR = path.join(os.homedir(), '.cursor', 'projects');

/**
 * Cursor's print mode has no counterpart to claude `--no-session-persistence`
 * or codex `--ephemeral`: every run writes
 * `~/.cursor/projects/<encoded cwd>/agent-transcripts/<sessionId>/`, and the
 * Cursor disk adapter imports that as a conversation. A background run that
 * must stay invisible (the reply gate, the memory reviewer) therefore deletes
 * its own project dir, found by session id, once the process has exited.
 *
 * Found by session id rather than by re-encoding the cwd: the directory name
 * is a lossy encoding (see resolveEncodedProjectDirectory), a uuid is not.
 */
export function discardCursorTranscript(
  sessionId: string,
  projectsDir: string = CURSOR_PROJECTS_DIR
): void {
  if (!sessionId || !fs.existsSync(projectsDir)) return;
  for (const project of fs.readdirSync(projectsDir)) {
    const projectDir = path.join(projectsDir, project);
    if (!fs.existsSync(path.join(projectDir, 'agent-transcripts', sessionId))) continue;
    // The whole project dir, not just the transcript: callers MUST run cursor in a
    // private mkdtemp cwd, so the dir belongs to this one run. Removing only the
    // transcript leaked one dir per run, plus agent-tools/*.txt raw MCP output
    // (Buddy memory content), and every leaked dir lengthens the adapter scan.
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}
