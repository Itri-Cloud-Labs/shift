import { CronExpressionParser } from 'cron-parser';
import { ShiftError } from '../domain/errors.js';

// Shift's schedule policy (server specification 12.2). cron-parser parses the five fields; Shift
// matches them itself, because the parser's own iteration moves a wall-clock time that does not
// exist on a spring-forward day to the next hour, gives up on zones whose clocks move by thirty
// minutes, and is too slow to count a long downtime (implementation decisions, prompt 25).
//
// Each matching local wall-clock time maps to its first UTC instant: a time that does not exist
// that day (spring forward) has none and is skipped, and a time that happens twice (fall back)
// fires once, at the earlier instant. Intervals are UTC durations from an anchor minute.

export type ScheduleConfig =
  { kind: 'cron'; expression: string; timezone: string } | { kind: 'interval'; minutes: number };

const minute = 60_000;
const day = 24 * 60 * minute;
// How far to look for the next instant: long enough for 29 February on a given weekday.
const searchDays = 366 * 30;

const value = '(?:\\d{1,2}|[A-Za-z]{3})';
const item = `(?:\\*|${value}(?:-${value})?)(?:/\\d{1,2})?`;
const fieldPattern = new RegExp(`^${item}(?:,${item})*$`);

interface Fields {
  minutes: number[];
  hours: number[];
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  // Both restricted: a day matches either, as in Vixie cron.
  either: boolean;
}

function parseCron(expression: string): Fields | string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5)
    return 'A cron expression has five fields: minute, hour, day of month, month and day of week.';
  if (parts.some((part) => !fieldPattern.test(part)))
    return 'Cron fields use numbers, three-letter names, *, ranges, lists and steps only.';
  try {
    const fields = CronExpressionParser.parse(parts.join(' '), { strict: false }).fields;
    const numbers = (values: readonly unknown[]) =>
      values.filter((entry): entry is number => typeof entry === 'number');
    return {
      minutes: numbers(fields.minute.values).sort((a, b) => a - b),
      hours: numbers(fields.hour.values).sort((a, b) => a - b),
      days: new Set(numbers(fields.dayOfMonth.values)),
      months: new Set(numbers(fields.month.values)),
      weekdays: new Set(numbers(fields.dayOfWeek.values).map((entry) => entry % 7)),
      either: !fields.dayOfMonth.isWildcard && !fields.dayOfWeek.isWildcard,
    };
  } catch (error) {
    return `Invalid cron expression: ${(error as Error).message}`;
  }
}

// A named IANA zone, as the platform's time zone database knows it. Offsets such as `+02:00`
// and abbreviations such as `EST` are refused: they do not follow a place's rules.
export function checkTimezone(timezone: string): string | null {
  if (timezone !== 'UTC' && !/^[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z0-9_+-]+)+$/.test(timezone))
    return 'Use a named time zone such as Europe/Berlin, or UTC.';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return null;
  } catch {
    return `Unknown time zone ${timezone}.`;
  }
}

export function checkSchedule(config: ScheduleConfig): string | null {
  if (config.kind === 'interval') return null;
  const parsed = parseCron(config.expression);
  return typeof parsed === 'string' ? parsed : checkTimezone(config.timezone);
}

const formats = new Map<string, Intl.DateTimeFormat>();

// The zone's offset at an instant, in milliseconds, at minute precision.
function offsetAt(at: number, timezone: string): number {
  let format = formats.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formats.set(timezone, format);
  }
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(new Date(at))) parts[part.type] = Number(part.value);
  const local = Date.UTC(
    parts['year']!,
    parts['month']! - 1,
    parts['day'],
    parts['hour'],
    parts['minute'],
  );
  return local - Math.floor(at / minute) * minute;
}

export class Schedule {
  readonly #config: ScheduleConfig;
  readonly #fields: Fields | null;
  // Interval instants are whole multiples of the interval after this UTC minute.
  readonly #anchor: number;

  constructor(config: ScheduleConfig, anchor: number) {
    const problem = checkSchedule(config);
    if (problem) throw new ShiftError('INVALID_SCHEDULE', problem, 422);
    this.#config = config;
    this.#anchor = Math.floor(anchor / minute) * minute;
    this.#fields = config.kind === 'cron' ? (parseCron(config.expression) as Fields) : null;
  }

  // Matching instants strictly after `after`, in order.
  *instants(after: number): Generator<number> {
    if (this.#config.kind === 'interval') {
      const step = this.#config.minutes * minute;
      let at = this.#anchor + (Math.floor((after - this.#anchor) / step) + 1) * step;
      for (;;) {
        yield at;
        at += step;
      }
    }
    const timezone = this.#config.timezone;
    const fields = this.#fields!;
    // Start a day early: the local date of `after` can be ahead of its UTC date.
    const start = new Date(after + offsetAt(after, timezone) - day);
    for (let index = 0; index < searchDays; index++) {
      const date = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index),
      );
      const [month, dayOfMonth] = [date.getUTCMonth() + 1, date.getUTCDate()];
      if (!fields.months.has(month)) continue;
      const byDay = fields.days.has(dayOfMonth);
      const byWeekday = fields.weekdays.has(date.getUTCDay());
      if (fields.either ? !(byDay || byWeekday) : !(byDay && byWeekday)) continue;
      const midnight = date.getTime();
      // The offsets either side of this local day; equal ones mean no change of clocks today.
      const before = offsetAt(midnight - day, timezone);
      const later = offsetAt(midnight + 2 * day, timezone);
      for (const hour of fields.hours)
        for (const minuteOfHour of fields.minutes) {
          const wall = midnight + hour * 60 * minute + minuteOfHour * minute;
          let at: number | null = wall - before;
          if (before !== later) {
            // The earliest instant whose local time is this wall time, if any.
            const valid = [wall - before, wall - later]
              .filter((candidate) => candidate + offsetAt(candidate, timezone) === wall)
              .sort((a, b) => a - b);
            at = valid[0] ?? null;
          }
          if (at !== null && at > after) yield at;
        }
    }
  }

  // The first instant strictly after `after`, or null if none comes within thirty years.
  next(after: number): number | null {
    const result = this.instants(after).next();
    return result.done ? null : result.value;
  }

  // Instants in (after, until], counting up to `limit` and keeping the `keep` newest.
  between(
    after: number,
    until: number,
    keep: number,
    limit = 1_000_000,
  ): { count: number; capped: boolean; first: number | null; kept: number[] } {
    const kept: number[] = [];
    let count = 0;
    let first: number | null = null;
    for (const at of this.instants(after)) {
      if (at > until) break;
      if (count === limit) return { count, capped: true, first, kept };
      count++;
      first ??= at;
      kept.push(at);
      if (kept.length > keep) kept.shift();
    }
    return { count, capped: false, first, kept };
  }

  preview(after: number, count: number): number[] {
    const instants: number[] = [];
    for (const at of this.instants(after)) {
      if (instants.length === count) break;
      instants.push(at);
    }
    return instants;
  }
}
