import { execFile } from 'node:child_process';
import { unitName } from './paths.js';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Execute = (command: string, args: string[]) => Promise<CommandResult>;

// Runs a command without a shell and reports its exit code instead of throwing.
export const execute: Execute = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 120_000, maxBuffer: 4 << 20 }, (error, stdout, stderr) => {
      const code =
        error === null ? 0 : typeof error.code === 'number' ? error.code : error.code ? 127 : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

export interface UnitState {
  // False when the user manager cannot be reached at all.
  manager: boolean;
  installed: boolean;
  enabled: boolean;
  active: string;
  sub: string;
  since: string | null;
}

export class UserSystemd {
  constructor(private readonly run: Execute = execute) {}

  systemctl(...args: string[]): Promise<CommandResult> {
    return this.run('systemctl', ['--user', ...args]);
  }

  async state(): Promise<UnitState> {
    const result = await this.systemctl(
      'show',
      unitName,
      '--property=LoadState,ActiveState,SubState,UnitFileState,ActiveEnterTimestamp',
    );
    if (result.code !== 0)
      return {
        manager: false,
        installed: false,
        enabled: false,
        active: 'unknown',
        sub: 'unknown',
        since: null,
      };
    const values = new Map(
      result.stdout
        .split('\n')
        .map((line) => line.split('=', 2) as [string, string | undefined])
        .filter((pair): pair is [string, string] => pair[1] !== undefined),
    );
    return {
      manager: true,
      installed: values.get('LoadState') === 'loaded',
      enabled: values.get('UnitFileState') === 'enabled',
      active: values.get('ActiveState') ?? 'unknown',
      sub: values.get('SubState') ?? 'unknown',
      since: values.get('ActiveEnterTimestamp') || null,
    };
  }

  // Whether the account's services keep running without a login session and start at boot.
  async linger(): Promise<boolean | null> {
    const result = await this.run('loginctl', [
      'show-user',
      String(process.getuid!()),
      '--property=Linger',
      '--value',
    ]);
    if (result.code !== 0) return null;
    const value = result.stdout.trim();
    return value === 'yes' ? true : value === 'no' ? false : null;
  }
}
