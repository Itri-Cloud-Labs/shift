import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { Json } from '../src/harness/types.js';
import { openStore } from '../src/persistence/store.js';
import { local, run, settled, setup, skip, view, type Env } from './action-helpers.js';
import { FakeClock } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// The project repository gets an identity and a bare `origin` beside it.
async function gitSetup(): Promise<Env & { remote: string }> {
  const env = await setup();
  const remote = join(env.state, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git(env.repository, 'config', 'user.name', 'Shift Test');
  git(env.repository, 'config', 'user.email', 'shift@example.com');
  git(env.repository, 'remote', 'add', 'origin', remote);
  git(env.repository, 'push', '-q', 'origin', 'main');
  return Object.assign(env, { remote });
}

// start -> each step in order -> end. Steps are [id, type, config, bindings?].
function chain(steps: Array<[string, string, Json, Record<string, Json>?]>): Json {
  const ids = ['start', ...steps.map(([id]) => id), 'end'];
  return {
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      ...steps.map(([id, type, config, bindings]) => ({
        id,
        type,
        config,
        ...(bindings ? { bindings } : {}),
      })),
      { id: 'end', type: 'end' },
    ],
    connections: ids.slice(1).map((to, index) => ({
      id: `c${index}`,
      fromNodeId: ids[index]!,
      fromPort: 'success',
      toNodeId: to,
      toPort: 'input',
    })),
  } as Json;
}

const edit: [string, string, Json] = [
  'edit',
  'command',
  {
    mode: 'shell',
    script: 'echo "gamma" >> notes.txt && mkdir -p docs && echo "new" > docs/added.md',
  },
];

type Step = {
  node: string;
  state: string;
  output: { data: Record<string, Json> } | null;
  error: { code: string; message: string } | null;
  operations: Array<{ state: string; evidence: Record<string, Json>; resolution: Json }>;
};
const step = (env: Env, id: string, node: string) =>
  (view(env, id).executions as unknown as Step[]).filter((entry) => entry.node === node).at(-1)!;

test(
  'edits become a named branch, a commit and a push without touching the source checkout',
  { skip },
  async () => {
    const env = await gitSetup();
    try {
      const sourceHead = git(env.repository, 'rev-parse', 'HEAD');
      const id = await run(
        env,
        chain([
          edit,
          ['status', 'git_status', {}],
          ['diff', 'git_diff', {}],
          [
            'branch',
            'git_create_branch',
            { name: 'shift/{{topic}}' },
            { topic: { kind: 'trigger', path: ['topic'] } },
          ],
          [
            'commit',
            'git_commit',
            { message: '{{title}}\n\nMade by Shift.' },
            { title: { kind: 'trigger', path: ['title'] } },
          ],
          ['push', 'git_push', {}],
        ]),
        { topic: 'gamma', title: 'Add gamma' },
      );
      const done = await settled(env, id);
      assert.equal(
        done.state,
        'COMPLETED',
        JSON.stringify(done.executions.map((e) => [e.node, e.error])),
      );

      const status = step(env, id, 'status').output!.data;
      assert.equal(status['branch'], null, 'the worktree starts detached');
      assert.equal(status['head'], sourceHead);
      assert.deepEqual(
        (status['entries'] as Array<{ path: string; worktree: string; index: string }>).map(
          (entry) => [entry.path, entry.index, entry.worktree],
        ),
        [
          ['notes.txt', ' ', 'M'],
          ['docs/added.md', '?', '?'],
        ],
      );
      const diff = step(env, id, 'diff').output!.data;
      assert.match(diff['diff'] as string, /\+gamma/);
      assert.deepEqual(diff['files'], [{ path: 'notes.txt', additions: 1, deletions: 0 }]);
      assert.deepEqual(diff['untracked'], ['docs/added.md']);

      assert.deepEqual(step(env, id, 'branch').output!.data, {
        branch: 'shift/gamma',
        commit: sourceHead,
      });
      const commit = step(env, id, 'commit').output!.data;
      assert.equal(commit['parent'], sourceHead);
      assert.equal(commit['branch'], 'shift/gamma');
      assert.equal(commit['message'], 'Add gamma\n\nMade by Shift.');
      const push = step(env, id, 'push').output!.data;
      assert.equal(push['commit'], commit['commit']);
      assert.equal(push['remoteRef'], 'refs/heads/shift/gamma');
      assert.equal(push['before'], null);
      assert.equal(git(env.remote, 'rev-parse', 'refs/heads/shift/gamma'), commit['commit']);
      assert.equal(
        git(env.remote, 'show', '--format=%s', '--name-only', 'shift/gamma'),
        'Add gamma\n\ndocs/added.md\nnotes.txt',
      );

      // The project's own checkout is where it was, with no changes.
      assert.equal(git(env.repository, 'rev-parse', 'HEAD'), sourceHead);
      assert.equal(git(env.repository, 'symbolic-ref', '--short', 'HEAD'), 'main');
      assert.equal(git(env.repository, 'status', '--porcelain'), '');
      assert.equal(await readFile(join(env.repository, 'notes.txt'), 'utf8'), 'alpha beta\n');

      // Recorded evidence stays what it was when later state changes.
      git(env.remote, 'update-ref', 'refs/heads/shift/gamma', sourceHead);
      assert.equal(step(env, id, 'push').output!.data['commit'], commit['commit']);
    } finally {
      await env.close();
    }
  },
);

test(
  'invalid names, collisions, empty commits and unsafe remotes fail clearly',
  { skip },
  async () => {
    const env = await gitSetup();
    try {
      const failure = async (
        steps: Array<[string, string, Json, Record<string, Json>?]>,
        node: string,
        input: Json = {},
      ) => {
        const id = await run(env, chain(steps), input);
        await settled(env, id);
        return step(env, id, node).error!;
      };
      for (const name of ['--force', 'a..b', 'has space', 'end.lock', '@{-1}'])
        assert.equal(
          (
            await failure(
              [
                [
                  'branch',
                  'git_create_branch',
                  { name: '{{n}}' },
                  { n: { kind: 'trigger', path: ['n'] } },
                ],
              ],
              'branch',
              { n: name },
            )
          ).code,
          'INVALID_BRANCH',
          name,
        );
      git(env.repository, 'branch', 'taken');
      assert.equal(
        (await failure([['branch', 'git_create_branch', { name: 'taken' }]], 'branch')).code,
        'BRANCH_EXISTS',
      );
      assert.equal(
        (await failure([['commit', 'git_commit', { message: 'nothing' }]], 'commit')).code,
        'NOTHING_TO_COMMIT',
      );
      assert.equal((await failure([['push', 'git_push', {}]], 'push')).code, 'DETACHED_HEAD');
      assert.equal(
        (
          await failure(
            [
              edit,
              ['branch', 'git_create_branch', { name: 'x' }],
              ['push', 'git_push', { remote: 'nowhere' }],
            ],
            'push',
          )
        ).code,
        'REMOTE_NOT_FOUND',
      );
      git(
        env.repository,
        'remote',
        'add',
        'leaky',
        'https://user:token123@example.invalid/repo.git',
      );
      const leaky = await failure(
        [
          edit,
          ['branch', 'git_create_branch', { name: 'y' }],
          ['push', 'git_push', { remote: 'leaky' }],
        ],
        'push',
      );
      assert.equal(leaky.code, 'REMOTE_URL_HAS_CREDENTIALS');
      assert.equal(leaky.message.includes('token123'), false);
      // The remote has a commit the branch lacks: the push is refused, not forced.
      const other = join(env.state, 'other');
      execFileSync('git', ['clone', '-q', env.remote, other]);
      git(
        other,
        '-c',
        'user.name=o',
        '-c',
        'user.email=o@o',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        'theirs',
      );
      git(other, 'push', '-q', 'origin', 'HEAD:refs/heads/race');
      const rejected = await failure(
        [
          edit,
          ['branch', 'git_create_branch', { name: 'race' }],
          ['commit', 'git_commit', { message: 'ours' }],
          ['push', 'git_push', {}],
        ],
        'push',
      );
      assert.equal(rejected.code, 'GIT_PUSH_REJECTED');
      // A denied push stops before anything is recorded.
      env.credentials.setPermissions(env.projectId, { deny: ['git_push'] }, local);
      const denied = await failure(
        [edit, ['branch', 'git_create_branch', { name: 'z' }], ['push', 'git_push', {}]],
        'push',
      );
      assert.equal(denied.code, 'ACTION_NOT_PERMITTED');
    } finally {
      await env.close();
    }
  },
);

// Rolls a finished run back to the moment its `node` step had submitted its operation and Shift
// died, then lets `change` alter the repository as the crash left it.
async function interrupt(
  env: Env,
  id: string,
  node: string,
  change: (workspace: string, evidence: Record<string, Json>) => void,
): Promise<Env> {
  const evidence = step(env, id, node).operations[0]!.evidence;
  const workspace = (view(env, id) as unknown as { workspace: { path: string } }).workspace.path;
  await env.close();
  const store = await openStore({ stateDirectory: env.state, clock: new FakeClock() });
  const db = store.db;
  db.pragma('foreign_keys = OFF');
  const execution = db
    .prepare('SELECT id, sequence FROM node_executions WHERE run_id = ? AND node_id = ?')
    .get(id, node) as { id: string; sequence: number };
  db.prepare('DELETE FROM node_executions WHERE run_id = ? AND sequence > ?').run(
    id,
    execution.sequence,
  );
  db.prepare(
    "UPDATE node_executions SET state = 'RUNNING', output_json = NULL, selected_port = NULL, finished_at = NULL WHERE id = ?",
  ).run(execution.id);
  db.prepare(
    "UPDATE node_attempts SET state = 'RUNNING', finished_at = NULL, worker_generation = 'dead' WHERE execution_id = ?",
  ).run(execution.id);
  db.prepare(
    "UPDATE effect_operations SET state = 'SUBMITTED', result_json = NULL WHERE execution_id = ?",
  ).run(execution.id);
  db.prepare(
    "UPDATE runs SET state = 'RUNNING', outcome_json = NULL, finished_at = NULL WHERE id = ?",
  ).run(id);
  store.close();
  change(workspace, evidence);
  return setup(env.state);
}

const commitFlow = chain([
  edit,
  ['branch', 'git_create_branch', { name: 'work' }],
  ['commit', 'git_commit', { message: 'Work' }],
  ['push', 'git_push', {}],
]);

test('a commit interrupted after it landed is recognized, not made twice', { skip }, async () => {
  const env = await gitSetup();
  const id = await run(env, commitFlow);
  await settled(env, id);
  const again = await interrupt(env, id, 'commit', () => undefined);
  try {
    const done = await settled(again, id);
    assert.equal(done.state, 'COMPLETED');
    assert.equal(
      git(env.remote, 'rev-list', '--count', 'work'),
      '2',
      'one commit on top of the base',
    );
    assert.equal(step(again, id, 'commit').operations.length, 1);
  } finally {
    await again.close();
  }
});

test(
  'a commit interrupted before it landed is made once from the recorded tree',
  { skip },
  async () => {
    const env = await gitSetup();
    const id = await run(env, commitFlow);
    await settled(env, id);
    let expected = '';
    const again = await interrupt(env, id, 'commit', (workspace, evidence) => {
      expected = evidence['commit'] as string;
      // As if the crash came before the branch moved: HEAD is the parent, the changes uncommitted.
      git(workspace, 'reset', '-q', '--soft', evidence['parent'] as string);
    });
    try {
      const done = await settled(again, id);
      assert.equal(done.state, 'COMPLETED');
      const commit = step(again, id, 'commit').output!.data;
      assert.equal(commit['commit'], expected, 'the same commit as recorded');
      assert.equal(git(env.remote, 'rev-parse', 'work'), expected);
    } finally {
      await again.close();
    }
  },
);

test('a workspace changed outside the step needs the owner after a crash', { skip }, async () => {
  const env = await gitSetup();
  const id = await run(env, commitFlow);
  await settled(env, id);
  const again = await interrupt(env, id, 'commit', (workspace) => {
    git(
      workspace,
      '-c',
      'user.name=m',
      '-c',
      'user.email=m@m',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'manual',
    );
  });
  try {
    const stuck = await settled(again, id);
    assert.equal(stuck.state, 'NEEDS_HUMAN');
    assert.equal(stuck.attention!.code, 'EFFECT_UNCERTAIN');
    assert.match(stuck.attention!.explanation, /neither the recorded parent/);
  } finally {
    await again.close();
  }
});

test(
  'a push interrupted before or after it landed is settled from the remote',
  { skip },
  async () => {
    for (const landed of [true, false]) {
      const env = await gitSetup();
      const id = await run(env, commitFlow);
      await settled(env, id);
      const pushed = step(env, id, 'push').output!.data['commit'] as string;
      const again = await interrupt(env, id, 'push', () => {
        if (!landed) git(env.remote, 'update-ref', '-d', 'refs/heads/work');
      });
      try {
        const done = await settled(again, id);
        assert.equal(done.state, 'COMPLETED', `landed=${landed}`);
        assert.equal(git(env.remote, 'rev-parse', 'work'), pushed);
        assert.equal(step(again, id, 'push').operations.length, 1, 'the same operation finished');
      } finally {
        await again.close();
      }
    }
  },
);

test('a remote moved by someone else during a crash needs the owner', { skip }, async () => {
  const env = await gitSetup();
  const id = await run(env, commitFlow);
  await settled(env, id);
  const again = await interrupt(env, id, 'push', () => {
    git(env.remote, 'update-ref', 'refs/heads/work', git(env.remote, 'rev-parse', 'main'));
  });
  try {
    const stuck = await settled(again, id);
    assert.equal(stuck.state, 'NEEDS_HUMAN');
    assert.equal(stuck.attention!.code, 'EFFECT_UNCERTAIN');
  } finally {
    await again.close();
  }
});

test('a push goes to the remote’s push URL and is checked there', { skip }, async () => {
  const env = await gitSetup();
  try {
    const mirror = join(env.state, 'push-target.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', mirror]);
    git(env.repository, 'remote', 'set-url', '--push', 'origin', mirror);
    const id = await run(env, commitFlow);
    const done = await settled(env, id);
    assert.equal(done.state, 'COMPLETED', JSON.stringify(step(env, id, 'push').error));
    const pushed = step(env, id, 'push').output!.data;
    assert.equal(pushed['url'], mirror);
    assert.equal(git(mirror, 'rev-parse', 'work'), pushed['commit']);
    // A second push URL, or one with a token, is refused before anything is sent.
    git(
      env.repository,
      'remote',
      'set-url',
      '--push',
      '--add',
      'origin',
      join(env.state, 'other.git'),
    );
    const flow = chain([
      edit,
      ['branch', 'git_create_branch', { name: 'two' }],
      ['push', 'git_push', {}],
    ]);
    const two = await run(env, flow);
    await settled(env, two);
    assert.equal(step(env, two, 'push').error!.code, 'MULTIPLE_PUSH_URLS');
    git(env.repository, 'config', '--unset-all', 'remote.origin.pushurl');
    git(
      env.repository,
      'remote',
      'set-url',
      '--push',
      'origin',
      'https://bot:secret-token@example.invalid/r.git',
    );
    const leaky = await run(
      env,
      chain([edit, ['branch', 'git_create_branch', { name: 'three' }], ['push', 'git_push', {}]]),
    );
    await settled(env, leaky);
    assert.equal(step(env, leaky, 'push').error!.code, 'REMOTE_URL_HAS_CREDENTIALS');
    assert.equal(step(env, leaky, 'push').error!.message.includes('secret-token'), false);
  } finally {
    await env.close();
  }
});

test(
  'the commit’s branch switched during a crash needs the owner, even at the same commit',
  { skip },
  async () => {
    const env = await gitSetup();
    const id = await run(env, commitFlow);
    await settled(env, id);
    const again = await interrupt(env, id, 'commit', (workspace) => {
      git(workspace, 'switch', '-q', '-c', 'elsewhere');
    });
    try {
      const stuck = await settled(again, id);
      assert.equal(stuck.state, 'NEEDS_HUMAN');
      assert.equal(stuck.attention!.code, 'EFFECT_UNCERTAIN');
      assert.match(stuck.attention!.explanation, /on elsewhere, not work/);
    } finally {
      await again.close();
    }
  },
);
