import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { randomUUID } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import { inspectOwnedFile } from '../lifecycle/state-directory.js';
import { validateServerIdentity, protocolRange, type ServerIdentity } from '../protocol/index.js';

export const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));
export const minimumSqliteVersion = '3.51.3';

export interface SqliteRuntime {
  version: string;
  sourceId: string;
}

export function verifySqliteRuntime(runtime: SqliteRuntime): void {
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(runtime.version);
  if (!version || !runtime.sourceId || runtime.sourceId.length > 200) {
    throw new ShiftError('SQLITE_INCOMPATIBLE', 'Cannot verify SQLite runtime provenance.');
  }
  const numbers = version.slice(1).map(Number);
  const minimum = minimumSqliteVersion.split('.').map(Number);
  const comparison = numbers.reduce(
    (result, value, index) => result || Math.sign(value - minimum[index]!),
    0,
  );
  if (comparison < 0) {
    throw new ShiftError(
      'SQLITE_INCOMPATIBLE',
      `SQLite ${minimumSqliteVersion} or newer is required for patched WAL support.`,
    );
  }
}

export function applyMigrations(db: Database.Database, directory = migrationsDirectory): void {
  const migrations = readMigrationFiles({ migrationsFolder: directory });
  const journalExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get();
  if (journalExists) {
    const applied = db
      .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
      .all() as { hash: string; created_at: number }[];
    if (
      applied.length > migrations.length ||
      applied.some((entry, index) => {
        const migration = migrations[index];
        return (
          !migration || entry.hash !== migration.hash || entry.created_at !== migration.folderMillis
        );
      })
    ) {
      throw new ShiftError(
        'MIGRATION_HISTORY_MISMATCH',
        'The database migration history differs from this server build. Restore matching migration files or upgrade the server.',
      );
    }
  }
  try {
    migrate(drizzle(db), { migrationsFolder: directory });
  } catch {
    throw new ShiftError('MIGRATION_FAILED', 'Database migration failed. No work was admitted.');
  }
}

function loadMetadata(
  db: Database.Database,
  clock: Clock,
): { identity: ServerIdentity; workerGeneration: string } {
  return db
    .transaction(() => {
      const rows = db.prepare('SELECT key, value_json FROM server_metadata').all() as {
        key: string;
        value_json: string;
      }[];
      const insert = db.prepare('INSERT INTO server_metadata (key, value_json) VALUES (?, ?)');
      if (rows.length === 0) {
        const initial = {
          serverId: randomUUID(),
          eventEpoch: randomUUID(),
          schemaVersion: 1,
          protocolRange,
          createdAtMs: clock.now(),
        };
        for (const [key, value] of Object.entries(initial)) insert.run(key, JSON.stringify(value));
      }
      const metadataRows = db.prepare('SELECT key, value_json FROM server_metadata').all() as {
        key: string;
        value_json: string;
      }[];
      const values: Record<string, unknown> = Object.fromEntries(
        metadataRows.map((row) => [row.key, JSON.parse(row.value_json) as unknown]),
      );
      const identity = { serverId: values['serverId'], eventEpoch: values['eventEpoch'] };
      const storedProtocol = values['protocolRange'];
      if (
        !validateServerIdentity(identity) ||
        values['schemaVersion'] !== 1 ||
        !storedProtocol ||
        typeof storedProtocol !== 'object' ||
        !('min' in storedProtocol) ||
        storedProtocol.min !== 0 ||
        !('max' in storedProtocol) ||
        storedProtocol.max !== 0 ||
        !Number.isSafeInteger(values['createdAtMs']) ||
        (values['createdAtMs'] as number) < 0
      ) {
        throw new ShiftError(
          'METADATA_INVALID',
          'Server metadata is missing, corrupt or incompatible. Refusing to replace server identity.',
        );
      }
      const workerGeneration = randomUUID();
      db.prepare(
        'INSERT INTO server_metadata (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',
      ).run('workerGeneration', JSON.stringify(workerGeneration));
      return { identity, workerGeneration };
    })
    .immediate();
}

export interface Store {
  db: Database.Database;
  identity: ServerIdentity;
  workerGeneration: string;
  runtime: SqliteRuntime;
  check(): void;
  close(): void;
}

export async function openStore(options: {
  stateDirectory: string;
  clock: Clock;
  sqliteNativeBinding?: string;
}): Promise<Store> {
  const path = join(options.stateDirectory, 'shift.db');
  for (const file of [path, `${path}-wal`, `${path}-shm`]) await inspectOwnedFile(file, 'file');
  let db: Database.Database;
  try {
    db = new Database(
      path,
      options.sqliteNativeBinding === undefined
        ? {}
        : { nativeBinding: options.sqliteNativeBinding },
    );
  } catch {
    throw new ShiftError(
      'SQLITE_OPEN_FAILED',
      'Cannot open SQLite. Check the state directory and the Node/Linux native binding compatibility.',
    );
  }
  try {
    await chmod(path, 0o600);
    const runtime = db
      .prepare('SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId')
      .get() as SqliteRuntime;
    verifySqliteRuntime(runtime);
    if (
      (db.prepare('SELECT json_valid(\'{"valid":true}\') AS valid').get() as { valid: number })
        .valid !== 1
    ) {
      throw new ShiftError('SQLITE_INCOMPATIBLE', 'SQLite JSON support is required.');
    }
    db.pragma('journal_mode=WAL');
    db.pragma('synchronous=FULL');
    db.pragma('foreign_keys=ON');
    db.pragma('busy_timeout=5000');
    for (const [pragma, expected] of Object.entries({
      journal_mode: 'wal',
      synchronous: 2,
      foreign_keys: 1,
      busy_timeout: 5000,
    })) {
      if (db.pragma(pragma, { simple: true }) !== expected) {
        throw new ShiftError(
          'SQLITE_PRAGMA_MISMATCH',
          `Required SQLite setting ${pragma} is unavailable.`,
        );
      }
    }
    const integrity = db.pragma('quick_check', { simple: true });
    if (integrity !== 'ok')
      throw new ShiftError('DATABASE_INVALID', 'SQLite integrity check failed.');
    applyMigrations(db);
    const metadata = loadMetadata(db, options.clock);
    let closed = false;
    return {
      db,
      ...metadata,
      runtime,
      check() {
        const stored = db
          .prepare('SELECT value_json FROM server_metadata WHERE key = ?')
          .get('serverId') as { value_json: string } | undefined;
        if (stored?.value_json !== JSON.stringify(metadata.identity.serverId)) {
          throw new ShiftError('METADATA_INVALID', 'Persistent server identity is unavailable.');
        }
      },
      close() {
        if (!closed) {
          db.close();
          closed = true;
        }
      },
    };
  } catch (error) {
    db.close();
    throw error instanceof ShiftError
      ? error
      : new ShiftError(
          'DATABASE_INITIALIZATION_FAILED',
          'Cannot initialize the server database. No work was admitted.',
        );
  }
}
