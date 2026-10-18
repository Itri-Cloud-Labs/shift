import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type {
  CancellationObservation,
  HarnessAdapter,
  HarnessCapabilities,
  HarnessFailure,
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
import type { Json } from '../src/harness/types.js';
import { CommandReceipts } from '../src/persistence/receipts.js';
import { RunEngine } from '../src/runs/engine.js';
import { normalizeDocument } from '../src/workflows/document.js';
import { DefinitionRepository } from '../src/workflows/repository.js';
import { StaleClaim } from '../src/runs/repository.js';
import { FakeClock, eventually, temporaryState } from './helpers.js';

interface Turn {
  messageId: string;
  prompt: string;
  handle: HarnessSessionHandle;
  status: 'queued' | 'running' | 'prompt' | 'ended' | 'interrupted' | 'unknown';
  outcome?: 'succeeded' | 'failed';
  failure?: HarnessFailure;
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
        return {
          kind: 'ended',
          outcome: turn.outcome ?? 'succeeded',
          messageIds: ['msg_a'],
          ...(turn.failure ? { failure: turn.failure } : {}),
        };
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
  definitions: DefinitionRepository;
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
  const definitions = new DefinitionRepository(store.db, new FakeClock());
  const engine = new RunEngine({
    store,
    definitions,
    receipts: new CommandReceipts(store.db, new FakeClock()),
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
    definitions,
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

// Publishes a start -> agent -> end workflow, then starts it.
async function publish(
  harnessed: Pick<Harnessed, 'definitions' | 'repository'>,
  document: Json,
): Promise<string> {
  const projects = harnessed.definitions.projects();
  const project =
    projects[0] ??
    harnessed.definitions.addProject({
      name: 'repo',
      repositoryPath: harnessed.repository,
      baseRef: 'main',
    });
  const workflow = harnessed.definitions.createWorkflow({
    projectId: project.id,
    name: `workflow-${Math.random().toString(36).slice(2)}`,
    draft: normalizeDocument(document) as Json,
  }) as { id: string };
  harnessed.definitions.publish(workflow.id);
  return workflow.id;
}

const agentWorkflow = (agent: Record<string, unknown> = {}): Json =>
  ({
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      {
        id: 'agent',
        type: 'agent',
        config: {
          goal: 'Count the words.',
          resultSchema: {
            type: 'object',
            required: ['count'],
            properties: { count: { type: 'integer' } },
            additionalProperties: false,
          },
          ...agent,
        },
      },
      { id: 'end', type: 'end' },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'agent', toPort: 'input' },
      { id: 'c2', fromNodeId: 'agent', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
    ],
  }) as Json;

async function start(harnessed: Harnessed, agent: Record<string, unknown> = {}): Promise<string> {
  const workflowId = await publish(harnessed, agentWorkflow(agent));
  const response = harnessed.engine.startRun({ workflowId });
  return (response.body as { run: { id: string } }).run.id;
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
    const output = run.executions[2]!.output as {
      data: unknown;
      references: { agentSession?: { kind: string } };
    };
    assert.deepEqual(output.data, { count: 3 });
    assert.equal(output.references.agentSession?.kind, 'agent_session');
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

test('a provider failure fails the node with its cause instead of spending corrections', async () => {
  const harnessed = await engineFor((turn) => {
    turn.status = 'ended';
    turn.outcome = 'failed';
    turn.failure = {
      code: 'PROVIDER_AUTH',
      message: 'The model provider rejected its credential.',
    };
  });
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'FAILED');
    assert.equal(run.invocations.length, 1, 'no correction prompt is sent');
    assert.deepEqual(
      { code: run.executions[1]!.error?.code, category: run.executions[1]!.error?.category },
      { code: 'PROVIDER_AUTH', category: 'external' },
    );
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
      () =>
        repository.completeExecution(stale!, {
          kind: 'completed',
          output: { data: {}, references: { artifacts: [] }, context: { handoffs: [] } },
          port: 'success',
        }),
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
    assert.throws(() => harnessed.engine.startRun({}), { code: 'INVALID_REQUEST' });
    assert.throws(() => harnessed.engine.startRun({ workflowId: 'missing' }), {
      code: 'NOT_FOUND',
    });
    const draftOnly = harnessed.definitions.createWorkflow({
      projectId: harnessed.definitions.addProject({
        name: 'repo',
        repositoryPath: harnessed.repository,
        baseRef: 'main',
      }).id,
      name: 'draft only',
      draft: normalizeDocument(agentWorkflow()) as Json,
    }) as { id: string };
    assert.throws(() => harnessed.engine.startRun({ workflowId: draftOnly.id }), {
      code: 'WORKFLOW_UNPUBLISHED',
    });
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

const connect = (id: string, from: string, to: string, port = 'success') => ({
  id,
  fromNodeId: from,
  fromPort: port,
  toNodeId: to,
  toPort: 'input',
});

// The start response is the stored creation receipt; inline nodes have run by the time it returns.
const startNow = (harnessed: Harnessed, workflowId: string, extra: Record<string, unknown> = {}) =>
  view(
    harnessed,
    (harnessed.engine.startRun({ workflowId, ...extra }).body as { run: RunView }).run.id,
  );

test('transform nodes publish data built from every binding source', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflowId = await publish(harnessed, {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        {
          id: 'greet',
          type: 'transform',
          config: {
            data: {
              message: { $binding: 'name' },
              first: { $binding: 'first' },
              repo: { $binding: 'repo' },
              constant: { $binding: 'constant' },
            },
          },
          bindings: {
            name: { kind: 'trigger', path: ['name'] },
            first: { kind: 'input', path: ['data', 'items', '0'] },
            repo: { kind: 'project', path: ['repositoryPath'] },
            constant: { kind: 'literal', value: 7 },
          },
        },
        {
          id: 'echo',
          type: 'transform',
          config: { data: { echo: { $binding: 'earlier' } } },
          bindings: {
            earlier: {
              kind: 'node',
              nodeId: 'greet',
              execution: 'latest',
              path: ['data', 'message'],
            },
          },
        },
        { id: 'end', type: 'end' },
      ],
      connections: [
        connect('c1', 'start', 'greet'),
        connect('c2', 'greet', 'echo'),
        connect('c3', 'echo', 'end'),
      ],
    } as Json);
    const run = startNow(harnessed, workflowId, { input: { name: 'Ada', items: [42] } });
    assert.equal(run.state, 'COMPLETED', 'inline nodes finish before the start command returns');
    assert.deepEqual(run.outcome, { data: { echo: 'Ada' } });
    assert.deepEqual((run.executions[1]!.output as { data: unknown }).data, {
      message: 'Ada',
      first: 42,
      repo: harnessed.repository,
      constant: 7,
    });
    assert.deepEqual(
      run.executions.map((execution) => [execution.node, execution.state]),
      [
        ['start', 'COMPLETED'],
        ['greet', 'COMPLETED'],
        ['echo', 'COMPLETED'],
        ['end', 'COMPLETED'],
      ],
    );
  } finally {
    await harnessed.close();
  }
});

test('a selected port without a connection completes the run as a leaf', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflowId = await publish(harnessed, {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        { id: 'only', type: 'transform', config: { data: { done: true } } },
      ],
      connections: [connect('c1', 'start', 'only')],
    } as Json);
    const run = startNow(harnessed, workflowId);
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.outcome, { data: { done: true } });
  } finally {
    await harnessed.close();
  }
});

test('an End node can declare a failed outcome with a reason', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflowId = await publish(harnessed, {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        { id: 'end', type: 'end', config: { outcome: 'FAILED', reason: 'Nothing to do.' } },
      ],
      connections: [connect('c1', 'start', 'end')],
    } as Json);
    const run = startNow(harnessed, workflowId, { input: { x: 1 } });
    assert.equal(run.state, 'FAILED');
    assert.deepEqual(run.outcome, { data: { x: 1 }, reason: 'Nothing to do.' });
  } finally {
    await harnessed.close();
  }
});

test('a missing binding fails the node, and an error connection routes the failure', async () => {
  const harnessed = await engineFor(() => {});
  const document = (handled: boolean) =>
    ({
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        {
          id: 'pick',
          type: 'transform',
          config: { data: { $binding: 'missing' } },
          bindings: { missing: { kind: 'trigger', path: ['absent'] } },
        },
        {
          id: 'recover',
          type: 'transform',
          config: { data: { recovered: { $binding: 'code' } } },
          bindings: { code: { kind: 'input', path: ['data', 'error', 'code'] } },
        },
      ],
      connections: [
        connect('c1', 'start', 'pick'),
        ...(handled ? [connect('c2', 'pick', 'recover', 'error')] : []),
      ],
    }) as Json;
  try {
    const unhandled = startNow(harnessed, await publish(harnessed, document(false)));
    assert.equal(unhandled.state, 'FAILED');
    assert.equal((unhandled.outcome as { code: string }).code, 'BINDING_MISSING');
    const handled = startNow(harnessed, await publish(harnessed, document(true)));
    assert.equal(handled.state, 'COMPLETED');
    assert.deepEqual(handled.outcome, { data: { recovered: 'BINDING_MISSING' } });
    assert.equal(handled.executions[1]!.state, 'FAILED', 'the failed execution stays in history');
    assert.equal(handled.executions[1]!.error?.category, 'input');
  } finally {
    await harnessed.close();
  }
});

test('an agent blocker can be routed through its error connection', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    await fake.submitResult(turn, {
      status: 'blocked',
      blocker: { code: 'MISSING_INPUT', message: 'No spec.' },
    });
    turn.status = 'ended';
  });
  try {
    const document = agentWorkflow() as { nodes: Json[]; connections: Json[] };
    document.nodes.push({
      id: 'triage',
      type: 'transform',
      config: { data: { blocked: { $binding: 'code' } } },
      bindings: { code: { kind: 'input', path: ['data', 'error', 'code'] } },
    } as Json);
    document.connections.push(connect('c3', 'agent', 'triage', 'error') as Json);
    const workflowId = await publish(harnessed, document as unknown as Json);
    const run = await settled(harnessed, startNow(harnessed, workflowId).id);
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.outcome, { data: { blocked: 'MISSING_INPUT' } });
  } finally {
    await harnessed.close();
  }
});

test('a loop stops for an owner decision at its execution limit', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflowId = await publish(harnessed, {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        {
          id: 'again',
          type: 'transform',
          limits: { maxExecutionsPerRun: 3 },
          config: { data: { previous: { $binding: 'previous' } } },
          bindings: {
            previous: {
              kind: 'node',
              nodeId: 'again',
              execution: 'latest',
              path: ['data'],
              optional: true,
              fallback: 'none',
            },
          },
        },
      ],
      connections: [connect('c1', 'start', 'again'), connect('c2', 'again', 'again')],
    } as Json);
    const run = startNow(harnessed, workflowId);
    assert.equal(run.state, 'NEEDS_HUMAN');
    assert.equal(run.attention?.code, 'EXECUTION_LIMIT');
    const passes = run.executions.filter((execution) => execution.node === 'again');
    assert.deepEqual(
      passes.map((execution) => (execution.output as { data: unknown }).data),
      [
        { previous: 'none' },
        { previous: { previous: 'none' } },
        { previous: { previous: { previous: 'none' } } },
      ],
      '`latest` reads the previous pass; the first pass uses the fallback',
    );
  } finally {
    await harnessed.close();
  }
});

test('a repeated start command returns the same run', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflowId = await publish(harnessed, {
      nodes: [{ id: 'start', type: 'manual_trigger' }],
      connections: [],
    } as Json);
    const first = startNow(harnessed, workflowId, {
      commandId: 'start-command-1',
      input: { a: 1 },
    });
    const again = startNow(harnessed, workflowId, {
      commandId: 'start-command-1',
      input: { a: 1 },
    });
    assert.equal(again.id, first.id);
    assert.equal((harnessed.engine.repository.runs() as unknown[]).length, 1);
    assert.throws(
      () =>
        harnessed.engine.startRun({ workflowId, commandId: 'start-command-1', input: { a: 2 } }),
      { code: 'COMMAND_CONFLICT' },
    );
  } finally {
    await harnessed.close();
  }
});

test('runs keep the version they started with after a new version is published', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const document = (value: string) =>
      ({
        nodes: [
          { id: 'start', type: 'manual_trigger' },
          { id: 'value', type: 'transform', config: { data: value } },
        ],
        connections: [connect('c1', 'start', 'value')],
      }) as Json;
    const workflowId = await publish(harnessed, document('v1'));
    const first = startNow(harnessed, workflowId);
    const workflow = harnessed.definitions.workflow(workflowId) as { draftRevision: number };
    harnessed.definitions.saveDraft(
      workflowId,
      workflow.draftRevision,
      normalizeDocument(document('v2')) as Json,
    );
    harnessed.definitions.publish(workflowId);
    const second = startNow(harnessed, workflowId);
    const stored = view(harnessed, first.id) as RunView & { versionNumber: number };
    assert.equal(stored.versionNumber, 1);
    assert.deepEqual(stored.outcome, { data: 'v1' });
    assert.equal((second as RunView & { versionNumber: number }).versionNumber, 2);
    assert.deepEqual(second.outcome, { data: 'v2' });
  } finally {
    await harnessed.close();
  }
});

test('trigger input is validated against the trigger schema and rendered into the goal', async () => {
  const harnessed = await engineFor(complete({ count: 1 }));
  try {
    const document = agentWorkflow({
      goal: 'Count the words in {{file}}.',
    }) as { nodes: Array<Record<string, unknown>> };
    document.nodes[0] = {
      id: 'start',
      type: 'manual_trigger',
      config: {
        inputSchema: {
          type: 'object',
          required: ['file'],
          properties: { file: { type: 'string' } },
        },
      },
    };
    document.nodes[1]!['bindings'] = { file: { kind: 'trigger', path: ['file'] } };
    const workflowId = await publish(harnessed, document as unknown as Json);
    assert.throws(() => harnessed.engine.startRun({ workflowId, input: { file: 3 } }), {
      code: 'INVALID_INPUT',
    });
    const run = await settled(
      harnessed,
      startNow(harnessed, workflowId, { input: { file: 'notes.txt' } }).id,
    );
    assert.equal(run.state, 'COMPLETED');
    assert.match([...harnessed.fake.turns.values()][0]!.prompt, /Count the words in notes\.txt\./);
  } finally {
    await harnessed.close();
  }
});

test('a run stored by the fixed-graph slice still finishes after the upgrade', async () => {
  const harnessed = await engineFor(complete({ count: 5 }));
  try {
    // The exact rows the previous release wrote: a legacy snapshot and a pending agent execution.
    const db = harnessed.store.db;
    const input = JSON.stringify({ data: { goal: 'Count the words.' } });
    db.prepare(
      "INSERT INTO runs (id, snapshot_json, state, revision, created_at) VALUES ('legacy', ?, 'RUNNING', 0, 1)",
    ).run(
      JSON.stringify({
        graph: { nodes: [], connections: [] },
        agent: {
          goal: 'Count the words.',
          cwd: harnessed.repository,
          model: { providerID: 'fake', id: 'model' },
          toolPolicy: { mode: 'read_only' },
          resultSchema: { type: 'object' },
          limits: { rejectedSubmissions: 3, corrections: 2, continuations: 2 },
        },
      }),
    );
    db.prepare(
      "INSERT INTO node_executions (id, run_id, node_id, sequence, input_json, state, output_json, revision) VALUES ('legacy-start', 'legacy', 'start', 1, ?, 'COMPLETED', ?, 0)",
    ).run(input, input);
    db.prepare(
      "INSERT INTO node_executions (id, run_id, node_id, sequence, predecessor_execution_id, input_json, state, revision) VALUES ('legacy-agent', 'legacy', 'agent', 2, 'legacy-start', ?, 'PENDING', 0)",
    ).run(input);
    const run = await eventually(() => {
      const current = view(harnessed, 'legacy');
      return current.state === 'RUNNING' ? undefined : current;
    }, 15_000);
    assert.equal(run.state, 'COMPLETED', JSON.stringify(run.outcome));
    assert.deepEqual(run.outcome, { data: { count: 5 } });
  } finally {
    await harnessed.close();
  }
});
