import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import type { WorkflowDocument } from '../workflows/document.js';
import { nodeType } from '../workflows/nodes.js';
import type { DefinitionRepository, VersionRow } from '../workflows/repository.js';

export type TriggerKind = 'github' | 'schedule' | 'webhook';
export type OccurrenceState = 'ACCEPTED' | 'ADMITTED' | 'QUEUED' | 'SKIPPED' | 'REJECTED';

// What a trigger captured: the version that was active when it arrived, and the run's input.
export interface Capture {
  triggerId: string;
  dedupKey: string;
  requestHash?: string;
  occurredAt: number;
  input: Json;
  details?: Record<string, Json>;
}

export interface OccurrenceView {
  id: string;
  triggerId: string;
  workflowId: string;
  versionId: string;
  nodeId: string;
  kind: TriggerKind;
  dedupKey: string;
  occurredAt: number;
  receivedAt: number;
  state: OccurrenceState;
  reason: string | null;
  details: Json;
  runId: string | null;
  decidedAt: number | null;
}

export interface TriggerView {
  id: string;
  workflowId: string;
  nodeId: string;
  kind: TriggerKind;
  config: Json;
  versionId: string;
  state: Json;
  nextFireAt: number | null;
  createdAt: number;
  updatedAt: number;
}

// The part of the engine admission needs: creating a run inside the caller's transaction, and
// letting the engine start it.
export interface Admitter {
  admit(
    version: VersionRow,
    entryNodeId: string,
    input: Json,
    baseCommit: string,
    occurrenceId: string | null,
  ): string;
  wake(): void;
}

interface TriggerRow {
  id: string;
  workflow_id: string;
  node_id: string;
  kind: TriggerKind;
  config_json: string;
  workflow_version_id: string;
  state_json: string;
  next_fire_at: number | null;
  revision: number;
  created_at: number;
  updated_at: number;
  removed_at: number | null;
}

interface OccurrenceRow {
  id: string;
  ordinal: number;
  trigger_id: string;
  workflow_id: string;
  workflow_version_id: string;
  dedup_key: string;
  request_hash: string | null;
  occurred_at: number;
  received_at: number;
  input_json: string;
  details_json: string;
  state: OccurrenceState;
  reason: string | null;
  run_id: string | null;
  decided_at: number | null;
}

// Resolves a project's base ref to a commit. It reads the repository, so it runs before the
// admission transaction, never inside it.
export type BaseResolver = (projectId: string) => Promise<string>;

// Trigger subscriptions and the admission of their occurrences (server specification 12.1).
// Every trigger kind captures through `capture`, inside its own receipt transaction, and every
// queued occurrence is admitted later through `drain`; there is no other way a trigger starts a
// run. A manual start goes through the engine's same `admit`, with an explicit overlap override.
export class TriggerService {
  readonly #db: Database.Database;
  readonly #clock: Clock;
  readonly #definitions: DefinitionRepository;
  readonly #resolveBase: BaseResolver;
  readonly #logger: Logger;
  #engine: Admitter | null = null;
  // Extra work each kind does when a version is published or a workflow paused (schedules).
  readonly #publishers = new Map<TriggerKind, (trigger: TriggerView, changed: boolean) => void>();
  readonly #enablement: Array<(workflowId: string, enabled: boolean) => void> = [];
  #admitting: Promise<void> | null = null;
  #admitAgain = false;
  #timer: NodeJS.Timeout | undefined;
  #stopping = false;

  constructor(options: {
    db: Database.Database;
    clock: Clock;
    definitions: DefinitionRepository;
    resolveBase: BaseResolver;
    logger: Logger;
  }) {
    this.#db = options.db;
    this.#clock = options.clock;
    this.#definitions = options.definitions;
    this.#resolveBase = options.resolveBase;
    this.#logger = options.logger;
    options.definitions.observe({
      published: (workflowId, versionId, document) =>
        this.#materialize(workflowId, versionId, document),
      enabled: (workflowId, enabled) => {
        for (const listener of this.#enablement) listener(workflowId, enabled);
      },
    });
  }

  attach(engine: Admitter): void {
    this.#engine = engine;
  }

  onPublish(kind: TriggerKind, listener: (trigger: TriggerView, changed: boolean) => void): void {
    this.#publishers.set(kind, listener);
  }

  onEnablement(listener: (workflowId: string, enabled: boolean) => void): void {
    this.#enablement.push(listener);
  }

  get stopping(): boolean {
    return this.#stopping;
  }

  #event(type: string, payload: Record<string, Json>, runId: string | null = null): void {
    this.#db
      .prepare(
        'INSERT INTO events (type, schema_version, run_id, payload_json, created_at) VALUES (?, 1, ?, ?, ?)',
      )
      .run(type, runId, JSON.stringify(payload), this.#clock.now());
  }

  // Publication replaces the workflow's subscriptions in the publishing transaction. A trigger
  // node kept by the new version keeps its row, so its endpoint and credentials survive; one the
  // version dropped, or whose kind changed, is removed. Occurrences already captured keep the
  // version they captured.
  #materialize(workflowId: string, versionId: string, document: WorkflowDocument): void {
    const now = this.#clock.now();
    const current = this.#db
      .prepare('SELECT * FROM triggers WHERE workflow_id = ? AND removed_at IS NULL')
      .all(workflowId) as TriggerRow[];
    const kept = new Set<string>();
    for (const node of document.nodes) {
      const kind = nodeType(node.type, node.typeVersion)?.trigger;
      if (!kind) continue;
      const config = JSON.stringify(node.config);
      const existing = current.find((row) => row.node_id === node.id && row.kind === kind);
      let id: string;
      let changed: boolean;
      if (existing) {
        id = existing.id;
        changed = existing.config_json !== config;
        this.#db
          .prepare(
            'UPDATE triggers SET config_json = ?, workflow_version_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
          )
          .run(config, versionId, now, id);
      } else {
        id = randomUUID();
        changed = true;
        this.#db
          .prepare(
            "INSERT INTO triggers (id, workflow_id, node_id, kind, config_json, workflow_version_id, state_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '{}', 0, ?, ?)",
          )
          .run(id, workflowId, node.id, kind, config, versionId, now, now);
      }
      kept.add(id);
      this.#publishers.get(kind)?.(this.trigger(id), changed);
    }
    for (const row of current) {
      if (kept.has(row.id)) continue;
      this.#db
        .prepare('UPDATE triggers SET removed_at = ?, revision = revision + 1 WHERE id = ?')
        .run(now, row.id);
      this.#event('trigger.removed', { triggerId: row.id, workflowId, nodeId: row.node_id });
    }
  }

  #view(row: TriggerRow): TriggerView {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      nodeId: row.node_id,
      kind: row.kind,
      config: JSON.parse(row.config_json) as Json,
      versionId: row.workflow_version_id,
      state: JSON.parse(row.state_json) as Json,
      nextFireAt: row.next_fire_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  trigger(id: string): TriggerView {
    const row = this.#db.prepare('SELECT * FROM triggers WHERE id = ?').get(id) as
      TriggerRow | undefined;
    if (!row) throw new ShiftError('NOT_FOUND', 'Trigger not found.', 404);
    return this.#view(row);
  }

  // The subscriptions of live, published workflows of one kind.
  active(kind: TriggerKind, projectIds?: string[]): Array<TriggerView & { projectId: string }> {
    const rows = this.#db
      .prepare(
        'SELECT t.*, w.project_id FROM triggers t JOIN workflows w ON w.id = t.workflow_id WHERE t.kind = ? AND t.removed_at IS NULL AND w.archived_at IS NULL AND w.active_version_id IS NOT NULL ORDER BY t.created_at, t.id',
      )
      .all(kind) as Array<TriggerRow & { project_id: string }>;
    return rows
      .filter((row) => !projectIds || projectIds.includes(row.project_id))
      .map((row) => ({ ...this.#view(row), projectId: row.project_id }));
  }

  triggers(workflowId: string): TriggerView[] {
    this.#definitions.workflow(workflowId);
    return (
      this.#db
        .prepare(
          'SELECT * FROM triggers WHERE workflow_id = ? AND removed_at IS NULL ORDER BY created_at, id',
        )
        .all(workflowId) as TriggerRow[]
    ).map((row) => this.#view(row));
  }

  #occurrence(
    row: OccurrenceRow,
    trigger?: { node_id: string; kind: TriggerKind },
  ): OccurrenceView {
    const owner =
      trigger ??
      (this.#db.prepare('SELECT node_id, kind FROM triggers WHERE id = ?').get(row.trigger_id) as {
        node_id: string;
        kind: TriggerKind;
      });
    return {
      id: row.id,
      triggerId: row.trigger_id,
      workflowId: row.workflow_id,
      versionId: row.workflow_version_id,
      nodeId: owner.node_id,
      kind: owner.kind,
      dedupKey: row.dedup_key,
      occurredAt: row.occurred_at,
      receivedAt: row.received_at,
      state: row.state,
      reason: row.reason,
      details: JSON.parse(row.details_json) as Json,
      runId: row.run_id,
      decidedAt: row.decided_at,
    };
  }

  occurrence(id: string): OccurrenceView & { input: Json } {
    const row = this.#db.prepare('SELECT * FROM trigger_occurrences WHERE id = ?').get(id) as
      OccurrenceRow | undefined;
    if (!row) throw new ShiftError('NOT_FOUND', 'Occurrence not found.', 404);
    return { ...this.#occurrence(row), input: JSON.parse(row.input_json) as Json };
  }

  // Newest first, a page at a time.
  occurrences(filter: {
    workflowId?: string;
    triggerId?: string;
    before?: number;
    limit?: number;
  }): {
    occurrences: OccurrenceView[];
    nextBefore: number | null;
  } {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const rows = this.#db
      .prepare(
        'SELECT * FROM trigger_occurrences WHERE (? IS NULL OR workflow_id = ?) AND (? IS NULL OR trigger_id = ?) AND (? IS NULL OR ordinal < ?) ORDER BY ordinal DESC LIMIT ?',
      )
      .all(
        filter.workflowId ?? null,
        filter.workflowId ?? null,
        filter.triggerId ?? null,
        filter.triggerId ?? null,
        filter.before ?? null,
        filter.before ?? null,
        limit + 1,
      ) as OccurrenceRow[];
    const page = rows.slice(0, limit);
    return {
      occurrences: page.map((row) => this.#occurrence(row)),
      nextBefore: rows.length > limit ? page.at(-1)!.ordinal : null,
    };
  }

  // Resolves a project's base commit for admission, outside any transaction. A failure becomes
  // that occurrence's rejection rather than an error for whoever captured it.
  async #base(projectId: string): Promise<string | ShiftError> {
    try {
      return await this.#resolveBase(projectId);
    } catch (error) {
      return error instanceof ShiftError
        ? error
        : new ShiftError('BASE_UNRESOLVED', 'The project base ref could not be resolved.', 500);
    }
  }

  // Records one occurrence per capture with the version active now and decides it, in the
  // caller's transaction, with no other I/O: what the event matched, the version it runs and
  // whether it may start are fixed when it arrives (specification 12.1). An occurrence that may
  // start is ACCEPTED; `admit` creates its run afterwards. A capture whose trigger already holds
  // that dedup key returns the original occurrence unchanged, so a repeat decides nothing again.
  capture(captures: Capture[]): OccurrenceView[] {
    if (!this.#db.inTransaction) throw new Error('Capture runs inside a transaction.');
    const now = this.#clock.now();
    return captures.map((capture) => {
      const trigger = this.#db
        .prepare(
          'SELECT t.*, w.active_version_id FROM triggers t JOIN workflows w ON w.id = t.workflow_id WHERE t.id = ?',
        )
        .get(capture.triggerId) as (TriggerRow & { active_version_id: string | null }) | undefined;
      if (!trigger) throw new ShiftError('NOT_FOUND', 'Trigger not found.', 404);
      const existing = this.#db
        .prepare('SELECT * FROM trigger_occurrences WHERE trigger_id = ? AND dedup_key = ?')
        .get(capture.triggerId, capture.dedupKey) as OccurrenceRow | undefined;
      if (existing) {
        if (
          capture.requestHash !== undefined &&
          existing.request_hash !== null &&
          existing.request_hash !== capture.requestHash
        )
          throw new ShiftError(
            'DUPLICATE_EVENT_CONFLICT',
            'This event ID was already received with a different body.',
            409,
          );
        return this.#occurrence(existing, trigger);
      }
      if (trigger.removed_at !== null || !trigger.active_version_id)
        throw new ShiftError('NOT_FOUND', 'Trigger not found.', 404);
      const id = randomUUID();
      const ordinal = (
        this.#db
          .prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM trigger_occurrences')
          .get() as { n: number }
      ).n;
      this.#db
        .prepare(
          "INSERT INTO trigger_occurrences (id, ordinal, trigger_id, workflow_id, workflow_version_id, dedup_key, request_hash, occurred_at, received_at, input_json, details_json, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED')",
        )
        .run(
          id,
          ordinal,
          trigger.id,
          trigger.workflow_id,
          trigger.active_version_id,
          capture.dedupKey,
          capture.requestHash ?? null,
          capture.occurredAt,
          now,
          JSON.stringify(capture.input),
          JSON.stringify(capture.details ?? {}),
        );
      this.#decide(id);
      return this.#occurrence(
        this.#db.prepare('SELECT * FROM trigger_occurrences WHERE id = ?').get(id) as OccurrenceRow,
        trigger,
      );
    });
  }

  #settle(
    row: OccurrenceRow,
    state: OccurrenceState,
    reason: string | null,
    details: Record<string, Json> = {},
    runId: string | null = null,
  ): OccurrenceState {
    const merged = { ...(JSON.parse(row.details_json) as Record<string, Json>), ...details };
    this.#db
      .prepare(
        'UPDATE trigger_occurrences SET state = ?, reason = ?, details_json = ?, run_id = ?, decided_at = ? WHERE id = ?',
      )
      .run(state, reason, JSON.stringify(merged), runId, this.#clock.now(), row.id);
    this.#event(
      'trigger.occurrence',
      {
        occurrenceId: row.id,
        triggerId: row.trigger_id,
        workflowId: row.workflow_id,
        state,
        reason,
      },
      runId,
    );
    return state;
  }

  // Whether a workflow has work that a new occurrence would overlap: an unfinished run, an
  // accepted occurrence whose run is being created, or (before `ordinal`) a queued one. Waiting,
  // held and needs-human runs are unfinished.
  #busy(workflowId: string, ordinal: number): { busy: boolean; unfinishedRuns: number } {
    const counts = this.#db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM runs WHERE workflow_id = ? AND state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')) AS runs, (SELECT COUNT(*) FROM trigger_occurrences WHERE workflow_id = ? AND (state = 'ACCEPTED' OR (state = 'QUEUED' AND ordinal < ?))) AS waiting",
      )
      .get(workflowId, workflowId, ordinal) as { runs: number; waiting: number };
    return { busy: counts.runs + counts.waiting > 0, unfinishedRuns: counts.runs };
  }

  // Admission for a new occurrence (specification 12.1): a paused workflow skips it, and the
  // workflow's overlap policy skips, queues or accepts it.
  #decide(id: string): OccurrenceState {
    const row = this.#db
      .prepare('SELECT * FROM trigger_occurrences WHERE id = ?')
      .get(id) as OccurrenceRow;
    const workflow = this.#db
      .prepare('SELECT enabled, archived_at FROM workflows WHERE id = ?')
      .get(row.workflow_id) as { enabled: number; archived_at: number | null };
    if (workflow.archived_at !== null) return this.#settle(row, 'SKIPPED', 'WORKFLOW_ARCHIVED');
    if (!workflow.enabled) return this.#settle(row, 'SKIPPED', 'WORKFLOW_PAUSED');
    const policy = this.#definitions.version(row.workflow_version_id).document.execution.overlap;
    const { busy, unfinishedRuns } = this.#busy(row.workflow_id, row.ordinal);
    if (busy && policy === 'queue')
      return this.#settle(row, 'QUEUED', 'OVERLAP', { unfinishedRuns });
    if (busy && policy === 'skip')
      return this.#settle(row, 'SKIPPED', 'OVERLAP', { unfinishedRuns });
    return this.#settle(row, 'ACCEPTED', null);
  }

  // Creates the runs of accepted occurrences, oldest first. The base commit is resolved outside
  // the transaction, which then rechecks that the occurrence is still accepted, so a concurrent
  // or repeated admission creates nothing twice. The run is the version the occurrence captured.
  // Callers wait for admissions requested while one is running to finish too.
  admit(): Promise<void> {
    if (this.#admitting) {
      this.#admitAgain = true;
      return this.#admitting;
    }
    this.#admitting = (async () => {
      let admitted = false;
      do {
        this.#admitAgain = false;
        const accepted = this.#db
          .prepare(
            "SELECT id, workflow_version_id FROM trigger_occurrences WHERE state = 'ACCEPTED' ORDER BY ordinal",
          )
          .all() as Array<{ id: string; workflow_version_id: string }>;
        for (const pending of accepted) {
          if (this.#stopping) break;
          const version = this.#definitions.version(pending.workflow_version_id);
          const base = await this.#base(version.projectId);
          const state = this.#db
            .transaction(() => {
              const row = this.#db
                .prepare('SELECT * FROM trigger_occurrences WHERE id = ?')
                .get(pending.id) as OccurrenceRow;
              if (row.state !== 'ACCEPTED') return row.state;
              if (base instanceof ShiftError)
                return this.#settle(row, 'REJECTED', base.code, { message: base.message });
              const trigger = this.#db
                .prepare('SELECT node_id FROM triggers WHERE id = ?')
                .get(row.trigger_id) as { node_id: string };
              try {
                const runId = this.#db.transaction(() =>
                  this.#engine!.admit(
                    version,
                    trigger.node_id,
                    JSON.parse(row.input_json) as Json,
                    base,
                    row.id,
                  ),
                )();
                return this.#settle(row, 'ADMITTED', null, {}, runId);
              } catch (error) {
                if (!(error instanceof ShiftError)) throw error;
                return this.#settle(row, 'REJECTED', error.code, { message: error.message });
              }
            })
            .immediate();
          if (state === 'ADMITTED') admitted = true;
        }
      } while (this.#admitAgain && !this.#stopping);
      if (admitted) this.#engine?.wake();
    })()
      .catch((error: unknown) =>
        this.#logger.error({ err: error }, 'Admitting occurrences failed.'),
      )
      .finally(() => {
        this.#admitting = null;
      });
    return this.#admitting;
  }

  // Accepts the oldest queued occurrence of each enabled workflow that has nothing unfinished,
  // then admits it; a rejected one lets the next take its turn. A queued occurrence keeps its
  // place under a later version's policy: it was promised a run.
  async drain(): Promise<void> {
    for (let pass = 0; pass < 100 && !this.#stopping; pass++) {
      const promoted = this.#db
        .transaction(() => {
          const heads = this.#db
            .prepare(
              "SELECT o.* FROM trigger_occurrences o JOIN workflows w ON w.id = o.workflow_id WHERE o.state = 'QUEUED' AND w.enabled = 1 AND w.archived_at IS NULL AND o.ordinal = (SELECT MIN(ordinal) FROM trigger_occurrences q WHERE q.workflow_id = o.workflow_id AND q.state = 'QUEUED')",
            )
            .all() as OccurrenceRow[];
          let count = 0;
          for (const head of heads) {
            if (this.#busy(head.workflow_id, head.ordinal).busy) continue;
            this.#settle(head, 'ACCEPTED', null, { fromQueue: true });
            count++;
          }
          return count;
        })
        .immediate();
      await this.admit();
      if (promoted === 0) break;
    }
  }

  // Ticks admit queued occurrences and run each kind's own timers (schedules).
  readonly #ticks: Array<() => Promise<void>> = [];

  onTick(tick: () => Promise<void>): void {
    this.#ticks.push(tick);
  }

  async tick(): Promise<void> {
    for (const tick of this.#ticks) {
      if (this.#stopping) return;
      await tick().catch((error: unknown) =>
        this.#logger.error({ err: error }, 'A trigger tick failed.'),
      );
    }
    await this.drain();
  }

  start(intervalMs = 1_000): void {
    void this.tick();
    this.#timer = setInterval(() => void this.tick(), intervalMs);
    this.#timer.unref();
  }

  // Stops admission: no new occurrence is accepted or admitted after this.
  async stop(): Promise<void> {
    this.#stopping = true;
    clearInterval(this.#timer);
    await this.#admitting;
  }
}
