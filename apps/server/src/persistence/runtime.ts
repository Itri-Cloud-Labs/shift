import { fileURLToPath } from 'node:url';
import { ShiftError } from '../domain/errors.js';

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
