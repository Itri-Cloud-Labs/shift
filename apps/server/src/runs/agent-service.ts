import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from 'pino';
import type { BlobStore } from '../artifacts/store.js';
import { ShiftError } from '../domain/errors.js';
import type {
  HarnessAdapter,
  HarnessSessionHandle,
  InvocationObservation,
  Json,
  ResultHandler,
} from '../harness/types.js';
import { envelope } from './bindings.js';
import { checkEnvelope } from './envelope.js';
import {
  continuationPrompt,
  correctionPrompt,
  goalPrompt,
  retryPrompt,
  type AgentTask,
  type ReceivedHandoff,
} from './prompts.js';
import {
  StaleClaim,
  type ArtifactRole,
  type Claim,
  type InvocationRow,
  type AgentConfig,
  type ExecutionError,
  type InvocationState,
  type RunRepository,
} from './repository.js';

const contractFailures = new Set(['RESULT_MISSING', 'RESULT_REJECTED']);
// Failures that are safe to retry automatically: a provider error ended the turn, or the harness
// could not be reached before any prompt was sent. A provider refusing its credential, a failed
// turn and a broken result contract would fail the same way again.
const transientTurnFailures = new Set(['PROVIDER_ERROR']);
const transientHarnessFailures = new Set([
  'HARNESS_START_FAILED',
  'HARNESS_REQUEST_FAILED',
  'HARNESS_UNAVAILABLE',
]);

export interface AgentServiceOptions {
  repository: RunRepository;
  adapter: HarnessAdapter;
  artifactRoot: string;
  blobs: BlobStore;
  logger: Logger;
  // The largest report Shift stores.
  reportLimitBytes?: number;
  // Creates the run's worktree before its first session needs it.
  workspaces?: { ensureReady(id: string): Promise<unknown> };
  pollIntervalMs?: number;
  // An inbox item can stay undelivered after a harness restart; resubmitting the same ID wakes it.
  queuedResubmitMs?: number;
  // Consecutive failed inspections tolerated while the harness runtime restarts.
  inspectionFailures?: number;
}

const active: readonly InvocationState[] = ['PREPARING', 'SUBMITTING', 'RUNNING', 'UNCERTAIN'];

// The default report names in every invocation's directory (specification 6.5). They are display
// labels; the bytes are stored by hash.
export const reportFiles: Record<ArtifactRole, string> = {
  handoff: 'tothenextagent.md',
  human_report: 'toahumanreader.md',
};

// Turns whose files are final: nothing in the harness still writes to their directory.
const settled: readonly InvocationState[] = ['COMPLETED', 'FAILED', 'INTERRUPTED'];

// A handoff larger than this is given to the agent as a file to read instead of inline.
const inlineHandoffBytes = 64 * 1024;

// Required reports named as the agent wrote them, by the configuration's keys.
const reportRoles = { handoff: 'handoff', humanReport: 'human_report' } as const;

export type Collected = Partial<
  Record<ArtifactRole, { kind: 'published'; id: string } | { kind: 'refused'; reason: string }>
>;

// Owns goal construction, session binding, correction, continuation and result validation for
// agent node executions (specification 9). Workflow routing stays in the run repository.
export class AgentService {
  readonly #options: Required<Omit<AgentServiceOptions, 'workspaces'>> &
    Pick<AgentServiceOptions, 'workspaces'>;

  constructor(options: AgentServiceOptions) {
    this.#options = {
      pollIntervalMs: 1_000,
      queuedResubmitMs: 5_000,
      inspectionFailures: 10,
      reportLimitBytes: 1024 * 1024,
      ...options,
    };
  }

  readonly handleResult: ResultHandler = async (submission) =>
    this.#options.repository.recordSubmission(submission, (config, input) => {
      const check = checkEnvelope(config.resultSchema, input);
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
          this.#finish(claim, {
            kind: 'failed',
            error: {
              code: safe.code,
              category: 'external',
              message: safe.message,
              retryDisposition: transientHarnessFailures.has(safe.code) ? 'safe' : 'never',
            },
          });
        }
      } catch (finishError) {
        if (!(finishError instanceof StaleClaim)) throw finishError;
      }
    }
  }

  // Stops the attempt's active invocation for a cancellation. A stop that cannot be confirmed
  // leaves the invocation UNKNOWN, which keeps the cancellation waiting for the owner.
  async cancel(claim: Claim): Promise<void> {
    const { repository, adapter } = this.#options;
    const last = repository.invocations(claim.attemptId).at(-1);
    if (!last || !active.includes(last.state)) return;
    const error = { code: 'SHIFT_CANCELLED', message: 'The run was cancelled.' };
    if (last.state === 'PREPARING') {
      repository.transitionInvocation(claim, last.id, ['PREPARING'], 'INTERRUPTED', { error });
      return;
    }
    const session = repository.session(claim.executionId);
    if (!session?.harnessSessionId) return;
    const handle: HarnessSessionHandle = {
      shiftSessionId: session.agentSessionId,
      harnessSessionId: session.harnessSessionId,
      storageNamespace: session.storageNamespace,
      cwd: session.cwd,
    };
    try {
      const cancelled = await adapter.cancel(handle, adapter.correlate(last.id));
      if (cancelled.kind !== 'stopped') {
        repository.transitionInvocation(claim, last.id, active, 'UNKNOWN', {
          error: {
            code: 'HARNESS_STOP_UNCONFIRMED',
            message: `Shift could not confirm that the turn stopped: ${cancelled.explanation}`,
          },
        });
      } else if (repository.submissionCounts(last.id).accepted) {
        repository.transitionInvocation(claim, last.id, active, 'COMPLETED');
      } else {
        repository.transitionInvocation(claim, last.id, active, 'INTERRUPTED', { error });
      }
    } catch (failure) {
      // Left active: settling the cancellation then asks the owner.
      if (!(failure instanceof ShiftError) && !(failure instanceof StaleClaim)) throw failure;
    }
  }

  async #drive(claim: Claim, signal: AbortSignal): Promise<void> {
    const { repository, adapter } = this.#options;
    const config = repository.agentConfig(claim.executionId);
    const task: AgentTask = {
      goal: config.goal,
      cwd: config.cwd,
      resultSchema: config.resultSchema,
      readOnly: config.toolPolicy.mode === 'read_only',
      // Configurations frozen before reports existed ask for none.
      reports: config.reports ?? { handoff: 'off', humanReport: 'off' },
      handoffs: [],
    };
    if (config.workspaceId !== undefined) {
      if (!this.#options.workspaces) {
        throw new ShiftError('WORKSPACE_UNAVAILABLE', 'Run workspaces are not configured.', 503);
      }
      await this.#options.workspaces.ensureReady(config.workspaceId);
    }
    const handle = await this.#session(claim, config);
    if (!handle) return;
    for (;;) {
      if (signal.aborted) return;
      const invocations = repository.invocations(claim.attemptId);
      const last = invocations.at(-1);
      if (last && active.includes(last.state)) {
        await this.#invoke(claim, handle, last, config, signal);
        continue;
      }
      if (last && settled.includes(last.state)) await this.#collect(claim, last.id);
      const next = this.#decide(claim, config, invocations);
      if (!next) return;
      const id = randomUUID();
      const artifactDirectory = this.#artifactDirectory(claim, id);
      // Every prompt that states the goal carries the handoffs again, also in a reused session.
      if (next !== 'correction') task.handoffs = await this.#received(config, artifactDirectory);
      // A later attempt continues the session. Its first prompt says why the earlier one stopped:
      // an automatic retry follows a failure, an owner retry a stop whose effects are unknown. An
      // earlier attempt that never sent a prompt changed nothing, so the goal is sent as usual.
      const earlier = next === 'goal' ? repository.lastInvocationId(claim.executionId) : undefined;
      const previous = earlier === undefined ? null : repository.previousAttempt(claim);
      const retried = previous !== null;
      const prompt = retried
        ? retryPrompt(
            task,
            artifactDirectory,
            previous.state === 'FAILED' && previous.error ? previous.error : undefined,
          )
        : next === 'goal'
          ? goalPrompt(task, artifactDirectory)
          : next === 'correction'
            ? correctionPrompt(
                task,
                artifactDirectory,
                last?.state === 'COMPLETED' ? this.#missingReports(config, last.id) : [],
              )
            : continuationPrompt(task, artifactDirectory);
      repository.createInvocation(claim, {
        id,
        agentSessionId: handle.shiftSessionId,
        kind: retried ? 'continuation' : next,
        correlationId: adapter.correlate(id).providerMessageId,
        prompt,
        previousInvocationId: last?.id ?? (retried ? earlier! : null),
      });
    }
  }

  // The execution's session, fixed across its attempts (specification 6.4): a new one for a fresh
  // strategy or a first per-run visit, otherwise the per-run or referenced one. A reused
  // conversation the harness no longer has is never replaced by a new one; the owner decides.
  async #session(claim: Claim, config: AgentConfig): Promise<HarnessSessionHandle | null> {
    const { repository, adapter } = this.#options;
    const policy = config.session ?? { strategy: 'fresh', lifetime: 'persistent' };
    const { node } = repository.execution(claim.executionId);
    const existing =
      policy.strategy === 'reference'
        ? policy.sessionId
        : policy.strategy === 'per_run'
          ? repository.perRunSession(claim.runId, node.id)
          : null;
    const session =
      repository.session(claim.executionId) ??
      (existing
        ? repository.useSession(claim, existing)
        : repository.bindSession(claim, {
            harnessId: adapter.id,
            cwd: config.cwd,
            config: { model: { ...config.model } },
            storageNamespace: adapter.storageNamespace,
            lifetime: policy.strategy === 'reference' ? 'persistent' : policy.lifetime,
            workspaceId: config.workspaceId ?? null,
            perRun: policy.strategy === 'per_run',
          }));
    if (session.state === 'READY' && session.harnessSessionId) {
      const handle = {
        shiftSessionId: session.agentSessionId,
        harnessSessionId: session.harnessSessionId,
        storageNamespace: session.storageNamespace,
        cwd: session.cwd,
      };
      if ((await adapter.inspectSession(handle)).kind === 'missing') {
        repository.needsHuman(claim, {
          code: 'SESSION_MISSING',
          explanation: `The harness no longer has the conversation of session ${session.agentSessionId}. Shift does not start a new one in its place.`,
        });
        return null;
      }
      return handle;
    }
    // Repeating an interrupted creation addresses the same harness session.
    const handle = await adapter.createSession({
      shiftSessionId: session.agentSessionId,
      operationId: claim.attemptId,
      cwd: config.cwd,
      model: config.model,
    });
    repository.markSessionReady(claim, handle);
    return handle;
  }

  // What follows a finished invocation, or null once the attempt has been finished.
  #decide(
    claim: Claim,
    config: AgentConfig,
    invocations: InvocationRow[],
  ): 'goal' | 'correction' | 'continuation' | null {
    const { repository } = this.#options;
    const { limits } = config;
    const last = invocations.at(-1);
    if (!last) return 'goal';
    const count = (kind: InvocationRow['kind']) =>
      invocations.filter((invocation) => invocation.kind === kind).length;
    switch (last.state) {
      case 'COMPLETED': {
        const envelope = last.result!;
        // A completed result counts only with its required reports; a blocker or failure keeps
        // its own cause whatever reports came with it.
        const missing =
          envelope.status === 'completed' ? this.#missingReports(config, last.id) : [];
        if (missing.length) {
          if (count('correction') < limits.corrections) return 'correction';
          this.#finish(claim, {
            kind: 'failed',
            error: {
              code: 'REPORTS_MISSING',
              category: 'contract',
              message: `The agent completed without these required reports: ${missing.join(', ')}.`,
            },
          });
          return null;
        }
        if (envelope.status === 'completed') {
          this.#finish(claim, { kind: 'completed', data: envelope.data, invocationId: last.id });
        } else {
          const problem = envelope.status === 'blocked' ? envelope.blocker : envelope.error;
          this.#finish(claim, {
            kind: 'failed',
            error: { ...problem, category: envelope.status === 'blocked' ? 'blocked' : 'external' },
          });
        }
        return null;
      }
      case 'FAILED':
        if (last.error?.code === 'HARNESS_PROMPT') {
          this.#finish(claim, {
            kind: 'failed',
            error: { ...last.error, category: 'blocked' },
          });
          return null;
        }
        // Corrections remedy a model that broke the result contract. A turn the harness or the
        // provider failed would fail the same way again, so its cause is the node's error.
        if (last.error && !contractFailures.has(last.error.code)) {
          this.#finish(claim, {
            kind: 'failed',
            error: {
              ...last.error,
              category: 'external',
              retryDisposition: transientTurnFailures.has(last.error.code) ? 'safe' : 'never',
            },
          });
          return null;
        }
        if (count('correction') < limits.corrections) return 'correction';
        this.#finish(claim, {
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
    config: AgentConfig,
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
        toolPolicy: config.toolPolicy,
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
          if (!counts.accepted && counts.rejected >= config.limits.rejectedSubmissions) {
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
          settle(
            'FAILED',
            observation.failure ?? {
              code: 'RESULT_MISSING',
              message: 'The turn ended without a result Shift accepted.',
            },
          );
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

  // The agent publishes new data with its session reference and keeps the incoming context.
  #finish(
    claim: Claim,
    outcome:
      | { kind: 'completed'; data: Json; invocationId: string }
      | { kind: 'failed'; error: ExecutionError },
  ): void {
    const { repository } = this.#options;
    if (outcome.kind === 'failed') {
      repository.completeExecution(claim, outcome);
      return;
    }
    const context = repository.execution(claim.executionId);
    const output = envelope(outcome.data, context.input);
    // The successful turn's reports are the node's (specification 6.5); earlier ones stay in history.
    // Its handoff becomes the current one; with none, nothing older is passed on as if it were.
    const projectId = context.snapshot.project.id;
    const refs = repository.artifacts({ invocationId: outcome.invocationId }).map((artifact) => ({
      kind: 'artifact',
      id: artifact.id,
      projectId,
      role: artifact.role,
      filename: artifact.filename,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    }));
    output.references.artifacts = refs;
    output.context.handoffs = refs.filter((ref) => ref.role === 'handoff');
    const session = repository.session(claim.executionId);
    if (session && context.snapshot.project.id) {
      output.references.agentSession = {
        kind: 'agent_session',
        id: session.agentSessionId,
        projectId: context.snapshot.project.id,
      };
    }
    repository.completeExecution(claim, { kind: 'completed', output, port: 'success' });
  }

  // Required reports a turn did not leave, by file name.
  #missingReports(config: AgentConfig, invocationId: string): string[] {
    const published = new Set(
      this.#options.repository.artifacts({ invocationId }).map((artifact) => artifact.role),
    );
    return (Object.keys(reportRoles) as (keyof typeof reportRoles)[])
      .filter((key) => config.reports?.[key] === 'required')
      .filter((key) => !published.has(reportRoles[key]))
      .map((key) => reportFiles[reportRoles[key]]);
  }

  // The frozen handoffs as the agent reads them: inline when small, otherwise copied into the
  // turn's directory. Bytes that went missing fail the node before anything is sent.
  async #received(config: AgentConfig, directory: string): Promise<ReceivedHandoff[]> {
    const { repository, blobs } = this.#options;
    const received: ReceivedHandoff[] = [];
    for (const [index, { artifactId, nodeId }] of (config.handoffs ?? []).entries()) {
      const artifact = repository.artifact(artifactId);
      const stream = await blobs.read(artifact.storageKey);
      if (!stream)
        throw new ShiftError('ARTIFACT_BYTES_MISSING', 'A handoff’s bytes are missing.', 410);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      const bytes = Buffer.concat(chunks);
      if (bytes.length <= inlineHandoffBytes) {
        received.push({ nodeId, text: bytes.toString('utf8') });
        continue;
      }
      const folder = join(directory, 'received');
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const path = join(folder, `handoff-${index + 1}.md`);
      await writeFile(path, bytes, { mode: 0o600 });
      received.push({ nodeId, path });
    }
    return received;
  }

  // Stores the default reports a finished turn left in its directory. Collecting again publishes
  // nothing new, so a restart between storing and publishing only leaves an unreferenced blob.
  async #collect(claim: Claim, invocationId: string): Promise<Collected> {
    const { repository, blobs, artifactRoot, reportLimitBytes, logger } = this.#options;
    const collected: Collected = {};
    for (const [role, filename] of Object.entries(reportFiles) as [ArtifactRole, string][]) {
      const stored = await blobs.ingest(
        artifactRoot,
        this.#artifactDirectory(claim, invocationId),
        filename,
        reportLimitBytes,
      );
      if (stored.kind === 'missing') continue;
      if (stored.kind === 'refused') {
        logger.warn({ runId: claim.runId, invocationId, role }, stored.reason);
        collected[role] = stored;
        continue;
      }
      const id = repository.publishArtifact(claim, {
        invocationId,
        role,
        filename,
        mediaType: 'text/markdown; charset=utf-8',
        sha256: stored.sha256,
        sizeBytes: stored.sizeBytes,
        storageKey: stored.storageKey,
      });
      collected[role] = { kind: 'published', id };
    }
    return collected;
  }

  #artifactDirectory(claim: Claim, invocationId: string): string {
    return join(this.#options.artifactRoot, claim.runId, invocationId);
  }

  async #sleep(signal: AbortSignal): Promise<void> {
    await delay(this.#options.pollIntervalMs, undefined, { signal }).catch(() => undefined);
  }
}
