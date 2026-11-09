import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { Clock } from '../domain/clock.js';
import type { Json } from '../harness/types.js';
import { StaleClaim, type Claim } from '../runs/repository.js';

// Durable intent for external actions (server specification sections 4.4, 8 and 11.1).
//
// An operation is recorded as INTENDED, with its arguments fixed by hash, before anything happens.
// It becomes SUBMITTED, in a fenced transaction that also checks the run may still act, right
// before the external call: a process spawned, a request sent. Its known outcome is SUCCEEDED or
// FAILED. Recovery therefore knows that an INTENDED operation never reached the outside world,
// while a SUBMITTED one may have, and only evidence can settle what it did. UNKNOWN waits for the
// owner; ABANDONED is an operation the owner, or a declared safe retry, set aside for a new one.

export type OperationState =
  'INTENDED' | 'SUBMITTED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'ABANDONED';

export interface Operation {
  id: string;
  key: string;
  runId: string;
  executionId: string;
  attemptId: string;
  action: string;
  args: Json;
  argsHash: string;
  state: OperationState;
  evidence: Record<string, Json>;
  result: Json | null;
  error: Json | null;
  resolution: Json | null;
  fence: number;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  operation_key: string;
  run_id: string;
  execution_id: string;
  attempt_id: string;
  action: string;
  args_json: string;
  args_hash: string;
  state: OperationState;
  evidence_json: string;
  result_json: string | null;
  error_json: string | null;
  resolution_json: string | null;
  fence: number;
  created_at: number;
  updated_at: number;
}

const stored = (value: Json | null): string | null =>
  value === null ? null : JSON.stringify(value);
const parse = (text: string | null): Json | null => (text === null ? null : JSON.parse(text));

const view = (row: Row): Operation => ({
  id: row.id,
  key: row.operation_key,
  runId: row.run_id,
  executionId: row.execution_id,
  attemptId: row.attempt_id,
  action: row.action,
  args: JSON.parse(row.args_json) as Json,
  argsHash: row.args_hash,
  state: row.state,
  evidence: JSON.parse(row.evidence_json) as Record<string, Json>,
  result: parse(row.result_json),
  error: parse(row.error_json),
  resolution: parse(row.resolution_json),
  fence: row.fence,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// JSON with sorted keys, so equal arguments always hash the same.
export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, Json>)[key]!)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export const argumentHash = (args: Json): string =>
  createHash('sha256').update(canonical(args)).digest('hex');

// The arguments recorded for an operation differ from the ones it is now asked to perform.
export class EffectConflict extends Error {
  constructor(readonly operation: Operation) {
    super('The operation was recorded with different arguments.');
  }
}

// The run stopped accepting new effects, for example because it is being cancelled.
export class RunNotActive extends Error {}

export class EffectStore {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
  ) {}

  #fenced(claim: Claim): void {
    const row = this.db
      .prepare("SELECT fence FROM node_attempts WHERE id = ? AND state = 'RUNNING'")
      .get(claim.attemptId) as { fence: number } | undefined;
    if (row?.fence !== claim.fence) throw new StaleClaim();
  }

  #event(claim: Claim, type: string, payload: Json): void {
    this.db
      .prepare(
        'INSERT INTO events (type, schema_version, run_id, execution_id, payload_json, created_at) VALUES (?, 1, ?, ?, ?, ?)',
      )
      .run(type, claim.runId, claim.executionId, JSON.stringify(payload), this.clock.now());
  }

  get(id: string): Operation {
    return view(this.db.prepare('SELECT * FROM effect_operations WHERE id = ?').get(id) as Row);
  }

  forExecution(executionId: string): Operation[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM effect_operations WHERE execution_id = ? ORDER BY created_at, rowid',
        )
        .all(executionId) as Row[]
    ).map(view);
  }

  // The execution's latest operation for `action`, if any.
  latest(executionId: string, action: string): Operation | null {
    const row = this.db
      .prepare(
        'SELECT * FROM effect_operations WHERE execution_id = ? AND action = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(executionId, action) as Row | undefined;
    return row ? view(row) : null;
  }

  // Records a new operation as INTENDED. Its key counts the execution's earlier operations for the
  // same action, so the identity of an interrupted operation never changes while it is recovered.
  intend(claim: Claim, action: string, args: Json, evidence: Record<string, Json> = {}): Operation {
    return this.db
      .transaction(() => {
        this.#fenced(claim);
        const { count } = this.db
          .prepare(
            'SELECT COUNT(*) AS count FROM effect_operations WHERE execution_id = ? AND action = ?',
          )
          .get(claim.executionId, action) as { count: number };
        const id = randomUUID();
        const now = this.clock.now();
        this.db
          .prepare(
            "INSERT INTO effect_operations (id, run_id, execution_id, attempt_id, operation_key, action, args_json, args_hash, state, evidence_json, fence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INTENDED', ?, ?, ?, ?)",
          )
          .run(
            id,
            claim.runId,
            claim.executionId,
            claim.attemptId,
            `${claim.executionId}/${action}/${count + 1}`,
            action,
            JSON.stringify(args),
            argumentHash(args),
            JSON.stringify(evidence),
            claim.fence,
            now,
            now,
          );
        this.#event(claim, 'effect.intended', { operationId: id, action });
        return this.get(id);
      })
      .immediate();
  }

  // Takes over an operation an earlier attempt or process left, after checking that it is still
  // asked to do exactly what was recorded.
  adopt(claim: Claim, operation: Operation, args: Json): Operation {
    if (argumentHash(args) !== operation.argsHash) throw new EffectConflict(operation);
    return this.#update(claim, operation.id, {}, false);
  }

  // Marks the operation SUBMITTED right before its external call. Refused once the run stopped
  // accepting effects, so a cancelled or stale attempt never starts one.
  submit(claim: Claim, id: string, evidence: Record<string, Json> = {}): Operation {
    return this.#update(claim, id, { state: 'SUBMITTED', evidence }, true);
  }

  // Adds evidence learned during the call without changing the state.
  observe(claim: Claim, id: string, evidence: Record<string, Json>): Operation {
    return this.#update(claim, id, { evidence }, false);
  }

  settle(
    claim: Claim,
    id: string,
    change: {
      state: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'ABANDONED';
      result?: Json;
      error?: Json;
      evidence?: Record<string, Json>;
      resolution?: Json;
    },
  ): Operation {
    return this.#update(claim, id, change, false);
  }

  #update(
    claim: Claim,
    id: string,
    change: {
      state?: OperationState;
      result?: Json;
      error?: Json;
      evidence?: Record<string, Json>;
      resolution?: Json;
    },
    activeRun: boolean,
  ): Operation {
    return this.db
      .transaction(() => {
        this.#fenced(claim);
        if (activeRun) {
          const run = this.db
            .prepare('SELECT state, cancel_requested_at FROM runs WHERE id = ?')
            .get(claim.runId) as { state: string; cancel_requested_at: number | null };
          if (run.state !== 'RUNNING' || run.cancel_requested_at !== null) throw new RunNotActive();
        }
        const current = this.get(id);
        if (current.executionId !== claim.executionId) throw new StaleClaim();
        const evidence = { ...current.evidence, ...change.evidence };
        this.db
          .prepare(
            'UPDATE effect_operations SET attempt_id = ?, fence = ?, state = ?, evidence_json = ?, result_json = ?, error_json = ?, resolution_json = ?, updated_at = ? WHERE id = ?',
          )
          .run(
            claim.attemptId,
            claim.fence,
            change.state ?? current.state,
            JSON.stringify(evidence),
            stored(change.result === undefined ? current.result : change.result),
            stored(change.error === undefined ? current.error : change.error),
            stored(change.resolution === undefined ? current.resolution : change.resolution),
            this.clock.now(),
            id,
          );
        if (change.state && change.state !== current.state)
          this.#event(claim, `effect.${change.state.toLowerCase()}`, {
            operationId: id,
            action: current.action,
          });
        return this.get(id);
      })
      .immediate();
  }
}
