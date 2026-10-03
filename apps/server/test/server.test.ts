import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stat, symlink, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { cli, startChild, runCli, temporaryState, ownedProcess, eventually } from './helpers.js';
import {
  validateServerInfo,
  validateServerHealth,
  validateProtocolError,
  validateShutdownAcknowledgement,
} from '../src/protocol/index.js';

test('headless CLI preserves identity, rejects a second owner and recovers a crash-left administrative socket', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const first = await startChild(state.path);
  t.after(() => first.terminate());
  const response = await fetch(`${first.url}/api/v0/info`);
  const info: unknown = await response.json();
  assert(validateServerInfo(info));
  assert.equal(info.readiness.ready, true);
  assert.deepEqual(info.capabilities, {
    commands: false,
    events: false,
    pairing: false,
    nodeTypes: [],
    harnesses: [],
  });
  assert.equal(response.headers.get('x-request-id'), info.requestId);
  const health: unknown = await (await fetch(`${first.url}/api/v0/health`)).json();
  assert(validateServerHealth(health));
  assert.equal(health.serverId, info.serverId);
  assert.deepEqual(health.protocol, { min: 0, max: 0 });
  const adminPath = join(state.path, 'admin.sock');
  assert.equal((await stat(adminPath)).mode & 0o777, 0o600);
  assert.equal((await stat(adminPath)).uid, process.getuid!());
  const local = await runCli(['info', '--state-dir', state.path]);
  assert.equal(local.code, 0, local.errors);
  assert.equal((JSON.parse(local.output) as { serverId: string }).serverId, info.serverId);

  const observer = new Database(join(state.path, 'shift.db'), { readonly: true });
  const generation = observer
    .prepare("SELECT value_json FROM server_metadata WHERE key='workerGeneration'")
    .get();
  const second = await runCli(['serve', '--state-dir', state.path, '--port', '0']);
  assert.equal(second.code, 1);
  assert.equal((JSON.parse(second.errors) as { code: string }).code, 'INSTANCE_ALREADY_RUNNING');
  assert.deepEqual(
    observer.prepare("SELECT value_json FROM server_metadata WHERE key='workerGeneration'").get(),
    generation,
  );
  observer.close();
  const alias = `${state.path}-alias`;
  await symlink(state.path, alias);
  t.after(async () => {
    const { unlink } = await import('node:fs/promises');
    await unlink(alias);
  });
  const aliasAttempt = await runCli(['serve', '--state-dir', alias, '--port', '0']);
  assert.equal(aliasAttempt.code, 1);
  assert.equal(
    (JSON.parse(aliasAttempt.errors) as { code: string }).code,
    'INSTANCE_ALREADY_RUNNING',
  );
  assert.equal((await fetch(`${first.url}/api/v0/ready`)).status, 200);

  await first.terminate('SIGKILL');
  assert((await stat(adminPath)).isSocket());
  const restarted = await startChild(state.path);
  t.after(() => restarted.terminate());
  const restored: unknown = await (await fetch(`${restarted.url}/api/v0/info`)).json();
  assert(validateServerInfo(restored));
  assert.equal(restored.serverId, info.serverId);
  assert.equal(restored.eventEpoch, info.eventEpoch);
  const stop = await runCli(['stop', '--state-dir', state.path]);
  assert.equal(stop.code, 0, stop.errors);
  assert(validateShutdownAcknowledgement(JSON.parse(stop.output)));
  assert.equal((await restarted.exit).code, 0);
  await assert.rejects(stat(adminPath), { code: 'ENOENT' });
  const orderlyRestart = await startChild(state.path);
  t.after(() => orderlyRestart.terminate());
  const orderlyInfo: unknown = await (await fetch(`${orderlyRestart.url}/api/v0/info`)).json();
  assert(validateServerInfo(orderlyInfo));
  assert.equal(orderlyInfo.serverId, info.serverId);
  assert.equal(orderlyInfo.eventEpoch, info.eventEpoch);
});

test('SIGTERM closes unfinished HTTP connections within the configured deadline and releases the lock', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const server = await startChild(state.path);
  t.after(() => server.terminate());
  const address = new URL(server.url);
  const socket = createConnection({ host: address.hostname, port: Number(address.port) });
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  socket.write('GET /api/v0/info HTTP/1.1\r\nHost: localhost\r\n');
  const before = Date.now();
  await server.terminate('SIGTERM');
  assert.equal((await server.exit).code, 0);
  assert(Date.now() - before < 2000);
  const successor = await startChild(state.path);
  t.after(() => successor.terminate());
});

test('public listener exposes only bounded validated read endpoints and logs omit request secrets', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const server = await startChild(state.path);
  t.after(() => server.terminate());
  const sentinel = 'do-not-log-this-credential';
  for (const options of [
    {
      path: `/missing?token=${sentinel}`,
      init: { headers: { Authorization: `Bearer ${sentinel}` } },
      status: 404,
    },
    { path: '/api/v0/admin/shutdown', init: { method: 'POST' }, status: 404 },
    { path: '/api/v0/info', init: { method: 'POST', body: sentinel }, status: 400 },
  ]) {
    const response = await fetch(`${server.url}${options.path}`, options.init);
    assert.equal(response.status, options.status);
    const error: unknown = await response.json();
    assert(validateProtocolError(error));
    assert(!JSON.stringify(error).includes(sentinel));
  }
  assert(!server.output().includes(sentinel));
  assert(!server.errors().includes(sentinel));
  assert.equal((await fetch(`${server.url}/api/v0/health`)).status, 200);
});

test('invalid configuration and invalid native binding fail with sanitized errors', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  for (const args of [
    ['--port', '-1'],
    ['--host', '0.0.0.0'],
    ['--port', 'wrong'],
    ['--log-level', 'secret=sentinel'],
    ['--unknown=sentinel'],
  ]) {
    const result = await runCli(['serve', '--state-dir', state.path, ...args]);
    assert.equal(result.code, 1);
    const error: unknown = JSON.parse(result.errors);
    assert(validateProtocolError(error));
    assert.equal(error.code, 'INVALID_CONFIGURATION');
    assert(!result.errors.includes('sentinel'));
  }
  const badNative = join(state.path, 'invalid.node');
  await writeFile(badNative, 'not a native module');
  const result = await runCli(['serve', '--state-dir', state.path, '--port', '0'], {
    SHIFT_SQLITE_NATIVE_BINDING: badNative,
  });
  assert.equal(result.code, 1);
  assert.equal((JSON.parse(result.errors) as { code: string }).code, 'SQLITE_OPEN_FAILED');
  const valid = await startChild(state.path);
  t.after(() => valid.terminate());
});

test('SIGKILL during a real SQLite transaction leaves durable metadata intact and rolls back uncommitted writes', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const server = await startChild(state.path);
  const before = await runCli(['info', '--state-dir', state.path]);
  await server.terminate();
  const process = ownedProcess([
    '--import',
    'tsx',
    join('test', 'fixtures', 'crash-transaction.ts'),
    join(state.path, 'shift.db'),
  ]);
  t.after(() => process.terminate('SIGKILL'));
  await eventually(() => (process.output().includes('transaction-open') ? true : undefined));
  await process.terminate('SIGKILL');
  const db = new Database(join(state.path, 'shift.db'));
  assert.equal(
    db.prepare("SELECT value_json FROM server_metadata WHERE key='uncommittedEvidence'").get(),
    undefined,
  );
  db.close();
  const restarted = await startChild(state.path);
  t.after(() => restarted.terminate());
  const after = await runCli(['info', '--state-dir', state.path]);
  assert.equal(
    (JSON.parse(before.output) as { serverId: string }).serverId,
    (JSON.parse(after.output) as { serverId: string }).serverId,
  );
  assert.equal(
    (JSON.parse(before.output) as { eventEpoch: string }).eventEpoch,
    (JSON.parse(after.output) as { eventEpoch: string }).eventEpoch,
  );
  assert((await readFile(cli, 'utf8')).startsWith('#!/usr/bin/env node'));
});
