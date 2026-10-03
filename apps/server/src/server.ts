import { chmod, unlink } from 'node:fs/promises';
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
  let tcp: Server | undefined;
  let admin: Server | undefined;
  let shutdown: Promise<void> | undefined;
  let resolveStopped!: () => void;
  let rejectStopped!: (error: unknown) => void;
  const stopped = new Promise<void>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });
  const stop = (): Promise<void> =>
    (shutdown ??= (async () => {
      readiness.stopping();
      logger.info({ event: 'server.stopping' }, 'Stopping the server.');
      try {
        await Promise.all(
          [tcp, admin]
            .filter((server): server is Server => server !== undefined)
            .map((server) => closeListener(server, config.shutdownTimeoutMs)),
        );
        store?.close();
        await releaseLock();
        logger.info({ event: 'server.stopped' }, 'Server stopped.');
        resolveStopped();
      } catch (error) {
        rejectStopped(publicError(error));
        throw publicError(error);
      }
    })());
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
    // Only the proven instance-lock owner may remove a crash-left socket. Never delete a file/symlink.
    if (await inspectOwnedFile(state.adminSocket, 'socket')) await unlink(state.adminSocket);
    admin = createHttpServer({
      store,
      clock,
      readiness,
      logger,
      administrative: true,
      stop: requestStop,
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
    await Promise.all(
      [tcp, admin]
        .filter((server): server is Server => server !== undefined)
        .map((server) => closeListener(server, config.shutdownTimeoutMs)),
    );
    store?.close();
    await releaseLock();
    throw publicError(error);
  }
}
