import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate as tick } from 'node:timers/promises';
import { ConnectionRuntime } from '../src/client-core/connection.js';
import { MemoryCredentialStore, MemoryProfileStore } from '../src/client-core/credentials.js';
import { ServerHttp, type Fetch, type FetchResponse } from '../src/client-core/http.js';
import { MemorySyncStore, cursorSequence } from '../src/client-core/projection.js';
import { SyncRuntime, type Timers } from '../src/client-core/sync.js';

const fixtures = JSON.parse(
  await readFile(
    new URL('../src/protocol/generated/foundation.fixture.json', import.meta.url),
    'utf8',
  ),
) as Record<string, Record<string, any>>;
const info = fixtures['info']!;
const serverId = info['serverId'] as string;
const deviceId = fixtures['deviceList']!['currentDeviceId'] as string;
const baseRun = fixtures['runResponse']!['run'] as Record<string, unknown>;
const baseInteraction = fixtures['interactionResponse']!['interaction'] as Record<string, unknown>;
const token = 'device-token-for-tests';
const profileId = '00000000-0000-4000-8000-0000000000a1';
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const firstEpoch = uuid(0xe1);
const secondEpoch = uuid(0xe2);
const keepaliveMs = 45_000;

// Timers that only fire when a test says so. Backoff and keepalive timers are told apart by
// their delay.
class ManualTimers implements Timers {
  readonly pending: { ms: number; callback: () => void; active: boolean }[] = [];
  // Reconnect waits fire on their own unless a test steps through them.
  constructor(public auto = true) {}
  set(callback: () => void, ms: number): () => void {
    const timer = { ms, callback, active: true };
    this.pending.push(timer);
    if (this.auto && ms < keepaliveMs)
      setImmediate(() => {
        if (!timer.active) return;
        timer.active = false;
        callback();
      });
    return () => {
      timer.active = false;
    };
  }
  active(predicate: (ms: number) => boolean) {
    return this.pending.filter((timer) => timer.active && predicate(timer.ms));
  }
  fire(predicate: (ms: number) => boolean): number {
    const due = this.active(predicate);
    for (const timer of due) {
      timer.active = false;
      timer.callback();
    }
    return due.length;
  }
}

async function until(predicate: () => boolean, message = 'condition'): Promise<void> {
  for (let index = 0; index < 2000; index++) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${message}`);
}

type Handler = (
  method: string,
  path: string,
  body: Record<string, any> | undefined,
) => FetchResponse | 'drop' | undefined | Promise<FetchResponse | 'drop' | undefined>;

// A scripted Shift server with resources, an event log, receipts and SSE streams.
class FakeServer {
  epoch = firstEpoch;
  sequence = 42;
  revoked = false;
  reachable = true;
  log: Record<string, unknown>[] = [];
  runs = new Map<string, Record<string, unknown>>();
  interactions = new Map<string, Record<string, unknown>>();
  receipts = new Map<string, { status: number; body: unknown }>();
  streams: { controller: ReadableStreamDefaultController<Uint8Array>; after: number }[] = [];
  calls: { method: string; path: string; body?: Record<string, any> }[] = [];
  // Consulted first; returning undefined falls through to the default routes.
  override: Handler | undefined;

  addRun(id: string, state = 'RUNNING', createdAt = 1_790_985_600_000) {
    this.runs.set(id, { ...baseRun, id, state, workflowId: null, createdAt, finishedAt: null });
  }
  addInteraction(id: string, runId: string) {
    this.interactions.set(id, {
      ...baseInteraction,
      id,
      runId,
      state: 'PENDING',
      revision: 0,
      settledAt: null,
      response: null,
      runState: 'WAITING',
    });
  }

  // Commits an event and sends it to every open stream.
  emit(
    type: string,
    refs: { runId?: string | null; payload?: Record<string, unknown>; schemaVersion?: number } = {},
  ) {
    const sequence = ++this.sequence;
    const event = {
      cursor: `${this.epoch}:${sequence}`,
      epoch: this.epoch,
      sequence,
      type,
      schemaVersion: refs.schemaVersion ?? 1,
      runId: refs.runId ?? null,
      executionId: null,
      sessionId: null,
      payload: refs.payload ?? {},
      createdAt: 1_790_985_700_000 + sequence,
    };
    this.log.push(event);
    for (const stream of this.streams) this.send(stream.controller, event);
    return event;
  }
  send(controller: ReadableStreamDefaultController<Uint8Array>, event: unknown) {
    const record = event as { cursor: string };
    controller.enqueue(
      new TextEncoder().encode(
        `id: ${record.cursor}\nevent: shift\ndata: ${JSON.stringify(event)}\n\n`,
      ),
    );
  }
  keepalive() {
    for (const stream of this.streams)
      stream.controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
  }
  closeStreams() {
    for (const stream of this.streams) stream.controller.close();
    this.streams = [];
  }

  #envelope(body: Record<string, unknown>) {
    return { schemaVersion: 1, requestId: uuid(0x999), ...body };
  }
  #json(status: number, body: unknown): FetchResponse {
    return { status, text: async () => JSON.stringify(body) };
  }
  #error(status: number, code: string): FetchResponse {
    return this.#json(
      status,
      this.#envelope({ code, message: 'Refused.', retryable: false, diagnostics: [] }),
    );
  }
  #cursorAfter(cursor: string | null): number | 'resync' {
    if (!cursor) return 'resync';
    const [epoch, sequence] = cursor.split(':');
    const value = Number(sequence);
    if (epoch !== this.epoch || !(value >= 0) || value > this.sequence) return 'resync';
    return value;
  }

  readonly fetch: Fetch = async (url, init) => {
    const { pathname, search } = new URL(url);
    const body =
      init.body === undefined ? undefined : (JSON.parse(init.body) as Record<string, any>);
    this.calls.push({ method: init.method, path: pathname + search, ...(body ? { body } : {}) });
    if (!this.reachable) throw new TypeError('fetch failed');
    const overridden = await this.override?.(init.method, pathname + search, body);
    if (overridden === 'drop') throw new TypeError('fetch failed');
    if (overridden) return overridden;
    const path = pathname.replace(/^\/api\/v0/, '');
    if (path === '/info') return this.#json(200, { ...info, eventEpoch: this.epoch });
    if (init.headers['authorization'] !== `Bearer ${token}` || this.revoked)
      return this.#error(401, 'DEVICE_UNAUTHORIZED');
    if (path === '/devices') return this.#json(200, fixtures['deviceList']);
    if (path === '/snapshot')
      return this.#json(
        200,
        this.#envelope({
          cursor: `${this.epoch}:${this.sequence}`,
          projects: [],
          workflows: [],
          runs: [...this.runs.values()].map(({ id, state, workflowId, createdAt, finishedAt }) => ({
            id,
            state,
            workflowId,
            createdAt,
            finishedAt,
          })),
          interactions: [...this.interactions.values()].filter((item) => item.state === 'PENDING'),
        }),
      );
    if (path === '/events') {
      const params = new URLSearchParams(search);
      const after = this.#cursorAfter(params.get('after'));
      if (after === 'resync') return this.#error(409, 'RESYNC_REQUIRED');
      const limit = Number(params.get('limit') ?? 100);
      const events = this.log.filter((event) => (event['sequence'] as number) > after);
      const page = events.slice(0, limit);
      return this.#json(
        200,
        this.#envelope({
          events: page,
          next: events.length > limit ? page[page.length - 1]!['cursor'] : null,
          highWater: `${this.epoch}:${this.sequence}`,
        }),
      );
    }
    if (path === '/events/stream') {
      const after = this.#cursorAfter(init.headers['last-event-id'] ?? null);
      if (after === 'resync') return this.#error(409, 'RESYNC_REQUIRED');
      let saved: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          saved = controller;
        },
      });
      const entry = { controller: saved!, after };
      this.streams.push(entry);
      for (const event of this.log)
        if ((event['sequence'] as number) > after) this.send(entry.controller, event);
      init.signal.addEventListener('abort', () => {
        this.streams = this.streams.filter((item) => item !== entry);
        try {
          entry.controller.error(new Error('aborted'));
        } catch {
          // Already closed.
        }
      });
      return { status: 200, text: async () => '', body: stream };
    }
    if (path === '/projects') return this.#json(200, this.#envelope({ projects: [] }));
    let match = /^\/runs\/([^/]+)$/.exec(path);
    if (match) {
      const run = this.runs.get(match[1]!);
      return run ? this.#json(200, this.#envelope({ run })) : this.#error(404, 'RUN_NOT_FOUND');
    }
    match = /^\/interactions\/([^/]+)$/.exec(path);
    if (match) {
      const interaction = this.interactions.get(match[1]!);
      return interaction
        ? this.#json(200, this.#envelope({ interaction }))
        : this.#error(404, 'INTERACTION_NOT_FOUND');
    }
    match = /^\/commands\/([^/]+)$/.exec(path);
    if (match) {
      const receipt = this.receipts.get(match[1]!);
      return receipt
        ? this.#json(
            200,
            this.#envelope({
              receipt: { commandId: match[1], ...receipt, createdAt: 1_790_985_700_000 },
            }),
          )
        : this.#error(404, 'COMMAND_NOT_FOUND');
    }
    match = /^\/interactions\/([^/]+)\/respond$/.exec(path);
    if (match && init.method === 'POST') {
      const prior = this.receipts.get(body!['commandId']);
      if (prior) return this.#json(prior.status, prior.body);
      const interaction = this.interactions.get(match[1]!);
      if (!interaction) return this.#error(404, 'INTERACTION_NOT_FOUND');
      if (interaction['state'] !== 'PENDING') return this.#error(409, 'INTERACTION_CONFLICT');
      const answered = {
        ...interaction,
        state: 'RESPONDED',
        revision: (interaction['revision'] as number) + 1,
        settledAt: 1_790_985_800_000,
        response: {
          decision: body!['decision'],
          data: {},
          actor: { kind: 'device', id: deviceId },
          createdAt: 1_790_985_800_000,
        },
      };
      this.interactions.set(match[1]!, answered);
      const response = this.#envelope({ interaction: answered });
      this.receipts.set(body!['commandId'], { status: 200, body: response });
      this.emit('interaction.responded', {
        runId: interaction['runId'] as string,
        payload: { interactionId: match[1] },
      });
      return this.#json(200, response);
    }
    return this.#error(404, 'NOT_FOUND');
  };
}

async function setup(
  options: {
    server?: FakeServer;
    store?: MemorySyncStore;
    profiles?: MemoryProfileStore;
    autoRetry?: boolean;
  } = {},
) {
  const server = options.server ?? new FakeServer();
  const profiles = options.profiles ?? new MemoryProfileStore();
  const credentials = new MemoryCredentialStore();
  await credentials.save(uuid(0xc1), token);
  if (!options.profiles)
    await profiles.save({
      activeId: profileId,
      profiles: [
        {
          localId: profileId,
          url: 'https://shift.example.com',
          serverId,
          eventEpoch: server.epoch,
          deviceId,
          deviceName: 'Laptop',
          credentialHandle: uuid(0xc1),
          pairedAt: 1,
        },
      ],
    });
  const http = new ServerHttp(server.fetch);
  const connection = new ConnectionRuntime({
    http,
    credentials,
    profiles,
    allowLoopbackHttp: false,
  });
  const store = options.store ?? new MemorySyncStore();
  const timers = new ManualTimers(options.autoRetry ?? true);
  let id = 0;
  const sync = new SyncRuntime({
    connection,
    http,
    store,
    timers,
    random: () => 1,
    randomId: () => `command-${++id}`,
    now: () => 1_790_986_000_000,
    keepaliveTimeoutMs: keepaliveMs,
    initialBackoffMs: 100,
    maxBackoffMs: 800,
  });
  sync.start();
  await connection.connect(profileId);
  return { server, connection, sync, store, timers, profiles, credentials };
}

const live = (sync: SyncRuntime) => () => sync.state.status === 'live';
const runState = (sync: SyncRuntime, id: string) =>
  sync.projection?.runs.find((run) => run.id === id)?.state;

test('a snapshot goes live, and each event refetches what it names and saves its cursor', async () => {
  const server = new FakeServer();
  server.addRun(uuid(1), 'RUNNING');
  const { sync, store } = await setup({ server });
  await until(live(sync), 'live');
  assert.equal(sync.projection?.cursor, `${firstEpoch}:42`);
  assert.equal(runState(sync, uuid(1)), 'RUNNING');
  assert.deepEqual(sync.projection?.key, { serverId, deviceId, epoch: firstEpoch });

  server.runs.get(uuid(1))!['state'] = 'COMPLETED';
  server.emit('run.completed', { runId: uuid(1) });
  await until(() => runState(sync, uuid(1)) === 'COMPLETED', 'run update');
  const saved = await store.load(profileId);
  assert.equal(saved?.projection?.cursor, `${firstEpoch}:43`);
  assert.equal(saved?.projection?.runs[0]?.state, 'COMPLETED');

  // A new run arrives; a deleted one disappears.
  server.addRun(uuid(2), 'QUEUED', 1_790_985_700_000);
  server.emit('run.created', { runId: uuid(2) });
  await until(() => runState(sync, uuid(2)) === 'QUEUED', 'new run');
  server.runs.delete(uuid(1));
  server.emit('execution.started', { runId: uuid(1) });
  await until(() => runState(sync, uuid(1)) === undefined, 'removed run');
  // Device and pairing events change nothing cached.
  const before = server.calls.length;
  server.emit('pairing.issued');
  await until(() => sync.projection?.cursor === `${firstEpoch}:46`, 'cursor');
  assert.equal(server.calls.length, before);
  sync.stop();
});

test('duplicate and out-of-order events are applied once', async () => {
  const server = new FakeServer();
  server.addRun(uuid(1));
  const { sync } = await setup({ server });
  await until(live(sync), 'live');
  const event = server.emit('execution.started', { runId: uuid(1) });
  await until(() => sync.projection?.cursor === event['cursor'], 'first');
  const fetches = () =>
    server.calls.filter((call) => call.path === `/api/v0/runs/${uuid(1)}`).length;
  const count = fetches();
  // The same event again, and an older one after it.
  const stream = server.streams[0]!.controller;
  server.send(stream, event);
  server.send(stream, server.log[0] ?? event);
  const older = { ...event, sequence: 40, cursor: `${firstEpoch}:40` };
  server.send(stream, older);
  const next = server.emit('execution.completed', { runId: uuid(1) });
  await until(() => sync.projection?.cursor === next['cursor'], 'next');
  assert.equal(fetches(), count + 1);
  assert.equal(cursorSequence(sync.projection!.cursor), 44);
  sync.stop();
});

test('a lost acknowledgement is confirmed by its receipt after reconnecting, never resent', async () => {
  const server = new FakeServer();
  server.addRun(uuid(1), 'WAITING');
  server.addInteraction(uuid(0x40), uuid(1));
  const { sync, timers } = await setup({ server, autoRetry: false });
  await until(live(sync), 'live');
  assert.equal(sync.projection?.interactions[0]?.state, 'PENDING');

  // The server applies the response, then the connection drops before the answer arrives.
  server.override = async (method, path, body) => {
    if (method !== 'POST') return undefined;
    server.override = undefined;
    const answer = await server.fetch(`https://shift.example.com${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: new AbortController().signal,
      redirect: 'error',
    });
    assert.equal(answer.status, 200);
    server.reachable = false;
    return 'drop';
  };
  const sent = await sync.send({
    method: 'POST',
    path: `/api/v0/interactions/${uuid(0x40)}/respond`,
    body: { revision: 0, decision: 'approved' },
  });
  assert.equal(sent.state, 'unknown');
  assert.equal(sent.resendable, true);
  server.closeStreams();
  await until(() => sync.state.status === 'reconnecting', 'reconnecting');
  // Reconnect attempts back off while the server is unreachable.
  await until(() => timers.active((ms) => ms < keepaliveMs).length > 0, 'backoff');
  server.reachable = true;
  const posts = server.calls.filter((call) => call.method === 'POST').length;
  timers.fire((ms) => ms < keepaliveMs);
  await until(live(sync), 'live again');
  assert.equal(sync.commands()[0]?.state, 'accepted');
  assert.equal(
    server.calls.filter((call) => call.method === 'POST').length,
    posts,
    'nothing was resent',
  );
  assert(server.calls.some((call) => call.path === '/api/v0/commands/command-1'));
  // The accepted response replaces the pending form.
  await until(() => sync.projection?.interactions[0]?.state === 'RESPONDED', 'responded');
  sync.stop();
});

test('a command that never arrived is reported as not applied and resent with the same ID', async () => {
  const server = new FakeServer();
  server.addRun(uuid(1), 'WAITING');
  server.addInteraction(uuid(0x40), uuid(1));
  const { sync } = await setup({ server });
  await until(live(sync), 'live');
  server.override = (method) => (method === 'POST' ? 'drop' : undefined);
  const sent = await sync.send({
    method: 'POST',
    path: `/api/v0/interactions/${uuid(0x40)}/respond`,
    body: { revision: 0, decision: 'rejected' },
  });
  // The connection still works, so the receipt check settles it at once: nothing arrived.
  assert.deepEqual([sent.state, sent.resendable], ['not_applied', true]);
  server.override = undefined;
  const again = await sync.resend('command-1');
  assert.equal(again.state, 'accepted');
  const posts = server.calls.filter((call) => call.method === 'POST');
  assert.deepEqual(
    posts.map((call) => call.body!['commandId']),
    ['command-1', 'command-1'],
  );
  // Another device's decision wins over a stale form: a conflict is a rejection, not a retry.
  server.addInteraction(uuid(0x41), uuid(1));
  server.interactions.get(uuid(0x41))!['state'] = 'RESPONDED';
  const late = await sync.send({
    method: 'POST',
    path: `/api/v0/interactions/${uuid(0x41)}/respond`,
    body: { revision: 0, decision: 'approved' },
  });
  assert.deepEqual(
    [late.state, late.code, late.resendable],
    ['rejected', 'INTERACTION_CONFLICT', false],
  );
  sync.stop();
  await assert.rejects(sync.send({ method: 'POST', path: '/api/v0/runs', body: {} }), {
    code: 'NOT_LIVE',
  });
});

test('a new epoch or a refused cursor takes a fresh snapshot', async () => {
  const server = new FakeServer();
  server.addRun(uuid(1));
  const { sync, profiles } = await setup({ server });
  await until(live(sync), 'live');
  const snapshots = () => server.calls.filter((call) => call.path === '/api/v0/snapshot').length;
  assert.equal(snapshots(), 1);

  // The database was restored: a new epoch with different contents.
  server.epoch = secondEpoch;
  server.sequence = 7;
  server.log = [];
  server.runs.clear();
  server.addRun(uuid(9));
  server.closeStreams();
  await until(() => sync.projection?.key.epoch === secondEpoch && live(sync)(), 'new epoch');
  assert.equal(snapshots(), 2);
  assert.deepEqual(
    sync.projection?.runs.map((run) => run.id),
    [uuid(9)],
  );
  assert.equal((await profiles.load()).profiles[0]?.eventEpoch, secondEpoch);

  // The server refuses the cursor (for example, its history is behind it).
  server.sequence = 3;
  server.closeStreams();
  await until(() => snapshots() === 3 && live(sync)(), 'resync');
  assert.equal(sync.projection?.cursor, `${secondEpoch}:3`);
  sync.stop();
});

test('an unknown event type or version is not guessed at: the client resynchronizes', async () => {
  const server = new FakeServer();
  const { sync } = await setup({ server });
  await until(live(sync), 'live');
  // A new type in a known family is just as unknown.
  server.emit('run.future_change', { runId: uuid(1) });
  await until(
    () =>
      server.calls.filter((call) => call.path === '/api/v0/snapshot').length === 2 && live(sync)(),
    'resnapshot',
  );
  server.emit('run.created', { runId: uuid(1), schemaVersion: 2 });
  await until(
    () =>
      server.calls.filter((call) => call.path === '/api/v0/snapshot').length === 3 && live(sync)(),
    'version resnapshot',
  );
  sync.stop();
});

test('a slow, older query cannot overwrite a newer answer', async () => {
  const server = new FakeServer();
  server.addRun(uuid(1), 'RUNNING');
  const { sync } = await setup({ server });
  await until(live(sync), 'live');
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  server.override = async (_method, path) => {
    if (path !== `/api/v0/runs/${uuid(1)}` || !first) return undefined;
    first = false;
    // Answers with the state as it was when asked, but only later.
    const stale = { ...server.runs.get(uuid(1))! };
    await held;
    return {
      status: 200,
      text: async () => JSON.stringify({ schemaVersion: 1, requestId: uuid(0x999), run: stale }),
    };
  };
  const refreshing = sync.refresh({ kind: 'run', id: uuid(1) });
  await until(() => !first, 'held');
  server.runs.get(uuid(1))!['state'] = 'COMPLETED';
  server.emit('run.completed', { runId: uuid(1) });
  await until(() => runState(sync, uuid(1)) === 'COMPLETED', 'newer state');
  release();
  assert.equal(await refreshing, true);
  assert.equal(runState(sync, uuid(1)), 'COMPLETED');
  sync.stop();
});

test('a replaced connection cannot write its late answers', async () => {
  const server = new FakeServer();
  server.addRun(uuid(1), 'RUNNING');
  const { sync, connection, store } = await setup({ server });
  await until(live(sync), 'live');
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let asked = false;
  server.override = async (_method, path) => {
    if (path !== `/api/v0/runs/${uuid(1)}`) return undefined;
    asked = true;
    await held;
    return undefined;
  };
  server.runs.get(uuid(1))!['state'] = 'FAILED';
  server.emit('run.failed', { runId: uuid(1) });
  await until(() => asked, 'fetch started');
  connection.disconnect();
  release();
  await until(() => sync.state.status === 'stopped', 'stopped');
  for (let index = 0; index < 50; index++) await tick();
  assert.equal(runState(sync, uuid(1)), 'RUNNING');
  assert.equal((await store.load(profileId))?.projection?.cursor, `${firstEpoch}:42`);
  assert.equal(server.streams.length, 0);
});

test('a quiet stream is abandoned after the keepalive timeout; keepalives hold it open', async () => {
  const server = new FakeServer();
  const { sync, timers } = await setup({ server });
  await until(live(sync), 'live');
  const opened = () => server.calls.filter((call) => call.path === '/api/v0/events/stream').length;
  // Traffic re-arms the timer, so only the newest one is active.
  server.keepalive();
  await until(() => timers.pending.length >= 2, 'rearmed');
  assert.equal(timers.active((ms) => ms === keepaliveMs).length, 1);
  assert.equal(opened(), 1);
  timers.fire((ms) => ms === keepaliveMs);
  await until(() => opened() === 2 && live(sync)(), 'reconnected');
  // Reconnecting after a dead stream resumes from the saved cursor, without a snapshot.
  assert.equal(server.calls.filter((call) => call.path === '/api/v0/snapshot').length, 1);
  sync.stop();
});

test('reconnect backoff doubles up to its cap and resets once live', async () => {
  const server = new FakeServer();
  const { sync, timers } = await setup({ server, autoRetry: false });
  await until(live(sync), 'live');
  server.reachable = false;
  server.closeStreams();
  const delays: number[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    await until(() => timers.active((ms) => ms < keepaliveMs).length === 1, `backoff ${attempt}`);
    delays.push(timers.active((ms) => ms < keepaliveMs)[0]!.ms);
    timers.fire((ms) => ms < keepaliveMs);
  }
  assert.deepEqual(delays, [100, 200, 400, 800, 800, 800]);
  assert.equal(sync.state.problem, 'UNREACHABLE');
  // The sixth wait is over; the server answers the reconnect it started.
  server.reachable = true;
  await until(live(sync), 'live');
  // A stream that opens and drops without traffic does not reset the backoff.
  server.closeStreams();
  await until(() => timers.active((ms) => ms < keepaliveMs).length === 1, 'still backing off');
  assert.equal(timers.active((ms) => ms < keepaliveMs)[0]!.ms, 800);
  timers.fire((ms) => ms < keepaliveMs);
  await until(live(sync), 'live again');
  // After traffic, the first retry starts at the shortest delay again.
  const armed = () => timers.pending.filter((timer) => timer.ms === keepaliveMs).length;
  const before = armed();
  server.keepalive();
  // The keepalive timer is re-armed once the chunk has been read.
  await until(() => armed() > before, 'traffic');
  server.closeStreams();
  server.reachable = false;
  await until(() => timers.active((ms) => ms < keepaliveMs).length === 1, 'reset backoff');
  assert.equal(timers.active((ms) => ms < keepaliveMs)[0]!.ms, 100);
  sync.stop();
});

test('revocation stops synchronizing and deletes the cached state', async () => {
  const server = new FakeServer();
  server.addRun(uuid(1));
  const { sync, connection, store, credentials } = await setup({ server });
  await until(live(sync), 'live');
  assert(await store.load(profileId));
  server.revoked = true;
  server.closeStreams();
  await until(() => connection.state.status === 'revoked', 'revoked');
  await until(() => sync.state.status === 'stopped', 'stopped');
  await until(() => sync.projection === null, 'cache dropped');
  assert.equal(await store.load(profileId), undefined);
  assert.equal(await credentials.resolve(uuid(0xc1)), undefined);
  // Nothing keeps retrying.
  const calls = server.calls.length;
  for (let index = 0; index < 50; index++) await tick();
  assert.equal(server.calls.length, calls);
});

test('a restart resumes from the saved cursor and catches up page by page', async () => {
  const server = new FakeServer();
  server.addRun(uuid(1), 'RUNNING');
  const store = new MemorySyncStore();
  const first = await setup({ server, store });
  await until(live(first.sync), 'live');
  first.sync.stop();
  first.connection.disconnect();
  // While the app is closed, many things happen.
  for (let index = 0; index < 1200; index++) server.emit('execution.started', { runId: uuid(1) });
  server.runs.get(uuid(1))!['state'] = 'COMPLETED';
  server.emit('run.completed', { runId: uuid(1) });
  server.calls = [];
  const second = await setup({ server, store, profiles: first.profiles });
  // The cached state is visible before the connection is live.
  assert.equal(runState(second.sync, uuid(1)) ?? 'RUNNING', 'RUNNING');
  await until(live(second.sync), 'live');
  assert.equal(runState(second.sync, uuid(1)), 'COMPLETED');
  assert.equal(second.sync.projection?.cursor, `${firstEpoch}:${server.sequence}`);
  assert(!server.calls.some((call) => call.path === '/api/v0/snapshot'));
  assert.equal(server.calls.filter((call) => call.path.startsWith('/api/v0/events?')).length, 3);
  second.sync.stop();
});
