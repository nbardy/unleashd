import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ErrorJournal, type ErrorJournalStatus } from '../server/src/observability';

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  const status: ErrorJournalStatus | 'all' = argumentsList.includes('--all')
    ? 'all'
    : argumentsList.includes('--acknowledged')
      ? 'acknowledged'
      : 'unresolved';
  const limitArgument = argumentsList.find((argument) => argument.startsWith('--limit='));
  const acknowledgement = argumentsList.find((argument) => argument.startsWith('--ack='));
  const noteArgument = argumentsList.find((argument) => argument.startsWith('--note='));
  const parsedLimit = limitArgument
    ? Number.parseInt(limitArgument.slice('--limit='.length), 10)
    : 100;
  const appDataDirectory = path.resolve(
    process.env.UNLEASHD_DATA_DIR ?? path.join(os.homedir(), '.agent-viewer')
  );
  const journal = new ErrorJournal({
    directory: path.join(appDataDirectory, 'observability'),
  });
  if (acknowledgement) {
    const fingerprint = acknowledgement.slice('--ack='.length).trim();
    const note = noteArgument?.slice('--note='.length).trim();
    if (!fingerprint || !note) throw new Error('--ack requires a fingerprint and --note');
    const port = process.env.PORT ?? (process.env.NODE_ENV === 'development' ? '7499' : '7489');
    const baseUrl = process.env.UNLEASHD_API_URL?.trim() || `http://127.0.0.1:${port}`;
    const token = readAuthToken(appDataDirectory);
    const response = await fetch(
      `${baseUrl}/api/diagnostics/errors/${encodeURIComponent(fingerprint)}/acknowledge`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ note }),
      }
    );
    const result = await response.text();
    if (!response.ok)
      throw new Error(`Error acknowledgement failed (${response.status}): ${result}`);
    process.stdout.write(`${result}\n`);
    return;
  }
  await journal.initialize();
  const groups = await journal.queryGroups({
    status,
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100,
  });
  process.stdout.write(`${JSON.stringify({ status, groups }, null, 2)}\n`);
}

function readAuthToken(appDataDirectory: string): string | undefined {
  const inline = process.env.UNLEASHD_AUTH_TOKEN?.trim();
  if (inline) return inline;
  const filePath =
    process.env.UNLEASHD_AUTH_TOKEN_FILE?.trim() || path.join(appDataDirectory, 'auth-token');
  try {
    return fs.readFileSync(filePath, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
