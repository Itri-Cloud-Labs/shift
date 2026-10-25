import type { Response } from 'express';
import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from 'pino';
import { validateEvent } from '../protocol/index.js';
import type { EventLog } from './log.js';

// Server-sent event streams (specification 13.3). Each stream runs one ordered loop that replays
// from its cursor and then tails committed rows, so there is no handoff between replay and live
// delivery. A stream never holds back the engine: if a client reads too slowly and its pending
// output passes the bound, the stream is closed and the client reconnects from its cursor.

export interface StreamOptions {
  keepaliveMs: number;
  pollMs: number;
  maxPendingBytes: number;
  batch: number;
}

const defaults: StreamOptions = {
  keepaliveMs: 15_000,
  pollMs: 200,
  maxPendingBytes: 8 * 1024 * 1024,
  batch: 500,
};

interface Open {
  deviceId: string | null;
  close(reason: string): void;
}

export class EventStreams {
  readonly #open = new Set<Open>();
  readonly #options: StreamOptions;

  constructor(
    private readonly log: EventLog,
    private readonly logger: Logger,
    options: Partial<StreamOptions> = {},
  ) {
    this.#options = { ...defaults, ...options };
  }

  get size(): number {
    return this.#open.size;
  }

  // Starts streaming after `after`. The cursor was validated before the response began.
  open(res: Response, after: number, deviceId: string | null): void {
    const { keepaliveMs, pollMs, maxPendingBytes, batch } = this.#options;
    const controller = new AbortController();
    const stream: Open = {
      deviceId,
      close: (reason) => {
        if (controller.signal.aborted) return;
        controller.abort();
        this.#open.delete(stream);
        this.logger.debug({ event: 'events.stream_closed', reason }, 'Event stream closed.');
        res.end();
      },
    };
    this.#open.add(stream);
    res.on('close', () => stream.close('client'));
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Asks buffering proxies such as nginx to pass each record through at once.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`retry: 3000\n\n`);
    void (async () => {
      let cursor = after;
      let lastWrite = Date.now();
      while (!controller.signal.aborted) {
        const events = this.log.after(cursor, batch);
        for (const event of events) {
          if (!validateEvent(event)) {
            this.logger.error(
              { sequence: event.sequence },
              'An event does not match the protocol.',
            );
            stream.close('invalid');
            return;
          }
          res.write(`id: ${event.cursor}\nevent: shift\ndata: ${JSON.stringify(event)}\n\n`);
          cursor = event.sequence;
          lastWrite = Date.now();
        }
        if (res.writableLength > maxPendingBytes) {
          stream.close('slow');
          return;
        }
        if (events.length === batch) continue;
        if (Date.now() - lastWrite >= keepaliveMs) {
          res.write(': keepalive\n\n');
          lastWrite = Date.now();
        }
        await delay(pollMs, undefined, { signal: controller.signal }).catch(() => undefined);
      }
    })().catch(() => stream.close('error'));
  }

  // A revoked device loses its streams at once.
  closeDevice(deviceId: string): void {
    for (const stream of [...this.#open]) if (stream.deviceId === deviceId) stream.close('revoked');
  }

  closeAll(): void {
    for (const stream of [...this.#open]) stream.close('stopping');
  }
}
