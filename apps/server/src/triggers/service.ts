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
export type OccurrenceState = 'ADMITTED' | 'QUEUED' | 'SKIPPED' | 'REJECTED';

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
  #draining: Promise<void> | null = null;
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

  // Resolves the base commits admission may need, before its transaction. A failure is kept and
  // becomes that occurrence's rejection rather than failing the whole delivery.
  async bases(projectIds: Iterable<string>): Promise<Map<string, string | ShiftError>> {
    const bases = new Map<string, string | ShiftError>();
    for (const projectId of new Set(projectIds)) {
      try {
        bases.set(projectId, await this.#resolveBase(projectId));
      } catch (error) {
        bases.set(
          projectId,
          error instanceof ShiftError
            ? error
            : new ShiftError('BASE_UNRESOLVED', 'The project base ref could not be resolved.', 500),
        );
      }
    }
    return bases;
  }

  // Records one occurrence per capture with the version active now, and decides each, in the
  // caller's transaction. A capture whose trigger already holds that dedup key returns the
  // original occurrence unchanged: a repeat can never start, queue or skip anything again.
  capture(captures: Capture[], bases: Map<string, string | ShiftError>): OccurrenceView[] {
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
      this.#decide(id, bases, false);
      return this.#occurrence(
        this.#db.prepare('SELECT * FROM trigger_occurrences WHERE id = ?').get(id) as OccurrenceRow,
        trigger,
      );
    });
  }

  // Admission for one undecided or queued occurrence (specification 12.1). A paused workflow
  // skips a new occurrence and leaves a queued one waiting. Overlap is the workflow's: any
  // unfinished run, or an earlier occurrence still queued, makes it busy.
  #decide(id: string, bases: Map<string, string | ShiftError>, queued: boolean): OccurrenceState {
    const row = this.#db
      .prepare('SELECT * FROM trigger_occurrences WHERE id = ?')
      .get(id) as OccurrenceRow;
    const workflow = this.#db
      .prepare('SELECT enabled, archived_at FROM workflows WHERE id = ?')
      .get(row.workflow_id) as { enabled: number; archived_at: number | null };
    const settle = (
      state: OccurrenceState,
      reason: string | null,
      details: Record<string, Json> = {},
      runId: string | null = null,
    ): OccurrenceState => {
      const merged = { ...(JSON.parse(row.details_json) as Record<string, Json>), ...details };
      this.#db
        .prepare(
          'UPDATE trigger_occurrences SET state = ?, reason = ?, details_json = ?, run_id = ?, decided_at = ? WHERE id = ?',
        )
        .run(state, reason, JSON.stringify(merged), runId, this.#clock.now(), id);
      this.#event(
        'trigger.occurrence',
        {
          occurrenceId: id,
          triggerId: row.trigger_id,
          workflowId: row.workflow_id,
          state,
          reason,
          ...(queued ? { fromQueue: true } : {}),
        },
        runId,
      );
      return state;
    };
    if (workflow.archived_at !== null) return settle('SKIPPED', 'WORKFLOW_ARCHIVED');
    if (!workflow.enabled) {
      if (queued) return 'QUEUED';
      return settle('SKIPPED', 'WORKFLOW_PAUSED');
    }
    const version = this.#definitions.version(row.workflow_version_id);
    const policy = version.document.execution.overlap;
    const earlier = this.#db
      .prepare(
        "SELECT COUNT(*) AS n FROM trigger_occurrences WHERE workflow_id = ? AND state = 'QUEUED' AND ordinal < ?",
      )
      .get(row.workflow_id, row.ordinal) as { n: number };
    const unfinished = (
      this.#db
        .prepare(
          "SELECT COUNT(*) AS n FROM runs WHERE workflow_id = ? AND state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')",
        )
        .get(row.workflow_id) as { n: number }
    ).n;
    // A queued occurrence waits its turn even under a later version's policy; it was promised one.
    const busy = unfinished > 0 || earlier.n > 0;
    if (busy && (queued || policy === 'queue')) {
      if (queued) return 'QUEUED';
      return settle('QUEUED', 'OVERLAP', { unfinishedRuns: unfinished });
    }
    if (busy && policy === 'skip')
      return settle('SKIPPED', 'OVERLAP', { unfinishedRuns: unfinished });
    const base =
      bases.get(version.projectId) ??
      new ShiftError('BASE_UNRESOLVED', 'The project base ref was not resolved.', 500);
    if (base instanceof ShiftError) return settle('REJECTED', base.code, { message: base.message });
    const trigger = this.#db
      .prepare('SELECT node_id FROM triggers WHERE id = ?')
      .get(row.trigger_id) as { node_id: string };
    try {
      const runId = this.#db.transaction(() =>
        this.#engine!.admit(version, trigger.node_id, JSON.parse(row.input_json) as Json, base, id),
      )();
      return settle('ADMITTED', null, {}, runId);
    } catch (error) {
      if (!(error instanceof ShiftError)) throw error;
      return settle('REJECTED', error.code, { message: error.message });
    }
  }

  // Admits queued occurrences whose workflow has room, oldest first. The base commit is resolved
  // outside the transaction, which then rechecks the occurrence is still queued and next.
  async drain(): Promise<void> {
    if (this.#draining) return this.#draining;
    this.#draining = (async () => {
      let admitted = false;
      for (let pass = 0; pass < 100 && !this.#stopping; pass++) {
        const heads = this.#db
          .prepare(
            "SELECT o.id, o.workflow_version_id FROM trigger_occurrences o JOIN workflows w ON w.id = o.workflow_id WHERE o.state = 'QUEUED' AND w.enabled = 1 AND o.ordinal = (SELECT MIN(ordinal) FROM trigger_occurrences q WHERE q.workflow_id = o.workflow_id AND q.state = 'QUEUED') AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.workflow_id = o.workflow_id AND r.state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED'))",
          )
          .all() as Array<{ id: string; workflow_version_id: string }>;
        if (heads.length === 0) break;
        let progressed = false;
        for (const head of heads) {
          if (this.#stopping) break;
          const projectId = this.#definitions.version(head.workflow_version_id).projectId;
          const bases = await this.bases([projectId]);
          const state = this.#db
            .transaction(() => {
              const row = this.#db
                .prepare('SELECT state FROM trigger_occurrences WHERE id = ?')
                .get(head.id) as { state: OccurrenceState };
              return row.state === 'QUEUED' ? this.#decide(head.id, bases, true) : row.state;
            })
            .immediate();
          if (state !== 'QUEUED') progressed = true;
          if (state === 'ADMITTED') admitted = true;
        }
        if (!progressed) break;
      }
      if (admitted) this.#engine?.wake();
    })()
      .catch((error: unknown) =>
        this.#logger.error({ err: error }, 'Admitting queued occurrences failed.'),
      )
      .finally(() => {
        this.#draining = null;
      });
    return this.#draining;
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
    await this.#draining;
  }
}
