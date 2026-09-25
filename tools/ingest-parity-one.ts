/**
 * Side-by-side of one source: the TS adapter's messages and the crate store's, for chasing a
 * parity mismatch the harness reported.
 *
 *   pnpm exec tsx tools/ingest-parity-one.ts --db <parity store> --format codex --source <path> [--from 95 --to 102]
 */
import { execFileSync } from 'node:child_process';
import { sessionToConversation } from '../server/src/adapters/disk-adapter';
import { getDiskAdapter } from '../server/src/adapters/registry';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}
const source = arg('source') as string;
const format = arg('format') as Parameters<typeof getDiskAdapter>[0];
const from = Number(arg('from') ?? 0);
const to = Number(arg('to') ?? 1e9);

async function main(): Promise<void> {
  const session = await getDiskAdapter(format).parseFile(source);
  const conversation = session && sessionToConversation(session);
  // A separate process: a second SQLite library in this one breaks the crate's POSIX locks.
  const query = `SELECT m.seq, m.role, m.at, m.content FROM message m JOIN source s ON s.id = m.source_id WHERE s.path = '${source.replaceAll("'", "''")}' ORDER BY m.seq`;
  const out = execFileSync('sqlite3', ['-readonly', '-json', arg('db') as string, query], {
    maxBuffer: 1 << 30,
  }).toString();
  const crate = (out.trim() ? JSON.parse(out) : []) as Array<{
    seq: number;
    role: string;
    at: number | null;
    content: string;
  }>;
  const ts = conversation?.messages ?? [];
  console.log(`ts ${ts.length} messages, crate ${crate.length}`);
  for (let i = from; i < Math.min(to, Math.max(ts.length, crate.length)); i++) {
    const a = ts[i];
    const b = crate[i];
    const show = (
      role: string | undefined,
      at: number | null | undefined,
      text: string | undefined
    ) => `${role?.padEnd(9)} ${String(at).padEnd(15)} ${JSON.stringify((text ?? '').slice(0, 90))}`;
    console.log(
      `${String(i).padStart(4)} TS    ${show(a?.role, a?.timestamp.getTime(), a?.content)}`
    );
    console.log(`     CRATE ${show(b?.role, b?.at, b?.content)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
