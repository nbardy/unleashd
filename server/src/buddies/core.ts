import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Actor, BuddiesCore, type Setting } from '@unleashd/buddies-core';

export type { BuddiesCore } from '@unleashd/buddies-core';

export const OWNER: Actor = { kind: 'owner' };
export const buddyActor = (id: string): Actor => ({ kind: 'buddy', id });

/**
 * κ for a profile field on the wire: absent = unchanged, `null` = back to the default, a string =
 * that value. The crate's `Setting` names the clear, which `Option<String>` could not (T22).
 */
export const settingOf = (value: string | null | undefined): Setting | undefined =>
  value === undefined ? undefined : value === null ? { kind: 'default' } : { kind: 'set', value };

/** The crate's error codes; a rejection's message is `[code] detail` (crate README). */
export type CoreErrorCode =
  | 'denied'
  | 'not_found'
  | 'revision_conflict'
  | 'idempotency_conflict'
  | 'invalid'
  | 'lease_lost'
  | 'conversation_busy'
  | 'corrupt'
  | 'wrong_database'
  | 'sqlite'
  | 'json'
  | 'io';

export class CoreError extends Error {
  constructor(
    readonly code: CoreErrorCode,
    readonly detail: string
  ) {
    super(`[${code}] ${detail}`);
    this.name = 'CoreError';
  }
}

/** Parse a crate rejection once, at the boundary. Anything else is not a core error. */
export function coreError(error: unknown): CoreError | null {
  if (error instanceof CoreError) return error;
  const match = error instanceof Error ? /^\[([a-z_]+)\] ([\s\S]*)$/.exec(error.message) : null;
  return match ? new CoreError(match[1] as CoreErrorCode, match[2]) : null;
}

/** HTTP status for a core error: the owner's request was wrong, or the data moved under it. */
export function httpStatus(error: CoreError): number {
  switch (error.code) {
    case 'denied':
      return 403;
    case 'not_found':
      return 404;
    case 'revision_conflict':
    case 'idempotency_conflict':
    case 'conversation_busy':
    case 'lease_lost':
      return 409;
    case 'invalid':
      return 400;
    case 'corrupt':
    case 'wrong_database':
    case 'sqlite':
    case 'json':
    case 'io':
      return 500;
  }
}

/**
 * The new-schema database. It is never the v33 `~/.buddies/buddies.sqlite`: the swap is the
 * owner-gated import (crates/unleashd-buddies/README.md, "Deploy").
 */
export function buddiesDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.UNLEASHD_BUDDIES_DB ?? path.join(os.homedir(), '.buddies', 'buddies-v3.sqlite');
}

/**
 * Where the Buddies database stands on this machine, decided once at boot. Mirrors
 * `recordsLocation` (conversations/config-records.ts): `fresh` is a first-time install with no
 * v33 file either, and gets an empty database. Until 2026-09-26 a missing file was always
 * "import first", so a new user, with nothing to import, never had working Buddies.
 */
export type BuddiesLocation =
  | { t: 'database'; file: string }
  | { t: 'fresh'; file: string }
  | { t: 'unimported'; file: string; legacy: string };

/**
 * The v33 file the old Buddies package used: `$BUDDIES_HOME/buddies.sqlite`, default
 * `~/.buddies` (the package's store.js). Ignoring BUDDIES_HOME classified an owner who had set it
 * as a `fresh` install and opened an EMPTY database next to their unimported data.
 */
export function legacyBuddiesDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.BUDDIES_HOME?.trim() || path.join(os.homedir(), '.buddies');
  return path.join(home, 'buddies.sqlite');
}

export function buddiesLocation(
  file: string,
  legacy: string = legacyBuddiesDatabasePath()
): BuddiesLocation {
  if (fs.existsSync(file)) return { t: 'database', file };
  if (fs.existsSync(legacy)) return { t: 'unimported', file, legacy };
  return { t: 'fresh', file };
}

/**
 * Pattern: fix-guards (docs/patterns.md#fix-guards) — no silent fallback.
 * `BuddiesCore.open` creates an EMPTY database at a missing path, so a machine that still holds
 * the v33 file would run with no buddies instead of the owner's; that case fails loudly with
 * the import command (and never falls back to opening the old file). Guard: the
 * "missing Buddies database" tests in server/test/buddies-v2.test.ts.
 */
export async function openBuddiesCore(location: BuddiesLocation): Promise<BuddiesCore> {
  switch (location.t) {
    case 'database':
      return BuddiesCore.open(location.file);
    case 'fresh':
      fs.mkdirSync(path.dirname(location.file), { recursive: true });
      return BuddiesCore.open(location.file);
    case 'unimported': {
      const { file, legacy } = location;
      throw new Error(
        `Buddies database ${file} does not exist, but ${legacy} does. Import it first:\n  buddies-import import --from ${legacy} --to ${file} --report ${file}.import.json\n  buddies-import verify --from ${legacy} --to ${file} --import-report ${file}.import.json --out ${file}.verify.json\n(or set UNLEASHD_BUDDIES_DB). See crates/unleashd-buddies/README.md "Deploy".`
      );
    }
  }
}

/**
 * The core behind a promise, so routes and modules can be built while it opens. Every method is
 * async already; a failed open rejects every call with the open error (the import command).
 */
export function lateBoundCore(ready: Promise<BuddiesCore>): BuddiesCore {
  return new Proxy({} as BuddiesCore, {
    // Not a thenable: `await lateBoundCore(...)` must not treat the proxy as a promise.
    get: (_target, name) =>
      name === 'then'
        ? undefined
        : (...args: unknown[]) =>
            ready.then((core) =>
              (core[name as keyof BuddiesCore] as (...a: unknown[]) => unknown).apply(core, args)
            ),
  });
}

export async function archivedBuddyIds(core: BuddiesCore): Promise<Set<string>> {
  const workspaces = await core.listWorkspaces();
  const buddies = (await Promise.all(workspaces.map((w) => core.listBuddies(w.id)))).flat();
  return new Set(buddies.filter((buddy) => buddy.status === 'archived').map((buddy) => buddy.id));
}
