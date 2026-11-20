import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { administrativeCall } from './admin-client.js';
import { ShiftError } from './domain/errors.js';
import { migrationsDirectory } from './persistence/runtime.js';
import { installedRelease, versionReport } from './release.js';
import { doctor, type Check } from './service/doctor.js';
import {
  readServiceEnvironment,
  resolveStateDirectory,
  servicePaths,
  unitName,
} from './service/paths.js';
import { UserSystemd } from './service/systemd.js';
import { managedMarker, renderEnvironment, renderUnit } from './service/unit.js';

const invalid = (message: string) => new ShiftError('INVALID_CONFIGURATION', message, 422);

const options = {
  'state-dir': { type: 'string' },
  json: { type: 'boolean' },
  start: { type: 'boolean' },
  force: { type: 'boolean' },
  lines: { type: 'string', short: 'n' },
  follow: { type: 'boolean', short: 'f' },
  sums: { type: 'string' },
  'allow-active': { type: 'boolean' },
  'database-only': { type: 'boolean' },
  resume: { type: 'boolean' },
  timeout: { type: 'string' },
} as const;

type Values = {
  [K in keyof typeof options]?: (typeof options)[K]['type'] extends 'boolean' ? boolean : string;
};

const write = (text: string): void => {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
};

interface Readiness {
  running: boolean;
  ready: boolean;
  reason: string | null;
  serverId: string | null;
}

async function readiness(stateDirectory: string): Promise<Readiness> {
  try {
    const { payload } = await administrativeCall(stateDirectory, {
      method: 'GET',
      path: '/api/v0/ready',
    });
    const health = payload as {
      serverId?: string;
      readiness?: { ready?: boolean; reason?: string };
    };
    return {
      running: true,
      ready: health.readiness?.ready === true,
      reason: health.readiness?.reason ?? null,
      serverId: health.serverId ?? null,
    };
  } catch {
    return { running: false, ready: false, reason: null, serverId: null };
  }
}

async function pairedDevices(stateDirectory: string): Promise<number | null> {
  try {
    const { status, payload } = await administrativeCall(stateDirectory, {
      method: 'GET',
      path: '/api/v0/admin/devices',
    });
    if (status !== 200) return null;
    return ((payload as { devices?: Array<{ revokedAt: number | null }> }).devices ?? []).filter(
      (device) => device.revokedAt === null,
    ).length;
  } catch {
    return null;
  }
}

export interface StatusReport {
  version: string;
  release: boolean;
  stateDirectory: string;
  service: { manager: boolean; installed: boolean; enabled: boolean; active: string };
  linger: boolean | null;
  server: Readiness;
  address: string;
  devices: number | null;
}

async function statusReport(stateDirectory: string, systemd: UserSystemd): Promise<StatusReport> {
  const settings = readServiceEnvironment();
  const host = settings?.get('SHIFT_HOST') ?? process.env['SHIFT_HOST'] ?? '127.0.0.1';
  const port = settings?.get('SHIFT_PORT') ?? process.env['SHIFT_PORT'] ?? '4317';
  const unit = await systemd.state();
  const server = await readiness(stateDirectory);
  const release = await installedRelease();
  return {
    version: release?.manifest.version ?? (await versionReport()).version,
    release: release !== null,
    stateDirectory,
    service: {
      manager: unit.manager,
      installed: unit.installed,
      enabled: unit.enabled,
      active: unit.active,
    },
    linger: unit.manager ? await systemd.linger() : null,
    server,
    address: `http://${host.includes(':') ? `[${host}]` : host}:${port}`,
    devices: server.ready ? await pairedDevices(stateDirectory) : null,
  };
}

function printStatus(report: StatusReport): void {
  const lines = [`Shift ${report.version}${report.release ? '' : ' (development build)'}`];
  const service = !report.service.manager
    ? 'systemd user manager unreachable'
    : !report.service.installed
      ? 'not installed (shift service install --start)'
      : `${report.service.active}${report.service.enabled ? ', enabled' : ', not enabled'}`;
  lines.push(`Service   ${service}`);
  if (report.service.installed && report.linger !== true)
    lines.push(
      '          Stops at logout and does not start at boot until you run, as an administrator:',
      `          sudo loginctl enable-linger ${process.env['USER'] ?? process.getuid!()}`,
    );
  lines.push(
    `Server    ${
      report.server.ready
        ? `ready, ID ${report.server.serverId}`
        : report.server.running
          ? `not ready (${report.server.reason ?? 'unknown'})`
          : 'not running'
    }`,
    `Address   ${report.address}`,
  );
  if (/\/\/(127\.0\.0\.1|\[::1\])/.test(report.address))
    lines.push(
      '          Only this machine can connect. Other devices pair through an HTTPS reverse proxy',
      '          in front of this address; see the Linux service guide.',
    );
  if (report.devices !== null)
    lines.push(
      `Devices   ${
        report.devices === 0
          ? 'none paired. Pair the desktop app: shift device pair'
          : `${report.devices} paired`
      }`,
    );
  lines.push(`State     ${report.stateDirectory}`);
  write(lines.join('\n'));
}

// Waits until the server answers ready, or the unit stops trying.
async function waitReady(
  stateDirectory: string,
  systemd: UserSystemd,
  timeoutMs: number,
): Promise<Readiness> {
  const started = Date.now();
  for (;;) {
    const current = await readiness(stateDirectory);
    if (current.ready) return current;
    const unit = await systemd.state();
    // A server that exits is restarted by systemd after a pause (auto-restart), so that state is
    // a failure too; inactive right after the start command may just not be reported yet.
    if (
      unit.active === 'failed' ||
      unit.sub === 'auto-restart' ||
      (unit.active === 'inactive' && Date.now() - started > 3000)
    )
      throw new ShiftError(
        'SERVICE_FAILED',
        'The service stopped while starting. See: shift service logs',
      );
    if (Date.now() - started > timeoutMs)
      throw new ShiftError(
        'SERVICE_NOT_READY',
        `The server did not become ready${current.reason ? ` (${current.reason})` : ''}. See: shift service logs`,
      );
    await delay(500);
  }
}

// The first start of a server nobody has paired with shows a pairing phrase right away. It is
// written to this terminal only; the service log never holds it.
async function offerPairing(stateDirectory: string): Promise<void> {
  if ((await pairedDevices(stateDirectory)) !== 0) return;
  const { status, payload } = await administrativeCall(stateDirectory, {
    method: 'POST',
    path: '/api/v0/admin/pairing',
    body: { commandId: randomUUID() },
  });
  if (status >= 400) return;
  const { pairing } = payload as { pairing: { phrase: string; expiresAt: number } };
  const minutes = Math.max(1, Math.round((pairing.expiresAt - Date.now()) / 60_000));
  write(
    [
      '',
      'No device is paired yet. In the desktop app, connect to this server and enter:',
      '',
      `    ${pairing.phrase}`,
      '',
      `The phrase works once, for ${minutes} minutes. Run shift device pair for another.`,
    ].join('\n'),
  );
}

async function writeAtomically(path: string, text: string, mode: number): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, { mode, flag: 'wx' });
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function requireOk(
  result: Promise<{ code: number; stderr: string }>,
  message: string,
): Promise<void> {
  const outcome = await result;
  if (outcome.code !== 0)
    throw new ShiftError(
      'SERVICE_COMMAND_FAILED',
      `${message} ${outcome.stderr.trim().split('\n').at(-1) ?? ''}`.trim(),
    );
}

async function install(
  values: Values,
  stateDirectory: string,
  systemd: UserSystemd,
): Promise<void> {
  const release = await installedRelease();
  if (!release)
    throw invalid(
      'Install a Shift release with install.sh first; a development build cannot run as the service.',
    );
  const paths = servicePaths();
  const current = await stat(join(paths.current, 'bin', 'shift')).catch(() => null);
  if (!current)
    throw invalid(`${paths.current} has no Shift release. Install one with install.sh first.`);
  const unit = await systemd.state();
  if (!unit.manager)
    throw new ShiftError(
      'SYSTEMD_UNAVAILABLE',
      'systemctl --user cannot reach your systemd user manager. Log in with a normal session (ssh or console) and try again.',
    );
  await mkdir(paths.configDirectory, { recursive: true, mode: 0o700 });
  await chmod(paths.configDirectory, 0o700);
  if ((await readOptional(paths.environmentFile)) === null) {
    await writeAtomically(
      paths.environmentFile,
      renderEnvironment({ path: process.env['PATH'] ?? '/usr/bin:/bin', stateDirectory }),
      0o600,
    );
    write(`Wrote settings to ${paths.environmentFile}`);
  }
  const rendered = renderUnit(paths);
  const existing = await readOptional(paths.unitFile);
  if (existing !== rendered) {
    if (existing !== null && !existing.startsWith(managedMarker) && !values.force)
      throw invalid(
        `${paths.unitFile} was not written by Shift. Move it away, or pass --force to replace it.`,
      );
    await mkdir(paths.unitDirectory, { recursive: true, mode: 0o700 });
    await writeAtomically(paths.unitFile, rendered, 0o644);
    write(`Wrote ${paths.unitFile}`);
  }
  await requireOk(systemd.systemctl('daemon-reload'), 'systemctl --user daemon-reload failed.');
  await requireOk(systemd.systemctl('enable', unitName), 'Cannot enable the service.');
  if (values.start) await start(values, stateDirectory, systemd);
  else write('Installed. Start it with: shift service start');
}

async function start(values: Values, stateDirectory: string, systemd: UserSystemd): Promise<void> {
  await requireOk(systemd.systemctl('start', unitName), 'Cannot start the service.');
  await waitReady(stateDirectory, systemd, timeout(values));
  printStatus(await statusReport(stateDirectory, systemd));
  await offerPairing(stateDirectory);
}

function timeout(values: Values): number {
  if (values.timeout === undefined) return 60_000;
  if (!/^\d{1,4}$/.test(values.timeout)) throw invalid('--timeout is a number of seconds.');
  return Number(values.timeout) * 1000;
}

// The installed release's own installer verifies and switches versions; the CLI only hands over.
async function upgrade(archive: string | undefined, values: Values): Promise<void> {
  if (!archive) throw invalid('Usage: shift upgrade ARCHIVE [--sums SHA256SUMS] [--allow-active]');
  const release = await installedRelease();
  if (!release) throw invalid('Upgrades work from an installed release only.');
  const args = ['--archive', archive, '--upgrade'];
  if (values.sums) args.push('--sums', values.sums);
  if (values['allow-active']) args.push('--allow-active');
  const child = spawn(join(release.root, 'install.sh'), args, { stdio: 'inherit' });
  const code = await new Promise<number>((resolve) =>
    child.on('close', (value) => resolve(value ?? 1)),
  );
  process.exitCode = code;
}

export interface UpgradeCheck {
  compatible: boolean;
  applied: number;
  pending: number;
  running: number;
  problem: string | null;
}

// Run by the release being installed, against the current data, before anything is switched. It
// opens the database read-only and asks the running server, if any, about active work.
async function upgradeCheck(values: Values, stateDirectory: string): Promise<void> {
  if (values.resume) {
    await administrativeCall(stateDirectory, {
      method: 'POST',
      path: '/api/v0/admin/upgrade/resume',
    }).catch(() => undefined);
    return;
  }
  const migrations = readMigrationFiles({ migrationsFolder: migrationsDirectory });
  const result: UpgradeCheck = {
    compatible: true,
    applied: 0,
    pending: migrations.length,
    running: 0,
    problem: null,
  };
  const path = join(stateDirectory, 'shift.db');
  if (await stat(path).catch(() => null)) {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
        )
        .get();
      const applied = table
        ? (db
            .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
            .all() as {
            hash: string;
            created_at: number;
          }[])
        : [];
      result.applied = applied.length;
      result.pending = Math.max(0, migrations.length - applied.length);
      if (
        applied.length > migrations.length ||
        applied.some(
          (entry, index) =>
            entry.hash !== migrations[index]!.hash ||
            entry.created_at !== migrations[index]!.folderMillis,
        )
      ) {
        result.compatible = false;
        result.problem =
          'The database was migrated by a newer or different Shift build; this version cannot open it.';
      }
    } finally {
      db.close();
    }
  }
  if (result.compatible && !values['database-only']) {
    // Pauses the running server's dispatch and counts its running steps in one request, so no step
    // starts between this check and the installer's stop. A refusal hands dispatch back.
    let quiesce: { status: number; payload: unknown } | null = null;
    try {
      quiesce = await administrativeCall(stateDirectory, {
        method: 'POST',
        path: '/api/v0/admin/upgrade/quiesce',
        body: { holdSeconds: 120 },
      });
    } catch {
      // No running server: nothing is in flight.
    }
    if (quiesce?.status === 200) result.running = (quiesce.payload as { active: number }).active;
    else if (quiesce)
      throw new ShiftError(
        'UPGRADE_CHECK_FAILED',
        'The running server cannot pause for an upgrade. Stop it first: shift service stop',
      );
    if (result.running > 0 && !values['allow-active']) {
      await administrativeCall(stateDirectory, {
        method: 'POST',
        path: '/api/v0/admin/upgrade/resume',
      }).catch(() => undefined);
      result.compatible = false;
      result.problem = `${result.running} step${result.running === 1 ? ' is' : 's are'} running. Upgrading stops ${result.running === 1 ? 'it' : 'them'}, and recovery continues on the new version. Wait, hold the run, or pass --allow-active.`;
    }
  }
  write(JSON.stringify(result));
  if (!result.compatible) process.exitCode = 1;
}

function printChecks(checks: Check[]): void {
  const marks = { ok: '✓', warn: '!', fail: '✗' } as const;
  const lines: string[] = [];
  for (const item of checks) {
    lines.push(`${marks[item.status]} ${item.id.padEnd(9)} ${item.summary}`);
    if (item.hint) lines.push(`  ${' '.repeat(9)} ${item.hint}`);
  }
  write(lines.join('\n'));
}

// `shift` with no command, `shift version|status|doctor|upgrade` and `shift service …`.
export async function serviceCommand(command: string, args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({ args, strict: true, allowPositionals: true, options });
  } catch {
    throw invalid('Invalid command options. Run shift help.');
  }
  const values = parsed.values as Values;
  const positionals = parsed.positionals;
  const stateDirectory = resolveStateDirectory(values['state-dir']);
  const systemd = new UserSystemd();
  const action = command === 'service' ? positionals.shift() : undefined;
  const extra = command === 'upgrade' ? positionals.slice(1) : positionals;
  if (extra.length > 0) throw invalid('Too many arguments. Run shift help.');
  switch (command === 'service' ? `service ${action ?? ''}` : command) {
    case 'version': {
      const report = await versionReport();
      return write(
        values.json
          ? JSON.stringify(report)
          : `Shift ${report.version}${report.release ? '' : ' (development build)'}, Node ${report.node}, SQLite ${report.sqlite}, linux-${report.arch}`,
      );
    }
    case 'status':
    case 'service status': {
      const report = await statusReport(stateDirectory, systemd);
      return values.json ? write(JSON.stringify(report)) : printStatus(report);
    }
    case 'doctor': {
      const checks = await doctor({ stateDirectory });
      if (values.json) write(JSON.stringify({ checks }));
      else printChecks(checks);
      if (checks.some((item) => item.status === 'fail')) process.exitCode = 1;
      return;
    }
    case 'upgrade':
      return upgrade(positionals[0], values);
    case 'upgrade-check':
      return upgradeCheck(values, stateDirectory);
    case 'service install':
      return install(values, stateDirectory, systemd);
    case 'service start':
      return start(values, stateDirectory, systemd);
    case 'service restart':
      await requireOk(systemd.systemctl('restart', unitName), 'Cannot restart the service.');
      await waitReady(stateDirectory, systemd, timeout(values));
      return printStatus(await statusReport(stateDirectory, systemd));
    case 'service stop':
      // systemctl waits for the server's own bounded shutdown before it returns.
      await requireOk(systemd.systemctl('stop', unitName), 'Cannot stop the service.');
      return write(
        'Stopped. Steps it interrupted are reconciled when it starts again: shift run list.',
      );
    case 'service uninstall': {
      const paths = servicePaths();
      const existing = await readOptional(paths.unitFile);
      if (existing !== null && !existing.startsWith(managedMarker))
        throw invalid(`${paths.unitFile} was not written by Shift; it is left in place.`);
      await systemd.systemctl('disable', '--now', unitName);
      if (existing !== null) await unlink(paths.unitFile);
      await systemd.systemctl('daemon-reload');
      return write(
        `Removed the service. Your data in ${stateDirectory} and settings in ${paths.environmentFile} are kept.`,
      );
    }
    case 'service logs': {
      const lines = values.lines ?? '100';
      if (!/^\d{1,6}$/.test(lines)) throw invalid('--lines is a number.');
      const child = spawn(
        'journalctl',
        [
          '--user',
          '--unit',
          unitName,
          '--lines',
          lines,
          '--no-pager',
          ...(values.follow ? ['--follow'] : []),
        ],
        { stdio: 'inherit' },
      );
      process.exitCode = await new Promise<number>((resolve) =>
        child.on('close', (code) => resolve(code ?? 1)),
      );
      return;
    }
    default:
      throw invalid('Unknown command. Run shift help.');
  }
}
