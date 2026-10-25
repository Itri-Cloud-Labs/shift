import { chmod, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from 'pino';
import { validateConfig, type ServerConfig } from './config.js';
import { systemClock, type Clock } from './domain/clock.js';
import { publicError, ShiftError } from './domain/errors.js';
import { createLogger } from './logging.js';
import { prepareStateDirectory, inspectOwnedFile } from './lifecycle/state-directory.js';
import { acquireInstanceLock } from './lifecycle/instance-lock.js';
import { ReadinessState } from './lifecycle/readiness.js';
import { openStore, type Store } from './persistence/store.js';
import { createHttpServer } from './http.js';
import { SystemdScopes } from './harness/containment.js';
import { OpenCodeAdapter } from './harness/opencode/adapter.js';
import { OpenCodeRuntime } from './harness/opencode/runtime.js';
import type { ResultHandler } from './harness/types.js';
import { CommandReceipts } from './persistence/receipts.js';
import { DeviceRegistry } from './devices/registry.js';
import { DeviceService } from './devices/service.js';
import { SecretBox } from './secrets/secret-box.js';
import { EventLog } from './events/log.js';
import { EventStreams } from './events/streams.js';
import { RunEngine } from './runs/engine.js';
import { DefinitionRepository } from './workflows/repository.js';
import { WorkspaceService } from './workspaces/service.js';
import { Workspaces } from './workspaces/workspaces.js';
import { DefinitionService } from './workflows/service.js';
import type { ServerIdentity } from './protocol/index.js';

async function listen(
  server: Server,
  address: { host: string; port: number } | { path: string },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = () => {
      server.removeListener('listening', onListening);
      reject(
        new ShiftError(
          'LISTEN_FAILED',
          'Cannot bind a server listener. Check address availability and socket permissions.',
        ),
      );
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(address);
  });
}

async function closeListener(server: Server, timeoutMs: number): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => server.closeAllConnections(), timeoutMs);
    server.close((error) => {
      clearTimeout(timeout);
      error ? reject(error) : resolve();
    });
    server.closeIdleConnections();
  });
}

export interface RunningServer {
  identity: ServerIdentity;
  url: string;
  adminSocket: string;
  stopped: Promise<void>;
  stop(): Promise<void>;
}

export async function startServer(
  input: ServerConfig,
  dependencies: { clock?: Clock; logger?: Logger } = {},
): Promise<RunningServer> {
  if (process.platform !== 'linux' || !process.getuid)
    throw new ShiftError('UNSUPPORTED_PLATFORM', 'The Shift server requires Linux.');
  const config = validateConfig(input);
  const clock = dependencies.clock ?? systemClock;
  const logger = dependencies.logger ?? createLogger(config.logLevel);
  const state = await prepareStateDirectory(config.stateDirectory);
  const releaseLock = await acquireInstanceLock(state);
  const readiness = new ReadinessState();
  let store: Store | undefined;
  let runtime: OpenCodeRuntime | undefined;
  let engine: RunEngine | undefined;
  let tcp: Server | undefined;
  let admin: Server | undefined;
  let sweeper: NodeJS.Timeout | undefined;
  let streams: EventStreams | undefined;
  let stopping = false;
  let resolveStopped!: () => void;
  let rejectStopped!: (error: unknown) => void;
  const stopped = new Promise<void>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });
  const cleanup = async (): Promise<void> => {
    const failures: unknown[] = [];
    // One deadline for the whole shutdown; each step gets only the time that remains. Killing the
    // runtime scope is immediate, so it still happens after the deadline has passed.
    const deadline = Date.now() + config.shutdownTimeoutMs;
    clearInterval(sweeper);
    // Open event streams would otherwise hold their listeners open until the deadline.
    streams?.closeAll();
    const remaining = () => Math.max(0, deadline - Date.now());
    // The engine cancels active turns through the harness while the store is still open.
    for (const step of [() => engine?.stop(remaining()), () => runtime?.stop(remaining())]) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
    const outcomes = await Promise.allSettled(
      [tcp, admin]
        .filter((server): server is Server => server !== undefined)
        .map((server) => closeListener(server, remaining())),
    );
    failures.push(
      ...outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : [])),
    );
    try {
      store?.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await releaseLock();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw publicError(failures[0]);
  };
  const stop = (): Promise<void> => {
    if (!stopping) {
      stopping = true;
      void (async () => {
        readiness.stopping();
        try {
          logger.info({ event: 'server.stopping' }, 'Stopping the server.');
        } finally {
          await cleanup();
        }
        logger.info({ event: 'server.stopped' }, 'Server stopped.');
      })().then(resolveStopped, (error: unknown) => rejectStopped(publicError(error)));
    }
    // One observable completion promise, including failure and repeated stop calls.
    return stopped;
  };
  const requestStop = () => {
    void stop().catch((error) =>
      logger.error({ code: publicError(error).code }, 'Shutdown failed.'),
    );
  };
  try {
    store = await openStore({
      stateDirectory: state.path,
      clock,
      ...(config.sqliteNativeBinding === undefined
        ? {}
        : { sqliteNativeBinding: config.sqliteNativeBinding }),
    });
    const harness = config.harness ?? {};
    const defaultModel = harness.defaultModel;
    // The runtime and the agent service refer to each other through the result handler.
    let handleResult: ResultHandler = async () => ({ accepted: false, reason: 'not ready' });
    runtime = new OpenCodeRuntime({
      stateDirectory: state.path,
      scopes: new SystemdScopes(harness.systemdManager ?? 'user'),
      logger,
      resultHandler: (submission) => handleResult(submission),
      stopTimeoutMs: config.shutdownTimeoutMs,
      ...(harness.opencodeExecutable === undefined
        ? {}
        : { executable: harness.opencodeExecutable }),
      environment: harness.environment ?? 'host',
      ...(harness.providerApiKey && defaultModel
        ? {
            credentials: [
              {
                integrationID: defaultModel.slice(0, defaultModel.indexOf('/')),
                key: harness.providerApiKey,
              },
            ],
          }
        : {}),
    });
    // A runtime left by an earlier Shift process is killed now, even if no run needs a harness.
    await runtime.reapStale();
    const artifactRoot = join(state.path, 'artifacts');
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    const receipts = new CommandReceipts(store.db, clock);
    const definitions = new DefinitionRepository(store.db, clock);
    const definitionService = new DefinitionService(definitions, receipts);
    const workspaces = new Workspaces(store.db, clock, join(state.path, 'workspaces'));
    const registry = new DeviceRegistry(store.db, clock, await SecretBox.open(state.path));
    const devices = new DeviceService(registry, receipts);
    const workspaceService = new WorkspaceService(workspaces, receipts);
    const eventLog = new EventLog(store.db, store.identity.eventEpoch);
    streams = new EventStreams(eventLog, logger, {
      ...(config.eventKeepaliveMs === undefined ? {} : { keepaliveMs: config.eventKeepaliveMs }),
    });
    const events = { log: eventLog, streams };
    registry.onRevoked((deviceId) => streams?.closeDevice(deviceId));
    // Enrollment delivery copies are cleared once their phrase's original expiry passes.
    registry.sweep();
    sweeper = setInterval(() => registry.sweep(), 60_000);
    sweeper.unref();
    engine = new RunEngine({
      definitions,
      receipts,
      workspaces,
      store,
      clock,
      logger,
      adapter: new OpenCodeAdapter(runtime),
      artifactRoot,
      ...(defaultModel === undefined ? {} : { defaultModel }),
    });
    handleResult = engine.agents.handleResult;
    // Only the proven instance-lock owner may remove a crash-left socket. Never delete a file/symlink.
    if (await inspectOwnedFile(state.adminSocket, 'socket')) await unlink(state.adminSocket);
    admin = createHttpServer({
      store,
      clock,
      readiness,
      logger,
      administrative: true,
      stop: requestStop,
      engine,
      definitions: { service: definitionService, repository: definitions },
      workspaces: workspaceService,
      devices,
      receipts,
      events,
    });
    await listen(admin, { path: state.adminSocket });
    await chmod(state.adminSocket, 0o600);
    tcp = createHttpServer({
      store,
      clock,
      readiness,
      logger,
      administrative: false,
      stop: requestStop,
      devices,
      receipts,
      events,
      engine,
      definitions: { service: definitionService, repository: definitions },
      workspaces: workspaceService,
    });
    await listen(tcp, { host: config.host, port: config.port });
    for (const listener of [tcp, admin]) {
      listener.on('error', () => {
        readiness.persistenceFailed();
        requestStop();
      });
    }
    const address = tcp.address() as AddressInfo;
    const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
    const url = `http://${host}:${address.port}`;
    readiness.ready();
    // Recovery inspects harness state outside any transaction; it runs after the server is ready.
    engine.start();
    logger.info(
      {
        event: 'server.ready',
        url,
        adminSocket: state.adminSocket,
        serverId: store.identity.serverId,
        sqliteVersion: store.runtime.version,
      },
      'Server ready.',
    );
    return { identity: store.identity, url, adminSocket: state.adminSocket, stop, stopped };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      logger.error({ code: publicError(cleanupError).code }, 'Startup cleanup failed.');
    }
    throw publicError(error);
  }
}
