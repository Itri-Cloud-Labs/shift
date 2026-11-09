import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { EffectStore } from '../src/actions/effects.js';
import type { Json } from '../src/harness/types.js';
import { openStore } from '../src/persistence/store.js';
import { StaleClaim } from '../src/runs/repository.js';
import { normalizeDocument } from '../src/workflows/document.js';
import { DefinitionRepository } from '../src/workflows/repository.js';
import {
  action,
  actionWorkflow,
  local,
  run,
  settled,
  setup,
  skip,
  view,
} from './action-helpers.js';
import { FakeClock, eventually, temporaryState } from './helpers.js';

test(
  'a command runs an argument array in the run workspace without a shell',
  { skip },
  async () => {
    const env = await setup();
    try {
      const tricky = '$(touch pwned); `id` && echo ; | > x';
      const id = await run(
        env,
        actionWorkflow(
          'command',
          {
            executable: 'sh',
            args: [
              '-c',
              'printf "%s\\n" "$1" "$PWD" "$GREETING"; cat notes.txt',
              'arg0',
              '{{value}}',
            ],
            env: { GREETING: 'hello {{value}}' },
          },
          { bindings: { value: { kind: 'trigger', path: ['value'] } } },
        ),
        { value: tricky },
      );
      const done = await settled(env, id);
      assert.equal(done.state, 'COMPLETED', JSON.stringify(done.outcome));
      const data = done.outcome!.data!;
      const [first, cwd, greeting, notes] = (data['stdout'] as string).split('\n');
      assert.equal(first, tricky, 'the binding is one argument, never shell syntax');
      assert.equal(greeting, `hello ${tricky}`);
      assert.equal(notes, 'alpha beta');
      assert.match(cwd!, /\/workspaces\/[0-9a-f-]{36}$/, 'it runs in the run worktree');
      assert.equal(existsSync(join(cwd!, 'pwned')), false);
      assert.equal(data['exitCode'], 0);
      const operation = action(done).operations[0]!;
      assert.equal(operation.state, 'SUCCEEDED');
      assert.match(operation.key, /\/command\/1$/);
      assert.equal(typeof operation.evidence['unit'], 'string');
      assert.equal(typeof operation.evidence['pid'], 'number');
    } finally {
      await env.close();
    }
  },
);

test(
  'shell mode reads bindings from the environment, never from the script text',
  { skip },
  async () => {
    const env = await setup();
    try {
      const id = await run(
        env,
        actionWorkflow(
          'command',
          { mode: 'shell', script: 'echo "[$NAME]"; echo err >&2', env: { NAME: '{{name}}' } },
          { bindings: { name: { kind: 'trigger', path: ['name'] } } },
        ),
        { name: 'a; rm -rf /' },
      );
      const done = await settled(env, id);
      assert.equal(done.state, 'COMPLETED');
      assert.equal(done.outcome!.data!['stdout'], '[a; rm -rf /]\n');
      assert.equal(done.outcome!.data!['stderr'], 'err\n');
      // Publication refuses a binding inside the script itself.
      assert.throws(
        () =>
          env.definitions.publish(
            (
              env.definitions.createWorkflow({
                projectId: env.projectId,
                name: 'bad',
                draft: normalizeDocument(
                  actionWorkflow(
                    'command',
                    { mode: 'shell', script: 'echo {{name}}' },
                    {
                      bindings: { name: { kind: 'trigger', path: ['name'] } },
                    },
                  ),
                ) as Json,
              }) as { id: string }
            ).id,
          ),
        { code: 'INVALID_WORKFLOW' },
      );
    } finally {
      await env.close();
    }
  },
);

test(
  'output is capped to its tail, failures route to error, and timeouts stop every process',
  { skip },
  async () => {
    const env = await setup();
    try {
      const big = await settled(
        env,
        await run(
          env,
          actionWorkflow('command', {
            executable: 'sh',
            args: ['-c', 'head -c 300000 /dev/zero | tr "\\0" a; printf END'],
            maxOutputBytes: 1024,
          }),
        ),
      );
      assert.equal(big.state, 'COMPLETED');
      const data = big.outcome!.data!;
      assert.equal(data['stdoutTruncated'], true);
      assert.equal(data['stdoutBytes'], 300003);
      assert.equal((data['stdout'] as string).length, 1024);
      assert.ok((data['stdout'] as string).endsWith('aEND'));

      // A nonzero exit is a known failure: with an error connection it routes there.
      const document = actionWorkflow('command', {
        executable: 'sh',
        args: ['-c', 'echo no; exit 3'],
      });
      (document as { nodes: Json[] }).nodes.push({
        id: 'oops',
        type: 'end',
        config: { outcome: 'FAILED' },
      });
      (document as { connections: Json[] }).connections.push({
        id: 'c3',
        fromNodeId: 'act',
        fromPort: 'error',
        toNodeId: 'oops',
        toPort: 'input',
      });
      const failed = await settled(env, await run(env, document));
      assert.equal(failed.state, 'FAILED');
      const error = action(failed).error!;
      assert.equal(error.code, 'COMMAND_FAILED');
      assert.equal(error.details!['exitCode'], 3);
      assert.equal(error.details!['stdout'], 'no\n');
      assert.equal(failed.executions.at(-1)!.node, 'oops');
      assert.equal(action(failed).operations[0]!.state, 'FAILED');

      // A background child that outlives the command's own shell is stopped too.
      const marker = join(env.state, 'timeout-marker');
      const timed = await settled(
        env,
        await run(
          env,
          actionWorkflow('command', {
            executable: 'sh',
            args: ['-c', `(while true; do date +%s%N >> ${marker}; sleep 0.05; done) & sleep 60`],
            timeoutMs: 1000,
          }),
        ),
      );
      assert.equal(action(timed).error!.code, 'COMMAND_TIMED_OUT');
      const unit = action(timed).operations[0]!.evidence['unit'] as string;
      assert.equal(await env.runner.alive(unit), false);
      const size = (await readFile(marker)).length;
      await delay(300);
      assert.equal((await readFile(marker)).length, size, 'nothing writes after the timeout');
    } finally {
      await env.close();
    }
  },
);

test('a command cannot leave its workspace through cwd or a symbolic link', { skip }, async () => {
  const env = await setup();
  try {
    execFileSync('ln', ['-s', '/tmp', join(env.repository, 'outside')]);
    execFileSync('git', ['add', 'outside'], { cwd: env.repository });
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'link'],
      {
        cwd: env.repository,
      },
    );
    const done = await settled(
      env,
      await run(env, actionWorkflow('command', { executable: 'pwd', cwd: 'outside' })),
    );
    assert.equal(done.state, 'FAILED');
    assert.equal(action(done).error!.code, 'INVALID_DIRECTORY');
    assert.equal(action(done).operations[0]!.state, 'FAILED', 'nothing was submitted');
    assert.equal(action(done).operations[0]!.evidence['unit'], undefined);
  } finally {
    await env.close();
  }
});

test(
  'credentials are injected by name, redacted from output and stop working once revoked',
  { skip },
  async () => {
    const env = await setup();
    try {
      const put = env.credentials.put(
        env.projectId,
        { name: 'token', value: 's3cret-value' },
        local,
      );
      assert.equal(put.status, 201);
      assert.equal(JSON.stringify(put.body).includes('s3cret'), false);
      const receipt = env.store.db.prepare('SELECT * FROM command_receipts').all();
      assert.equal(JSON.stringify(receipt).includes('s3cret'), false, 'receipts hold no value');
      const document = actionWorkflow('command', {
        executable: 'sh',
        args: ['-c', 'echo "token=$TOKEN"; test "$(printf %s "$TOKEN" | wc -c)" = 12'],
        credentials: { TOKEN: 'token' },
      });
      const done = await settled(env, await run(env, document));
      assert.equal(done.state, 'COMPLETED');
      assert.equal(done.outcome!.data!['stdout'], 'token=[redacted]\n');
      const everything = JSON.stringify([
        env.store.db.prepare('SELECT * FROM node_executions').all(),
        env.store.db.prepare('SELECT * FROM effect_operations').all(),
        env.store.db.prepare('SELECT * FROM events').all(),
        env.store.db.prepare('SELECT snapshot_json FROM runs').all(),
      ]);
      assert.equal(
        everything.includes('s3cret'),
        false,
        `no stored record holds the value: ${everything.slice(Math.max(0, everything.indexOf('s3cret') - 300), everything.indexOf('s3cret') + 50)}`,
      );

      // An unknown name is refused before anything runs.
      const unknown = await settled(
        env,
        await run(
          env,
          actionWorkflow('command', { executable: 'true', credentials: { X: 'missing' } }),
        ),
      );
      assert.equal(action(unknown).error!.code, 'CREDENTIAL_UNAVAILABLE');

      // A run admitted with the credential loses it when it is revoked before the action runs.
      const waiting = actionWorkflow('command', {
        executable: 'sh',
        args: ['-c', 'echo $TOKEN'],
        credentials: { TOKEN: 'token' },
      });
      (waiting as { nodes: Json[] }).nodes.splice(1, 0, {
        id: 'pause',
        type: 'wait',
        config: { durationMs: 400 },
      });
      (waiting as { connections: Array<Record<string, Json>> }).connections[0]!['toNodeId'] =
        'pause';
      (waiting as { connections: Json[] }).connections.push({
        id: 'c0',
        fromNodeId: 'pause',
        fromPort: 'success',
        toNodeId: 'act',
        toPort: 'input',
      });
      const revokedId = await run(env, waiting);
      const credentialId = (put.body as { credential: { id: string } }).credential.id;
      env.credentials.revoke(env.projectId, credentialId, {}, local);
      // The test clock stands still; the wait falls due once its row says so.
      env.store.db.prepare("UPDATE wakeups SET due_at = 0 WHERE state = 'PENDING'").run();
      const revoked = await settled(env, revokedId);
      assert.equal(action(revoked).error!.code, 'CREDENTIAL_UNAVAILABLE');
    } finally {
      await env.close();
    }
  },
);

test(
  'a current permission revocation stops actions of runs admitted before it',
  { skip },
  async () => {
    const env = await setup();
    try {
      env.credentials.setPermissions(env.projectId, { deny: ['command'] }, local);
      const denied = await settled(
        env,
        await run(env, actionWorkflow('command', { executable: 'true' })),
      );
      assert.equal(action(denied).error!.code, 'ACTION_NOT_PERMITTED');
      assert.equal(action(denied).operations.length, 0, 'no intent is recorded');
      env.credentials.setPermissions(env.projectId, { allow: ['command'] }, local);
      const allowed = await settled(
        env,
        await run(env, actionWorkflow('command', { executable: 'true' })),
      );
      assert.equal(allowed.state, 'COMPLETED');
    } finally {
      await env.close();
    }
  },
);

async function listen(
  handler: (req: IncomingMessage, body: string) => [number, Record<string, string>, string] | null,
): Promise<{
  url: string;
  server: Server;
  requests: Array<{ method: string; headers: IncomingMessage['headers']; body: string }>;
}> {
  const requests: Array<{ method: string; headers: IncomingMessage['headers']; body: string }> = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ method: req.method!, headers: req.headers, body });
      const reply = handler(req, body);
      if (!reply) return; // hang
      res.writeHead(reply[0], reply[1]).end(reply[2]);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server, requests };
}

test(
  'HTTP requests carry bindings and credential headers, validate responses and cap bodies',
  { skip },
  async () => {
    const env = await setup();
    const http = await listen((req) => {
      if (req.url === '/ok') return [200, { 'content-type': 'application/json' }, '{"n":2}'];
      // Echoes the token it was given without its prefix, as a careless API might.
      if (req.url === '/echo')
        return [
          200,
          { 'content-type': 'text/plain', 'x-seen': String(req.headers['authorization']).slice(7) },
          `seen ${String(req.headers['authorization']).slice(7)}`,
        ];
      if (req.url === '/big') return [200, { 'content-type': 'text/plain' }, 'x'.repeat(5000)];
      if (req.url === '/fail') return [503, { 'content-type': 'text/plain' }, 'down'];
      return null;
    });
    try {
      env.credentials.put(env.projectId, { name: 'api', value: 'tok-123456' }, local);
      const ok = await settled(
        env,
        await run(
          env,
          actionWorkflow(
            'http',
            {
              method: 'POST',
              url: `${http.url}/ok`,
              headers: { 'x-item': '{{item}}' },
              credentialHeaders: { authorization: { credential: 'api', prefix: 'Bearer ' } },
              body: { kind: 'json', value: { item: { $binding: 'item' } } },
              responseSchema: { type: 'object', required: ['n'] },
            },
            { bindings: { item: { kind: 'trigger', path: ['item'] } } },
          ),
          { item: 'apple' },
        ),
      );
      assert.equal(ok.state, 'COMPLETED', JSON.stringify(action(ok).error));
      assert.deepEqual(ok.outcome!.data!['body'], { n: 2 });
      assert.equal(ok.outcome!.data!['status'], 200);
      const sent = http.requests[0]!;
      assert.equal(sent.headers['authorization'], 'Bearer tok-123456');
      assert.equal(sent.headers['x-item'], 'apple');
      assert.deepEqual(JSON.parse(sent.body), { item: 'apple' });
      assert.equal(
        JSON.stringify(env.store.db.prepare('SELECT * FROM effect_operations').all()).includes(
          'tok-123456',
        ),
        false,
      );

      const echoed = await settled(
        env,
        await run(
          env,
          actionWorkflow('http', {
            url: `${http.url}/echo`,
            credentialHeaders: { authorization: { credential: 'api', prefix: 'Bearer ' } },
          }),
        ),
      );
      assert.equal(echoed.outcome!.data!['body'], 'seen [redacted]');
      assert.equal(
        (echoed.outcome!.data!['headers'] as Record<string, string>)['x-seen'],
        '[redacted]',
      );
      assert.equal(
        JSON.stringify(env.store.db.prepare('SELECT * FROM node_executions').all()).includes(
          'tok-123456',
        ),
        false,
      );
      const invalid = await settled(
        env,
        await run(
          env,
          actionWorkflow('http', { url: `${http.url}/ok`, responseSchema: { type: 'array' } }),
        ),
      );
      assert.equal(action(invalid).error!.code, 'HTTP_RESPONSE_INVALID');
      const big = await settled(
        env,
        await run(env, actionWorkflow('http', { url: `${http.url}/big`, maxResponseBytes: 1024 })),
      );
      assert.equal(action(big).error!.code, 'HTTP_RESPONSE_TOO_LARGE');
      // A safe read that hits a server error is retried automatically. The test clock stands
      // still, so the retry's wake-up is made due by hand.
      const due = setInterval(
        () => env.store.db.prepare("UPDATE wakeups SET due_at = 0 WHERE state = 'PENDING'").run(),
        50,
      );
      const failing = await settled(
        env,
        await run(
          env,
          actionWorkflow(
            'http',
            { url: `${http.url}/fail` },
            {
              retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
            },
          ),
        ),
      );
      clearInterval(due);
      assert.equal(action(failing).error!.code, 'HTTP_STATUS');
      assert.equal(action(failing).attempts.length, 2);
      assert.equal(action(failing).operations.length, 2, 'each attempt is its own operation');
    } finally {
      http.server.closeAllConnections();
      http.server.close();
      await env.close();
    }
  },
);

test(
  'a write whose response never arrives waits for the owner instead of retrying',
  { skip },
  async () => {
    const env = await setup();
    const http = await listen(() => null);
    try {
      const id = await run(
        env,
        actionWorkflow(
          'http',
          { method: 'POST', url: `${http.url}/hang`, timeoutMs: 1000 },
          {
            retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
          },
        ),
      );
      const stuck = await settled(env, id);
      assert.equal(stuck.state, 'NEEDS_HUMAN');
      assert.equal(stuck.attention!.code, 'EFFECT_UNCERTAIN');
      assert.equal(action(stuck).operations[0]!.state, 'UNKNOWN');
      assert.equal(action(stuck).attempts.length, 1, 'no automatic retry');
      // The owner checked and retries: the uncertain operation is set aside with who decided.
      env.engine.controlRun(id, 'retry', {});
      const again = await settled(env, id);
      assert.equal(again.state, 'NEEDS_HUMAN');
      const operations = action(again).operations;
      assert.deepEqual(
        operations.map((operation) => operation.state),
        ['ABANDONED', 'UNKNOWN'],
      );
      assert.deepEqual(
        (operations[0]!.resolution as { by: string; control: string }).control,
        'retry',
      );
      assert.equal(http.requests.length, 2);
      // The owner verified that it worked and records the result.
      env.engine.controlRun(id, 'complete', { data: { status: 201 } });
      const finished = await settled(env, id);
      assert.equal(finished.state, 'COMPLETED');
      assert.deepEqual(finished.outcome!.data, { status: 201 });
    } finally {
      http.server.closeAllConnections();
      http.server.close();
      await env.close();
    }
  },
);

test(
  'a script returns validated JSON from a bounded process without files or secrets',
  { skip },
  async () => {
    const env = await setup();
    try {
      const ok = await settled(
        env,
        await run(
          env,
          actionWorkflow(
            'script',
            {
              source:
                "console.log('working'); return { doubled: input.n * 2, word: bindings.word, env: Object.keys(process.env).filter((k) => !['PATH', 'INVOCATION_ID'].includes(k)) };",
              resultSchema: { type: 'object', required: ['doubled'] },
            },
            { bindings: { word: { kind: 'trigger', path: ['word'] } } },
          ),
          { n: 21, word: 'hi' },
        ),
      );
      assert.equal(ok.state, 'COMPLETED', JSON.stringify(action(ok).error));
      assert.deepEqual(ok.outcome!.data, { doubled: 42, word: 'hi', env: [] });
      const blocked = await settled(
        env,
        await run(
          env,
          actionWorkflow('script', {
            source: "return require('node:fs').readFileSync('/etc/hostname', 'utf8');",
          }),
        ),
      );
      assert.equal(action(blocked).error!.code, 'SCRIPT_FAILED');
      assert.match(action(blocked).error!.message, /restricted|ERR_ACCESS_DENIED/);
      const invalid = await settled(
        env,
        await run(
          env,
          actionWorkflow('script', { source: 'return 1;', resultSchema: { type: 'string' } }),
        ),
      );
      assert.equal(action(invalid).error!.code, 'SCRIPT_RESULT_INVALID');
      const looping = await settled(
        env,
        await run(env, actionWorkflow('script', { source: 'for (;;) {}', timeoutMs: 500 })),
      );
      assert.equal(action(looping).error!.code, 'SCRIPT_TIMED_OUT');
      const nothing = await settled(
        env,
        await run(env, actionWorkflow('script', { source: 'let x = 1;' })),
      );
      assert.match(action(nothing).error!.message, /returned nothing/);
    } finally {
      await env.close();
    }
  },
);

test(
  'a cancelled command is stopped, accounted for and recorded as unknown',
  { skip },
  async () => {
    const env = await setup();
    try {
      const id = await run(env, actionWorkflow('command', { executable: 'sleep', args: ['60'] }));
      const operation = await eventually(() =>
        view(env, id).executions.find((entry) => entry.node === 'act')?.operations[0]?.evidence[
          'pid'
        ]
          ? action(view(env, id)).operations[0]
          : undefined,
      );
      env.engine.controlRun(id, 'cancel', { reason: 'enough' });
      const done = await settled(env, id);
      assert.equal(done.state, 'CANCELLED');
      assert.equal(await env.runner.alive(operation.evidence['unit'] as string), false);
      const after = action(done).operations[0]!;
      assert.equal(after.state, 'UNKNOWN');
      assert.equal(after.evidence['stoppedBy'], 'cancellation');
    } finally {
      await env.close();
    }
  },
);

test(
  'effects are fenced, keep their arguments and reuse a recorded outcome',
  { skip },
  async () => {
    const env = await setup();
    try {
      const id = await run(env, actionWorkflow('command', { executable: 'true' }));
      await settled(env, id);
      const db = env.store.db;
      const row = db.prepare('SELECT execution_id, attempt_id FROM effect_operations').get() as {
        execution_id: string;
        attempt_id: string;
      };
      const effects = new EffectStore(db, new FakeClock());
      const stale = {
        attemptId: row.attempt_id,
        executionId: row.execution_id,
        runId: id,
        fence: 1,
      };
      // The attempt finished, so its claim can no longer record or submit anything.
      assert.throws(() => effects.intend(stale, 'command', {}), StaleClaim);
      const operation = effects.latest(row.execution_id, 'command')!;
      assert.throws(() => effects.submit(stale, operation.id), StaleClaim);
      assert.throws(() => effects.adopt(stale, operation, { other: true } as Json));
    } finally {
      await env.close();
    }
  },
);

// A stop leaves the attempt RUNNING and its operation SUBMITTED, as a crash would; the next
// start finds them under a new worker generation. The real crash is in run-e2e.test.ts.
for (const [label, config, expected] of [
  ['an uncertain write waits for the owner after a restart', {}, 'NEEDS_HUMAN'],
  [
    'a declared safe command is stopped and run again after a restart',
    { safeToRetry: true },
    'RERUN',
  ],
] as const) {
  test(label, { skip }, async () => {
    const env = await setup();
    const marker = join(env.state, 'ran');
    const id = await run(
      env,
      actionWorkflow('command', {
        executable: 'sh',
        args: ['-c', `echo x >> ${marker}; sleep 60`],
        ...config,
      }),
    );
    await eventually(() => (existsSync(marker) ? true : undefined));
    await env.close();
    const again = await setup(env.state);
    const runs = async () => (await readFile(marker, 'utf8')).match(/x/g)!.length;
    try {
      if (expected === 'RERUN') {
        await eventuallyAsync(async () => ((await runs()) >= 2 ? true : undefined));
        const operations = action(view(again, id)).operations;
        assert.equal(operations[0]!.state, 'ABANDONED');
        assert.deepEqual(operations[0]!.resolution, { by: 'shift', reason: 'safe_to_repeat' });
        assert.equal(operations[1]!.state, 'SUBMITTED');
        assert.equal(await again.runner.alive(operations[0]!.evidence['unit'] as string), false);
      } else {
        const stuck = await settled(again, id);
        assert.equal(stuck.state, 'NEEDS_HUMAN');
        assert.equal(stuck.attention!.code, 'EFFECT_UNCERTAIN');
        const operation = action(stuck).operations[0]!;
        assert.equal(operation.state, 'UNKNOWN');
        assert.equal(operation.evidence['stoppedBy'], 'shutdown');
        assert.equal(await runs(), 1, 'never repeated');
      }
    } finally {
      await again.close();
    }
  });
}

test('a recorded outcome is reported after a restart, never repeated', { skip }, async () => {
  const env = await setup();
  const marker = join(env.state, 'ran');
  const id = await run(
    env,
    actionWorkflow('command', { executable: 'sh', args: ['-c', `echo x >> ${marker}`] }),
  );
  await settled(env, id);
  await env.close();
  // Roll the run back to just before the step's completion committed: the operation succeeded.
  const db = (await openStore({ stateDirectory: env.state, clock: new FakeClock() })).db;
  const execution = db
    .prepare("SELECT id FROM node_executions WHERE run_id = ? AND node_id = 'act'")
    .get(id) as { id: string };
  db.pragma('foreign_keys = OFF');
  db.prepare("DELETE FROM node_executions WHERE run_id = ? AND node_id = 'end'").run(id);
  db.prepare(
    "UPDATE node_executions SET state = 'RUNNING', output_json = NULL, selected_port = NULL, finished_at = NULL WHERE id = ?",
  ).run(execution.id);
  db.prepare(
    "UPDATE node_attempts SET state = 'RUNNING', finished_at = NULL, worker_generation = 'dead' WHERE execution_id = ?",
  ).run(execution.id);
  db.prepare(
    "UPDATE runs SET state = 'RUNNING', outcome_json = NULL, finished_at = NULL WHERE id = ?",
  ).run(id);
  db.close();
  const again = await setup(env.state);
  try {
    const done = await settled(again, id);
    assert.equal(done.state, 'COMPLETED');
    assert.equal((await readFile(marker, 'utf8')).match(/x/g)!.length, 1);
    assert.equal(action(done).operations.length, 1);
  } finally {
    await again.close();
  }
});

test(
  'an operation recorded with other arguments is a conflict for the owner',
  { skip },
  async () => {
    const env = await setup();
    const id = await run(env, actionWorkflow('command', { executable: 'true' }));
    await settled(env, id);
    await env.close();
    const db = (await openStore({ stateDirectory: env.state, clock: new FakeClock() })).db;
    const execution = db
      .prepare("SELECT id FROM node_executions WHERE run_id = ? AND node_id = 'act'")
      .get(id) as { id: string };
    db.pragma('foreign_keys = OFF');
    db.prepare("DELETE FROM node_executions WHERE run_id = ? AND node_id = 'end'").run(id);
    db.prepare(
      "UPDATE node_executions SET state = 'RUNNING', output_json = NULL, selected_port = NULL WHERE id = ?",
    ).run(execution.id);
    db.prepare(
      "UPDATE node_attempts SET state = 'RUNNING', worker_generation = 'dead' WHERE execution_id = ?",
    ).run(execution.id);
    db.prepare(
      "UPDATE runs SET state = 'RUNNING', outcome_json = NULL, finished_at = NULL WHERE id = ?",
    ).run(id);
    // As if the operation had been recorded before its intent was fixed differently.
    db.prepare(
      "UPDATE effect_operations SET state = 'INTENDED', result_json = NULL, args_hash = '0000000000000000000000000000000000000000000000000000000000000000'",
    ).run();
    db.close();
    const again = await setup(env.state);
    try {
      const stuck = await settled(again, id);
      assert.equal(stuck.state, 'NEEDS_HUMAN');
      assert.equal(stuck.attention!.code, 'EFFECT_CONFLICT');
    } finally {
      await again.close();
    }
  },
);

async function eventuallyAsync<T>(
  read: () => Promise<T | undefined>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error('Timed out.');
}

test('publication refuses malformed action nodes', async () => {
  const state = await temporaryState();
  const store = await openStore({ stateDirectory: state.path, clock: new FakeClock() });
  try {
    const definitions = new DefinitionRepository(store.db, new FakeClock());
    const project = definitions.addProject({ name: 'p', repositoryPath: '/repo', baseRef: 'main' });
    const refused = (type: string, config: Json, pattern: RegExp) => {
      const workflow = definitions.createWorkflow({
        projectId: project.id,
        name: `w-${Math.random()}`,
        draft: normalizeDocument(actionWorkflow(type, config)) as Json,
      }) as { id: string };
      assert.throws(
        () => definitions.publish(workflow.id),
        (error: { code: string; message: string; fieldMessages?: Record<string, string> }) => {
          assert.equal(error.code, 'INVALID_WORKFLOW');
          assert.match(JSON.stringify(error), pattern);
          return true;
        },
      );
    };
    refused('command', {}, /needs an executable/);
    refused('command', { mode: 'shell', script: 'ls', args: ['x'] }, /takes no executable/);
    refused('command', { executable: 'ls', cwd: '../up' }, /stays inside it/);
    refused('http', { url: 'https://user:pw@example.com' }, /never in the URL/);
    refused('http', { url: 'ftp://example.com' }, /http and https/);
    refused(
      'http',
      { url: 'https://example.com', body: { kind: 'text', text: 'x' } },
      /has no body/,
    );
    refused(
      'http',
      {
        url: 'https://example.com',
        headers: { Authorization: 'x' },
        credentialHeaders: { authorization: { credential: 'api' } },
      },
      /also set in headers/,
    );
    refused('script', { source: 'return 1', resultSchema: { type: 'nope' } }, /JSON Schema/);
  } finally {
    store.close();
    await state.remove();
  }
});
