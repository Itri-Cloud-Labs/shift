import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  link,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { startServer } from '../src/server.js';
import { prepareStateDirectory } from '../src/lifecycle/state-directory.js';
import { acquireInstanceLock } from '../src/lifecycle/instance-lock.js';
import { configFor, eventually, ownedProcess, temporaryState, workspace } from './helpers.js';

test('concurrent first starters share one private inode and exactly one kernel lock', async (t) => {
  const state = await temporaryState();
  const directory = await prepareStateDirectory(state.path);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 8 }, () => acquireInstanceLock(directory)),
  );
  const releases = outcomes.flatMap((outcome) =>
    outcome.status === 'fulfilled' ? [outcome.value] : [],
  );
  t.after(async () => {
    await Promise.all(releases.map((release) => release()));
    await state.remove();
  });
  assert.equal(releases.length, 1);
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected')
      assert.equal((outcome.reason as { code: string }).code, 'INSTANCE_ALREADY_RUNNING');
  }
  assert.equal((await stat(join(state.path, 'instance.lock'))).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(state.path), ['instance.lock']);
});

test('persistent lock inode is reused and unsafe permissions, hard links and symlinks fail closed', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const directory = await prepareStateDirectory(state.path);
  const release = await acquireInstanceLock(directory);
  await release();
  const path = join(state.path, 'instance.lock');
  const before = (await stat(path)).ino;
  await writeFile(path, 'preserve');
  const recovered = await acquireInstanceLock(directory);
  await recovered();
  assert.equal((await stat(path)).ino, before);
  assert.equal(await readFile(path, 'utf8'), 'preserve');
  await chmod(path, 0o644);
  await assert.rejects(acquireInstanceLock(directory), { code: 'INSTANCE_LOCK_FAILED' });
  assert.equal((await stat(path)).mode & 0o777, 0o644);
  await chmod(path, 0o600);
  const alias = join(state.path, 'lock-alias');
  await link(path, alias);
  await assert.rejects(acquireInstanceLock(directory), { code: 'INSTANCE_LOCK_FAILED' });
  await unlink(path);
  await symlink(alias, path);
  await assert.rejects(acquireInstanceLock(directory), { code: 'INSTANCE_LOCK_FAILED' });
  assert.equal(await readFile(alias, 'utf8'), 'preserve');
});

test('another account cannot block ownership by preclaiming the stat-derived abstract socket', async (t) => {
  const state = await temporaryState();
  const publicDirectory = await mkdtemp(join(tmpdir(), 'shift-lock-account-'));
  await chmod(publicDirectory, 0o755);
  const node = join(publicDirectory, 'node');
  const fixture = join(publicDirectory, 'preclaim-lock.mjs');
  await copyFile(process.execPath, node);
  await chmod(node, 0o755);
  await copyFile(join(workspace, 'test/fixtures/preclaim-lock.mjs'), fixture);
  await chmod(fixture, 0o644);
  const root = process.getuid!() === 0;
  const child = spawn(
    root ? node : 'sudo',
    root ? [fixture, state.path] : ['-n', '-u', 'nobody', '--', node, fixture, state.path],
    {
      ...(root ? { uid: 65534, gid: 65534 } : {}),
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let output = '';
  let errors = '';
  child.stdout!.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr!.on('data', (chunk) => {
    errors += String(chunk);
  });
  const exited = once(child, 'close');
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  t.after(async () => {
    await running?.stop();
    child.stdin!.end();
    await exited;
    await state.remove();
    await rm(publicDirectory, { recursive: true, force: true });
  });
  await eventually(() => {
    if (child.exitCode !== null) throw new Error(`Preclaim process failed: ${errors}`);
    return output.includes('PRECLAIMED') ? true : undefined;
  });
  running = await startServer(configFor(state.path));
  assert.equal((await fetch(`${running.url}/api/v0/ready`)).status, 200);
  assert.equal((await stat(join(state.path, 'instance.lock'))).mode & 0o777, 0o600);
});

for (const scenario of ['shutdown', 'startup']) {
  test(`${scenario} cleanup attempts every resource and releases ownership after failures`, async (t) => {
    const state = await temporaryState();
    const child = ownedProcess([
      join(workspace, 'test/fixtures/cleanup-failure.mjs'),
      scenario,
      state.path,
    ]);
    t.after(async () => {
      await child.terminate();
      await state.remove();
    });
    if (scenario === 'shutdown') {
      await eventually(() => (child.output().includes('READY') ? true : undefined));
      child.child.kill('SIGTERM');
    }
    assert.equal((await child.exit).code, 0, child.errors());
    const result = JSON.parse(child.output().trim().split('\n').at(-1)!) as {
      failure: string;
      listenersClosed: number;
      databasesClosed: number;
      lockReleased: boolean;
      sharedPromise: boolean;
      unhandledRejections: number;
    };
    assert.equal(result.listenersClosed, scenario === 'shutdown' ? 2 : 1);
    assert.equal(result.databasesClosed, 1);
    assert.equal(result.lockReleased, true);
    assert.equal(result.sharedPromise, true);
    assert.equal(result.unhandledRejections, 0);
    assert.equal(result.failure, scenario === 'startup' ? 'LISTEN_FAILED' : 'INTERNAL_ERROR');
    assert(!child.errors().includes('private-'));
  });
}
