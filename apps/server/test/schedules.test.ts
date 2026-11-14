import assert from 'node:assert/strict';
import test from 'node:test';
import type { Json } from '../src/harness/types.js';
import { Schedule, checkSchedule } from '../src/triggers/schedule.js';
import { Scheduler } from '../src/triggers/scheduler.js';
import { setup, type Env } from './action-helpers.js';
import { eventually } from './helpers.js';
import {
  cancel,
  occurrencesOf,
  publish,
  republish,
  runsOf,
  withTriggers,
} from './trigger-helpers.js';

const minute = 60_000;
const hour = 60 * minute;
const iso = (instants: number[]) => instants.map((at) => new Date(at).toISOString());
const cron = (expression: string, timezone = 'UTC') =>
  new Schedule({ kind: 'cron', expression, timezone }, 0);
const at = (text: string) => Date.parse(text);

// Moves the test clock forward to a moment.
const until = (env: Env, moment: string) => {
  const target = Date.parse(moment);
  assert.ok(target >= env.clock.now(), `${moment} is in the past`);
  env.clock.advance(target - env.clock.now());
};

test('the matcher skips nonexistent wall times and fires repeated ones once, at the first instant', () => {
  const newYork = (expression: string) => cron(expression, 'America/New_York');
  // 2026-03-08: 02:00 jumps to 03:00. 02:30 does not exist that day and is skipped, not moved.
  assert.deepEqual(iso(newYork('30 2 * * *').preview(at('2026-03-06T00:00:00Z'), 4)), [
    '2026-03-06T07:30:00.000Z',
    '2026-03-07T07:30:00.000Z',
    '2026-03-09T06:30:00.000Z',
    '2026-03-10T06:30:00.000Z',
  ]);
  // 2026-11-01: 02:00 goes back to 01:00. 01:00 and 01:30 fire at their first instants only.
  assert.deepEqual(iso(newYork('*/30 * * * *').preview(at('2026-11-01T04:45:00Z'), 5)), [
    '2026-11-01T05:00:00.000Z',
    '2026-11-01T05:30:00.000Z',
    '2026-11-01T07:00:00.000Z',
    '2026-11-01T07:30:00.000Z',
    '2026-11-01T08:00:00.000Z',
  ]);
  // From inside the repeated hour, the repeat of 01:30 is not a new occurrence.
  assert.deepEqual(iso(newYork('30 1 * * *').preview(at('2026-11-01T05:45:00Z'), 1)), [
    '2026-11-02T06:30:00.000Z',
  ]);
  // Lord Howe moves its clocks by thirty minutes (01:30 repeats on 2026-04-05).
  assert.deepEqual(
    iso(cron('*/15 * * * *', 'Australia/Lord_Howe').preview(at('2026-04-04T14:20:00Z'), 4)),
    [
      '2026-04-04T14:30:00.000Z',
      '2026-04-04T14:45:00.000Z',
      '2026-04-04T15:30:00.000Z',
      '2026-04-04T15:45:00.000Z',
    ],
  );
  // Ordinary dates: weekdays in Berlin, India's half-hour offset, a leap day, and day of month
  // or weekday when both are restricted.
  assert.deepEqual(
    iso(cron('0 9 * * MON-FRI', 'Europe/Berlin').preview(at('2026-01-01T00:00:00Z'), 3)),
    ['2026-01-01T08:00:00.000Z', '2026-01-02T08:00:00.000Z', '2026-01-05T08:00:00.000Z'],
  );
  assert.deepEqual(iso(cron('0 0 * * *', 'Asia/Kolkata').preview(at('2026-01-01T00:00:00Z'), 1)), [
    '2026-01-01T18:30:00.000Z',
  ]);
  assert.deepEqual(iso(cron('0 12 29 2 *').preview(at('2026-01-01T00:00:00Z'), 2)), [
    '2028-02-29T12:00:00.000Z',
    '2032-02-29T12:00:00.000Z',
  ]);
  assert.deepEqual(iso(cron('0 0 13 * FRI').preview(at('2026-03-01T00:00:00Z'), 3)), [
    '2026-03-06T00:00:00.000Z',
    '2026-03-13T00:00:00.000Z',
    '2026-03-20T00:00:00.000Z',
  ]);
  // Intervals are UTC durations from the anchor minute, whatever the zone does.
  assert.deepEqual(
    iso(
      new Schedule({ kind: 'interval', minutes: 90 }, at('2026-11-01T00:00:30Z')).preview(
        at('2026-11-01T01:00:00Z'),
        3,
      ),
    ),
    ['2026-11-01T01:30:00.000Z', '2026-11-01T03:00:00.000Z', '2026-11-01T04:30:00.000Z'],
  );
  // A year of every minute counts quickly, with the skipped spring-forward hour.
  const year = cron('* * * * *', 'America/New_York').between(
    at('2026-01-01T00:00:00Z'),
    at('2026-12-31T00:00:00Z'),
    1,
  );
  assert.equal(year.count, 364 * 1440 - 60);
  for (const [expression, timezone, problem] of [
    ['* * * * * *', 'UTC', /five fields/],
    ['@daily', 'UTC', /five fields/],
    ['0 0 L * *', 'UTC', /numbers, three-letter names/],
    ['0 0 * * 5#2', 'UTC', /numbers, three-letter names/],
    ['61 * * * *', 'UTC', /Invalid cron expression/],
    ['0 9 * * *', 'Mars/Base', /Unknown time zone/],
    ['0 9 * * *', '+02:00', /named time zone/],
    ['0 9 * * *', 'EST', /named time zone/],
  ] as const)
    assert.match(checkSchedule({ kind: 'cron', expression, timezone }) ?? '', problem);
  assert.equal(checkSchedule({ kind: 'cron', expression: '0 9 * * 1-5', timezone: 'UTC' }), null);
});

// schedule -> transform -> end, so a run completes at once.
function scheduled(schedule: Json, misfire?: string, overlap = 'allow'): Json {
  return {
    execution: { overlap },
    nodes: [
      {
        id: 'tick',
        type: 'schedule_trigger',
        config: { schedule, ...(misfire ? { misfire } : {}) },
      },
      { id: 'shape', type: 'transform', config: { data: { ok: true } } },
      { id: 'end', type: 'end' },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'tick', fromPort: 'success', toNodeId: 'shape', toPort: 'input' },
      { id: 'c2', fromNodeId: 'shape', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
    ],
  } as Json;
}

const fiveMinutes = { kind: 'cron', expression: '*/5 * * * *', timezone: 'UTC' };
const misfireOf = (triggers: ReturnType<typeof withTriggers>['triggers'], workflowId: string) =>
  (triggers.triggers(workflowId)[0]!.state as { lastMisfire?: Record<string, Json> }).lastMisfire;

test('instants fire once each; downtime fires the latest, skips or replays up to the cap', async () => {
  const env = await setup();
  try {
    until(env, '2026-10-03T00:00:30Z');
    const { triggers } = withTriggers(env);
    const latest = publish(env, scheduled(fiveMinutes)).workflowId;
    const skip = publish(env, scheduled(fiveMinutes, 'skip')).workflowId;
    const replay = publish(env, scheduled(fiveMinutes, 'replay')).workflowId;
    // Publication starts from now: 00:00 already passed and never fires.
    assert.equal(triggers.triggers(latest)[0]!.nextFireAt, at('2026-10-03T00:05:00Z'));
    await triggers.tick();
    assert.equal(occurrencesOf(env, latest).length, 0);
    until(env, '2026-10-03T00:05:10Z');
    await triggers.tick();
    await triggers.tick();
    for (const workflowId of [latest, skip, replay]) {
      const rows = occurrencesOf(env, workflowId);
      assert.deepEqual(
        rows.map((row) => [row.dedup_key, row.state]),
        [['2026-10-03T00:05:00.000Z', 'ADMITTED']],
      );
    }
    const run = env.engine.repository.run(occurrencesOf(env, latest)[0]!.run_id!) as {
      executions: Array<{ node: string; output: { data: Record<string, Json> } }>;
    };
    assert.equal(
      run.executions.find((entry) => entry.node === 'tick')!.output.data['scheduledFor'],
      '2026-10-03T00:05:00.000Z',
    );
    // The server was down for ten hours: 120 instants passed.
    until(env, '2026-10-03T10:05:30Z');
    await triggers.tick();
    const fired = (id: string) => occurrencesOf(env, id).slice(1);
    // latest: one occurrence, the newest instant; the rest are recorded as missed.
    assert.deepEqual(
      fired(latest).map((row) => row.dedup_key),
      ['2026-10-03T10:05:00.000Z'],
    );
    assert.deepEqual(misfireOf(triggers, latest), {
      policy: 'latest',
      missed: 119,
      capped: false,
      from: '2026-10-03T00:10:00.000Z',
      to: '2026-10-03T10:00:00.000Z',
      at: '2026-10-03T10:05:30.000Z',
    });
    // skip: only an on-time instant fires (10:05 is 30 seconds old).
    assert.deepEqual(
      fired(skip).map((row) => row.dedup_key),
      ['2026-10-03T10:05:00.000Z'],
    );
    assert.equal(misfireOf(triggers, skip)!['missed'], 119);
    // replay: the newest 100 fire in order, and the 20 before them are the summarized overflow.
    const replayed = fired(replay).map((row) => row.dedup_key);
    assert.equal(replayed.length, 100);
    assert.equal(replayed[0], '2026-10-03T01:50:00.000Z');
    assert.equal(replayed.at(-1), '2026-10-03T10:05:00.000Z');
    assert.deepEqual(misfireOf(triggers, replay), {
      policy: 'replay',
      missed: 20,
      capped: false,
      from: '2026-10-03T00:10:00.000Z',
      to: '2026-10-03T01:45:00.000Z',
      at: '2026-10-03T10:05:30.000Z',
    });
    // skip after downtime with nothing on time fires nothing.
    until(env, '2026-10-03T11:07:00Z');
    await triggers.tick();
    assert.equal(fired(skip).length, 1);
    assert.equal(misfireOf(triggers, skip)!['missed'], 12);
  } finally {
    await env.close();
  }
});

test('Pause discards its interval, unpause starts from now, and publication changes restart the schedule', async () => {
  const env = await setup();
  try {
    until(env, '2026-10-03T00:00:30Z');
    const { triggers } = withTriggers(env);
    const document = scheduled(fiveMinutes);
    const { workflowId } = publish(env, document);
    env.definitions.setEnabled(workflowId, false);
    until(env, '2026-10-03T01:02:00Z');
    await triggers.tick();
    assert.equal(occurrencesOf(env, workflowId).length, 0);
    env.store.db.transaction(() => env.definitions.setEnabled(workflowId, true)).immediate();
    // The paused hour is not replayed: nothing until the next instant after unpausing.
    assert.equal(triggers.triggers(workflowId)[0]!.nextFireAt, at('2026-10-03T01:05:00Z'));
    await triggers.tick();
    assert.equal(occurrencesOf(env, workflowId).length, 0);
    until(env, '2026-10-03T01:05:01Z');
    await triggers.tick();
    assert.deepEqual(
      occurrencesOf(env, workflowId).map((row) => row.dedup_key),
      ['2026-10-03T01:05:00.000Z'],
    );
    assert.equal(misfireOf(triggers, workflowId), undefined);
    // Republishing the same schedule keeps its cursor, so downtime is still caught up.
    until(env, '2026-10-03T01:21:00Z');
    republish(env, workflowId, {
      ...(document as object),
      presentation: { viewport: { x: 1, y: 1, zoom: 1 } },
    } as Json);
    await triggers.tick();
    assert.equal(occurrencesOf(env, workflowId).at(-1)!.dedup_key, '2026-10-03T01:20:00.000Z');
    // A changed schedule starts from now; the old one's missed instants are not replayed.
    until(env, '2026-10-03T02:00:30Z');
    const hourly = republish(
      env,
      workflowId,
      scheduled({ kind: 'cron', expression: '0 * * * *', timezone: 'UTC' }),
    ).versionId;
    await triggers.tick();
    assert.equal(occurrencesOf(env, workflowId).length, 2);
    until(env, '2026-10-03T03:00:05Z');
    await triggers.tick();
    const last = occurrencesOf(env, workflowId).at(-1)!;
    assert.equal(last.dedup_key, '2026-10-03T03:00:00.000Z');
    assert.equal(last.workflow_version_id, hourly);
    // An interval schedule counts UTC minutes from its publication minute (03:00): 03:45 and
    // 04:30 have passed, and the latest of them fires.
    const every = publish(env, scheduled({ kind: 'interval', minutes: 45 })).workflowId;
    until(env, '2026-10-03T04:31:00Z');
    await triggers.tick();
    assert.deepEqual(
      occurrencesOf(env, every).map((row) => row.dedup_key),
      ['2026-10-03T04:30:00.000Z'],
    );
    assert.equal(misfireOf(triggers, every)!['missed'], 1);
  } finally {
    await env.close();
  }
});

test('a crash around an occurrence or admission never starts a scheduled run twice', async () => {
  const env = await setup();
  let current = env;
  try {
    until(env, '2026-10-03T00:00:30Z');
    const { triggers } = withTriggers(env);
    const { workflowId } = publish(env, scheduled(fiveMinutes));
    const triggerId = triggers.triggers(workflowId)[0]!.id;
    until(env, '2026-10-03T00:05:10Z');
    // Two ticks at once decide the instant once.
    await Promise.all([triggers.tick(), triggers.tick()]);
    assert.equal(occurrencesOf(env, workflowId).length, 1);
    // As if the occurrence and run had committed but the cursor had not: the instant is decided
    // again and finds its occurrence.
    const state = env.store.db
      .prepare('SELECT state_json FROM triggers WHERE id = ?')
      .get(triggerId) as {
      state_json: string;
    };
    const rewound = {
      ...(JSON.parse(state.state_json) as object),
      cursor: at('2026-10-03T00:00:30Z'),
    };
    env.store.db
      .prepare(
        'UPDATE triggers SET state_json = ?, next_fire_at = ?, revision = revision + 1 WHERE id = ?',
      )
      .run(JSON.stringify(rewound), at('2026-10-03T00:05:00Z'), triggerId);
    await triggers.tick();
    assert.equal(occurrencesOf(env, workflowId).length, 1);
    assert.equal(runsOf(env, workflowId).length, 1);
    // A restart continues from the persisted cursor.
    await env.close();
    current = await setup(env.state);
    until(current, '2026-10-03T00:10:20Z');
    const restarted = withTriggers(current);
    await restarted.triggers.tick();
    assert.deepEqual(
      occurrencesOf(current, workflowId).map((row) => row.dedup_key),
      ['2026-10-03T00:05:00.000Z', '2026-10-03T00:10:00.000Z'],
    );
    assert.equal(runsOf(current, workflowId).length, 2);
  } finally {
    await current.close();
  }
});

test('queued scheduled occurrences keep their version and wait for unpause', async () => {
  const env = await setup();
  try {
    until(env, '2026-10-03T00:00:30Z');
    const { triggers } = withTriggers(env);
    const held = (title: string): Json => ({
      execution: { overlap: 'queue' },
      nodes: [
        { id: 'tick', type: 'schedule_trigger', config: { schedule: fiveMinutes } },
        { id: 'hold', type: 'approval', config: { title } },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'tick', fromPort: 'success', toNodeId: 'hold', toPort: 'input' },
      ],
    });
    const { workflowId, versionId: v1 } = publish(env, held('First'));
    until(env, '2026-10-03T00:05:01Z');
    await triggers.tick();
    until(env, '2026-10-03T00:10:01Z');
    await triggers.tick();
    assert.deepEqual(
      occurrencesOf(env, workflowId).map((row) => row.state),
      ['ADMITTED', 'QUEUED'],
    );
    // The same title keeps the schedule, so the cursor is kept; only the version changes.
    republish(env, workflowId, held('Second'));
    env.definitions.setEnabled(workflowId, false);
    cancel(env, runsOf(env, workflowId)[0]!.id);
    await eventually(() => (runsOf(env, workflowId)[0]!.state === 'CANCELLED' ? true : undefined));
    await triggers.tick();
    assert.equal(runsOf(env, workflowId).length, 1);
    env.store.db.transaction(() => env.definitions.setEnabled(workflowId, true)).immediate();
    await triggers.tick();
    const runs = runsOf(env, workflowId);
    assert.equal(runs.length, 2);
    assert.equal(runs[1]!.workflow_version_id, v1);
  } finally {
    await env.close();
  }
});

test('publication refuses an invalid schedule, and the preview is the scheduler’s own instants', async () => {
  const env = await setup();
  try {
    const { triggers } = withTriggers(env);
    assert.throws(
      () => publish(env, scheduled({ kind: 'cron', expression: '0 25 * * *', timezone: 'UTC' })),
      /config\/schedule/,
    );
    assert.throws(
      () =>
        publish(
          env,
          scheduled({ kind: 'cron', expression: '0 9 * * *', timezone: 'Nowhere/City' }),
        ),
      /Unknown time zone/,
    );
    // Run the spring-forward day for real and compare with the preview.
    // 2027-03-14 is the next spring-forward day in New York after the test clock's start.
    until(env, '2027-03-12T00:00:00Z');
    const schedule = {
      kind: 'cron',
      expression: '30 2 * * *',
      timezone: 'America/New_York',
    } as const;
    const preview = Scheduler.preview(schedule, env.clock.now(), 3);
    const { workflowId } = publish(env, scheduled(schedule));
    for (let step = 0; step < 4 * 24; step++) {
      env.clock.advance(hour);
      await triggers.tick();
    }
    const fired = occurrencesOf(env, workflowId).map((row) => Date.parse(row.dedup_key));
    assert.deepEqual(fired.slice(0, 3), preview);
  } finally {
    await env.close();
  }
});
