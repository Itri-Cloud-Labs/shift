import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { SystemdScopes } from '../src/harness/containment.js';
import { namespaceId } from '../src/harness/opencode/namespace.js';
import { OpenCodeRuntime, type OpenCodeRuntimeOptions } from '../src/harness/opencode/runtime.js';
import { createLogger } from '../src/logging.js';
import { eventually, temporaryState, workspace } from './helpers.js';

const scopes = new SystemdScopes('user');
const containment = await scopes.available();
// CI enables a user manager and sets this, so the tests fail there instead of skipping.
const required = process.env['SHIFT_TEST_REQUIRE_SYSTEMD'] === '1';
const skip = !containment && !required && 'needs a systemd user manager (systemd-run --user)';
const fake = join(workspace, 'test/fixtures/fake-opencode.mjs');

interface FakeReport {
  pid: number;
  toolPid: number;
  args: string[];
  env: Record<string, string>;
}

const alive = (pid: number) => existsSync(`/proc/${pid}`);

// The fake writes its report before printing its address, so it exists once `ensure` resolves.
async function report(runtime: OpenCodeRuntime): Promise<FakeReport> {
  return JSON.parse(
    await readFile(join(runtime.layout.root, 'fake-report.json'), 'utf8'),
  ) as FakeReport;
}

const storedCredentials = async (runtime: OpenCodeRuntime) =>
  JSON.parse(await readFile(join(runtime.layout.root, 'fake-credentials.json'), 'utf8')) as Array<{
    integrationID: string;
    label: string;
    value: { key: string };
  }>;

function runtimeFor(stateDirectory: string, extra: Partial<OpenCodeRuntimeOptions> = {}) {
  return new OpenCodeRuntime({
    stateDirectory,
    scopes,
    executable: fake,
    logger: createLogger('silent'),
    resultHandler: async () => ({ accepted: false, reason: 'unused' }),
    ...extra,
  });
}

test(
  'a contained process that escapes its session is killed with its scope',
  { skip },
  async () => {
    const unit = `shift-test-${process.pid}-${Date.now().toString(36)}`;
    const child = scopes.spawn(unit, 'bash', ['-c', 'setsid sleep 300 & echo $!; exec sleep 300'], {
      cwd: '/',
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
    });
    let output = '';
    child.stdout!.on('data', (chunk) => (output += chunk));
    const escaped = Number(await eventually(() => /^(\d+)\n/.exec(output)?.[1]));
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
    assert.ok(alive(escaped), 'the escaped process outlives its parent');
    assert.deepEqual(await scopes.members(unit), [escaped]);
    await scopes.kill(unit);
    assert.equal(alive(escaped), false);
    assert.deepEqual(await scopes.members(unit), []);
  },
);

test(
  'the runtime starts in a private namespace and provisions credentials once',
  { skip },
  async () => {
    const state = await temporaryState();
    const runtime = runtimeFor(state.path, {
      credentials: [{ integrationID: 'opencode-go', key: 'test-key' }],
    });
    try {
      const generation = await runtime.ensure();
      assert.equal(generation.generation, 1);
      const started = await report(runtime);
      assert.deepEqual(started.args, ['serve', '--hostname', '127.0.0.1', '--port', '0']);
      assert.equal(started.env['HOME'], join(runtime.layout.root, 'home'));
      assert.equal(started.env['XDG_DATA_HOME'], join(runtime.layout.root, 'data'));
      assert.equal(started.env['OPENCODE_SERVER_PASSWORD'], undefined);
      assert.equal(started.env['DBUS_SESSION_BUS_ADDRESS'], undefined);
      assert.equal(started.env['XDG_RUNTIME_DIR'], undefined);
      assert.equal(
        (await stat(join(runtime.layout.config, 'opencode/opencode.jsonc'))).mode & 0o777,
        0o600,
      );
      const config = await readFile(join(runtime.layout.config, 'opencode/opencode.jsonc'), 'utf8');
      assert.match(config, /"token"/);
      assert.deepEqual(
        (await storedCredentials(runtime)).map(({ integrationID, label, value }) => [
          integrationID,
          label,
          value.key,
        ]),
        [['opencode-go', 'shift', 'test-key']],
      );
      assert.equal((await runtime.sessionProcesses('ses_fake')).length, 1);
      await runtime.stop();
      assert.equal(alive(started.pid), false);
      assert.equal(alive(started.toolPid), false, 'stop kills tool processes outside the group');
    } finally {
      await runtime.stop();
      await state.remove();
    }
  },
);

test(
  'a lost runtime has its whole scope killed before a new generation starts',
  { skip },
  async () => {
    const state = await temporaryState();
    const runtime = runtimeFor(state.path);
    const lost: number[] = [];
    runtime.onLost((generation) => lost.push(generation));
    try {
      const first = await runtime.ensure();
      const started = await report(runtime);
      process.kill(first.pid, 'SIGKILL');
      await eventually(() => (lost.length ? true : undefined));
      assert.deepEqual(lost, [1]);
      assert.equal(runtime.current, null);
      const second = await runtime.ensure();
      assert.equal(second.generation, 2);
      assert.equal(alive(started.toolPid), false, 'the orphaned tool died with the lost scope');
      assert.deepEqual(await scopes.members(first.unit), []);
    } finally {
      await runtime.stop();
      await state.remove();
    }
  },
);

test('a new supervisor reaps runtimes left by a dead Shift process', { skip }, async () => {
  const state = await temporaryState();
  const abandoned = runtimeFor(state.path);
  const successor = runtimeFor(state.path);
  try {
    const old = await abandoned.ensure();
    const oldReport = await report(abandoned);
    // The first supervisor is never stopped, as if its Shift process had been killed.
    await successor.ensure();
    assert.notEqual((await report(successor)).pid, oldReport.pid);
    assert.equal(alive(oldReport.pid), false);
    assert.equal(alive(oldReport.toolPid), false);
    assert.deepEqual(await scopes.members(old.unit), []);
  } finally {
    await successor.stop();
    await state.remove();
  }
});

test('a runtime that cannot start fails cleanly and leaves no scope', { skip }, async () => {
  const state = await temporaryState();
  const runtime = runtimeFor(state.path, { executable: join(state.path, 'missing-opencode') });
  try {
    await assert.rejects(runtime.ensure(), { code: 'HARNESS_START_FAILED' });
    assert.equal(runtime.current, null);
    assert.deepEqual(await scopes.list(`shift-opencode-${namespaceId(runtime.layout)}-`), []);
  } finally {
    await runtime.stop();
    await state.remove();
  }
});

test('a replaced provider key supersedes the stored one across restarts', { skip }, async () => {
  const state = await temporaryState();
  const first = runtimeFor(state.path, { credentials: [{ integrationID: 'p', key: 'old' }] });
  const second = runtimeFor(state.path, { credentials: [{ integrationID: 'p', key: 'new' }] });
  // A stopped supervisor cannot restart; a new one stands in for the next Shift process.
  const third = runtimeFor(state.path, { credentials: [{ integrationID: 'p', key: 'new' }] });
  try {
    await first.ensure();
    await first.stop();
    await second.ensure();
    const keys = (await storedCredentials(second)).map(({ value }) => value.key);
    assert.deepEqual(keys, ['new']);
    await second.stop();
    await third.ensure();
    assert.deepEqual(
      (await storedCredentials(third)).map(({ value }) => value.key),
      ['new'],
    );
  } finally {
    await first.stop();
    await second.stop();
    await third.stop();
    await state.remove();
  }
});

test('a runtime that dies during startup is never handed out', { skip }, async () => {
  const state = await temporaryState();
  const runtime = runtimeFor(state.path, { credentials: [{ integrationID: 'p', key: 'k' }] });
  await mkdir(runtime.layout.root, { recursive: true, mode: 0o700 });
  const control = join(runtime.layout.root, 'fake-control.json');
  await writeFile(control, JSON.stringify({ exitAfterCredential: true }));
  try {
    // Depending on timing the death is seen during startup or right after; either way the dead
    // generation must not stay current.
    const started = await runtime.ensure().then(
      (generation) => generation,
      (error: { code?: string }) => {
        assert.equal(error.code, 'HARNESS_START_FAILED');
        return null;
      },
    );
    await eventually(() => (runtime.current === null ? true : undefined));
    if (started) assert.equal(alive(started.pid), false);
    await rm(control);
    const next = await runtime.ensure();
    assert.ok(alive(next.pid));
  } finally {
    await runtime.stop();
    await state.remove();
  }
});

test('startup reaping kills a stale runtime without starting a new one', { skip }, async () => {
  const state = await temporaryState();
  const abandoned = runtimeFor(state.path);
  const successor = runtimeFor(state.path);
  try {
    const old = await abandoned.ensure();
    const oldReport = await report(abandoned);
    await successor.reapStale();
    assert.equal(alive(oldReport.pid), false);
    assert.equal(alive(oldReport.toolPid), false);
    assert.deepEqual(await scopes.members(old.unit), []);
    assert.equal(successor.current, null, 'reaping does not start a runtime');
  } finally {
    await successor.stop();
    await state.remove();
  }
});

test('a stopped runtime cannot be started again by a lingering task', { skip }, async () => {
  const state = await temporaryState();
  const runtime = runtimeFor(state.path);
  try {
    await runtime.ensure();
    await runtime.stop();
    await assert.rejects(runtime.ensure(), { code: 'HARNESS_STOPPED' });
    assert.equal(runtime.current, null);
    assert.deepEqual(await scopes.list(`shift-opencode-${namespaceId(runtime.layout)}-`), []);
  } finally {
    await runtime.stop();
    await state.remove();
  }
});
