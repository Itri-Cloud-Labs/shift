import { constants } from 'node:fs';
import { access, lstat, statfs } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { administrativeCall } from '../admin-client.js';
import { publicError } from '../domain/errors.js';
import { installedRelease, versionReport } from '../release.js';
import type { Execute } from './systemd.js';
import { UserSystemd } from './systemd.js';
import { readServiceEnvironment, servicePaths } from './paths.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  id: string;
  status: CheckStatus;
  summary: string;
  hint?: string;
}

export interface DoctorOptions {
  stateDirectory: string;
  env?: NodeJS.ProcessEnv;
  execute?: Execute;
  // Bytes free below which the disk check warns or fails.
  diskWarnBytes?: number;
  diskFailBytes?: number;
}

const check = (id: string, status: CheckStatus, summary: string, hint?: string): Check =>
  hint === undefined ? { id, status, summary } : { id, status, summary, hint };

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

async function executable(name: string, path: string): Promise<string | null> {
  const candidates = name.includes('/')
    ? [name]
    : path
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, name));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next directory.
    }
  }
  return null;
}

// A private file must be a regular file of this account that no one else can read or write.
async function privateEntry(
  path: string,
  kind: 'file' | 'directory' | 'socket',
): Promise<'missing' | 'ok' | string> {
  try {
    const metadata = await lstat(path);
    const typed =
      kind === 'file'
        ? metadata.isFile()
        : kind === 'directory'
          ? metadata.isDirectory()
          : metadata.isSocket();
    if (!typed) return `${path} is not a ${kind}`;
    if (metadata.uid !== process.getuid!()) return `${path} belongs to another account`;
    if ((metadata.mode & 0o077) !== 0)
      return `${path} has mode ${(metadata.mode & 0o777).toString(8)}; others can reach it`;
    return 'ok';
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'missing';
    return `${path} cannot be inspected`;
  }
}

async function freeBytes(path: string): Promise<number | null> {
  for (let current = path; ; current = dirname(current)) {
    try {
      const stats = await statfs(current);
      return stats.bavail * stats.bsize;
    } catch {
      if (dirname(current) === current) return null;
    }
  }
}

const mebibytes = (bytes: number) => `${Math.floor(bytes / 1024 / 1024)} MiB`;

// Checks a Linux installation without changing it. Summaries name settings and paths, never their
// secret values: the settings file may hold provider keys and is only read for PATH and the host.
export async function doctor(options: DoctorOptions): Promise<Check[]> {
  const env = options.env ?? process.env;
  const systemd = new UserSystemd(options.execute);
  const run = options.execute ?? (await import('./systemd.js')).execute;
  const checks: Check[] = [];
  const release = await installedRelease();

  const glibc = (process.report.getReport() as { header?: { glibcVersionRuntime?: string } }).header
    ?.glibcVersionRuntime;
  const minimumGlibc = release?.manifest.minimumGlibc ?? '2.35';
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch))
    checks.push(check('platform', 'fail', `${process.platform}-${process.arch} is not supported.`));
  else if (!glibc)
    checks.push(
      check('platform', 'fail', 'This system does not use glibc; Shift needs glibc Linux.'),
    );
  else if (compareVersions(glibc, minimumGlibc) < 0)
    checks.push(check('platform', 'fail', `glibc ${glibc} is older than ${minimumGlibc}.`));
  else checks.push(check('platform', 'ok', `Linux ${process.arch}, glibc ${glibc}`));

  try {
    const report = await versionReport();
    if (release && report.node !== `v${release.manifest.node}`)
      checks.push(
        check(
          'runtime',
          'fail',
          `Running Node ${report.node}, but this release ships ${release.manifest.node}.`,
          'Reinstall the release with install.sh.',
        ),
      );
    else
      checks.push(
        check(
          'runtime',
          'ok',
          `Shift ${report.version}${release ? '' : ' (development build)'}, Node ${report.node}, SQLite ${report.sqlite}`,
        ),
      );
  } catch (error) {
    checks.push(check('runtime', 'fail', publicError(error).message));
  }

  const state = options.stateDirectory;
  const stateProblems: string[] = [];
  const directory = await privateEntry(state, 'directory');
  if (directory === 'missing')
    checks.push(check('state', 'warn', `${state} does not exist yet; the server creates it.`));
  else {
    if (directory !== 'ok') stateProblems.push(directory);
    for (const [path, kind] of [
      [join(state, 'secrets'), 'directory'],
      [join(state, 'secrets', 'master.key'), 'file'],
      [join(state, 'shift.db'), 'file'],
      [join(state, 'shift.db-wal'), 'file'],
      [join(state, 'shift.db-shm'), 'file'],
      [join(state, 'admin.sock'), 'socket'],
    ] as const) {
      const result = await privateEntry(path, kind);
      if (result !== 'ok' && result !== 'missing') stateProblems.push(result);
    }
    checks.push(
      stateProblems.length
        ? check(
            'state',
            'fail',
            stateProblems.join('; '),
            'State files must belong to this account with no access for others (chmod go-rwx).',
          )
        : check('state', 'ok', `${state} and its keys, database and socket are private`),
    );
  }

  const free = await freeBytes(state);
  const failBytes = options.diskFailBytes ?? 256 * 1024 * 1024;
  const warnBytes = options.diskWarnBytes ?? 2 * 1024 * 1024 * 1024;
  checks.push(
    free === null
      ? check('disk', 'warn', 'Cannot measure free space for the state directory.')
      : free < failBytes
        ? check(
            'disk',
            'fail',
            `${mebibytes(free)} free; the server stops admitting work when storage fails.`,
          )
        : free < warnBytes
          ? check('disk', 'warn', `${mebibytes(free)} free for the state directory.`)
          : check('disk', 'ok', `${mebibytes(free)} free`),
  );

  const unit = await systemd.state();
  if (!unit.manager)
    checks.push(
      check(
        'service',
        release ? 'fail' : 'warn',
        'systemctl --user cannot reach your systemd user manager.',
        'Log in with a normal session (ssh or console), or enable lingering, then try again.',
      ),
    );
  else if (!unit.installed)
    checks.push(
      check(
        'service',
        'warn',
        'The service is not installed.',
        'Run: shift service install --start',
      ),
    );
  else
    checks.push(
      check(
        'service',
        unit.active === 'active' && unit.enabled ? 'ok' : 'warn',
        `Service ${unit.active}${unit.enabled ? ', enabled' : ', not enabled'}`,
        unit.active === 'active' ? undefined : 'Run: shift service start',
      ),
    );
  const linger = unit.manager ? await systemd.linger() : null;
  const user = env['USER'] ?? env['LOGNAME'] ?? String(process.getuid!());
  checks.push(
    linger === true
      ? check('linger', 'ok', 'The service keeps running after you log out and starts at boot')
      : check(
          'linger',
          'warn',
          linger === false
            ? 'The service stops when you log out and does not start at boot.'
            : 'Cannot tell whether the service survives logout.',
          `Run once, as an administrator: sudo loginctl enable-linger ${user}`,
        ),
  );

  let ready = false;
  try {
    const health = await administrativeCall(state, { method: 'GET', path: '/api/v0/ready' });
    const readiness = (health.payload as { readiness?: { ready?: boolean; reason?: string } })
      .readiness;
    ready = readiness?.ready === true;
    checks.push(
      ready
        ? check('server', 'ok', 'The server is ready')
        : check(
            'server',
            'fail',
            `The server is not ready: ${readiness?.reason ?? 'unknown'}.`,
            'See: shift service logs',
          ),
    );
  } catch {
    checks.push(
      check(
        'server',
        unit.active === 'active' ? 'fail' : 'warn',
        'The server is not running.',
        unit.installed ? 'Run: shift service start' : 'Run: shift service install --start',
      ),
    );
  }

  // Tools the service finds through its own PATH, which the settings file sets.
  const settings = readServiceEnvironment(env);
  const servicePath = settings?.get('PATH') ?? env['PATH'] ?? '';
  const pathSource = settings?.has('PATH') ? 'the service PATH' : 'your PATH';
  const opencodeName =
    settings?.get('SHIFT_OPENCODE_EXECUTABLE') ?? env['SHIFT_OPENCODE_EXECUTABLE'] ?? 'opencode';
  const opencode = await executable(opencodeName, servicePath);
  checks.push(
    opencode
      ? check(
          'opencode',
          'ok',
          `${opencode}; Shift checks its version and your sign-in when an agent step first starts it`,
        )
      : check(
          'opencode',
          'fail',
          `OpenCode is not on ${pathSource}.`,
          `Install OpenCode, or set PATH or SHIFT_OPENCODE_EXECUTABLE in ${servicePaths(env).environmentFile}.`,
        ),
  );
  const git = await executable('git', servicePath);
  if (!git) checks.push(check('git', 'fail', `git is not on ${pathSource}.`));
  else {
    const name = await run(git, ['config', '--global', 'user.name']);
    const email = await run(git, ['config', '--global', 'user.email']);
    checks.push(
      name.stdout.trim() && email.stdout.trim()
        ? check('git', 'ok', `${git}, with a commit identity`)
        : check(
            'git',
            'warn',
            `${git} has no global commit identity; Commit steps fail without one.`,
            'Run: git config --global user.name "…" and git config --global user.email "…"',
          ),
    );
  }

  if (ready) {
    const apps = await administrativeCall(state, {
      method: 'GET',
      path: '/api/v0/admin/github/apps',
    })
      .then((response) => (response.payload as { apps?: unknown[] }).apps?.length ?? 0)
      .catch(() => null);
    checks.push(
      apps === null
        ? check('github', 'warn', 'Cannot list GitHub Apps.')
        : apps === 0
          ? check(
              'github',
              'warn',
              'No GitHub App is registered; GitHub steps and triggers need one.',
              'Run: shift github register --app-id ID --key-file APP.pem',
            )
          : check('github', 'ok', `${apps} GitHub App${apps === 1 ? '' : 's'} registered`),
    );
  }

  const host = settings?.get('SHIFT_HOST') ?? env['SHIFT_HOST'] ?? '127.0.0.1';
  checks.push(
    ['127.0.0.1', '::1'].includes(host)
      ? check(
          'access',
          'ok',
          `Listening on ${host} only; other devices reach it through your HTTPS reverse proxy`,
        )
      : check(
          'access',
          'warn',
          `Listening on ${host} without TLS.`,
          'Keep SHIFT_HOST on 127.0.0.1 and put an HTTPS reverse proxy in front instead.',
        ),
  );
  return checks;
}
