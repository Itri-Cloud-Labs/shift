import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Response } from 'express';
import { administrativeCall } from '../src/admin-client.js';
import { EventLog } from '../src/events/log.js';
import { EventStreams } from '../src/events/streams.js';
import { createLogger } from '../src/logging.js';
import { openStore } from '../src/persistence/store.js';
import {
  validateEvent,
  validateEventPage,
  validateProtocolError,
  validateSnapshot,
} from '../src/protocol/index.js';
import { FakeClock, runCli, startChild, temporaryState } from './helpers.js';

const otherEpoch = '00000000-0000-4000-8000-0000000000ff';

async function logFor() {
  const state = await temporaryState();
  const store = await openStore({ stateDirectory: state.path, clock: new FakeClock() });
  const insert = store.db.prepare(
    "INSERT INTO events (type, schema_version, payload_json, created_at) VALUES ('test.event', 1, ?, 0)",
  );
  const add = (count: number, payload = '{}') => {
    for (let index = 0; index < count; index++) insert.run(payload);
  };
  return {
    store,
    add,
    log: new EventLog(store.db, store.identity.eventEpoch),
    async close() {
      store.close();
      await state.remove();
    },
  };
}

test('cursors belong to one history, and anything else asks for a new snapshot', async () => {
  const harness = await logFor();
  try {
    const { log } = harness;
    const start = log.highWater();
    harness.add(5);
    assert.equal(log.parse(log.cursor(start + 2)), start + 2);
    for (const cursor of [
      undefined,
      '',
      'nonsense',
      `${log.epoch}:01`,
      `${otherEpoch}:${start + 1}`,
      log.cursor(start + 6),
    ]) {
      assert.throws(
        () => log.parse(cursor),
        { code: 'RESYNC_REQUIRED', status: 409 },
        String(cursor),
      );
    }
    const first = log.page(start, 3);
    assert.deepEqual(
      first.events.map((event) => event.sequence),
      [start + 1, start + 2, start + 3],
    );
    assert.equal(first.next, log.cursor(start + 3));
    assert.equal(first.highWater, log.cursor(start + 5));
    const rest = log.page(log.parse(first.next), 3);
    assert.deepEqual(
      rest.events.map((event) => event.sequence),
      [start + 4, start + 5],
    );
    assert.equal(rest.next, null);
    for (const event of [...first.events, ...rest.events]) assert(validateEvent(event));
    const snapshot = log.snapshot(() => ({ value: 1 }));
    assert.deepEqual(snapshot, { value: 1, cursor: log.cursor(start + 5) });
  } finally {
    await harness.close();
  }
});

// A response whose client reads nothing: everything written stays pending.
class StalledResponse extends EventEmitter {
  writableLength = 0;
  ended = false;
  status() {
    return this;
  }
  set() {
    return this;
  }
  flushHeaders() {}
  write(chunk: string) {
    this.writableLength += Buffer.byteLength(chunk);
    return false;
  }
  end() {
    this.ended = true;
  }
}

test('a stream whose client stops reading is closed instead of buffering without bound', async () => {
  const harness = await logFor();
  try {
    harness.add(50, JSON.stringify({ filler: 'x'.repeat(200) }));
    const streams = new EventStreams(harness.log, createLogger('silent'), {
      maxPendingBytes: 4096,
      pollMs: 10,
      batch: 10,
    });
    const stalled = new StalledResponse();
    streams.open(stalled as unknown as Response, 0, null);
    await until(() => stalled.ended);
    assert.equal(streams.size, 0);
    assert.ok(stalled.writableLength < 4096 + 10 * 400, 'it stopped soon after the bound');
  } finally {
    await harness.close();
  }
});

// Reads SSE records from a fetch body: `id`/`data` events and `:` comments.
function sse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const records: Array<{ id?: string; data?: string; comment?: string }> = [];
  let buffer = '';
  let done = false;
  void (async () => {
    for (;;) {
      const chunk = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const record: { id?: string; data?: string; comment?: string } = {};
        for (const line of block.split('\n')) {
          if (line.startsWith(':')) record.comment = line.slice(1).trim();
          else if (line.startsWith('id: ')) record.id = line.slice(4);
          else if (line.startsWith('data: ')) record.data = line.slice(6);
        }
        records.push(record);
      }
    }
    done = true;
  })();
  return {
    records,
    events: () =>
      records.flatMap((record) =>
        record.data
          ? [JSON.parse(record.data) as { sequence: number; cursor: string; type: string }]
          : [],
      ),
    closed: () => done,
    cancel: () => reader.cancel().catch(() => undefined),
  };
}

const until = async (check: () => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out.');
    await delay(20);
  }
};

test('a device snapshots, then streams every later event in order across a reconnect', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const server = await startChild(state.path, ['--event-keepalive-ms', '200']);
  t.after(() => server.terminate());
  const issued = await runCli(['device', 'pair', '--state-dir', state.path]);
  const { phrase } = JSON.parse(issued.output) as { phrase: string };
  const { token, device } = (await (
    await fetch(`${server.url}/api/v0/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phrase, deviceName: 'laptop', commandId: 'pair-laptop' }),
    })
  ).json()) as { token: string; device: { id: string } };
  const authorization = { authorization: `Bearer ${token}` };
  const stream = (cursor?: string, signal?: AbortSignal) =>
    fetch(`${server.url}/api/v0/events/stream`, {
      headers: { ...authorization, ...(cursor === undefined ? {} : { 'last-event-id': cursor }) },
      ...(signal ? { signal } : {}),
    });

  // Cursors that cannot be continued are refused before any stream opens.
  const info = (await (await fetch(`${server.url}/api/v0/info`)).json()) as {
    eventEpoch: string;
    capabilities: { events: boolean };
  };
  assert.equal(info.capabilities.events, true);
  for (const cursor of [undefined, `${otherEpoch}:1`, `${info.eventEpoch}:999999`]) {
    const refused = await stream(cursor);
    assert.equal(refused.status, 409);
    const error: unknown = await refused.json();
    assert(validateProtocolError(error));
    assert.equal(error.code, 'RESYNC_REQUIRED');
  }

  // Changes made around the snapshot are all delivered exactly once after its cursor. Each issued
  // phrase writes one durable event.
  const write = () =>
    administrativeCall(state.path, { method: 'POST', path: '/api/v0/admin/pairing' });
  const writing = (async () => {
    for (let index = 0; index < 20; index++) await write();
  })();
  const snapshot: unknown = await (
    await fetch(`${server.url}/api/v0/snapshot`, { headers: authorization })
  ).json();
  assert(validateSnapshot(snapshot));
  const live = await stream(snapshot.cursor);
  assert.equal(live.status, 200);
  assert.match(live.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.equal(live.headers.get('x-accel-buffering'), 'no');
  assert.equal(live.headers.get('cache-control'), 'no-store, no-transform');
  const reader = sse(live.body!);
  await writing;
  assert.equal((await write()).status, 201, 'one more after the stream is open');
  const page: unknown = (
    await administrativeCall(state.path, { method: 'GET', path: '/api/v0/admin/events?limit=1000' })
  ).payload;
  assert(validateEventPage(page));
  const highWater = Number(page.highWater.split(':')[1]);
  const after = Number(snapshot.cursor.split(':')[1]);
  await until(() => reader.events().at(-1)?.sequence === highWater);
  const delivered = reader.events().map((event) => event.sequence);
  assert.ok(delivered.length >= 21, 'the writes raced the snapshot and the stream');
  assert.deepEqual(
    delivered,
    Array.from({ length: highWater - after }, (_, index) => after + 1 + index),
    'every event after the snapshot, once, in order',
  );
  for (const record of reader.records.filter((entry) => entry.data)) {
    const event: unknown = JSON.parse(record.data!);
    assert(validateEvent(event));
    assert.equal(record.id, event.cursor);
  }
  // An idle stream sends keepalive comments.
  await until(() => reader.records.some((record) => record.comment === 'keepalive'));

  // Reconnecting from a cursor in the middle replays only what came after it.
  await reader.cancel();
  const middle = reader.events()[Math.floor(delivered.length / 2)]!;
  const again = sse((await stream(middle.cursor)).body!);
  await until(() => again.events().at(-1)?.sequence === highWater);
  assert.deepEqual(
    again.events().map((event) => event.sequence),
    delivered.filter((sequence) => sequence > middle.sequence),
  );

  // Revoking the device closes its stream.
  const revoked = await runCli(['device', 'revoke', device.id, '--state-dir', state.path]);
  assert.equal(revoked.code, 0, revoked.errors);
  await until(() => again.closed());
  assert.equal((await stream(middle.cursor)).status, 401);
  assert(!server.output().includes(token));
});

test('through a proxy with an idle timeout, events arrive at once and keepalives hold the stream', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const server = await startChild(state.path, ['--event-keepalive-ms', '200']);
  t.after(() => server.terminate());
  const issued = await runCli(['device', 'pair', '--state-dir', state.path]);
  const { phrase } = JSON.parse(issued.output) as { phrase: string };
  const { token } = (await (
    await fetch(`${server.url}/api/v0/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phrase, deviceName: 'laptop', commandId: 'pair-laptop' }),
    })
  ).json()) as { token: string };

  // A streaming reverse proxy that drops a connection after one second without traffic, like a
  // typical proxy idle timeout.
  const { createServer, request } = await import('node:http');
  const upstream = new URL(server.url);
  const proxy = createServer((incoming, outgoing) => {
    const forward = request(
      {
        host: upstream.hostname,
        port: upstream.port,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    incoming.pipe(forward);
  });
  proxy.on('connection', (socket) => socket.setTimeout(1000, () => socket.destroy()));
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => proxy.close(() => resolve())));
  const address = proxy.address() as { port: number };
  const via = `http://127.0.0.1:${address.port}`;
  const authorization = { authorization: `Bearer ${token}` };
  const snapshot = (await (
    await fetch(`${via}/api/v0/snapshot`, { headers: authorization })
  ).json()) as {
    cursor: string;
  };
  const response = await fetch(`${via}/api/v0/events/stream`, {
    headers: { ...authorization, 'last-event-id': snapshot.cursor },
  });
  assert.equal(response.status, 200);
  const reader = sse(response.body!);
  t.after(() => reader.cancel());
  // Held open well past the proxy's idle timeout by keepalives alone.
  await delay(2500);
  assert.equal(reader.closed(), false);
  assert.ok(reader.records.filter((record) => record.comment === 'keepalive').length >= 5);
  // A new event comes through without waiting for more output to fill a buffer.
  const sent = Date.now();
  await administrativeCall(state.path, { method: 'POST', path: '/api/v0/admin/pairing' });
  await until(() =>
    reader
      .events()
      .some(
        (event) =>
          event.type === 'pairing.issued' && event.sequence > Number(snapshot.cursor.split(':')[1]),
      ),
  );
  assert.ok(Date.now() - sent < 1500, 'delivered promptly');
});
