import { homedir } from 'node:os';
import { isIP } from 'node:net';
import { isAbsolute, join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { ShiftError } from './domain/errors.js';

export interface ServerConfig {
  stateDirectory: string;
  host: string;
  port: number;
  publicAccess: boolean;
  shutdownTimeoutMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  sqliteNativeBinding?: string;
}

const validate = new Ajv2020({
  strict: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
}).compile({
  type: 'object',
  additionalProperties: false,
  required: ['stateDirectory', 'host', 'port', 'publicAccess', 'shutdownTimeoutMs', 'logLevel'],
  properties: {
    stateDirectory: { type: 'string', minLength: 1, maxLength: 4096 },
    host: { type: 'string', minLength: 1, maxLength: 45 },
    port: { type: 'integer', minimum: 0, maximum: 65535 },
    publicAccess: { type: 'boolean' },
    shutdownTimeoutMs: { type: 'integer', minimum: 100, maximum: 30000 },
    logLevel: { enum: ['debug', 'info', 'warn', 'error', 'silent'] },
    sqliteNativeBinding: { type: 'string', minLength: 1, maxLength: 4096 },
  },
});

export function defaultStateDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const base = env['XDG_STATE_HOME'];
  if (base !== undefined && !isAbsolute(base)) {
    throw new ShiftError('INVALID_CONFIGURATION', 'XDG_STATE_HOME must be an absolute path.', 422);
  }
  return join(base ?? join(homedir(), '.local', 'state'), 'shift');
}

export function validateConfig(input: unknown): ServerConfig {
  if (!validate(input)) {
    throw new ShiftError(
      'INVALID_CONFIGURATION',
      'Invalid server configuration.',
      422,
      false,
      (validate.errors ?? []).map((error) => error.instancePath || '/configuration'),
    );
  }
  const config = input as ServerConfig;
  if (
    isIP(config.host) === 0 ||
    (!config.publicAccess && !['127.0.0.1', '::1'].includes(config.host))
  ) {
    throw new ShiftError(
      'INVALID_CONFIGURATION',
      'Use a loopback IP address, or explicitly enable --public for another IP.',
      422,
    );
  }
  if (config.stateDirectory.includes('\0') || config.sqliteNativeBinding?.includes('\0')) {
    throw new ShiftError('INVALID_CONFIGURATION', 'Paths cannot contain NUL bytes.', 422);
  }
  return {
    ...config,
    stateDirectory: resolve(config.stateDirectory),
    ...(config.sqliteNativeBinding === undefined
      ? {}
      : { sqliteNativeBinding: resolve(config.sqliteNativeBinding) }),
  };
}
