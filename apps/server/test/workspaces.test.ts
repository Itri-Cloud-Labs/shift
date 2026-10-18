import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { openStore } from '../src/persistence/store.js';
import { DefinitionRepository } from '../src/workflows/repository.js';
import { Workspaces } from '../src/workspaces/workspaces.js';
import { FakeClock, temporaryState } from './helpers.js';

async function fixture() {
  const state = await temporaryState();
  const repository = join(state.path, 'repo');
  await mkdir(repository);
  await writeFile(join(repository, 'notes.txt'), 'alpha\n');
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  git(repository, 'init', '-q', '-b', 'main');
  git(repository, 'add', '.');
  git(repository, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const store = await openStore({ stateDirectory: state.path, clock: new FakeClock() });
  const project = new DefinitionRepository(store.db, new FakeClock()).addProject({
    name: 'repo',
    repositoryPath: repository,
    baseRef: 'main',
  });
  const workspaces = new Workspaces(store.db, new FakeClock(), join(state.path, 'workspaces'));
  const commit = await workspaces.resolveBase(repository, 'main');
  let runs = 0;
  const allocate = (runState = 'RUNNING') => {
    const runId = `run-${++runs}`;
    store.db
      .prepare(
        "INSERT INTO runs (id, snapshot_json, state, revision, created_at) VALUES (?, '{}', ?, 0, 0)",
      )
      .run(runId, runState);
    return workspaces.allocate({
      runId,
      projectId: project.id,
      repositoryPath: repository,
      baseRef: 'main',
      baseCommit: commit,
    });
  };
  const finish = (runId: string) =>
    store.db.prepare("UPDATE runs SET state = 'COMPLETED' WHERE id = ?").run(runId);
  const registered = () =>
    git(repository, 'worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length));
  return {
    workspaces,
    repository,
    commit,
    git,
    allocate,
    finish,
    registered,
    async close() {
      store.close();
      await state.remove();
    },
  };
}

test('allocation is idempotent per run and creation is shared', async () => {
  const env = await fixture();
  try {
    const workspace = env.allocate();
    assert.equal(workspace.state, 'CREATING');
    assert.equal(
      env.workspaces.allocate({
        runId: workspace.runId,
        projectId: workspace.projectId,
        repositoryPath: env.repository,
        baseRef: 'main',
        baseCommit: env.commit,
      }).id,
      workspace.id,
    );
    const [a, b] = await Promise.all([
      env.workspaces.ensureReady(workspace.id),
      env.workspaces.ensureReady(workspace.id),
    ]);
    assert.equal(a.state, 'READY');
    assert.equal(b.id, a.id);
    assert.equal(env.git(workspace.path, 'rev-parse', 'HEAD'), env.commit);
    assert.ok(env.registered().includes(workspace.path));
    assert.equal((await env.workspaces.ensureReady(workspace.id)).readyAt, a.readyAt);
  } finally {
    await env.close();
  }
});

test('whatever a crash left during creation is discarded and the worktree recreated', async () => {
  const env = await fixture();
  try {
    // A partly written directory that Git never registered.
    const partial = env.allocate();
    await mkdir(partial.path, { recursive: true });
    await writeFile(join(partial.path, 'junk.txt'), 'junk');
    // A finished `git worktree add` whose READY transition never committed, with a stray edit.
    const added = env.allocate();
    env.git(env.repository, 'worktree', 'add', '--detach', added.path, env.commit);
    await writeFile(join(added.path, 'notes.txt'), 'stray');
    for (const workspace of [partial, added]) {
      const ready = await env.workspaces.ensureReady(workspace.id);
      assert.equal(ready.state, 'READY');
      assert.equal(existsSync(join(workspace.path, 'junk.txt')), false);
      assert.equal(env.git(workspace.path, 'status', '--porcelain'), '');
    }
    assert.equal(env.registered().filter((path) => path.includes('workspaces')).length, 2);
  } finally {
    await env.close();
  }
});

test('a ready workspace deleted outside Shift is reported, not silently recreated', async () => {
  const env = await fixture();
  try {
    const workspace = await env.workspaces.ensureReady(env.allocate().id);
    await rm(workspace.path, { recursive: true, force: true });
    await assert.rejects(env.workspaces.ensureReady(workspace.id), {
      code: 'WORKSPACE_UNAVAILABLE',
    });
  } finally {
    await env.close();
  }
});

test('removal refuses an owned or dirty workspace and is idempotent', async () => {
  const env = await fixture();
  try {
    const workspace = await env.workspaces.ensureReady(env.allocate('NEEDS_HUMAN').id);
    await assert.rejects(env.workspaces.remove(workspace.id), { code: 'WORKSPACE_IN_USE' });
    env.finish(workspace.runId);
    await writeFile(join(workspace.path, 'result.txt'), 'agent work');
    await assert.rejects(env.workspaces.remove(workspace.id), { code: 'WORKSPACE_DIRTY' });
    assert.ok(existsSync(join(workspace.path, 'result.txt')), 'refused removal keeps the work');
    const removed = await env.workspaces.remove(workspace.id, { force: true });
    assert.equal(removed.state, 'RETIRED');
    assert.equal(existsSync(workspace.path), false);
    assert.equal(env.registered().includes(workspace.path), false);
    assert.deepEqual(await env.workspaces.remove(workspace.id), removed);
    await assert.rejects(env.workspaces.ensureReady(workspace.id), {
      code: 'WORKSPACE_UNAVAILABLE',
    });
    // The project checkout and its branch are untouched throughout.
    assert.equal(env.git(env.repository, 'status', '--porcelain'), '');
    assert.equal(env.git(env.repository, 'symbolic-ref', '--short', 'HEAD'), 'main');
  } finally {
    await env.close();
  }
});

test('base refs resolve to commits and unknown refs are refused', async () => {
  const env = await fixture();
  try {
    assert.match(env.commit, /^[0-9a-f]{40}$/);
    await assert.rejects(env.workspaces.resolveBase(env.repository, 'nope'), {
      code: 'INVALID_BASE_REF',
    });
    await assert.rejects(env.workspaces.resolveBase(env.repository, '--output=/tmp/x'), {
      code: 'INVALID_BASE_REF',
    });
  } finally {
    await env.close();
  }
});
