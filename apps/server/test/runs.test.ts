import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
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
  artifactDirectory: string;
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
  // Each turn writes both default reports first, as Shift's prompt asks, unless switched off.
  writeReports = true;
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
        artifactDirectory: request.artifactDirectory,
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
    if (this.writeReports && request.artifactDirectory) {
      await writeFile(join(request.artifactDirectory, 'tothenextagent.md'), 'Handoff.\n');
      await writeFile(join(request.artifactDirectory, 'toahumanreader.md'), 'Report.\n');
    }
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
    // Backoffs and timers end on their own; tests that need them advance the clock first.
    return run.state === 'RUNNING' ||
      (run.state === 'WAITING' && ['retry', 'timer'].includes(run.wait?.kind ?? ''))
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

type Artifact = {
  id: string;
  role: string;
  filename: string;
  sha256: string;
  invocationId: string;
};

const report = (turn: Turn, name: string, text: string) =>
  writeFile(join(turn.artifactDirectory, name), text);

test('reports are stored per invocation, and the successful turn’s become the node’s', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    const correction = /ended without a result/.test(turn.prompt);
    await report(turn, 'toahumanreader.md', correction ? '# Counted\n' : '# Draft\n');
    await report(turn, 'tothenextagent.md', correction ? 'Count is 3.' : 'Unsure.');
    if (correction) await complete({ count: 3 })(turn, fake);
    else turn.status = 'ended';
  });
  try {
    const runId = await start(harnessed);
    const run = await settled(harnessed, runId);
    assert.equal(run.state, 'COMPLETED');
    const artifacts = harnessed.engine.repository.artifacts({ runId }) as unknown as Artifact[];
    assert.deepEqual(
      artifacts.map((artifact) => [artifact.role, artifact.filename]),
      [
        ['handoff', 'tothenextagent.md'],
        ['human_report', 'toahumanreader.md'],
        ['handoff', 'tothenextagent.md'],
        ['human_report', 'toahumanreader.md'],
      ],
    );
    // Same names, different invocations: distinct artifacts with their own bytes.
    assert.notEqual(artifacts[0]!.invocationId, artifacts[2]!.invocationId);
    assert.notEqual(artifacts[1]!.sha256, artifacts[3]!.sha256);
    const output = run.executions[1]!.output as {
      references: { artifacts: Array<{ id: string }> };
    };
    assert.deepEqual(
      output.references.artifacts.map((artifact) => artifact.id),
      [artifacts[2]!.id, artifacts[3]!.id],
    );
    const stream = await harnessed.engine.blobs.read(
      harnessed.engine.repository.artifact(artifacts[3]!.id).storageKey,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk as Buffer);
    assert.equal(Buffer.concat(chunks).toString(), '# Counted\n');
    assert.equal(
      harnessed.store.db
        .prepare(
          "SELECT count(*) AS n FROM events WHERE type = 'artifact.published' AND run_id = ?",
        )
        .get(runId)!['n' as never],
      4,
    );
  } finally {
    await harnessed.close();
  }
});

test('a report that is a link is refused, never published, and counts as missing', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    await symlink('/etc/hostname', join(turn.artifactDirectory, 'toahumanreader.md'));
    await complete({ count: 3 })(turn, fake);
  });
  harnessed.fake.writeReports = false;
  try {
    const runId = await start(harnessed, { reports: { handoff: 'off' } });
    const run = await settled(harnessed, runId);
    assert.equal(run.state, 'FAILED');
    assert.equal(run.executions[1]!.error?.code, 'REPORTS_MISSING');
    assert.equal(run.invocations.length, 3);
    assert.deepEqual(harnessed.engine.repository.artifacts({ runId }), []);
  } finally {
    await harnessed.close();
  }
});

test('a report stored but not published before a crash is published once after restart', async () => {
  let reached!: () => void;
  const stored = new Promise<void>((resolve) => (reached = resolve));
  const first = await engineFor(async (turn, fake) => {
    await report(turn, 'toahumanreader.md', '# Counted\n');
    await complete({ count: 3 })(turn, fake);
  });
  first.fake.writeReports = false;
  // The process dies after the blob is renamed and before the row is written.
  first.engine.repository.publishArtifact = () => {
    reached();
    throw new StaleClaim();
  };
  const runId = await start(first, { reports: { handoff: 'off' } });
  await stored;
  void first.engine.stop(5_000);
  first.store.close();
  const blobs = join(first.state, 'blobs', 'sha256');
  const [prefix] = await readdir(blobs);
  assert.equal((await readdir(join(blobs, prefix!))).length, 1, 'an unreferenced blob');
  const restarted = await engineFor(() => {}, { state: first.state, fake: first.fake });
  try {
    const run = await settled(restarted, runId);
    assert.equal(run.state, 'COMPLETED');
    const artifacts = restarted.engine.repository.artifacts({ runId }) as unknown as Artifact[];
    assert.equal(artifacts.length, 1);
    assert.equal(
      restarted.engine.repository.artifact(artifacts[0]!.id).storageKey.split('/').at(-1),
      artifacts[0]!.sha256,
    );
    assert.equal((await readdir(join(blobs, prefix!))).length, 1, 'still one blob');
    assert.deepEqual(first.fake.submits.length, 1, 'nothing was resubmitted');
  } finally {
    await restarted.close();
  }
});

test('a completed result without a required report gets a correction that writes it', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    if (/required reports were missing/.test(turn.prompt)) {
      await report(turn, 'tothenextagent.md', 'Now with a handoff.');
      await report(turn, 'toahumanreader.md', 'Report.');
    } else await report(turn, 'toahumanreader.md', 'Report only.');
    await complete({ count: 3 })(turn, fake);
  });
  harnessed.fake.writeReports = false;
  try {
    const runId = await start(harnessed);
    const run = await settled(harnessed, runId);
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(
      run.invocations.map((invocation) => [invocation.kind, invocation.state]),
      [
        ['goal', 'COMPLETED'],
        ['correction', 'COMPLETED'],
      ],
    );
    const correction = [...harnessed.fake.turns.values()][1]!;
    assert.match(correction.prompt, /missing or unreadable: tothenextagent\.md\./);
    assert.match(
      correction.prompt,
      new RegExp(`write these Markdown files in ${correction.artifactDirectory}`),
    );
    const output = run.executions[1]!.output as {
      context: { handoffs: Array<{ id: string; kind: string; role: string }> };
    };
    const [handoff] = output.context.handoffs;
    assert.equal(handoff?.kind, 'artifact');
    assert.equal(handoff?.role, 'handoff');
    // The first turn's human report stays in history, apart from the node's.
    assert.equal(harnessed.engine.repository.artifacts({ runId }).length, 3);
  } finally {
    await harnessed.close();
  }
});

test('a blocker needs no reports and keeps its own cause', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    await fake.submitResult(turn, {
      status: 'blocked',
      blocker: { code: 'NEED_KEY', message: 'No API key.' },
    });
    turn.status = 'ended';
  });
  harnessed.fake.writeReports = false;
  try {
    const run = await settled(harnessed, await start(harnessed));
    assert.equal(run.state, 'FAILED');
    assert.equal(run.executions[1]!.error?.code, 'NEED_KEY');
    assert.equal(run.invocations.length, 1, 'no correction for missing reports');
    assert.match(
      [...harnessed.fake.turns.values()][0]!.prompt,
      /A blocked or failed result needs no reports\./,
    );
  } finally {
    await harnessed.close();
  }
});

test('reports switched off are not asked for or required', async () => {
  const harnessed = await engineFor(complete({ count: 3 }));
  harnessed.fake.writeReports = false;
  try {
    const run = await settled(
      harnessed,
      await start(harnessed, { reports: { handoff: 'off', humanReport: 'off' } }),
    );
    assert.equal(run.state, 'COMPLETED');
    assert.doesNotMatch(
      [...harnessed.fake.turns.values()][0]!.prompt,
      /tothenextagent|toahumanreader/,
    );
    const output = run.executions[1]!.output as { context: { handoffs: unknown[] } };
    assert.deepEqual(output.context.handoffs, [], 'no imaginary handoff');
  } finally {
    await harnessed.close();
  }
});

// write -> shape (a Transform) -> review, then audit that names `write` and takes nothing incoming.
const handoffWorkflow = (review: Record<string, unknown>, audit: Record<string, unknown>): Json =>
  ({
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      { id: 'write', type: 'agent', config: { goal: 'Write it. [write]' } },
      { id: 'shape', type: 'transform', config: { data: { shaped: true } } },
      { id: 'review', type: 'agent', config: { goal: 'Review it. [review]', ...review } },
      { id: 'audit', type: 'agent', config: { goal: 'Audit it. [audit]', ...audit } },
      { id: 'end', type: 'end' },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'write', toPort: 'input' },
      { id: 'c2', fromNodeId: 'write', fromPort: 'success', toNodeId: 'shape', toPort: 'input' },
      { id: 'c3', fromNodeId: 'shape', fromPort: 'success', toNodeId: 'review', toPort: 'input' },
      { id: 'c4', fromNodeId: 'review', fromPort: 'success', toNodeId: 'audit', toPort: 'input' },
      { id: 'c5', fromNodeId: 'audit', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
    ],
  }) as Json;

test('a handoff passes through a non-agent node, and a reviewer can be kept from it', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    const node = /\[(\w+)\]/.exec(turn.prompt)![1]!;
    await report(
      turn,
      'tothenextagent.md',
      node === 'write' ? 'X'.repeat(70 * 1024) : `From ${node}.`,
    );
    await complete({})(turn, fake);
  });
  try {
    const workflowId = await publish(
      harnessed,
      handoffWorkflow({}, { handoffs: { incoming: false, nodes: ['write'] } }),
    );
    const response = await harnessed.engine.startRun({ workflowId });
    const runId = (response.body as { run: { id: string } }).run.id;
    const run = await settled(harnessed, runId);
    assert.equal(run.state, 'COMPLETED');
    const prompts = Object.fromEntries(
      [...harnessed.fake.turns.values()].map((turn) => [/\[(\w+)\]/.exec(turn.prompt)![1]!, turn]),
    );
    assert.doesNotMatch(prompts['write']!.prompt, /left these handoffs/);
    // The large handoff from `write` reached `review` through the Transform, as a file to read.
    const file = /The handoff from the write node is in (\S+)\./.exec(
      prompts['review']!.prompt,
    )?.[1];
    assert.ok(file?.startsWith(prompts['review']!.artifactDirectory));
    assert.equal((await readFile(file!, 'utf8')).length, 70 * 1024);
    // `audit` names `write` and takes nothing from `review`.
    assert.match(prompts['audit']!.prompt, /The handoff from the write node is in/);
    assert.doesNotMatch(prompts['audit']!.prompt, /From review\./);
    const shape = run.executions.find((execution) => execution.node === 'shape')!;
    const write = run.executions.find((execution) => execution.node === 'write')!;
    assert.deepEqual(
      (shape.output as { context: unknown }).context,
      (write.output as { context: unknown }).context,
    );
  } finally {
    await harnessed.close();
  }
});

test('only a handoff recorded on this run’s path is handed on, whatever the context claims', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    // The writer's first turn leaves a draft handoff and no result; its correction completes.
    if (turn.prompt.includes('[write]') && !/without a result/.test(turn.prompt)) {
      await report(turn, 'tothenextagent.md', 'Draft from write.');
      turn.status = 'ended';
      return;
    }
    const node = /\[(\w+)\]/.exec(turn.prompt)?.[1] ?? 'write';
    await report(turn, 'tothenextagent.md', `Genuine from ${node}.`);
    await complete({ count: 1 })(turn, fake);
  });
  try {
    // Another run's handoff, which this run never produced.
    const other = await start(harnessed, { goal: 'Elsewhere. [elsewhere]' });
    assert.equal((await settled(harnessed, other)).state, 'COMPLETED');
    const elsewhere = harnessed.engine.repository
      .artifacts({ runId: other })
      .find((artifact) => artifact.role === 'handoff')!;
    // write -> pause (a Wait) -> review. The test rewrites what the pause passes on.
    const workflowId = await publish(harnessed, {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        { id: 'write', type: 'agent', config: { goal: 'Write. [write]' } },
        { id: 'pause', type: 'wait', config: { durationMs: 60_000 } },
        { id: 'review', type: 'agent', config: { goal: 'Review. [review]' } },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'write', toPort: 'input' },
        { id: 'c2', fromNodeId: 'write', fromPort: 'success', toNodeId: 'pause', toPort: 'input' },
        { id: 'c3', fromNodeId: 'pause', fromPort: 'success', toNodeId: 'review', toPort: 'input' },
      ],
    } as Json);
    const started = await harnessed.engine.startRun({ workflowId });
    const runId = (started.body as { run: { id: string } }).run.id;
    await eventually(() => (view(harnessed, runId).wait?.kind === 'timer' ? true : undefined));
    const mine = harnessed.engine.repository.artifacts({ runId });
    const [draft, genuine] = mine.filter((artifact) => artifact.role === 'handoff');
    assert.ok(draft && genuine && draft.invocationId !== genuine.invocationId);
    const report_ = mine.find((artifact) => artifact.role === 'human_report')!;
    const pause = view(harnessed, runId).executions.find(
      (execution) => execution.node === 'pause',
    )!;
    const forged = [draft, genuine, report_, elsewhere]
      .map((artifact) => ({ kind: 'artifact', id: artifact.id }))
      .concat([{ kind: 'artifact', id: '00000000-0000-4000-8000-000000000000' }]);
    harnessed.store.db
      .prepare(
        "UPDATE node_executions SET input_json = json_set(input_json, '$.context.handoffs', json(?)) WHERE id = ?",
      )
      .run(JSON.stringify(forged), pause.id);
    harnessed.clock.advance(60_000);
    assert.equal((await settled(harnessed, runId)).state, 'COMPLETED');
    const review = [...harnessed.fake.turns.values()].find((turn) =>
      turn.prompt.includes('[review]'),
    )!;
    assert.match(review.prompt, /--- Handoff from the write node ---\nGenuine from write\.\n/);
    assert.doesNotMatch(
      review.prompt,
      /Draft from write|Genuine from elsewhere|Report\.|an earlier node/,
    );
    assert.equal(review.prompt.match(/--- Handoff from/g)?.length, 1);
  } finally {
    await harnessed.close();
  }
});

test('a small handoff is given inline to the next agent', async () => {
  const harnessed = await engineFor(async (turn, fake) => {
    const node = /\[(\w+)\]/.exec(turn.prompt)![1]!;
    await report(turn, 'tothenextagent.md', `Notes from ${node}.`);
    await complete({})(turn, fake);
  });
  try {
    const workflowId = await publish(harnessed, handoffWorkflow({}, {}));
    const response = await harnessed.engine.startRun({ workflowId });
    const run = await settled(harnessed, (response.body as { run: { id: string } }).run.id);
    assert.equal(run.state, 'COMPLETED');
    const audit = [...harnessed.fake.turns.values()].find((turn) =>
      turn.prompt.includes('[audit]'),
    )!;
    assert.match(
      audit.prompt,
      /--- Handoff from the review node ---\nNotes from review\.\n--- End of handoff ---/,
    );
    assert.doesNotMatch(audit.prompt, /Notes from write/);
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
    artifactDirectory: '',
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

// ---- Wait nodes (specification 8) ----

// start -> wait -> end, with the wait's config and bindings.
const waitWorkflow = (config: Record<string, unknown>, bindings: Record<string, unknown> = {}) =>
  ({
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      { id: 'pause', type: 'wait', config, bindings },
      { id: 'end', type: 'end' },
    ],
    connections: [connect('c1', 'start', 'pause'), connect('c2', 'pause', 'end')],
  }) as Json;

const wakeupStates = (harnessed: Harnessed) =>
  harnessed.store.db.prepare('SELECT reason, state FROM wakeups ORDER BY rowid').all();

test('a wait holds the run until its deadline, then passes its input through once', async () => {
  const clock = new FakeClock();
  const harnessed = await engineFor(() => {}, { clock });
  try {
    const workflowId = await publish(harnessed, waitWorkflow({ durationMs: 60_000 }));
    const waiting = (await startNow(harnessed, workflowId, { input: { n: 1 } })) as TimedRun;
    assert.equal(waiting.state, 'WAITING');
    assert.deepEqual(waiting.wait, {
      kind: 'timer',
      executionId: waiting.executions[1]!.id,
      dueAt: clock.now() + 60_000,
    });
    assert.equal(waiting.executions[1]!.state, 'WAITING');
    await delay(50);
    clock.advance(59_999);
    await delay(50);
    assert.equal(view(harnessed, waiting.id).state, 'WAITING', 'not due yet');

    clock.advance(1);
    const run = (await settled(harnessed, waiting.id)) as TimedRun;
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.outcome, { data: { n: 1 } });
    assert.equal(run.wait, null);
    assert.deepEqual(attemptsOf(run), [['COMPLETED', null]]);
    assert.equal(run.activeTime.usedMs, 0, 'waiting costs no active time');
    assert.deepEqual(wakeupStates(harnessed), [{ reason: 'timer', state: 'FIRED' }]);
    const completions = harnessed.store.db
      .prepare(
        "SELECT COUNT(*) AS count FROM events WHERE type = 'execution.completed' AND execution_id = ?",
      )
      .get(run.executions[1]!.id) as { count: number };
    assert.equal(completions.count, 1);
  } finally {
    await harnessed.close();
  }
});

test('a timer survives a restart and fires once when it fell due while Shift was down', async () => {
  const first = await engineFor(() => {});
  const workflowId = await publish(first, waitWorkflow({ durationMs: 3_600_000 }));
  const { id, wait } = (await startNow(first, workflowId)) as TimedRun;
  await first.close();
  const second = await engineFor(() => {}, {
    state: first.state,
    clock: new FakeClock(wait!.dueAt + 5_000),
  });
  try {
    const run = await settled(second, id);
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(wakeupStates(second), [{ reason: 'timer', state: 'FIRED' }]);
  } finally {
    await second.close();
  }
});

test('a wait until a past time passes at once, and an until from a binding is resolved once', async () => {
  const clock = new FakeClock(Date.parse('2026-10-24T12:00:00Z'));
  const harnessed = await engineFor(() => {}, { clock });
  try {
    const past = await publish(harnessed, waitWorkflow({ until: '2026-10-24T11:00:00Z' }));
    const passed = await startNow(harnessed, past);
    assert.equal(passed.state, 'COMPLETED');
    assert.deepEqual(wakeupStates(harnessed), []);

    const bound = await publish(
      harnessed,
      waitWorkflow({ until: '{{at}}' }, { at: { kind: 'trigger', path: ['at'] } }),
    );
    const waiting = (await startNow(harnessed, bound, {
      input: { at: '2026-10-24T15:00:00+02:00' },
    })) as TimedRun;
    assert.equal(waiting.state, 'WAITING');
    assert.equal(waiting.wait?.dueAt, Date.parse('2026-10-24T13:00:00Z'), 'the offset is applied');
    clock.advance(3_600_000);
    const run = await settled(harnessed, waiting.id);
    assert.equal(run.state, 'COMPLETED');

    const invalid = await startNow(harnessed, bound, { input: { at: 'tomorrow' } });
    assert.equal(invalid.state, 'FAILED');
    assert.equal((invalid.outcome as { code: string }).code, 'INVALID_DEADLINE');
  } finally {
    await harnessed.close();
  }
});

test('cancelling a waiting run cancels its timer', async () => {
  const clock = new FakeClock();
  const harnessed = await engineFor(() => {}, { clock });
  try {
    const workflowId = await publish(harnessed, waitWorkflow({ durationMs: 60_000 }));
    const { id } = await startNow(harnessed, workflowId);
    const cancelled = control(harnessed, id, 'cancel');
    assert.equal(cancelled.state, 'CANCELLED');
    clock.advance(120_000);
    await delay(100);
    const run = view(harnessed, id);
    assert.equal(run.state, 'CANCELLED');
    assert.deepEqual(attemptsOf(run), [['CANCELLED', null]]);
    assert.deepEqual(wakeupStates(harnessed), [{ reason: 'timer', state: 'CANCELLED' }]);
  } finally {
    await harnessed.close();
  }
});

// ---- Human input and approval (specification 6.6) ----

type InteractionView = {
  id: string;
  runId: string;
  kind: string;
  state: string;
  revision: number;
  title: string;
  instructions: string | null;
  form: unknown;
  outcomes: string[] | null;
  expiresAt: number | null;
  response: { decision: string | null; data: unknown; actor: unknown; createdAt: number } | null;
};

const respond = (harnessed: Harnessed, id: string, body: Record<string, unknown>) =>
  (harnessed.engine.respond(id, body).body as { interaction: InteractionView }).interaction;
const pendingInteractions = (harnessed: Harnessed) =>
  harnessed.engine.repository.interactions() as unknown as InteractionView[];
const interactionOf = (harnessed: Harnessed, id: string) =>
  harnessed.engine.repository.interaction(id) as unknown as InteractionView;

// start -> ask (approval) -> approved: done, rejected: refused (a failed end).
const approvalWorkflow = (config: Record<string, unknown> = {}) =>
  ({
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      {
        id: 'ask',
        type: 'approval',
        config: {
          title: 'Ship {{name}}?',
          instructions: 'Check the notes for {{name}}.',
          ...config,
        },
        bindings: { name: { kind: 'trigger', path: ['name'] } },
      },
      { id: 'done', type: 'end' },
      { id: 'refused', type: 'end', config: { outcome: 'FAILED', reason: 'rejected' } },
    ],
    connections: [
      connect('c1', 'start', 'ask'),
      connect('c2', 'ask', 'done', 'approved'),
      connect('c3', 'ask', 'refused', 'rejected'),
    ],
  }) as Json;

test('an approval waits with its frozen request, and the first response routes its outcome', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflowId = await publish(harnessed, approvalWorkflow());
    const waiting = (await startNow(harnessed, workflowId, { input: { name: 'v1' } })) as TimedRun;
    assert.equal(waiting.state, 'WAITING');
    const [request] = pendingInteractions(harnessed);
    assert.deepEqual(waiting.wait, {
      kind: 'human',
      executionId: waiting.executions[1]!.id,
      interactionId: request!.id,
      expiresAt: null,
    });
    assert.equal(request!.title, 'Ship v1?');
    assert.equal(request!.instructions, 'Check the notes for v1.');
    assert.deepEqual(request!.outcomes, ['approved', 'rejected']);
    assert.deepEqual(request!.form, {
      type: 'object',
      additionalProperties: false,
      properties: { comment: { type: 'string', maxLength: 4000, title: 'Comment' } },
    });
    assert.equal(request!.revision, 0);

    // Publishing a changed workflow leaves the pending request as it was frozen.
    const workflow = harnessed.definitions.workflow(workflowId) as { draftRevision: number };
    harnessed.definitions.saveDraft(
      workflowId,
      workflow.draftRevision,
      normalizeDocument(approvalWorkflow({ title: 'Something else' })) as Json,
    );
    harnessed.definitions.publish(workflowId);
    assert.equal(interactionOf(harnessed, request!.id).title, 'Ship v1?');

    for (const [body, code] of [
      [{ revision: 0, decision: 'maybe' }, 'INVALID_RESPONSE'],
      [{ revision: 0, decision: 'approved', response: { comment: 5 } }, 'INVALID_RESPONSE'],
      [{ revision: 0, decision: 'approved', response: { extra: true } }, 'INVALID_RESPONSE'],
      [{ revision: 3, decision: 'approved' }, 'REVISION_CONFLICT'],
    ] as const) {
      assert.throws(() => respond(harnessed, request!.id, body), { code });
    }
    assert.equal(view(harnessed, waiting.id).state, 'WAITING', 'refused responses change nothing');

    const answer = { revision: 0, decision: 'approved', response: { comment: 'ok' } };
    const answered = respond(harnessed, request!.id, { ...answer, commandId: 'respond-1' });
    assert.equal(answered.state, 'RESPONDED');
    assert.deepEqual(answered.response, {
      decision: 'approved',
      data: { comment: 'ok' },
      actor: { kind: 'cli', id: 'local' },
      createdAt: answered.response!.createdAt,
    });
    assert.deepEqual(
      respond(harnessed, request!.id, { ...answer, commandId: 'respond-1' }),
      answered,
      'a repeated command returns its stored response',
    );
    assert.throws(() => respond(harnessed, request!.id, { revision: 1, decision: 'rejected' }), {
      code: 'INTERACTION_CONFLICT',
      message: /already answered with approved by cli:local/,
    });

    const run = (await settled(harnessed, waiting.id)) as TimedRun;
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.outcome, {
      data: { input: { name: 'v1' }, decision: 'approved', response: { comment: 'ok' } },
    });
    assert.deepEqual(
      run.executions.map((execution) => [execution.node, execution.state]),
      [
        ['start', 'COMPLETED'],
        ['ask', 'COMPLETED'],
        ['done', 'COMPLETED'],
      ],
    );
    assert.equal(run.activeTime.usedMs, 0, 'waiting for a human costs no active time');
    assert.deepEqual(pendingInteractions(harnessed), []);
  } finally {
    await harnessed.close();
  }
});

// start -> form (human_input) -> success: end; optionally timeout: late (a transform).
const inputWorkflow = (timeoutRoute: boolean) =>
  ({
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      {
        id: 'form',
        type: 'human_input',
        config: {
          title: 'Why?',
          timeoutMs: 60_000,
          form: {
            type: 'object',
            required: ['reason'],
            properties: { reason: { type: 'string', minLength: 1 } },
          },
        },
      },
      { id: 'end', type: 'end' },
      { id: 'late', type: 'transform', config: { data: { late: true } } },
    ],
    connections: [
      connect('c1', 'start', 'form'),
      connect('c2', 'form', 'end'),
      ...(timeoutRoute ? [connect('c3', 'form', 'late', 'timeout')] : []),
    ],
  }) as Json;

test('human input returns the response with the previous data and context', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflowId = await publish(harnessed, inputWorkflow(true));
    const { id } = await startNow(harnessed, workflowId, { input: { ticket: 7 } });
    const [request] = pendingInteractions(harnessed);
    assert.equal(request!.kind, 'input');
    assert.equal(request!.outcomes, null);
    assert.throws(() => respond(harnessed, request!.id, { revision: 0 }), {
      code: 'INVALID_RESPONSE',
    });
    assert.throws(
      () => respond(harnessed, request!.id, { revision: 0, decision: 'approved', response: {} }),
      { code: 'INVALID_RESPONSE' },
    );
    respond(harnessed, request!.id, { revision: 0, response: { reason: 'flaky test' } });
    const run = await settled(harnessed, id);
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(run.outcome, {
      data: { input: { ticket: 7 }, response: { reason: 'flaky test' } },
    });
    assert.deepEqual(wakeupStates(harnessed), [{ reason: 'deadline', state: 'CANCELLED' }]);
  } finally {
    await harnessed.close();
  }
});

test('an unanswered request takes its timeout route, or fails the run without one', async () => {
  const clock = new FakeClock();
  const harnessed = await engineFor(() => {}, { clock });
  try {
    const routed = await startNow(harnessed, await publish(harnessed, inputWorkflow(true)));
    const unrouted = await startNow(harnessed, await publish(harnessed, inputWorkflow(false)));
    const requests = pendingInteractions(harnessed);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.expiresAt, clock.now() + 60_000);
    clock.advance(60_000);

    // A human wait settles `settled`; the deadline then fires on the next pump.
    const finished = (run: ControlledRun) => run.state !== 'WAITING';
    const late = await until(harnessed, routed.id, finished);
    assert.equal(late.state, 'COMPLETED');
    assert.deepEqual(late.outcome, { data: { late: true } });
    assert.equal((late.executions[1] as unknown as { port: string }).port, 'timeout');
    const failed = await until(harnessed, unrouted.id, finished);
    assert.equal(failed.state, 'FAILED');
    assert.deepEqual(
      {
        code: (failed.outcome as { code: string }).code,
        category: (failed.outcome as { category: string }).category,
      },
      { code: 'INTERACTION_EXPIRED', category: 'blocked' },
    );
    for (const request of requests) {
      assert.equal(interactionOf(harnessed, request.id).state, 'EXPIRED');
      assert.throws(
        () => respond(harnessed, request.id, { revision: 0, response: { reason: 'x' } }),
        {
          code: 'INTERACTION_RETIRED',
        },
      );
    }
  } finally {
    await harnessed.close();
  }
});

test('a response wins over a deadline that falls due afterwards', async () => {
  const clock = new FakeClock();
  const harnessed = await engineFor(() => {}, { clock });
  try {
    const { id } = await startNow(harnessed, await publish(harnessed, inputWorkflow(true)));
    const [request] = pendingInteractions(harnessed);
    respond(harnessed, request!.id, { revision: 0, response: { reason: 'in time' } });
    clock.advance(120_000);
    await delay(100);
    const run = view(harnessed, id);
    assert.equal(run.state, 'COMPLETED');
    assert.equal(run.executions.length, 3, 'only the success route ran');
    assert.equal(interactionOf(harnessed, request!.id).state, 'RESPONDED');
  } finally {
    await harnessed.close();
  }
});

test('cancelling a run retires its pending request', async () => {
  const clock = new FakeClock();
  const harnessed = await engineFor(() => {}, { clock });
  try {
    const { id } = await startNow(harnessed, await publish(harnessed, inputWorkflow(true)));
    const [request] = pendingInteractions(harnessed);
    assert.equal(control(harnessed, id, 'cancel').state, 'CANCELLED');
    const retired = interactionOf(harnessed, request!.id);
    assert.equal(retired.state, 'CANCELLED');
    assert.throws(
      () =>
        respond(harnessed, request!.id, { revision: retired.revision, response: { reason: 'x' } }),
      {
        code: 'INTERACTION_RETIRED',
        message: /cancelled/,
      },
    );
    clock.advance(120_000);
    await delay(100);
    assert.equal(view(harnessed, id).state, 'CANCELLED');
    assert.deepEqual(attemptsOf(view(harnessed, id)), [['CANCELLED', null]]);
  } finally {
    await harnessed.close();
  }
});

test('a pending request survives a restart and is answered exactly once', async () => {
  const first = await engineFor(() => {});
  const { id } = await startNow(first, await publish(first, approvalWorkflow()), {
    input: { name: 'v2' },
  });
  const [request] = pendingInteractions(first);
  await first.close();
  const second = await engineFor(() => {}, { state: first.state });
  try {
    assert.deepEqual(
      pendingInteractions(second).map((pending) => pending.id),
      [request!.id],
    );
    respond(second, request!.id, { revision: 0, decision: 'rejected' });
    const run = await settled(second, id);
    assert.equal(run.state, 'FAILED');
    assert.deepEqual(run.outcome, {
      data: { input: { name: 'v2' }, decision: 'rejected', response: {} },
      reason: 'rejected',
    });
    const responded = second.store.db
      .prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'interaction.responded'")
      .get() as { count: number };
    assert.equal(responded.count, 1);
  } finally {
    await second.close();
  }
});

// ---- Condition and Switch (specification 6.2) ----

const nGreater = (value: number) => ({ op: 'gt', left: { binding: 'n' }, right: { value } });
const nBinding = { n: { kind: 'input', path: ['data', 'n'] } };

test('a condition picks one branch, and the branches converge through the chosen one only', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflowId = await publish(harnessed, {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        {
          id: 'check',
          type: 'condition',
          config: { when: { all: [{ op: 'exists', left: { binding: 'n' } }, nGreater(5)] } },
          bindings: nBinding,
        },
        { id: 'big', type: 'transform', config: { data: { size: 'big' } } },
        { id: 'small', type: 'transform', config: { data: { size: 'small' } } },
        { id: 'end', type: 'end' },
      ],
      connections: [
        connect('c1', 'start', 'check'),
        connect('c2', 'check', 'big', 'true'),
        connect('c3', 'check', 'small', 'false'),
        connect('c4', 'big', 'end'),
        connect('c5', 'small', 'end'),
      ],
    } as Json);
    for (const [n, size, branch] of [
      [7, 'big', 'true'],
      [2, 'small', 'false'],
    ] as const) {
      const run = await startNow(harnessed, workflowId, { input: { n } });
      assert.equal(run.state, 'COMPLETED');
      assert.deepEqual(run.outcome, { data: { size } });
      assert.deepEqual(
        run.executions.map((execution) => execution.node),
        ['start', 'check', size, 'end'],
      );
      const check = run.executions[1] as unknown as { port: string; output: { data: unknown } };
      assert.equal(check.port, branch);
      assert.deepEqual(check.output.data, { n }, 'the condition passes its input through');
    }
  } finally {
    await harnessed.close();
  }
});

test('a switch takes its first matching case, or default', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const leaf = (id: string) => ({ id, type: 'transform', config: { data: id } });
    const workflowId = await publish(harnessed, {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        {
          id: 'route',
          type: 'switch',
          config: {
            cases: [
              { port: 'high', when: nGreater(9) },
              { port: 'mid', when: nGreater(4) },
              {
                port: 'tagged',
                when: { op: 'contains', left: { binding: 'tags' }, right: { value: 'x' } },
              },
            ],
          },
          bindings: {
            ...nBinding,
            tags: { kind: 'input', path: ['data', 'tags'] },
          },
        },
        leaf('high'),
        leaf('mid'),
        leaf('tagged'),
        leaf('other'),
      ],
      connections: [
        connect('c1', 'start', 'route'),
        connect('c2', 'route', 'high', 'high'),
        connect('c3', 'route', 'mid', 'mid'),
        connect('c4', 'route', 'tagged', 'tagged'),
        connect('c5', 'route', 'other', 'default'),
      ],
    } as Json);
    for (const [input, expected] of [
      [{ n: 12, tags: [] }, 'high'],
      [{ n: 7, tags: ['x'] }, 'mid'],
      [{ n: 1, tags: ['x'] }, 'tagged'],
      [{ n: 1, tags: [] }, 'other'],
    ] as const) {
      const run = await startNow(harnessed, workflowId, { input });
      assert.deepEqual(run.outcome, { data: expected }, JSON.stringify(input));
    }
  } finally {
    await harnessed.close();
  }
});

test('comparing values of different types fails the node instead of choosing a branch', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflowId = await publish(harnessed, {
      nodes: [
        { id: 'start', type: 'manual_trigger' },
        { id: 'check', type: 'condition', config: { when: nGreater(5) }, bindings: nBinding },
      ],
      connections: [connect('c1', 'start', 'check')],
    } as Json);
    const run = await startNow(harnessed, workflowId, { input: { n: 'seven' } });
    assert.equal(run.state, 'FAILED');
    assert.deepEqual(run.outcome, {
      code: 'CONDITION_TYPE',
      category: 'input',
      message: 'gt cannot compare string with number.',
    });
  } finally {
    await harnessed.close();
  }
});

test('a loop controlled by a condition keeps each pass across a restart', async () => {
  // Each agent turn reports how many turns ran; the loop pauses before every new pass.
  let turns = 0;
  const counting: Behaviour = async (turn, fake) => complete({ count: ++turns })(turn, fake);
  const document = {
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      {
        id: 'agent',
        type: 'agent',
        config: {
          goal: 'Count.',
          resultSchema: { type: 'object', properties: { count: { type: 'integer' } } },
        },
      },
      {
        id: 'again',
        type: 'condition',
        config: { when: { op: 'lt', left: { binding: 'count' }, right: { value: 3 } } },
        bindings: { count: { kind: 'input', path: ['data', 'count'] } },
      },
      { id: 'pause', type: 'wait', config: { durationMs: 60_000 } },
      { id: 'end', type: 'end' },
    ],
    connections: [
      connect('c1', 'start', 'agent'),
      connect('c2', 'agent', 'again'),
      connect('c3', 'again', 'pause', 'true'),
      connect('c4', 'pause', 'agent'),
      connect('c5', 'again', 'end', 'false'),
    ],
  } as Json;
  const first = await engineFor(counting);
  const workflowId = await publish(first, document);
  const { id } = await startNow(first, workflowId);
  const paused = await until(first, id, (run) => run.wait?.kind === 'timer');
  await first.close();

  // The first pass is paused; the server comes back after its timer.
  const clock = new FakeClock(paused.wait!.dueAt);
  const current = await engineFor(counting, { state: first.state, fake: first.fake, clock });
  try {
    // Each later pass pauses at a new deadline; move the clock past it until the loop ends.
    for (let dueAt = paused.wait!.dueAt; ;) {
      const run = await until(
        current,
        id,
        (candidate) =>
          candidate.state === 'COMPLETED' ||
          (candidate.wait?.kind === 'timer' && candidate.wait.dueAt !== dueAt),
      );
      if (run.state === 'COMPLETED') break;
      dueAt = run.wait!.dueAt;
      clock.advance(60_000);
    }
    const run = view(current, id) as unknown as {
      outcome: unknown;
      executions: Array<{ node: string; port: string | null; output: { data: unknown } }>;
    };
    assert.deepEqual(
      run.executions.map((execution) => `${execution.node}:${execution.port}`),
      [
        'start:success',
        'agent:success',
        'again:true',
        'pause:success',
        'agent:success',
        'again:true',
        'pause:success',
        'agent:success',
        'again:false',
        'end:success',
      ],
    );
    assert.deepEqual(
      run.executions
        .filter((execution) => execution.node === 'agent')
        .map((execution) => execution.output.data),
      [{ count: 1 }, { count: 2 }, { count: 3 }],
      'every pass is its own execution with its own output',
    );
    assert.deepEqual(run.outcome, { data: { count: 3 } });
  } finally {
    await current.close();
  }
});

// ---- Execution selectors, provenance and history (specification 6.3) ----

type HistoryEntry = {
  id: string;
  node: string;
  sequence: number;
  state: string;
  predecessorId: string | null;
  connectionId: string | null;
  sources: Record<string, Record<string, unknown>> | null;
  output: { data: unknown } | null;
};

test('selectors read earlier loop passes even when the newest pass skipped the producer', async () => {
  let turns = 0;
  const counting: Behaviour = async (turn, fake) => complete({ count: ++turns })(turn, fake);
  const below3 = { op: 'lt', left: { binding: 'count' }, right: { value: 3 } };
  const count = { count: { kind: 'input', path: ['data', 'count'] } };
  const mark = (execution: unknown) => ({
    kind: 'node',
    nodeId: 'mark',
    execution,
    path: ['data', 'seen'],
  });
  // start -> agent -> gate: passes 1 and 2 go through mark, pass 3 skips it -> again -> report.
  const document = {
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      {
        id: 'agent',
        type: 'agent',
        config: {
          goal: 'Count.',
          resultSchema: { type: 'object', properties: { count: { type: 'integer' } } },
        },
      },
      { id: 'gate', type: 'condition', config: { when: below3 }, bindings: count },
      {
        id: 'mark',
        type: 'transform',
        config: { data: { seen: { $binding: 'count' }, count: { $binding: 'count' } } },
        bindings: count,
      },
      { id: 'again', type: 'condition', config: { when: below3 }, bindings: count },
      {
        id: 'report',
        type: 'transform',
        config: {
          data: {
            latest: { $binding: 'latest' },
            first: { $binding: 'first' },
            second: { $binding: 'second' },
          },
        },
        bindings: {
          latest: mark('latest'),
          first: mark('first'),
          second: {
            kind: 'node',
            nodeId: 'agent',
            execution: { sequence: 6 },
            path: ['data', 'count'],
          },
        },
      },
    ],
    connections: [
      connect('c1', 'start', 'agent'),
      connect('c2', 'agent', 'gate'),
      connect('c3', 'gate', 'mark', 'true'),
      connect('c4', 'gate', 'again', 'false'),
      connect('c5', 'mark', 'again'),
      connect('c6', 'again', 'agent', 'true'),
      connect('c7', 'again', 'report', 'false'),
    ],
  } as Json;
  const first = await engineFor(counting);
  const { id } = await startNow(first, await publish(first, document));
  const done = await settled(first, id);
  assert.equal(done.state, 'COMPLETED');
  assert.deepEqual(done.outcome, { data: { latest: 2, first: 1, second: 2 } });
  await first.close();

  // Provenance is stored with the execution, so a restarted server reports the same producers.
  const second = await engineFor(() => {}, { state: first.state });
  try {
    const history = (second.engine.repository.run(id) as unknown as { executions: HistoryEntry[] })
      .executions;
    const at = (sequence: number) => history.find((entry) => entry.sequence === sequence)!;
    assert.deepEqual(
      history.map((entry) => `${entry.sequence}:${entry.node}`),
      [
        '1:start',
        '2:agent',
        '3:gate',
        '4:mark',
        '5:again',
        '6:agent',
        '7:gate',
        '8:mark',
        '9:again',
        '10:agent',
        '11:gate',
        '12:again',
        '13:report',
      ],
    );
    const report = at(13);
    assert.equal(report.predecessorId, at(12).id);
    assert.equal(report.connectionId, 'c7');
    assert.deepEqual(report.sources, {
      latest: {
        kind: 'node',
        nodeId: 'mark',
        executionId: at(8).id,
        sequence: 8,
        path: ['data', 'seen'],
      },
      first: {
        kind: 'node',
        nodeId: 'mark',
        executionId: at(4).id,
        sequence: 4,
        path: ['data', 'seen'],
      },
      second: {
        kind: 'node',
        nodeId: 'agent',
        executionId: at(6).id,
        sequence: 6,
        path: ['data', 'count'],
      },
    });
    assert.deepEqual(at(12).sources, {
      count: { kind: 'input', executionId: at(11).id, path: ['data', 'count'] },
    });

    const page = (after: number, limit: number) =>
      second.engine.repository.executions(id, after, limit) as unknown as {
        executions: HistoryEntry[];
        next: number | null;
      };
    const firstPage = page(0, 5);
    assert.deepEqual(
      firstPage.executions.map((entry) => entry.sequence),
      [1, 2, 3, 4, 5],
    );
    assert.equal(firstPage.next, 5);
    const lastPage = page(10, 5);
    assert.deepEqual(
      lastPage.executions.map((entry) => entry.sequence),
      [11, 12, 13],
    );
    assert.equal(lastPage.next, null);
    assert.deepEqual(lastPage.executions[2], report, 'pages hold the same entries as the run view');
    assert.throws(() => second.engine.repository.executions('nope', 0, 1), {
      code: 'RUN_NOT_FOUND',
    });
  } finally {
    await second.close();
  }
});

test('a selector naming a failed, later or foreign execution fails the node, even when optional', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const selector = (execution: unknown, optional = false) =>
      ({
        nodes: [
          { id: 'start', type: 'manual_trigger' },
          // Fails: its binding has no value, so its error connection is taken.
          {
            id: 'bad',
            type: 'transform',
            config: { data: { $binding: 'gone' } },
            bindings: { gone: { kind: 'trigger', path: ['absent'] } },
          },
          {
            id: 'after',
            type: 'transform',
            config: { data: { $binding: 'value' } },
            bindings: {
              value: {
                kind: 'node',
                nodeId: 'bad',
                execution,
                path: [],
                ...(optional ? { optional: true, fallback: null } : {}),
              },
            },
          },
        ],
        connections: [connect('c1', 'start', 'bad'), connect('c2', 'bad', 'after', 'error')],
      }) as Json;
    for (const [execution, optional] of [
      [{ sequence: 2 }, false],
      [{ sequence: 2 }, true],
      [{ sequence: 9 }, true],
      [{ executionId: 'elsewhere' }, true],
    ] as const) {
      const run = await startNow(
        harnessed,
        await publish(harnessed, selector(execution, optional)),
      );
      assert.equal(run.state, 'FAILED', JSON.stringify(execution));
      assert.equal((run.outcome as { code: string }).code, 'BINDING_UNAVAILABLE');
    }
    // A missing latest value is different: the optional fallback applies.
    const fallback = await startNow(harnessed, await publish(harnessed, selector('latest', true)));
    assert.equal(fallback.state, 'COMPLETED');
    assert.deepEqual(fallback.outcome, { data: null });
    assert.deepEqual((fallback.executions[2] as unknown as HistoryEntry).sources, {
      value: {
        kind: 'node',
        nodeId: 'bad',
        executionId: null,
        sequence: null,
        path: [],
        fallback: true,
      },
    });
  } finally {
    await harnessed.close();
  }
});

// ---------- Run variables (prompt 07) ----------

const variables = (harnessed: Harnessed, runId: string) =>
  harnessed.engine.repository.variableHistory(runId) as unknown as {
    variables: Array<{ key: string; value: unknown; revision: number; executionId: string }>;
    revisions: Array<{ key: string; revision: number; value: unknown; executionId: string }>;
  };

test('a finite collection loop visits each element once and ends', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const example = JSON.parse(
      await readFile(
        new URL('../../../docs/examples/collection-loop.json', import.meta.url),
        'utf8',
      ),
    ) as Json;
    const workflowId = await publish(harnessed, example);
    const run = await startNow(harnessed, workflowId, { input: { items: ['a', 'b', 'c'] } });
    assert.equal(run.state, 'COMPLETED');
    const visits = run.executions.filter((execution) => execution.node === 'visit');
    assert.deepEqual(
      visits.map((execution) => (execution.output as { data: unknown }).data),
      [
        { index: 0, item: 'a' },
        { index: 1, item: 'b' },
        { index: 2, item: 'c' },
      ],
    );
    const history = variables(harnessed, run.id);
    assert.deepEqual(
      history.revisions.map((item) => [item.revision, item.value]),
      [
        [1, 0],
        [2, 1],
        [3, 2],
        [4, 3],
      ],
    );
    assert.deepEqual(
      history.variables.map((item) => [item.key, item.value, item.revision]),
      [['index', 3, 4]],
    );
    // Each write names the execution that made it, and each read names the revision it froze.
    const writers = run.executions.filter((execution) => ['init', 'next'].includes(execution.node));
    assert.deepEqual(
      history.revisions.map((item) => item.executionId),
      writers.map((execution) => execution.id),
    );
    const sources = (
      harnessed.engine.repository.run(run.id) as unknown as {
        executions: Array<{ node: string; sources: Record<string, unknown> | null }>;
      }
    ).executions.filter((execution) => execution.node === 'visit');
    assert.deepEqual(
      sources.map((execution) => (execution.sources?.['index'] as { revision: number }).revision),
      [1, 2, 3],
    );
    // A second run starts from nothing: variables belong to one run.
    const empty = await startNow(harnessed, workflowId, { input: { items: [] } });
    assert.equal(empty.state, 'COMPLETED');
    assert.equal(empty.executions.filter((execution) => execution.node === 'visit').length, 0);
    assert.deepEqual(
      variables(harnessed, empty.id).revisions.map((item) => item.value),
      [0],
    );
    assert.equal(variables(harnessed, run.id).revisions.length, 4);
  } finally {
    await harnessed.close();
  }
});

// start -> set x = 1 -> ask (reads x) -> bump (x = x + 1) -> end
const bumpWorkflow: Json = {
  nodes: [
    { id: 'start', type: 'manual_trigger' },
    { id: 'set', type: 'set_variable', config: { key: 'x', value: 1 } },
    {
      id: 'ask',
      type: 'human_input',
      config: { title: 'x is {{x}}', form: { type: 'object', properties: {} } },
      bindings: { x: { kind: 'variable', key: 'x', path: [] } },
    },
    {
      id: 'bump',
      type: 'set_variable',
      config: { key: 'x', value: { $add: [{ $binding: 'x' }, 1] } },
      bindings: { x: { kind: 'variable', key: 'x', path: [] } },
    },
    { id: 'end', type: 'end' },
  ],
  connections: [
    connect('c1', 'start', 'set'),
    connect('c2', 'set', 'ask'),
    connect('c3', 'ask', 'bump'),
    connect('c4', 'bump', 'end'),
  ],
} as Json;

// Writes a revision as another execution of the same run would, outside the engine.
function writeElsewhere(harnessed: Harnessed, runId: string, key: string, value: Json): void {
  const { db } = harnessed.store;
  const current = db
    .prepare('SELECT revision, execution_id FROM run_variables WHERE run_id = ? AND key = ?')
    .get(runId, key) as { revision: number; execution_id: string };
  const revision = current.revision + 1;
  db.prepare(
    'UPDATE run_variables SET value_json = ?, revision = ? WHERE run_id = ? AND key = ?',
  ).run(JSON.stringify(value), revision, runId, key);
  db.prepare(
    'INSERT INTO run_variable_revisions (run_id, key, revision, value_json, execution_id, created_at) VALUES (?, ?, ?, ?, ?, 0)',
  ).run(runId, key, revision, JSON.stringify(value), current.execution_id);
}

// Answers the run's request with the engine stopped, then claims the step it schedules, so the
// test controls what happens between preparing that step and completing it.
async function answerAndClaim(harnessed: Harnessed, runId: string) {
  await harnessed.engine.stop(5_000);
  const { repository } = harnessed.engine;
  const interaction = (
    repository.interactions() as unknown as Array<{ id: string; runId: string; revision: number }>
  ).find((item) => item.runId === runId)!;
  repository.respond(interaction.id, { kind: 'cli', id: 'local' }, undefined, {
    revision: interaction.revision,
    response: {},
  });
  const pending = repository.pendingExecutions()[0]!;
  return repository.claimAttempt(pending.id, harnessed.store.workerGeneration)!;
}

test('a waiting execution keeps the variable value it froze after a later write', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflowId = await publish(harnessed, bumpWorkflow);
    const run = await startNow(harnessed, workflowId);
    assert.equal(run.state, 'WAITING');
    writeElsewhere(harnessed, run.id, 'x', 50);
    const interaction = (
      harnessed.engine.repository.interactions() as unknown as Array<{
        runId: string;
        title: string;
      }>
    ).find((item) => item.runId === run.id)!;
    assert.equal(interaction.title, 'x is 1');
    const ask = (
      harnessed.engine.repository.run(run.id) as unknown as {
        executions: Array<{ node: string; sources: Record<string, unknown> | null }>;
      }
    ).executions.find((execution) => execution.node === 'ask')!;
    assert.deepEqual(ask.sources?.['x'], {
      kind: 'variable',
      key: 'x',
      revision: 1,
      executionId: run.executions.find((execution) => execution.node === 'set')!.id,
      path: [],
    });
  } finally {
    await harnessed.close();
  }
});

test('a write commits with its completion, and a stale expected revision commits nothing', async () => {
  const first = await engineFor(() => {});
  let state = first.state;
  let runId: string;
  try {
    const workflowId = await publish(first, bumpWorkflow);
    runId = (await startNow(first, workflowId)).id;
    const claim = await answerAndClaim(first, runId);
    const { repository } = first.engine;
    repository.prepareExecution(claim, {
      config: { key: 'x', value: 2, expectedRevision: 1 },
      bindings: { x: 1 },
      sources: {},
    });
    writeElsewhere(first, runId, 'x', 7);
    assert.throws(
      () =>
        repository.completeExecution(claim, {
          kind: 'completed',
          output: { data: {}, references: { artifacts: [] }, context: { handoffs: [] } },
          port: 'success',
          variableWrites: [{ key: 'x', value: 2, expectedRevision: 1 }],
        }),
      (error: unknown) => error instanceof ShiftError && error.code === 'VARIABLE_CONFLICT',
    );
    // Neither the output nor the write landed.
    const bump = view(first, runId).executions.find((execution) => execution.node === 'bump')!;
    assert.equal(bump.state, 'RUNNING');
    assert.equal(bump.output, null);
    assert.deepEqual(
      variables(first, runId).revisions.map((item) => item.value),
      [1, 7],
    );
    state = first.state;
    first.store.close();
  } catch (error) {
    await first.close();
    throw error;
  }
  // After a restart the attempt is taken up again with the configuration it froze, so the stale
  // revision fails the node instead of overwriting the newer value.
  const second = await engineFor(() => {}, { state });
  try {
    const run = await settled(second, runId);
    assert.equal(run.state, 'FAILED');
    const bump = run.executions.find((execution) => execution.node === 'bump')!;
    assert.equal(bump.error?.code, 'VARIABLE_CONFLICT');
    assert.deepEqual(
      variables(second, runId).revisions.map((item) => item.value),
      [1, 7],
    );
  } finally {
    await second.close();
  }
});

test('a crash before completion leaves no write, and the restarted attempt writes once', async () => {
  const first = await engineFor(() => {});
  const state = first.state;
  let runId: string;
  try {
    const workflowId = await publish(first, bumpWorkflow);
    runId = (await startNow(first, workflowId)).id;
    const claim = await answerAndClaim(first, runId);
    first.engine.repository.prepareExecution(claim, {
      config: { key: 'x', value: 2, expectedRevision: 1 },
      bindings: { x: 1 },
      sources: {},
    });
    assert.equal(variables(first, runId).revisions.length, 1, 'nothing written before the crash');
    // The process ends here, between preparing the write and committing it.
    first.store.close();
  } catch (error) {
    await first.close();
    throw error;
  }
  const second = await engineFor(() => {}, { state });
  try {
    const run = await settled(second, runId);
    assert.equal(run.state, 'COMPLETED');
    assert.deepEqual(
      variables(second, runId).revisions.map((item) => [item.revision, item.value]),
      [
        [1, 1],
        [2, 2],
      ],
    );
  } finally {
    await second.close();
  }
});

test('transform operations compute bounded values, and wrong types fail the node', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflow = (data: Json) =>
      ({
        nodes: [
          { id: 'start', type: 'manual_trigger' },
          {
            id: 'calc',
            type: 'transform',
            config: { data },
            bindings: { list: { kind: 'trigger', path: ['list'] } },
          },
        ],
        connections: [connect('c1', 'start', 'calc')],
      }) as Json;
    const ok = await startNow(
      harnessed,
      await publish(
        harnessed,
        workflow({
          sum: { $add: [2, { $multiply: [3, 4] }] },
          less: { $subtract: [1, 3] },
          size: { $length: { $binding: 'list' } },
          last: { $at: [{ $binding: 'list' }, 1] },
          text: { $length: 'four' },
          // Keys that only look like built-ins are plain data.
          plain: { toString: 'kept' },
        }),
      ),
      { input: { list: ['x', 'y'] } },
    );
    assert.deepEqual(ok.outcome, {
      data: { sum: 14, less: -2, size: 2, last: 'y', text: 4, plain: { toString: 'kept' } },
    });
    const outside = await startNow(
      harnessed,
      await publish(harnessed, workflow({ item: { $at: [{ $binding: 'list' }, 5] } })),
      { input: { list: [] } },
    );
    assert.equal(outside.executions.at(-1)!.error?.code, 'TRANSFORM_INDEX');
    const typed = await startNow(
      harnessed,
      await publish(harnessed, workflow({ sum: { $add: ['1', 2] } })),
      { input: { list: [] } },
    );
    assert.equal(typed.executions.at(-1)!.error?.code, 'TRANSFORM_TYPE');
  } finally {
    await harnessed.close();
  }
});

test('get variable reads the current value, or its fallback, and fails without one', async () => {
  const harnessed = await engineFor(() => {});
  try {
    const workflow = (get: Record<string, unknown>, set: boolean) =>
      ({
        nodes: [
          { id: 'start', type: 'manual_trigger' },
          ...(set
            ? [{ id: 'set', type: 'set_variable', config: { key: 'x', value: { a: [1] } } }]
            : []),
          { id: 'get', type: 'get_variable', config: { key: 'x', ...get } },
        ],
        connections: set
          ? [connect('c1', 'start', 'set'), connect('c2', 'set', 'get')]
          : [connect('c1', 'start', 'get')],
      }) as Json;
    const read = await startNow(harnessed, await publish(harnessed, workflow({}, true)));
    assert.deepEqual(read.outcome, { data: { a: [1] } });
    const fallback = await startNow(
      harnessed,
      await publish(harnessed, workflow({ optional: true, fallback: 'none' }, false)),
    );
    assert.deepEqual(fallback.outcome, { data: 'none' });
    const missing = await startNow(harnessed, await publish(harnessed, workflow({}, false)));
    assert.equal(missing.executions.at(-1)!.error?.code, 'VARIABLE_MISSING');
  } finally {
    await harnessed.close();
  }
});
