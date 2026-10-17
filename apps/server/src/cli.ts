#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultStateDirectory, validateConfig } from './config.js';
import { publicError, ShiftError } from './domain/errors.js';
import { administrativeCall, administrativeRequest } from './admin-client.js';
import {
  validateServerInfo,
  validateServerHealth,
  validateShutdownAcknowledgement,
  type ProtocolError,
} from './protocol/index.js';
import { startServer } from './server.js';

const usage = `Shift server

shift serve [--state-dir PATH] [--host 127.0.0.1] [--port 4317] [--public]
            [--shutdown-timeout-ms 5000] [--log-level info]
            [--sqlite-native-binding PATH] [--opencode-model PROVIDER/MODEL]
            [--opencode-executable PATH] [--systemd-manager user|system]
shift info|health|ready|stop [--state-dir PATH]
shift run start --goal TEXT --repo PATH [--model PROVIDER/MODEL] [--read-only]
                [--result-schema JSON] [--wait] [--state-dir PATH]
shift run show RUN_ID [--wait] [--state-dir PATH]
shift run list [--state-dir PATH]

TCP serves read-only /api/v0/info, /health and /ready. Administration and runs
use the private admin.sock in the state directory. --public explicitly permits a
non-loopback IP; it exposes no administration. SHIFT_OPENCODE_API_KEY supplies
the provider key for --opencode-model once; it is kept in the private OpenCode
namespace. Pairing and remote clients are unavailable.
`;

const terminal = (state: unknown) => state !== 'RUNNING';

// Reports the server's own protocol error rather than a generic administrative failure.
function payloadOf(response: { status: number; payload: unknown }): Record<string, unknown> {
  const payload = (response.payload ?? {}) as Record<string, unknown>;
  if (response.status >= 400) {
    throw new ShiftError(
      typeof payload['code'] === 'string' ? payload['code'] : 'ADMIN_REJECTED',
      typeof payload['message'] === 'string'
        ? payload['message']
        : 'The server rejected the request.',
      response.status,
    );
  }
  return payload;
}

async function runCommand(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        'state-dir': { type: 'string' },
        goal: { type: 'string' },
        repo: { type: 'string' },
        model: { type: 'string' },
        'read-only': { type: 'boolean' },
        'result-schema': { type: 'string' },
        wait: { type: 'boolean' },
      },
    });
  } catch {
    throw new ShiftError('INVALID_CONFIGURATION', 'Invalid command options. Run shift help.', 422);
  }
  const { values, positionals } = parsed;
  const [subcommand, runId] = positionals;
  const stateDirectory = resolve(
    values['state-dir'] ?? process.env['SHIFT_STATE_DIR'] ?? defaultStateDirectory(),
  );
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) =>
    payloadOf(
      await administrativeCall(stateDirectory, {
        method,
        path,
        ...(body === undefined ? {} : { body }),
      }),
    );
  const wait = async (run: Record<string, unknown>) => {
    while (!terminal(run['state'])) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      run = (await call('GET', `/api/v0/admin/runs/${String(run['id'])}`))['run'] as Record<
        string,
        unknown
      >;
    }
    return run;
  };
  const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
  if (subcommand === 'start' && positionals.length === 1) {
    if (!values.goal || !values.repo) {
      throw new ShiftError('INVALID_CONFIGURATION', 'run start needs --goal and --repo.', 422);
    }
    let resultSchema: unknown;
    if (values['result-schema'] !== undefined) {
      try {
        resultSchema = JSON.parse(values['result-schema']);
      } catch {
        throw new ShiftError('INVALID_CONFIGURATION', '--result-schema must be JSON.', 422);
      }
    }
    let run = (
      await call('POST', '/api/v0/admin/runs', {
        goal: values.goal,
        repository: resolve(values.repo),
        ...(values.model === undefined ? {} : { model: values.model }),
        ...(values['read-only'] ? { readOnly: true } : {}),
        ...(resultSchema === undefined ? {} : { resultSchema }),
      })
    )['run'] as Record<string, unknown>;
    if (values.wait) {
      run = await wait(run);
      if (run['state'] !== 'COMPLETED') process.exitCode = 1;
    }
    print(run);
  } else if (subcommand === 'show' && runId && positionals.length === 2) {
    let run = (await call('GET', `/api/v0/admin/runs/${encodeURIComponent(runId)}`))[
      'run'
    ] as Record<string, unknown>;
    if (values.wait) run = await wait(run);
    print(run);
  } else if (subcommand === 'list' && positionals.length === 1) {
    print((await call('GET', '/api/v0/admin/runs'))['runs']);
  } else {
    throw new ShiftError('INVALID_CONFIGURATION', 'Unknown run command. Run shift help.', 422);
  }
}

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
  if (command === 'run') return runCommand(args.slice(1));
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
        'opencode-model': { type: 'string' },
        'opencode-executable': { type: 'string' },
        'systemd-manager': { type: 'string' },
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
  const harness = Object.fromEntries(
    Object.entries({
      defaultModel: values['opencode-model'] ?? process.env['SHIFT_OPENCODE_MODEL'],
      opencodeExecutable: values['opencode-executable'] ?? process.env['SHIFT_OPENCODE_EXECUTABLE'],
      systemdManager: values['systemd-manager'] ?? process.env['SHIFT_SYSTEMD_MANAGER'],
      providerApiKey: process.env['SHIFT_OPENCODE_API_KEY'],
    }).filter(([, value]) => value !== undefined && value !== ''),
  );
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
    harness,
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
