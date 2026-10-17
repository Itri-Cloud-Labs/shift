import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Logger } from 'pino';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { HarnessAdapter, Json, ModelRef } from '../harness/types.js';
import type { CommandReceipts, CommandResponse } from '../persistence/receipts.js';
import type { Store } from '../persistence/store.js';
import { validateDocument } from '../workflows/document.js';
import { nodeType } from '../workflows/nodes.js';
import type { DefinitionRepository } from '../workflows/repository.js';
import { AgentService } from './agent-service.js';
import { envelope, renderTemplate, renderText, resolveBindings } from './bindings.js';
import { checkValue } from './envelope.js';
import {
  RunRepository,
  StaleClaim,
  type AgentConfig,
  type Claim,
  type ExecutionContext,
  type RunSnapshot,
} from './repository.js';

export interface RunEngineOptions {
  store: Store;
  clock: Clock;
  logger: Logger;
  adapter: HarnessAdapter;
  artifactRoot: string;
  definitions: DefinitionRepository;
  receipts: CommandReceipts;
  defaultModel?: string;
  maxActiveAgents?: number;
  pollIntervalMs?: number;
}

const commandId = { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' };
const validateStart = new Ajv2020({ strict: true, coerceTypes: false }).compile({
  type: 'object',
  additionalProperties: false,
  required: ['workflowId'],
  properties: { workflowId: { type: 'string', maxLength: 100 }, input: {}, commandId },
});

const defaultResultSchema: Json = {
  type: 'object',
  description: 'What the task produced or found.',
};
const defaultLimits = { rejectedSubmissions: 3, corrections: 2, continuations: 2 };
const local = { kind: 'cli' as const, id: 'local' };

function parseModel(value: string): ModelRef {
  const separator = value.indexOf('/');
  return { providerID: value.slice(0, separator), id: value.slice(separator + 1) };
}

const failure = (error: unknown) =>
  error instanceof ShiftError
    ? { code: error.code, category: 'input' as const, message: error.message }
    : {
        code: 'INTERNAL_ERROR',
        category: 'internal' as const,
        message: 'The node failed unexpectedly.',
      };

// Executes published workflow versions. Pending executions and running attempts are the durable
// cursor; the engine never holds work only in memory. Data and control nodes run inline; agent
// nodes run as tasks under the agent concurrency limit.
export class RunEngine {
  readonly repository: RunRepository;
  readonly agents: AgentService;
  readonly #options: RunEngineOptions;
  readonly #tasks = new Map<string, { controller: AbortController; done: Promise<void> }>();
  #timer: NodeJS.Timeout | undefined;
  #stopping = false;
  #pumping = false;

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
      this.#dispatch(claim);
    }
    this.#pump();
    this.#timer = setInterval(() => this.#pump(), 2_000);
    this.#timer.unref();
  }

  // Starts the workflow's active version with trigger input. The run, its first activation and
  // the command receipt commit together, so a repeated command returns the same run.
  startRun(input: unknown): CommandResponse {
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
    const {
      workflowId,
      input: triggerInput = {},
      commandId: id,
    } = input as {
      workflowId: string;
      input?: Json;
      commandId?: string;
    };
    const { definitions, receipts } = this.#options;
    const response = receipts.execute(
      local,
      id,
      { op: 'run.start', workflowId, triggerInput },
      () => {
        const version = definitions.activeVersion(workflowId);
        // Recheck against this server's registry: a removed node type version fails the start.
        const document = validateDocument(version.document);
        const project = definitions.project(version.projectId);
        const entry = document.nodes.find((node) => nodeType(node.type, node.typeVersion)?.entry)!;
        const inputSchema = (entry.config as { inputSchema?: Json }).inputSchema;
        const invalid = inputSchema === undefined ? null : checkValue(inputSchema, triggerInput);
        if (invalid)
          throw new ShiftError('INVALID_INPUT', `Invalid trigger input: ${invalid}`, 422);
        const snapshot: RunSnapshot = {
          formatVersion: 2,
          workflowId,
          versionId: version.id,
          versionNumber: version.number,
          document,
          project: {
            id: project.id,
            name: project.name,
            repositoryPath: project.repositoryPath,
            baseRef: project.baseRef,
          },
          defaults: this.#options.defaultModel ? { model: this.#options.defaultModel } : {},
        };
        const runId = this.repository.createRun(snapshot, triggerInput);
        return { status: 201, body: { run: this.repository.run(runId) } };
      },
    );
    this.#pump();
    return response;
  }

  #pump(): void {
    if (this.#stopping || this.#pumping) return;
    this.#pumping = true;
    try {
      const limit = this.#options.maxActiveAgents ?? 2;
      // Inline nodes can schedule more inline work; repeat until nothing more can start now.
      for (let progressed = true; progressed && !this.#stopping;) {
        progressed = false;
        for (const pending of this.repository.pendingExecutions()) {
          if (pending.nodeType === 'agent' && this.#tasks.size >= limit) continue;
          const claim = this.repository.claimAttempt(
            pending.id,
            this.#options.store.workerGeneration,
          );
          if (!claim) continue;
          if (this.#dispatch(claim)) progressed = true;
        }
      }
    } finally {
      this.#pumping = false;
    }
  }

  // Returns whether the execution finished inline.
  #dispatch(claim: Claim): boolean {
    let context: ExecutionContext;
    try {
      context = this.#prepare(claim);
    } catch (error) {
      if (error instanceof StaleClaim) return false;
      this.#fail(claim, error);
      return true;
    }
    if (context.node.type === 'agent') {
      this.#launch(claim);
      return false;
    }
    try {
      const bindings = context.bindings ?? {};
      if (context.node.type === 'transform') {
        const template = (context.config as { data: Json }).data;
        const data = renderTemplate(template, bindings);
        if (Buffer.byteLength(JSON.stringify(data)) > 1024 * 1024) {
          throw new ShiftError('OUTPUT_TOO_LARGE', 'The transform output exceeds 1 MiB.', 422);
        }
        this.repository.completeExecution(claim, {
          kind: 'completed',
          output: envelope(data, context.input),
          port: 'success',
        });
      } else if (context.node.type === 'end') {
        // End passes its input through; the run takes the node's declared outcome.
        this.repository.completeExecution(claim, {
          kind: 'completed',
          output: context.input,
          port: 'success',
        });
      } else {
        throw new ShiftError('UNSUPPORTED_NODE', `No executor for ${context.node.type}.`, 422);
      }
    } catch (error) {
      if (error instanceof StaleClaim) return false;
      this.#fail(claim, error);
    }
    return true;
  }

  // Resolves bindings and the effective node configuration once, then freezes both. Recovery and
  // later attempts reuse the frozen values.
  #prepare(claim: Claim): ExecutionContext {
    const context = this.repository.execution(claim.executionId);
    if (context.config !== null && context.bindings !== null) return context;
    const { node, snapshot } = context;
    const bindings = resolveBindings(node.bindings, {
      input: context.input,
      trigger: context.chain.at(-1)?.output.data ?? context.input.data,
      project: {
        id: snapshot.project.id,
        name: snapshot.project.name,
        repositoryPath: snapshot.project.repositoryPath,
        baseRef: snapshot.project.baseRef,
      },
      chain: context.chain,
    });
    let config: Json = node.config;
    if (node.type === 'agent') {
      const authored = node.config as {
        goal: string;
        model?: string;
        readOnly?: boolean;
        resultSchema?: Json;
        limits?: Partial<AgentConfig['limits']>;
      };
      const model = authored.model ?? snapshot.defaults.model;
      if (!model) {
        throw new ShiftError(
          'MODEL_REQUIRED',
          'Set the agent node model or start the server with --opencode-model.',
          422,
        );
      }
      const resolved: AgentConfig = {
        goal: renderText(authored.goal, bindings),
        cwd: snapshot.project.repositoryPath,
        model: parseModel(model),
        toolPolicy: { mode: authored.readOnly ? 'read_only' : 'workspace_write' },
        resultSchema: authored.resultSchema ?? defaultResultSchema,
        limits: { ...defaultLimits, ...authored.limits },
      };
      config = resolved as unknown as Json;
    }
    this.repository.prepareExecution(claim, { config, bindings });
    return { ...context, config, bindings };
  }

  #fail(claim: Claim, error: unknown): void {
    try {
      this.repository.completeExecution(claim, { kind: 'failed', error: failure(error) });
    } catch (finishError) {
      if (!(finishError instanceof StaleClaim)) throw finishError;
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
