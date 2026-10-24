import assert from 'node:assert/strict';
import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { DeviceRegistry, pairingLifetimeMs } from '../src/devices/registry.js';
import { DeviceService } from '../src/devices/service.js';
import { CommandReceipts } from '../src/persistence/receipts.js';
import { openStore } from '../src/persistence/store.js';
import {
  validateDeviceList,
  validateDeviceResponse,
  validatePairResponse,
  validatePairingIssued,
  validateProtocolError,
  validateServerInfo,
} from '../src/protocol/index.js';
import { SecretBox } from '../src/secrets/secret-box.js';
import { FakeClock, runCli, startChild, temporaryState } from './helpers.js';

async function registryFor() {
  const state = await temporaryState();
  const clock = new FakeClock();
  const store = await openStore({ stateDirectory: state.path, clock });
  const secrets = await SecretBox.open(state.path);
  const registry = new DeviceRegistry(store.db, clock, secrets);
  const service = new DeviceService(registry, new CommandReceipts(store.db, clock));
  return {
    state,
    clock,
    store,
    registry,
    service,
    async close() {
      store.close();
      await state.remove();
    },
  };
}

const cli = { kind: 'cli' as const, id: 'local' };
const pairing = (phrase: string, commandId = 'pair-command-1', deviceName = 'Laptop') => ({
  phrase,
  deviceName,
  commandId,
});

test('a phrase pairs one device, and a lost response is recovered only until the phrase expires', async () => {
  const harness = await registryFor();
  try {
    const { phrase, expiresAt } = harness.service.issue(cli);
    assert.match(phrase, /^[a-z]+( [a-z]+){7}$/);
    assert.equal(expiresAt, harness.clock.now() + pairingLifetimeMs);

    // Case, hyphens and extra spaces are not part of the phrase.
    const typed = `  ${phrase.toUpperCase().replaceAll(' ', '-')} `;
    const paired = harness.service.pair(pairing(typed), '127.0.0.1');
    assert.match(paired.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(paired.device.name, 'Laptop');
    assert.deepEqual(harness.registry.authenticate(paired.token)?.id, paired.device.id);

    // The response was lost: the same command and body return the same device and token.
    harness.clock.advance(pairingLifetimeMs - 1);
    const again = harness.service.pair(pairing(phrase), '127.0.0.1');
    assert.deepEqual([again.device.id, again.token], [paired.device.id, paired.token]);
    assert.throws(() => harness.service.pair(pairing(phrase, 'pair-command-2'), '127.0.0.2'), {
      code: 'PAIRING_REJECTED',
    });
    assert.throws(
      () => harness.service.pair(pairing(phrase, 'pair-command-1', 'Desktop'), '127.0.0.3'),
      { code: 'COMMAND_CONFLICT' },
    );
    assert.equal(harness.registry.list().length, 1, 'one phrase creates one device');

    // At the original expiry the delivery copy is cleared; the device itself stays until revoked.
    harness.clock.advance(1);
    harness.registry.sweep();
    assert.throws(() => harness.service.pair(pairing(phrase), '127.0.0.4'), {
      code: 'PAIRING_REJECTED',
    });
    const stored = harness.store.db
      .prepare('SELECT delivery_ciphertext FROM pairing_challenges')
      .get() as { delivery_ciphertext: string | null };
    assert.equal(stored.delivery_ciphertext, null);
    assert.equal(harness.registry.authenticate(paired.token)?.id, paired.device.id);

    // Neither the phrase nor the token is stored in plain text anywhere in the database.
    harness.store.db.pragma('wal_checkpoint(TRUNCATE)');
    const bytes = await readFile(join(harness.state.path, 'shift.db'));
    for (const secret of [phrase, paired.token]) {
      assert.equal(bytes.includes(Buffer.from(secret)), false);
    }
  } finally {
    await harness.close();
  }
});

test('expired and unknown phrases are refused, and repeated failures withdraw open phrases', async () => {
  const harness = await registryFor();
  try {
    const old = harness.service.issue(cli).phrase;
    harness.clock.advance(pairingLifetimeMs);
    assert.throws(() => harness.service.pair(pairing(old), '10.0.0.1'), {
      code: 'PAIRING_REJECTED',
    });

    const open = harness.service.issue(cli).phrase;
    for (let attempt = 0; attempt < 19; attempt++) {
      assert.throws(() => harness.service.pair(pairing(`wrong ${attempt}`), `10.0.1.${attempt}`), {
        code: 'PAIRING_REJECTED',
      });
    }
    assert.throws(() => harness.service.pair(pairing('wrong again'), '10.0.2.1'), {
      code: 'PAIRING_REJECTED',
    });
    assert.throws(() => harness.service.pair(pairing(open), '10.0.2.2'), {
      code: 'PAIRING_REJECTED',
      message: /not valid or has expired/,
    });
    assert.equal(harness.registry.list().length, 0);
  } finally {
    await harness.close();
  }
});

test('pairing attempts are rate limited per address', async () => {
  const harness = await registryFor();
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      assert.throws(() => harness.service.pair(pairing(`wrong ${attempt}`), '10.0.0.9'), {
        code: 'PAIRING_REJECTED',
      });
    }
    assert.throws(() => harness.service.pair(pairing('wrong'), '10.0.0.9'), {
      code: 'RATE_LIMITED',
      status: 429,
      retryable: true,
    });
    harness.clock.advance(60_000);
    assert.throws(() => harness.service.pair(pairing('wrong'), '10.0.0.9'), {
      code: 'PAIRING_REJECTED',
    });
  } finally {
    await harness.close();
  }
});

test('revoking a device stops its token and is recorded once', async () => {
  const harness = await registryFor();
  try {
    const { device, token } = harness.service.pair(
      pairing(harness.service.issue(cli).phrase),
      '127.0.0.1',
    );
    const closed: string[] = [];
    harness.registry.onRevoked((id) => closed.push(id));
    const first = harness.service.revoke(device.id, cli, { commandId: 'revoke-command-1' });
    assert.notEqual(
      (first.body as { device: { revokedAt: number | null } }).device.revokedAt,
      null,
    );
    assert.deepEqual(
      harness.service.revoke(device.id, cli, { commandId: 'revoke-command-1' }),
      first,
    );
    harness.service.revoke(device.id, cli, {});
    assert.deepEqual(closed, [device.id], 'streams are told once, after the commit');
    assert.equal(harness.registry.authenticate(token), null);
    assert.throws(() => harness.service.revoke('missing', cli, {}), { code: 'DEVICE_NOT_FOUND' });
    assert.throws(() => harness.service.revoke(device.id, cli, { extra: true }), {
      code: 'INVALID_REQUEST',
    });
  } finally {
    await harness.close();
  }
});

test('the master key is a private file, and sealed values are bound to their context', async () => {
  const state = await temporaryState();
  try {
    const box = await SecretBox.open(state.path);
    const keyFile = join(state.path, 'secrets', 'master.key');
    assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
    const sealed = box.seal('secret', 'pairing:a');
    assert.equal((await SecretBox.open(state.path)).unseal(sealed, 'pairing:a'), 'secret');
    assert.throws(() => box.unseal(sealed, 'pairing:b'), { code: 'SECRET_UNAVAILABLE' });
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    assert.throws(() => box.unseal(parts.join('.'), 'pairing:a'), { code: 'SECRET_UNAVAILABLE' });
    await chmod(keyFile, 0o644);
    await assert.rejects(SecretBox.open(state.path), { code: 'UNSAFE_STATE_FILE' });
    await chmod(keyFile, 0o600);
    await writeFile(keyFile, '{"formatVersion":1,"current":2,"keys":{"1":"AA=="}}');
    await assert.rejects(SecretBox.open(state.path), { code: 'INVALID_MASTER_KEY' });
  } finally {
    await state.remove();
  }
});

test('a desktop client pairs over TCP, uses its token, and is cut off when revoked', async (t) => {
  const state = await temporaryState();
  t.after(() => state.remove());
  const server = await startChild(state.path);
  t.after(() => server.terminate());
  const info: unknown = await (await fetch(`${server.url}/api/v0/info`)).json();
  assert(validateServerInfo(info));
  assert.equal(info.capabilities.pairing, true);

  const issued = await runCli(['device', 'pair', '--state-dir', state.path]);
  assert.equal(issued.code, 0, issued.errors);
  const { phrase } = JSON.parse(issued.output) as { phrase: string };
  const pair = (body: unknown) =>
    fetch(`${server.url}/api/v0/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const response = await pair(pairing(phrase, 'pair-command-e2e'));
  assert.equal(response.status, 201);
  const paired: unknown = await response.json();
  assert(validatePairResponse(paired));
  assert.deepEqual(
    await (await pair(pairing(phrase, 'pair-command-e2e'))).json().then((body) => ({
      ...(body as object),
      requestId: paired.requestId,
    })),
    paired,
    'a lost response is recovered with the same command',
  );

  const call = (path: string, init: RequestInit = {}, token = paired.token) =>
    fetch(`${server.url}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
  const anonymous = await fetch(`${server.url}/api/v0/devices`);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('www-authenticate'), 'Bearer');
  assert(validateProtocolError(await anonymous.json()));
  const listed: unknown = await (await call('/api/v0/devices')).json();
  assert(validateDeviceList(listed));
  assert.equal(listed.currentDeviceId, paired.device.id);
  const another: unknown = await (await call('/api/v0/pairing', { method: 'POST' })).json();
  assert(validatePairingIssued(another));
  assert.notEqual(another.pairing.phrase, phrase);

  const revoked = await runCli(['device', 'revoke', paired.device.id, '--state-dir', state.path]);
  assert.equal(revoked.code, 0, revoked.errors);
  const device: unknown = {
    schemaVersion: 1,
    requestId: paired.requestId,
    device: JSON.parse(revoked.output),
  };
  assert(validateDeviceResponse(device));
  assert.notEqual(device.device.revokedAt, null);
  assert.equal((await call('/api/v0/devices')).status, 401);
  for (const secret of [phrase, paired.token]) {
    assert.equal(server.output().includes(secret), false);
    assert.equal(server.errors().includes(secret), false);
  }
});
