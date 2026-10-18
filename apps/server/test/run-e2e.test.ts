import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { administrativeCall } from '../src/admin-client.js';
import { SystemdScopes } from '../src/harness/containment.js';
import {
  eventually,
  runCli,
  startChild,
  temporaryState,
  workspace,
  type OwnedProcess,
} from './helpers.js';

// Real `shift serve` processes and CLI, real systemd scopes, and a scripted OpenCode stand-in:
// kill either process at any point and the run finishes or reports truthful uncertainty.
const containment = await new SystemdScopes('user').available();
const required = process.env['SHIFT_TEST_REQUIRE_SYSTEMD'] === '1';
const skip = !containment && !required && 'needs a systemd user manager (systemd-run --user)';
const fakeAgent = join(workspace, 'test/fixtures/fake-opencode-agent.mjs');

interface Run {
  id: string;
  state: string;
  outcome: unknown;
  attention: { code: string } | null;
  invocations: Array<{ kind: string; state: string }>;
  workspace: { id: string; path: string } | null;
}

interface FakeState {
  pid: number;
  lastToolPid?: number;
  sessions: Record<string, { messages: Array<{ type: string }> }>;
}

const alive = (pid: number | undefined) => pid !== undefined && existsSync(`/proc/${pid}`);

async function setup() {
  const state = await temporaryState();
  const repo = join(state.path, 'repo');
  await mkdir(repo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'],
    { cwd: repo },
  );
  const serve = (extra: string[] = []) =>
    // A graceful stop needs time to cancel turns through the harness. The stand-in keeps its state
    // in the namespace, so it must never run in the owner's environment.
    startChild(state.path, [
      '--opencode-environment',
      'isolated',
      '--opencode-model',
      'fake/model',
      '--opencode-executable',
      fakeAgent,
      '--shutdown-timeout-ms',
      '10000',
      ...extra,
    ]);
  const shift = async (...args: string[]): Promise<unknown> => {
    const result = await runCli([...args, '--state-dir', state.path]);
    if (result.code !== 0) throw new Error(`shift ${args.join(' ')} failed: ${result.errors}`);
    return JSON.parse(result.output);
  };
  // Registers the repository once, then publishes a start -> agent -> end workflow per run.
  let projectId: string | undefined;
  const start = async (goal: string) => {
    projectId ??= ((await shift('project', 'add', '--path', repo)) as { id: string }).id;
    const file = join(state.path, `workflow-${Date.now()}.json`);
    await writeFile(
      file,
      JSON.stringify({
        nodes: [
          { id: 'start', type: 'manual_trigger' },
          { id: 'agent', type: 'agent', config: { goal } },
          { id: 'end', type: 'end' },
        ],
        connections: [
          {
            id: 'c1',
            fromNodeId: 'start',
            fromPort: 'success',
            toNodeId: 'agent',
            toPort: 'input',
          },
          { id: 'c2', fromNodeId: 'agent', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
        ],
      }),
    );
    const workflow = (await shift(
      'workflow',
      'create',
      '--project',
      projectId,
      '--name',
      `run ${Date.now()}`,
      '--file',
      file,
    )) as { id: string };
    await shift('workflow', 'publish', workflow.id);
    return (await shift('run', 'start', '--workflow', workflow.id)) as Run;
  };
  const show = async (id: string) => (await shift('run', 'show', id)) as Run;
  const until = async (id: string, done: (run: Run) => boolean, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const run = await show(id);
      if (done(run)) return run;
      if (Date.now() > deadline) throw new Error(`run ${id} stuck: ${JSON.stringify(run)}`);
      await delay(200);
    }
  };
  const fake = async (): Promise<FakeState> =>
    JSON.parse(
      await readFile(join(state.path, 'harness/opencode/data/fake-sessions.json'), 'utf8'),
    ) as FakeState;
  const userMessages = async () =>
    Object.values((await fake()).sessions).flatMap((session) =>
      session.messages.filter((message) => message.type === 'user'),
    ).length;
  const toolStarted = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const pid = (await fake().catch(() => null))?.lastToolPid;
      if (alive(pid)) return pid!;
      await delay(100);
    }
    throw new Error('The tool never started.');
  };
  // Freezes the harness so it cannot progress while Shift is down; the reaper's SIGKILL still
  // applies to a stopped process. Without it, the result depends on how fast Shift restarts.
  const freezeHarness = async () => process.kill((await fake()).pid, 'SIGSTOP');
  return {
    state,
    repo,
    serve,
    shift,
    start,
    show,
    until,
    fake,
    userMessages,
    toolStarted,
    freezeHarness,
  };
}

async function stopped(server: OwnedProcess) {
  await server.terminate();
}

test('a manual run completes with the agent result', { skip, timeout: 120_000 }, async () => {
  const env = await setup();
  const server = await env.serve();
  try {
    const run = await env.start('Count. [fake-result {"status":"completed","data":{"count":3}}]');
    const finished = await env.until(run.id, (candidate) => candidate.state !== 'RUNNING');
    assert.equal(finished.state, 'COMPLETED');
    assert.deepEqual(finished.outcome, { data: { count: 3 } });
    // The finished run keeps its worktree until it is removed explicitly.
    const listed = (await env.shift('workspace', 'list')) as Array<{ id: string; state: string }>;
    assert.deepEqual(
      listed.map((workspace) => [workspace.id, workspace.state]),
      [[finished.workspace!.id, 'READY']],
    );
    assert.ok(existsSync(finished.workspace!.path));
    const removed = (await env.shift('workspace', 'remove', finished.workspace!.id)) as {
      state: string;
    };
    assert.equal(removed.state, 'RETIRED');
    assert.equal(existsSync(finished.workspace!.path), false);
  } finally {
    await stopped(server);
    await env.state.remove();
  }
});

test(
  'killing Shift during tool work kills the tool and reports the outcome as unknown',
  { skip, timeout: 120_000 },
  async () => {
    const env = await setup();
    let server = await env.serve();
    try {
      const run = await env.start('Work. [fake-work 30000]');
      const tool = await env.toolStarted();
      await env.freezeHarness();
      await server.terminate('SIGKILL');
      server = await env.serve();
      const finished = await env.until(run.id, (candidate) => candidate.state !== 'RUNNING');
      assert.equal(finished.state, 'NEEDS_HUMAN');
      assert.equal(finished.attention?.code, 'HARNESS_OUTCOME_UNKNOWN');
      assert.equal(alive(tool), false, 'the orphaned tool died with the stale runtime scope');
      assert.equal(await env.userMessages(), 1, 'nothing was resubmitted');
      // A run waiting for a human still owns its workspace.
      const refused = await runCli([
        'workspace',
        'remove',
        finished.workspace!.id,
        '--force',
        '--state-dir',
        env.state.path,
      ]);
      assert.equal(refused.code, 1);
      assert.equal((JSON.parse(refused.errors) as { code: string }).code, 'WORKSPACE_IN_USE');
      assert.ok(existsSync(finished.workspace!.path));
      // The owner checked the workspace and records the result by hand.
      const result = join(env.state.path, 'result.json');
      await writeFile(result, JSON.stringify({ checked: true }));
      await env.shift('run', 'complete', run.id, '--file', result);
      const completed = await env.until(run.id, (candidate) => candidate.state !== 'RUNNING');
      assert.equal(completed.state, 'COMPLETED');
      assert.deepEqual(completed.outcome, { data: { checked: true } });
    } finally {
      await stopped(server);
      await env.state.remove();
    }
  },
);

test(
  'cancelling a run stops its agent and kills the tool',
  { skip, timeout: 120_000 },
  async () => {
    const env = await setup();
    const server = await env.serve();
    try {
      const run = await env.start('Work. [fake-work 30000]');
      const tool = await env.toolStarted();
      const cancelled = (await env.shift(
        'run',
        'cancel',
        run.id,
        '--reason',
        'Changed my mind.',
        '--wait',
      )) as Run;
      assert.equal(cancelled.state, 'CANCELLED', JSON.stringify(cancelled));
      assert.deepEqual(cancelled.outcome, { cancelled: true, reason: 'Changed my mind.' });
      await eventually(() => (alive(tool) ? undefined : true));
    } finally {
      await stopped(server);
      await env.state.remove();
    }
  },
);

test(
  'killing Shift before the agent started working continues the same session',
  { skip, timeout: 120_000 },
  async () => {
    const env = await setup();
    let server = await env.serve();
    try {
      const run = await env.start(
        'Wait. [fake-delay 4000] [fake-result {"status":"completed","data":{"done":true}}]',
      );
      await env.until(run.id, (candidate) => candidate.invocations[0]?.state === 'RUNNING');
      await env.freezeHarness();
      await server.terminate('SIGKILL');
      server = await env.serve();
      const finished = await env.until(run.id, (candidate) => candidate.state !== 'RUNNING');
      assert.equal(finished.state, 'COMPLETED');
      assert.deepEqual(
        finished.invocations.map((invocation) => [invocation.kind, invocation.state]),
        [
          ['goal', 'INTERRUPTED'],
          ['continuation', 'COMPLETED'],
        ],
      );
      assert.equal(await env.userMessages(), 2);
    } finally {
      await stopped(server);
      await env.state.remove();
    }
  },
);

test(
  'a graceful stop interrupts the turn and the restart continues it',
  { skip, timeout: 120_000 },
  async () => {
    const env = await setup();
    let server = await env.serve();
    try {
      const run = await env.start(
        'Work. [fake-work 3000] [fake-result {"status":"completed","data":{"done":true}}]',
      );
      const tool = await env.toolStarted();
      await env.shift('stop');
      await server.exit;
      assert.equal(alive(tool), false);
      server = await env.serve();
      const finished = await env.until(run.id, (candidate) => candidate.state !== 'RUNNING');
      assert.equal(finished.state, 'COMPLETED');
      assert.deepEqual(
        finished.invocations.map((invocation) => [invocation.kind, invocation.state]),
        [
          ['goal', 'INTERRUPTED'],
          ['continuation', 'COMPLETED'],
        ],
      );
    } finally {
      await stopped(server);
      await env.state.remove();
    }
  },
);

test(
  'killing OpenCode during tool work kills the tool and reports the outcome as unknown',
  { skip, timeout: 120_000 },
  async () => {
    const env = await setup();
    const server = await env.serve();
    try {
      const run = await env.start('Work. [fake-work 4000]');
      const tool = await env.toolStarted();
      process.kill((await env.fake()).pid, 'SIGKILL');
      const finished = await env.until(run.id, (candidate) => candidate.state !== 'RUNNING');
      assert.equal(finished.state, 'NEEDS_HUMAN');
      assert.equal(finished.attention?.code, 'HARNESS_OUTCOME_UNKNOWN');
      assert.equal(alive(tool), false);
      assert.equal(await env.userMessages(), 1);
    } finally {
      await stopped(server);
      await env.state.remove();
    }
  },
);

test(
  'shutdown keeps its deadline when the harness stops answering',
  { skip, timeout: 120_000 },
  async () => {
    const env = await setup();
    let server = await env.serve(['--shutdown-timeout-ms', '2000']);
    try {
      await env.start('Work. [fake-work 30000] [fake-hang-interrupt]');
      const tool = await env.toolStarted();
      // Measured from the acknowledged stop request, excluding CLI start-up time.
      const acknowledged = await administrativeCall(env.state.path, {
        method: 'POST',
        path: '/api/v0/admin/shutdown',
      });
      assert.equal(acknowledged.status, 202);
      const started = Date.now();
      await server.exit;
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 3_000, `shutdown took ${elapsed} ms with a 2000 ms budget`);
      assert.equal(alive(tool), false, 'the runtime scope was killed as the fallback');
      server = await env.serve();
    } finally {
      await stopped(server);
      await env.state.remove();
    }
  },
);
