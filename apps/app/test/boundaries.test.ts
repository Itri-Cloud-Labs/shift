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
import { ClientCore } from '../src/client-core/runtime.js';

const trusted = { senderId: 4, mainSenderId: 4, frameIsMain: true, url: APP_URL };
const core = () =>
  new ClientCore(
    {
      query: async () => {
        throw new Error('No network');
      },
    },
    { resolve: async () => undefined },
    undefined,
  );

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
