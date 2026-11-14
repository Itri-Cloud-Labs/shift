import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Writable } from 'node:stream';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pino } from 'pino';
import type { Json } from '../src/harness/types.js';
import { createHttpServer } from '../src/http.js';
import { ReadinessState } from '../src/lifecycle/readiness.js';
import { CommandReceipts } from '../src/persistence/receipts.js';
import { SecretBox } from '../src/secrets/secret-box.js';
import { HttpTriggers } from '../src/triggers/http-triggers.js';
import { local, setup, type Env } from './action-helpers.js';
import { eventually, workspace } from './helpers.js';
import {
  cancel,
  occurrencesOf,
  publish,
  republish,
  runsOf,
  withTriggers,
} from './trigger-helpers.js';

const run = promisify(execFile);
const minute = 60_000;

// A webhook-triggered workflow behind a real TCP listener, with a log that records everything.
async function serve(env: Env) {
  const { triggers } = withTriggers(env);
  const http = new HttpTriggers({
    db: env.store.db,
    clock: env.clock,
    secrets: await SecretBox.open(env.state),
    receipts: new CommandReceipts(env.store.db, env.clock),
    triggers,
    definitions: env.definitions,
  });
  const lines: string[] = [];
  const logger = pino(
    { level: 'trace' },
    new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    }),
  );
  const server: Server = createHttpServer({
    store: env.store,
    clock: env.clock,
    readiness: new ReadinessState(),
    logger,
    administrative: false,
    stop: () => {},
    devices: {} as never,
    triggers,
    httpTriggers: http,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    triggers,
    http,
    lines,
    url: (triggerId: string) => `${base}/api/v0/triggers/${triggerId}/events`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// webhook -> transform -> end, with an input schema.
const general = (auth: string, overlap = 'allow', extra: Record<string, Json> = {}): Json => ({
  execution: { overlap },
  nodes: [
    {
      id: 'hook',
      type: 'webhook_trigger',
      config: {
        auth,
        inputSchema: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
        ...extra,
      },
    },
    {
      id: 'shape',
      type: 'transform',
      config: { data: { greeting: { $binding: 'name' } } },
      bindings: { name: { kind: 'trigger', path: ['name'] } },
    },
    { id: 'end', type: 'end' },
  ],
  connections: [
    { id: 'c1', fromNodeId: 'hook', fromPort: 'success', toNodeId: 'shape', toPort: 'input' },
    { id: 'c2', fromNodeId: 'shape', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
  ],
});

const post = (url: string, body: string, headers: Record<string, string>) =>
  fetch(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  });

// A signed request's headers: the signature covers the timestamp, the event ID and the body.
const signed = (secret: string, body: string, at = Date.now(), eventId = 'evt-1') => {
  const timestamp = String(Math.floor(at / 1000));
  return {
    'x-shift-event-id': eventId,
    'x-shift-timestamp': timestamp,
    'x-shift-signature': `sha256=${createHmac('sha256', secret).update(`${timestamp}.${eventId}.${body}`).digest('hex')}`,
  };
};

test('a local sender starts a general graph with an authenticated event, which survives restart', async () => {
  const env = await setup();
  let current = env;
  let served = await serve(env);
  try {
    const { workflowId } = publish(env, general('signature'));
    const trigger = served.triggers.triggers(workflowId)[0]!;
    // The secret appears once, in the issuing response.
    const issued = served.http.issueCommand(trigger.id, { commandId: 'issue-0001' }, local);
    const secret = (issued.body as { secret: string }).secret;
    assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
    // The fixture signs with the real clock; move the test clock there.
    env.clock.advance(Date.now() - env.clock.now());
    const event = join(env.state, 'event.json');
    await writeFile(event, '{"name":"Ada"}');
    const sent = await run(
      process.execPath,
      [
        `${workspace}/tools/send-trigger-event.mjs`,
        served.url(trigger.id),
        '--file',
        event,
        '--signature',
        '--event-id',
        'order-1',
      ],
      { env: { ...process.env, SHIFT_TRIGGER_SECRET: secret }, timeout: 20_000 },
    );
    assert.match(sent.stdout, /^202 /);
    const runs = await eventually(() => {
      const list = runsOf(env, workflowId);
      return list.length === 1 && list[0]!.state === 'COMPLETED' ? list : undefined;
    });
    const output = (
      env.engine.repository.run(runs[0]!.id) as {
        outcome: { data: Record<string, Json> };
      }
    ).outcome.data;
    assert.deepEqual(output, { greeting: 'Ada' });
    // After a restart, the same event ID with the same body returns the original occurrence.
    await served.close();
    await env.close();
    current = await setup(env.state);
    served = await serve(current);
    // The restarted test clock starts at its default; move it to the real clock to sign.
    current.clock.advance(Date.now() - current.clock.now());
    const replay = await post(
      served.url(trigger.id),
      '{"name":"Ada"}',
      signed(secret, '{"name":"Ada"}', Date.now(), 'order-1'),
    );
    assert.equal(replay.status, 200);
    const body = (await replay.json()) as {
      duplicate: boolean;
      occurrence: { id: string; runId: string };
    };
    assert.equal(body.duplicate, true);
    assert.equal(body.occurrence.runId, runs[0]!.id);
    assert.equal(runsOf(current, workflowId).length, 1);
  } finally {
    await served.close();
    await current.close();
  }
});

test('bad, revoked and expired credentials, invalid input and oversized bodies are refused', async () => {
  const env = await setup();
  const served = await serve(env);
  try {
    const { workflowId } = publish(env, general('bearer'));
    const signedFlow = publish(env, general('signature')).workflowId;
    const trigger = served.triggers.triggers(workflowId)[0]!;
    const signedTrigger = served.triggers.triggers(signedFlow)[0]!;
    const url = served.url(trigger.id);
    const ok = '{"name":"Ada"}';
    // No credential issued yet.
    assert.equal((await post(url, ok, { authorization: `Bearer ${'x'.repeat(43)}` })).status, 401);
    const first = served.http.issue(trigger.id).secret;
    const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
    for (const [body, headers, status] of [
      [ok, {}, 401],
      [ok, bearer('y'.repeat(43)), 401],
      ['{"name": 7}', bearer(first), 422],
      ['{"other":"x"}', bearer(first), 422],
      ['not json', bearer(first), 400],
      [JSON.stringify({ name: 'x'.repeat(1_100_000) }), bearer(first), 413],
      [JSON.stringify({ name: 'x'.repeat(2_200_000) }), bearer(first), 413],
    ] as const) {
      const response = await post(url, body, headers);
      assert.equal(
        response.status,
        status,
        `${body.slice(0, 20)} ${JSON.stringify(headers).slice(0, 30)}`,
      );
    }
    const plain = await fetch(url, {
      method: 'POST',
      body: ok,
      headers: { ...bearer(first), 'content-type': 'text/plain' },
    });
    assert.equal(plain.status, 415);
    assert.equal(occurrencesOf(env, workflowId).length, 0);
    assert.equal((await post(url, ok, bearer(first))).status, 202);
    // A rotation with a window keeps the old secret working until it ends.
    const second = served.http.issue(trigger.id, 5).secret;
    assert.equal((await post(url, ok, bearer(first))).status, 202);
    assert.equal((await post(url, ok, bearer(second))).status, 202);
    env.clock.advance(6 * minute);
    assert.equal((await post(url, ok, bearer(first))).status, 401);
    assert.equal((await post(url, ok, bearer(second))).status, 202);
    // Without a window it stops at once; a revocation stops everything.
    const third = served.http.issue(trigger.id).secret;
    assert.equal((await post(url, ok, bearer(second))).status, 401);
    served.http.revokeCommand(trigger.id, { commandId: 'revoke-0001' }, local);
    assert.equal((await post(url, ok, bearer(third))).status, 401);
    assert.equal(occurrencesOf(env, workflowId).length, 4);
    // Signatures: a wrong one, the bearer form, and a stale timestamp are refused.
    const key = served.http.issue(signedTrigger.id).secret;
    const signedUrl = served.url(signedTrigger.id);
    assert.equal((await post(signedUrl, ok, bearer(key))).status, 401);
    assert.equal(
      (await post(signedUrl, ok, signed('z'.repeat(43), ok, env.clock.now()))).status,
      401,
    );
    assert.equal(
      (await post(signedUrl, ok, signed(key, ok, env.clock.now() - 6 * minute))).status,
      401,
    );
    assert.equal((await post(signedUrl, ok, signed(key, `${ok} `, env.clock.now()))).status, 401);
    const valid = signed(key, ok, env.clock.now(), 'evt-signed');
    assert.equal((await post(signedUrl, ok, valid)).status, 202);
    // A captured request cannot be sent again as another event: changing or removing the signed
    // event ID breaks the signature, and the same request again is the same event.
    assert.equal(
      (await post(signedUrl, ok, { ...valid, 'x-shift-event-id': 'evt-other' })).status,
      401,
    );
    const { 'x-shift-event-id': _removed, ...withoutId } = valid;
    assert.equal((await post(signedUrl, ok, withoutId)).status, 401);
    const again = await post(signedUrl, ok, valid);
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { duplicate: boolean }).duplicate, true);
    assert.equal(occurrencesOf(env, signedFlow).length, 1);
    // An unknown trigger.
    assert.equal(
      (await post(served.url('00000000-0000-4000-8000-000000000000'), ok, bearer(key))).status,
      404,
    );
  } finally {
    await served.close();
    await env.close();
  }
});

test('an event ID returns its first answer, even when that acknowledgement was lost', async () => {
  const env = await setup();
  const served = await serve(env);
  try {
    const { workflowId } = publish(env, general('bearer'));
    const trigger = served.triggers.triggers(workflowId)[0]!;
    const secret = served.http.issue(trigger.id).secret;
    const url = served.url(trigger.id);
    const headers = { authorization: `Bearer ${secret}`, 'x-shift-event-id': 'evt-42' };
    // The first answer is never read, as if the connection dropped after the server committed.
    const lost = await post(url, '{"name":"Ada"}', headers);
    void lost.body?.cancel();
    const [a, b] = await Promise.all([
      post(url, '{"name":"Ada"}', headers),
      post(url, '{"name":"Ada"}', headers),
    ]);
    for (const response of [a, b]) {
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as { duplicate: boolean }).duplicate, true);
    }
    assert.equal(occurrencesOf(env, workflowId).length, 1);
    assert.equal(runsOf(env, workflowId).length, 1);
    // The same ID with another body is a conflict, not a new event.
    assert.equal((await post(url, '{"name":"Bob"}', headers)).status, 409);
    // Without an ID, each request is its own event.
    await post(url, '{"name":"Cy"}', { authorization: headers.authorization });
    await post(url, '{"name":"Cy"}', { authorization: headers.authorization });
    assert.equal(occurrencesOf(env, workflowId).length, 3);
  } finally {
    await served.close();
    await env.close();
  }
});

test('queue, Pause and publication keep captured inputs and versions; secrets stay out of records', async () => {
  const env = await setup();
  const served = await serve(env);
  try {
    const held = (title: string): Json => ({
      execution: { overlap: 'queue' },
      nodes: [
        { id: 'hook', type: 'webhook_trigger', config: { auth: 'bearer' } },
        { id: 'hold', type: 'approval', config: { title } },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'hook', fromPort: 'success', toNodeId: 'hold', toPort: 'input' },
      ],
    });
    const { workflowId, versionId: v1 } = publish(env, held('First'));
    const trigger = served.triggers.triggers(workflowId)[0]!;
    const issued = served.http.issueCommand(trigger.id, { commandId: 'issue-0002' }, local);
    const secret = (issued.body as { secret: string }).secret;
    // A repeated issue command answers from its receipt, without the secret.
    const repeated = served.http.issueCommand(trigger.id, { commandId: 'issue-0002' }, local);
    assert.equal((repeated.body as { secret: string | null }).secret, null);
    const url = served.url(trigger.id);
    const send = (name: string) =>
      post(url, JSON.stringify({ name }), { authorization: `Bearer ${secret}` });
    assert.equal((await send('one')).status, 202);
    const queued = (await (await send('two')).json()) as { occurrence: { state: string } };
    assert.equal(queued.occurrence.state, 'QUEUED');
    // The node keeps its ID and type, so its endpoint and credential survive the publication.
    republish(env, workflowId, held('Second'));
    assert.equal(served.triggers.triggers(workflowId)[0]!.id, trigger.id);
    env.definitions.setEnabled(workflowId, false);
    const paused = (await (await send('three')).json()) as {
      occurrence: { state: string; reason: string };
    };
    assert.deepEqual(
      [paused.occurrence.state, paused.occurrence.reason],
      ['SKIPPED', 'WORKFLOW_PAUSED'],
    );
    cancel(env, runsOf(env, workflowId)[0]!.id);
    await eventually(() => (runsOf(env, workflowId)[0]!.state === 'CANCELLED' ? true : undefined));
    await served.triggers.drain();
    assert.equal(runsOf(env, workflowId).length, 1);
    env.definitions.setEnabled(workflowId, true);
    await served.triggers.drain();
    const runs = runsOf(env, workflowId);
    assert.equal(runs.length, 2);
    assert.equal(runs[1]!.workflow_version_id, v1);
    const trig = (
      env.engine.repository.run(runs[1]!.id) as {
        executions: Array<{ node: string; output: { data: Json } }>;
      }
    ).executions.find((entry) => entry.node === 'hook')!;
    assert.deepEqual(trig.output.data, { name: 'two' });
    // No table, event, snapshot, receipt or log line holds the secret.
    const tables = env.store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const rows = env.store.db.prepare(`SELECT * FROM "${name}"`).all();
      assert.ok(!JSON.stringify(rows).includes(secret), `the secret is in ${name}`);
    }
    // A refused request carrying the secret is logged without it.
    await fetch(url, {
      method: 'POST',
      body: '{}',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'text/plain' },
    });
    assert.ok(served.lines.some((line) => line.includes('UNSUPPORTED_MEDIA_TYPE')));
    assert.ok(!served.lines.join('').includes(secret));
  } finally {
    await served.close();
    await env.close();
  }
});
