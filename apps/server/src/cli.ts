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

const usage = `Shift server

shift serve [--state-dir PATH] [--host 127.0.0.1] [--port 4317] [--public]
            [--shutdown-timeout-ms 5000] [--log-level info]
            [--sqlite-native-binding PATH] [--opencode-model PROVIDER/MODEL]
            [--opencode-executable PATH] [--opencode-environment host|isolated]
            [--systemd-manager user|system]
shift info|health|ready|stop [--state-dir PATH]
shift project add --path REPO [--name NAME] [--base-ref REF]
shift project list
shift workflow create --project PROJECT_ID --name NAME --file DOCUMENT.json
shift workflow save WORKFLOW_ID --revision N --file DOCUMENT.json
shift workflow publish WORKFLOW_ID [--revision N]
shift workflow show WORKFLOW_ID
shift workflow list [--project PROJECT_ID]
shift run start --workflow WORKFLOW_ID [--input JSON] [--wait]
shift run show RUN_ID [--wait]
shift run list
shift run executions RUN_ID [--after SEQUENCE] [--limit N]
shift run cancel RUN_ID [--reason TEXT] [--wait]
shift run retry RUN_ID [--wait]
shift run fail RUN_ID [--reason TEXT]
shift run complete RUN_ID --file DATA.json
shift run extend RUN_ID (--executions N | --active-minutes N) [--wait]
shift workspace list [--project PROJECT_ID]
shift workspace show WORKSPACE_ID
shift workspace remove WORKSPACE_ID [--force]
shift device pair
shift device list
shift device revoke DEVICE_ID
shift interaction list [--all]
shift interaction show INTERACTION_ID
shift interaction respond INTERACTION_ID [--decision OUTCOME] [--file RESPONSE.json]
            [--revision N] [--wait]

Project, workflow, run, workspace, interaction and device commands accept --state-dir PATH; changes accept
--command-id ID, which makes repeating the same command return its first result.
A run in NEEDS_HUMAN continues with retry (run the stuck step again; its agent is
told earlier effects are unknown), fail (abandon the step), complete (record a
result you verified, as JSON matching the step's result schema) or extend (raise
the execution or active-time limit it reached). cancel stops a run at any point.
A run WAITING for a human form or approval continues with interaction respond:
--decision picks an approval outcome, and --file holds the form response as JSON.
Each run works in its own detached worktree of the project, under the state
directory, at the commit its base ref had when the run started. Worktrees are
kept after runs finish; remove refuses one with uncommitted changes unless
--force is given.

device pair prints a single-use, eight-word phrase that pairs one desktop client
within ten minutes; revoke cuts a device off without stopping runs it started.

TCP serves /api/v0/info, /health and /ready, pairing, and the API for paired
devices, which authenticate with a bearer token. Local administration uses the
private admin.sock in the state directory. --public explicitly permits a
non-loopback IP; serve it only behind a TLS-terminating proxy, because tokens
would otherwise cross the network in clear text. OpenCode runs as your own
install, with your config, credentials and plugins. --opencode-environment
isolated gives it a private namespace instead; SHIFT_OPENCODE_API_KEY then
supplies the provider key for --opencode-model once.
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
  if (['project', 'workflow', 'run', 'workspace', 'interaction', 'device'].includes(command)) {
    const { adminCommand } = await import('./cli-admin.js');
    return adminCommand(command, args.slice(1));
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
        'opencode-model': { type: 'string' },
        'opencode-executable': { type: 'string' },
        'opencode-environment': { type: 'string' },
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
      environment: values['opencode-environment'] ?? process.env['SHIFT_OPENCODE_ENVIRONMENT'],
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
  // Loaded only for `serve`: SQLite and the server graph would slow every administrative command.
  const { startServer } = await import('./server.js');
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
