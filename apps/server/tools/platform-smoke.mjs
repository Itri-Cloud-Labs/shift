import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../dist/persistence/store.js';
import { startServer } from '../dist/server.js';
import { validateServerInfo, validateServerHealth } from '../dist/protocol/index.js';

assert.equal(process.platform, 'linux');
assert.equal(process.arch, process.argv[2] ?? process.arch);
const stateDirectory = await mkdtemp(join(tmpdir(), 'shift-platform-'));
const clock = { now: () => Date.now() };
let running;
try {
  const store = await openStore({ stateDirectory, clock });
  const sqlite = store.runtime;
  const pragmas = Object.fromEntries(
    ['journal_mode', 'synchronous', 'foreign_keys', 'busy_timeout'].map((name) => [
      name,
      store.db.pragma(name, { simple: true }),
    ]),
  );
  assert.deepEqual(pragmas, {
    journal_mode: 'wal',
    synchronous: 2,
    foreign_keys: 1,
    busy_timeout: 5000,
  });
  store.close();
  const config = {
    stateDirectory,
    host: '127.0.0.1',
    port: 0,
    publicAccess: false,
    shutdownTimeoutMs: 500,
    logLevel: 'silent',
  };
  running = await startServer(config);
  const identity = running.identity;
  const info = await (await fetch(`${running.url}/api/v0/info`)).json();
  assert(validateServerInfo(info));
  const health = await (await fetch(`${running.url}/api/v0/health`)).json();
  assert(validateServerHealth(health));
  assert.equal(health.readiness.ready, true);
  assert.equal((await stat(running.adminSocket)).mode & 0o777, 0o600);
  await assert.rejects(startServer(config), { code: 'INSTANCE_ALREADY_RUNNING' });
  await running.stop();
  running = await startServer(config);
  assert.deepEqual(running.identity, identity);
  console.log(
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      sqlite,
      pragmas,
      http: 'pass',
      instanceExclusion: 'pass',
      restartIdentity: 'pass',
      result: 'pass',
    }),
  );
} finally {
  await running?.stop();
  await rm(stateDirectory, { recursive: true, force: true });
}
