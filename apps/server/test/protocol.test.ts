import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { Writable } from 'node:stream';
import {
  validateServerInfo,
  validateServerHealth,
  validateProtocolError,
} from '../src/protocol/index.js';
import { createLogger } from '../src/logging.js';
import type { ServerInfo, ServerHealth } from '../src/protocol/index.js';

const fixtureUrl = new URL('./fixtures/protocol/foundation.json', import.meta.url);

test('fixed protocol rejects wrong discriminants, missing IDs, secret fields and unsafe timestamps without coercion', async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8')) as {
    info: ServerInfo;
    health: ServerHealth;
  };
  assert(validateServerInfo(fixture.info));
  assert(validateServerHealth(fixture.health));
  for (const invalid of [
    { ...fixture.info, schemaVersion: 2 },
    { ...fixture.info, serverId: 'harness-session-1' },
    { ...fixture.info, bearerToken: 'secret' },
    { ...fixture.info, protocol: { min: '0', max: 0 } },
    { ...fixture.info, readiness: { ready: false, phase: 'ready', reason: 'READY' } },
    { ...fixture.info, time: { ...fixture.info.time, epochMs: Number.MAX_SAFE_INTEGER + 1 } },
  ])
    assert.equal(validateServerInfo(invalid), false);
  const { serverId: _serverId, ...missingIdentity } = fixture.info;
  assert.equal(validateServerInfo(missingIdentity), false);
  assert.equal(
    validateProtocolError({ code: 'ERROR', message: 'missing request identity' }),
    false,
  );
});

test('app protocol validators run with no Node APIs or dynamic code evaluation', async () => {
  const appDirectory = fileURLToPath(new URL('../../app/src/protocol/generated/', import.meta.url));
  const result = await build({
    entryPoints: [`${appDirectory}validators.js`],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'ShiftProtocol',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  assert.deepEqual(Object.keys(result.metafile!.inputs), [
    '../app/src/protocol/generated/validators.js',
  ]);
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8')) as { info: ServerInfo };
  const context = { input: fixture.info, valid: false };
  runInNewContext(
    `${result.outputFiles![0]!.text}\nvalid = ShiftProtocol.validateServerInfo(input);`,
    context,
    { contextCodeGeneration: { strings: false, wasm: false } },
  );
  assert.equal(context.valid, true);
  for (const name of [
    'types.d.ts',
    'validators.js',
    'validators.d.ts',
    'manifest.json',
    'foundation.schema.json',
    'foundation.fixture.json',
  ]) {
    assert.equal(
      await readFile(new URL(`../src/protocol/generated/${name}`, import.meta.url), 'utf8'),
      await readFile(`${appDirectory}${name}`, 'utf8'),
    );
  }
});

test('logger redacts selected credential fields and never serializes raw exceptions', () => {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += String(chunk);
      callback();
    },
  });
  const logger = createLogger('info', destination);
  const sentinel = 'credential-sentinel';
  logger.info(
    {
      token: sentinel,
      profile: { secret: sentinel },
      req: { headers: { authorization: sentinel } },
      err: new Error(sentinel),
    },
    'Safe event.',
  );
  assert(!output.includes(sentinel));
  assert(output.includes('[REDACTED]'));
});
