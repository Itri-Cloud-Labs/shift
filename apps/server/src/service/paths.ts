import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { defaultStateDirectory } from '../config.js';
import { ShiftError } from '../domain/errors.js';

// Where an installed Shift keeps its program, settings and systemd unit, under the XDG base
// directories of the account it runs as.
export interface ServicePaths {
  dataDirectory: string;
  current: string;
  configDirectory: string;
  environmentFile: string;
  unitDirectory: string;
  unitFile: string;
}

export const unitName = 'shift.service';

function base(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  if (value === undefined || value === '') return join(env['HOME'] || homedir(), fallback);
  if (!isAbsolute(value))
    throw new ShiftError('INVALID_CONFIGURATION', `${name} must be an absolute path.`, 422);
  return value;
}

export function servicePaths(env: NodeJS.ProcessEnv = process.env): ServicePaths {
  const data = join(base(env, 'XDG_DATA_HOME', '.local/share'), 'shift');
  const config = base(env, 'XDG_CONFIG_HOME', '.config');
  return {
    dataDirectory: data,
    current: join(data, 'current'),
    configDirectory: join(config, 'shift'),
    environmentFile: join(config, 'shift', 'server.env'),
    unitDirectory: join(config, 'systemd', 'user'),
    unitFile: join(config, 'systemd', 'user', unitName),
  };
}

// KEY=VALUE lines as systemd's EnvironmentFile reads them, for the few keys the CLI needs to agree
// with the service on. Comments and blank lines are skipped; surrounding double quotes are removed.
export function parseEnvironment(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const raw = match[2]!.trim();
    values.set(
      match[1]!,
      raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw,
    );
  }
  return values;
}

export function readServiceEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Map<string, string> | null {
  try {
    return parseEnvironment(readFileSync(servicePaths(env).environmentFile, 'utf8'));
  } catch {
    return null;
  }
}

// --state-dir, then SHIFT_STATE_DIR, then the installed service's setting, then the XDG default,
// so commands typed in a shell reach the same server the service runs.
export function resolveStateDirectory(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (flag !== undefined) return resolve(flag);
  if (env['SHIFT_STATE_DIR']) return resolve(env['SHIFT_STATE_DIR']);
  const configured = readServiceEnvironment(env)?.get('SHIFT_STATE_DIR');
  if (configured && !isAbsolute(configured))
    throw new ShiftError(
      'INVALID_CONFIGURATION',
      'SHIFT_STATE_DIR in the service settings must be an absolute path.',
      422,
    );
  return configured || defaultStateDirectory(env);
}
