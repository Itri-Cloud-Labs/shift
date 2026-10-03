#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultStateDirectory, validateConfig } from './config.js';
import { publicError, ShiftError } from './domain/errors.js';
import { administrativeRequest } from './admin-client.js';
import {
  validateServerInfo,
  validateServerHealth,
  validateShutdownAcknowledgement,
  type ProtocolError,
} from './protocol/index.js';
import { startServer } from './server.js';

const usage = `Shift server foundation

shift serve [--state-dir PATH] [--host 127.0.0.1] [--port 4317] [--public]
            [--shutdown-timeout-ms 5000] [--log-level info]
            [--sqlite-native-binding PATH]
shift info|health|ready|stop [--state-dir PATH]

TCP serves read-only /api/v0/info, /health and /ready. Administration uses
the private admin.sock in the state directory. Pairing/execution are unavailable.
--public explicitly permits a non-loopback IP; it exposes no administration.
`;

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value))
    throw new ShiftError(
      'INVALID_CONFIGURATION',
      'Numeric options must be nonnegative integers.',
      422,
    );
  return Number(value);
}

async function main(): Promise<void> {
  process.umask(0o077);
  const args = process.argv.slice(2);
  const command = args[0] ?? 'serve';
  if (['help', '--help', '-h'].includes(command)) {
    process.stdout.write(usage);
    return;
  }
  if (!['serve', 'info', 'health', 'ready', 'stop'].includes(command)) {
    throw new ShiftError('INVALID_CONFIGURATION', 'Unknown command. Run shift help.', 422);
  }
  let values;
  try {
    ({ values } = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: {
        'state-dir': { type: 'string' },
        host: { type: 'string' },
        port: { type: 'string' },
        public: { type: 'boolean' },
        'shutdown-timeout-ms': { type: 'string' },
        'log-level': { type: 'string' },
        'sqlite-native-binding': { type: 'string' },
      },
    }));
  } catch {
    throw new ShiftError('INVALID_CONFIGURATION', 'Invalid command options. Run shift help.', 422);
  }
  const stateDirectory = resolve(
    values['state-dir'] ?? process.env['SHIFT_STATE_DIR'] ?? defaultStateDirectory(),
  );
  if (command !== 'serve') {
    if (Object.keys(values).some((key) => key !== 'state-dir'))
      throw new ShiftError(
        'INVALID_CONFIGURATION',
        'Only --state-dir applies to administrative commands.',
        422,
      );
    const operation = command as 'info' | 'health' | 'ready' | 'stop';
    const payload = await administrativeRequest(stateDirectory, operation);
    const validator =
      operation === 'info'
        ? validateServerInfo
        : operation === 'stop'
          ? validateShutdownAcknowledgement
          : validateServerHealth;
    if (!validator(payload))
      throw new ShiftError(
        'ADMIN_INVALID_RESPONSE',
        'The administrative response does not match the protocol.',
      );
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    if (operation === 'ready' && validateServerHealth(payload) && !payload.readiness.ready)
      process.exitCode = 1;
    return;
  }
  const nativeBinding =
    values['sqlite-native-binding'] ?? process.env['SHIFT_SQLITE_NATIVE_BINDING'];
  const config = validateConfig({
    stateDirectory,
    host: values.host ?? process.env['SHIFT_HOST'] ?? '127.0.0.1',
    port: integer(values.port ?? process.env['SHIFT_PORT'], 4317),
    publicAccess: values.public ?? false,
    shutdownTimeoutMs: integer(
      values['shutdown-timeout-ms'] ?? process.env['SHIFT_SHUTDOWN_TIMEOUT_MS'],
      5000,
    ),
    logLevel: values['log-level'] ?? process.env['SHIFT_LOG_LEVEL'] ?? 'info',
    ...(nativeBinding === undefined ? {} : { sqliteNativeBinding: nativeBinding }),
  });
  let requestedStop = false;
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  const onSignal = () => {
    requestedStop = true;
    if (running)
      void running.stop().catch(() => {
        process.exitCode = 1;
      });
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  try {
    running = await startServer(config);
    if (requestedStop) await running.stop();
    await running.stopped;
  } finally {
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
  }
}

await main().catch((error) => {
  const safe = publicError(error);
  const payload: ProtocolError = {
    schemaVersion: 1,
    requestId: randomUUID(),
    code: safe.code,
    message: safe.message,
    retryable: safe.retryable,
    diagnostics: safe.fields
      .slice(0, 32)
      .map((field) => ({ field: field.slice(0, 256), message: 'Invalid field.' })),
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
