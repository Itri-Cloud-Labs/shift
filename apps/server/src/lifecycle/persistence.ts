import { ShiftError } from '../domain/errors.js';

// SQLite result codes and file system errors that mean storage itself failed, as opposed to a
// constraint or a stale claim: the disk is full or read-only, or the database cannot be read.
const sqliteCodes = /^SQLITE_(FULL|IOERR|CORRUPT|NOTADB|READONLY|CANTOPEN|PROTOCOL)(_|$)/;
const fileCodes = new Set(['ENOSPC', 'EDQUOT', 'EROFS', 'EIO']);

export function isPersistenceFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return false;
  return sqliteCodes.test(code) || fileCodes.has(code) || code === 'PERSISTENCE_UNAVAILABLE';
}

export function persistenceUnavailable(): ShiftError {
  return new ShiftError(
    'PERSISTENCE_UNAVAILABLE',
    'Storage is unavailable, so the server accepts no changes. Free space or fix the disk, then restart the service.',
    503,
    true,
  );
}

// Once storage fails, the server stays failed until it restarts (specification 11.3): readiness
// fails, no change is acknowledged, and no new external effect is submitted. Recovering in place
// could act on a database whose last writes did not land; a restart rechecks it from scratch.
export class PersistenceGuard {
  #failed = false;
  readonly #listeners: Array<() => void> = [];

  get failed(): boolean {
    return this.#failed;
  }

  onFailure(listener: () => void): void {
    this.#listeners.push(listener);
  }

  fail(): void {
    if (this.#failed) return;
    this.#failed = true;
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // One listener's failure must not keep the others from stopping work.
      }
    }
  }

  // Returns whether the error was a storage failure, failing the server if it was.
  report(error: unknown): boolean {
    if (!isPersistenceFailure(error)) return false;
    this.fail();
    return true;
  }

  // Called right before an external effect is submitted.
  ensure(): void {
    if (this.#failed) throw persistenceUnavailable();
  }
}
