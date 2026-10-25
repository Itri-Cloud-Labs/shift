import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ConnectionRuntime } from '../src/client-core/connection.js';
import {
  MemoryCredentialStore,
  MemoryProfileStore,
  type CredentialStore,
} from '../src/client-core/credentials.js';
import { ServerHttp, type Fetch } from '../src/client-core/http.js';
import { ClientCore, ClientFailure } from '../src/client-core/runtime.js';
import { normalizeServerUrl } from '../src/client-core/url.js';

const fixtures = JSON.parse(
  await readFile(
    new URL('../src/protocol/generated/foundation.fixture.json', import.meta.url),
    'utf8',
  ),
) as Record<string, Record<string, unknown>>;
const info = fixtures['info']!;
const pairResponse = fixtures['pairResponse']!;
const health = fixtures['health']!;
const serverId = info['serverId'] as string;
const deviceId = (pairResponse['device'] as { id: string }).id;
const token = pairResponse['token'] as string;
const phrase = 'abandon ability able about above absent absorb abstract';
const form = { url: 'https://shift.example.com/', phrase, deviceName: 'Laptop' };

// A scripted server. `pair` and `devices` decide each answer; every request is recorded.
interface Call {
  url: string;
  method: string;
  authorization?: string;
  body?: Record<string, unknown>;
}
function fakeServer(
  script: {
    info?: () => unknown;
    pair?: (
      body: Record<string, unknown>,
      attempt: number,
    ) => { status: number; body: unknown } | 'drop';
    devices?: (authorization: string | undefined) => { status: number; body: unknown };
  } = {},
) {
  const calls: Call[] = [];
  let pairs = 0;
  const json = (status: number, body: unknown) => ({
    status,
    text: async () => JSON.stringify(body),
  });
  const fetch: Fetch = async (url, init) => {
    const body =
      init.body === undefined ? undefined : (JSON.parse(init.body) as Record<string, unknown>);
    calls.push({
      url,
      method: init.method,
      ...(init.headers['authorization'] ? { authorization: init.headers['authorization'] } : {}),
      ...(body ? { body } : {}),
    });
    const path = new URL(url).pathname;
    if (path.endsWith('/api/v0/info')) return json(200, script.info?.() ?? info);
    if (path.endsWith('/api/v0/health')) return json(200, health);
    if (path.endsWith('/api/v0/pair')) {
      const answer = script.pair?.(body!, ++pairs) ?? { status: 201, body: pairResponse };
      if (answer === 'drop') throw new Error('socket hang up');
      return json(answer.status, answer.body);
    }
    if (path.endsWith('/api/v0/devices')) {
      const answer = script.devices?.(init.headers['authorization']) ?? {
        status: 200,
        body: { ...fixtures['deviceList'], currentDeviceId: deviceId },
      };
      return json(answer.status, answer.body);
    }
    return json(404, {});
  };
  return { fetch, calls };
}

let ids = 0;
function runtime(
  fetch: Fetch,
  stores: { credentials?: CredentialStore; profiles?: MemoryProfileStore } = {},
) {
  const credentials = stores.credentials ?? new MemoryCredentialStore();
  const profiles = stores.profiles ?? new MemoryProfileStore();
  const http = new ServerHttp(fetch);
  const connection = new ConnectionRuntime({
    http,
    credentials,
    profiles,
    allowLoopbackHttp: false,
    randomId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  });
  return { connection, credentials, profiles, http };
}
const error = (code: string) => ({
  schemaVersion: 1,
  requestId: '00000000-0000-4000-8000-000000000099',
  code,
  message: 'x',
  retryable: false,
  diagnostics: [],
});

test('server URLs need HTTPS, except loopback HTTP where development allows it', () => {
  const remote = { allowLoopbackHttp: false };
  assert.deepEqual(normalizeServerUrl(' https://shift.example.com/base/ ', remote), {
    url: 'https://shift.example.com/base',
  });
  for (const [input, problem] of [
    ['http://shift.example.com', 'INSECURE_URL'],
    ['http://127.0.0.1:4317', 'INSECURE_URL'],
    ['https://user:secret@shift.example.com', 'INVALID_URL'],
    ['https://shift.example.com/?token=x', 'INVALID_URL'],
    ['file:///etc/passwd', 'INVALID_URL'],
    ['not a url', 'INVALID_URL'],
  ] as const) {
    assert.deepEqual(normalizeServerUrl(input, remote), { problem }, input);
  }
  const development = { allowLoopbackHttp: true };
  assert.deepEqual(normalizeServerUrl('http://127.0.0.1:4317', development), {
    url: 'http://127.0.0.1:4317',
  });
  assert.deepEqual(normalizeServerUrl('http://localhost:4317/', development), {
    url: 'http://localhost:4317',
  });
  assert.deepEqual(normalizeServerUrl('http://10.0.0.5:4317', development), {
    problem: 'INSECURE_URL',
  });
});

test('pairing stores the token behind a handle and goes online; nothing public holds a secret', async () => {
  const server = fakeServer();
  const { connection, credentials, profiles } = runtime(server.fetch);
  const state = await connection.pair(form);
  assert.deepEqual(state, {
    status: 'online',
    profileId: state.profileId,
    problem: null,
    pairingPending: false,
  });
  const stored = await profiles.load();
  assert.equal(stored.profiles.length, 1);
  const profile = stored.profiles[0]!;
  assert.deepEqual(
    { url: profile.url, serverId: profile.serverId, deviceId: profile.deviceId },
    { url: 'https://shift.example.com', serverId, deviceId },
  );
  assert.equal(await credentials.resolve(profile.credentialHandle), token);
  const visible = JSON.stringify([state, await connection.profiles(), stored]);
  assert.doesNotMatch(visible, new RegExp(`${token}|${phrase}`));
  assert.deepEqual(
    server.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    ['GET /api/v0/info', 'POST /api/v0/pair', 'GET /api/v0/info', 'GET /api/v0/devices'],
  );
  assert.equal(server.calls[0]!.authorization, undefined, 'no token before identity is checked');
  assert.equal(server.calls.at(-1)!.authorization, `Bearer ${token}`);
});

test('a lost pairing response is recovered with the same command, and another form starts over', async () => {
  const server = fakeServer({
    pair: (_body, attempt) => (attempt === 1 ? 'drop' : { status: 201, body: pairResponse }),
  });
  const { connection, profiles } = runtime(server.fetch);
  const lost = await connection.pair(form);
  assert.deepEqual(
    { status: lost.status, problem: lost.problem, pending: lost.pairingPending },
    { status: 'pairing', problem: 'PAIRING_UNCONFIRMED', pending: true },
  );
  const recovered = await connection.pair({ ...form, phrase: phrase.toUpperCase() });
  assert.equal(recovered.status, 'online');
  const commands = server.calls.filter((call) => call.body).map((call) => call.body!['commandId']);
  assert.equal(commands.length, 2);
  assert.equal(commands[0], commands[1], 'the retry repeats the original command');
  assert.equal((await profiles.load()).profiles.length, 1);

  // A different phrase is a different pairing with a new command.
  const other = fakeServer({ pair: () => 'drop' });
  const second = runtime(other.fetch);
  await second.connection.pair(form);
  await second.connection.pair({ ...form, phrase: 'zoo zoo zoo zoo zoo zoo zoo zoo' });
  const ids = other.calls.filter((call) => call.body).map((call) => call.body!['commandId']);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(second.connection.abandonPairing().pairingPending, false);
});

test('a retry that reaches another server, a refused phrase and rate limits are told apart', async () => {
  let identity = serverId;
  const moving = fakeServer({ info: () => ({ ...info, serverId: identity }), pair: () => 'drop' });
  const first = runtime(moving.fetch);
  await first.connection.pair(form);
  identity = '00000000-0000-4000-8000-0000000000aa';
  const elsewhere = await first.connection.pair(form);
  assert.deepEqual([elsewhere.problem, elsewhere.pairingPending], ['IDENTITY_MISMATCH', false]);

  const refused = runtime(
    fakeServer({ pair: () => ({ status: 401, body: error('PAIRING_REJECTED') }) }).fetch,
  );
  const rejected = await refused.connection.pair(form);
  assert.deepEqual(
    [rejected.status, rejected.problem, rejected.pairingPending],
    ['unconfigured', 'PAIRING_REJECTED', false],
  );

  const limited = runtime(
    fakeServer({ pair: () => ({ status: 429, body: error('RATE_LIMITED') }) }).fetch,
  );
  const waiting = await limited.connection.pair(form);
  assert.deepEqual([waiting.problem, waiting.pairingPending], ['PAIRING_RATE_LIMITED', true]);

  const old = runtime(
    fakeServer({ info: () => ({ ...info, protocol: { min: 1, max: 1 } }) }).fetch,
  );
  assert.deepEqual(
    [(await old.connection.pair(form)).status, old.connection.state.problem],
    ['incompatible', 'PROTOCOL_UNSUPPORTED'],
  );
  const newer = runtime(
    fakeServer({ info: () => ({ ...info, protocol: { min: 0, max: 1 } }) }).fetch,
  );
  assert.equal(
    (await newer.connection.pair(form)).status,
    'online',
    'an overlapping range is fine',
  );
  const noPairing = runtime(
    fakeServer({
      info: () => ({
        ...info,
        capabilities: { ...(info['capabilities'] as object), pairing: false },
      }),
    }).fetch,
  );
  assert.equal((await noPairing.connection.pair(form)).problem, 'PAIRING_UNAVAILABLE');
  const insecure = runtime(fakeServer().fetch);
  assert.equal(
    (await insecure.connection.pair({ ...form, url: 'http://shift.example.com' })).problem,
    'INSECURE_URL',
  );
});

test('a saved profile reconnects after restart; a session-only credential asks to pair again', async () => {
  const server = fakeServer();
  const profiles = new MemoryProfileStore();
  const credentials = new MemoryCredentialStore();
  await runtime(server.fetch, { profiles, credentials }).connection.pair(form);
  // Same stores: the credential survived.
  const restarted = runtime(server.fetch, { profiles, credentials });
  await restarted.connection.start();
  assert.equal(restarted.connection.state.status, 'online');
  // A session-only store starts empty after a restart.
  const fresh = runtime(server.fetch, { profiles, credentials: new MemoryCredentialStore() });
  await fresh.connection.start();
  assert.deepEqual(
    [fresh.connection.state.status, fresh.connection.state.problem],
    ['unconfigured', 'CREDENTIAL_MISSING'],
  );
  assert.equal((await fresh.connection.profiles())[0]!.credential, 'missing');
  assert.equal(fresh.connection.credentialStorage, 'session');
});

test('a revoked device drops its credential, and an impostor server never sees the token', async () => {
  const profiles = new MemoryProfileStore();
  const credentials = new MemoryCredentialStore();
  await runtime(fakeServer().fetch, { profiles, credentials }).connection.pair(form);
  const handle = (await profiles.load()).profiles[0]!.credentialHandle;

  const down = runtime(
    async () => {
      throw new Error('ECONNREFUSED');
    },
    { profiles, credentials },
  );
  await down.connection.start();
  assert.equal(down.connection.state.status, 'offline');

  const impostor = fakeServer({
    info: () => ({ ...info, serverId: '00000000-0000-4000-8000-0000000000bb' }),
  });
  const tricked = runtime(impostor.fetch, { profiles, credentials });
  await tricked.connection.start();
  assert.deepEqual(
    [tricked.connection.state.status, tricked.connection.state.problem],
    ['incompatible', 'IDENTITY_MISMATCH'],
  );
  assert.ok(impostor.calls.every((call) => call.authorization === undefined));

  const revoking = fakeServer({
    devices: () => ({ status: 401, body: error('DEVICE_UNAUTHORIZED') }),
  });
  const revoked = runtime(revoking.fetch, { profiles, credentials });
  await revoked.connection.start();
  assert.deepEqual(
    [revoked.connection.state.status, revoked.connection.state.problem],
    ['revoked', 'DEVICE_REVOKED'],
  );
  assert.equal(await credentials.resolve(handle), undefined, 'a revoked token is deleted');
});

test('an address change keeps the profile only when the same server answers there', async () => {
  let identity = serverId;
  const server = fakeServer({ info: () => ({ ...info, serverId: identity }) });
  const { connection, profiles } = runtime(server.fetch);
  const { profileId } = await connection.pair(form);
  await connection.changeAddress(profileId!, 'https://new.example.com');
  assert.equal((await profiles.load()).profiles[0]!.url, 'https://new.example.com');
  assert.equal(connection.state.status, 'online');
  identity = '00000000-0000-4000-8000-0000000000cc';
  const refused = await connection.changeAddress(profileId!, 'https://other.example.com');
  assert.equal(refused.problem, 'IDENTITY_MISMATCH');
  assert.equal((await profiles.load()).profiles[0]!.url, 'https://new.example.com');
});

test('clearing a profile deletes only local data and supersedes a connection in flight', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const server = fakeServer();
  const delayed: Fetch = async (url, init) => {
    if (url.endsWith('/api/v0/devices')) await gate;
    return server.fetch(url, init);
  };
  const { connection, credentials, profiles } = runtime(delayed);
  const pairing = connection.pair(form);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const profileId = (await profiles.load()).profiles[0]!.localId;
  const handle = (await profiles.load()).profiles[0]!.credentialHandle;
  const before = server.calls.length;
  await connection.clear(profileId);
  release();
  await pairing;
  assert.deepEqual(connection.state, {
    status: 'unconfigured',
    profileId: null,
    problem: null,
    pairingPending: false,
  });
  assert.equal(await credentials.resolve(handle), undefined);
  assert.deepEqual((await profiles.load()).profiles, []);
  assert.equal(
    server.calls.length,
    before + 1,
    'only the request already in flight; nothing sent to clear',
  );
});

test('status queries use the active connection, validate answers and refuse other servers', async () => {
  let identity = serverId;
  const server = fakeServer({ info: () => ({ ...info, serverId: identity }) });
  const { connection, http } = runtime(server.fetch);
  const client = new ClientCore(connection, http, true);
  await assert.rejects(
    client.query('health'),
    (failure) => failure instanceof ClientFailure && failure.code === 'DISCONNECTED',
  );
  await connection.pair(form);
  assert.equal((await client.query('health')).serverId, serverId);
  assert.equal(server.calls.at(-1)!.authorization, `Bearer ${token}`);
  identity = '00000000-0000-4000-8000-0000000000dd';
  await assert.rejects(
    client.query('info'),
    (failure) => failure instanceof ClientFailure && failure.code === 'INVALID_RESPONSE',
  );
  assert.deepEqual(client.setSamples(false), { connection: 'unconfigured', samples: false });
});
