import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { Clock } from '../src/domain/clock.js';
import type { ServerConfig } from '../src/config.js';

export const workspace = fileURLToPath(new URL('../', import.meta.url));
export const cli = join(workspace, 'dist/cli.js');

export class FakeClock implements Clock {
  constructor(private time = 1790985600000) {}
  now(): number {
    return this.time;
  }
  advance(milliseconds: number): void {
    this.time += milliseconds;
  }
}

export async function temporaryState(): Promise<{ path: string; remove(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'shift-server-'));
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

export function configFor(stateDirectory: string): ServerConfig {
  return {
    stateDirectory,
    host: '127.0.0.1',
    port: 0,
    publicAccess: false,
    shutdownTimeoutMs: 300,
    logLevel: 'silent',
  };
}

export async function eventually<T>(read: () => T | undefined, timeoutMs = 10000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await delay(20);
  }
  throw new Error('Timed out waiting for the owned test process.');
}

export interface OwnedProcess {
  child: ChildProcess;
  output(): string;
  errors(): string;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  terminate(signal?: NodeJS.Signals): Promise<void>;
}

export function ownedProcess(args: string[], env: NodeJS.ProcessEnv = {}): OwnedProcess {
  const cleanEnvironment = { ...process.env };
  for (const key of Object.keys(cleanEnvironment))
    if (key.startsWith('SHIFT_')) delete cleanEnvironment[key];
  const child = spawn(process.execPath, args, {
    cwd: workspace,
    env: { ...cleanEnvironment, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stdout!.on('data', (chunk) => {
    output = `${output}${String(chunk)}`.slice(-256 * 1024);
  });
  child.stderr!.on('data', (chunk) => {
    errors = `${errors}${String(chunk)}`.slice(-256 * 1024);
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );
  return {
    child,
    output: () => output,
    errors: () => errors,
    exit,
    async terminate(signal = 'SIGTERM') {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      const timeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 3000);
      try {
        await exit;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export async function startChild(stateDirectory: string): Promise<OwnedProcess & { url: string }> {
  const process = ownedProcess([
    cli,
    'serve',
    '--state-dir',
    stateDirectory,
    '--port',
    '0',
    '--shutdown-timeout-ms',
    '300',
  ]);
  try {
    const url = await eventually(() => {
      if (process.child.exitCode !== null || process.child.signalCode !== null)
        throw new Error(`Server startup failed: ${process.errors()}`);
      for (const line of process.output().split('\n')) {
        try {
          const event: unknown = JSON.parse(line);
          if (
            event &&
            typeof event === 'object' &&
            'event' in event &&
            event.event === 'server.ready' &&
            'url' in event &&
            typeof event.url === 'string'
          )
            return event.url;
        } catch {
          /* The final stdout line may still be incomplete. */
        }
      }
      return undefined;
    });
    return { ...process, url };
  } catch (error) {
    await process.terminate('SIGKILL');
    throw error;
  }
}

export async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; output: string; errors: string }> {
  const process = ownedProcess([cli, ...args], env);
  const timeout = setTimeout(() => {
    if (process.child.exitCode === null && process.child.signalCode === null)
      process.child.kill('SIGKILL');
  }, 5000);
  try {
    const result = await process.exit;
    return { code: result.code, output: process.output(), errors: process.errors() };
  } finally {
    clearTimeout(timeout);
  }
}
