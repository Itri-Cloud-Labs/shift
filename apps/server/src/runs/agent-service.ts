import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from 'pino';
import { ShiftError } from '../domain/errors.js';
import type {
  HarnessAdapter,
  HarnessSessionHandle,
  InvocationObservation,
  ResultHandler,
} from '../harness/types.js';
import { checkEnvelope } from './envelope.js';
import { continuationPrompt, correctionPrompt, goalPrompt, type AgentTask } from './prompts.js';
import {
  StaleClaim,
  type Claim,
  type InvocationRow,
  type InvocationState,
  type RunRepository,
  type RunSnapshot,
} from './repository.js';

export interface AgentServiceOptions {
  repository: RunRepository;
  adapter: HarnessAdapter;
  artifactRoot: string;
  logger: Logger;
  pollIntervalMs?: number;
  // An inbox item can stay undelivered after a harness restart; resubmitting the same ID wakes it.
  queuedResubmitMs?: number;
  // Consecutive failed inspections tolerated while the harness runtime restarts.
  inspectionFailures?: number;
}

const active: readonly InvocationState[] = ['PREPARING', 'SUBMITTING', 'RUNNING', 'UNCERTAIN'];

// Owns goal construction, session binding, correction, continuation and result validation for
// agent node executions (specification 9). Workflow routing stays in the run repository.
export class AgentService {
  readonly #options: Required<AgentServiceOptions>;

  constructor(options: AgentServiceOptions) {
    this.#options = {
      pollIntervalMs: 1_000,
      queuedResubmitMs: 5_000,
      inspectionFailures: 10,
      ...options,
    };
  }

  readonly handleResult: ResultHandler = async (submission) =>
    this.#options.repository.recordSubmission(submission, (snapshot, input) => {
      const check = checkEnvelope(snapshot.agent.resultSchema, input);
      return check.valid
        ? { accepted: true, envelope: check.envelope }
        : { accepted: false, reason: check.reason };
    });

  // Runs until the claimed attempt finishes, needs a human, loses its claim, or `signal` aborts.
  async run(claim: Claim, signal: AbortSignal): Promise<void> {
    try {
      await this.#drive(claim, signal);
    } catch (error) {
      if (error instanceof StaleClaim || signal.aborted) return;
      const safe =
        error instanceof ShiftError
          ? error
          : new ShiftError('INTERNAL_ERROR', 'The agent node failed unexpectedly.');
      this.#options.logger.error({ code: safe.code, runId: claim.runId }, 'Agent node failed.');
      const { repository } = this.#options;
      try {
        // Once a prompt may have reached the harness, a failure is not proof that nothing ran.
        const last = repository.invocations(claim.attemptId).at(-1);
        if (last && last.state !== 'PREPARING' && active.includes(last.state)) {
          repository.needsHuman(claim, {
            code: safe.code,
            explanation: `${safe.message} The agent turn may have run; its outcome is unknown.`,
            invocationId: last.id,
          });
        } else {
          repository.finishAgent(claim, {
            kind: 'failed',
            error: { code: safe.code, category: 'external', message: safe.message },
          });
        }
      } catch (finishError) {
        if (!(finishError instanceof StaleClaim)) throw finishError;
      }
    }
  }

  async #drive(claim: Claim, signal: AbortSignal): Promise<void> {
    const { repository, adapter } = this.#options;
    const snapshot = repository.snapshot(claim.runId);
    const task: AgentTask = {
      goal: snapshot.agent.goal,
      cwd: snapshot.agent.cwd,
      resultSchema: snapshot.agent.resultSchema,
      readOnly: snapshot.agent.toolPolicy.mode === 'read_only',
    };
    const handle = await this.#session(claim, snapshot);
    for (;;) {
      if (signal.aborted) return;
      const invocations = repository.invocations(claim.attemptId);
      const last = invocations.at(-1);
      if (last && active.includes(last.state)) {
        await this.#invoke(claim, handle, last, snapshot, signal);
        continue;
      }
      const next = this.#decide(claim, snapshot, invocations);
      if (!next) return;
      const id = randomUUID();
      const artifactDirectory = this.#artifactDirectory(claim, id);
      const prompt =
        next === 'goal'
          ? goalPrompt(task, artifactDirectory)
          : next === 'correction'
            ? correctionPrompt(task)
            : continuationPrompt(task, artifactDirectory);
      repository.createInvocation(claim, {
        id,
        agentSessionId: handle.shiftSessionId,
        kind: next,
        correlationId: adapter.correlate(id).providerMessageId,
        prompt,
        previousInvocationId: last?.id ?? null,
      });
    }
  }

  async #session(claim: Claim, snapshot: RunSnapshot): Promise<HarnessSessionHandle> {
    const { repository, adapter } = this.#options;
    const session =
      repository.session(claim.executionId) ??
      repository.bindSession(claim, {
        harnessId: adapter.id,
        cwd: snapshot.agent.cwd,
        config: { model: { ...snapshot.agent.model } },
        storageNamespace: adapter.storageNamespace,
      });
    if (session.state === 'READY' && session.harnessSessionId) {
      return {
        shiftSessionId: session.agentSessionId,
        harnessSessionId: session.harnessSessionId,
        storageNamespace: session.storageNamespace,
        cwd: session.cwd,
      };
    }
    // Repeating an interrupted creation addresses the same harness session.
    const handle = await adapter.createSession({
      shiftSessionId: session.agentSessionId,
      operationId: claim.attemptId,
      cwd: snapshot.agent.cwd,
      model: snapshot.agent.model,
    });
    repository.markSessionReady(claim, handle);
    return handle;
  }

  // What follows a finished invocation, or null once the attempt has been finished.
  #decide(
    claim: Claim,
    snapshot: RunSnapshot,
    invocations: InvocationRow[],
  ): 'goal' | 'correction' | 'continuation' | null {
    const { repository } = this.#options;
    const { limits } = snapshot.agent;
    const last = invocations.at(-1);
    if (!last) return 'goal';
    const count = (kind: InvocationRow['kind']) =>
      invocations.filter((invocation) => invocation.kind === kind).length;
    switch (last.state) {
      case 'COMPLETED': {
        const envelope = last.result!;
        if (envelope.status === 'completed') {
          repository.finishAgent(claim, { kind: 'completed', data: envelope.data });
        } else {
          const problem = envelope.status === 'blocked' ? envelope.blocker : envelope.error;
          repository.finishAgent(claim, {
            kind: 'failed',
            error: { ...problem, category: envelope.status === 'blocked' ? 'blocked' : 'external' },
          });
        }
        return null;
      }
      case 'FAILED':
        if (last.error?.code === 'HARNESS_PROMPT') {
          repository.finishAgent(claim, {
            kind: 'failed',
            error: { ...last.error, category: 'blocked' },
          });
          return null;
        }
        if (count('correction') < limits.corrections) return 'correction';
        repository.finishAgent(claim, {
          kind: 'failed',
          error: {
            code: 'RESULT_MISSING',
            category: 'contract',
            message: 'The agent ended its turns without a result Shift accepted.',
          },
        });
        return null;
      case 'INTERRUPTED':
        if (count('continuation') < limits.continuations) return 'continuation';
        repository.needsHuman(claim, {
          code: 'AGENT_INTERRUPTED',
          explanation: 'The agent was interrupted repeatedly before finishing.',
          invocationId: last.id,
        });
        return null;
      case 'UNKNOWN':
        repository.needsHuman(claim, {
          code: 'HARNESS_OUTCOME_UNKNOWN',
          explanation:
            last.error?.message ?? 'The agent turn stopped without evidence of its outcome.',
          invocationId: last.id,
        });
        return null;
      default:
        throw new ShiftError('INTERNAL_ERROR', 'An invocation is in an unexpected state.');
    }
  }

  // Drives one invocation until it is terminal. Durable intent (SUBMITTING) precedes the submit,
  // and an uncertain submission is inspected before anything is resubmitted.
  async #invoke(
    claim: Claim,
    handle: HarnessSessionHandle,
    invocation: InvocationRow,
    snapshot: RunSnapshot,
    signal: AbortSignal,
  ): Promise<void> {
    const { repository, adapter } = this.#options;
    const correlation = adapter.correlate(invocation.id);
    const transition = (
      from: readonly InvocationState[],
      to: InvocationState,
      error?: { code: string; message: string },
    ) =>
      repository.transitionInvocation(
        claim,
        invocation.id,
        from,
        to,
        error === undefined ? {} : { error },
      );
    // A result Shift already accepted is authoritative once the turn is no longer running
    // (docs/opencode-capabilities.md section 5), however the turn itself ended.
    const settle = (to: InvocationState, error: { code: string; message: string }) =>
      repository.submissionCounts(invocation.id).accepted
        ? transition(['RUNNING'], 'COMPLETED')
        : transition(['RUNNING'], to, error);
    // An unconfirmed stop keeps ownership: tools may still run, so nothing proceeds without a human.
    const stopped = async (to: InvocationState, error: { code: string; message: string }) => {
      const cancelled = await adapter.cancel(handle, correlation);
      if (cancelled.kind === 'stopped') settle(to, error);
      else {
        transition(['RUNNING'], 'UNKNOWN', {
          code: 'HARNESS_STOP_UNCONFIRMED',
          message: `Shift could not confirm that the turn stopped: ${cancelled.explanation}`,
        });
      }
    };
    let state = invocation.state;
    if (state === 'PREPARING') {
      transition(['PREPARING'], 'SUBMITTING');
      state = 'SUBMITTING';
    }
    let submittedAt = 0;
    const submit = async () => {
      await mkdir(this.#artifactDirectory(claim, invocation.id), { recursive: true, mode: 0o700 });
      const receipt = await adapter.submit(handle, {
        invocationId: invocation.id,
        goal: invocation.prompt,
        artifactDirectory: this.#artifactDirectory(claim, invocation.id),
        toolPolicy: snapshot.agent.toolPolicy,
      });
      submittedAt = Date.now();
      return receipt.kind;
    };
    let failures = 0;
    for (;;) {
      if (signal.aborted) return this.#stop(claim, handle, invocation, state);
      let observation: InvocationObservation;
      try {
        observation = await adapter.inspectInvocation(handle, correlation);
        failures = 0;
      } catch (error) {
        if (!(error instanceof ShiftError) || ++failures > this.#options.inspectionFailures) {
          transition(active, 'UNKNOWN', {
            code: 'HARNESS_UNAVAILABLE',
            message: 'The harness could not be inspected, so the turn outcome is unknown.',
          });
          return;
        }
        await this.#sleep(signal);
        continue;
      }
      if (state === 'SUBMITTING' || state === 'UNCERTAIN') {
        if (observation.kind === 'not_accepted') {
          const receipt = await submit();
          const next = receipt === 'accepted' ? 'RUNNING' : 'UNCERTAIN';
          if (next !== state) transition([state], next);
          state = next;
          continue;
        }
        // Any other observation proves the harness holds the prompt.
        transition([state], 'RUNNING');
        state = 'RUNNING';
      }
      switch (observation.kind) {
        case 'not_accepted':
          settle('UNKNOWN', {
            code: 'HARNESS_LOST_PROMPT',
            message: 'The harness no longer holds a prompt it had accepted.',
          });
          return;
        case 'queued':
          if (Date.now() - submittedAt >= this.#options.queuedResubmitMs) await submit();
          break;
        case 'running': {
          // The rejection limit ends the turn; the agent cannot keep submitting indefinitely.
          const counts = repository.submissionCounts(invocation.id);
          if (!counts.accepted && counts.rejected >= snapshot.agent.limits.rejectedSubmissions) {
            await stopped('FAILED', {
              code: 'RESULT_REJECTED',
              message: 'Shift rejected the result too many times.',
            });
            return;
          }
          break;
        }
        case 'awaiting_harness_prompt':
          await stopped('FAILED', {
            code: 'HARNESS_PROMPT',
            message:
              'The agent asked for a permission or an answer, which unattended runs cannot give.',
          });
          return;
        case 'ended':
          settle('FAILED', {
            code: 'RESULT_MISSING',
            message: 'The turn ended without a result Shift accepted.',
          });
          return;
        case 'interrupted':
          settle('INTERRUPTED', { code: 'INTERRUPTED', message: observation.explanation });
          return;
        case 'unknown':
          settle('UNKNOWN', { code: 'HARNESS_OUTCOME_UNKNOWN', message: observation.explanation });
          return;
      }
      await this.#sleep(signal);
    }
  }

  // On shutdown, an accounted stop lets the next start continue the same session safely. If the
  // stop cannot be confirmed, the invocation stays as it is for startup inspection.
  async #stop(
    claim: Claim,
    handle: HarnessSessionHandle,
    invocation: InvocationRow,
    state: InvocationState,
  ): Promise<void> {
    if (state !== 'RUNNING') return;
    try {
      const cancelled = await this.#options.adapter.cancel(
        handle,
        this.#options.adapter.correlate(invocation.id),
      );
      const { repository } = this.#options;
      if (cancelled.kind !== 'stopped') return;
      if (repository.submissionCounts(invocation.id).accepted) {
        repository.transitionInvocation(claim, invocation.id, ['RUNNING'], 'COMPLETED');
      } else if (cancelled.observation.kind === 'interrupted') {
        repository.transitionInvocation(claim, invocation.id, ['RUNNING'], 'INTERRUPTED', {
          error: { code: 'SHIFT_STOPPED', message: 'Shift stopped while the turn was running.' },
        });
      }
    } catch {
      // Startup inspection decides what happened.
    }
  }

  #artifactDirectory(claim: Claim, invocationId: string): string {
    return join(this.#options.artifactRoot, claim.runId, invocationId);
  }

  async #sleep(signal: AbortSignal): Promise<void> {
    await delay(this.#options.pollIntervalMs, undefined, { signal }).catch(() => undefined);
  }
}
