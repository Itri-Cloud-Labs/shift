import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { ShiftError } from '../domain/errors.js';

const run = promisify(execFile);
const unitName = /^[A-Za-z0-9_.-]{1,200}$/;

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

  // The command runs with exactly `env`. systemd-run itself keeps this process's environment so it
  // can reach the manager's bus; `env -i` then replaces the environment before the command starts.
  spawn(
    unit: string,
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string> },
  ): ChildProcess {
    if (!unitName.test(unit)) throw new ShiftError('INVALID_UNIT_NAME', 'Invalid scope name.');
    const assignments = Object.entries(options.env).map(([key, value]) => `${key}=${value}`);
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
        '-i',
        ...assignments,
        command,
        ...args,
      ],
      { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] },
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
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
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
      .map((line) => line.trim().split(/\s+/)[0] ?? '')
      .filter((name) => name.startsWith(prefix) && name.endsWith('.scope'))
      .map((name) => name.slice(0, -'.scope'.length));
  }
}
