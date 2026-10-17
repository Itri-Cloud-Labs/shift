import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { HarnessSessionHandle, Json, ModelRef, ToolPolicy } from '../harness/types.js';
import type { ResultEnvelope } from './envelope.js';

export interface RunSnapshot {
  graph: {
    nodes: Array<{ id: string; type: 'manual_trigger' | 'agent' | 'end' }>;
    connections: Array<{ from: string; to: string }>;
  };
  agent: {
    goal: string;
    cwd: string;
    model: ModelRef;
    toolPolicy: ToolPolicy;
    resultSchema: Json;
    limits: { rejectedSubmissions: number; corrections: number; continuations: number };
  };
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

export type AgentOutcome =
  | { kind: 'completed'; data: Json }
  | { kind: 'failed'; error: { code: string; category: string; message: string; details?: Json } };

export interface Attention {
  code: string;
  explanation: string;
  invocationId?: string;
}

export class StaleClaim extends Error {}

const parse = <T>(text: string | null): T | null =>
  text === null ? null : (JSON.parse(text) as T);
const activeInvocationStates = "('PREPARING', 'SUBMITTING', 'RUNNING', 'UNCERTAIN')";

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

  // The manual trigger completes immediately, carrying the trigger input, and the agent node
  // becomes the run's single pending activation.
  createRun(snapshot: RunSnapshot): string {
    const runId = randomUUID();
    const now = this.clock.now();
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "INSERT INTO runs (id, snapshot_json, state, revision, created_at) VALUES (?, ?, 'RUNNING', 0, ?)",
          )
          .run(runId, JSON.stringify(snapshot), now);
        const trigger = randomUUID();
        const input = JSON.stringify({ data: { goal: snapshot.agent.goal } });
        this.db
          .prepare(
            "INSERT INTO node_executions (id, run_id, node_id, sequence, input_json, state, output_json, started_at, finished_at, revision) VALUES (?, ?, 'start', 1, ?, 'COMPLETED', ?, ?, ?, 0)",
          )
          .run(trigger, runId, input, input, now, now);
        this.db
          .prepare(
            "INSERT INTO node_executions (id, run_id, node_id, sequence, predecessor_execution_id, input_json, state, revision) VALUES (?, ?, 'agent', 2, ?, ?, 'PENDING', 0)",
          )
          .run(randomUUID(), runId, trigger, input);
        this.#event('run.created', { runId }, { goal: snapshot.agent.goal });
      })
      .immediate();
    return runId;
  }

  pendingAgentExecutions(): string[] {
    return (
      this.db
        .prepare(
          "SELECT e.id FROM node_executions e JOIN runs r ON r.id = e.run_id WHERE e.state = 'PENDING' AND e.node_id = 'agent' AND r.state = 'RUNNING' ORDER BY r.created_at",
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id);
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
    return JSON.parse(row.snapshot_json) as RunSnapshot;
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
      snapshot: RunSnapshot,
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
        const snapshot = this.snapshot(active.run_id);
        let verdict:
          { accepted: true; envelope: ResultEnvelope } | { accepted: false; reason: string };
        if (counts.accepted) {
          verdict = { accepted: false, reason: 'a result was already accepted; end your turn' };
        } else if ((counts.rejected ?? 0) >= snapshot.agent.limits.rejectedSubmissions) {
          verdict = { accepted: false, reason: 'too many rejected results; end your turn' };
        } else {
          verdict = judge(snapshot, submission.input);
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

  // Completion and the successor commit together: a completed agent node advances to the end node
  // and completes the run in the same transaction.
  finishAgent(claim: Claim, outcome: AgentOutcome): void {
    this.db
      .transaction(() => {
        this.#fenced(claim);
        const now = this.clock.now();
        const completed = outcome.kind === 'completed';
        const output = completed ? JSON.stringify({ data: outcome.data }) : null;
        const error = completed ? null : JSON.stringify(outcome.error);
        this.db
          .prepare(
            'UPDATE node_attempts SET state = ?, finished_at = ?, error_json = ? WHERE id = ?',
          )
          .run(completed ? 'COMPLETED' : 'FAILED', now, error, claim.attemptId);
        this.db
          .prepare(
            'UPDATE node_executions SET state = ?, output_json = ?, error_json = ?, finished_at = ?, revision = revision + 1 WHERE id = ?',
          )
          .run(completed ? 'COMPLETED' : 'FAILED', output, error, now, claim.executionId);
        this.db
          .prepare(
            "UPDATE agent_sessions SET state = 'ARCHIVED', archived_at = ?, revision = revision + 1 WHERE id = (SELECT agent_session_id FROM node_executions WHERE id = ?)",
          )
          .run(now, claim.executionId);
        if (completed) {
          this.db
            .prepare(
              "INSERT INTO node_executions (id, run_id, node_id, sequence, predecessor_execution_id, input_json, state, output_json, started_at, finished_at, revision) VALUES (?, ?, 'end', 3, ?, ?, 'COMPLETED', ?, ?, ?, 0)",
            )
            .run(randomUUID(), claim.runId, claim.executionId, output, output, now, now);
        }
        this.db
          .prepare(
            'UPDATE runs SET state = ?, outcome_json = ?, finished_at = ?, revision = revision + 1 WHERE id = ?',
          )
          .run(completed ? 'COMPLETED' : 'FAILED', completed ? output : error, now, claim.runId);
        this.#event(
          completed ? 'run.completed' : 'run.failed',
          { runId: claim.runId, executionId: claim.executionId },
          completed ? {} : (outcome.error as Json),
        );
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
        'SELECT id, state, snapshot_json, attention_json, outcome_json, created_at, finished_at FROM runs WHERE id = ?',
      )
      .get(runId) as
      | {
          id: string;
          state: string;
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
        'SELECT id, node_id, sequence, state, output_json, error_json FROM node_executions WHERE run_id = ? ORDER BY sequence',
      )
      .all(runId) as Array<{
      id: string;
      node_id: string;
      sequence: number;
      state: string;
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
    const snapshot = JSON.parse(run.snapshot_json) as RunSnapshot;
    return {
      id: run.id,
      state: run.state,
      goal: snapshot.agent.goal,
      cwd: snapshot.agent.cwd,
      attention: parse<Json>(run.attention_json),
      outcome: parse<Json>(run.outcome_json),
      createdAt: run.created_at,
      finishedAt: run.finished_at,
      executions: executions.map((execution) => ({
        id: execution.id,
        node: execution.node_id,
        sequence: execution.sequence,
        state: execution.state,
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
          'SELECT id, state, created_at, finished_at FROM runs ORDER BY created_at DESC LIMIT 100',
        )
        .all() as Array<{
        id: string;
        state: string;
        created_at: number;
        finished_at: number | null;
      }>
    ).map((run) => ({
      id: run.id,
      state: run.state,
      createdAt: run.created_at,
      finishedAt: run.finished_at,
    }));
  }
}
