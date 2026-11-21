import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { administrativeCall } from '../src/admin-client.js';
import { isPersistenceFailure, PersistenceGuard } from '../src/lifecycle/persistence.js';
import { startServer } from '../src/server.js';
import { action, actionWorkflow, run, settled, setup, skip, view } from './action-helpers.js';
import { configFor, eventually, temporaryState } from './helpers.js';

test('storage failures are told apart from other errors', () => {
  const sqlite = (code: string) => new Database.SqliteError('failed', code);
  for (const code of ['SQLITE_FULL', 'SQLITE_IOERR', 'SQLITE_IOERR_WRITE', 'SQLITE_READONLY'])
    assert.equal(isPersistenceFailure(sqlite(code)), true, code);
  for (const code of ['SQLITE_CONSTRAINT', 'SQLITE_BUSY', 'SQLITE_FULLY'])
    assert.equal(isPersistenceFailure(sqlite(code)), false, code);
  for (const code of ['ENOSPC', 'EROFS', 'EIO', 'EDQUOT'])
    assert.equal(isPersistenceFailure(Object.assign(new Error(), { code })), true, code);
  assert.equal(isPersistenceFailure(Object.assign(new Error(), { code: 'ENOENT' })), false);
  assert.equal(isPersistenceFailure(new Error('no code')), false);

  const guard = new PersistenceGuard();
  let calls = 0;
  guard.onFailure(() => calls++);
  assert.doesNotThrow(() => guard.ensure());
  assert.equal(guard.report(sqlite('SQLITE_BUSY')), false);
  assert.equal(guard.failed, false);
  assert.equal(guard.report(sqlite('SQLITE_FULL')), true);
  guard.fail();
  assert.equal(calls, 1, 'listeners hear of the failure once');
  assert.throws(() => guard.ensure(), { code: 'PERSISTENCE_UNAVAILABLE', status: 503 });
});

test(
  'an effect intended when storage fails is not submitted, and the next start performs it once',
  { skip, timeout: 60_000 },
  async () => {
    let env = await setup();
    const state = env.state;
    try {
      const marker = join(state, 'effect.txt');
      // Storage fails right after the intent is stored, before the command is submitted.
      const intend = env.engine.effects.intend.bind(env.engine.effects);
      env.engine.effects.intend = (...args) => {
        const operation = intend(...args);
        env.engine.persistence.fail();
        return operation;
      };
      const id = await run(
        env,
        actionWorkflow('command', { mode: 'shell', script: `echo once >> ${marker}` }),
      );
      const intended = await eventually(() => {
        const operation = action(view(env, id))?.operations[0];
        return operation?.state === 'INTENDED' ? operation : undefined;
      });
      assert.equal(intended.state, 'INTENDED');
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(existsSync(marker), false, 'nothing was submitted');
      assert.equal(view(env, id).state, 'RUNNING');
      await env.close();

      env = await setup(state);
      const done = await settled(env, id);
      assert.equal(done.state, 'COMPLETED', JSON.stringify(done.attention));
      assert.equal(await readFile(marker, 'utf8'), 'once\n');
      assert.deepEqual(
        action(done).operations.map((operation) => operation.state),
        ['SUCCEEDED'],
      );
    } finally {
      await env.close();
    }
  },
);

test('after a storage failure the server refuses changes and readiness until restart', async () => {
  const state = await temporaryState();
  const persistence = new PersistenceGuard();
  const running = await startServer(configFor(state.path), { persistence });
  try {
    const call = (method: 'GET' | 'POST', path: string, body?: unknown) =>
      administrativeCall(state.path, { method, path, ...(body ? { body } : {}) });
    assert.equal((await call('GET', '/api/v0/ready')).status, 200);
    persistence.fail();
    const ready = await call('GET', '/api/v0/ready');
    assert.equal(ready.status, 503);
    assert.equal(
      (ready.payload as { readiness: { reason: string } }).readiness.reason,
      'PERSISTENCE_UNAVAILABLE',
    );
    const added = await call('POST', '/api/v0/admin/projects', {
      path: state.path,
      commandId: 'project-after-failure',
    });
    assert.equal(added.status, 503);
    assert.equal((added.payload as { code: string }).code, 'PERSISTENCE_UNAVAILABLE');
    assert.equal((added.payload as { retryable: boolean }).retryable, true);
    // Reads still answer, and the server can still be stopped.
    assert.equal((await call('GET', '/api/v0/admin/projects')).status, 200);
    assert.equal((await call('POST', '/api/v0/admin/shutdown')).status, 202);
    await running.stopped;
  } finally {
    await running.stop().catch(() => undefined);
    await state.remove();
  }
});

test(
  'a graceful stop during a command is recorded, and recovery says the shutdown stopped it',
  { skip, timeout: 60_000 },
  async () => {
    let env = await setup();
    const state = env.state;
    try {
      const marker = join(state, 'started.txt');
      const id = await run(
        env,
        actionWorkflow('command', { mode: 'shell', script: `echo $$ > ${marker}; sleep 60` }),
      );
      await eventually(() => (existsSync(marker) ? true : undefined));
      await env.close();
      env = await setup(state);
      const stopped = await settled(env, id);
      assert.equal(stopped.state, 'NEEDS_HUMAN');
      assert.equal(stopped.attention?.code, 'EFFECT_UNCERTAIN');
      assert.match(stopped.attention!.explanation, /server was shut down while the command/);
      const operation = action(stopped).operations[0]!;
      assert.equal(operation.state, 'UNKNOWN');
      assert.equal(operation.evidence['stoppedBy'], 'shutdown');
      const pid = Number(await readFile(marker, 'utf8'));
      assert.throws(() => process.kill(pid, 0), 'the command did not outlive the shutdown');
    } finally {
      await env.close();
    }
  },
);

test('a storage failure when a quiesce pause ends trips the guard instead of throwing', async () => {
  const env = await setup();
  try {
    env.engine.quiesce(60_000);
    env.engine.repository.activeManualGoals = () => {
      throw new Database.SqliteError('disk I/O error', 'SQLITE_IOERR');
    };
    assert.doesNotThrow(() => env.engine.resume());
    assert.equal(env.engine.persistence.failed, true);
  } finally {
    await env.close();
  }
});

test(
  'a storage failure while preparing a step stops dispatch without failing the step',
  { skip, timeout: 60_000 },
  async () => {
    let env = await setup();
    const state = env.state;
    try {
      const marker = join(state, 'prepared.txt');
      const variables = env.engine.repository.variables.bind(env.engine.repository);
      env.engine.repository.variables = () => {
        throw new Database.SqliteError('disk I/O error', 'SQLITE_IOERR');
      };
      const id = await run(
        env,
        actionWorkflow('command', { mode: 'shell', script: `echo once >> ${marker}` }),
      );
      await eventually(() => (env.engine.persistence.failed ? true : undefined));
      const step = action(view(env, id));
      assert.notEqual(step?.state, 'FAILED', 'the storage failure did not fail the step');
      assert.equal(view(env, id).state, 'RUNNING');
      env.engine.repository.variables = variables;
      await env.close();
      env = await setup(state);
      const done = await settled(env, id);
      assert.equal(done.state, 'COMPLETED', JSON.stringify(done.attention));
      assert.equal(await readFile(marker, 'utf8'), 'once\n');
    } finally {
      await env.close();
    }
  },
);
