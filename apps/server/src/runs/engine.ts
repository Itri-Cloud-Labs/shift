import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Logger } from 'pino';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { HarnessAdapter, Json, ModelRef } from '../harness/types.js';
import type { CommandReceipts, CommandResponse } from '../persistence/receipts.js';
import type { Store } from '../persistence/store.js';
import { parseDeadline, validateDocument } from '../workflows/document.js';
import { defaultApprovalForm, defaultOutcomes, freezeForm } from '../workflows/forms.js';
import { evaluateRule, type Rule } from '../workflows/rules.js';
import { nodeType } from '../workflows/nodes.js';
import type { DefinitionRepository } from '../workflows/repository.js';
import type { Workspaces } from '../workspaces/workspaces.js';
import { AgentService } from './agent-service.js';
import { envelope, renderTemplate, renderText, resolveBindings } from './bindings.js';
import { checkValue } from './envelope.js';
import {
  RunRepository,
  StaleClaim,
  type AgentConfig,
  type Claim,
  type ExecutionContext,
  type FrozenInteraction,
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
  workspaces: Workspaces;
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

const ajv = new Ajv2020({ strict: true, coerceTypes: false });
const reason = { type: 'string', minLength: 1, maxLength: 4000 };
const controlSchemas = {
  cancel: { properties: { reason } },
  retry: { properties: {} },
  fail: { properties: { reason } },
  complete: { required: ['data'], properties: { data: {} } },
  extend: {
    properties: {
      executions: { type: 'integer', minimum: 1, maximum: 10000 },
      activeMs: { type: 'integer', minimum: 1000, maximum: 30 * 24 * 60 * 60 * 1000 },
    },
  },
} as const;
export type RunControlKind = keyof typeof controlSchemas;
const validateRespond = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['revision'],
  properties: {
    revision: { type: 'integer', minimum: 0 },
    decision: { type: 'string', maxLength: 40 },
    response: {},
    commandId,
  },
});
const validateControl = Object.fromEntries(
  Object.entries(controlSchemas).map(([kind, schema]) => [
    kind,
    ajv.compile({
      type: 'object',
      additionalProperties: false,
      ...schema,
      properties: { ...schema.properties, commandId },
    }),
  ]),
) as Record<RunControlKind, ReturnType<typeof ajv.compile>>;

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
  readonly #cancellations = new Set<Promise<void>>();
  // Runs whose attempts are being stopped because they ran out of active time.
  readonly #limitStops = new Set<string>();
  #timer: NodeJS.Timeout | undefined;
  #wakeTimer: NodeJS.Timeout | undefined;
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
      workspaces: options.workspaces,
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    });
  }

  // Resumes attempts left by an earlier worker generation, then admits pending work.
  start(): void {
    // A cancellation an earlier generation did not finish is completed first.
    for (const { runId, claims } of this.repository.reclaimCancellations(
      this.#options.store.workerGeneration,
    )) {
      this.#stopForCancel(runId, claims);
    }
    for (const claim of this.repository.reclaimOrphanedAttempts(
      this.#options.store.workerGeneration,
    )) {
      this.#dispatch(claim);
    }
    this.#pump();
    this.#timer = setInterval(() => {
      this.#checkpoint();
      this.#pump();
    }, 2_000);
    this.#timer.unref();
  }

  // Records the running attempts' active time and stops those whose run has used its budget.
  #checkpoint(): void {
    if (this.#stopping) return;
    let exhausted: Array<{ runId: string; claims: Claim[] }>;
    try {
      exhausted = this.repository.checkpointActiveTime();
    } catch {
      this.#options.logger.error('Checkpointing active time failed.');
      return;
    }
    for (const { runId, claims } of exhausted) {
      if (this.#limitStops.has(runId)) continue;
      this.#limitStops.add(runId);
      this.#stopAttempts(
        runId,
        claims,
        () => this.repository.settleActiveLimit(claims),
        () => this.#limitStops.delete(runId),
      );
    }
  }

  // Starts the workflow's active version with trigger input. The base ref is resolved to a commit
  // first; the run, its first activation and the command receipt then commit together, so a
  // repeated command returns the same run without touching the repository again.
  async startRun(input: unknown): Promise<CommandResponse> {
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
    const { definitions, receipts, workspaces } = this.#options;
    const request = { op: 'run.start', workflowId, triggerInput };
    const stored = id === undefined ? null : receipts.lookup(local, id, request);
    if (stored) return stored;
    const admitted = definitions.activeVersion(workflowId);
    const admittedProject = definitions.project(admitted.projectId);
    const baseCommit = await workspaces.resolveBase(
      admittedProject.repositoryPath,
      admittedProject.baseRef,
    );
    const response = receipts.execute(local, id, request, () => {
      const version = definitions.activeVersion(workflowId);
      // Recheck against this server's registry: a removed node type version fails the start.
      const document = validateDocument(version.document);
      const project = definitions.project(version.projectId);
      if (project.id !== admittedProject.id) {
        throw new ShiftError('REVISION_CONFLICT', 'The workflow changed project; retry.', 409);
      }
      const entry = document.nodes.find((node) => nodeType(node.type, node.typeVersion)?.entry)!;
      const inputSchema = (entry.config as { inputSchema?: Json }).inputSchema;
      const invalid = inputSchema === undefined ? null : checkValue(inputSchema, triggerInput);
      if (invalid) throw new ShiftError('INVALID_INPUT', `Invalid trigger input: ${invalid}`, 422);
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
          baseCommit,
        },
        defaults: this.#options.defaultModel ? { model: this.#options.defaultModel } : {},
      };
      const runId = this.repository.createRun(snapshot, triggerInput);
      return { status: 201, body: { run: this.repository.run(runId) } };
    });
    this.#pump();
    return response;
  }

  // Owner control commands on a run. Each commits with its receipt; a cancellation then stops
  // running attempts in the background, and the run shows CANCEL_REQUESTED until they stopped.
  controlRun(runId: string, kind: RunControlKind, input: unknown): CommandResponse {
    if (this.#stopping) throw new ShiftError('SERVER_STOPPING', 'The server is stopping.', 503);
    const validate = validateControl[kind];
    if (!validate(input)) {
      throw new ShiftError(
        'INVALID_REQUEST',
        'Invalid run command.',
        422,
        false,
        (validate.errors ?? []).map((error) => error.instancePath || '/'),
      );
    }
    const { commandId: id, ...body } = input as {
      commandId?: string;
      reason?: string;
      data?: Json;
      executions?: number;
      activeMs?: number;
    };
    if (kind === 'extend' && (body.executions === undefined) === (body.activeMs === undefined)) {
      throw new ShiftError(
        'INVALID_REQUEST',
        'Extend takes either executions or activeMs.',
        422,
        false,
        ['/'],
      );
    }
    let stops: Claim[] = [];
    const response = this.#options.receipts.execute(
      local,
      id,
      { op: `run.${kind}`, runId, ...body } as Json,
      () => {
        switch (kind) {
          case 'cancel':
            stops = this.repository.requestCancel(runId, local, id, body.reason);
            break;
          case 'retry':
            this.repository.retry(runId, local, id);
            break;
          case 'fail':
            this.repository.fail(runId, local, id, body.reason);
            break;
          case 'complete':
            this.repository.complete(runId, local, id, body.data as Json);
            break;
          case 'extend':
            this.repository.extend(runId, local, id, {
              ...(body.executions === undefined ? {} : { executions: body.executions }),
              ...(body.activeMs === undefined ? {} : { activeMs: body.activeMs }),
            });
            break;
        }
        return { status: 200, body: { run: this.repository.run(runId) } };
      },
    );
    if (stops.length > 0) this.#stopForCancel(runId, stops);
    this.#pump();
    return response;
  }

  #stopForCancel(runId: string, claims: Claim[]): void {
    this.#stopAttempts(runId, claims, () => this.repository.settleCancellation(runId));
  }

  // Answers a human request as the local owner. The response, its receipt, the event and the
  // next step commit together; a repeated command returns the stored response.
  respond(interactionId: string, input: unknown): CommandResponse {
    if (this.#stopping) throw new ShiftError('SERVER_STOPPING', 'The server is stopping.', 503);
    if (!validateRespond(input)) {
      throw new ShiftError(
        'INVALID_REQUEST',
        'Invalid response.',
        422,
        false,
        (validateRespond.errors ?? []).map((error) => error.instancePath || '/'),
      );
    }
    const { commandId: id, ...body } = input as {
      commandId?: string;
      revision: number;
      decision?: string;
      response?: Json;
    };
    const response = this.#options.receipts.execute(
      local,
      id,
      { op: 'interaction.respond', interactionId, ...body } as Json,
      () => {
        this.repository.respond(interactionId, local, id, body);
        return { status: 200, body: { interaction: this.repository.interaction(interactionId) } };
      },
    );
    this.#pump();
    return response;
  }

  // Aborts the attempts' running tasks, stops whatever is still active through the harness, then
  // settles. Cancellation and the active-time limit stop work the same way.
  #stopAttempts(
    runId: string,
    claims: Claim[],
    settle: () => void,
    after: () => void = () => undefined,
  ): void {
    const done = (async () => {
      for (const claim of claims) {
        const task = this.#tasks.get(claim.attemptId);
        if (task) {
          task.controller.abort();
          await task.done;
        }
        await this.agents.cancel(claim).catch((error: unknown) => {
          if (!(error instanceof StaleClaim)) {
            this.#options.logger.error({ runId }, 'Stopping an agent failed.');
          }
        });
      }
      settle();
    })()
      .catch(() => {
        this.#options.logger.error({ runId }, 'Settling stopped attempts failed.');
      })
      .finally(() => {
        this.#cancellations.delete(done);
        after();
        this.#pump();
      });
    this.#cancellations.add(done);
  }

  #pump(): void {
    if (this.#stopping || this.#pumping) return;
    this.#pumping = true;
    try {
      // Due wake-ups reopen their executions first, so they are admitted in this pass.
      this.repository.fireDueWakeups();
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
    this.#armWake();
  }

  // One timer for the earliest durable wake-up. Deadlines live in the database, so a restart
  // rebuilds this from scratch and a wake-up that fell due while the server was down fires at once.
  #armWake(): void {
    clearTimeout(this.#wakeTimer);
    this.#wakeTimer = undefined;
    if (this.#stopping) return;
    const due = this.repository.nextWakeup();
    if (due === null) return;
    const delay = Math.min(Math.max(due - this.#options.clock.now(), 0), 2_147_483_647);
    this.#wakeTimer = setTimeout(() => this.#pump(), delay);
    this.#wakeTimer.unref();
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
      } else if (context.node.type === 'condition' || context.node.type === 'switch') {
        // Control nodes pass their input through and only choose the port.
        const config = context.config as {
          when?: Rule;
          cases?: Array<{ port: string; when: Rule }>;
        };
        const port =
          context.node.type === 'condition'
            ? String(evaluateRule(config.when!, bindings))
            : (config.cases!.find((entry) => evaluateRule(entry.when, bindings))?.port ??
              'default');
        this.repository.completeExecution(claim, {
          kind: 'completed',
          output: context.input,
          port,
        });
      } else if (context.node.type === 'wait') {
        // A deadline that has passed, including one reached while Shift was down, passes at once.
        const { dueAt } = context.config as { dueAt: number };
        if (dueAt <= this.#options.clock.now()) {
          this.repository.completeExecution(claim, {
            kind: 'completed',
            output: context.input,
            port: 'success',
          });
        } else {
          this.repository.startWait(claim, dueAt);
        }
      } else if (context.node.type === 'human_input' || context.node.type === 'approval') {
        this.repository.startInteraction(claim, context.config as unknown as FrozenInteraction);
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
    const { values: bindings, sources } = resolveBindings(node.bindings, {
      input: context.input,
      inputExecutionId: context.predecessorId,
      // The entry trigger is the far end of the chain, or the input itself for its successor.
      trigger: context.chain.at(-1)?.output.data ?? context.input.data,
      triggerExecutionId: context.chain.at(-1)?.id ?? context.predecessorId,
      projectId: snapshot.project.id,
      project: {
        id: snapshot.project.id,
        name: snapshot.project.name,
        repositoryPath: snapshot.project.repositoryPath,
        baseRef: snapshot.project.baseRef,
      },
      chain: context.chain,
    });
    let config: Json = node.config;
    if (node.type === 'wait') {
      // The deadline is fixed now, in UTC, so recovery and restarts wait for the same instant.
      const authored = node.config as { durationMs?: number; until?: string };
      const until = authored.until === undefined ? undefined : renderText(authored.until, bindings);
      const dueAt =
        authored.durationMs !== undefined
          ? this.#options.clock.now() + authored.durationMs
          : parseDeadline(until!);
      if (dueAt === null) {
        throw new ShiftError(
          'INVALID_DEADLINE',
          `The wait's until value ${JSON.stringify(until!.slice(0, 100))} is not an ISO 8601 time with a UTC offset.`,
          422,
        );
      }
      config = { ...authored, dueAt };
    }
    if (node.type === 'human_input' || node.type === 'approval') {
      // The request is frozen here: later draft or default edits never change what is asked.
      const authored = node.config as {
        title: string;
        instructions?: string;
        form?: Json;
        outcomes?: string[];
        timeoutMs?: number;
      };
      const frozen: FrozenInteraction = {
        kind: node.type === 'approval' ? 'approval' : 'input',
        title: renderText(authored.title, bindings),
        instructions:
          authored.instructions === undefined ? null : renderText(authored.instructions, bindings),
        form: freezeForm(authored.form ?? defaultApprovalForm),
        outcomes: node.type === 'approval' ? (authored.outcomes ?? [...defaultOutcomes]) : null,
        expiresAt:
          authored.timeoutMs === undefined ? null : this.#options.clock.now() + authored.timeoutMs,
      };
      config = frozen as unknown as Json;
    }
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
      // Agents work in the run's worktree; runs admitted before workspaces keep the repository.
      const { baseCommit, id: projectId } = snapshot.project;
      const workspace =
        baseCommit !== undefined && projectId !== null
          ? this.#options.workspaces.allocate({
              runId: claim.runId,
              projectId,
              repositoryPath: snapshot.project.repositoryPath,
              baseRef: snapshot.project.baseRef,
              baseCommit,
            })
          : undefined;
      const resolved: AgentConfig = {
        goal: renderText(authored.goal, bindings),
        cwd: workspace?.path ?? snapshot.project.repositoryPath,
        ...(workspace ? { workspaceId: workspace.id } : {}),
        model: parseModel(model),
        toolPolicy: { mode: authored.readOnly ? 'read_only' : 'workspace_write' },
        resultSchema: authored.resultSchema ?? defaultResultSchema,
        limits: { ...defaultLimits, ...authored.limits },
      };
      config = resolved as unknown as Json;
    }
    this.repository.prepareExecution(claim, { config, bindings, sources });
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
    clearTimeout(this.#wakeTimer);
    const tasks = [...this.#tasks.values()];
    for (const task of tasks) task.controller.abort();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all([...tasks.map((task) => task.done), ...this.#cancellations]),
      new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs))),
    ]);
    clearTimeout(timer);
  }
}
