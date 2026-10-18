import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { HarnessSessionHandle, Json, ModelRef, ToolPolicy } from '../harness/types.js';
import { nodeType } from '../workflows/nodes.js';
import type { NodeDefinition, WorkflowDocument } from '../workflows/document.js';
import { envelope, type ChainEntry, type OutputEnvelope } from './bindings.js';
import type { ResultEnvelope } from './envelope.js';

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
}

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
}

export class StaleClaim extends Error {}

const parse = <T>(text: string | null): T | null =>
  text === null ? null : (JSON.parse(text) as T);
const activeInvocationStates = "('PREPARING', 'SUBMITTING', 'RUNNING', 'UNCERTAIN')";

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
    const limit =
      counts.total >= snapshot.document.execution.limits.maxExecutions
        ? `The run reached its limit of ${snapshot.document.execution.limits.maxExecutions} executions.`
        : (counts.node ?? 0) >= target.limits.maxExecutionsPerRun
          ? `Node ${target.id} reached its limit of ${target.limits.maxExecutionsPerRun} executions.`
          : null;
    if (limit) {
      // Exhaustion enters NEEDS_HUMAN before another activation (specification 6.7).
      this.db
        .prepare(
          "UPDATE runs SET state = 'NEEDS_HUMAN', attention_json = ?, revision = revision + 1 WHERE id = ?",
        )
        .run(JSON.stringify({ code: 'EXECUTION_LIMIT', explanation: limit }), runId);
      this.#event('run.needs_human', { runId, executionId: from.id }, { code: 'EXECUTION_LIMIT' });
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
        this.db
          .prepare(
            "INSERT INTO node_attempts (id, execution_id, attempt_number, state, worker_generation, fence, started_at) VALUES (?, ?, 1, 'RUNNING', ?, 1, ?)",
          )
          .run(attemptId, executionId, workerGeneration, now);
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
        const now = this.clock.now();
        const context = this.execution(claim.executionId);
        const { node, snapshot } = context;
        const completed = outcome.kind === 'completed';
        const output = completed ? outcome.output : null;
        const error = completed ? null : outcome.error;
        this.db
          .prepare(
            'UPDATE node_attempts SET state = ?, finished_at = ?, error_json = ? WHERE id = ?',
          )
          .run(
            completed ? 'COMPLETED' : 'FAILED',
            now,
            error && JSON.stringify(error),
            claim.attemptId,
          );
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
      })
      .immediate();
  }

  // The attempt stops and the execution waits for an owner decision; nothing resumes it on restart.
  needsHuman(claim: Claim, attention: Attention): void {
    this.db
      .transaction(() => {
        this.#fenced(claim);
        const now = this.clock.now();
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

  run(runId: string): Json {
    const run = this.db
      .prepare(
        'SELECT r.id, r.state, r.snapshot_json, r.attention_json, r.outcome_json, r.created_at, r.finished_at, w.id AS workspace_id, w.path AS workspace_path, w.state AS workspace_state FROM runs r LEFT JOIN workspaces w ON w.id = r.primary_workspace_id WHERE r.id = ?',
      )
      .get(runId) as
      | {
          id: string;
          state: string;
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
      })),
      invocations: invocations.map((invocation) => ({
        id: invocation.id,
        kind: invocation.kind,
        state: invocation.state,
        correlationId: invocation.correlation_id,
        submissions: invocation.submissions,
        acceptedSubmissions: invocation.accepted,
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
