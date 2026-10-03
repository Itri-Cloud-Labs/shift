import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { chmod, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  openStore,
  applyMigrations,
  verifySqliteRuntime,
  migrationsDirectory,
} from '../src/persistence/store.js';
import { FakeClock, temporaryState, configFor } from './helpers.js';
import { startServer } from '../src/server.js';
import { ShiftError } from '../src/domain/errors.js';
import { createHttpServer } from '../src/http.js';
import { ReadinessState } from '../src/lifecycle/readiness.js';
import { createLogger } from '../src/logging.js';
import { validateServerHealth } from '../src/protocol/index.js';
import type { AddressInfo } from 'node:net';

test('real SQLite verifies runtime/pragmas and persists identity independently of worker generation', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const clock = new FakeClock();
  const store = await openStore({ stateDirectory: state.path, clock });
  assert.equal(store.runtime.version, '3.53.4');
  assert(store.runtime.sourceId.includes('2026-07-24'));
  for (const [pragma, value] of Object.entries({
    journal_mode: 'wal',
    synchronous: 2,
    foreign_keys: 1,
    busy_timeout: 5000,
  })) {
    assert.equal(store.db.pragma(pragma, { simple: true }), value);
  }
  const tables = store.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();
  assert.deepEqual(tables, [{ name: '__drizzle_migrations' }, { name: 'server_metadata' }]);
  assert.equal(
    (
      store.db.prepare("SELECT value_json FROM server_metadata WHERE key='createdAtMs'").get() as {
        value_json: string;
      }
    ).value_json,
    String(clock.now()),
  );
  const identity = store.identity;
  const generation = store.workerGeneration;
  store.close();
  clock.advance(1000);
  const reopened = await openStore({ stateDirectory: state.path, clock });
  assert.deepEqual(reopened.identity, identity);
  assert.notEqual(reopened.workerGeneration, generation);
  reopened.close();
  for (const version of ['3.9.0', '3.51.2', 'unknown']) {
    assert.throws(() => verifySqliteRuntime({ version, sourceId: 'old runtime' }), {
      code: 'SQLITE_INCOMPATIBLE',
    });
  }
  for (const version of ['3.51.3', '3.53.4', '3.100.0'])
    verifySqliteRuntime({ version, sourceId: 'verified source' });
});

test('migration journal rejects edited history and schema-ahead databases without rewriting metadata', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const store = await openStore({ stateDirectory: state.path, clock: new FakeClock() });
  const before = store.db.prepare('SELECT key, value_json FROM server_metadata ORDER BY key').all();
  const original = store.db.prepare('SELECT hash, created_at FROM __drizzle_migrations').get() as {
    hash: string;
    created_at: number;
  };
  store.db.prepare('UPDATE __drizzle_migrations SET hash=?').run('tampered');
  assert.throws(() => applyMigrations(store.db), { code: 'MIGRATION_HISTORY_MISMATCH' });
  store.db.prepare('UPDATE __drizzle_migrations SET hash=?').run(original.hash);
  store.db
    .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    .run('future', original.created_at + 1);
  assert.throws(() => applyMigrations(store.db), { code: 'MIGRATION_HISTORY_MISMATCH' });
  assert.deepEqual(
    store.db.prepare('SELECT key, value_json FROM server_metadata ORDER BY key').all(),
    before,
  );
  store.close();
});

test('failed SQL migration batch rolls back prior schema statements and its journal', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const directory = join(state.path, 'migrations');
  await mkdir(join(directory, 'meta'), { recursive: true });
  await writeFile(
    join(directory, '0000_good.sql'),
    await readFile(join(migrationsDirectory, '0000_server_metadata.sql')),
  );
  await writeFile(
    join(directory, '0001_bad.sql'),
    'CREATE TABLE failed_batch (id TEXT);\n--> statement-breakpoint\nINVALID SQL;',
  );
  await writeFile(
    join(directory, 'meta/_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [
        { idx: 0, version: '6', when: 1, tag: '0000_good', breakpoints: true },
        { idx: 1, version: '6', when: 2, tag: '0001_bad', breakpoints: true },
      ],
    }),
  );
  const db = new Database(join(state.path, 'test.db'));
  try {
    assert.throws(() => applyMigrations(db, directory), { code: 'MIGRATION_FAILED' });
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name IN ('server_metadata','failed_batch')")
        .all().length,
      0,
    );
    assert.equal(
      (db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n,
      0,
    );
  } finally {
    db.close();
  }
});

test('invalid durable identity fails instead of silently issuing a new identity', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const store = await openStore({ stateDirectory: state.path, clock: new FakeClock() });
  const id = store.identity.serverId;
  store.db
    .prepare('UPDATE server_metadata SET value_json=? WHERE key=?')
    .run('"invalid"', 'eventEpoch');
  store.close();
  await assert.rejects(openStore({ stateDirectory: state.path, clock: new FakeClock() }), {
    code: 'METADATA_INVALID',
  });
  const db = new Database(join(state.path, 'shift.db'));
  assert.equal(
    (
      db.prepare("SELECT value_json FROM server_metadata WHERE key='serverId'").get() as {
        value_json: string;
      }
    ).value_json,
    JSON.stringify(id),
  );
  db.close();
});

test('failed listener startup releases the database/lock and preserves a regular administrative-path file', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const port = (occupied.address() as AddressInfo).port;
  try {
    await assert.rejects(startServer({ ...configFor(state.path), port }), {
      code: 'LISTEN_FAILED',
    });
    await assert.rejects(readFile(join(state.path, 'admin.sock')), { code: 'ENOENT' });
  } finally {
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await writeFile(join(state.path, 'admin.sock'), 'preserve this file');
  await assert.rejects(startServer(configFor(state.path)), { code: 'UNSAFE_STATE_FILE' });
  assert.equal(await readFile(join(state.path, 'admin.sock'), 'utf8'), 'preserve this file');
  const { unlink } = await import('node:fs/promises');
  await unlink(join(state.path, 'admin.sock'));
  const running = await startServer(configFor(state.path));
  await running.stop();
  await running.stop();
});

test('private state directory and regular SQLite paths are required', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  await chmod(state.path, 0o755);
  await assert.rejects(startServer(configFor(state.path)), { code: 'UNSAFE_STATE_DIRECTORY' });
  await chmod(state.path, 0o700);
  const outside = join(state.path, 'outside.db');
  await writeFile(outside, 'preserve');
  await symlink(outside, join(state.path, 'shift.db'));
  await assert.rejects(startServer(configFor(state.path)), { code: 'UNSAFE_STATE_FILE' });
  assert.equal(await readFile(outside, 'utf8'), 'preserve');
});

test('liveness remains alive while readiness fails; timestamps follow the injected clock', async (t) => {
  const state = await temporaryState();
  const clock = new FakeClock();
  const store = await openStore({ stateDirectory: state.path, clock });
  const readiness = new ReadinessState();
  const server = createHttpServer({
    store,
    clock,
    readiness,
    logger: createLogger('silent'),
    administrative: false,
    stop: () => {},
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await state.remove();
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await fetch(`${url}/api/v0/ready`)).status, 503);
  readiness.ready();
  clock.advance(60000);
  const ready: unknown = await (await fetch(`${url}/api/v0/ready`)).json();
  assert(validateServerHealth(ready));
  assert.equal(ready.time.epochMs, clock.now());
  assert.equal(ready.time.iso, new Date(clock.now()).toISOString());
  store.close();
  const live = await fetch(`${url}/api/v0/health`);
  assert.equal(live.status, 200);
  const payload: unknown = await live.json();
  assert(validateServerHealth(payload));
  assert.equal(payload.liveness, 'alive');
  assert.equal(payload.readiness.ready, false);
  assert.equal(payload.readiness.reason, 'PERSISTENCE_UNAVAILABLE');
  assert.equal((await fetch(`${url}/api/v0/ready`)).status, 503);
  assert.throws(
    () => store.check(),
    (error: unknown) => error instanceof Error && !(error instanceof ShiftError),
  );
});
