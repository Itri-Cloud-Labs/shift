import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ConnectionRuntime } from '../src/client-core/connection.js';
import { MemoryCredentialStore, MemoryProfileStore } from '../src/client-core/credentials.js';
import { ServerHttp, type Fetch } from '../src/client-core/http.js';
import { MemorySyncStore } from '../src/client-core/projection.js';
import { SyncRuntime } from '../src/client-core/sync.js';

// The sync runtime against a real `shift serve`: pairing, snapshot, live events, a server
// restart, a lost approval acknowledgement and a restart from the saved cursor. The server runs
// on Linux only.

const serverDirectory = fileURLToPath(new URL('../../server/', import.meta.url));

function node(args: string[]): ChildProcess {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('SHIFT_')) delete env[key];
  return spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: serverDirectory,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('No port');
  return address.port;
}

async function serve(state: string, port: number) {
  const child = node([
    'serve',
    '--state-dir',
    state,
    '--port',
    String(port),
    '--shutdown-timeout-ms',
    '300',
    '--event-keepalive-ms',
    '1000',
  ]);
  let output = '';
  let errors = '';
  child.stdout!.on('data', (chunk) => (output += String(chunk)));
  child.stderr!.on('data', (chunk) => (errors += String(chunk)));
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  for (let index = 0; index < 300; index++) {
    if (child.exitCode !== null) throw new Error(`Server failed: ${errors}`);
    if (output.includes('"server.ready"')) {
      return {
        url: `http://127.0.0.1:${port}`,
        async stop() {
          child.kill('SIGTERM');
          await exited;
        },
      };
    }
    await delay(50);
  }
  child.kill('SIGKILL');
  throw new Error(`Server did not start: ${errors}`);
}

async function cli(args: string[]): Promise<string> {
  const child = node(args);
  let output = '';
  child.stdout!.on('data', (chunk) => (output += String(chunk)));
  const code = await new Promise<number | null>((resolve) => child.once('close', resolve));
  if (code !== 0) throw new Error(`shift ${args.join(' ')} failed`);
  return output;
}

async function until(predicate: () => boolean, message: string, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${message}`);
    await delay(20);
  }
}

// A desktop client whose network can lose one answer and then fail entirely.
function client(
  stores: {
    profiles?: MemoryProfileStore;
    credentials?: MemoryCredentialStore;
    sync?: MemorySyncStore;
  } = {},
) {
  const network = { blackout: false, loseNextRespond: false, paths: [] as string[], responds: 0 };
  const transport: Fetch = async (url, init) => {
    network.paths.push(`${init.method} ${new URL(url).pathname}${new URL(url).search}`);
    if (network.blackout) throw new TypeError('fetch failed');
    const respond = init.method === 'POST' && url.endsWith('/respond');
    if (respond) network.responds++;
    const response = await fetch(url, init);
    if (respond && network.loseNextRespond) {
      network.loseNextRespond = false;
      // The server committed the response; the answer never comes back.
      await response.text();
      network.blackout = true;
      throw new TypeError('fetch failed');
    }
    return response;
  };
  const http = new ServerHttp(transport);
  const profiles = stores.profiles ?? new MemoryProfileStore();
  const credentials = stores.credentials ?? new MemoryCredentialStore();
  const store = stores.sync ?? new MemorySyncStore();
  const connection = new ConnectionRuntime({
    http,
    credentials,
    profiles,
    allowLoopbackHttp: true,
  });
  const sync = new SyncRuntime({
    connection,
    http,
    store,
    keepaliveTimeoutMs: 5000,
    initialBackoffMs: 100,
    maxBackoffMs: 500,
  });
  sync.start();
  return { connection, sync, network, profiles, credentials, store };
}

test(
  'two paired clients follow a real server through a restart and a lost approval acknowledgement',
  { skip: process.platform !== 'linux', timeout: 120_000 },
  async (t) => {
    const state = await mkdtemp(join(tmpdir(), 'shift-sync-live-'));
    t.after(() => rm(state, { recursive: true, force: true }));
    const repository = join(state, 'repo');
    await mkdir(repository);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repository });
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'],
      { cwd: repository },
    );
    const port = await freePort();
    let server = await serve(join(state, 'server'), port);
    t.after(() => server.stop());

    const laptop = client();
    const desktop = client();
    t.after(() => {
      laptop.sync.stop();
      desktop.sync.stop();
      laptop.connection.disconnect();
      desktop.connection.disconnect();
    });
    for (const [device, name] of [
      [laptop, 'Laptop'],
      [desktop, 'Desktop'],
    ] as const) {
      const { phrase } = JSON.parse(
        await cli(['device', 'pair', '--state-dir', join(state, 'server')]),
      ) as { phrase: string };
      const paired = await device.connection.pair({ url: server.url, phrase, deviceName: name });
      assert.equal(paired.status, 'online');
    }
    const isLive = (device: { sync: SyncRuntime }) => device.sync.state.status === 'live';
    await until(() => isLive(laptop) && isLive(desktop), 'both live');

    // The laptop sets up and starts a run; the desktop sees it through its own stream.
    const accepted = async (path: string, body: Record<string, unknown>) => {
      const command = await laptop.sync.send({ method: 'POST', path, body });
      assert.equal(command.state, 'accepted', `${path}: ${command.code}`);
      return laptop.sync.response(command.commandId) as Record<string, any>;
    };
    const project = await accepted('/api/v0/projects', { path: repository });
    const workflow = await accepted('/api/v0/workflows', {
      projectId: project['project'].id,
      name: 'Review',
      draft: {
        nodes: [
          { id: 'start', type: 'manual_trigger' },
          { id: 'review', type: 'approval', config: { title: 'Ship it?' } },
        ],
        connections: [
          {
            id: 'c1',
            fromNodeId: 'start',
            fromPort: 'success',
            toNodeId: 'review',
            toPort: 'input',
          },
        ],
      },
    });
    const workflowId = workflow['workflow'].id as string;
    await accepted(`/api/v0/workflows/${workflowId}/publish`, {});
    const run = await accepted('/api/v0/runs', { workflowId });
    const runId = run['run'].id as string;
    const pending = (device: { sync: SyncRuntime }) =>
      device.sync.projection?.interactions.find(
        (item) => item.runId === runId && item.state === 'PENDING',
      );
    await until(() => Boolean(pending(laptop) && pending(desktop)), 'approval on both devices');
    assert.equal(desktop.sync.projection?.workflows[0]?.activeVersionId !== null, true);
    assert.equal(desktop.sync.projection?.projects.length, 1);
    const interaction = pending(desktop)!;

    // The laptop approves; the server commits it, but the answer and the network are lost.
    laptop.network.loseNextRespond = true;
    const approval = await laptop.sync.send({
      method: 'POST',
      path: `/api/v0/interactions/${interaction.id}/respond`,
      body: { revision: interaction.revision, decision: 'approved' },
    });
    assert.equal(approval.state, 'unknown');

    // The server restarts while the laptop is offline.
    await server.stop();
    server = await serve(join(state, 'server'), port);
    laptop.network.blackout = false;
    await until(
      () =>
        laptop.sync.commands().find((item) => item.commandId === approval.commandId)?.state ===
        'accepted',
      'receipt confirmed',
    );
    assert.equal(laptop.network.responds, 1, 'the approval was sent once');

    // Both devices converge on the accepted decision and the finished run.
    for (const device of [laptop, desktop]) {
      await until(
        () =>
          isLive(device) &&
          device.sync.projection?.interactions.find((item) => item.id === interaction.id)?.state ===
            'RESPONDED' &&
          device.sync.projection?.runs.find((item) => item.id === runId)?.state === 'COMPLETED',
        'converged',
      );
    }
    const settled = desktop.sync.projection!.interactions.find(
      (item) => item.id === interaction.id,
    )!;
    assert.equal(settled.response?.decision, 'approved');
    assert.equal(settled.response?.actor.kind, 'device');

    // The desktop's stale form loses: its answer is refused, not merged.
    const late = await desktop.sync.send({
      method: 'POST',
      path: `/api/v0/interactions/${interaction.id}/respond`,
      body: { revision: settled.revision, decision: 'rejected' },
    });
    assert.deepEqual([late.state, late.code], ['rejected', 'INTERACTION_CONFLICT']);

    // The laptop app restarts: it shows its cache, then resumes from the saved cursor.
    laptop.sync.stop();
    laptop.connection.disconnect();
    const cursor = laptop.sync.projection!.cursor;
    const restarted = client({
      profiles: laptop.profiles,
      credentials: laptop.credentials,
      sync: laptop.store,
    });
    t.after(() => {
      restarted.sync.stop();
      restarted.connection.disconnect();
    });
    await restarted.connection.start();
    await until(() => isLive(restarted), 'restarted live');
    assert(!restarted.network.paths.includes('GET /api/v0/snapshot'));
    assert(
      restarted.network.paths.includes(
        `GET /api/v0/events?after=${encodeURIComponent(cursor)}&limit=500`,
      ),
    );
    assert.equal(
      restarted.sync.projection?.runs.find((item) => item.id === runId)?.state,
      'COMPLETED',
    );
  },
);
