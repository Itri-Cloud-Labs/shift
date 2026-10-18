import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { SystemdScopes } from '../../src/harness/containment.js';
import { OpenCodeAdapter } from '../../src/harness/opencode/adapter.js';
import { OpenCodeRuntime } from '../../src/harness/opencode/runtime.js';
import type {
  HarnessSessionHandle,
  InvocationCorrelation,
  InvocationObservation,
  ResultSubmission,
} from '../../src/harness/types.js';
import { createLogger } from '../../src/logging.js';
import { temporaryState } from '../helpers.js';
import { environment, key, modelID, providerID, skip } from './opencode-setup.js';

const settled = (observation: InvocationObservation) =>
  !['queued', 'running'].includes(observation.kind);

test('OpenCode v2 adapter against a real runtime', { skip, timeout: 600_000 }, async (t) => {
  const state = await temporaryState();
  const repo = join(state.path, 'repo');
  const artifacts = join(state.path, 'artifacts');
  await mkdir(repo);
  await mkdir(artifacts);
  await writeFile(join(repo, 'README.md'), 'hi there friend\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=shift', '-c', 'user.email=shift@localhost', 'commit', '-qm', 'init');

  const submissions: ResultSubmission[] = [];
  const arraySessions = new Set<string>();
  const runtime = new OpenCodeRuntime({
    stateDirectory: state.path,
    scopes: new SystemdScopes('user'),
    logger: createLogger('silent'),
    environment,
    ...(key === undefined ? {} : { credentials: [{ integrationID: providerID, key }] }),
    resultHandler: async (submission) => {
      submissions.push(submission);
      const input = submission.input as { status?: string; data?: unknown };
      const expectsArray = arraySessions.has(submission.harnessSessionId);
      if (input.status !== 'completed') return { accepted: true };
      if (expectsArray && !Array.isArray(input.data)) {
        return { accepted: false, reason: 'data must be an array of strings' };
      }
      const wordCount = (input.data as { wordCount?: unknown } | undefined)?.wordCount;
      if (!expectsArray && !Number.isInteger(wordCount)) {
        return { accepted: false, reason: 'data.wordCount must be an integer' };
      }
      return { accepted: true };
    },
  });
  const adapter = new OpenCodeAdapter(runtime);
  const model = { providerID, id: modelID };
  const session = (shiftSessionId = randomUUID()) =>
    adapter.createSession({ shiftSessionId, operationId: randomUUID(), cwd: repo, model });
  const submit = async (
    handle: HarnessSessionHandle,
    goal: string,
    mode: 'read_only' | 'workspace_write',
  ) => {
    const receipt = await adapter.submit(handle, {
      invocationId: randomUUID(),
      goal,
      artifactDirectory: artifacts,
      toolPolicy: { mode },
    });
    assert.equal(receipt.kind, 'accepted');
    return receipt.correlation;
  };
  const settle = async (handle: HarnessSessionHandle, correlation: InvocationCorrelation) => {
    const deadline = Date.now() + 180_000;
    for (;;) {
      const observation = await adapter.inspectInvocation(handle, correlation);
      if (settled(observation) || Date.now() > deadline) return observation;
      await delay(500);
    }
  };
  const toolProcesses = async (handle: HarnessSessionHandle) => {
    for (let attempt = 0; attempt < 240; attempt++) {
      const pids = await runtime.sessionProcesses(handle.harnessSessionId);
      if (pids.length) return pids;
      await delay(250);
    }
    throw new Error('The tool process never started.');
  };

  try {
    await t.test('session creation is idempotent and rejects a conflicting identity', async () => {
      const shiftSessionId = randomUUID();
      const first = await session(shiftSessionId);
      assert.deepEqual(await session(shiftSessionId), first);
      await assert.rejects(
        adapter.createSession({
          shiftSessionId,
          operationId: randomUUID(),
          cwd: artifacts,
          model,
        }),
        { code: 'HARNESS_SESSION_CONFLICT' },
      );
    });

    await t.test('a goal ends with a structured result accepted by Shift', async () => {
      const handle = await session();
      const correlation = await submit(
        handle,
        'Read README.md and count its words. Then call shift_submit_result with status ' +
          '"completed" and data {"wordCount": <the count>}. Do not reply with the result in text.',
        'read_only',
      );
      const observation = await settle(handle, correlation);
      assert.equal(observation.kind, 'ended');
      const accepted = submissions.filter((s) => s.harnessSessionId === handle.harnessSessionId);
      assert.ok(accepted.length >= 1);
      assert.deepEqual((accepted.at(-1)!.input as { data: unknown }).data, { wordCount: 3 });
      // OpenCode's real cursors: one message per page must reach the same conclusion.
      const paged = new OpenCodeAdapter(runtime, { pageSize: 1 });
      assert.deepEqual(await paged.inspectInvocation(handle, correlation), observation);
    });

    await t.test('results are not restricted to objects', async () => {
      const handle = await session();
      arraySessions.add(handle.harnessSessionId);
      const correlation = await submit(
        handle,
        'Read README.md. Call shift_submit_result with status "completed" and data set to a ' +
          'JSON array containing each word of the file as a string, in order.',
        'read_only',
      );
      assert.equal((await settle(handle, correlation)).kind, 'ended');
      const last = submissions.filter((s) => s.harnessSessionId === handle.harnessSessionId).at(-1);
      assert.deepEqual((last?.input as { data: unknown }).data, ['hi', 'there', 'friend']);
    });

    await t.test('read-only invocations write artifacts but not the repository', async () => {
      const handle = await session();
      const correlation = await submit(
        handle,
        `Write the file ${join(artifacts, 'report.md')} containing "report". Then try to create ` +
          'blocked.txt in the current repository containing HELLO, using any tool. Then call ' +
          'shift_submit_result with status "completed" and data {"wordCount": 0}.',
        'read_only',
      );
      await settle(handle, correlation);
      assert.ok(existsSync(join(artifacts, 'report.md')));
      assert.equal(existsSync(join(repo, 'blocked.txt')), false);
    });

    await t.test('cancellation stops the turn, its tool processes and queued input', async () => {
      const handle = await session();
      const correlation = await submit(
        handle,
        'Run the shell command `sleep 30 && echo done > cancelled.txt` and wait for it.',
        'workspace_write',
      );
      const pids = await toolProcesses(handle);
      await submit(handle, 'Afterwards, reply SECOND.', 'workspace_write');
      const cancelled = await adapter.cancel(handle, correlation);
      assert.equal(cancelled.kind, 'stopped', JSON.stringify(cancelled));
      assert.ok(pids.every((pid) => !existsSync(`/proc/${pid}`)));
      const { client } = await runtime.ensure();
      const inbox = await client.expect(
        [200],
        'GET',
        `/api/session/${handle.harnessSessionId}/inbox`,
      );
      assert.deepEqual((inbox.body as { data: unknown[] }).data, []);
      await delay(1_000);
      assert.equal(existsSync(join(repo, 'cancelled.txt')), false);
    });

    await t.test(
      'losing the runtime kills its tools and leaves the invocation unknown',
      async () => {
        const handle = await session();
        const correlation = await submit(
          handle,
          'Run the shell command `sleep 5 && echo done > crashed.txt` and wait for it.',
          'workspace_write',
        );
        const pids = await toolProcesses(handle);
        const lost = new Promise<number>((resolve) => runtime.onLost(resolve));
        process.kill(runtime.current!.pid, 'SIGKILL');
        await lost;
        await runtime.ensure();
        assert.ok(
          pids.every((pid) => !existsSync(`/proc/${pid}`)),
          'tool processes were killed',
        );
        await delay(6_000);
        assert.equal(existsSync(join(repo, 'crashed.txt')), false, 'the effect never happened');
        const observation = await adapter.inspectInvocation(handle, correlation);
        assert.equal(observation.kind, 'unknown', JSON.stringify(observation));
      },
    );
  } finally {
    await runtime.stop();
    await state.remove();
  }
});

// A refused credential is rejected before any model work, so this costs nothing. It runs in an
// isolated namespace whatever the environment, so the owner's credentials are never involved.
test(
  'a refused provider credential is reported as a provider failure',
  {
    skip: process.env['SHIFT_TEST_OPENCODE'] !== '1' && 'set SHIFT_TEST_OPENCODE=1',
    timeout: 120_000,
  },
  async () => {
    const state = await temporaryState();
    const repo = join(state.path, 'repo');
    const artifacts = join(state.path, 'artifacts');
    await mkdir(repo);
    await mkdir(artifacts);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const runtime = new OpenCodeRuntime({
      stateDirectory: state.path,
      scopes: new SystemdScopes('user'),
      logger: createLogger('silent'),
      environment: 'isolated',
      credentials: [{ integrationID: 'opencode-go', key: 'sk-shift-test-refused' }],
      resultHandler: async () => ({ accepted: false, reason: 'unused' }),
    });
    const adapter = new OpenCodeAdapter(runtime);
    try {
      const handle = await adapter.createSession({
        shiftSessionId: randomUUID(),
        operationId: randomUUID(),
        cwd: repo,
        model: { providerID: 'opencode-go', id: 'claude-haiku-5-5' },
      });
      const invocationId = randomUUID();
      const correlation = adapter.correlate(invocationId);
      await adapter.submit(handle, {
        invocationId,
        goal: 'Say hi.',
        artifactDirectory: artifacts,
        toolPolicy: { mode: 'read_only' },
      });
      let observation = await adapter.inspectInvocation(handle, correlation);
      for (let attempt = 0; attempt < 120 && !settled(observation); attempt++) {
        await delay(500);
        observation = await adapter.inspectInvocation(handle, correlation);
      }
      assert.equal(observation.kind, 'ended', JSON.stringify(observation));
      assert.equal(
        observation.kind === 'ended' ? observation.failure?.code : undefined,
        'PROVIDER_AUTH',
      );
    } finally {
      await runtime.stop();
      await state.remove();
    }
  },
);
