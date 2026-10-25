import type Database from 'better-sqlite3';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';

// The durable event log (specification 13.3). SQLite's sequence is authoritative; a cursor is
// `<epoch>:<sequence>`, and the epoch changes when the database is replaced, for example by a
// restore, so a client never applies a cursor from another history.

export interface EventView {
  cursor: string;
  epoch: string;
  sequence: number;
  type: string;
  schemaVersion: number;
  runId: string | null;
  executionId: string | null;
  sessionId: string | null;
  payload: Json;
  createdAt: number;
}

interface EventRow {
  sequence: number;
  type: string;
  schema_version: number;
  run_id: string | null;
  execution_id: string | null;
  session_id: string | null;
  payload_json: string;
  created_at: number;
}

export const resync = (message: string) => new ShiftError('RESYNC_REQUIRED', message, 409);

export class EventLog {
  constructor(
    private readonly db: Database.Database,
    readonly epoch: string,
  ) {}

  cursor(sequence: number): string {
    return `${this.epoch}:${sequence}`;
  }

  // The sequence a cursor points after. Anything that is not a cursor of this history, including
  // one beyond its newest event, means the client must take a new snapshot.
  parse(cursor: unknown): number {
    if (typeof cursor !== 'string' || cursor === '') {
      throw resync('A cursor from a snapshot or an event is required.');
    }
    const match = /^([0-9a-f-]{36}):(0|[1-9]\d{0,15})$/.exec(cursor);
    if (!match) throw resync('The cursor is not valid.');
    if (match[1] !== this.epoch) {
      throw resync('The cursor belongs to another event history; take a new snapshot.');
    }
    const sequence = Number(match[2]);
    if (sequence > this.highWater()) {
      throw resync('The cursor is ahead of this server; take a new snapshot.');
    }
    return sequence;
  }

  highWater(): number {
    return (
      this.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events').get() as {
        sequence: number;
      }
    ).sequence;
  }

  // Events after `after`, oldest first.
  after(after: number, limit: number): EventView[] {
    return (
      this.db
        .prepare('SELECT * FROM events WHERE sequence > ? ORDER BY sequence LIMIT ?')
        .all(after, limit) as EventRow[]
    ).map((row) => this.#view(row));
  }

  page(
    after: number,
    limit: number,
  ): { events: EventView[]; next: string | null; highWater: string } {
    return this.db.transaction(() => {
      const events = this.after(after, limit + 1);
      const more = events.length > limit;
      const page = events.slice(0, limit);
      return {
        events: page,
        next: more ? page.at(-1)!.cursor : null,
        highWater: this.cursor(this.highWater()),
      };
    })();
  }

  // State and the high-water mark read in one transaction: replaying events after the returned
  // cursor covers every change the snapshot does not show, with no gap.
  snapshot<T>(read: () => T): T & { cursor: string } {
    return this.db.transaction(() => ({ ...read(), cursor: this.cursor(this.highWater()) }))();
  }

  #view(row: EventRow): EventView {
    return {
      cursor: this.cursor(row.sequence),
      epoch: this.epoch,
      sequence: row.sequence,
      type: row.type,
      schemaVersion: row.schema_version,
      runId: row.run_id,
      executionId: row.execution_id,
      sessionId: row.session_id,
      payload: JSON.parse(row.payload_json) as Json,
      createdAt: row.created_at,
    };
  }
}
