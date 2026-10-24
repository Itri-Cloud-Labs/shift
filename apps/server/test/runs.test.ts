import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
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
import { ShiftError } from '../src/domain/errors.js';
import { createLogger } from '../src/logging.js';
import { openStore, type Store } from '../src/persistence/store.js';
import type { Json } from '../src/harness/types.js';
import { CommandReceipts } from '../src/persistence/receipts.js';
import { RunEngine } from '../src/runs/engine.js';
import { normalizeDocument } from '../src/workflows/document.js';
import { DefinitionRepository } from '../src/workflows/repository.js';
import { StaleClaim } from '../src/runs/repository.js';
import { Workspaces } from '../src/workspaces/workspaces.js';
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
  // Session creations that fail as if the runtime could not start.
  failCreates = 0;
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
    if (this.failCreates > 0) {
      this.failCreates--;
      throw new ShiftError('HARNESS_START_FAILED', 'The harness runtime did not start.', 503);
    }
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
  // The engine's clock, which decides when wake-ups fall due.
  clock: FakeClock;
  close(): Promise<void>;
}

async function engineFor(
  behave: Behaviour,
  existing?: { state?: string; fake?: FakeHarness; clock?: FakeClock },
): Promise<Harnessed> {
  const state = existing?.state ?? (await temporaryState()).path;
  const repository = join(state, 'repo');
  if (!existing?.state) {
    await mkdir(repository, { recursive: true });
    await writeFile(join(repository, 'notes.txt'), 'alpha beta\n');
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repository, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  }
  const store = await openStore({ stateDirectory: state, clock: new FakeClock() });
  const workspaces = new Workspaces(store.db, new FakeClock(), join(state, 'workspaces'));
  const fake = existing?.fake ?? new FakeHarness(behave);
  fake.behave = behave;
  const definitions = new DefinitionRepository(store.db, new FakeClock());
  const clock = existing?.clock ?? new FakeClock();
  const engine = new RunEngine({
    store,
    definitions,
    receipts: new CommandReceipts(store.db, new FakeClock()),
    workspaces,
    clock,
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
    clock,
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
  wait: {
    kind: string;
    executionId: string;
    dueAt: number;
    attempt: number;
    error: { code: string; message: string };
  } | null;
  executions: Array<{
    id: string;
    node: string;
    state: string;
    output: unknown;
    error: { code?: string; category?: string } | null;
    attempts: Array<{ number: number; state: string; error: { code?: string } | null }>;
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
    // A retry backoff keeps going on its own; tests that need it advance the clock first.
    return run.state === 'RUNNING' || (run.state === 'WAITING' && run.wait?.kind === 'retry')
      ? undefined
      : run;
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

const agentWorkflow = (
  agent: Record<string, unknown> = {},
  node: Record<string, unknown> = {},
): Json =>
  ({
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      {
        ...node,
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

async function start(
  harnessed: Harnessed,
  agent: Record<string, unknown> = {},
  node: Record<string, unknown> = {},
): Promise<string> {
  const workflowId = await publish(harnessed, agentWorkflow(agent, node));
  const response = await harnessed.engine.startRun({ workflowId });
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

test('each run edits its own detached worktree at the commit admitted with it', async () => {
  const cwds: string[] = [];
  const harnessed = await engineFor(async (turn, fake) => {
    cwds.push(turn.handle.cwd);
    // The agent edits a tracked file and leaves an untracked one, as a real agent would.
    await writeFile(join(turn.handle.cwd, 'notes.txt'), `edited by ${turn.handle.cwd}\n`);
    await writeFile(join(turn.handle.cwd, 'new.txt'), 'new\n');
    await complete({ count: 1 })(turn, fake);
  });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    const workflowId = await publish(harnessed, agentWorkflow());
    const firstCommit = git(harnessed.repository, 'rev-parse', 'HEAD');
    const first = await settled(harnessed, (await startNow(harnessed, workflowId)).id);
    // A later commit to the base ref is seen by later runs only.
    await writeFile(join(harnessed.repository, 'later.txt'), 'later\n');
    git(harnessed.repository, 'add', '.');
    git(
      harnessed.repository,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-qm',
      'later',
    );
    const secondCommit = git(harnessed.repository, 'rev-parse', 'HEAD');
    const second = await settled(harnessed, (await startNow(harnessed, workflowId)).id);
    const runs = [first, second] as unknown as Array<{
      state: string;
      baseCommit: string;
      workspace: { id: string; path: string; state: string };
    }>;
    assert.deepEqual(
      runs.map((run) => [run.state, run.baseCommit, run.workspace.state]),
      [
        ['COMPLETED', firstCommit, 'READY'],
        ['COMPLETED', secondCommit, 'READY'],
      ],
    );
    assert.deepEqual(
      cwds,
      runs.map((run) => run.workspace.path),
    );
    assert.notEqual(runs[0]!.workspace.path, runs[1]!.workspace.path);
    for (const run of runs) {
      assert.ok(run.workspace.path.startsWith(join(harnessed.state, 'workspaces')));
      assert.equal(git(run.workspace.path, 'rev-parse', 'HEAD'), run.baseCommit);
      assert.throws(() => git(run.workspace.path, 'symbolic-ref', '-q', 'HEAD'), 'detached');
      assert.match(await readFile(join(run.workspace.path, 'notes.txt'), 'utf8'), /edited by/);
    }
    assert.equal(existsSync(join(runs[0]!.workspace.path, 'later.txt')), false);
    // The project checkout is exactly as the owner left it.
    assert.equal(await readFile(join(harnessed.repository, 'notes.txt'), 'utf8'), 'alpha beta\n');
    assert.equal(git(harnessed.repository, 'status', '--porcelain'), '');
    assert.equal(git(harnessed.repository, 'symbolic-ref', '--short', 'HEAD'), 'main');
  } finally {
    await harnessed.close();
  }
});

test('a run whose worktree cannot be created fails without prompting the agent', async () => {
  const harnessed = await engineFor(complete({ count: 1 }));
  try {
    const workflowId = await publish(harnessed, agentWorkflow());
    // A file where the workspace root belongs makes every worktree creation fail.
    await writeFile(join(harnessed.state, 'workspaces'), '');
    const run = await settled(harnessed, (await startNow(harnessed, workflowId)).id);
    assert.equal(run.state, 'FAILED');
    assert.deepEqual(
      { code: run.executions[1]!.error?.code, category: run.executions[1]!.error?.category },
      { code: 'WORKSPACE_UNAVAILABLE', category: 'external' },
    );
    assert.equal(harnessed.fake.submits.length, 0, 'no prompt was sent');
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
    await assert.rejects(harnessed.engine.startRun({}), { code: 'INVALID_REQUEST' });
    await assert.rejects(harnessed.engine.startRun({ workflowId: 'missing' }), {
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
    await assert.rejects(harnessed.engine.startRun({ workflowId: draftOnly.id }), {
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
const startNow = async (
  harnessed: Harnessed,
  workflowId: string,
  extra: Record<string, unknown> = {},
) =>
  view(
    harnessed,
    ((await harnessed.engine.startRun({ workflowId, ...extra })).body as { run: RunView }).run.id,
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
    const run = await startNow(harnessed, workflowId, { input: { name: 'Ada', items: [42] } });
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
    const run = await startNow(harnessed, workflowId);
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
    const run = await startNow(harnessed, workflowId, { input: { x: 1 } });
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
    const unhandled = await startNow(harnessed, await publish(harnessed, document(false)));
    assert.equal(unhandled.state, 'FAILED');
    assert.equal((unhandled.outcome as { code: string }).code, 'BINDING_MISSING');
    const handled = await startNow(harnessed, await publish(harnessed, document(true)));
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
    const run = await settled(harnessed, (await startNow(harnessed, workflowId)).id);
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
    const run = await startNow(harnessed, workflowId);
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
    const first = await startNow(harnessed, workflowId, {
      commandId: 'start-command-1',
      input: { a: 1 },
    });
    const again = await startNow(harnessed, workflowId, {
      commandId: 'start-command-1',
      input: { a: 1 },
    });
    assert.equal(again.id, first.id);
    assert.equal((harnessed.engine.repository.runs() as unknown[]).length, 1);
    await assert.rejects(
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
    const first = await startNow(harnessed, workflowId);
    const workflow = harnessed.definitions.workflow(workflowId) as { draftRevision: number };
    harnessed.definitions.saveDraft(
      workflowId,
      workflow.draftRevision,
      normalizeDocument(document('v2')) as Json,
    );
    harnessed.definitions.publish(workflowId);
    const second = await startNow(harnessed, workflowId);
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
    await assert.rejects(harnessed.engine.startRun({ workflowId, input: { file: 3 } }), {
      code: 'INVALID_INPUT',
    });
    const run = await settled(
      harnessed,
      (await startNow(harnessed, workflowId, { input: { file: 'notes.txt' } })).id,
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

// ---- Owner controls ----

const control = (
  harnessed: Harnessed,
  id: string,
  kind: 'cancel' | 'retry' | 'fail' | 'complete' | 'extend',
  body: Record<string, unknown> = {},
) => (harnessed.engine.controlRun(id, kind, body).body as { run: RunView }).run;

type ControlledRun = RunView & {
  cancelRequested: boolean;
  controls: Array<{ kind: string; executionId: string | null; payload: unknown }>;
  workspace: { id: string } | null;
};

const until = (harnessed: Harnessed, id: string, done: (run: ControlledRun) => boolean) =>
  eventually(() => {
    const run = view(harnessed, id) as ControlledRun;
    return done(run) ? run : undefined;
  });

// The first turn stops without evidence of its effects; any later turn completes.
const uncertainThenComplete = (): Behaviour => {
  let turns = 0;
  return async (turn, fake) => {
    if (++turns === 1) turn.status = 'unknown';
    else await complete({ count: 7 })(turn, fake);
  };
};

test('retry reopens a stuck agent step in its session and says earlier effects are unknown', async () => {
  const harnessed = await engineFor(uncertainThenComplete());
  try {
    const id = await start(harnessed);
    const stuck = await settled(harnessed, id);
    assert.equal(stuck.attention?.code, 'HARNESS_OUTCOME_UNKNOWN');
    await assert.rejects(async () => control(harnessed, id, 'extend', { executions: 1 }), {
      code: 'NOTHING_TO_EXTEND',
    });
    const resumed = control(harnessed, id, 'retry', { commandId: 'retry-command-1' });
    assert.equal(resumed.state, 'RUNNING');
    const run = (await settled(harnessed, id)) as ControlledRun;
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.outcome, { data: { count: 7 } });
    assert.deepEqual(
      run.invocations.map((invocation) => [invocation.kind, invocation.state]),
      [
        ['goal', 'UNKNOWN'],
        ['continuation', 'COMPLETED'],
      ],
      'the uncertain invocation stays in history',
    );
    const [first, second] = [...harnessed.fake.turns.values()];
    assert.equal(second!.handle.harnessSessionId, first!.handle.harnessSessionId, 'same session');
    assert.match(second!.prompt, /what it changed is unknown/);
    assert.deepEqual(
      run.controls.map((entry) => [entry.kind, entry.executionId]),
      [['retry', run.executions[1]!.id]],
    );
    const attempts = harnessed.store.db
      .prepare(
        'SELECT attempt_number, state FROM node_attempts WHERE execution_id = ? ORDER BY attempt_number',
      )
      .all(run.executions[1]!.id);
    assert.deepEqual(attempts, [
      { attempt_number: 1, state: 'INTERRUPTED' },
      { attempt_number: 2, state: 'COMPLETED' },
    ]);
    // Repeating the command answers from its receipt instead of acting again.
    assert.equal(
      control(harnessed, id, 'retry', { commandId: 'retry-command-1' }).state,
      'RUNNING',
    );
    await assert.rejects(async () => control(harnessed, id, 'retry'), {
      code: 'RUN_STATE_CONFLICT',
    });
  } finally {
    await harnessed.close();
  }
});

test('fail abandons a stuck step through its error connection or fails the run', async () => {
  for (const handled of [false, true]) {
    const harnessed = await engineFor((turn) => {
      turn.status = 'unknown';
    });
    try {
      const document = agentWorkflow() as unknown as {
        nodes: Array<Record<string, unknown>>;
        connections: Array<Record<string, unknown>>;
      };
      if (handled) {
        document.nodes.push({
          id: 'recover',
          type: 'end',
          config: { outcome: 'FAILED', reason: 'recovered' },
        });
        document.connections.push({
          id: 'c-error',
          fromNodeId: 'agent',
          fromPort: 'error',
          toNodeId: 'recover',
          toPort: 'input',
        });
      }
      const workflowId = await publish(harnessed, document as unknown as Json);
      const id = (await startNow(harnessed, workflowId)).id;
      await until(harnessed, id, (run) => run.state === 'NEEDS_HUMAN');
      control(harnessed, id, 'fail', { reason: 'Checked by hand: nothing happened.' });
      const run = view(harnessed, id) as ControlledRun;
      assert.equal(run.state, 'FAILED');
      const abandoned = run.executions.find((execution) => execution.node === 'agent')!;
      assert.deepEqual(abandoned.error, {
        code: 'ABANDONED',
        category: 'external',
        message: 'Checked by hand: nothing happened.',
      });
      if (handled) {
        assert.deepEqual(run.outcome, {
          data: {
            error: {
              code: 'ABANDONED',
              category: 'external',
              message: 'Checked by hand: nothing happened.',
            },
          },
          reason: 'recovered',
        });
      } else {
        assert.equal((run.outcome as { code: string }).code, 'ABANDONED');
      }
      assert.equal(harnessed.fake.submits.length, 1, 'no prompt is sent');
    } finally {
      await harnessed.close();
    }
  }
});

test('complete records an owner result that satisfies the step contract', async () => {
  const harnessed = await engineFor((turn) => {
    turn.status = 'unknown';
  });
  try {
    const id = await start(harnessed, {
      resultSchema: {
        type: 'object',
        required: ['count'],
        properties: { count: { type: 'integer' } },
      },
    });
    await until(harnessed, id, (run) => run.state === 'NEEDS_HUMAN');
    await assert.rejects(async () => control(harnessed, id, 'complete', { data: { count: 'x' } }), {
      code: 'INVALID_RESULT',
    });
    assert.equal(view(harnessed, id).state, 'NEEDS_HUMAN', 'a refused result changes nothing');
    control(harnessed, id, 'complete', { data: { count: 5 } });
    const run = view(harnessed, id) as ControlledRun;
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.outcome, { data: { count: 5 } });
    const output = run.executions[1]!.output as { references: { agentSession?: unknown } };
    assert.ok(output.references.agentSession, 'the step keeps its session reference');
    assert.deepEqual(
      run.controls.map((entry) => [entry.kind, entry.payload]),
      [['complete', { data: { count: 5 } }]],
      'the result is recorded as the owner’s',
    );
    assert.equal(run.invocations[0]!.state, 'UNKNOWN');
  } finally {
    await harnessed.close();
  }
});

test('extend raises the limit that stopped a loop and takes the step it held', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflowId = await publish(harnessed, {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        {
          id: 'again',
          type: 'transform',
          limits: { maxExecutionsPerRun: 2 },
          config: { data: { n: 1 } },
        },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'again', toPort: 'input' },
        { id: 'c2', fromNodeId: 'again', fromPort: 'success', toNodeId: 'again', toPort: 'input' },
      ],
    } as Json);
    const id = (await startNow(harnessed, workflowId)).id;
    const passes = (run: RunView) => run.executions.filter((e) => e.node === 'again').length;
    assert.equal(passes(view(harnessed, id)), 2);
    await assert.rejects(async () => control(harnessed, id, 'retry'), { code: 'NOTHING_TO_RETRY' });
    assert.equal(control(harnessed, id, 'extend', { executions: 3 }).state, 'RUNNING');
    const extended = view(harnessed, id) as ControlledRun;
    assert.equal(extended.state, 'NEEDS_HUMAN', 'the loop runs until the raised limit');
    assert.equal(passes(extended), 5);
    assert.match(
      (extended.attention as unknown as { explanation: string }).explanation,
      /limit of 5 executions/,
    );
    assert.deepEqual(extended.controls.at(-1)!.payload, {
      scope: 'node',
      nodeId: 'again',
      from: 2,
      to: 5,
    });
    control(harnessed, id, 'fail');
    assert.equal(view(harnessed, id).state, 'FAILED');
  } finally {
    await harnessed.close();
  }
});

test('cancel stops a running agent through the harness and releases the workspace', async () => {
  const harnessed = await engineFor((turn) => {
    turn.status = 'running';
  });
  try {
    const id = await start(harnessed);
    await until(harnessed, id, (run) => run.invocations[0]?.state === 'RUNNING');
    const requested = control(harnessed, id, 'cancel', {
      reason: 'Not needed any more.',
      commandId: 'cancel-command-1',
    });
    assert.ok(['CANCEL_REQUESTED', 'CANCELLED'].includes(requested.state));
    const run = await until(harnessed, id, (candidate) => candidate.state === 'CANCELLED');
    assert.deepEqual(run.outcome, { cancelled: true, reason: 'Not needed any more.' });
    assert.ok(harnessed.fake.cancels >= 1);
    assert.equal(run.invocations[0]!.state, 'INTERRUPTED');
    assert.deepEqual(
      run.executions.map((execution) => execution.state),
      ['COMPLETED', 'CANCELLED'],
    );
    const workspace = harnessed.store.db
      .prepare('SELECT id FROM workspaces WHERE created_by_run_id = ?')
      .get(id) as { id: string };
    assert.equal(
      new Workspaces(harnessed.store.db, new FakeClock(), join(harnessed.state, 'workspaces')).get(
        workspace.id,
      ).claimed,
      false,
    );
    assert.equal(
      control(harnessed, id, 'cancel').state,
      'CANCELLED',
      'cancelling again is a no-op',
    );
    await assert.rejects(async () => control(harnessed, id, 'retry'), {
      code: 'RUN_STATE_CONFLICT',
    });
  } finally {
    await harnessed.close();
  }
});

test('a cancellation whose stop is unconfirmed waits for the owner to cancel again', async () => {
  const harnessed = await engineFor((turn) => {
    turn.status = 'running';
  });
  try {
    harnessed.fake.confirmCancel = false;
    const id = await start(harnessed);
    await until(harnessed, id, (run) => run.invocations[0]?.state === 'RUNNING');
    control(harnessed, id, 'cancel');
    const waiting = await until(harnessed, id, (run) => run.state === 'NEEDS_HUMAN');
    assert.equal(waiting.cancelRequested, true);
    assert.ok(['CANCEL_UNCONFIRMED', 'HARNESS_STOP_UNCONFIRMED'].includes(waiting.attention!.code));
    for (const kind of ['retry', 'fail'] as const) {
      await assert.rejects(async () => control(harnessed, id, kind), {
        code: 'RUN_CANCEL_REQUESTED',
      });
    }
    const run = control(harnessed, id, 'cancel');
    assert.equal(run.state, 'CANCELLED');
  } finally {
    await harnessed.close();
  }
});

test('a cancellation interrupted by a restart finishes on the next start', async () => {
  const first = await engineFor((turn) => {
    turn.status = 'running';
  });
  const id = await start(first);
  await until(first, id, (run) => run.invocations[0]?.state === 'RUNNING');
  // The request committed, then the process stopped before the agent was stopped.
  first.engine.repository.requestCancel(id, { kind: 'cli', id: 'local' }, undefined, undefined);
  await first.close();
  const second = await engineFor(() => {}, { state: first.state, fake: first.fake });
  try {
    const run = await until(second, id, (candidate) => candidate.state === 'CANCELLED');
    assert.deepEqual(run.outcome, { cancelled: true });
  } finally {
    await second.close();
  }
});

test('a finished turn that lands during cancellation does not move the run on', async () => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const harnessed = await engineFor(async (turn, fake) => {
    turn.status = 'running';
    await released;
    await complete({ count: 1 })(turn, fake);
  });
  try {
    const id = await start(harnessed);
    await until(harnessed, id, (run) => run.invocations[0]?.state === 'RUNNING');
    harnessed.engine.repository.requestCancel(
      id,
      { kind: 'cli', id: 'local' },
      undefined,
      undefined,
    );
    release();
    await eventually(() =>
      harnessed.fake.turns.size > 0 && [...harnessed.fake.turns.values()][0]!.status === 'ended'
        ? true
        : undefined,
    );
    await delay(100);
    const run = view(harnessed, id);
    assert.equal(run.state, 'CANCEL_REQUESTED');
    assert.equal(run.executions.length, 2, 'no successor was scheduled');
  } finally {
    await harnessed.close();
  }
});

test('control commands check the run state and their input', async () => {
  const harnessed = await engineFor(complete({ count: 1 }));
  try {
    const id = await start(harnessed);
    await settled(harnessed, id);
    await assert.rejects(async () => control(harnessed, 'missing', 'cancel'), {
      code: 'RUN_NOT_FOUND',
    });
    for (const kind of ['cancel', 'retry', 'fail', 'complete', 'extend'] as const) {
      const body = kind === 'complete' ? { data: {} } : kind === 'extend' ? { executions: 1 } : {};
      await assert.rejects(async () => control(harnessed, id, kind, body), {
        code: 'RUN_STATE_CONFLICT',
      });
    }
    await assert.rejects(async () => control(harnessed, id, 'extend', { executions: 0 }), {
      code: 'INVALID_REQUEST',
    });
    await assert.rejects(async () => control(harnessed, id, 'complete', {}), {
      code: 'INVALID_REQUEST',
    });
  } finally {
    await harnessed.close();
  }
});

// ---- Automatic retries (specification 6.6) ----

// Fails the first `failures` turns with a provider error, then completes.
const providerErrorsThenComplete = (failures: number, code = 'PROVIDER_ERROR'): Behaviour => {
  let turns = 0;
  return async (turn, fake) => {
    if (++turns <= failures) {
      turn.status = 'ended';
      turn.outcome = 'failed';
      turn.failure = { code: code as HarnessFailure['code'], message: 'The provider failed.' };
      return;
    }
    await complete({ count: 4 })(turn, fake);
  };
};

const retrying = (maxAttempts: number, initialDelayMs = 0, maxDelayMs = initialDelayMs) => ({
  retry: { maxAttempts, initialDelayMs, maxDelayMs },
});

const attemptsOf = (run: RunView) =>
  run.executions[1]!.attempts.map((attempt) => [attempt.state, attempt.error?.code ?? null]);

test('a provider error waits out its backoff, then retries in the same session', async () => {
  const harnessed = await engineFor(providerErrorsThenComplete(1));
  try {
    const startedAt = harnessed.clock.now();
    const id = await start(harnessed, {}, retrying(3, 10_000, 60_000));
    const waiting = await until(harnessed, id, (run) => run.state === 'WAITING');
    assert.equal(waiting.wait?.kind, 'retry');
    assert.equal(waiting.wait?.attempt, 2);
    assert.equal(waiting.wait?.error.code, 'PROVIDER_ERROR');
    assert.ok(
      waiting.wait!.dueAt >= startedAt + 5_000 && waiting.wait!.dueAt <= startedAt + 10_000,
      'the first delay is between half and all of the initial delay',
    );
    assert.deepEqual(attemptsOf(waiting), [['FAILED', 'PROVIDER_ERROR']]);
    assert.equal(waiting.executions[1]!.state, 'WAITING');
    await delay(50);
    assert.equal(harnessed.fake.turns.size, 1, 'nothing is sent before the wake-up is due');

    harnessed.clock.advance(10_000);
    const run = await settled(harnessed, id);
    assert.equal(run.state, 'COMPLETED');
    assert.equal(run.wait, null);
    assert.deepEqual(attemptsOf(run), [
      ['FAILED', 'PROVIDER_ERROR'],
      ['COMPLETED', null],
    ]);
    assert.deepEqual(
      run.invocations.map((invocation) => [invocation.kind, invocation.state]),
      [
        ['goal', 'FAILED'],
        ['continuation', 'COMPLETED'],
      ],
    );
    const [first, second] = [...harnessed.fake.turns.values()];
    assert.equal(second!.handle.harnessSessionId, first!.handle.harnessSessionId, 'same session');
    assert.equal(harnessed.fake.creates, 1);
    assert.match(second!.prompt, /failed before it finished \(PROVIDER_ERROR: /);
    assert.match(second!.prompt, /Task: Count the words\./, 'the frozen goal is sent again');
  } finally {
    await harnessed.close();
  }
});

test('retries stop at the attempt limit, and the last failure fails the run', async () => {
  const harnessed = await engineFor(providerErrorsThenComplete(10));
  try {
    const run = await settled(harnessed, await start(harnessed, {}, retrying(3)));
    assert.equal(run.state, 'FAILED');
    assert.deepEqual(attemptsOf(run), [
      ['FAILED', 'PROVIDER_ERROR'],
      ['FAILED', 'PROVIDER_ERROR'],
      ['FAILED', 'PROVIDER_ERROR'],
    ]);
    assert.equal(run.executions[1]!.error?.code, 'PROVIDER_ERROR');
    assert.equal(harnessed.fake.turns.size, 3);
  } finally {
    await harnessed.close();
  }
});

test('failures that would repeat are not retried automatically', async () => {
  const harnessed = await engineFor(providerErrorsThenComplete(10, 'PROVIDER_AUTH'));
  try {
    const run = await settled(harnessed, await start(harnessed, {}, retrying(3)));
    assert.equal(run.state, 'FAILED');
    assert.deepEqual(attemptsOf(run), [['FAILED', 'PROVIDER_AUTH']]);
    assert.equal(harnessed.fake.turns.size, 1);
  } finally {
    await harnessed.close();
  }
});

test('a harness that cannot start is retried before any prompt is sent', async () => {
  const harnessed = await engineFor(complete({ count: 2 }));
  harnessed.fake.failCreates = 1;
  try {
    const run = await settled(harnessed, await start(harnessed, {}, retrying(2)));
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(attemptsOf(run), [
      ['FAILED', 'HARNESS_START_FAILED'],
      ['COMPLETED', null],
    ]);
    assert.deepEqual(
      run.invocations.map((invocation) => invocation.kind),
      ['goal'],
      'the first prompt is the goal: no earlier attempt sent one',
    );
  } finally {
    await harnessed.close();
  }
});

test('a backoff survives a restart, and a wake-up due at startup fires once', async () => {
  const first = await engineFor(providerErrorsThenComplete(1));
  const id = await start(first, {}, retrying(3, 60_000));
  const waiting = await until(first, id, (run) => run.state === 'WAITING');
  await first.close();
  // The server comes back after the deadline passed.
  const clock = new FakeClock(waiting.wait!.dueAt + 1);
  const second = await engineFor(providerErrorsThenComplete(0), {
    state: first.state,
    fake: first.fake,
    clock,
  });
  try {
    const run = await settled(second, id);
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(attemptsOf(run), [
      ['FAILED', 'PROVIDER_ERROR'],
      ['COMPLETED', null],
    ]);
    assert.equal(second.fake.turns.size, 2, 'exactly one retry was sent');
    const wakeups = second.store.db.prepare('SELECT state FROM wakeups').all();
    assert.deepEqual(wakeups, [{ state: 'FIRED' }]);
  } finally {
    await second.close();
  }
});

test('cancelling during a backoff cancels the run and its wake-up', async () => {
  const harnessed = await engineFor(providerErrorsThenComplete(1));
  try {
    const id = await start(harnessed, {}, retrying(3, 60_000));
    await until(harnessed, id, (run) => run.state === 'WAITING');
    await assert.rejects(async () => control(harnessed, id, 'retry'), {
      code: 'RUN_STATE_CONFLICT',
    });
    const cancelled = control(harnessed, id, 'cancel', { reason: 'not needed' });
    assert.equal(cancelled.state, 'CANCELLED');
    assert.equal(cancelled.wait, null);
    harnessed.clock.advance(60_000);
    await delay(100);
    const run = view(harnessed, id);
    assert.equal(run.state, 'CANCELLED');
    assert.equal(run.executions[1]!.state, 'CANCELLED');
    assert.equal(harnessed.fake.turns.size, 1, 'the retry never ran');
    assert.deepEqual(harnessed.store.db.prepare('SELECT state FROM wakeups').all(), [
      { state: 'CANCELLED' },
    ]);
  } finally {
    await harnessed.close();
  }
});

// ---- Active execution time (specification 6.7) ----

type TimedRun = ControlledRun & {
  activeTime: { usedMs: number; limitMs: number };
  attention: { code: string; explanation: string; limit?: unknown } | null;
};

// Starts start -> agent -> end with a run active-time limit.
async function startLimited(
  harnessed: Harnessed,
  maxActiveMs: number,
  node: Record<string, unknown> = {},
): Promise<string> {
  const document = {
    ...(agentWorkflow({}, node) as Record<string, Json>),
    execution: { limits: { maxExecutions: 1000, maxActiveMs } },
  };
  const workflowId = await publish(harnessed, document as Json);
  return ((await harnessed.engine.startRun({ workflowId })).body as { run: { id: string } }).run.id;
}

test('only running attempts use active time; a retry backoff costs nothing', async () => {
  const clock = new FakeClock();
  let turns = 0;
  const harnessed = await engineFor(
    async (turn, fake) => {
      if (++turns === 1) {
        clock.advance(5_000);
        turn.status = 'ended';
        turn.outcome = 'failed';
        turn.failure = { code: 'PROVIDER_ERROR', message: 'The provider failed.' };
        return;
      }
      clock.advance(3_000);
      await complete({ count: 1 })(turn, fake);
    },
    { clock },
  );
  try {
    const id = await start(harnessed, {}, retrying(2, 60_000));
    await until(harnessed, id, (run) => run.state === 'WAITING');
    clock.advance(60_000);
    const run = (await settled(harnessed, id)) as TimedRun;
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.activeTime, { usedMs: 8_000, limitMs: 4 * 60 * 60 * 1000 });
  } finally {
    await harnessed.close();
  }
});

test('a run out of active time stops before its next step until the owner extends it', async () => {
  const clock = new FakeClock();
  const harnessed = await engineFor(
    async (turn, fake) => {
      clock.advance(6_000);
      await complete({ count: 1 })(turn, fake);
    },
    { clock },
  );
  try {
    const id = await startLimited(harnessed, 5_000);
    const stopped = (await settled(harnessed, id)) as TimedRun;
    assert.equal(stopped.state, 'NEEDS_HUMAN');
    assert.equal(stopped.attention?.code, 'ACTIVE_TIME_LIMIT');
    assert.equal(stopped.executions.length, 2, 'the end node was not activated');
    await assert.rejects(async () => control(harnessed, id, 'extend', { executions: 1 }), {
      code: 'NOTHING_TO_EXTEND',
    });
    control(harnessed, id, 'extend', { activeMs: 60_000 });
    const run = (await settled(harnessed, id)) as TimedRun;
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.activeTime, { usedMs: 6_000, limitMs: 66_000 });
    assert.deepEqual(
      run.controls.map((entry) => entry.payload),
      [{ scope: 'active', from: 5_000, to: 66_000 }],
      'the extension starts from the time already used',
    );
  } finally {
    await harnessed.close();
  }
});

test('a running agent that uses up the active time is stopped and waits for the owner', async () => {
  const clock = new FakeClock();
  let turns = 0;
  const harnessed = await engineFor(
    async (turn, fake) => {
      if (++turns === 1) {
        turn.status = 'running';
        return;
      }
      await complete({ count: 2 })(turn, fake);
    },
    { clock },
  );
  try {
    const id = await startLimited(harnessed, 5_000);
    await until(harnessed, id, (run) => run.invocations[0]?.state === 'RUNNING');
    clock.advance(10_000);
    const stopped = (await until(harnessed, id, (run) => run.state === 'NEEDS_HUMAN')) as TimedRun;
    assert.equal(stopped.attention?.code, 'ACTIVE_TIME_LIMIT');
    assert.match(stopped.attention!.explanation, /its agent was stopped/);
    assert.ok(harnessed.fake.cancels >= 1, 'the turn was stopped through the harness');
    assert.equal(stopped.invocations[0]!.state, 'INTERRUPTED');
    assert.equal(stopped.activeTime.usedMs, 10_000);

    control(harnessed, id, 'extend', { activeMs: 60_000 });
    const run = (await settled(harnessed, id)) as TimedRun;
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(attemptsOf(run), [
      ['INTERRUPTED', null],
      ['COMPLETED', null],
    ]);
    const [first, second] = [...harnessed.fake.turns.values()];
    assert.equal(second!.handle.harnessSessionId, first!.handle.harnessSessionId, 'same session');
  } finally {
    await harnessed.close();
  }
});

test('after a restart, time a running attempt cannot account for is charged and explained', async () => {
  const first = await engineFor((turn) => {
    turn.status = 'running';
  });
  const id = await start(first);
  await until(first, id, (run) => run.invocations[0]?.state === 'RUNNING');
  await first.close();
  const second = await engineFor(complete({ count: 3 }), {
    state: first.state,
    fake: first.fake,
    clock: new FakeClock(first.clock.now() + 120_000),
  });
  try {
    const run = (await settled(second, id)) as TimedRun;
    assert.equal(run.state, 'COMPLETED');
    assert.equal(run.activeTime.usedMs, 120_000);
    const charged = second.store.db
      .prepare("SELECT payload_json FROM events WHERE type = 'run.active_time_charged'")
      .all() as Array<{ payload_json: string }>;
    assert.equal(charged.length, 1);
    const payload = JSON.parse(charged[0]!.payload_json) as {
      chargedMs: number;
      explanation: string;
    };
    assert.equal(payload.chargedMs, 120_000);
    assert.match(payload.explanation, /charged in full/);
  } finally {
    await second.close();
  }
});
