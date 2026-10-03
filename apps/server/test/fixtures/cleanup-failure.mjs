import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { startServer } from '../../dist/server.js';
import { prepareStateDirectory } from '../../dist/lifecycle/state-directory.js';
import { acquireInstanceLock } from '../../dist/lifecycle/instance-lock.js';

const [scenario, stateDirectory] = process.argv.slice(2);
const config = {
  stateDirectory,
  host: '127.0.0.1',
  port: 0,
  publicAccess: false,
  shutdownTimeoutMs: 300,
  logLevel: 'silent',
};
const unhandled = [];
process.on('unhandledRejection', (error) => unhandled.push(error));
const originalListenerClose = Server.prototype.close;
const originalDatabaseClose = Database.prototype.close;
let listenersClosed = 0;
let databasesClosed = 0;
let occupied;
let running;

try {
  if (scenario === 'startup') {
    occupied = createServer();
    occupied.listen(0, '127.0.0.1');
    await once(occupied, 'listening');
    config.port = occupied.address().port;
  } else {
    running = await startServer(config);
  }
  Server.prototype.close = function (callback) {
    return originalListenerClose.call(this, () => {
      listenersClosed++;
      callback(new Error('private-listener-failure'));
    });
  };
  Database.prototype.close = function () {
    originalDatabaseClose.call(this);
    databasesClosed++;
    throw new Error('private-database-failure');
  };

  let failure;
  let sharedPromise = true;
  if (running) {
    process.stdout.write('READY\n');
    await once(process, 'SIGTERM');
    const stopping = running.stop();
    sharedPromise = stopping === running.stopped;
    try {
      await stopping;
    } catch (error) {
      failure = error.code;
    }
  } else {
    try {
      await startServer(config);
    } catch (error) {
      failure = error.code;
    }
  }
  await setImmediate();
  let lockReleased = false;
  try {
    const release = await acquireInstanceLock(await prepareStateDirectory(stateDirectory));
    await release();
    lockReleased = true;
  } catch {
    /* Report failure while the original process is still alive. */
  }
  process.stdout.write(
    `${JSON.stringify({
      scenario,
      failure,
      listenersClosed,
      databasesClosed,
      lockReleased,
      sharedPromise,
      unhandledRejections: unhandled.length,
    })}\n`,
  );
  assert(failure);
} finally {
  Server.prototype.close = originalListenerClose;
  Database.prototype.close = originalDatabaseClose;
  if (occupied) await new Promise((resolve) => occupied.close(resolve));
}
// A regressed implementation can retain its lock. Exit only after recording that failure.
process.exit(0);
