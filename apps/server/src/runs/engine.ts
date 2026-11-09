import { randomUUID } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { dirname, join } from 'node:path';
import type { Logger } from 'pino';
import { BlobStore } from '../artifacts/store.js';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { HarnessAdapter, Json, ModelRef } from '../harness/types.js';
import type { Actor, CommandReceipts, CommandResponse } from '../persistence/receipts.js';
import type { Store } from '../persistence/store.js';
import { parseDeadline, validateDocument } from '../workflows/document.js';
import { defaultApprovalForm, defaultOutcomes, freezeForm } from '../workflows/forms.js';
import { evaluateRule, type Rule } from '../workflows/rules.js';
import { nodeType } from '../workflows/nodes.js';
import type { DefinitionRepository } from '../workflows/repository.js';
import type { Workspaces } from '../workspaces/workspaces.js';
import { actionTypes, freezeAction } from '../actions/config.js';
import type { Credentials } from '../actions/credentials.js';
import { EffectStore } from '../actions/effects.js';
import type { ProcessRunner } from '../actions/process.js';
import { ActionService } from '../actions/service.js';
import { AgentService } from './agent-service.js';
import { envelope, renderTemplate, renderText, resolveBindings } from './bindings.js';
import { checkValue } from './envelope.js';
import {
  RunRepository,
  StaleClaim,
  type AgentConfig,
  type Claim,
  type ExecutionContext,
  type InvocationRow,
  type SessionPolicy,
  type FrozenInteraction,
  type RunSnapshot,
} from './repository.js';

export interface RunEngineOptions {
  store: Store;
  clock: Clock;
  logger: Logger;
  adapter: HarnessAdapter;
  artifactRoot: string;
  // Artifact bytes; by default `blobs` beside the artifact root.
  blobs?: BlobStore;
  definitions: DefinitionRepository;
  receipts: CommandReceipts;
  workspaces: Workspaces;
  defaultModel?: string;
  // Project credentials and permissions for actions, and the runner that contains their processes.
  credentials?: Credentials;
  runner?: ProcessRunner;
  fetch?: typeof fetch;
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

type HandoffRef = { kind?: string; id?: string };

// The handoffs an agent reads: those that came in with its input, unless it is to start without
// them, then those of the named agents' latest successful executions on this run's path. Each is
// listed once, with the node whose execution wrote it, which may lie before nodes it passed through.
// A reference is only ever a hint: it is handed on only when Shift itself recorded a handoff by
// that ID from a successful execution on this path. A human report, another run's artifact or an
// unknown ID in the context is ignored, as is a handoff from a turn that was later corrected, so a forged reference can never become trusted context.
function receivedHandoffs(
  context: ExecutionContext,
  selection: { incoming?: boolean; nodes?: string[] },
  artifactOf: (artifactId: string) => { role: string; executionId: string | null } | null,
): NonNullable<AgentConfig['handoffs']> {
  const found: NonNullable<AgentConfig['handoffs']> = [];
  const add = (refs: unknown) => {
    for (const ref of (Array.isArray(refs) ? refs : []) as HandoffRef[])
      if (ref?.kind === 'artifact' && typeof ref.id === 'string')
        if (!found.some((item) => item.artifactId === ref.id)) {
          const artifact = artifactOf(ref.id);
          if (artifact?.role !== 'handoff') continue;
          const producer = context.chain.find((entry) => entry.id === artifact.executionId);
          // Only the successful turn's handoff is its node's; an earlier, corrected turn's stays
          // in history and is never handed on.
          const published = (producer?.output.context?.handoffs ?? []) as HandoffRef[];
          if (!producer || !published.some((own) => own?.id === ref.id)) continue;
          found.push({ artifactId: ref.id, nodeId: producer.nodeId });
        }
  };
  if (selection.incoming !== false) add(context.input.context?.handoffs);
  for (const nodeId of selection.nodes ?? []) {
    const latest = context.chain.find((entry) => entry.nodeId === nodeId);
    if (latest) add(latest.output.context?.handoffs);
  }
  return found;
}
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
  readonly actions: ActionService;
  readonly effects: EffectStore;
  readonly blobs: BlobStore;
  readonly #options: RunEngineOptions;
  readonly #tasks = new Map<string, { controller: AbortController; done: Promise<void> }>();
  readonly #cancellations = new Set<Promise<void>>();
  // Action tasks among #tasks; they do not count against the agent limit.
  readonly #actionTasks = new Set<string>();
  // Runs whose attempts are being stopped because they ran out of active time.
  readonly #limitStops = new Set<string>();
  #timer: NodeJS.Timeout | undefined;
  #wakeTimer: NodeJS.Timeout | undefined;
  #stopping = false;
  #pumping = false;

  constructor(options: RunEngineOptions) {
    this.#options = options;
    this.repository = new RunRepository(options.store.db, options.clock);
    this.blobs = options.blobs ?? new BlobStore(join(dirname(options.artifactRoot), 'blobs'));
    this.agents = new AgentService({
      repository: this.repository,
      adapter: options.adapter,
      artifactRoot: options.artifactRoot,
      blobs: this.blobs,
      logger: options.logger,
      workspaces: options.workspaces,
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    });
    this.effects = new EffectStore(options.store.db, options.clock);
    this.actions = new ActionService({
      db: options.store.db,
      repository: this.repository,
      effects: this.effects,
      logger: options.logger,
      workspaces: options.workspaces,
      ...(options.credentials ? { credentials: options.credentials } : {}),
      ...(options.runner ? { runner: options.runner } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
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
    // An owner's goal left running continues where its record says it stopped.
    for (const goal of this.repository.activeManualGoals()) this.#launchManual(goal);
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
  // Sends an owner's goal to a session outside any run. The response comes once the intent is
  // recorded; the turn runs on in the server whatever happens to the client.
  sendGoal(sessionId: string, input: unknown, actor: Actor = local): CommandResponse {
    if (this.#stopping) throw new ShiftError('SERVER_STOPPING', 'The server is stopping.', 503);
    const body = (input ?? {}) as { goal?: unknown; commandId?: unknown };
    if (
      typeof body.goal !== 'string' ||
      body.goal.trim() === '' ||
      body.goal.length > 20_000 ||
      (body.commandId !== undefined && typeof body.commandId !== 'string')
    )
      throw new ShiftError(
        'INVALID_REQUEST',
        'A goal is text of 1 to 20000 characters.',
        422,
        false,
        ['/goal'],
      );
    const id = body.commandId as string | undefined;
    const request = { op: 'session.goal', sessionId, goal: body.goal };
    const stored = id === undefined ? null : this.#options.receipts.lookup(actor, id, request);
    if (stored) return stored;
    let created: InvocationRow | undefined;
    const response = this.#options.receipts.execute(actor, id, request, () => {
      const invocationId = randomUUID();
      created = this.repository.createManualGoal(sessionId, {
        id: invocationId,
        correlationId: this.#options.adapter.correlate(invocationId).providerMessageId!,
        prompt: body.goal as string,
      });
      return { status: 202, body: { invocation: this.repository.invocationDetail(invocationId) } };
    });
    if (created) this.#launchManual(created);
    return response;
  }

  async startRun(input: unknown, actor: Actor = local): Promise<CommandResponse> {
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
    const stored = id === undefined ? null : receipts.lookup(actor, id, request);
    if (stored) return stored;
    const admitted = definitions.activeVersion(workflowId);
    const admittedProject = definitions.project(admitted.projectId);
    const baseCommit = await workspaces.resolveBase(
      admittedProject.repositoryPath,
      admittedProject.baseRef,
    );
    const response = receipts.execute(actor, id, request, () => {
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
        // The run keeps the permissions and credentials it was admitted with; later revocations
        // still apply when an action runs.
        authority: this.#options.credentials?.authority(project.id) ?? {
          denied: [],
          credentials: {},
        },
      };
      const runId = this.repository.createRun(snapshot, triggerInput);
      return { status: 201, body: { run: this.repository.run(runId) } };
    });
    this.#pump();
    return response;
  }

  // Owner control commands on a run. Each commits with its receipt; a cancellation then stops
  // running attempts in the background, and the run shows CANCEL_REQUESTED until they stopped.
  controlRun(
    runId: string,
    kind: RunControlKind,
    input: unknown,
    actor: Actor = local,
  ): CommandResponse {
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
      actor,
      id,
      { op: `run.${kind}`, runId, ...body } as Json,
      () => {
        switch (kind) {
          case 'cancel':
            stops = this.repository.requestCancel(runId, actor, id, body.reason);
            break;
          case 'retry':
            this.repository.retry(runId, actor, id);
            break;
          case 'fail':
            this.repository.fail(runId, actor, id, body.reason);
            break;
          case 'complete':
            this.repository.complete(runId, actor, id, body.data as Json);
            break;
          case 'extend':
            this.repository.extend(runId, actor, id, {
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

  // Answers a human request as `actor`, the local owner or a paired device. The response, its
  // receipt, the event and the next step commit together; a repeated command returns the stored
  // response.
  respond(interactionId: string, input: unknown, actor: Actor = local): CommandResponse {
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
      actor,
      id,
      { op: 'interaction.respond', interactionId, ...body } as Json,
      () => {
        this.repository.respond(interactionId, actor, id, body);
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
          if (pending.nodeType === 'agent' && this.#tasks.size - this.#actionTasks.size >= limit)
            continue;
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
    if (actionTypes.has(context.node.type)) {
      this.#launchAction(claim);
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
      } else if (context.node.type === 'set_variable') {
        // The value and the revision it replaces were frozen when the execution was prepared, so
        // a retry writes the same value and a newer write in between is a conflict.
        const { key, value, expectedRevision } = context.config as {
          key: string;
          value: Json;
          expectedRevision: number;
        };
        this.repository.completeExecution(claim, {
          kind: 'completed',
          output: context.input,
          port: 'success',
          variableWrites: [{ key, value, expectedRevision }],
        });
      } else if (context.node.type === 'get_variable') {
        const { value } = context.config as { value: Json };
        this.repository.completeExecution(claim, {
          kind: 'completed',
          output: envelope(value, context.input),
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
    const variables = this.repository.variables(claim.runId);
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
      variables,
    });
    let config: Json = node.config;
    if (node.type === 'set_variable') {
      const authored = node.config as { key: string; value: Json };
      config = {
        key: authored.key,
        value: renderTemplate(authored.value, bindings),
        expectedRevision: variables.get(authored.key)?.revision ?? 0,
      };
    }
    if (node.type === 'get_variable') {
      const authored = node.config as { key: string; optional?: boolean; fallback?: Json };
      const current = variables.get(authored.key);
      if (!current && !authored.optional)
        throw new ShiftError(
          'VARIABLE_MISSING',
          `Run variable ${authored.key} has not been written.`,
          422,
        );
      config = {
        key: authored.key,
        value: current ? current.value : (authored.fallback ?? null),
        revision: current?.revision ?? null,
        executionId: current?.executionId ?? null,
        ...(current ? {} : { fallback: true }),
      };
    }
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
    if (actionTypes.has(node.type)) {
      // Commands work in the run's own workspace, created on first use.
      const { baseCommit, id: projectId } = snapshot.project;
      const workspace =
        node.type === 'command' && baseCommit !== undefined && projectId !== null
          ? this.#options.workspaces.allocate({
              runId: claim.runId,
              projectId,
              repositoryPath: snapshot.project.repositoryPath,
              baseRef: snapshot.project.baseRef,
              baseCommit,
            })
          : undefined;
      config = freezeAction(
        node.type,
        node.config as Record<string, Json>,
        bindings,
        context.input.data,
        workspace?.id,
      ) as unknown as Json;
    }
    if (node.type === 'agent') {
      const authored = node.config as {
        goal: string;
        model?: string;
        readOnly?: boolean;
        resultSchema?: Json;
        limits?: Partial<AgentConfig['limits']>;
        reports?: Partial<NonNullable<AgentConfig['reports']>>;
        handoffs?: { incoming?: boolean; nodes?: string[] };
        session?: {
          strategy?: 'fresh' | 'per_run' | 'reference';
          lifetime?: 'persistent' | 'ephemeral';
          reference?: string;
        };
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
      // A referenced session cannot move, so its agent works in that session's own workspace.
      const { baseCommit, id: projectId } = snapshot.project;
      const policy: SessionPolicy =
        authored.session?.strategy === 'reference'
          ? { strategy: 'reference', sessionId: authored.session.reference! }
          : {
              strategy: authored.session?.strategy ?? 'fresh',
              lifetime: authored.session?.lifetime ?? 'persistent',
            };
      const referenced =
        policy.strategy === 'reference' ? this.#referenced(policy.sessionId, projectId) : null;
      const workspace = referenced
        ? { id: referenced.workspaceId, path: referenced.cwd }
        : baseCommit !== undefined && projectId !== null
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
        ...(workspace?.id ? { workspaceId: workspace.id } : {}),
        session: policy,
        model: parseModel(model),
        toolPolicy: { mode: authored.readOnly ? 'read_only' : 'workspace_write' },
        resultSchema: authored.resultSchema ?? defaultResultSchema,
        limits: { ...defaultLimits, ...authored.limits },
        reports: { handoff: 'required', humanReport: 'required', ...authored.reports },
        handoffs: receivedHandoffs(context, authored.handoffs ?? {}, (artifactId) => {
          try {
            return this.repository.artifact(artifactId);
          } catch {
            return null;
          }
        }),
      };
      config = resolved as unknown as Json;
    }
    this.repository.prepareExecution(claim, { config, bindings, sources });
    return { ...context, config, bindings };
  }

  // A referenced session must be this project's, persistent and not archived, in a workspace that
  // still exists. Anything else is the author's choice to fix, not something a retry changes.
  #referenced(
    sessionId: string,
    projectId: string | null,
  ): { workspaceId: string | null; cwd: string } {
    const session = this.repository.referencedSession(sessionId);
    const refuse = (message: string) => {
      throw new ShiftError('SESSION_UNAVAILABLE', message, 422);
    };
    if (!session || session.projectId !== projectId)
      return refuse(`This project has no session ${sessionId}.`);
    if (session.lifetime !== 'persistent' || session.state === 'ARCHIVED')
      return refuse(`Session ${sessionId} was archived and takes no more goals.`);
    if (session.workspaceId !== null && session.workspaceState !== 'READY')
      return refuse(`The workspace of session ${sessionId} no longer exists.`);
    return { workspaceId: session.workspaceId, cwd: session.cwd };
  }

  #fail(claim: Claim, error: unknown): void {
    try {
      this.repository.completeExecution(claim, { kind: 'failed', error: failure(error) });
    } catch (finishError) {
      if (!(finishError instanceof StaleClaim)) throw finishError;
    }
  }

  #launchManual(goal: InvocationRow): void {
    const key = `manual:${goal.id}`;
    if (this.#tasks.has(key)) return;
    const controller = new AbortController();
    const done = this.agents
      .driveManual(goal, controller.signal)
      .catch((error: unknown) => {
        this.#options.logger.error(
          { invocationId: goal.id, code: (error as { code?: string }).code },
          'An owner goal failed.',
        );
      })
      .finally(() => {
        this.#tasks.delete(key);
        // A driver that failed unexpectedly leaves its goal active; another takes it up.
        if (!this.#stopping && !controller.signal.aborted) {
          const still = this.repository.activeManualGoals().find((item) => item.id === goal.id);
          if (still) setTimeout(() => this.#stopping || this.#launchManual(still), 2_000).unref();
        }
        this.#pump();
      });
    this.#tasks.set(key, { controller, done });
  }

  // Actions run as tasks, so a cancellation or shutdown can stop their processes.
  #launchAction(claim: Claim): void {
    const controller = new AbortController();
    const done = this.actions
      .run(claim, controller.signal)
      .catch((error: unknown) => {
        this.#options.logger.error(
          { runId: claim.runId, code: (error as { code?: string }).code },
          'An action task failed.',
        );
      })
      .finally(() => {
        this.#tasks.delete(claim.attemptId);
        this.#actionTasks.delete(claim.attemptId);
        this.#pump();
      });
    this.#tasks.set(claim.attemptId, { controller, done });
    this.#actionTasks.add(claim.attemptId);
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
