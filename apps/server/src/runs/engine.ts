import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Logger } from 'pino';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { HarnessAdapter, Json, ModelRef } from '../harness/types.js';
import type { Store } from '../persistence/store.js';
import { AgentService } from './agent-service.js';
import { assertResultSchema } from './envelope.js';
import { RunRepository, type Claim, type RunSnapshot } from './repository.js';

export interface StartRunInput {
  goal: string;
  repository: string;
  model?: string;
  readOnly?: boolean;
  resultSchema?: Json;
}

export interface RunEngineOptions {
  store: Store;
  clock: Clock;
  logger: Logger;
  adapter: HarnessAdapter;
  artifactRoot: string;
  defaultModel?: string;
  maxActiveAgents?: number;
  pollIntervalMs?: number;
}

const validateStart = new Ajv2020({ strict: true, coerceTypes: false }).compile({
  type: 'object',
  additionalProperties: false,
  required: ['goal', 'repository'],
  properties: {
    goal: { type: 'string', minLength: 1, maxLength: 20000 },
    repository: { type: 'string', minLength: 1, maxLength: 4096 },
    model: { type: 'string', pattern: '^[^/\\s]+/\\S+$', maxLength: 200 },
    readOnly: { type: 'boolean' },
    resultSchema: { anyOf: [{ type: 'object' }, { type: 'boolean' }] },
  },
});

const defaultResultSchema: Json = {
  type: 'object',
  description: 'What the task produced or found.',
};

function parseModel(value: string): ModelRef {
  const separator = value.indexOf('/');
  return { providerID: value.slice(0, separator), id: value.slice(separator + 1) };
}

// The fixed manual -> agent -> end run of the first vertical slice. Pending executions and
// running attempts are the durable cursor; the engine never holds work only in memory.
export class RunEngine {
  readonly repository: RunRepository;
  readonly agents: AgentService;
  readonly #options: RunEngineOptions;
  readonly #tasks = new Map<string, { controller: AbortController; done: Promise<void> }>();
  #timer: NodeJS.Timeout | undefined;
  #stopping = false;

  constructor(options: RunEngineOptions) {
    this.#options = options;
    this.repository = new RunRepository(options.store.db, options.clock);
    this.agents = new AgentService({
      repository: this.repository,
      adapter: options.adapter,
      artifactRoot: options.artifactRoot,
      logger: options.logger,
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    });
  }

  // Resumes attempts left by an earlier worker generation, then admits pending work.
  start(): void {
    for (const claim of this.repository.reclaimOrphanedAttempts(
      this.#options.store.workerGeneration,
    )) {
      this.#launch(claim);
    }
    this.#pump();
    this.#timer = setInterval(() => this.#pump(), 2_000);
    this.#timer.unref();
  }

  async createRun(input: unknown): Promise<Json> {
    if (this.#stopping) throw new ShiftError('SERVER_STOPPING', 'The server is stopping.', 503);
    if (!validateStart(input)) {
      throw new ShiftError(
        'INVALID_REQUEST',
        'Invalid run request.',
        422,
        false,
        (validateStart.errors ?? []).map((error) => error.instancePath || '/'),
      );
    }
    const request = input as StartRunInput;
    if (!isAbsolute(request.repository)) {
      throw new ShiftError('INVALID_REQUEST', 'The repository path must be absolute.', 422);
    }
    const directory = await stat(request.repository).catch(() => null);
    if (!directory?.isDirectory()) {
      throw new ShiftError('INVALID_REQUEST', 'The repository path is not a directory.', 422);
    }
    const model = request.model ?? this.#options.defaultModel;
    if (!model) {
      throw new ShiftError(
        'MODEL_REQUIRED',
        'Choose a model with --model or start the server with --opencode-model.',
        422,
      );
    }
    const resultSchema = request.resultSchema ?? defaultResultSchema;
    assertResultSchema(resultSchema);
    const snapshot: RunSnapshot = {
      graph: {
        nodes: [
          { id: 'start', type: 'manual_trigger' },
          { id: 'agent', type: 'agent' },
          { id: 'end', type: 'end' },
        ],
        connections: [
          { from: 'start', to: 'agent' },
          { from: 'agent', to: 'end' },
        ],
      },
      agent: {
        goal: request.goal,
        cwd: request.repository,
        model: parseModel(model),
        toolPolicy: { mode: request.readOnly ? 'read_only' : 'workspace_write' },
        resultSchema,
        limits: { rejectedSubmissions: 3, corrections: 2, continuations: 2 },
      },
    };
    const runId = this.repository.createRun(snapshot);
    this.#pump();
    return this.repository.run(runId);
  }

  #pump(): void {
    if (this.#stopping) return;
    const limit = this.#options.maxActiveAgents ?? 2;
    for (const executionId of this.repository.pendingAgentExecutions()) {
      if (this.#tasks.size >= limit) return;
      const claim = this.repository.claimAttempt(executionId, this.#options.store.workerGeneration);
      if (claim) this.#launch(claim);
    }
  }

  #launch(claim: Claim): void {
    const controller = new AbortController();
    const done = this.agents
      .run(claim, controller.signal)
      .catch(() => {
        this.#options.logger.error({ runId: claim.runId }, 'An agent task failed.');
      })
      .finally(() => {
        this.#tasks.delete(claim.attemptId);
        this.#pump();
      });
    this.#tasks.set(claim.attemptId, { controller, done });
  }

  // Active turns are cancelled through the harness so the next start can continue them. The
  // deadline bounds a stalled cancellation; the caller then kills the runtime, and startup
  // inspection reconciles whatever was left.
  async stop(timeoutMs: number): Promise<void> {
    this.#stopping = true;
    clearInterval(this.#timer);
    const tasks = [...this.#tasks.values()];
    for (const task of tasks) task.controller.abort();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(tasks.map((task) => task.done)),
      new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs))),
    ]);
    clearTimeout(timer);
  }
}
