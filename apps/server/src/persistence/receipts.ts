import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import { canonicalJson } from '../workflows/document.js';

export interface Actor {
  kind: 'cli';
  id: string;
}

export interface CommandResponse {
  status: number;
  body: Json;
}

const requestHash = (request: unknown) =>
  createHash('sha256').update(canonicalJson(request)).digest('hex');

// Durable command receipts (specification 11.1 and 13.2). The mutation and its receipt commit
// together, so a command repeated after a lost response returns the stored response instead of
// acting twice. Reusing a command ID for a different request is a conflict. Failed commands store
// nothing and can be retried.
export class CommandReceipts {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
  ) {}

  lookup(actor: Actor, commandId: string, request: unknown): CommandResponse | null {
    const row = this.db
      .prepare(
        'SELECT request_hash, status, response_json FROM command_receipts WHERE actor_kind = ? AND actor_id = ? AND command_id = ?',
      )
      .get(actor.kind, actor.id, commandId) as
      { request_hash: string; status: number; response_json: string } | undefined;
    if (!row) return null;
    if (row.request_hash !== requestHash(request)) {
      throw new ShiftError(
        'COMMAND_CONFLICT',
        'This command ID was already used for a different request.',
        409,
      );
    }
    return { status: row.status, body: JSON.parse(row.response_json) as Json };
  }

  // `command` runs synchronously inside the receipt's transaction.
  execute(
    actor: Actor,
    commandId: string | undefined,
    request: unknown,
    command: () => CommandResponse,
  ): CommandResponse {
    if (commandId === undefined) return this.db.transaction(command).immediate();
    return this.db
      .transaction(() => {
        const stored = this.lookup(actor, commandId, request);
        if (stored) return stored;
        const response = command();
        this.db
          .prepare(
            'INSERT INTO command_receipts (actor_kind, actor_id, command_id, request_hash, status, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            actor.kind,
            actor.id,
            commandId,
            requestHash(request),
            response.status,
            JSON.stringify(response.body),
            this.clock.now(),
          );
        return response;
      })
      .immediate();
  }
}
