import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ClientCore, ClientFailure } from '../src/client-core/runtime.js';
import { parseResponse } from '../src/shared/contracts.js';
const fixtures = JSON.parse(
  await readFile(
    new URL('../src/protocol/generated/foundation.fixture.json', import.meta.url),
    'utf8',
  ),
) as { info: Record<string, unknown>; health: Record<string, unknown> };
const serverId = fixtures.info.serverId as string;
const privateProfile = { serverId, credentialHandle: 'os-private-handle' };

test('client-core validates fake transport independently of Electron and keeps credentials private', async () => {
  const calls: string[] = [];
  const client = new ClientCore(
    {
      query: async (operation, context) => {
        calls.push(operation);
        assert.equal(context.bearer, 'secret-token');
        assert.ok(context.signal instanceof AbortSignal);
        return operation === 'info'
          ? structuredClone(fixtures.info)
          : structuredClone(fixtures.health);
      },
    },
    {
      resolve: async (handle) => {
        assert.equal(handle, 'os-private-handle');
        return 'secret-token';
      },
    },
    privateProfile,
    true,
  );
  for (const operation of ['info', 'health', 'ready'] as const) {
    const value = await client.query(operation);
    assert.equal(value.serverId, serverId);
    assert.doesNotMatch(JSON.stringify(value), /secret-token|os-private-handle/);
  }
  assert.deepEqual(calls, ['info', 'health', 'ready']);
  assert.ok(parseResponse({ kind: 'shell', state: client.shell() }));
  const shell = client.shell();
  shell.samples = false;
  assert.equal(client.shell().samples, true);
  assert.deepEqual(client.setSamples(false), { connection: 'unconfigured', samples: false });
});

test('invalid, oversized, secret-bearing and wrong-identity server responses are rejected', async () => {
  for (const value of [
    { ...fixtures.info, bearer: 'secret' },
    { ...fixtures.info, serverId: '00000000-0000-4000-8000-000000000009' },
    { ...fixtures.info, serverVersion: 'x'.repeat(10000) },
    { arbitrary: 'data' },
    fixtures.health,
  ]) {
    const client = new ClientCore(
      { query: async () => value },
      { resolve: async () => 'secret-token' },
      privateProfile,
    );
    await assert.rejects(
      client.query('info'),
      (error: unknown) => error instanceof ClientFailure && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('disconnect invalidates delayed credential and transport responses', async () => {
  let resolve: (value: unknown) => void = () => assert.fail();
  let signal: AbortSignal | undefined;
  const client = new ClientCore(
    {
      query: (_operation, context) => {
        signal = context.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    },
    { resolve: async () => 'secret-token' },
    privateProfile,
  );
  const pending = client.query('info');
  await new Promise((done) => setImmediate(done));
  client.disconnect();
  resolve(fixtures.info);
  assert.equal(signal?.aborted, true);
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof ClientFailure && error.code === 'DISCONNECTED',
  );
  let resolveCredential: (token: string) => void = () => assert.fail();
  const credentialClient = new ClientCore(
    { query: async () => assert.fail('Old credential initiated a request') },
    {
      resolve: () =>
        new Promise((done) => {
          resolveCredential = done;
        }),
    },
    privateProfile,
  );
  const credentialPending = credentialClient.query('info');
  credentialClient.disconnect();
  resolveCredential('old-secret');
  await assert.rejects(credentialPending, ClientFailure);
});

test('missing credentials and transport failures expose no private errors', async () => {
  for (const credentials of [
    { resolve: async () => undefined },
    { resolve: async () => 'secret' },
  ]) {
    const client = new ClientCore(
      {
        query: async () => {
          throw new Error('secret token /private/path');
        },
      },
      credentials,
      privateProfile,
    );
    await assert.rejects(
      client.query('health'),
      (error) =>
        error instanceof ClientFailure &&
        error.message === 'Connect to a server before querying it.',
    );
  }
});
