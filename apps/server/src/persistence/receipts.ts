import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import { canonicalJson } from '../workflows/document.js';

export interface Actor {
  kind: 'cli' | 'device';
  id: string;
}

export interface CommandResponse {
  status: number;
  body: Json;
  // Set when the response is a stored receipt being replayed rather than a fresh result.
  replayed?: true;
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
    const stored: CommandResponse = {
      status: row.status,
      body: JSON.parse(row.response_json) as Json,
    };
    // Not enumerable: a replayed response still equals the one first returned.
    return Object.defineProperty(stored, 'replayed', { value: true, enumerable: false });
  }

  // The caller's own receipt for a command, for clients that lost a response (specification
  // 13.2). Receipts are scoped to their actor: one device never sees another's.
  get(
    actor: Actor,
    commandId: string,
  ): { commandId: string; status: number; body: Json; createdAt: number } {
    const row = this.db
      .prepare(
        'SELECT status, response_json, created_at FROM command_receipts WHERE actor_kind = ? AND actor_id = ? AND command_id = ?',
      )
      .get(actor.kind, actor.id, commandId) as
      { status: number; response_json: string; created_at: number } | undefined;
    if (!row) throw new ShiftError('COMMAND_NOT_FOUND', 'No receipt for this command.', 404);
    return {
      commandId,
      status: row.status,
      body: JSON.parse(row.response_json) as Json,
      createdAt: row.created_at,
    };
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
