import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type {
  CancellationObservation,
  HarnessAdapter,
  HarnessCapabilities,
  HarnessCreateRequest,
  HarnessEvent,
  HarnessInvocationRequest,
  HarnessSessionHandle,
  InvocationCorrelation,
  InvocationObservation,
  ResultHandler,
  SubmissionReceipt,
} from '../src/harness/types.js';
import { createLogger } from '../src/logging.js';
import { openStore, type Store } from '../src/persistence/store.js';
import { RunEngine } from '../src/runs/engine.js';
import { StaleClaim } from '../src/runs/repository.js';
import { FakeClock, eventually, temporaryState } from './helpers.js';

interface Turn {
  messageId: string;
  prompt: string;
  handle: HarnessSessionHandle;
  status: 'queued' | 'running' | 'prompt' | 'ended' | 'interrupted' | 'unknown';
  outcome?: 'succeeded' | 'failed';
}

type Behaviour = (turn: Turn, fake: FakeHarness) => void | Promise<void>;

// A scripted harness: each submitted prompt becomes a turn that the test's behaviour drives,
// submitting results through Shift's real result handler.
class FakeHarness implements HarnessAdapter {
  readonly id = 'fake';
  readonly storageNamespace = '/fake';
  readonly turns = new Map<string, Turn>();
  readonly submits: string[] = [];
  cancels = 0;
  creates = 0;
  confirmCancel = true;
  handler!: ResultHandler;
  #calls = 0;

  constructor(public behave: Behaviour) {}

  capabilities(): HarnessCapabilities {
    return {
      persistedSessionResume: true,
      structuredSchemaDialect: 'adapter-translated',
      invocationInspection: 'durable_correlated',
      cancellation: 'acknowledged_stop',
      toolPolicy: 'enforced',
    };
  }

  correlate(invocationId: string): InvocationCorrelation {
    return { shiftInvocationId: invocationId, providerMessageId: `msg_${invocationId}` };
  }

  async createSession(request: HarnessCreateRequest): Promise<HarnessSessionHandle> {
    this.creates++;
    return {
      shiftSessionId: request.shiftSessionId,
      harnessSessionId: `ses_${request.shiftSessionId}`,
      storageNamespace: this.storageNamespace,
      cwd: request.cwd,
    };
  }

  async inspectSession() {
    return { kind: 'present' as const, active: false, cwd: '/', metadata: null };
  }

  async submit(
    handle: HarnessSessionHandle,
    request: HarnessInvocationRequest,
  ): Promise<SubmissionReceipt> {
    const correlation = this.correlate(request.invocationId);
    this.submits.push(correlation.providerMessageId);
    let turn = this.turns.get(correlation.providerMessageId);
    if (!turn) {
      turn = {
        messageId: correlation.providerMessageId,
        prompt: request.goal,
        handle,
        status: 'running',
      };
      this.turns.set(turn.messageId, turn);
    } else if (turn.status === 'queued') {
      turn.status = 'running';
      turn.handle = handle;
    } else {
      return { kind: 'accepted', correlation };
    }
    const started = turn;
    setImmediate(() => void this.behave(started, this));
    return { kind: 'accepted', correlation };
  }

  async inspectInvocation(
    _handle: HarnessSessionHandle,
    correlation: InvocationCorrelation,
  ): Promise<InvocationObservation> {
    const turn = this.turns.get(correlation.providerMessageId);
    if (!turn) return { kind: 'not_accepted' };
    switch (turn.status) {
      case 'queued':
        return { kind: 'queued' };
      case 'running':
        return { kind: 'running' };
      case 'prompt':
        return { kind: 'awaiting_harness_prompt', prompts: [{ kind: 'permission', id: 'per_1' }] };
      case 'ended':
        return { kind: 'ended', outcome: turn.outcome ?? 'succeeded', messageIds: ['msg_a'] };
      case 'interrupted':
        return { kind: 'interrupted', explanation: 'stopped', messageIds: [] };
      case 'unknown':
        return {
          kind: 'unknown',
          explanation: 'The runtime crashed mid-tool.',
          messageIds: ['msg_a'],
        };
    }
  }

  async *observe(): AsyncIterable<HarnessEvent> {}

  async cancel(
    handle: HarnessSessionHandle,
    correlation: InvocationCorrelation,
  ): Promise<CancellationObservation> {
    this.cancels++;
    if (!this.confirmCancel) {
      return {
        kind: 'unconfirmed',
        explanation: 'Tool processes of the session are still running.',
        observation: await this.inspectInvocation(handle, correlation),
      };
    }
    const turn = this.turns.get(correlation.providerMessageId);
    if (turn && (turn.status === 'running' || turn.status === 'prompt'))
      turn.status = 'interrupted';
    return { kind: 'stopped', observation: await this.inspectInvocation(handle, correlation) };
  }

  async archive(): Promise<void> {}

  submitResult(turn: Turn, input: unknown, toolCallId = `call_${++this.#calls}`) {
    return this.handler({
      harnessSessionId: turn.handle.harnessSessionId,
      assistantMessageId: 'msg_a',
      toolCallId,
      input,
    });
  }
}

const complete =
  (data: unknown): Behaviour =>
  async (turn, fake) => {
    await fake.submitResult(turn, { status: 'completed', data });
    turn.status = 'ended';
  };

interface Harnessed {
  store: Store;
  engine: RunEngine;
  fake: FakeHarness;
  repository: string;
  state: string;
  close(): Promise<void>;
}

async function engineFor(
  behave: Behaviour,
  existing?: { state: string; fake?: FakeHarness },
): Promise<Harnessed> {
  const state = existing?.state ?? (await temporaryState()).path;
  const repository = join(state, 'repo');
  await mkdir(repository, { recursive: true });
  const store = await openStore({ stateDirectory: state, clock: new FakeClock() });
  const fake = existing?.fake ?? new FakeHarness(behave);
  fake.behave = behave;
  const engine = new RunEngine({
    store,
    clock: new FakeClock(),
    logger: createLogger('silent'),
    adapter: fake,
    artifactRoot: join(state, 'artifacts'),
    defaultModel: 'fake/model',
    pollIntervalMs: 10,
  });
  fake.handler = engine.agents.handleResult;
  engine.start();
  return {
    store,
    engine,
    fake,
    repository,
    state,
    async close() {
      await engine.stop(5_000);
      store.close();
    },
  };
}

type RunView = {
  id: string;
  state: string;
  outcome: unknown;
  attention: { code: string } | null;
  executions: Array<{
    node: string;
    state: string;
    output: unknown;
    error: { code?: string; category?: string } | null;
  }>;
  invocations: Array<{
    kind: string;
    state: string;
    correlationId: string;
    submissions: number;
    acceptedSubmissions: number;
  }>;
};

const view = (harnessed: Harnessed, id: string) =>
  harnessed.engine.repository.run(id) as unknown as RunView;

async function settled(harnessed: Harnessed, id: string): Promise<RunView> {
  return eventually(() => {
    const run = view(harnessed, id);
    return run.state === 'RUNNING' ? undefined : run;
  });
}

async function start(harnessed: Harnessed, extra: Record<string, unknown> = {}): Promise<string> {
  const run = (await harnessed.engine.createRun({
    goal: 'Count the words.',
    repository: harnessed.repository,
    resultSchema: {
      type: 'object',
      required: ['count'],
      properties: { count: { type: 'integer' } },
      additionalProperties: false,
    },
    ...extra,
  })) as { id: string };
  return run.id;
}

test('a completed result advances to the end node in the same commit', async () => {
  const harnessed = await engineFor(complete({ count: 3 }));
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.outcome, { data: { count: 3 } });
    assert.deepEqual(
      run.executions.map((execution) => [execution.node, execution.state]),
      [
        ['start', 'COMPLETED'],
        ['agent', 'COMPLETED'],
        ['end', 'COMPLETED'],
      ],
    );
    assert.deepEqual(run.executions[2]!.output, { data: { count: 3 } });
    assert.deepEqual(
      run.invocations.map((invocation) => [invocation.kind, invocation.state]),
      [['goal', 'COMPLETED']],
    );
    assert.equal(harnessed.fake.creates, 1);
    assert.match([...harnessed.fake.turns.values()][0]!.prompt, /shift_submit_result/);
  } finally {
    await harnessed.close();
  }
});

test('an invalid result is rejected in the turn and the corrected one completes', async () => {
  const verdicts: unknown[] = [];
  const harnessed = await engineFor(async (turn, fake) => {
    verdicts.push(await fake.submitResult(turn, { status: 'completed', data: { count: 'three' } }));
    verdicts.push(await fake.submitResult(turn, { status: 'completed', data: { count: 3 } }));
    turn.status = 'ended';
  });
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(verdicts, [
      { accepted: false, reason: 'result/data/count must be integer' },
      { accepted: true },
    ]);
    assert.equal(run.invocations[0]!.submissions, 2);
    assert.equal(run.invocations[0]!.acceptedSubmissions, 1);
  } finally {
    await harnessed.close();
  }
});

test('a turn without a result gets a correction invocation', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    if (/ended without a result/.test(turn.prompt)) await complete({ count: 3 })(turn, fake);
    else turn.status = 'ended';
  });
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(
      run.invocations.map((invocation) => [invocation.kind, invocation.state]),
      [
        ['goal', 'FAILED'],
        ['correction', 'COMPLETED'],
      ],
    );
  } finally {
    await harnessed.close();
  }
});

test('exhausted corrections fail the node with a contract error', async () => {
  const harnessed = await engineFor((turn) => {
    turn.status = 'ended';
  });
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'FAILED');
    assert.equal(run.invocations.length, 3);
    assert.deepEqual(
      { code: run.executions[1]!.error?.code, category: run.executions[1]!.error?.category },
      { code: 'RESULT_MISSING', category: 'contract' },
    );
    assert.equal(run.executions.length, 2, 'a failed node schedules no successor');
  } finally {
    await harnessed.close();
  }
});

test('a blocker is a structured failure, not invented success data', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    await fake.submitResult(turn, {
      status: 'blocked',
      blocker: { code: 'MISSING_INPUT', message: 'No spec file.' },
    });
    turn.status = 'ended';
  });
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'FAILED');
    assert.deepEqual(run.outcome, {
      code: 'MISSING_INPUT',
      message: 'No spec file.',
      category: 'blocked',
    });
  } finally {
    await harnessed.close();
  }
});

test('a harness permission or question prompt is cancelled and reported as a blocker', async () => {
  const harnessed = await engineFor((turn) => {
    turn.status = 'prompt';
  });
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'FAILED');
    assert.equal(run.executions[1]!.error?.code, 'HARNESS_PROMPT');
    assert.equal(harnessed.fake.cancels, 1);
  } finally {
    await harnessed.close();
  }
});

test('an unknown turn outcome needs a human and is never retried', async () => {
  const harnessed = await engineFor((turn) => {
    turn.status = 'unknown';
  });
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'NEEDS_HUMAN');
    assert.equal(run.attention?.code, 'HARNESS_OUTCOME_UNKNOWN');
    assert.deepEqual(
      run.invocations.map((invocation) => invocation.state),
      ['UNKNOWN'],
    );
    assert.equal(run.executions[1]!.state, 'WAITING');
    assert.equal(harnessed.fake.submits.length, 1);
  } finally {
    await harnessed.close();
  }
});

test('a turn interrupted without effects is continued in the same session', async () => {
  let first = true;
  const harnessed = await engineFor(async (turn, fake) => {
    if (first) {
      first = false;
      turn.status = 'interrupted';
    } else await complete({ count: 3 })(turn, fake);
  });
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(
      run.invocations.map((invocation) => [invocation.kind, invocation.state]),
      [
        ['goal', 'INTERRUPTED'],
        ['continuation', 'COMPLETED'],
      ],
    );
    assert.equal(harnessed.fake.creates, 1, 'the continuation reuses the session');
    assert.match([...harnessed.fake.turns.values()][1]!.prompt, /interrupted before it finished/);
  } finally {
    await harnessed.close();
  }
});

test('the same tool call delivered twice is recorded once', async () => {
  const verdicts: unknown[] = [];
  const harnessed = await engineFor(async (turn, fake) => {
    verdicts.push(
      await fake.submitResult(turn, { status: 'completed', data: { count: 1 } }, 'call_same'),
    );
    verdicts.push(
      await fake.submitResult(turn, { status: 'completed', data: { count: 2 } }, 'call_same'),
    );
    turn.status = 'ended';
  });
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.deepEqual(verdicts, [{ accepted: true }, { accepted: true }]);
    assert.equal(run.invocations[0]!.submissions, 1);
    assert.deepEqual(run.outcome, { data: { count: 1 } });
  } finally {
    await harnessed.close();
  }
});

test('results for a session without an active invocation are rejected', async () => {
  const harnessed = await engineFor(complete({ count: 3 }));
  try {
    const verdict = await harnessed.engine.agents.handleResult({
      harnessSessionId: 'ses_unknown',
      assistantMessageId: 'msg',
      toolCallId: 'call',
      input: { status: 'completed', data: { count: 1 } },
    });
    assert.deepEqual(verdict, {
      accepted: false,
      reason: 'no Shift task is active in this session',
    });
  } finally {
    await harnessed.close();
  }
});

// Leaves the agent node with an invocation whose prompt has a durable intent but was never sent,
// as if Shift died between recording SUBMITTING and calling the harness.
async function strandedIntent(): Promise<{ state: string; runId: string; correlation: string }> {
  const never = new Promise<void>(() => {});
  const harnessed = await engineFor(() => never);
  const original = harnessed.fake.submit.bind(harnessed.fake);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  harnessed.fake.submit = async () => {
    release();
    return new Promise<SubmissionReceipt>(() => {});
  };
  const runId = await start(harnessed);
  await blocked;
  const run = view(harnessed, runId);
  assert.deepEqual(
    run.invocations.map((invocation) => invocation.state),
    ['SUBMITTING'],
  );
  harnessed.fake.submit = original;
  // Simulate the crash: stop scheduling without waiting for the stuck task, then close the store.
  void harnessed.engine.stop(5_000);
  harnessed.store.close();
  return { state: harnessed.state, runId, correlation: run.invocations[0]!.correlationId };
}

test('after a crash, an intent the harness never received is submitted once with the same ID', async () => {
  const { state, runId, correlation } = await strandedIntent();
  const restarted = await engineFor(complete({ count: 3 }), { state });
  try {
    const run = await settled(restarted, runId);
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(restarted.fake.submits, [correlation]);
    assert.equal(run.invocations.length, 1, 'recovery continued the same invocation');
  } finally {
    await restarted.close();
  }
});

test('after a restart, an accepted but undelivered prompt is woken with the same ID', async () => {
  const { state, runId, correlation } = await strandedIntent();
  const fake = new FakeHarness(complete({ count: 3 }));
  fake.turns.set(correlation, {
    messageId: correlation,
    prompt: 'queued before the crash',
    handle: { shiftSessionId: '', harnessSessionId: '', storageNamespace: '', cwd: '' },
    status: 'queued',
  });
  const restarted = await engineFor(complete({ count: 3 }), { state, fake });
  try {
    const run = await settled(restarted, runId);
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(fake.submits, [correlation]);
  } finally {
    await restarted.close();
  }
});

test('after a restart, a turn that ended with an accepted result completes without resubmitting', async () => {
  let release!: () => void;
  const finished = new Promise<void>((resolve) => (release = resolve));
  const first = await engineFor(async (turn, fake) => {
    await fake.submitResult(turn, { status: 'completed', data: { count: 3 } });
    release();
  });
  const runId = await start(first);
  await finished;
  const fake = new FakeHarness(() => {});
  for (const [id, turn] of first.fake.turns) fake.turns.set(id, { ...turn, status: 'ended' });
  // Crash before the engine observed the end of the turn.
  void first.engine.stop(5_000);
  first.store.close();
  const restarted = await engineFor(() => {}, { state: first.state, fake });
  try {
    const run = await settled(restarted, runId);
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(fake.submits, []);
  } finally {
    await restarted.close();
  }
});

test('a graceful stop cancels the turn, and the next start continues it', async () => {
  const first = await engineFor(() => {});
  const runId = await start(first);
  await eventually(() =>
    view(first, runId).invocations[0]?.state === 'RUNNING' ? true : undefined,
  );
  await first.close();
  assert.equal(first.fake.cancels, 1);
  const restarted = await engineFor(complete({ count: 3 }), {
    state: first.state,
    fake: first.fake,
  });
  try {
    const run = await settled(restarted, runId);
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(
      run.invocations.map((invocation) => [invocation.kind, invocation.state]),
      [
        ['goal', 'INTERRUPTED'],
        ['continuation', 'COMPLETED'],
      ],
    );
  } finally {
    await restarted.close();
  }
});

test('a stale claim cannot advance the run after recovery reclaims its attempt', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const runId = await start(harnessed);
    await eventually(() =>
      view(harnessed, runId).invocations[0]?.state === 'RUNNING' ? true : undefined,
    );
    const repository = harnessed.engine.repository;
    const [stale] = harnessed.store.db
      .prepare(
        'SELECT a.id AS attemptId, a.execution_id AS executionId, e.run_id AS runId, a.fence FROM node_attempts a JOIN node_executions e ON e.id = a.execution_id WHERE e.run_id = ?',
      )
      .all(runId) as Array<{
      attemptId: string;
      executionId: string;
      runId: string;
      fence: number;
    }>;
    const [fresh] = repository.reclaimOrphanedAttempts('another-generation');
    assert.equal(fresh!.fence, stale!.fence + 1);
    assert.throws(
      () => repository.finishAgent(stale!, { kind: 'completed', data: {} }),
      StaleClaim,
    );
    assert.equal(view(harnessed, runId).state, 'RUNNING');
  } finally {
    await harnessed.close();
  }
});

test('run requests are validated before anything is stored', async () => {
  const harnessed = await engineFor(() => {});
  try {
    await assert.rejects(harnessed.engine.createRun({ goal: '' }), { code: 'INVALID_REQUEST' });
    await assert.rejects(harnessed.engine.createRun({ goal: 'x', repository: 'relative/path' }), {
      code: 'INVALID_REQUEST',
    });
    await assert.rejects(
      harnessed.engine.createRun({
        goal: 'x',
        repository: harnessed.repository,
        resultSchema: { type: 'nonsense' },
      }),
      { code: 'INVALID_RESULT_SCHEMA' },
    );
    assert.deepEqual(harnessed.engine.repository.runs(), []);
  } finally {
    await harnessed.close();
  }
});

test('reaching the rejection limit stops the turn, and a correction follows', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    if (/ended without a result/.test(turn.prompt)) return complete({ count: 3 })(turn, fake);
    // Keeps submitting invalid results and never ends the turn by itself.
    for (let attempt = 0; attempt < 5; attempt++) {
      await fake.submitResult(turn, { status: 'completed', data: { count: 'many' } });
    }
  });
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(
      run.invocations.map((invocation) => [invocation.kind, invocation.state]),
      [
        ['goal', 'FAILED'],
        ['correction', 'COMPLETED'],
      ],
    );
    assert.equal(run.invocations[0]!.acceptedSubmissions, 0);
    assert.ok(harnessed.fake.cancels >= 1, 'the turn was cancelled at the limit');
  } finally {
    await harnessed.close();
  }
});

test('an accepted result completes the node even if the turn then ends without evidence', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    await fake.submitResult(turn, { status: 'completed', data: { count: 3 } });
    turn.status = 'unknown';
  });
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.outcome, { data: { count: 3 } });
  } finally {
    await harnessed.close();
  }
});

test('a stop that cannot be confirmed keeps the run for a human', async () => {
  const harnessed = await engineFor((turn) => {
    turn.status = 'prompt';
  });
  harnessed.fake.confirmCancel = false;
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'NEEDS_HUMAN');
    assert.equal(run.attention?.code, 'HARNESS_OUTCOME_UNKNOWN');
    assert.deepEqual(
      run.invocations.map((invocation) => invocation.state),
      ['UNKNOWN'],
    );
    assert.equal(run.executions[1]!.state, 'WAITING', 'the session is not released');
  } finally {
    await harnessed.close();
  }
});

test('result schemas with local references validate at their own root', async () => {
  const harnessed = await engineFor(complete(3));
  try {
    const run = await settled(
      harnessed,
      await start(harnessed, {
        resultSchema: { $defs: { count: { type: 'integer' } }, $ref: '#/$defs/count' },
      }),
    );
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.outcome, { data: 3 });
  } finally {
    await harnessed.close();
  }
});
