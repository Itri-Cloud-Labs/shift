import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { GitHubApi } from '../src/github/api.js';
import { marker } from '../src/github/actions.js';
import type { Json } from '../src/harness/types.js';
import {
  actionWorkflow,
  chain,
  interrupt,
  local,
  run,
  settled,
  setup,
  skip,
  step,
  type Env,
} from './action-helpers.js';
import { FakeGitHub } from './github-fake.js';
import { FakeClock } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

type AppBody = {
  app: {
    id: string;
    webhookPath: string;
    privateKey: string;
    webhookSecret: string;
    installations: Array<{
      id: string;
      installationId: number;
      repositories: Array<{ id: number }>;
    }>;
  };
};

const webhookSecret = 'whsec-0123456789abcdef';

// A project bound to the fake's acme/widgets (repository 9001) through its one installation.
async function connected(
  options: { fake?: FakeGitHub; env?: Env } = {},
): Promise<{ env: Env; fake: FakeGitHub; appRowId: string; close(): Promise<void> }> {
  const env = options.env ?? (await setup());
  const fake = options.fake ?? new FakeGitHub(env.clock);
  if (!options.fake) await fake.start();
  const registered = (
    await env.github.register(
      { appId: fake.appId, host: fake.origin, privateKey: fake.privateKey, webhookSecret },
      local,
    )
  ).body as AppBody;
  const installation = registered.app.installations[0]!;
  await env.github.connect(
    env.projectId,
    { installationId: installation.id, repositoryId: 9001 },
    local,
  );
  return {
    env,
    fake,
    appRowId: registered.app.id,
    async close() {
      try {
        await env.close();
      } finally {
        await fake.stop();
      }
    },
  };
}

test('registering the App verifies its key and lists installations without echoing secrets', async () => {
  const env = await setup();
  const fake = new FakeGitHub(env.clock);
  await fake.start();
  try {
    // A key GitHub does not know for this App is refused, and nothing is stored.
    const stranger = FakeGitHub.keyPair();
    await assert.rejects(
      env.github.register(
        { appId: fake.appId, host: fake.origin, privateKey: stranger.privateKey },
        local,
      ),
      { code: 'GITHUB_AUTH_FAILED' },
    );
    await assert.rejects(
      env.github.register(
        { appId: fake.appId, host: fake.origin, privateKey: 'not a key'.repeat(20) },
        local,
      ),
      { code: 'INVALID_PRIVATE_KEY' },
    );
    assert.deepEqual(env.github.apps(), []);
    const response = await env.github.register(
      {
        appId: fake.appId,
        host: fake.origin,
        privateKey: fake.privateKey,
        webhookSecret,
        commandId: 'register-0001',
      },
      local,
    );
    assert.equal(response.status, 201);
    const { app } = response.body as AppBody;
    assert.equal(app.privateKey, 'configured');
    assert.equal(app.webhookSecret, 'configured');
    assert.equal(app.webhookPath, `/api/v0/github/apps/${app.id}/webhook`);
    assert.deepEqual(
      app.installations[0]!.repositories.map((repo) => repo.id),
      [9001],
    );
    // The same command answers the same; a second registration of the App is a conflict.
    const again = await env.github.register(
      {
        appId: fake.appId,
        host: fake.origin,
        privateKey: fake.privateKey,
        webhookSecret,
        commandId: 'register-0001',
      },
      local,
    );
    assert.deepEqual(again.body, response.body);
    await assert.rejects(
      env.github.register(
        { appId: fake.appId, host: fake.origin, privateKey: fake.privateKey },
        local,
      ),
      { code: 'GITHUB_APP_EXISTS' },
    );
    // Secrets are sealed: not in responses, rows, receipts or events.
    const everything = JSON.stringify([
      response.body,
      env.store.db.prepare('SELECT * FROM github_apps').all(),
      env.store.db.prepare('SELECT * FROM command_receipts').all(),
      env.store.db.prepare('SELECT * FROM events').all(),
    ]);
    assert.ok(!everything.includes('PRIVATE KEY'));
    assert.ok(!everything.includes(fake.privateKey.split('\n')[1]!));
    assert.ok(!everything.includes(webhookSecret));
    assert.equal(env.github.webhookSecret(app.id), webhookSecret);
  } finally {
    await env.close();
    await fake.stop();
  }
});

test('projects bind repositories by ID through one shared App registration', async () => {
  const { env, fake, appRowId, close } = await connected();
  try {
    const connection = env.github.connection(env.projectId)!;
    assert.equal(connection.repository.id, 9001);
    assert.equal(connection.repository.owner, 'acme');
    assert.deepEqual(connection.diagnostics, []);
    // A second project uses the same App and webhook URL; no key is copied.
    const other = env.definitions.addProject({
      name: 'other',
      repositoryPath: join(env.state, 'other'),
      baseRef: 'main',
    } as never);
    const installationId = env.github.apps()[0]!.installations[0]!.id;
    await env.github.connect(other.id, { installationId, repositoryId: 9001 }, local);
    assert.equal(env.github.apps().length, 1);
    assert.deepEqual(env.store.db.prepare('SELECT COUNT(*) AS n FROM github_apps').get(), { n: 1 });
    // A repository the installation cannot reach is refused.
    await assert.rejects(
      env.github.connect(other.id, { installationId, repositoryId: 9002 }, local),
      { code: 'GITHUB_REPOSITORY_UNAVAILABLE' },
    );
    // A rename is followed by ID; names are display metadata.
    fake.repositories.get(9001)!.name = 'gadgets';
    assert.equal((await env.github.verify(env.projectId)).repository.name, 'gadgets');
    // Missing permissions show as diagnostics per node.
    fake.installations[0]!.permissions = { metadata: 'read', pull_requests: 'read' };
    await env.github.refresh(appRowId);
    const diagnostics = env.github.connection(env.projectId)!.diagnostics;
    assert.deepEqual(diagnostics.find((item) => item.node === 'github_create_pr')?.missing, {
      pull_requests: 'write',
    });
    assert.ok(!diagnostics.some((item) => item.node === 'github_get_pr'));
  } finally {
    await close();
  }
});

test('rotating the private key is verified first and replaces cached tokens', async () => {
  const { env, fake, appRowId, close } = await connected();
  try {
    const api = env.github.api;
    const binding = env.github.binding(env.projectId, env.github.current(env.projectId), {
      metadata: 'read',
    });
    const first = await api.token(binding.keys, binding.installationId, { repositoryIds: [9001] });
    // A wrong key is refused and the stored one kept.
    await assert.rejects(
      env.github.rotate(appRowId, { privateKey: FakeGitHub.keyPair().privateKey }, local),
      { code: 'GITHUB_AUTH_FAILED' },
    );
    // The owner generates a new key on GitHub; only it is accepted from now on.
    const next = FakeGitHub.keyPair();
    fake.useKey(next);
    await env.github.rotate(
      appRowId,
      { privateKey: next.privateKey, webhookSecret: 'whsec-rotated-0001' },
      local,
    );
    const after = env.github.binding(env.projectId, env.github.current(env.projectId), {
      metadata: 'read',
    });
    const second = await api.token(after.keys, after.installationId, { repositoryIds: [9001] });
    assert.notEqual(second.token, first.token, 'a token minted with the old key is not reused');
    assert.equal(env.github.webhookSecret(appRowId), 'whsec-rotated-0001');
    assert.equal(env.github.apps()[0]!.revision, 1);
  } finally {
    await close();
  }
});

test('installation tokens are scoped, cached and refreshed before they expire', async () => {
  const clock = new FakeClock();
  const fake = new FakeGitHub(clock);
  await fake.start();
  try {
    const api = new GitHubApi({ clock });
    const keys = {
      rowId: 'app',
      revision: 0,
      appId: fake.appId,
      host: fake.origin,
      privateKey: fake.privateKey,
    };
    const scope = { repositoryIds: [9001], permissions: { pull_requests: 'write' as const } };
    const [a, b] = await Promise.all([api.token(keys, 501, scope), api.token(keys, 501, scope)]);
    assert.equal(a.token, b.token, 'concurrent callers share one token');
    const minted = () => fake.requests.filter((item) => item.path.endsWith('/access_tokens'));
    assert.equal(minted().length, 1);
    assert.deepEqual(minted()[0]!.body, {
      repository_ids: [9001],
      permissions: { pull_requests: 'write' },
    });
    clock.advance(45 * 60 * 1000);
    assert.equal((await api.token(keys, 501, scope)).token, a.token, 'still fresh');
    clock.advance(10 * 60 * 1000);
    const refreshed = await api.token(keys, 501, scope);
    assert.notEqual(refreshed.token, a.token, 'replaced with under ten minutes left');
    assert.equal(minted().length, 2);
    // An expired token is refused by GitHub; asking for more than the installation grants fails.
    clock.advance(61 * 60 * 1000);
    await assert.rejects(
      api.asInstallation(
        keys,
        501,
        { repositoryIds: [9002] },
        'GET /repositories/{repository_id}',
        {
          repository_id: 9002,
        },
      ),
      { code: 'GITHUB_REJECTED' },
    );
  } finally {
    await fake.stop();
  }
});

test('runs that need GitHub fail to start without a verified connection with the permissions', async () => {
  const env = await setup();
  const fake = new FakeGitHub(env.clock);
  await fake.start();
  const create = actionWorkflow('github_create_pr', { head: 'work', title: 'Work' });
  const read = actionWorkflow('github_get_pr', { number: '1' });
  try {
    await assert.rejects(run(env, create), { code: 'GITHUB_NOT_CONNECTED' });
    fake.installations[0]!.permissions = { metadata: 'read', pull_requests: 'read' };
    await connected({ env, fake });
    // Reading needs only read access; creating needs write.
    await assert.rejects(run(env, create), { code: 'GITHUB_PERMISSION_MISSING' });
    fake.addPull(9001, { head: 'work', headSha: 'a'.repeat(40) });
    const done = await settled(env, await run(env, read));
    assert.equal(done.state, 'COMPLETED', JSON.stringify(done.outcome));
    // A workflow without GitHub nodes needs no connection.
    await env.github.disconnect(env.projectId, {}, local);
    const plain = await settled(env, await run(env, actionWorkflow('git_status', {})));
    assert.equal(plain.state, 'COMPLETED');
    // A connection removed after a run started fails its GitHub steps clearly.
  } finally {
    await env.close();
    await fake.stop();
  }
});

const prFlow = chain([
  [
    'create',
    'github_create_pr',
    { head: 'work', title: 'Add {{what}}', body: 'Adds {{what}}.' },
    {
      what: { kind: 'trigger', path: ['what'] },
    },
  ],
  ['read', 'github_get_pr', { head: 'work' }],
  [
    'update',
    'github_update_pr',
    { number: '{{number}}', title: 'Ready: {{title}}' },
    {
      number: { kind: 'node', nodeId: 'create', execution: 'latest', path: ['data', 'number'] },
      title: { kind: 'node', nodeId: 'read', execution: 'latest', path: ['data', 'title'] },
    },
  ],
]);

test('pull requests are created with a marker, read by branch and updated by number', async () => {
  const { env, fake, close } = await connected();
  try {
    const id = await run(env, prFlow, { what: 'widgets' });
    const done = await settled(env, id);
    assert.equal(done.state, 'COMPLETED', JSON.stringify(done.attention ?? done.outcome));
    const created = step(env, id, 'create');
    const pull = fake.pullsOf(9001)[0]!;
    assert.equal(fake.pullsOf(9001).length, 1);
    assert.equal(created.output!.data['number'], pull.number);
    assert.equal(created.output!.data['repositoryId'], 9001);
    assert.match(pull.body!, /^Adds widgets\.\n\n<!-- shift-operation: [0-9a-f-]{36} -->$/);
    assert.equal(step(env, id, 'read').output!.data['number'], pull.number);
    assert.equal(pull.title, 'Ready: Add widgets');
    assert.equal(step(env, id, 'update').output!.data['title'], 'Ready: Add widgets');
    // Every call used a token scoped to the bound repository, never the App JWT.
    const calls = fake.requests.filter((item) => item.path.includes('/pulls'));
    assert.ok(calls.every((item) => item.auth === 'token'));
  } finally {
    await close();
  }
});

test('a create interrupted after GitHub made it is recognized by its marker, not repeated', async () => {
  const { env, fake } = await connected();
  const id = await run(env, prFlow, { what: 'x' });
  await settled(env, id);
  const again = await interrupt(env, id, 'create', () => undefined);
  try {
    const done = await settled(again, id);
    assert.equal(done.state, 'COMPLETED');
    assert.equal(fake.pullsOf(9001).length, 1);
    assert.equal(step(again, id, 'create').operations.length, 1);
  } finally {
    await again.close();
    await fake.stop();
  }
});

test('a create interrupted before GitHub made it is sent again under the same marker', async () => {
  const { env, fake } = await connected();
  const id = await run(env, prFlow, { what: 'x' });
  await settled(env, id);
  const original = fake.pullsOf(9001)[0]!.body;
  const again = await interrupt(env, id, 'create', () => {
    fake.pulls.set(9001, []);
  });
  try {
    const done = await settled(again, id);
    assert.equal(done.state, 'COMPLETED');
    assert.equal(fake.pullsOf(9001).length, 1);
    assert.equal(fake.pullsOf(9001)[0]!.body, original, 'the same operation and marker');
    assert.equal(step(again, id, 'create').operations.length, 1);
  } finally {
    await again.close();
    await fake.stop();
  }
});

test('several pull requests with one marker need the owner to choose', async () => {
  const { env, fake } = await connected();
  const id = await run(env, prFlow, { what: 'x' });
  await settled(env, id);
  const again = await interrupt(env, id, 'create', (_workspace, _evidence, operationId) => {
    fake.addPull(9001, {
      head: 'work',
      headSha: 'c'.repeat(40),
      base: 'release',
      body: marker(operationId),
    });
  });
  try {
    const done = await settled(again, id);
    assert.equal(done.state, 'NEEDS_HUMAN');
    assert.equal(done.attention?.code, 'EFFECT_UNCERTAIN');
    assert.match(
      done.attention!.explanation,
      /2 pull requests carry this step's marker \(#1, #2\)/,
    );
  } finally {
    await again.close();
    await fake.stop();
  }
});

test('a lost response to a create is settled from GitHub, and a refused duplicate is an error', async () => {
  const { env, fake, close } = await connected();
  try {
    fake.dropAfter.push(/^POST \/repos\/acme\/widgets\/pulls$/);
    const id = await run(env, actionWorkflow('github_create_pr', { head: 'work', title: 'T' }));
    const done = await settled(env, id);
    assert.equal(done.state, 'COMPLETED', JSON.stringify(done.attention));
    assert.equal(fake.pullsOf(9001).length, 1);
    // Someone else's open pull request for the same branches: GitHub refuses, and that is final.
    const other = await settled(
      env,
      await run(env, actionWorkflow('github_create_pr', { head: 'work', title: 'Again' })),
    );
    assert.equal(other.state, 'FAILED');
    const error = step(env, other.id, 'act').error!;
    assert.equal(error.code, 'GITHUB_REJECTED');
    assert.match(error.message, /already exists/);
  } finally {
    await close();
  }
});

test('an interrupted update is recognized when it landed and sent again when it did not', async () => {
  const { env, fake } = await connected();
  const id = await run(env, prFlow, { what: 'x' });
  await settled(env, id);
  const landed = await interrupt(env, id, 'update', () => undefined);
  const patches = () => fake.requests.filter((item) => item.method === 'PATCH').length;
  let lost: Env | undefined;
  try {
    assert.equal((await settled(landed, id)).state, 'COMPLETED');
    assert.equal(patches(), 1, 'recognized from the pull request, not sent again');
    lost = await interrupt(landed, id, 'update', () => {
      fake.pullsOf(9001)[0]!.title = 'Add x';
    });
    assert.equal((await settled(lost, id)).state, 'COMPLETED');
    assert.equal(patches(), 2);
    assert.equal(fake.pullsOf(9001)[0]!.title, 'Ready: Add x');
  } finally {
    await (lost ?? landed).close();
    await fake.stop();
  }
});

test('provider refusals, revoked permissions and removed connections are structured errors', async () => {
  const { env, fake, close } = await connected();
  try {
    fake.fail.push({
      match: /^POST .*\/pulls$/,
      status: 403,
      message: 'Resource not accessible by integration',
    });
    const refused = await settled(
      env,
      await run(env, actionWorkflow('github_create_pr', { head: 'work', title: 'T' })),
    );
    const error = step(env, refused.id, 'act').error!;
    assert.equal(error.code, 'GITHUB_FORBIDDEN');
    assert.match(error.message, /Resource not accessible/);
    env.credentials.setPermissions(env.projectId, { deny: ['github'] }, local);
    const denied = await settled(
      env,
      await run(env, actionWorkflow('github_get_pr', { number: '1' })),
    );
    assert.equal(step(env, denied.id, 'act').error!.code, 'ACTION_NOT_PERMITTED');
    env.credentials.setPermissions(env.projectId, { allow: ['github'] }, local);
    // A step that starts after the connection was removed fails clearly.
    const waiting = await run(env, {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        { id: 'pause', type: 'wait', config: { durationMs: 60_000 } },
        { id: 'act', type: 'github_get_pr', config: { number: '1' } },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'pause', toPort: 'input' },
        { id: 'c2', fromNodeId: 'pause', fromPort: 'success', toNodeId: 'act', toPort: 'input' },
      ],
    } as Json);
    await env.github.disconnect(env.projectId, {}, local);
    env.clock.advance(61_000);
    env.engine.repository.fireDueWakeups();
    const removed = await settled(env, waiting);
    assert.equal(step(env, removed.id, 'act').error!.code, 'GITHUB_NOT_CONNECTED');
    // An HTTP node cannot reach the App's keys: they are not project credentials.
    const http = await settled(
      env,
      await run(
        env,
        actionWorkflow('http', {
          url: `${fake.origin}/api/v3/app`,
          credentialHeaders: { authorization: { credential: 'github', prefix: 'bearer ' } },
        }),
      ),
    );
    assert.equal(step(env, http.id, 'act').error!.code, 'CREDENTIAL_UNAVAILABLE');
  } finally {
    await close();
  }
});

test(
  'an App-backed push authenticates with a temporary helper and leaves no token behind',
  { skip },
  async () => {
    const env = await setup();
    const fake = new FakeGitHub(env.clock);
    await fake.start();
    const bare = join(env.state, 'github', 'acme', 'widgets.git');
    await mkdir(join(env.state, 'github', 'acme'), { recursive: true });
    execFileSync('git', ['clone', '-q', '--bare', env.repository, bare]);
    git(bare, 'config', 'http.receivepack', 'true');
    fake.repositories.get(9001)!.path = bare;
    git(env.repository, 'config', 'user.name', 'Shift Test');
    git(env.repository, 'config', 'user.email', 'shift@example.com');
    // An owner credential helper that would store whatever it is given.
    const stored = join(env.state, 'stored-credentials');
    git(env.repository, 'config', 'credential.helper', `store --file=${stored}`);
    const { close } = await connected({ env, fake });
    try {
      const id = await run(
        env,
        chain([
          ['edit', 'command', { mode: 'shell', script: 'echo more >> notes.txt' }],
          ['branch', 'git_create_branch', { name: 'work' }],
          ['commit', 'git_commit', { message: 'Work' }],
          ['push', 'git_push', { transport: 'github_app' }],
          ['create', 'github_create_pr', { head: 'work', title: 'Work' }],
        ]),
      );
      const done = await settled(env, id);
      assert.equal(done.state, 'COMPLETED', JSON.stringify(done.attention ?? done.outcome));
      const pushed = step(env, id, 'push').output!.data;
      assert.equal(git(bare, 'rev-parse', 'work'), pushed['commit']);
      assert.equal(pushed['url'], `${fake.origin}/acme/widgets.git`);
      assert.equal(fake.pullsOf(9001)[0]!.headSha, pushed['commit']);
      assert.ok(
        fake.requests.some(
          (item) => item.auth === 'basic' && item.path.endsWith('git-receive-pack'),
        ),
      );
      // No token anywhere Shift or Git keeps things.
      const tokens = [...fake.tokens.keys()];
      assert.ok(tokens.length > 0);
      const workspace = (
        env.engine.repository.run(id) as unknown as { workspace: { path: string } }
      ).workspace.path;
      const kept = [
        await readFile(join(env.repository, '.git', 'config'), 'utf8'),
        execFileSync('git', ['config', '--list', '--show-origin'], {
          cwd: workspace,
          encoding: 'utf8',
        }),
        JSON.stringify(env.store.db.prepare('SELECT * FROM effect_operations').all()),
        JSON.stringify(env.store.db.prepare('SELECT * FROM events').all()),
        JSON.stringify(env.store.db.prepare('SELECT snapshot_json FROM runs').all()),
        JSON.stringify(env.store.db.prepare('SELECT * FROM node_executions').all()),
      ].join('\n');
      for (const token of tokens) assert.ok(!kept.includes(token), 'token leaked');
      await assert.rejects(
        stat(stored),
        { code: 'ENOENT' },
        'the owner helper was never asked to store it',
      );
    } finally {
      await close();
    }
  },
);
