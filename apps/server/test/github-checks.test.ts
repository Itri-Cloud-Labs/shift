import assert from 'node:assert/strict';
import test from 'node:test';
import type { Json } from '../src/harness/types.js';
import {
  actionWorkflow,
  interrupt,
  local,
  run,
  settled,
  setup,
  step,
  view,
  type Env,
} from './action-helpers.js';
import { connected } from './github-helpers.js';
import { eventually } from './helpers.js';

const sha = 'a'.repeat(40);
const minute = 60_000;

// The engine fires due wake-ups on its two-second pump; the test clock decides what is due.
async function waiting(env: Env, id: string, ordinal: number) {
  return eventually(() => {
    const current = view(env, id) as unknown as {
      state: string;
      wait: { kind: string; ordinal: number; dueAt: number; state: string } | null;
    };
    return current.state === 'WAITING' &&
      current.wait?.kind === 'poll' &&
      current.wait.ordinal >= ordinal
      ? current.wait
      : undefined;
  }, 20_000);
}

const observations = (env: Env, id: string) =>
  env.store.db
    .prepare(
      'SELECT ordinal, summary_json FROM check_observations WHERE run_id = ? ORDER BY ordinal',
    )
    .all(id) as Array<{ ordinal: number; summary_json: string }>;

const checkReads = (fake: { requests: Array<{ path: string }> }) =>
  fake.requests.filter((item) => item.path.endsWith('/check-runs')).length;

// trigger(commit) -> wait -> end, with every port of the wait ending somewhere.
function waitFlow(config: Record<string, Json> = {}): Json {
  return {
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      {
        id: 'act',
        type: 'github_wait_checks',
        config: { commit: '{{commit}}', intervalMs: minute, timeoutMs: 10 * minute, ...config },
        bindings: { commit: { kind: 'trigger', path: ['commit'] } },
      },
      { id: 'passed', type: 'end', config: { outcome: 'COMPLETED', reason: 'passed' } },
      { id: 'failed', type: 'end', config: { outcome: 'FAILED', reason: 'checks failed' } },
      { id: 'late', type: 'end', config: { outcome: 'FAILED', reason: 'timed out' } },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'act', toPort: 'input' },
      { id: 'c2', fromNodeId: 'act', fromPort: 'success', toNodeId: 'passed', toPort: 'input' },
      { id: 'c3', fromNodeId: 'act', fromPort: 'failure', toNodeId: 'failed', toPort: 'input' },
      { id: 'c4', fromNodeId: 'act', fromPort: 'timeout', toNodeId: 'late', toPort: 'input' },
    ],
  } as Json;
}

test('verify reads check runs and statuses of one commit, and the graph routes on them', async () => {
  const { env, fake, close } = await connected();
  try {
    fake.addPull(9001, { head: 'work', headSha: sha });
    fake.checkRuns.push(
      { id: 1, name: 'build', head_sha: sha, status: 'completed', conclusion: 'success' },
      { id: 2, name: 'lint', head_sha: sha, status: 'completed', conclusion: 'skipped' },
    );
    fake.statuses.push({ context: 'deploy/preview', state: 'pending', sha });
    const document = {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        { id: 'verify', type: 'github_verify_checks', config: { commit: sha } },
        {
          id: 'green',
          type: 'condition',
          config: { when: { op: 'eq', left: { binding: 'state' }, right: { value: 'success' } } },
          bindings: { state: { kind: 'input', path: ['data', 'state'] } },
        },
        { id: 'merge', type: 'github_merge', config: { number: '1' } },
        { id: 'hold', type: 'end', config: { outcome: 'COMPLETED', reason: 'not green' } },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'verify', toPort: 'input' },
        { id: 'c2', fromNodeId: 'verify', fromPort: 'success', toNodeId: 'green', toPort: 'input' },
        { id: 'c3', fromNodeId: 'green', fromPort: 'true', toNodeId: 'merge', toPort: 'input' },
        { id: 'c4', fromNodeId: 'green', fromPort: 'false', toNodeId: 'hold', toPort: 'input' },
      ],
    } as Json;
    const pending = await settled(env, await run(env, document));
    assert.equal(pending.state, 'COMPLETED', JSON.stringify(pending.outcome));
    const data = step(env, pending.id, 'verify').output!.data;
    assert.equal(data['state'], 'pending');
    assert.deepEqual(data['counts'], { success: 2, failure: 0, pending: 1 });
    assert.deepEqual(
      (data['checks'] as Array<{ name: string; source: string }>).map((item) => [
        item.name,
        item.source,
      ]),
      [
        ['build', 'check_run'],
        ['deploy/preview', 'status'],
        ['lint', 'check_run'],
      ],
    );
    assert.equal(step(env, pending.id, 'merge'), undefined, 'the graph held the merge');
    assert.equal(fake.pullsOf(9001)[0]!.merged, false);
    // The same graph merges once the author's condition holds.
    fake.statuses.push({ context: 'deploy/preview', state: 'success', sha });
    fake.statuses.splice(0, 1);
    const green = await settled(env, await run(env, document));
    assert.equal(step(env, green.id, 'verify').output!.data['state'], 'success');
    assert.equal(step(env, green.id, 'merge').output!.data['merged'], true);
    // Required names: one nothing reported keeps it pending.
    const required = await settled(
      env,
      await run(
        env,
        actionWorkflow('github_verify_checks', { commit: sha, checks: ['build', 'e2e'] }),
      ),
    );
    const named = step(env, required.id, 'act').output!.data;
    assert.equal(named['state'], 'pending');
    assert.deepEqual(named['missing'], ['e2e']);
    // A check run and a status with one name both count: a pass cannot hide a failure.
    const shared = 'd'.repeat(40);
    fake.checkRuns.push({
      id: 50,
      name: 'build',
      head_sha: shared,
      status: 'completed',
      conclusion: 'success',
    });
    fake.statuses.push({ context: 'build', state: 'failure', sha: shared });
    const collided = await settled(
      env,
      await run(env, actionWorkflow('github_verify_checks', { commit: shared, checks: ['build'] })),
    );
    const both = step(env, collided.id, 'act').output!.data;
    assert.equal(both['state'], 'failure');
    assert.deepEqual(both['counts'], { success: 1, failure: 1, pending: 0 });
    // More check runs than Shift reads is an error, never a partial summary.
    const crowded = 'c'.repeat(40);
    for (let index = 0; index < 1001; index++)
      fake.checkRuns.push({
        id: 100 + index,
        name: `job-${index}`,
        head_sha: crowded,
        status: 'completed',
        conclusion: 'success',
      });
    const tooMany = await settled(
      env,
      await run(env, actionWorkflow('github_verify_checks', { commit: crowded })),
    );
    assert.equal(step(env, tooMany.id, 'act').error!.code, 'GITHUB_TOO_MANY_RESULTS');
    // A branch name is not an explicit commit.
    const branch = await settled(
      env,
      await run(env, actionWorkflow('github_verify_checks', { commit: 'main' })),
    );
    assert.equal(step(env, branch.id, 'act').error!.code, 'INVALID_COMMIT');
  } finally {
    await close();
  }
});

test('a wait reads afresh each poll, survives a restart and ends when the checks complete', async () => {
  const { env, fake } = await connected();
  fake.checkRuns.push({
    id: 1,
    name: 'build',
    head_sha: sha,
    status: 'in_progress',
    conclusion: null,
  });
  const id = await run(env, waitFlow(), { commit: sha });
  const first = await waiting(env, id, 1);
  assert.equal(first.state, 'pending');
  assert.equal(checkReads(fake), 1);
  env.clock.advance(minute);
  await waiting(env, id, 2);
  assert.equal(checkReads(fake), 2, 'a second, fresh read');
  // The server stops while waiting; the next poll continues the count after the restart.
  await env.close();
  const again = await setup(env.state);
  try {
    again.clock.advance(5 * minute);
    await waiting(again, id, 3);
    fake.checkRuns[0] = { ...fake.checkRuns[0]!, status: 'completed', conclusion: 'success' };
    again.clock.advance(minute);
    const done = await settled(again, id);
    assert.equal(done.state, 'COMPLETED');
    assert.equal((done.outcome as { reason?: string }).reason, 'passed');
    const data = step(again, id, 'act').output!.data;
    assert.equal(data['state'], 'success');
    assert.equal(data['polls'], 4);
    assert.deepEqual(
      observations(again, id).map((row) => [
        row.ordinal,
        (JSON.parse(row.summary_json) as { state: string }).state,
      ]),
      [
        [1, 'pending'],
        [2, 'pending'],
        [3, 'pending'],
        [4, 'success'],
      ],
    );
    assert.equal(checkReads(fake), 4, 'one read per observation');
  } finally {
    await again.close();
    await fake.stop();
  }
});

test('a failing check takes the failure port and the deadline the timeout port', async () => {
  const { env, fake, close } = await connected();
  try {
    fake.checkRuns.push({
      id: 1,
      name: 'build',
      head_sha: sha,
      status: 'completed',
      conclusion: 'failure',
    });
    const failed = await settled(env, await run(env, waitFlow(), { commit: sha }));
    assert.equal((failed.outcome as { reason?: string }).reason, 'checks failed');
    const other = 'b'.repeat(40);
    fake.statuses.push({ context: 'ci', state: 'pending', sha: other });
    const id = await run(env, waitFlow({ timeoutMs: 2 * minute }), { commit: other });
    await waiting(env, id, 1);
    env.clock.advance(minute);
    await waiting(env, id, 2);
    env.clock.advance(minute);
    const late = await settled(env, id);
    assert.equal((late.outcome as { reason?: string }).reason, 'timed out');
    assert.equal(step(env, id, 'act').output!.data['polls'], 3);
    // No checks at all keeps waiting rather than passing.
    const none = await run(env, waitFlow(), { commit: 'c'.repeat(40) });
    assert.equal((await waiting(env, none, 1)).state, 'none');
  } finally {
    await close();
  }
});

test('cancel and duplicate wake-ups leave one known result', async () => {
  const { env, fake, close } = await connected();
  try {
    fake.checkRuns.push({
      id: 1,
      name: 'build',
      head_sha: sha,
      status: 'queued',
      conclusion: null,
    });
    const id = await run(env, waitFlow(), { commit: sha });
    await waiting(env, id, 1);
    // A verified event moves the next read to now; firing twice resumes the step once.
    assert.equal(env.engine.repository.expeditePolls(sha), 1);
    const once = env.engine.repository.fireDueWakeups('test');
    const twice = env.engine.repository.fireDueWakeups('test');
    assert.equal(once.length + twice.length, 1);
    assert.equal(twice.length, 0);
    // The resumed claim is a stale duplicate for the engine's own next poll: let the engine take it.
    await env.close();
    const again = await setup(env.state);
    try {
      await waiting(again, id, 2);
      await again.engine.controlRun(id, 'cancel', {}, local);
      const cancelled = await settled(again, id);
      assert.equal(cancelled.state, 'CANCELLED');
      again.clock.advance(10 * minute);
      assert.deepEqual(again.engine.repository.fireDueWakeups('test'), []);
      assert.equal(view(again, id).state, 'CANCELLED');
      assert.equal(observations(again, id).length, 2);
    } finally {
      await again.close();
    }
  } finally {
    await close().catch(() => undefined);
    await fake.stop();
  }
});

test('a reached merge is made immediately, with no hidden checks, and refusals are errors', async () => {
  const { env, fake, close } = await connected();
  try {
    fake.addPull(9001, { head: 'work', headSha: sha });
    fake.checkRuns.push({
      id: 1,
      name: 'build',
      head_sha: sha,
      status: 'completed',
      conclusion: 'failure',
    });
    const before = fake.requests.length;
    const done = await settled(
      env,
      await run(env, actionWorkflow('github_merge', { number: '1', method: 'squash' })),
    );
    assert.equal(done.state, 'COMPLETED', JSON.stringify(done.outcome));
    const calls = fake.requests.slice(before).map((item) => item.path);
    assert.ok(!calls.some((path) => /check-runs|status|reviews/.test(path)), calls.join(', '));
    assert.equal(calls.filter((path) => path.startsWith('PUT')).length, 1);
    const merged = step(env, done.id, 'act').output!.data;
    assert.equal(merged['method'], 'squash');
    assert.equal(merged['mergeCommitSha'], fake.pullsOf(9001)[0]!.merge_commit_sha);
    assert.equal(
      fake.requests.find((item) => item.path.startsWith('PUT'))!.body!['merge_method' as never],
      'squash',
    );
    // A branch protection refusal is the step's structured error; nothing retries or bypasses it.
    const protectedPull = fake.addPull(9001, { head: 'other', headSha: 'd'.repeat(40) });
    fake.mergeRule = () => ({ status: 405, message: 'Required status check "build" is failing.' });
    const refused = await settled(
      env,
      await run(env, actionWorkflow('github_merge', { number: String(protectedPull.number) })),
    );
    const error = step(env, refused.id, 'act').error!;
    assert.equal(error.code, 'GITHUB_NOT_ALLOWED');
    assert.match(error.message, /Required status check "build" is failing/);
    assert.equal(fake.requests.filter((item) => item.path.startsWith('PUT')).length, 2);
    assert.equal(protectedPull.merged, false);
    fake.mergeRule = null;
    // An explicitly expected commit that is not the head is refused by GitHub.
    const moved = await settled(
      env,
      await run(
        env,
        actionWorkflow('github_merge', {
          number: String(protectedPull.number),
          expectedCommit: 'e'.repeat(40),
        }),
      ),
    );
    assert.equal(step(env, moved.id, 'act').error!.code, 'GITHUB_CONFLICT');
  } finally {
    await close();
  }
});

test('a merge interrupted after submission is settled from the pull request', async () => {
  const { env, fake } = await connected();
  const pull = fake.addPull(9001, { head: 'work', headSha: sha });
  const id = await run(env, actionWorkflow('github_merge', { number: '1' }));
  await settled(env, id);
  const puts = () => fake.requests.filter((item) => item.path.startsWith('PUT')).length;
  // It landed: recognized, not sent again.
  const landed = await interrupt(env, id, 'act', () => undefined);
  let current = landed;
  try {
    assert.equal((await settled(landed, id)).state, 'COMPLETED');
    assert.equal(puts(), 1);
    // It never landed: sent again once.
    current = await interrupt(landed, id, 'act', () => {
      Object.assign(pull, { merged: false, state: 'open', merge_commit_sha: null });
    });
    assert.equal((await settled(current, id)).state, 'COMPLETED');
    assert.equal(puts(), 2);
    assert.equal(pull.merged, true);
    // The head moved while it was in doubt: the owner decides.
    current = await interrupt(current, id, 'act', () => {
      Object.assign(pull, {
        merged: false,
        state: 'open',
        merge_commit_sha: null,
        headSha: 'f'.repeat(40),
      });
    });
    const doubtful = await settled(current, id);
    assert.equal(doubtful.state, 'NEEDS_HUMAN');
    assert.match(doubtful.attention!.explanation, /head moved/);
    assert.equal(puts(), 2);
  } finally {
    await current.close();
    await fake.stop();
  }
});

test('a lost or failed merge response is settled from GitHub', async () => {
  const { env, fake, close } = await connected();
  try {
    fake.addPull(9001, { head: 'work', headSha: sha });
    fake.dropAfter.push(/^PUT /);
    const done = await settled(
      env,
      await run(env, actionWorkflow('github_merge', { number: '1' })),
    );
    assert.equal(done.state, 'COMPLETED', JSON.stringify(done.attention));
    assert.equal(step(env, done.id, 'act').output!.data['merged'], true);
    // A merge GitHub made before answering 500 is recognized too.
    fake.addPull(9001, { head: 'other', headSha: 'd'.repeat(40) });
    fake.failAfter.push({ match: /^PUT /, status: 500 });
    const late = await settled(
      env,
      await run(env, actionWorkflow('github_merge', { number: '2' })),
    );
    assert.equal(late.state, 'COMPLETED', JSON.stringify(late.attention));
    assert.equal(step(env, late.id, 'act').operations.length, 1);
  } finally {
    await close();
  }
});
