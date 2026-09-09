import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MessageSchema, type Provider, ProviderSchema, SubAgentSchema } from '@unleashd/shared';
import { z } from 'zod';
import type { ParsedSession } from './disk-adapter';

// Reparse tool results so historical Builder mutations appear inline.
const CACHE_VERSION = 3;

const CachedParsedSessionSchema = z.object({
  sessionId: z.string(),
  filePath: z.string(),
  workingDirectory: z.string(),
  provider: ProviderSchema,
  model: z.string(),
  createdAt: z.coerce.date(),
  modifiedAt: z.coerce.date(),
  messages: z.array(MessageSchema),
  subAgents: z.array(SubAgentSchema).optional(),
  parentSessionId: z.string().nullish(),
});

const SessionCacheRecordSchema = z.object({
  version: z.literal(CACHE_VERSION),
  source: z.object({
    provider: ProviderSchema,
    filePath: z.string(),
    mtimeMs: z.number(),
    sizeBytes: z.number().nonnegative(),
  }),
  session: CachedParsedSessionSchema.nullable(),
});

export interface SessionCacheKey {
  provider: Provider;
  filePath: string;
  mtimeMs: number;
  sizeBytes: number;
}

export type SessionCacheLookup = { hit: false } | { hit: true; session: ParsedSession | null };

/**
 * Durable cache of provider-normalized sessions.
 *
 * Raw CLI JSON/JSONL remains authoritative. A record is reusable only while
 * provider, path, mtime, and source size all match. Keeping one record per
 * source avoids rewriting one giant cache file and lets concurrent parser
 * workers populate misses independently.
 */
export class NormalizedSessionCache {
  constructor(private readonly directory: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.chmod(this.directory, 0o700);
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => fs.chmod(path.join(this.directory, entry.name), 0o600))
    );
  }

  async read(key: SessionCacheKey): Promise<SessionCacheLookup> {
    try {
      const raw = await fs.readFile(this.recordPath(key), 'utf8');
      const parsed = SessionCacheRecordSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || !sameSource(parsed.data.source, key)) return { hit: false };
      return { hit: true, session: parsed.data.session };
    } catch (error) {
      if (isMissingFile(error)) return { hit: false };
      return { hit: false };
    }
  }

  async write(key: SessionCacheKey, session: ParsedSession | null): Promise<void> {
    const recordPath = this.recordPath(key);
    const temporaryPath = `${recordPath}.${process.pid}.${randomUUID()}.tmp`;
    const payload = JSON.stringify({
      version: CACHE_VERSION,
      source: key,
      session,
    });

    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, recordPath);
  }

  private recordPath(key: Pick<SessionCacheKey, 'provider' | 'filePath'>): string {
    const digest = createHash('sha256')
      .update(key.provider)
      .update('\0')
      .update(key.filePath)
      .digest('hex');
    return path.join(this.directory, `${digest}.json`);
  }
}

function sameSource(
  cached: {
    provider: Provider;
    filePath: string;
    mtimeMs: number;
    sizeBytes: number;
  },
  current: SessionCacheKey
): boolean {
  return (
    cached.provider === current.provider &&
    cached.filePath === current.filePath &&
    cached.mtimeMs === current.mtimeMs &&
    cached.sizeBytes === current.sizeBytes
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
