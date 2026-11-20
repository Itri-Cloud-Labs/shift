import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { openStore } from '../src/persistence/store.js';
import { doctor } from '../src/service/doctor.js';
import { parseEnvironment, resolveStateDirectory, servicePaths } from '../src/service/paths.js';
import type { Execute } from '../src/service/systemd.js';
import { managedMarker, renderEnvironment, renderUnit } from '../src/service/unit.js';
import { cli, FakeClock, runCli, temporaryState, workspace } from './helpers.js';

const run = promisify(execFile);
const installer = join(workspace, 'packaging', 'install.sh');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

async function home(): Promise<{ path: string; remove(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'shift-home-'));
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

test('the unit runs the current release with the private settings file', () => {
  const paths = servicePaths({ HOME: '/home/owner', XDG_CONFIG_HOME: '/home/owner/.config' });
  const unit = renderUnit(paths);
  assert.ok(unit.startsWith(managedMarker));
  assert.match(
    unit,
    /^ExecStart=\/home\/owner\/\.local\/share\/shift\/current\/bin\/shift serve$/m,
  );
  assert.match(unit, /^EnvironmentFile=\/home\/owner\/\.config\/shift\/server\.env$/m);
  assert.match(unit, /^KillMode=mixed$/m);
  assert.match(unit, /^WantedBy=default\.target$/m);
  // TimeoutStopSec outlasts the longest shutdown deadline the server accepts.
  assert.ok(Number(/^TimeoutStopSec=(\d+)$/m.exec(unit)![1]) > 30);
  assert.throws(
    () => renderUnit(servicePaths({ XDG_DATA_HOME: '/home/a b', XDG_CONFIG_HOME: '/c' })),
    { code: 'INVALID_CONFIGURATION' },
  );
  assert.throws(() => servicePaths({ XDG_CONFIG_HOME: 'relative' }), {
    code: 'INVALID_CONFIGURATION',
  });
});

test('the settings file keeps the installing PATH and loopback, and refuses line breaks', () => {
  const text = renderEnvironment({ path: '/opt/bin:/usr/bin', stateDirectory: '/srv/state' });
  const values = parseEnvironment(text);
  assert.equal(values.get('PATH'), '/opt/bin:/usr/bin');
  assert.equal(values.get('SHIFT_STATE_DIR'), '/srv/state');
  assert.equal(values.get('SHIFT_HOST'), '127.0.0.1');
  assert.equal(values.has('SHIFT_PUBLIC'), false);
  assert.throws(() => renderEnvironment({ path: '/bin\nSHIFT_PUBLIC=1', stateDirectory: '/s' }), {
    code: 'INVALID_CONFIGURATION',
  });
  assert.deepEqual(
    [...parseEnvironment('# c\n\nA="quoted value"\n B = no\nC=x=y\n')],
    [
      ['A', 'quoted value'],
      ['C', 'x=y'],
    ],
  );
});

test('commands find the server through the flag, the environment, then the service settings', async () => {
  const owner = await home();
  try {
    const env = { HOME: owner.path, XDG_CONFIG_HOME: join(owner.path, 'config') };
    assert.equal(resolveStateDirectory(undefined, env), join(owner.path, '.local/state/shift'));
    await mkdir(join(owner.path, 'config', 'shift'), { recursive: true });
    await writeFile(join(owner.path, 'config', 'shift', 'server.env'), 'SHIFT_STATE_DIR=/srv/s\n');
    assert.equal(resolveStateDirectory(undefined, env), '/srv/s');
    assert.equal(resolveStateDirectory(undefined, { ...env, SHIFT_STATE_DIR: '/e' }), '/e');
    assert.equal(resolveStateDirectory('/flag', { ...env, SHIFT_STATE_DIR: '/e' }), '/flag');
    await writeFile(join(owner.path, 'config', 'shift', 'server.env'), 'SHIFT_STATE_DIR=rel\n');
    assert.throws(() => resolveStateDirectory(undefined, env), { code: 'INVALID_CONFIGURATION' });
  } finally {
    await owner.remove();
  }
});

// systemctl and loginctl answers for a service that is installed, running and lingering.
const healthySystemd: Execute = async (command, args) => {
  if (command === 'systemctl')
    return {
      code: 0,
      stdout:
        'LoadState=loaded\nActiveState=active\nSubState=running\nUnitFileState=enabled\nActiveEnterTimestamp=x\n',
      stderr: '',
    };
  if (command === 'loginctl') return { code: 0, stdout: 'yes\n', stderr: '' };
  if (command.endsWith('git') && args[0] === 'config')
    return { code: 0, stdout: 'Owner\n', stderr: '' };
  return { code: 1, stdout: '', stderr: '' };
};

test('doctor flags readable state files and never prints the settings or keys', async () => {
  const state = await temporaryState();
  const owner = await home();
  try {
    const store = await openStore({ stateDirectory: state.path, clock: new FakeClock() });
    store.close();
    await mkdir(join(state.path, 'secrets'), { mode: 0o700 });
    const key = 'a'.repeat(43);
    await writeFile(join(state.path, 'secrets', 'master.key'), JSON.stringify({ key }), {
      mode: 0o600,
    });
    const bin = join(owner.path, 'bin');
    await mkdir(bin);
    for (const tool of ['opencode', 'git']) {
      await writeFile(join(bin, tool), '#!/bin/sh\n', { mode: 0o755 });
    }
    const config = join(owner.path, 'config');
    await mkdir(join(config, 'shift'), { recursive: true });
    await writeFile(
      join(config, 'shift', 'server.env'),
      `PATH=${bin}\nOPENAI_API_KEY=sk-provider-secret\nSHIFT_HOST=127.0.0.1\n`,
      { mode: 0o600 },
    );
    const env = { HOME: owner.path, XDG_CONFIG_HOME: config, USER: 'owner', PATH: '/nowhere' };
    let checks = await doctor({ stateDirectory: state.path, env, execute: healthySystemd });
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    assert.equal(byId['state']!.status, 'ok', byId['state']!.summary);
    assert.equal(byId['service']!.status, 'ok');
    assert.equal(byId['linger']!.status, 'ok');
    assert.equal(byId['opencode']!.status, 'ok', byId['opencode']!.summary);
    assert.equal(byId['git']!.status, 'ok');
    assert.equal(byId['access']!.status, 'ok');
    // Nothing answers on the socket in this test.
    assert.equal(byId['server']!.status, 'fail');
    const printed = JSON.stringify(checks);
    assert.equal(printed.includes('sk-provider-secret'), false);
    assert.equal(printed.includes(key), false);

    await chmod(join(state.path, 'secrets', 'master.key'), 0o644);
    await writeFile(join(config, 'shift', 'server.env'), 'PATH=/nowhere\nSHIFT_HOST=0.0.0.0\n');
    checks = await doctor({
      stateDirectory: state.path,
      env,
      execute: async (command, args) =>
        command === 'loginctl'
          ? { code: 0, stdout: 'no\n', stderr: '' }
          : healthySystemd(command, args),
      diskFailBytes: Number.MAX_SAFE_INTEGER,
    });
    const after = Object.fromEntries(checks.map((check) => [check.id, check]));
    assert.equal(after['state']!.status, 'fail');
    assert.match(after['state']!.summary, /master\.key has mode 644/);
    assert.equal(after['linger']!.status, 'warn');
    assert.match(after['linger']!.hint!, /sudo loginctl enable-linger owner/);
    assert.equal(after['opencode']!.status, 'fail');
    assert.equal(after['disk']!.status, 'fail');
    assert.equal(after['access']!.status, 'warn');
  } finally {
    await state.remove();
    await owner.remove();
  }
});

test('the upgrade check refuses a database migrated by another build', async () => {
  const state = await temporaryState();
  try {
    const store = await openStore({ stateDirectory: state.path, clock: new FakeClock() });
    store.close();
    const ok = await runCli(['upgrade-check', '--state-dir', state.path]);
    assert.equal(ok.code, 0, ok.errors);
    const report = JSON.parse(ok.output) as { compatible: boolean; pending: number };
    assert.deepEqual([report.compatible, report.pending], [true, 0]);
    const db = new Database(join(state.path, 'shift.db'));
    db.prepare(
      "UPDATE __drizzle_migrations SET hash = 'other' WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)",
    ).run();
    db.close();
    const refused = await runCli(['upgrade-check', '--state-dir', state.path]);
    assert.equal(refused.code, 1);
    assert.match(refused.output, /migrated by a newer or different Shift build/);
  } finally {
    await state.remove();
  }
});

test('shift with no command reports status instead of serving', async () => {
  const state = await temporaryState();
  try {
    const result = await runCli([], {
      SHIFT_STATE_DIR: state.path,
    });
    assert.equal(result.code, 0, result.errors);
    assert.match(result.output, /Server {4}not running/);
    const version = await runCli(['version', '--json']);
    const report = JSON.parse(version.output) as { node: string; release: boolean };
    assert.equal(report.node, process.version);
    assert.equal(report.release, false);
  } finally {
    await state.remove();
  }
});

// A stand-in release: the real CLI on this Node, under the layout and manifest of a bundle.
async function fakeRelease(
  directory: string,
  version: string,
  releaseArch = arch,
  minimumGlibc = '2.17',
): Promise<{ archive: string; sums: string }> {
  const name = `shift-${version}-linux-${releaseArch}`;
  const root = join(directory, 'stage', name);
  await mkdir(join(root, 'bin'), { recursive: true });
  await mkdir(join(root, 'node', 'bin'), { recursive: true });
  await symlink(process.execPath, join(root, 'node', 'bin', 'node'));
  await writeFile(
    join(root, 'bin', 'shift'),
    `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`,
    { mode: 0o755 },
  );
  await writeFile(
    join(root, 'MANIFEST.json'),
    JSON.stringify({ name: 'shift-server', version, arch: releaseArch, minimumGlibc }),
  );
  const archive = join(directory, `${name}.tar.gz`);
  await run('tar', ['-czf', archive, '-C', join(directory, 'stage'), name]);
  const hash = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  const sums = join(directory, 'SHA256SUMS');
  await writeFile(sums, `${hash}  ${name}.tar.gz\n`);
  return { archive, sums };
}

async function install(owner: string, ...args: string[]) {
  return run('bash', [installer, ...args], {
    env: {
      HOME: owner,
      PATH: '/usr/bin:/bin',
      // No user manager, so no service is ever seen as running.
      XDG_RUNTIME_DIR: join(owner, 'no-runtime'),
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent',
    },
  }).then(
    (result) => ({ code: 0, ...result }),
    (error: { code: number; stdout: string; stderr: string }) => error,
  );
}

test('the installer verifies the archive and machine before it changes anything', async () => {
  const owner = await home();
  try {
    const release = await fakeRelease(join(owner.path, 'r1'), '1.0.0');
    const current = join(owner.path, '.local/share/shift/current');
    const allowRoot = process.getuid!() === 0 ? ['--allow-root'] : [];

    if (process.getuid!() === 0) {
      const root = await install(owner.path, '--archive', release.archive);
      assert.notEqual(root.code, 0);
      assert.match(root.stderr, /not root/);
    }

    await writeFile(release.archive, Buffer.from('tampered'), { flag: 'a' });
    const tampered = await install(owner.path, '--archive', release.archive, ...allowRoot);
    assert.notEqual(tampered.code, 0);
    assert.match(tampered.stderr, /does not match its SHA-256/);
    await assert.rejects(lstat(current));

    const foreign = await fakeRelease(
      join(owner.path, 'r2'),
      '1.0.0',
      arch === 'x64' ? 'arm64' : 'x64',
    );
    const wrong = await install(owner.path, '--archive', foreign.archive, ...allowRoot);
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.stderr, /is for (arm64|x64), but this machine is/);

    const old = await fakeRelease(join(owner.path, 'r3'), '1.0.0', arch, '99.0');
    const glibc = await install(owner.path, '--archive', old.archive, ...allowRoot);
    assert.notEqual(glibc.code, 0);
    assert.match(glibc.stderr, /older than the 99\.0 this release needs/);

    const missing = await fakeRelease(join(owner.path, 'r4'), '1.0.0');
    await writeFile(missing.sums, '');
    const unlisted = await install(owner.path, '--archive', missing.archive, ...allowRoot);
    assert.match(unlisted.stderr, /has no checksum for/);
    await assert.rejects(lstat(current));

    const good = await fakeRelease(join(owner.path, 'r5'), '1.0.0');
    const installed = await install(owner.path, '--archive', good.archive, ...allowRoot);
    assert.equal(installed.code, 0, installed.stderr);
    assert.equal(await readlink(current), 'versions/1.0.0');
    assert.equal(
      await readlink(join(owner.path, '.local/bin/shift')),
      join(owner.path, '.local/share/shift/current/bin/shift'),
    );
    assert.match(installed.stdout, /shift service install --start/);

    const next = await fakeRelease(join(owner.path, 'r6'), '1.1.0');
    assert.equal((await install(owner.path, '--archive', next.archive, ...allowRoot)).code, 0);
    assert.equal(await readlink(current), 'versions/1.1.0');
    assert.equal(await readlink(join(owner.path, '.local/share/shift/previous')), 'versions/1.0.0');
    // Repositories and anything else in the home directory stay as they were.
    assert.deepEqual(
      (await run('ls', ['-A', owner.path])).stdout.split('\n').filter(Boolean).sort(),
      ['.local', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
    );
  } finally {
    await owner.remove();
  }
});
