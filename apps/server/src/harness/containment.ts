import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { ShiftError } from '../domain/errors.js';

const run = promisify(execFile);
// What systemd-run uses to find the user manager.
const busVariables = ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'];

const unitName = /^[A-Za-z0-9_.-]{1,200}$/;
const dead = ['inactive', 'failed'];

export type SystemdManager = 'user' | 'system';

// Runs a process inside its own transient systemd scope. Descendants stay in the scope's cgroup
// even after `setsid` or re-parenting, so killing the scope accounts for every one of them.
export class SystemdScopes {
  constructor(readonly manager: SystemdManager = 'user') {}

  private get flags(): string[] {
    return this.manager === 'user' ? ['--user'] : [];
  }

  private async systemctl(args: string[]): Promise<string> {
    const { stdout } = await run('systemctl', [...this.flags, ...args], { timeout: 10_000 });
    return stdout;
  }

  async available(): Promise<boolean> {
    try {
      await run('systemd-run', [...this.flags, '--scope', '--quiet', '--collect', '--', 'true'], {
        timeout: 10_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  // The command runs with exactly `env`. systemd-run also needs this process's bus variables to
  // reach its manager; `env -u` removes those the command was not given. Values never appear in
  // the command line, which other accounts can read; a process environment is private to its owner.
  spawn(
    unit: string,
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string> },
  ): ChildProcess {
    if (!unitName.test(unit)) throw new ShiftError('INVALID_UNIT_NAME', 'Invalid scope name.');
    const bus: Record<string, string> = {};
    for (const key of busVariables) {
      const value = process.env[key];
      if (value !== undefined && !(key in options.env)) bus[key] = value;
    }
    const unset = Object.keys(bus).flatMap((key) => ['-u', key]);
    return spawn(
      'systemd-run',
      [
        ...this.flags,
        '--scope',
        '--quiet',
        '--collect',
        `--unit=${unit}`,
        '--',
        'env',
        ...unset,
        command,
        ...args,
      ],
      { cwd: options.cwd, env: { ...options.env, ...bus }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  }

  async members(unit: string): Promise<number[]> {
    const cgroup = (
      await this.systemctl(['show', '--property=ControlGroup', '--value', `${unit}.scope`])
    ).trim();
    if (!cgroup) return [];
    try {
      const procs = await readFile(`/sys/fs/cgroup${cgroup}/cgroup.procs`, 'utf8');
      return procs.split('\n').filter(Boolean).map(Number);
    } catch (error) {
      // ENODEV: systemd is removing the emptied cgroup while it is being read.
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'ENOENT' || code === 'ENODEV') return [];
      throw error;
    }
  }

  // Resolves only once the scope holds no processes.
  async kill(unit: string, timeoutMs = 5_000): Promise<void> {
    try {
      await this.systemctl(['kill', '--signal=SIGKILL', `${unit}.scope`]);
    } catch {
      // An unloaded unit has nothing left to kill; membership below is the authority.
    }
    const deadline = Date.now() + timeoutMs;
    while ((await this.members(unit)).length > 0) {
      if (Date.now() > deadline) {
        throw new ShiftError(
          'HARNESS_CONTAINMENT_FAILED',
          'Processes remained in a harness scope after it was killed.',
        );
      }
      await delay(50);
    }
  }

  // Scopes that may still hold processes. Dead units can stay listed until systemd collects them.
  async list(prefix: string): Promise<string[]> {
    const output = await this.systemctl([
      'list-units',
      '--type=scope',
      '--all',
      '--plain',
      '--no-legend',
      '--no-pager',
      `${prefix}*`,
    ]);
    return output
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter(
        ([name = '', , active = '']) =>
          name.startsWith(prefix) && name.endsWith('.scope') && !dead.includes(active),
      )
      .map(([name = '']) => name.slice(0, -'.scope'.length));
  }
}
