import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseRequest,
  parseResponse,
  withinLimit,
  RESPONSE_LIMIT,
} from '../src/shared/contracts.js';
import {
  APP_URL,
  DOCUMENTATION_URL,
  assetPath,
  validExternalLink,
  validSender,
  isApplicationDocument,
  securePreferences,
} from '../src/main/security.js';
import { dispatch } from '../src/main/dispatcher.js';
import { validInteractions } from '../src/shared/interactions.js';
import { ClientCore } from '../src/client-core/runtime.js';
import { ConnectionRuntime } from '../src/client-core/connection.js';
import { MemoryCredentialStore, MemoryProfileStore } from '../src/client-core/credentials.js';
import { ServerHttp } from '../src/client-core/http.js';

const trusted = { senderId: 4, mainSenderId: 4, frameIsMain: true, url: APP_URL };
// A client with no saved connection whose network always fails.
const core = () => {
  const http = new ServerHttp(async () => {
    throw new Error('No network');
  });
  return new ClientCore(
    new ConnectionRuntime({
      http,
      credentials: new MemoryCredentialStore(),
      profiles: new MemoryProfileStore(),
      allowLoopbackHttp: false,
    }),
    http,
  );
};

test('IPC rejects unknown discriminants, extra keys, coercion and payload exhaustion', () => {
  assert.deepEqual(parseRequest({ kind: 'server.query', operation: 'info' }), {
    kind: 'server.query',
    operation: 'info',
  });
  for (const value of [
    { kind: 'server.query', operation: 'shutdown' },
    { kind: 'server.query', operation: 'info', url: 'https://evil.test' },
    { kind: 'samples.set', enabled: 'true' },
    { kind: 'shell.read', bearer: 'secret' },
    { kind: 'filesystem.read', path: '/etc/passwd' },
    { kind: 'desktop.openDocumentation', url: 'file:///etc/passwd' },
    { kind: 'shell.read', extra: 'a'.repeat(9000) },
    undefined,
    NaN,
  ])
    assert.equal(parseRequest(value), undefined);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.equal(withinLimit(cycle, 1000), false);
  let deep: unknown = null;
  for (let i = 0; i < 20; i++) deep = { next: deep };
  assert.equal(withinLimit(deep, RESPONSE_LIMIT), false);
  assert.equal(withinLimit({ value: '🦊'.repeat(2500) }, 8192), false);
  assert.equal(withinLimit({ value: Infinity }, 8192), false);
  assert.equal(withinLimit({ value: new Date() }, 8192), false);
});

test('sender authorization requires the owned top frame and exact document', async () => {
  assert.equal(validSender(trusted), true);
  for (const context of [
    { ...trusted, senderId: 8 },
    { ...trusted, frameIsMain: false },
    { ...trusted, url: 'shift://app/other.html' },
    { ...trusted, url: 'https://app/index.html' },
    { ...trusted, url: 'shift://attacker/index.html' },
    { ...trusted, url: 'shift://user@app/index.html' },
    { ...trusted, url: APP_URL + '?url=evil' },
  ]) {
    assert.equal(validSender(context), false);
    assert.equal(
      (
        await dispatch(core(), context, { kind: 'shell.read' }, async () => {
          assert.fail();
        })
      ).kind,
      'error',
    );
  }
  assert.equal(isApplicationDocument(APP_URL + '#workflows'), true);
});

test('custom scheme allowlists assets; external links are a fixed HTTPS destination', () => {
  const assets = new Set(['index.html', 'assets/main.js']);
  assert.equal(assetPath(APP_URL, assets), 'index.html');
  for (const url of [
    'file:///etc/passwd',
    'shift://evil/index.html',
    'shift://app/%2e%2e/etc/passwd',
    'shift://app/assets/%2f..%2fsecret',
    'shift://app/assets/main.js?x=1',
    'shift://user@app/index.html',
    'shift://app:8000/index.html',
    'shift://app/not-listed.js',
    'shift://app/assets/%5csecret',
  ])
    assert.equal(assetPath(url, assets), undefined);
  assert.equal(validExternalLink(DOCUMENTATION_URL), true);
  for (const url of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'http://github.com',
    'https://evil.test',
    DOCUMENTATION_URL + '?token=secret',
    'https://user:secret@github.com/Itri-Cloud-Labs/shift/tree/main/docs',
  ])
    assert.equal(validExternalLink(url), false);
  assert.deepEqual(securePreferences, {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  });
});

test('dispatch returns only public fixture records and safe errors', async () => {
  const client = core();
  const response = await dispatch(
    client,
    trusted,
    { kind: 'samples.set', enabled: true },
    async () => assert.fail(),
  );
  assert.equal(response.kind, 'shell');
  assert.ok(parseResponse(response));
  assert.doesNotMatch(
    JSON.stringify(response),
    /bearer|credentialHandle|authorization|accessToken/,
  );
  assert.deepEqual(
    await dispatch(client, trusted, { kind: 'server.query', operation: 'info' }, async () =>
      assert.fail(),
    ),
    { kind: 'error', code: 'DISCONNECTED', message: 'Connect to a server before querying it.' },
  );
  let opened = '';
  assert.deepEqual(
    await dispatch(client, trusted, { kind: 'desktop.openDocumentation' }, async (url) => {
      opened = url;
    }),
    { kind: 'opened' },
  );
  assert.equal(opened, DOCUMENTATION_URL);
  // The sync view is state and counts only: no cursor credential, command body or token.
  assert.deepEqual(
    await dispatch(client, trusted, { kind: 'sync.read' }, async () => assert.fail()),
    {
      kind: 'sync',
      sync: { status: 'stopped', problem: null, updatedAt: null, cached: null, commands: [] },
    },
  );
  assert.equal(parseRequest({ kind: 'sync.read', profileId: '../x' }), undefined);
  // Moving nodes sends positions only, bounded in count, size and range.
  const move = (positions: unknown[], revision: unknown = 3) => ({
    kind: 'workflow.move',
    workflowId: '00000000-0000-4000-8000-000000000001',
    revision,
    positions,
  });
  const many = Array.from({ length: 500 }, (_, index) => ({
    nodeId: `node_${index}`,
    x: index,
    y: -index,
  }));
  assert.ok(parseRequest(move(many)));
  for (const value of [
    move([]),
    move([...many, { nodeId: 'one_more', x: 0, y: 0 }]),
    move([{ nodeId: 'a', x: 1e7, y: 0 }]),
    move([{ nodeId: 'a', x: 0, y: 0, draft: {} }]),
    move([{ nodeId: 'a', x: 0, y: 0 }], -1),
    move([{ nodeId: 'a', x: 0, y: 0 }], 1.5),
  ])
    assert.equal(parseRequest(value), undefined);
  // Resource reads take identifiers only, never paths; they need a live connection.
  const id = '00000000-0000-4000-8000-000000000001';
  for (const value of [
    { kind: 'data.run', runId: '../../admin/shutdown' },
    { kind: 'data.version', workflowId: id },
    { kind: 'data.workflow', workflowId: id, path: '/api/v0/admin' },
    { kind: 'run.cancel', runId: `${id}/x` },
  ])
    assert.equal(parseRequest(value), undefined, JSON.stringify(value));
  assert.deepEqual(
    await dispatch(client, trusted, { kind: 'data.run', runId: id }, async () => assert.fail()),
    { kind: 'error', code: 'DISCONNECTED', message: 'Connect to a server before querying it.' },
  );
  assert.deepEqual(
    await dispatch(client, trusted, { kind: 'run.start', workflowId: id, input: {} }, async () =>
      assert.fail(),
    ),
    { kind: 'error', code: 'DISCONNECTED', message: 'Connect to a server before querying it.' },
  );
  // Answers and run controls name a request or run and carry form data, never a path.
  const respond = (extra: Record<string, unknown>) => ({
    kind: 'interaction.respond',
    interactionId: id,
    revision: 2,
    response: {},
    ...extra,
  });
  assert.ok(
    parseRequest(respond({ decision: 'approved', response: { comment: 'x'.repeat(30_000) } })),
  );
  const control = (value: unknown) => ({ kind: 'run.control', runId: id, control: value });
  for (const value of [
    { kind: 'retry' },
    { kind: 'fail', reason: 'Checked by hand' },
    { kind: 'complete', data: { summary: 'done' } },
    { kind: 'extend', executions: 10 },
    { kind: 'extend', activeMs: 1_800_000 },
  ])
    assert.ok(parseRequest(control(value)), JSON.stringify(value));
  for (const value of [
    respond({ interactionId: `${id}/../../admin` }),
    respond({ revision: -1 }),
    respond({ response: 'approved' }),
    respond({ decision: '' }),
    respond({ path: '/api/v0/admin/shutdown' }),
    respond({ response: { comment: 'x'.repeat(70_000) } }),
    control({ kind: 'resume' }),
    control({ kind: 'retry', commandId: 'mine' }),
    control({ kind: 'fail', reason: '' }),
    control({ kind: 'extend', executions: 0 }),
    control({ kind: 'extend', activeMs: 10 }),
    { kind: 'data.interactions', all: true },
  ])
    assert.equal(parseRequest(value), undefined, JSON.stringify(value));
  assert.deepEqual(
    await dispatch(client, trusted, control({ kind: 'retry' }), async () => assert.fail()),
    { kind: 'error', code: 'DISCONNECTED', message: 'Connect to a server before querying it.' },
  );
  assert.deepEqual(
    await dispatch(client, trusted, respond({ decision: 'approved' }), async () => assert.fail()),
    { kind: 'error', code: 'DISCONNECTED', message: 'Connect to a server before querying it.' },
  );
  assert.deepEqual(
    await dispatch(client, trusted, { kind: 'data.interactions' }, async () => assert.fail()),
    { kind: 'interactions', value: { interactions: [] } },
  );
  // Devices are named by ID, and preferences hold only the two known choices.
  for (const value of [
    { kind: 'device.revoke', deviceId: `${id}/../../admin` },
    { kind: 'device.revoke', deviceId: id, commandId: 'mine' },
    { kind: 'data.devices', path: '/api/v0/admin/devices' },
    { kind: 'preferences.set', preferences: { theme: 'neon', notifications: true } },
    { kind: 'preferences.set', preferences: { theme: 'dark', notifications: true, url: 'x' } },
  ])
    assert.equal(parseRequest(value), undefined, JSON.stringify(value));
  assert.deepEqual(
    await dispatch(client, trusted, { kind: 'device.revoke', deviceId: id }, async () =>
      assert.fail(),
    ),
    { kind: 'error', code: 'DISCONNECTED', message: 'Connect to a server before querying it.' },
  );
  assert.deepEqual(
    await dispatch(client, trusted, { kind: 'data.devices' }, async () => assert.fail()),
    { kind: 'error', code: 'DISCONNECTED', message: 'Connect to a server before querying it.' },
  );
  const preferences = { theme: 'light', notifications: true } as const;
  assert.deepEqual(
    await dispatch(client, trusted, { kind: 'preferences.set', preferences }, async () =>
      assert.fail(),
    ),
    { kind: 'preferences', preferences },
  );
  assert.deepEqual(
    await dispatch(client, trusted, { kind: 'preferences.read' }, async () => assert.fail()),
    { kind: 'preferences', preferences },
  );
  // Requests cross IPC only as the server's own list would validate them.
  assert.equal(validInteractions({ interactions: [{ id: id, title: 'x' }] }), false);
  assert.equal(validInteractions({ interactions: [], bearer: 'x' }), false);
  assert.deepEqual(
    await dispatch(client, trusted, { kind: 'data.overview' }, async () => assert.fail()),
    { kind: 'overview', overview: { projects: [], workflows: [], runs: [], attention: 0 } },
  );
  // A resource answer may be large and deep, but stays bounded.
  const deep = (depth: number): unknown => (depth === 0 ? 1 : { next: deep(depth - 1) });
  const resource = (value: unknown) => ({
    kind: 'resource',
    resource: 'workflow',
    value,
    stale: false,
    fetchedAt: 1,
  });
  assert.ok(parseResponse(resource(deep(40))));
  assert.equal(parseResponse(resource(deep(60))), undefined);
  assert.equal(parseResponse(resource({ text: 'x'.repeat(9 * 1024 * 1024) })), undefined);
  assert.equal(parseResponse({ kind: 'overview', overview: deep(40) }), undefined);
  const failure = await dispatch(
    client,
    trusted,
    { kind: 'desktop.openDocumentation' },
    async () => {
      throw new Error('bearer-secret /private/path');
    },
  );
  assert.doesNotMatch(JSON.stringify(failure), /bearer-secret|private/);
});

test('generated public protocol copies stay byte-identical and pure', async () => {
  for (const file of [
    'types.d.ts',
    'validators.js',
    'validators.d.ts',
    'foundation.schema.json',
    'foundation.fixture.json',
    'manifest.json',
  ]) {
    const own = await readFile(new URL(`../src/protocol/generated/${file}`, import.meta.url));
    const server = await readFile(
      new URL(`../../server/src/protocol/generated/${file}`, import.meta.url),
    );
    assert.ok(own.equals(server), file);
  }
});
