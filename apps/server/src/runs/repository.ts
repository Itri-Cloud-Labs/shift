import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { HarnessSessionHandle, Json, ModelRef, ToolPolicy } from '../harness/types.js';
import { nodeType } from '../workflows/nodes.js';
import type { NodeDefinition, WorkflowDocument } from '../workflows/document.js';
import { envelope, type ChainEntry, type OutputEnvelope } from './bindings.js';
import { checkValue, type ResultEnvelope } from './envelope.js';

// A run freezes its published document, the project it runs in and the defaults it resolved
// (specification 6.1). Editing the workflow or the project later never changes it.
export interface RunSnapshot {
  formatVersion: 2;
  workflowId: string | null;
  versionId: string | null;
  versionNumber: number | null;
  document: WorkflowDocument;
  // `baseCommit` is the commit the base ref resolved to at admission. Runs admitted before
  // workspaces existed have none and work in the repository itself.
  project: {
    id: string | null;
    name: string;
    repositoryPath: string;
    baseRef: string;
    baseCommit?: string;
  };
  defaults: { model?: string };
}

// The agent node's configuration after bindings were applied, frozen per execution.
export interface AgentConfig {
  goal: string;
  cwd: string;
  // The run workspace `cwd` belongs to, if any.
  workspaceId?: string;
  model: ModelRef;
  toolPolicy: ToolPolicy;
  resultSchema: Json;
  limits: { rejectedSubmissions: number; corrections: number; continuations: number };
}

export type InvocationKind = 'goal' | 'correction' | 'continuation';
export type InvocationState =
  | 'PREPARING'
  | 'SUBMITTING'
  | 'RUNNING'
  | 'UNCERTAIN'
  | 'COMPLETED'
  | 'FAILED'
  | 'INTERRUPTED'
  | 'UNKNOWN';

export interface Claim {
  attemptId: string;
  executionId: string;
  runId: string;
  fence: number;
}

export interface InvocationRow {
  id: string;
  agentSessionId: string;
  kind: InvocationKind;
  correlationId: string;
  prompt: string;
  state: InvocationState;
  result: ResultEnvelope | null;
  error: { code: string; message: string } | null;
}

export interface SessionRow {
  agentSessionId: string;
  harnessSessionId: string | null;
  storageNamespace: string;
  cwd: string;
  state: 'CREATING' | 'READY';
}

export interface ExecutionError {
  code: string;
  category: 'input' | 'contract' | 'blocked' | 'permission' | 'external' | 'internal';
  message: string;
  details?: Json;
  // Whether another attempt may run automatically (specification 6.6). `safe` errors are retried
  // up to the node's `retry.maxAttempts`; absent means `never`. `reconcile_first` work never gets
  // here: it waits for the owner instead.
  retryDisposition?: 'safe' | 'never' | 'reconcile_first';
}

// Waiting for a durable wake-up, as shown on a WAITING run.
export type RunWait =
  | {
      kind: 'retry';
      executionId: string;
      dueAt: number;
      attempt: number;
      error: { code: string; message: string };
    }
  | { kind: 'timer'; executionId: string; dueAt: number }
  | { kind: 'human'; executionId: string; interactionId: string; expiresAt: number | null };

// A Human Input or Approval request as frozen when its execution was prepared.
export interface FrozenInteraction {
  kind: 'input' | 'approval';
  title: string;
  instructions: string | null;
  form: Json;
  outcomes: string[] | null;
  expiresAt: number | null;
}

interface InteractionRow {
  id: string;
  run_id: string;
  execution_id: string;
  attempt_id: string;
  kind: 'input' | 'approval';
  form_json: string;
  presentation_json: string;
  outcomes_json: string | null;
  state: 'PENDING' | 'RESPONDED' | 'EXPIRED' | 'CANCELLED';
  expires_at: number | null;
  created_at: number;
  settled_at: number | null;
  revision: number;
  node_id: string;
  run_state: string;
  decision: string | null;
  response_json: string | null;
  actor_kind: string | null;
  actor_id: string | null;
  responded_at: number | null;
}

const interactionSelect =
  'SELECT i.*, e.node_id, r.state AS run_state, h.decision, h.response_json, h.actor_kind, h.actor_id, h.created_at AS responded_at FROM human_interactions i JOIN node_executions e ON e.id = i.execution_id JOIN runs r ON r.id = i.run_id LEFT JOIN human_responses h ON h.id = i.accepted_response_id';

export type ExecutionOutcome =
  | { kind: 'completed'; output: OutputEnvelope; port: string }
  | { kind: 'failed'; error: ExecutionError };

export interface ExecutionContext {
  runId: string;
  executionId: string;
  node: NodeDefinition;
  input: OutputEnvelope;
  snapshot: RunSnapshot;
  config: Json | null;
  bindings: Record<string, Json> | null;
  // Successful executions on this execution's predecessor chain, nearest first.
  chain: ChainEntry[];
}

export interface Attention {
  code: string;
  explanation: string;
  invocationId?: string;
  executionId?: string;
  limit?: { scope: 'active'; value: number };
}

interface ExecutionLimit {
  // `active` is the run's active execution time in milliseconds; the others count executions.
  scope: 'run' | 'node' | 'active';
  nodeId?: string;
  value: number;
  explanation: string;
}

// Limit extensions recorded by `extend` commands.
interface RunLimits {
  maxExecutions?: number;
  nodes?: Record<string, number>;
  maxActiveMs?: number;
}

export interface ControlActor {
  kind: string;
  id: string;
}

export class StaleClaim extends Error {}

const parse = <T>(text: string | null): T | null =>
  text === null ? null : (JSON.parse(text) as T);
const formatDuration = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.round(ms / 1000)} s`;
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
};
const activeInvocationStates = "('PREPARING', 'SUBMITTING', 'RUNNING', 'UNCERTAIN')";
const activeStates = new Set<InvocationState>(['PREPARING', 'SUBMITTING', 'RUNNING', 'UNCERTAIN']);

// Runs created before definitions existed froze a fixed manual -> agent -> end graph. They are
// read as the equivalent document so they keep running after an upgrade.
interface LegacySnapshot {
  agent: {
    goal: string;
    cwd: string;
    model: ModelRef;
    toolPolicy: ToolPolicy;
    resultSchema: Json;
    limits: AgentConfig['limits'];
  };
}

function upgradeSnapshot(stored: RunSnapshot | LegacySnapshot): RunSnapshot {
  if ('document' in stored) return stored;
  const { agent } = stored;
  const node = (id: string, type: string, config: Json): NodeDefinition => ({
    id,
    type,
    typeVersion: 1,
    config,
    bindings: {},
    retry: { maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 60000 },
    limits: { maxExecutionsPerRun: 50 },
    position: { x: 0, y: 0 },
  });
  return {
    formatVersion: 2,
    workflowId: null,
    versionId: null,
    versionNumber: null,
    document: {
      formatVersion: 1,
      execution: {
        workspace: { kind: 'new' },
        overlap: 'allow',
        limits: { maxExecutions: 1000, maxActiveMs: 14_400_000 },
      },
      nodes: [
        node('start', 'manual_trigger', {}),
        node('agent', 'agent', {
          goal: agent.goal,
          model: `${agent.model.providerID}/${agent.model.id}`,
          readOnly: agent.toolPolicy.mode === 'read_only',
          resultSchema: agent.resultSchema,
          limits: agent.limits,
        }),
        node('end', 'end', {}),
      ],
      connections: [
        { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'agent', toPort: 'input' },
        { id: 'c2', fromNodeId: 'agent', fromPort: 'success', toNodeId: 'end', toPort: 'input' },
      ],
      presentation: {},
    },
    project: { id: null, name: 'legacy', repositoryPath: agent.cwd, baseRef: 'HEAD' },
    defaults: {},
  };
}

// Synchronous repository over short transactions. Every state change made by a worker checks its
// attempt fence in the same transaction, so a stale task can never advance a run.
export class RunRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
  ) {}

  #event(
    type: string,
    refs: { runId?: string; executionId?: string; sessionId?: string },
    payload: Json,
  ): void {
    this.db
      .prepare(
        'INSERT INTO events (type, schema_version, run_id, execution_id, session_id, payload_json, created_at) VALUES (?, 1, ?, ?, ?, ?, ?)',
      )
      .run(
        type,
        refs.runId ?? null,
        refs.executionId ?? null,
        refs.sessionId ?? null,
        JSON.stringify(payload),
        this.clock.now(),
      );
  }

  #fenced(claim: Claim): void {
    const row = this.db
      .prepare("SELECT fence FROM node_attempts WHERE id = ? AND state = 'RUNNING'")
      .get(claim.attemptId) as { fence: number } | undefined;
    if (row?.fence !== claim.fence) throw new StaleClaim();
  }

  // The entry trigger completes immediately with the trigger input, and its successor becomes the
  // run's single pending activation, in one transaction.
  createRun(snapshot: RunSnapshot, triggerInput: Json): string {
    const runId = randomUUID();
    const now = this.clock.now();
    const entry = snapshot.document.nodes.find(
      (node) => nodeType(node.type, node.typeVersion)?.entry,
    );
    if (!entry) throw new ShiftError('INVALID_WORKFLOW', 'The workflow has no entry node.', 422);
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "INSERT INTO runs (id, snapshot_json, state, revision, created_at, project_id, workflow_id, workflow_version_id, trigger_input_json) VALUES (?, ?, 'RUNNING', 0, ?, ?, ?, ?, ?)",
          )
          .run(
            runId,
            JSON.stringify(snapshot),
            now,
            snapshot.project.id,
            snapshot.workflowId,
            snapshot.versionId,
            JSON.stringify(triggerInput),
          );
        const triggerId = randomUUID();
        const output = envelope(triggerInput);
        this.db
          .prepare(
            "INSERT INTO node_executions (id, run_id, node_id, node_type, sequence, input_json, state, output_json, selected_port, started_at, finished_at, revision) VALUES (?, ?, ?, ?, 1, ?, 'COMPLETED', ?, 'success', ?, ?, 0)",
          )
          .run(
            triggerId,
            runId,
            entry.id,
            entry.type,
            JSON.stringify(output),
            JSON.stringify(output),
            now,
            now,
          );
        this.#event('run.created', { runId }, { versionId: snapshot.versionId });
        this.#schedule(runId, snapshot, { id: triggerId, nodeId: entry.id }, 'success', output);
      })
      .immediate();
    return runId;
  }

  // Follows the selected port's single connection: a successor activation, a leaf completion, or
  // an owner decision when an execution limit is reached. Called inside the completing transaction.
  #schedule(
    runId: string,
    snapshot: RunSnapshot,
    from: { id: string; nodeId: string },
    port: string,
    output: OutputEnvelope,
  ): void {
    const now = this.clock.now();
    const connection = snapshot.document.connections.find(
      (candidate) => candidate.fromNodeId === from.nodeId && candidate.fromPort === port,
    );
    if (!connection) {
      // A selected port without an edge is a successful leaf.
      this.#finishRun(runId, 'COMPLETED', { data: output.data });
      return;
    }
    const target = snapshot.document.nodes.find((node) => node.id === connection.toNodeId)!;
    const counts = this.db
      .prepare(
        'SELECT COUNT(*) AS total, SUM(node_id = ?) AS node, MAX(sequence) AS sequence FROM node_executions WHERE run_id = ?',
      )
      .get(target.id, runId) as { total: number; node: number | null; sequence: number };
    // Owner extensions raise the snapshot's limits without editing it (specification 6.7).
    const extended = this.#limits(runId);
    const runLimit = extended.maxExecutions ?? snapshot.document.execution.limits.maxExecutions;
    const nodeLimit = extended.nodes?.[target.id] ?? target.limits.maxExecutionsPerRun;
    const activeLimit = this.#activeLimit(runId, snapshot);
    const limit: ExecutionLimit | null =
      this.#activeMs(runId) >= activeLimit
        ? {
            scope: 'active',
            value: activeLimit,
            explanation: `The run used its ${formatDuration(activeLimit)} of active execution time.`,
          }
        : counts.total >= runLimit
          ? {
              scope: 'run',
              value: runLimit,
              explanation: `The run reached its limit of ${runLimit} executions.`,
            }
          : (counts.node ?? 0) >= nodeLimit
            ? {
                scope: 'node',
                nodeId: target.id,
                value: nodeLimit,
                explanation: `Node ${target.id} reached its limit of ${nodeLimit} executions.`,
              }
            : null;
    if (limit) {
      // Exhaustion enters NEEDS_HUMAN before another activation (specification 6.7). The attention
      // keeps what the next step needs, so an extension can resume exactly here.
      const { explanation, ...rest } = limit;
      this.db
        .prepare(
          "UPDATE runs SET state = 'NEEDS_HUMAN', attention_json = ?, revision = revision + 1 WHERE id = ?",
        )
        .run(
          JSON.stringify({
            code: limit.scope === 'active' ? 'ACTIVE_TIME_LIMIT' : 'EXECUTION_LIMIT',
            explanation,
            executionId: from.id,
            port,
            limit: rest,
          }),
          runId,
        );
      this.#event(
        'run.needs_human',
        { runId, executionId: from.id },
        { code: limit.scope === 'active' ? 'ACTIVE_TIME_LIMIT' : 'EXECUTION_LIMIT' },
      );
      return;
    }
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO node_executions (id, run_id, node_id, node_type, sequence, predecessor_execution_id, incoming_connection_id, input_json, state, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)",
      )
      .run(
        id,
        runId,
        target.id,
        target.type,
        counts.sequence + 1,
        from.id,
        connection.id,
        JSON.stringify(output),
      );
    this.#event('execution.scheduled', { runId, executionId: id }, { nodeId: target.id, at: now });
  }

  #finishRun(runId: string, state: 'COMPLETED' | 'FAILED', outcome: Json): void {
    this.db
      .prepare(
        'UPDATE runs SET state = ?, outcome_json = ?, finished_at = ?, revision = revision + 1 WHERE id = ?',
      )
      .run(state, JSON.stringify(outcome), this.clock.now(), runId);
    this.#event(state === 'COMPLETED' ? 'run.completed' : 'run.failed', { runId }, outcome);
  }

  pendingExecutions(): Array<{ id: string; nodeType: string }> {
    return (
      this.db
        .prepare(
          "SELECT e.id, e.node_type, e.node_id FROM node_executions e JOIN runs r ON r.id = e.run_id WHERE e.state = 'PENDING' AND r.state = 'RUNNING' ORDER BY r.created_at, e.sequence",
        )
        .all() as Array<{ id: string; node_type: string | null; node_id: string }>
    ).map((row) => ({ id: row.id, nodeType: row.node_type ?? row.node_id }));
  }

  claimAttempt(executionId: string, workerGeneration: string): Claim | null {
    return this.db
      .transaction(() => {
        const execution = this.db
          .prepare("SELECT run_id FROM node_executions WHERE id = ? AND state = 'PENDING'")
          .get(executionId) as { run_id: string } | undefined;
        if (!execution) return null;
        const attemptId = randomUUID();
        const now = this.clock.now();
        // An owner retry reopens the execution; its next attempt keeps the earlier ones in history.
        this.db
          .prepare(
            "INSERT INTO node_attempts (id, execution_id, attempt_number, state, worker_generation, fence, started_at) VALUES (?, ?, (SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM node_attempts WHERE execution_id = ?), 'RUNNING', ?, 1, ?)",
          )
          .run(attemptId, executionId, executionId, workerGeneration, now);
        this.db
          .prepare(
            "UPDATE node_executions SET state = 'RUNNING', started_at = ?, revision = revision + 1 WHERE id = ?",
          )
          .run(now, executionId);
        this.#event('execution.started', { runId: execution.run_id, executionId }, { attemptId });
        return { attemptId, executionId, runId: execution.run_id, fence: 1 };
      })
      .immediate();
  }

  // Attempts left running by an earlier worker generation are resumed, not replayed: the same
  // attempt continues under a new fence after its harness state has been inspected.
  reclaimOrphanedAttempts(workerGeneration: string): Claim[] {
    return this.db
      .transaction(() => {
        const orphans = this.db
          .prepare(
            "SELECT a.id, a.execution_id, e.run_id FROM node_attempts a JOIN node_executions e ON e.id = a.execution_id JOIN runs r ON r.id = e.run_id WHERE a.state = 'RUNNING' AND r.state = 'RUNNING' AND a.worker_generation IS NOT ?",
          )
          .all(workerGeneration) as Array<{ id: string; execution_id: string; run_id: string }>;
        return orphans.map((orphan) => {
          this.#chargeRecovered(orphan.run_id, orphan.execution_id, orphan.id);
          this.db
            .prepare(
              'UPDATE node_attempts SET fence = fence + 1, worker_generation = ? WHERE id = ?',
            )
            .run(workerGeneration, orphan.id);
          const { fence } = this.db
            .prepare('SELECT fence FROM node_attempts WHERE id = ?')
            .get(orphan.id) as { fence: number };
          this.#event(
            'attempt.recovering',
            { runId: orphan.run_id, executionId: orphan.execution_id },
            { attemptId: orphan.id },
          );
          return {
            attemptId: orphan.id,
            executionId: orphan.execution_id,
            runId: orphan.run_id,
            fence,
          };
        });
      })
      .immediate();
  }

  snapshot(runId: string): RunSnapshot {
    const row = this.db.prepare('SELECT snapshot_json FROM runs WHERE id = ?').get(runId) as
      { snapshot_json: string } | undefined;
    if (!row) throw new ShiftError('RUN_NOT_FOUND', 'Run not found.', 404);
    return upgradeSnapshot(JSON.parse(row.snapshot_json) as RunSnapshot | LegacySnapshot);
  }

  execution(executionId: string): ExecutionContext {
    const row = this.db
      .prepare(
        'SELECT e.run_id, e.node_id, e.input_json, e.config_json, e.bindings_json, e.predecessor_execution_id FROM node_executions e WHERE e.id = ?',
      )
      .get(executionId) as
      | {
          run_id: string;
          node_id: string;
          input_json: string;
          config_json: string | null;
          bindings_json: string | null;
          predecessor_execution_id: string | null;
        }
      | undefined;
    if (!row) throw new ShiftError('NOT_FOUND', 'Execution not found.', 404);
    const snapshot = this.snapshot(row.run_id);
    const node = snapshot.document.nodes.find((candidate) => candidate.id === row.node_id);
    if (!node) throw new ShiftError('INTERNAL_ERROR', 'The execution names an unknown node.');
    const chain: ChainEntry[] = [];
    const previous = this.db.prepare(
      'SELECT id, node_id, sequence, state, output_json, predecessor_execution_id FROM node_executions WHERE id = ?',
    );
    let cursor = row.predecessor_execution_id;
    while (cursor) {
      const entry = previous.get(cursor) as {
        node_id: string;
        sequence: number;
        state: string;
        output_json: string | null;
        predecessor_execution_id: string | null;
      };
      // Failed results stay in history but never become `latest` successful output.
      if (entry.state === 'COMPLETED' && entry.output_json) {
        chain.push({
          nodeId: entry.node_id,
          sequence: entry.sequence,
          output: JSON.parse(entry.output_json) as OutputEnvelope,
        });
      }
      cursor = entry.predecessor_execution_id;
    }
    return {
      runId: row.run_id,
      executionId,
      node,
      input: JSON.parse(row.input_json) as OutputEnvelope,
      snapshot,
      config: parse<Json>(row.config_json),
      bindings: parse<Record<string, Json>>(row.bindings_json),
      chain,
    };
  }

  // Bindings and resolved configuration are frozen once; recovery reuses them instead of resolving
  // newer data again (specification 6.3).
  prepareExecution(claim: Claim, prepared: { config: Json; bindings: Record<string, Json> }): void {
    this.db
      .transaction(() => {
        this.#fenced(claim);
        this.db
          .prepare(
            'UPDATE node_executions SET config_json = ?, bindings_json = ?, revision = revision + 1 WHERE id = ? AND config_json IS NULL',
          )
          .run(
            JSON.stringify(prepared.config),
            JSON.stringify(prepared.bindings),
            claim.executionId,
          );
      })
      .immediate();
  }

  agentConfig(executionId: string): AgentConfig {
    const config = this.execution(executionId).config;
    if (!config) throw new ShiftError('INTERNAL_ERROR', 'The agent execution was not prepared.');
    return config as unknown as AgentConfig;
  }

  session(executionId: string): SessionRow | null {
    const row = this.db
      .prepare(
        'SELECT s.id, s.cwd, h.harness_session_id, h.storage_namespace, h.state FROM node_executions e JOIN agent_sessions s ON s.id = e.agent_session_id JOIN harness_sessions h ON h.agent_session_id = s.id WHERE e.id = ?',
      )
      .get(executionId) as
      | {
          id: string;
          cwd: string;
          harness_session_id: string | null;
          storage_namespace: string;
          state: 'CREATING' | 'READY';
        }
      | undefined;
    return row
      ? {
          agentSessionId: row.id,
          harnessSessionId: row.harness_session_id,
          storageNamespace: row.storage_namespace,
          cwd: row.cwd,
          state: row.state,
        }
      : null;
  }

  // The Shift session is bound before its harness conversation exists, so a crash between the two
  // is reconciled by repeating the idempotent harness creation.
  bindSession(
    claim: Claim,
    session: { harnessId: string; cwd: string; config: Json; storageNamespace: string },
  ): SessionRow {
    return this.db
      .transaction(() => {
        this.#fenced(claim);
        const agentSessionId = randomUUID();
        this.db
          .prepare(
            "INSERT INTO agent_sessions (id, created_by_run_id, harness_id, cwd, config_json, lifetime, state, created_at, revision) VALUES (?, ?, ?, ?, ?, 'ephemeral', 'CREATING', ?, 0)",
          )
          .run(
            agentSessionId,
            claim.runId,
            session.harnessId,
            session.cwd,
            JSON.stringify(session.config),
            this.clock.now(),
          );
        this.db
          .prepare(
            "INSERT INTO harness_sessions (id, agent_session_id, adapter_version, storage_namespace, state) VALUES (?, ?, ?, ?, 'CREATING')",
          )
          .run(randomUUID(), agentSessionId, session.harnessId, session.storageNamespace);
        this.db
          .prepare(
            'UPDATE node_executions SET agent_session_id = ?, revision = revision + 1 WHERE id = ?',
          )
          .run(agentSessionId, claim.executionId);
        this.#event(
          'session.bound',
          { runId: claim.runId, executionId: claim.executionId, sessionId: agentSessionId },
          {},
        );
        return {
          agentSessionId,
          harnessSessionId: null,
          storageNamespace: session.storageNamespace,
          cwd: session.cwd,
          state: 'CREATING' as const,
        };
      })
      .immediate();
  }

  markSessionReady(claim: Claim, handle: HarnessSessionHandle): void {
    this.db
      .transaction(() => {
        this.#fenced(claim);
        this.db
          .prepare(
            "UPDATE harness_sessions SET harness_session_id = ?, state = 'READY', verified_at = ? WHERE agent_session_id = ?",
          )
          .run(handle.harnessSessionId, this.clock.now(), handle.shiftSessionId);
        this.db
          .prepare("UPDATE agent_sessions SET state = 'BUSY', revision = revision + 1 WHERE id = ?")
          .run(handle.shiftSessionId);
      })
      .immediate();
  }

  invocations(attemptId: string): InvocationRow[] {
    return (
      this.db
        .prepare(
          'SELECT id, agent_session_id, kind, correlation_id, prompt_json, state, result_json, error_json FROM agent_invocations WHERE attempt_id = ? ORDER BY created_at, rowid',
        )
        .all(attemptId) as Array<{
        id: string;
        agent_session_id: string;
        kind: InvocationKind;
        correlation_id: string;
        prompt_json: string;
        state: InvocationState;
        result_json: string | null;
        error_json: string | null;
      }>
    ).map((row) => ({
      id: row.id,
      agentSessionId: row.agent_session_id,
      kind: row.kind,
      correlationId: row.correlation_id,
      prompt: (JSON.parse(row.prompt_json) as { text: string }).text,
      state: row.state,
      result: parse<ResultEnvelope>(row.result_json),
      error: parse<{ code: string; message: string }>(row.error_json),
    }));
  }

  createInvocation(
    claim: Claim,
    invocation: {
      id: string;
      agentSessionId: string;
      kind: InvocationKind;
      correlationId: string;
      prompt: string;
      previousInvocationId: string | null;
    },
  ): void {
    this.db
      .transaction(() => {
        this.#fenced(claim);
        this.db
          .prepare(
            "INSERT INTO agent_invocations (id, agent_session_id, execution_id, attempt_id, previous_invocation_id, kind, correlation_id, prompt_json, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PREPARING', ?)",
          )
          .run(
            invocation.id,
            invocation.agentSessionId,
            claim.executionId,
            claim.attemptId,
            invocation.previousInvocationId,
            invocation.kind,
            invocation.correlationId,
            JSON.stringify({ text: invocation.prompt }),
            this.clock.now(),
          );
        this.#event(
          'invocation.created',
          {
            runId: claim.runId,
            executionId: claim.executionId,
            sessionId: invocation.agentSessionId,
          },
          { invocationId: invocation.id, kind: invocation.kind },
        );
      })
      .immediate();
  }

  // Compare-and-set on the invocation state, under the attempt fence.
  transitionInvocation(
    claim: Claim,
    invocationId: string,
    from: readonly InvocationState[],
    to: InvocationState,
    fields: { runtimeGeneration?: number; error?: Json } = {},
  ): void {
    this.db
      .transaction(() => {
        this.#fenced(claim);
        const now = this.clock.now();
        const terminal = ['COMPLETED', 'FAILED', 'INTERRUPTED', 'UNKNOWN'].includes(to);
        const changed = this.db
          .prepare(
            `UPDATE agent_invocations SET state = ?, runtime_generation = COALESCE(?, runtime_generation), submitted_at = CASE WHEN ? = 'RUNNING' THEN COALESCE(submitted_at, ?) ELSE submitted_at END, finished_at = CASE WHEN ? THEN ? ELSE finished_at END, error_json = COALESCE(?, error_json) WHERE id = ? AND state IN (${from.map(() => '?').join(', ')})`,
          )
          .run(
            to,
            fields.runtimeGeneration ?? null,
            to,
            now,
            terminal ? 1 : 0,
            now,
            fields.error === undefined ? null : JSON.stringify(fields.error),
            invocationId,
            ...from,
          ).changes;
        if (changed !== 1) throw new StaleClaim();
        this.#event(
          'invocation.state',
          { runId: claim.runId, executionId: claim.executionId },
          { invocationId, state: to },
        );
      })
      .immediate();
  }

  submissionCounts(invocationId: string): {
    accepted: boolean;
    rejected: number;
    result: ResultEnvelope | null;
  } {
    const counts = this.db
      .prepare(
        'SELECT COALESCE(SUM(accepted), 0) AS accepted, COALESCE(SUM(1 - accepted), 0) AS rejected FROM agent_result_submissions WHERE invocation_id = ?',
      )
      .get(invocationId) as { accepted: number; rejected: number };
    const row = this.db
      .prepare('SELECT result_json FROM agent_invocations WHERE id = ?')
      .get(invocationId) as { result_json: string | null } | undefined;
    return {
      accepted: counts.accepted > 0,
      rejected: counts.rejected,
      result: parse<ResultEnvelope>(row?.result_json ?? null),
    };
  }

  // Persists a result-tool call and its verdict in one transaction before the agent hears it.
  // The same tool call delivered twice gets the stored verdict.
  recordSubmission(
    submission: {
      harnessSessionId: string;
      assistantMessageId: string;
      toolCallId: string;
      input: unknown;
    },
    judge: (
      config: AgentConfig,
      input: unknown,
    ) => { accepted: true; envelope: ResultEnvelope } | { accepted: false; reason: string },
  ): { accepted: true } | { accepted: false; reason: string } {
    return this.db
      .transaction(() => {
        const active = this.db
          .prepare(
            `SELECT i.id, i.execution_id, e.run_id FROM harness_sessions h JOIN agent_invocations i ON i.agent_session_id = h.agent_session_id JOIN node_executions e ON e.id = i.execution_id WHERE h.harness_session_id = ? AND i.state IN ${activeInvocationStates}`,
          )
          .get(submission.harnessSessionId) as
          { id: string; execution_id: string; run_id: string } | undefined;
        if (!active) {
          return { accepted: false as const, reason: 'no Shift task is active in this session' };
        }
        const previous = this.db
          .prepare(
            'SELECT accepted, reason FROM agent_result_submissions WHERE invocation_id = ? AND tool_call_id = ?',
          )
          .get(active.id, submission.toolCallId) as
          { accepted: number; reason: string | null } | undefined;
        if (previous) {
          return previous.accepted
            ? { accepted: true as const }
            : { accepted: false as const, reason: previous.reason ?? 'rejected' };
        }
        const counts = this.db
          .prepare(
            'SELECT SUM(accepted) AS accepted, SUM(1 - accepted) AS rejected FROM agent_result_submissions WHERE invocation_id = ?',
          )
          .get(active.id) as { accepted: number | null; rejected: number | null };
        const config = this.agentConfig(active.execution_id);
        let verdict:
          { accepted: true; envelope: ResultEnvelope } | { accepted: false; reason: string };
        if (counts.accepted) {
          verdict = { accepted: false, reason: 'a result was already accepted; end your turn' };
        } else if ((counts.rejected ?? 0) >= config.limits.rejectedSubmissions) {
          verdict = { accepted: false, reason: 'too many rejected results; end your turn' };
        } else {
          verdict = judge(config, submission.input);
        }
        this.db
          .prepare(
            'INSERT INTO agent_result_submissions (id, invocation_id, tool_call_id, assistant_message_id, input_json, accepted, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            randomUUID(),
            active.id,
            submission.toolCallId,
            submission.assistantMessageId,
            JSON.stringify(submission.input ?? null),
            verdict.accepted ? 1 : 0,
            verdict.accepted ? null : verdict.reason,
            this.clock.now(),
          );
        if (verdict.accepted) {
          this.db
            .prepare('UPDATE agent_invocations SET result_json = ? WHERE id = ?')
            .run(JSON.stringify(verdict.envelope), active.id);
        }
        this.#event(
          'result.submitted',
          { runId: active.run_id, executionId: active.execution_id },
          { invocationId: active.id, accepted: verdict.accepted },
        );
        return verdict.accepted
          ? { accepted: true as const }
          : { accepted: false as const, reason: verdict.reason };
      })
      .immediate();
  }

  // Completion and scheduling the successor are one transaction (specification 4.2). An End node
  // finishes the run with its declared outcome. A failure follows the node's `error` connection
  // when there is one, carrying a machine-readable error envelope; otherwise the run fails.
  completeExecution(claim: Claim, outcome: ExecutionOutcome): void {
    this.db
      .transaction(() => {
        this.#fenced(claim);
        this.#finishExecution(claim, outcome);
      })
      .immediate();
  }

  // Records an execution's outcome and routes the run. `attemptId` is null for an owner decision
  // about an execution whose attempt already stopped. Called inside a transaction.
  #finishExecution(
    claim: { runId: string; executionId: string; attemptId: string | null },
    outcome: ExecutionOutcome,
  ): void {
    const now = this.clock.now();
    const context = this.execution(claim.executionId);
    const { node, snapshot } = context;
    if (
      outcome.kind === 'failed' &&
      claim.attemptId !== null &&
      outcome.error.retryDisposition === 'safe' &&
      this.#runState(claim.runId) === 'RUNNING' &&
      this.#scheduleRetry({ ...claim, attemptId: claim.attemptId }, node, outcome.error)
    ) {
      return;
    }
    const completed = outcome.kind === 'completed';
    const output = completed ? outcome.output : null;
    const error = completed ? null : outcome.error;
    if (claim.attemptId !== null) {
      this.#charge(claim.runId, claim.attemptId);
      this.db
        .prepare('UPDATE node_attempts SET state = ?, finished_at = ?, error_json = ? WHERE id = ?')
        .run(
          completed ? 'COMPLETED' : 'FAILED',
          now,
          error && JSON.stringify(error),
          claim.attemptId,
        );
    }
    this.db
      .prepare(
        'UPDATE node_executions SET state = ?, output_json = ?, error_json = ?, selected_port = ?, finished_at = ?, revision = revision + 1 WHERE id = ?',
      )
      .run(
        completed ? 'COMPLETED' : 'FAILED',
        output && JSON.stringify(output),
        error && JSON.stringify(error),
        completed ? outcome.port : null,
        now,
        claim.executionId,
      );
    this.db
      .prepare(
        "UPDATE agent_sessions SET state = 'ARCHIVED', archived_at = ?, revision = revision + 1 WHERE id = (SELECT agent_session_id FROM node_executions WHERE id = ?) AND lifetime = 'ephemeral'",
      )
      .run(now, claim.executionId);
    this.#event(
      completed ? 'execution.completed' : 'execution.failed',
      { runId: claim.runId, executionId: claim.executionId },
      completed ? { port: outcome.port } : (error as unknown as Json),
    );
    const from = { id: claim.executionId, nodeId: node.id };
    // Cancellation wins: an outcome that arrives while the run is being cancelled is recorded,
    // but the run takes no further step.
    if (this.#runState(claim.runId) === 'CANCEL_REQUESTED') return;
    if (completed) {
      if (node.type === 'end') {
        const config = (node.config ?? {}) as {
          outcome?: 'COMPLETED' | 'FAILED';
          reason?: string;
        };
        this.#finishRun(claim.runId, config.outcome ?? 'COMPLETED', {
          data: outcome.output.data,
          ...(config.reason === undefined ? {} : { reason: config.reason }),
        });
      } else {
        this.#schedule(claim.runId, snapshot, from, outcome.port, outcome.output);
      }
      return;
    }
    const handled = snapshot.document.connections.some(
      (connection) => connection.fromNodeId === node.id && connection.fromPort === 'error',
    );
    if (handled) {
      this.#schedule(
        claim.runId,
        snapshot,
        from,
        'error',
        envelope({ error: { ...outcome.error } as Json }, context.input),
      );
    } else {
      this.#finishRun(claim.runId, 'FAILED', outcome.error as unknown as Json);
    }
  }

  // A safely retryable failure with attempts left: the attempt fails, and the execution and run
  // wait for a durable wake-up after a capped exponential backoff with jitter. The next attempt
  // keeps the execution's frozen input and session. Returns false when no attempt is left.
  #scheduleRetry(
    claim: { runId: string; executionId: string; attemptId: string },
    node: NodeDefinition,
    error: ExecutionError,
  ): boolean {
    const attempts = (
      this.db
        .prepare('SELECT COUNT(*) AS count FROM node_attempts WHERE execution_id = ?')
        .get(claim.executionId) as { count: number }
    ).count;
    if (attempts >= node.retry.maxAttempts) return false;
    const now = this.clock.now();
    const backoff = Math.min(
      node.retry.maxDelayMs,
      node.retry.initialDelayMs * 2 ** Math.min(attempts - 1, 30),
    );
    // Half fixed, half random, so retries of runs that failed together spread out.
    const dueAt = now + Math.round(backoff / 2 + (Math.random() * backoff) / 2);
    this.#charge(claim.runId, claim.attemptId);
    this.db
      .prepare(
        "UPDATE node_attempts SET state = 'FAILED', finished_at = ?, error_json = ? WHERE id = ?",
      )
      .run(now, JSON.stringify(error), claim.attemptId);
    this.db
      .prepare("UPDATE node_executions SET state = 'WAITING', revision = revision + 1 WHERE id = ?")
      .run(claim.executionId);
    this.db
      .prepare("UPDATE runs SET state = 'WAITING', revision = revision + 1 WHERE id = ?")
      .run(claim.runId);
    const payload = {
      attempt: attempts + 1,
      error: { code: error.code, message: error.message },
    };
    this.db
      .prepare(
        "INSERT INTO wakeups (id, run_id, execution_id, reason, due_at, state, payload_json, created_at) VALUES (?, ?, ?, 'retry', ?, 'PENDING', ?, ?)",
      )
      .run(randomUUID(), claim.runId, claim.executionId, dueAt, JSON.stringify(payload), now);
    this.#event(
      'execution.retry_scheduled',
      { runId: claim.runId, executionId: claim.executionId },
      { ...payload, dueAt },
    );
    return true;
  }

  // Fires every wake-up that is due. A retry wake-up reopens its execution for the next attempt;
  // one whose run moved on, for example because it was cancelled, settles without effect.
  fireDueWakeups(): number {
    return this.db
      .transaction(() => {
        const now = this.clock.now();
        const due = this.db
          .prepare(
            "SELECT id, run_id, execution_id, reason FROM wakeups WHERE state = 'PENDING' AND due_at <= ? ORDER BY due_at, rowid",
          )
          .all(now) as Array<{ id: string; run_id: string; execution_id: string; reason: string }>;
        for (const wakeup of due) {
          this.db
            .prepare("UPDATE wakeups SET state = 'FIRED', settled_at = ? WHERE id = ?")
            .run(now, wakeup.id);
          if (wakeup.reason === 'timer') {
            this.#finishWait(wakeup.run_id, wakeup.execution_id);
            continue;
          }
          if (wakeup.reason === 'deadline') {
            this.#expireInteraction(wakeup.execution_id);
            continue;
          }
          const reopened = this.db
            .prepare(
              "UPDATE node_executions SET state = 'PENDING', revision = revision + 1 WHERE id = ? AND state = 'WAITING' AND run_id IN (SELECT id FROM runs WHERE state = 'WAITING')",
            )
            .run(wakeup.execution_id).changes;
          if (reopened === 0) continue;
          this.#resume(wakeup.run_id);
          this.#event(
            'execution.retrying',
            { runId: wakeup.run_id, executionId: wakeup.execution_id },
            {},
          );
        }
        return due.length;
      })
      .immediate();
  }

  // A Wait node holds its execution and run in WAITING until its deadline. Its attempt waits too,
  // so it accrues no active time. The deadline was fixed when the execution was prepared.
  startWait(claim: Claim, dueAt: number): void {
    this.db
      .transaction(() => {
        this.#fenced(claim);
        const now = this.clock.now();
        this.#charge(claim.runId, claim.attemptId);
        this.db
          .prepare("UPDATE node_attempts SET state = 'WAITING' WHERE id = ?")
          .run(claim.attemptId);
        this.db
          .prepare(
            "UPDATE node_executions SET state = 'WAITING', revision = revision + 1 WHERE id = ?",
          )
          .run(claim.executionId);
        this.db
          .prepare("UPDATE runs SET state = 'WAITING', revision = revision + 1 WHERE id = ?")
          .run(claim.runId);
        this.db
          .prepare(
            "INSERT INTO wakeups (id, run_id, execution_id, reason, due_at, state, payload_json, created_at) VALUES (?, ?, ?, 'timer', ?, 'PENDING', '{}', ?)",
          )
          .run(randomUUID(), claim.runId, claim.executionId, dueAt, now);
        this.#event(
          'execution.waiting',
          { runId: claim.runId, executionId: claim.executionId },
          { kind: 'timer', dueAt },
        );
      })
      .immediate();
  }

  // A due timer passes the Wait node's input through and routes the run, once: only an execution
  // and run that are still WAITING continue. Called inside the firing transaction.
  #finishWait(runId: string, executionId: string): void {
    const waiting = this.db
      .prepare(
        "SELECT a.id FROM node_attempts a JOIN node_executions e ON e.id = a.execution_id JOIN runs r ON r.id = e.run_id WHERE a.execution_id = ? AND a.state = 'WAITING' AND e.state = 'WAITING' AND r.state = 'WAITING'",
      )
      .get(executionId) as { id: string } | undefined;
    if (!waiting) return;
    this.#resume(runId);
    this.#finishExecution(
      { runId, executionId, attemptId: waiting.id },
      { kind: 'completed', output: this.execution(executionId).input, port: 'success' },
    );
  }

  // ---- Human interactions (specification 6.6) ----

  // Creates the interaction with its frozen form, and puts the attempt, execution and run in
  // WAITING, in one transaction. Nothing runs after it until a response or the deadline.
  startInteraction(claim: Claim, frozen: FrozenInteraction): void {
    this.db
      .transaction(() => {
        this.#fenced(claim);
        const now = this.clock.now();
        const id = randomUUID();
        this.#charge(claim.runId, claim.attemptId);
        this.db
          .prepare("UPDATE node_attempts SET state = 'WAITING' WHERE id = ?")
          .run(claim.attemptId);
        this.db
          .prepare(
            "UPDATE node_executions SET state = 'WAITING', revision = revision + 1 WHERE id = ?",
          )
          .run(claim.executionId);
        this.db
          .prepare("UPDATE runs SET state = 'WAITING', revision = revision + 1 WHERE id = ?")
          .run(claim.runId);
        this.db
          .prepare(
            "INSERT INTO human_interactions (id, run_id, execution_id, attempt_id, kind, form_json, presentation_json, outcomes_json, state, expires_at, created_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 0)",
          )
          .run(
            id,
            claim.runId,
            claim.executionId,
            claim.attemptId,
            frozen.kind,
            JSON.stringify(frozen.form),
            JSON.stringify({ title: frozen.title, instructions: frozen.instructions }),
            frozen.outcomes && JSON.stringify(frozen.outcomes),
            frozen.expiresAt,
            now,
          );
        if (frozen.expiresAt !== null) {
          this.db
            .prepare(
              "INSERT INTO wakeups (id, run_id, execution_id, reason, due_at, state, payload_json, created_at) VALUES (?, ?, ?, 'deadline', ?, 'PENDING', ?, ?)",
            )
            .run(
              randomUUID(),
              claim.runId,
              claim.executionId,
              frozen.expiresAt,
              JSON.stringify({ interactionId: id }),
              now,
            );
        }
        this.#event(
          'interaction.requested',
          { runId: claim.runId, executionId: claim.executionId },
          { interactionId: id, kind: frozen.kind },
        );
      })
      .immediate();
  }

  // Records the first valid response, then completes the execution and routes the run, all in the
  // caller's command transaction. A request that was already answered, cancelled or expired is
  // refused, so exactly one response and one successor are ever recorded.
  respond(
    interactionId: string,
    actor: ControlActor,
    commandId: string | undefined,
    input: { revision: number; decision?: string; response?: Json },
  ): void {
    this.db
      .transaction(() => {
        const row = this.#interactionRow(interactionId);
        if (row.state === 'CANCELLED' || row.state === 'EXPIRED') {
          throw new ShiftError(
            'INTERACTION_RETIRED',
            `The request was ${row.state === 'CANCELLED' ? 'cancelled' : 'not answered before its deadline'} and no longer accepts responses.`,
            410,
          );
        }
        if (row.state === 'RESPONDED') {
          throw new ShiftError(
            'INTERACTION_CONFLICT',
            `The request was already answered${row.decision ? ` with ${row.decision}` : ''} by ${row.actor_kind}:${row.actor_id} at ${new Date(row.responded_at!).toISOString()}.`,
            409,
          );
        }
        if (input.revision !== row.revision) {
          throw new ShiftError(
            'REVISION_CONFLICT',
            `The request is at revision ${row.revision}, not ${input.revision}.`,
            409,
          );
        }
        const outcomes = parse<string[]>(row.outcomes_json);
        if (row.kind === 'approval' && !outcomes!.includes(input.decision ?? '')) {
          throw new ShiftError(
            'INVALID_RESPONSE',
            `Choose one of: ${outcomes!.join(', ')}.`,
            422,
            false,
            ['/decision'],
          );
        }
        if (row.kind === 'input' && input.decision !== undefined) {
          throw new ShiftError(
            'INVALID_RESPONSE',
            'This request takes a form response, not a decision.',
            422,
            false,
            ['/decision'],
          );
        }
        const response = input.response ?? {};
        const invalid = checkValue(JSON.parse(row.form_json) as Json, response, 'response');
        if (invalid) {
          throw new ShiftError(
            'INVALID_RESPONSE',
            `The response does not match the form: ${invalid}`,
            422,
            false,
            ['/response'],
          );
        }
        const now = this.clock.now();
        const responseId = randomUUID();
        this.db
          .prepare(
            'INSERT INTO human_responses (id, interaction_id, actor_kind, actor_id, command_id, decision, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            responseId,
            interactionId,
            actor.kind,
            actor.id,
            commandId ?? null,
            input.decision ?? null,
            JSON.stringify(response),
            now,
          );
        this.db
          .prepare(
            "UPDATE human_interactions SET state = 'RESPONDED', accepted_response_id = ?, settled_at = ?, revision = revision + 1 WHERE id = ?",
          )
          .run(responseId, now, interactionId);
        this.db
          .prepare(
            "UPDATE wakeups SET state = 'CANCELLED', settled_at = ? WHERE execution_id = ? AND state = 'PENDING'",
          )
          .run(now, row.execution_id);
        this.#event(
          'interaction.responded',
          { runId: row.run_id, executionId: row.execution_id },
          {
            interactionId,
            actor: { ...actor },
            ...(input.decision === undefined ? {} : { decision: input.decision }),
          },
        );
        const context = this.execution(row.execution_id);
        const data: Json =
          row.kind === 'approval'
            ? { input: context.input.data, decision: input.decision!, response }
            : { input: context.input.data, response };
        this.#resume(row.run_id);
        this.#finishExecution(
          { runId: row.run_id, executionId: row.execution_id, attemptId: row.attempt_id },
          {
            kind: 'completed',
            output: envelope(data, context.input),
            port: row.kind === 'approval' ? input.decision! : 'success',
          },
        );
      })
      .immediate();
  }

  // A request nobody answered in time takes its `timeout` connection, or fails the node. Only a
  // still-pending request of a waiting run expires, so a response or cancellation that came first
  // wins. Called inside the firing transaction.
  #expireInteraction(executionId: string): void {
    const pending = this.db
      .prepare(
        "SELECT i.id FROM human_interactions i JOIN runs r ON r.id = i.run_id WHERE i.execution_id = ? AND i.state = 'PENDING' AND r.state = 'WAITING'",
      )
      .get(executionId) as { id: string } | undefined;
    if (!pending) return;
    const row = this.#interactionRow(pending.id);
    const now = this.clock.now();
    this.db
      .prepare(
        "UPDATE human_interactions SET state = 'EXPIRED', settled_at = ?, revision = revision + 1 WHERE id = ?",
      )
      .run(now, row.id);
    this.#event(
      'interaction.expired',
      { runId: row.run_id, executionId },
      { interactionId: row.id },
    );
    const context = this.execution(executionId);
    const claim = { runId: row.run_id, executionId, attemptId: row.attempt_id };
    this.#resume(row.run_id);
    const handled = context.snapshot.document.connections.some(
      (connection) =>
        connection.fromNodeId === context.node.id && connection.fromPort === 'timeout',
    );
    if (handled) {
      this.#finishExecution(claim, {
        kind: 'completed',
        output: envelope({ input: context.input.data, expiredAt: now }, context.input),
        port: 'timeout',
      });
      return;
    }
    const { title } = JSON.parse(row.presentation_json) as { title: string };
    this.#finishExecution(claim, {
      kind: 'failed',
      error: {
        code: 'INTERACTION_EXPIRED',
        category: 'blocked',
        message: `Nobody answered "${title}" before its deadline.`,
      },
    });
  }

  #interactionRow(id: string): InteractionRow {
    const row = this.db.prepare(`${interactionSelect} WHERE i.id = ?`).get(id) as
      InteractionRow | undefined;
    if (!row) throw new ShiftError('INTERACTION_NOT_FOUND', 'No such request.', 404);
    return row;
  }

  #interactionView(row: InteractionRow): Json {
    const presentation = JSON.parse(row.presentation_json) as {
      title: string;
      instructions: string | null;
    };
    return {
      id: row.id,
      runId: row.run_id,
      executionId: row.execution_id,
      node: row.node_id,
      kind: row.kind,
      state: row.state,
      revision: row.revision,
      title: presentation.title,
      instructions: presentation.instructions,
      form: parse<Json>(row.form_json),
      outcomes: parse<Json>(row.outcomes_json),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      settledAt: row.settled_at,
      runState: row.run_state,
      response:
        row.response_json === null
          ? null
          : {
              decision: row.decision,
              data: parse<Json>(row.response_json),
              actor: { kind: row.actor_kind, id: row.actor_id },
              createdAt: row.responded_at,
            },
    };
  }

  interaction(id: string): Json {
    return this.#interactionView(this.#interactionRow(id));
  }

  // Pending requests oldest first, or the 100 newest requests in any state.
  interactions(all = false): Json {
    const rows = this.db
      .prepare(
        all
          ? `${interactionSelect} ORDER BY i.created_at DESC, i.rowid DESC LIMIT 100`
          : `${interactionSelect} WHERE i.state = 'PENDING' ORDER BY i.created_at, i.rowid`,
      )
      .all() as InteractionRow[];
    return rows.map((row) => this.#interactionView(row));
  }

  // When the earliest pending wake-up falls due, or null when nothing waits.
  nextWakeup(): number | null {
    return (
      this.db.prepare("SELECT MIN(due_at) AS due FROM wakeups WHERE state = 'PENDING'").get() as {
        due: number | null;
      }
    ).due;
  }

  // ---- Active execution time (specification 6.7) ----
  // Only running attempts accrue time. Each charge adds the time since the attempt's last
  // checkpoint and moves the checkpoint, so time is never counted twice.

  #charge(runId: string, attemptId: string): number {
    const now = this.clock.now();
    const row = this.db
      .prepare(
        "SELECT COALESCE(checkpoint_at, started_at) AS since FROM node_attempts WHERE id = ? AND state = 'RUNNING'",
      )
      .get(attemptId) as { since: number | null } | undefined;
    if (!row || row.since === null) return 0;
    const charged = Math.max(now - row.since, 0);
    this.db.prepare('UPDATE node_attempts SET checkpoint_at = ? WHERE id = ?').run(now, attemptId);
    this.db.prepare('UPDATE runs SET active_ms = active_ms + ? WHERE id = ?').run(charged, runId);
    return charged;
  }

  // An attempt an earlier process left running: Shift cannot tell whether its tools kept working
  // between the last checkpoint and now, so the whole interval is charged and explained.
  #chargeRecovered(runId: string, executionId: string, attemptId: string): void {
    const charged = this.#charge(runId, attemptId);
    if (charged === 0) return;
    this.#event(
      'run.active_time_charged',
      { runId, executionId },
      {
        attemptId,
        chargedMs: charged,
        explanation:
          'Shift stopped while this attempt was running. Its tools may have kept working until the restart, so the time since the last checkpoint is charged in full.',
      },
    );
  }

  // Checkpoints every running attempt, then returns the running runs that have used their active
  // time, with the attempts to stop.
  checkpointActiveTime(): Array<{ runId: string; claims: Claim[] }> {
    return this.db
      .transaction(() => {
        const running = this.db
          .prepare(
            "SELECT a.id, e.run_id FROM node_attempts a JOIN node_executions e ON e.id = a.execution_id JOIN runs r ON r.id = e.run_id WHERE a.state = 'RUNNING' AND r.state IN ('RUNNING', 'CANCEL_REQUESTED')",
          )
          .all() as Array<{ id: string; run_id: string }>;
        for (const attempt of running) this.#charge(attempt.run_id, attempt.id);
        const runIds = [...new Set(running.map((attempt) => attempt.run_id))];
        return runIds
          .filter(
            (runId) =>
              this.#runState(runId) === 'RUNNING' &&
              this.#activeMs(runId) >= this.#activeLimit(runId, this.snapshot(runId)),
          )
          .map((runId) => ({ runId, claims: this.#runningClaims(runId) }));
      })
      .immediate();
  }

  // After the engine stopped attempts that ran out of active time, each still-running one stops
  // for an owner decision, like any stuck step. A stop that could not be confirmed says so.
  settleActiveLimit(claims: Claim[]): void {
    for (const claim of claims) {
      if (this.#runState(claim.runId) !== 'RUNNING') continue;
      try {
        const snapshot = this.snapshot(claim.runId);
        const value = this.#activeLimit(claim.runId, snapshot);
        const last = this.invocations(claim.attemptId).at(-1);
        const unconfirmed =
          last !== undefined && (activeStates.has(last.state) || last.state === 'UNKNOWN');
        this.needsHuman(claim, {
          code: 'ACTIVE_TIME_LIMIT',
          explanation: unconfirmed
            ? `The run used its ${formatDuration(value)} of active execution time. Shift could not confirm that the agent stopped, so its effects are unknown.`
            : `The run used its ${formatDuration(value)} of active execution time, so its agent was stopped.`,
          executionId: claim.executionId,
          limit: { scope: 'active', value },
          ...(last ? { invocationId: last.id } : {}),
        });
      } catch (error) {
        // The attempt finished first, or the run moved on; its own transition already decided.
        if (!(error instanceof StaleClaim)) throw error;
      }
    }
  }

  #activeMs(runId: string): number {
    return (
      this.db.prepare('SELECT active_ms FROM runs WHERE id = ?').get(runId) as { active_ms: number }
    ).active_ms;
  }

  #activeLimit(runId: string, snapshot: RunSnapshot): number {
    return this.#limits(runId).maxActiveMs ?? snapshot.document.execution.limits.maxActiveMs;
  }

  #limits(runId: string): RunLimits {
    const row = this.db.prepare('SELECT limits_json FROM runs WHERE id = ?').get(runId) as
      { limits_json: string | null } | undefined;
    return parse<RunLimits>(row?.limits_json ?? null) ?? {};
  }

  #runState(runId: string): string {
    return (this.db.prepare('SELECT state FROM runs WHERE id = ?').get(runId) as { state: string })
      .state;
  }

  // The attempt stops and the execution waits for an owner decision; nothing resumes it on restart.
  needsHuman(claim: Claim, attention: Attention): void {
    this.db
      .transaction(() => {
        this.#fenced(claim);
        const now = this.clock.now();
        this.#charge(claim.runId, claim.attemptId);
        this.db
          .prepare("UPDATE node_attempts SET state = 'INTERRUPTED', finished_at = ? WHERE id = ?")
          .run(now, claim.attemptId);
        this.db
          .prepare(
            "UPDATE node_executions SET state = 'WAITING', revision = revision + 1 WHERE id = ?",
          )
          .run(claim.executionId);
        this.db
          .prepare(
            "UPDATE runs SET state = 'NEEDS_HUMAN', attention_json = ?, revision = revision + 1 WHERE id = ?",
          )
          .run(JSON.stringify(attention), claim.runId);
        this.#event(
          'run.needs_human',
          { runId: claim.runId, executionId: claim.executionId },
          attention as unknown as Json,
        );
      })
      .immediate();
  }

  // ---- Owner controls (specification 6.6, 6.7 and 11.2) ----
  // Each command checks the run's state, records itself in run_controls and changes the run in one
  // transaction. Decisions about a stuck execution never fabricate harness evidence: its stopped
  // attempt and uncertain invocations stay in history as they were.

  // Requests cancellation. Waiting and pending work is cancelled at once; the returned claims are
  // running attempts the caller must stop before `settleCancellation`.
  requestCancel(
    runId: string,
    actor: ControlActor,
    commandId: string | undefined,
    reason: string | undefined,
  ): Claim[] {
    return this.db
      .transaction(() => {
        const run = this.#controlled(runId);
        if (run.state === 'CANCELLED' || run.state === 'CANCEL_REQUESTED') {
          return this.#runningClaims(runId);
        }
        this.#require(run, ['RUNNING', 'WAITING', 'NEEDS_HUMAN'], 'cancel');
        const now = this.clock.now();
        this.#control(runId, 'cancel', actor, commandId, null, reason ? { reason } : {});
        this.db
          .prepare(
            "UPDATE runs SET state = 'CANCEL_REQUESTED', cancel_requested_at = COALESCE(cancel_requested_at, ?), attention_json = NULL, revision = revision + 1 WHERE id = ?",
          )
          .run(now, runId);
        this.#cancelIdle(runId);
        this.#event('run.cancel_requested', { runId }, reason ? { reason } : {});
        const claims = this.#runningClaims(runId);
        if (claims.length === 0) this.#finishCancel(runId);
        return claims;
      })
      .immediate();
  }

  // Finishes a cancellation once its attempts were asked to stop. An attempt whose stop cannot be
  // confirmed keeps the cancellation pending and asks the owner, who cancels again after checking.
  settleCancellation(runId: string): void {
    this.db
      .transaction(() => {
        if (this.#runState(runId) !== 'CANCEL_REQUESTED') return;
        const now = this.clock.now();
        let unconfirmed = false;
        for (const claim of this.#runningClaims(runId)) {
          const last = this.invocations(claim.attemptId).at(-1);
          const uncertain =
            last !== undefined && (activeStates.has(last.state) || last.state === 'UNKNOWN');
          unconfirmed ||= uncertain;
          this.#charge(runId, claim.attemptId);
          this.db
            .prepare('UPDATE node_attempts SET state = ?, finished_at = ? WHERE id = ?')
            .run(uncertain ? 'INTERRUPTED' : 'CANCELLED', now, claim.attemptId);
          this.db
            .prepare(
              'UPDATE node_executions SET state = ?, finished_at = ?, revision = revision + 1 WHERE id = ?',
            )
            .run(uncertain ? 'WAITING' : 'CANCELLED', uncertain ? null : now, claim.executionId);
        }
        this.#cancelIdle(runId);
        if (!unconfirmed) {
          this.#finishCancel(runId);
          return;
        }
        const attention = {
          code: 'CANCEL_UNCONFIRMED',
          explanation:
            'Shift could not confirm that the agent stopped, so its effects are unknown. Check the workspace, then cancel again to finish cancelling.',
        };
        this.db
          .prepare(
            "UPDATE runs SET state = 'NEEDS_HUMAN', attention_json = ?, revision = revision + 1 WHERE id = ?",
          )
          .run(JSON.stringify(attention), runId);
        this.#event('run.needs_human', { runId }, attention);
      })
      .immediate();
  }

  // Runs whose cancellation an earlier worker generation did not finish, with their running
  // attempts reclaimed under a new fence.
  reclaimCancellations(workerGeneration: string): Array<{ runId: string; claims: Claim[] }> {
    return this.db
      .transaction(() => {
        const runs = this.db
          .prepare("SELECT id FROM runs WHERE state = 'CANCEL_REQUESTED' ORDER BY created_at")
          .all() as Array<{ id: string }>;
        return runs.map(({ id }) => {
          for (const claim of this.#runningClaims(id)) {
            this.#chargeRecovered(id, claim.executionId, claim.attemptId);
          }
          this.db
            .prepare(
              "UPDATE node_attempts SET fence = fence + 1, worker_generation = ? WHERE state = 'RUNNING' AND execution_id IN (SELECT id FROM node_executions WHERE run_id = ?)",
            )
            .run(workerGeneration, id);
          return { runId: id, claims: this.#runningClaims(id) };
        });
      })
      .immediate();
  }

  // Reopens the stuck execution with a new attempt. The owner has confirmed that retrying is safe;
  // the agent continues in the same session and is told that earlier effects are unknown.
  retry(runId: string, actor: ControlActor, commandId: string | undefined): void {
    this.db
      .transaction(() => {
        const run = this.#controlled(runId);
        this.#require(run, ['NEEDS_HUMAN'], 'retry');
        this.#notCancelling(run);
        const stuck = this.#stuck(runId);
        if (!stuck) {
          throw new ShiftError(
            'NOTHING_TO_RETRY',
            'No step is waiting to be retried. A run stopped by an execution limit continues with extend.',
            409,
          );
        }
        this.#control(runId, 'retry', actor, commandId, stuck.id, {});
        this.db
          .prepare(
            "UPDATE node_executions SET state = 'PENDING', revision = revision + 1 WHERE id = ?",
          )
          .run(stuck.id);
        this.#resume(runId);
        this.#event('execution.retry_requested', { runId, executionId: stuck.id }, {});
      })
      .immediate();
  }

  // Abandons the stuck step: it fails and follows its error connection, or the run fails.
  fail(
    runId: string,
    actor: ControlActor,
    commandId: string | undefined,
    reason: string | undefined,
  ): void {
    this.db
      .transaction(() => {
        const run = this.#controlled(runId);
        this.#require(run, ['NEEDS_HUMAN'], 'fail');
        this.#notCancelling(run);
        const stuck = this.#stuck(runId);
        const error: ExecutionError = {
          code: 'ABANDONED',
          category: 'external',
          message: reason ?? 'The owner abandoned this step.',
        };
        this.#control(runId, 'fail', actor, commandId, stuck?.id ?? null, reason ? { reason } : {});
        this.#resume(runId);
        if (stuck) {
          this.#finishExecution(
            { runId, executionId: stuck.id, attemptId: null },
            { kind: 'failed', error },
          );
        } else {
          this.#finishRun(runId, 'FAILED', error as unknown as Json);
        }
      })
      .immediate();
  }

  // Records a result the owner verified for a stuck agent step. It must satisfy the step's result
  // schema; run_controls records that it came from the owner, not the agent.
  complete(runId: string, actor: ControlActor, commandId: string | undefined, data: Json): void {
    this.db
      .transaction(() => {
        const run = this.#controlled(runId);
        this.#require(run, ['NEEDS_HUMAN'], 'complete');
        this.#notCancelling(run);
        const stuck = this.#stuck(runId);
        if (!stuck || stuck.node_type !== 'agent') {
          throw new ShiftError(
            'NOTHING_TO_COMPLETE',
            'No agent step is waiting for a result.',
            409,
          );
        }
        const invalid = checkValue(this.agentConfig(stuck.id).resultSchema, data, 'data');
        if (invalid) {
          throw new ShiftError(
            'INVALID_RESULT',
            `The result does not match the step's result schema: ${invalid}`,
            422,
          );
        }
        const context = this.execution(stuck.id);
        const output = envelope(data, context.input);
        const session = this.session(stuck.id);
        if (session && context.snapshot.project.id) {
          output.references.agentSession = {
            kind: 'agent_session',
            id: session.agentSessionId,
            projectId: context.snapshot.project.id,
          };
        }
        this.#control(runId, 'complete', actor, commandId, stuck.id, { data });
        this.#resume(runId);
        this.#finishExecution(
          { runId, executionId: stuck.id, attemptId: null },
          { kind: 'completed', output, port: 'success' },
        );
      })
      .immediate();
  }

  // Raises the limit that stopped the run and takes the step it held. An execution limit grows by
  // `executions`; the active-time limit grows by `activeMs` beyond what the run has used.
  extend(
    runId: string,
    actor: ControlActor,
    commandId: string | undefined,
    by: { executions?: number; activeMs?: number },
  ): void {
    this.db
      .transaction(() => {
        const run = this.#controlled(runId);
        this.#require(run, ['NEEDS_HUMAN'], 'extend');
        this.#notCancelling(run);
        const attention = parse<{
          code: string;
          executionId?: string;
          port?: string;
          limit?: { scope: 'run' | 'node' | 'active'; nodeId?: string; value: number };
        }>(run.attention_json);
        const active = attention?.code === 'ACTIVE_TIME_LIMIT';
        if (
          (attention?.code !== 'EXECUTION_LIMIT' && !active) ||
          !attention.executionId ||
          !attention.limit
        ) {
          throw new ShiftError('NOTHING_TO_EXTEND', 'The run is not stopped by a limit.', 409);
        }
        const amount = active ? by.activeMs : by.executions;
        if (amount === undefined) {
          throw new ShiftError(
            'NOTHING_TO_EXTEND',
            active
              ? 'The run is stopped by its active-time limit; extend it with activeMs.'
              : 'The run is stopped by an execution limit; extend it with executions.',
            409,
          );
        }
        const { limit, executionId } = attention;
        // Only a stop in the middle of an attempt has no port to continue from.
        const port = attention.port ?? (active ? undefined : 'success');
        const limits = this.#limits(runId);
        const value = active
          ? Math.max(limit.value, this.#activeMs(runId)) + amount
          : limit.value + amount;
        if (limit.scope === 'active') limits.maxActiveMs = value;
        else if (limit.scope === 'run') limits.maxExecutions = value;
        else limits.nodes = { ...limits.nodes, [limit.nodeId!]: value };
        this.db
          .prepare('UPDATE runs SET limits_json = ? WHERE id = ?')
          .run(JSON.stringify(limits), runId);
        this.#control(runId, 'extend', actor, commandId, executionId, {
          scope: limit.scope,
          ...(limit.nodeId ? { nodeId: limit.nodeId } : {}),
          from: limit.value,
          to: value,
        });
        this.#resume(runId);
        if (port === undefined) {
          // The limit stopped a running attempt: its execution continues with a new attempt.
          this.db
            .prepare(
              "UPDATE node_executions SET state = 'PENDING', revision = revision + 1 WHERE id = ? AND state = 'WAITING'",
            )
            .run(executionId);
          return;
        }
        const from = this.db
          .prepare(
            'SELECT node_id, input_json, output_json, error_json FROM node_executions WHERE id = ?',
          )
          .get(executionId) as {
          node_id: string;
          input_json: string;
          output_json: string | null;
          error_json: string | null;
        };
        const output =
          port === 'error'
            ? envelope(
                { error: parse<Json>(from.error_json) },
                parse<OutputEnvelope>(from.input_json) ?? undefined,
              )
            : parse<OutputEnvelope>(from.output_json)!;
        const snapshot = upgradeSnapshot(
          JSON.parse(run.snapshot_json) as RunSnapshot | LegacySnapshot,
        );
        this.#schedule(runId, snapshot, { id: executionId, nodeId: from.node_id }, port, output);
      })
      .immediate();
  }

  #controlled(runId: string) {
    const run = this.db
      .prepare(
        'SELECT id, state, cancel_requested_at, attention_json, snapshot_json FROM runs WHERE id = ?',
      )
      .get(runId) as
      | {
          id: string;
          state: string;
          cancel_requested_at: number | null;
          attention_json: string | null;
          snapshot_json: string;
        }
      | undefined;
    if (!run) throw new ShiftError('RUN_NOT_FOUND', 'Run not found.', 404);
    return run;
  }

  #require(run: { state: string }, states: string[], action: string): void {
    if (!states.includes(run.state)) {
      throw new ShiftError(
        'RUN_STATE_CONFLICT',
        `The run is ${run.state}; ${action} needs a run that is ${states.join(' or ')}.`,
        409,
      );
    }
  }

  #notCancelling(run: { cancel_requested_at: number | null }): void {
    if (run.cancel_requested_at !== null) {
      throw new ShiftError(
        'RUN_CANCEL_REQUESTED',
        'The run is being cancelled. Cancel it again to finish cancelling.',
        409,
      );
    }
  }

  // The execution an owner decision is about: the one waiting after its attempt stopped.
  #stuck(runId: string) {
    return this.db
      .prepare(
        "SELECT id, node_id, node_type FROM node_executions WHERE run_id = ? AND state = 'WAITING' ORDER BY sequence DESC LIMIT 1",
      )
      .get(runId) as { id: string; node_id: string; node_type: string | null } | undefined;
  }

  #resume(runId: string): void {
    this.db
      .prepare(
        "UPDATE runs SET state = 'RUNNING', attention_json = NULL, revision = revision + 1 WHERE id = ?",
      )
      .run(runId);
  }

  #runningClaims(runId: string): Claim[] {
    return (
      this.db
        .prepare(
          "SELECT a.id, a.execution_id, a.fence FROM node_attempts a JOIN node_executions e ON e.id = a.execution_id WHERE e.run_id = ? AND a.state = 'RUNNING'",
        )
        .all(runId) as Array<{ id: string; execution_id: string; fence: number }>
    ).map((row) => ({
      attemptId: row.id,
      executionId: row.execution_id,
      runId,
      fence: row.fence,
    }));
  }

  // Work that is not running stops at once, and its wake-ups never fire.
  #cancelIdle(runId: string): void {
    const now = this.clock.now();
    this.db
      .prepare(
        "UPDATE node_executions SET state = 'CANCELLED', finished_at = ?, revision = revision + 1 WHERE run_id = ? AND state IN ('PENDING', 'WAITING')",
      )
      .run(now, runId);
    this.db
      .prepare(
        "UPDATE node_attempts SET state = 'CANCELLED', finished_at = ? WHERE state = 'WAITING' AND execution_id IN (SELECT id FROM node_executions WHERE run_id = ?)",
      )
      .run(now, runId);
    this.db
      .prepare(
        "UPDATE human_interactions SET state = 'CANCELLED', settled_at = ?, revision = revision + 1 WHERE run_id = ? AND state = 'PENDING'",
      )
      .run(now, runId);
    this.db
      .prepare(
        "UPDATE wakeups SET state = 'CANCELLED', settled_at = ? WHERE run_id = ? AND state = 'PENDING'",
      )
      .run(now, runId);
  }

  #finishCancel(runId: string): void {
    const reason = (
      this.db
        .prepare(
          "SELECT json_extract(payload_json, '$.reason') AS reason FROM run_controls WHERE run_id = ? AND kind = 'cancel' ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )
        .get(runId) as { reason: string | null } | undefined
    )?.reason;
    this.db
      .prepare(
        "UPDATE runs SET state = 'CANCELLED', attention_json = NULL, outcome_json = ?, finished_at = ?, revision = revision + 1 WHERE id = ?",
      )
      .run(
        JSON.stringify({ cancelled: true, ...(reason ? { reason } : {}) }),
        this.clock.now(),
        runId,
      );
    this.#event('run.cancelled', { runId }, reason ? { reason } : {});
  }

  #control(
    runId: string,
    kind: 'cancel' | 'retry' | 'fail' | 'complete' | 'extend',
    actor: ControlActor,
    commandId: string | undefined,
    executionId: string | null,
    payload: Json,
  ): void {
    this.db
      .prepare(
        'INSERT INTO run_controls (id, run_id, kind, execution_id, actor_kind, actor_id, command_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        randomUUID(),
        runId,
        kind,
        executionId,
        actor.kind,
        actor.id,
        commandId ?? null,
        JSON.stringify(payload),
        this.clock.now(),
      );
    this.#event(
      'run.control',
      { runId, ...(executionId ? { executionId } : {}) },
      { kind, actor: { ...actor } },
    );
  }

  // The last invocation of any attempt of an execution, which a retry's first prompt continues.
  lastInvocationId(executionId: string): string | undefined {
    return (
      this.db
        .prepare(
          'SELECT id FROM agent_invocations WHERE execution_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
        )
        .get(executionId) as { id: string } | undefined
    )?.id;
  }

  // The attempt before a claim's, if any: an automatic retry follows a FAILED attempt and an owner
  // retry an INTERRUPTED one.
  previousAttempt(claim: Claim): { state: string; error: ExecutionError | null } | null {
    const row = this.db
      .prepare(
        'SELECT state, error_json FROM node_attempts WHERE execution_id = ? AND attempt_number < (SELECT attempt_number FROM node_attempts WHERE id = ?) ORDER BY attempt_number DESC LIMIT 1',
      )
      .get(claim.executionId, claim.attemptId) as
      { state: string; error_json: string | null } | undefined;
    return row ? { state: row.state, error: parse<ExecutionError>(row.error_json) } : null;
  }

  run(runId: string): Json {
    const run = this.db
      .prepare(
        'SELECT r.id, r.state, r.snapshot_json, r.attention_json, r.outcome_json, r.created_at, r.finished_at, r.cancel_requested_at, w.id AS workspace_id, w.path AS workspace_path, w.state AS workspace_state FROM runs r LEFT JOIN workspaces w ON w.id = r.primary_workspace_id WHERE r.id = ?',
      )
      .get(runId) as
      | {
          id: string;
          state: string;
          cancel_requested_at: number | null;
          workspace_id: string | null;
          workspace_path: string | null;
          workspace_state: string | null;
          snapshot_json: string;
          attention_json: string | null;
          outcome_json: string | null;
          created_at: number;
          finished_at: number | null;
        }
      | undefined;
    if (!run) throw new ShiftError('RUN_NOT_FOUND', 'Run not found.', 404);
    const executions = this.db
      .prepare(
        'SELECT id, node_id, node_type, sequence, state, selected_port, output_json, error_json FROM node_executions WHERE run_id = ? ORDER BY sequence',
      )
      .all(runId) as Array<{
      id: string;
      node_id: string;
      node_type: string | null;
      sequence: number;
      state: string;
      selected_port: string | null;
      output_json: string | null;
      error_json: string | null;
    }>;
    const invocations = this.db
      .prepare(
        'SELECT i.id, i.kind, i.state, i.correlation_id, (SELECT COUNT(*) FROM agent_result_submissions s WHERE s.invocation_id = i.id) AS submissions, (SELECT COUNT(*) FROM agent_result_submissions s WHERE s.invocation_id = i.id AND s.accepted = 1) AS accepted FROM agent_invocations i JOIN node_executions e ON e.id = i.execution_id WHERE e.run_id = ? ORDER BY i.created_at, i.rowid',
      )
      .all(runId) as Array<{
      id: string;
      kind: string;
      state: string;
      correlation_id: string;
      submissions: number;
      accepted: number;
    }>;
    const attempts = this.db
      .prepare(
        'SELECT a.execution_id, a.attempt_number, a.state, a.error_json FROM node_attempts a JOIN node_executions e ON e.id = a.execution_id WHERE e.run_id = ? ORDER BY a.attempt_number',
      )
      .all(runId) as Array<{
      execution_id: string;
      attempt_number: number;
      state: string;
      error_json: string | null;
    }>;
    const pendingInteraction = this.db
      .prepare(
        "SELECT id, execution_id, expires_at FROM human_interactions WHERE run_id = ? AND state = 'PENDING'",
      )
      .get(runId) as { id: string; execution_id: string; expires_at: number | null } | undefined;
    // An interaction's deadline is shown on the interaction, not as a separate wait.
    const wakeup = this.db
      .prepare(
        "SELECT execution_id, reason, due_at, payload_json FROM wakeups WHERE run_id = ? AND state = 'PENDING' AND reason != 'deadline' ORDER BY due_at LIMIT 1",
      )
      .get(runId) as
      { execution_id: string; reason: string; due_at: number; payload_json: string } | undefined;
    const wait: RunWait | null = pendingInteraction
      ? {
          kind: 'human',
          executionId: pendingInteraction.execution_id,
          interactionId: pendingInteraction.id,
          expiresAt: pendingInteraction.expires_at,
        }
      : !wakeup
        ? null
        : wakeup.reason === 'retry'
          ? {
              kind: 'retry',
              executionId: wakeup.execution_id,
              dueAt: wakeup.due_at,
              ...(JSON.parse(wakeup.payload_json) as {
                attempt: number;
                error: { code: string; message: string };
              }),
            }
          : { kind: 'timer', executionId: wakeup.execution_id, dueAt: wakeup.due_at };
    const snapshot = upgradeSnapshot(JSON.parse(run.snapshot_json) as RunSnapshot | LegacySnapshot);
    return {
      id: run.id,
      state: run.state,
      workflowId: snapshot.workflowId,
      versionId: snapshot.versionId,
      versionNumber: snapshot.versionNumber,
      repository: snapshot.project.repositoryPath,
      baseCommit: snapshot.project.baseCommit ?? null,
      workspace:
        run.workspace_id === null
          ? null
          : { id: run.workspace_id, path: run.workspace_path, state: run.workspace_state },
      attention: parse<Json>(run.attention_json),
      wait: wait as unknown as Json,
      // Charged up to the last checkpoint, so a running attempt can be up to one checkpoint behind.
      activeTime: { usedMs: this.#activeMs(runId), limitMs: this.#activeLimit(runId, snapshot) },
      cancelRequested: run.cancel_requested_at !== null,
      outcome: parse<Json>(run.outcome_json),
      createdAt: run.created_at,
      finishedAt: run.finished_at,
      executions: executions.map((execution) => ({
        id: execution.id,
        node: execution.node_id,
        type: execution.node_type ?? execution.node_id,
        sequence: execution.sequence,
        state: execution.state,
        port: execution.selected_port,
        output: parse<Json>(execution.output_json),
        error: parse<Json>(execution.error_json),
        attempts: attempts
          .filter((attempt) => attempt.execution_id === execution.id)
          .map((attempt) => ({
            number: attempt.attempt_number,
            state: attempt.state,
            error: parse<Json>(attempt.error_json),
          })),
      })),
      invocations: invocations.map((invocation) => ({
        id: invocation.id,
        kind: invocation.kind,
        state: invocation.state,
        correlationId: invocation.correlation_id,
        submissions: invocation.submissions,
        acceptedSubmissions: invocation.accepted,
      })),
      controls: (
        this.db
          .prepare(
            'SELECT id, kind, execution_id, actor_kind, actor_id, payload_json, created_at FROM run_controls WHERE run_id = ? ORDER BY created_at, rowid',
          )
          .all(runId) as Array<{
          id: string;
          kind: string;
          execution_id: string | null;
          actor_kind: string;
          actor_id: string;
          payload_json: string;
          created_at: number;
        }>
      ).map((control) => ({
        id: control.id,
        kind: control.kind,
        executionId: control.execution_id,
        actor: { kind: control.actor_kind, id: control.actor_id },
        payload: parse<Json>(control.payload_json),
        createdAt: control.created_at,
      })),
    };
  }

  runs(): Json {
    return (
      this.db
        .prepare(
          'SELECT id, state, workflow_id, created_at, finished_at FROM runs ORDER BY created_at DESC LIMIT 100',
        )
        .all() as Array<{
        id: string;
        state: string;
        workflow_id: string | null;
        created_at: number;
        finished_at: number | null;
      }>
    ).map((run) => ({
      id: run.id,
      state: run.state,
      workflowId: run.workflow_id,
      createdAt: run.created_at,
      finishedAt: run.finished_at,
    }));
  }
}
