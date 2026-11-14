import type Database from 'better-sqlite3';
import type { Clock } from '../domain/clock.js';
import type { Json } from '../harness/types.js';
import { Schedule, type ScheduleConfig } from './schedule.js';
import type { Capture, TriggerService } from './service.js';

// An instant is on time while it is at most this old when the scheduler reaches it; older ones
// were missed, for example while the server was down.
export const misfireGraceMs = 60_000;
// Replay creates at most this many occurrences per catch-up (specification 12.2).
export const replayCap = 100;

export type Misfire = 'latest' | 'skip' | 'replay';

interface ScheduleState {
  // Interval instants are multiples of the interval after this minute.
  anchor: number;
  // Every instant up to here has been decided.
  cursor: number;
  lastMisfire?: {
    policy: Misfire;
    missed: number;
    capped: boolean;
    from: string;
    to: string;
    at: string;
  };
}

interface ScheduleTriggerConfig {
  schedule: ScheduleConfig;
  misfire?: Misfire;
}

interface Row {
  id: string;
  workflow_id: string;
  config_json: string;
  state_json: string;
  revision: number;
  project_id: string;
}

const iso = (at: number) => new Date(at).toISOString();

// Schedule triggers (specification 12.2). The cursor and next instant live on the trigger row;
// a tick decides every instant between the cursor and now in one transaction with the
// occurrences it captures, so a crash before it commits decides them again, and the occurrence
// identity (trigger and UTC instant) makes a decision that did commit impossible to repeat.
export class Scheduler {
  readonly #db: Database.Database;
  readonly #clock: Clock;
  readonly #triggers: TriggerService;

  constructor(options: { db: Database.Database; clock: Clock; triggers: TriggerService }) {
    this.#db = options.db;
    this.#clock = options.clock;
    this.#triggers = options.triggers;
    // A new or changed schedule starts from now: publication never replays the old one.
    options.triggers.onPublish('schedule', (trigger, changed) => {
      const state = trigger.state as unknown as Partial<ScheduleState>;
      if (!changed && typeof state.cursor === 'number') return;
      const now = this.#clock.now();
      this.#store(trigger.id, trigger.config, { anchor: now, cursor: now });
    });
    // Unpausing starts from now, in the transaction that enables the workflow: the paused
    // interval is discarded, not replayed.
    options.triggers.onEnablement((workflowId, enabled) => {
      if (!enabled) return;
      const now = this.#clock.now();
      for (const trigger of this.#triggers.triggers(workflowId)) {
        if (trigger.kind !== 'schedule') continue;
        const state = trigger.state as unknown as ScheduleState;
        this.#store(trigger.id, trigger.config, { ...state, cursor: now });
      }
    });
    options.triggers.onTick(() => this.tick());
  }

  #store(triggerId: string, config: Json, state: ScheduleState): void {
    const { schedule } = config as unknown as ScheduleTriggerConfig;
    const next = new Schedule(schedule, state.anchor).next(state.cursor);
    this.#db
      .prepare(
        'UPDATE triggers SET state_json = ?, next_fire_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
      )
      .run(JSON.stringify(state), next, this.#clock.now(), triggerId);
  }

  // The instants a schedule would fire next, by the same matcher execution uses.
  static preview(schedule: ScheduleConfig, after: number, count: number, anchor = after): number[] {
    return new Schedule(schedule, anchor).preview(after, count);
  }

  // Decides every due schedule, each in a transaction with no other I/O that rechecks the
  // trigger has not moved on, then creates the runs of the accepted occurrences.
  async tick(): Promise<void> {
    const now = this.#clock.now();
    const due = this.#db
      .prepare(
        "SELECT t.id, t.workflow_id, t.config_json, t.state_json, t.revision, w.project_id FROM triggers t JOIN workflows w ON w.id = t.workflow_id WHERE t.kind = 'schedule' AND t.removed_at IS NULL AND t.next_fire_at IS NOT NULL AND t.next_fire_at <= ? AND w.enabled = 1 AND w.archived_at IS NULL AND w.active_version_id IS NOT NULL ORDER BY t.next_fire_at, t.id",
      )
      .all(now) as Row[];
    let accepted = false;
    for (const row of due) {
      if (this.#triggers.stopping) break;
      if (this.#db.transaction(() => this.#decide(row, now)).immediate()) accepted = true;
    }
    if (accepted) await this.#triggers.admit();
  }

  #decide(row: Row, now: number): boolean {
    const current = this.#db
      .prepare(
        'SELECT t.revision, t.removed_at, w.enabled FROM triggers t JOIN workflows w ON w.id = t.workflow_id WHERE t.id = ?',
      )
      .get(row.id) as { revision: number; removed_at: number | null; enabled: number };
    // Published, paused or decided by another tick meanwhile: the next tick reads it afresh.
    if (current.revision !== row.revision || current.removed_at !== null || !current.enabled)
      return false;
    const config = JSON.parse(row.config_json) as ScheduleTriggerConfig;
    const state = JSON.parse(row.state_json) as ScheduleState;
    const policy = config.misfire ?? 'latest';
    const schedule = new Schedule(config.schedule, state.anchor);
    const found = schedule.between(state.cursor, now, replayCap);
    const onTime = found.kept.filter((at) => now - at <= misfireGraceMs);
    const fire =
      found.count === 0
        ? []
        : policy === 'latest'
          ? [found.kept.at(-1)!]
          : policy === 'skip'
            ? onTime
            : found.kept;
    const missed = found.count - fire.length;
    const next: ScheduleState = { anchor: state.anchor, cursor: now };
    if (missed > 0) {
      // The missed instants are the oldest ones; the fired ones are the newest.
      const lastMissed = schedule.between(state.cursor, now, 1, missed).kept[0]!;
      next.lastMisfire = {
        policy,
        missed,
        capped: found.capped,
        from: iso(found.first!),
        to: iso(lastMissed),
        at: iso(now),
      };
    } else if (state.lastMisfire) next.lastMisfire = state.lastMisfire;
    const captures: Capture[] = fire.map((at) => ({
      triggerId: row.id,
      dedupKey: iso(at),
      occurredAt: at,
      input: { scheduledFor: iso(at), firedAt: iso(now) },
      details: {
        scheduledFor: iso(at),
        ...(missed > 0
          ? { missed, missedFrom: next.lastMisfire!.from, missedTo: next.lastMisfire!.to }
          : {}),
      },
    }));
    const occurrences = this.#triggers.capture(captures);
    this.#store(row.id, config as unknown as Json, next);
    if (missed > 0)
      this.#db
        .prepare(
          'INSERT INTO events (type, schema_version, payload_json, created_at) VALUES (?, 1, ?, ?)',
        )
        .run(
          'trigger.misfire',
          JSON.stringify({ triggerId: row.id, workflowId: row.workflow_id, ...next.lastMisfire }),
          now,
        );
    return occurrences.some((occurrence) => occurrence.state === 'ACCEPTED');
  }
}
