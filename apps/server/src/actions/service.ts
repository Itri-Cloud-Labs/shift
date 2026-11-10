import type Database from 'better-sqlite3';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import type { Logger } from 'pino';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import { envelope } from '../runs/bindings.js';
import { checkValue } from '../runs/envelope.js';
import {
  StaleClaim,
  type Claim,
  type ExecutionError,
  type RunRepository,
} from '../runs/repository.js';
import { nodeType } from '../workflows/nodes.js';
import {
  safeToRepeat,
  type ActionConfig,
  gitReads,
  gitTypes,
  type CommandConfig,
  type GitConfig,
  type ScriptConfig,
} from './config.js';
import type { Authority, Credentials } from './credentials.js';
import {
  argumentHash,
  EffectConflict,
  RunNotActive,
  type EffectStore,
  type Operation,
} from './effects.js';
import {
  gitDiff,
  gitIdentity,
  gitStatus,
  appTransport,
  hostTransport,
  performGit,
  planGit,
  reconcileGit,
  type GitContext,
} from './git.js';
import { sendRequest } from './http.js';
import { GitHubError } from '../github/api.js';
import {
  getPr,
  githubFailure,
  githubIdentity,
  performPr,
  planPr,
  reconcileCreate,
  reconcileUpdate,
  resolveRepository,
  type GitHubConfig,
  type GitHubContext,
  type Repo,
} from '../github/actions.js';
import {
  planMerge,
  performMerge,
  readChecks,
  reconcileMerge,
  type CheckSummary,
} from '../github/checks.js';
import type { GitHubIntegration } from '../github/integration.js';
import { githubTypes, nodePermissions } from '../github/permissions.js';
import { redact, type Outcome } from './outcome.js';
import type { ProcessResult, ProcessRunner } from './process.js';

// Runs Command, HTTP and Script nodes (specification sections 8 and 11). Each run of an action is
// an effect operation: its intent is recorded before anything happens, its known result before the
// run advances, and an operation an earlier process left behind is reconciled from its evidence
// rather than repeated. Commands and scripts are code the owner wrote and runs as their own
// account; Shift accounts for their processes but does not sandbox them against the owner.

export interface ActionServiceOptions {
  db: Database.Database;
  repository: RunRepository;
  effects: EffectStore;
  credentials?: Credentials;
  runner?: ProcessRunner;
  workspaces?: { ensureReady(id: string): Promise<{ path: string }> };
  logger: Logger;
  fetch?: typeof fetch;
  github?: GitHubIntegration;
  clock?: { now(): number };
}

// The parts of the server's environment a command inherits: enough to find the owner's tools and
// their configuration, and nothing of Shift's own secrets.
const inherited = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'TZ',
  'TMPDIR',
  'TERM',
  'SSH_AUTH_SOCK',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
];

export function baseEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined && (inherited.includes(name) || name.startsWith('LC_')))
      env[name] = value;
  return env;
}

// The script runner: reads `{source, input, bindings}` on stdin, runs the source as the body of an
// async function and writes `{ok, value}` or `{ok: false, error}` to descriptor 3. What the script
// prints goes to stderr, so it can never be mistaken for its result.
const scriptRunner = `
const fs = require('node:fs');
const util = require('node:util');
const write = (text) => { const bytes = Buffer.from(text); let at = 0; while (at < bytes.length) at += fs.writeSync(3, bytes, at); };
for (const name of ['log', 'info', 'debug', 'warn', 'error']) console[name] = (...items) => process.stderr.write(util.format(...items) + '\\n');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', async () => {
  let reply;
  try {
    const { source, input, bindings } = JSON.parse(raw);
    const AsyncFunction = (async () => {}).constructor;
    const value = await new AsyncFunction('input', 'bindings', source)(input, bindings);
    if (value === undefined) throw new Error('The script returned nothing; return a JSON value.');
    reply = JSON.stringify({ ok: true, value });
  } catch (error) {
    reply = JSON.stringify({ ok: false, error: String((error && error.stack) || error).slice(0, 4000) });
  }
  write(reply);
  process.exit(0);
});
`;

const maxScriptResultBytes = 1024 * 1024;

const actionError = (
  code: string,
  message: string,
  category: ExecutionError['category'],
  details?: Json,
): ExecutionError => ({
  code,
  category,
  message,
  retryDisposition: 'never',
  ...(details === undefined ? {} : { details }),
});

export class ActionService {
  readonly #options: ActionServiceOptions;

  constructor(options: ActionServiceOptions) {
    this.#options = options;
  }

  #now(): number {
    return this.#options.clock?.now() ?? Date.now();
  }

  async run(claim: Claim, signal: AbortSignal): Promise<void> {
    try {
      await this.#run(claim, signal);
    } catch (error) {
      if (error instanceof StaleClaim || error instanceof RunNotActive) return;
      throw error;
    }
  }

  async #run(claim: Claim, signal: AbortSignal): Promise<void> {
    const { repository, effects } = this.#options;
    const context = repository.execution(claim.executionId);
    const config = context.config as unknown as ActionConfig;
    const projectId = context.snapshot.project.id;
    const authority: Authority = context.snapshot.authority ?? { denied: [], credentials: {} };
    const fail = (error: ExecutionError) =>
      repository.completeExecution(claim, { kind: 'failed', error });
    // A revoked permission stops the action before anything is recorded for it.
    try {
      const permission = nodeType(context.node.type, context.node.typeVersion)?.permission;
      if (permission && projectId !== null && this.#options.credentials)
        this.#options.credentials.allowed(projectId, authority, permission);
    } catch (error) {
      if (!(error instanceof ShiftError)) throw error;
      return fail(actionError(error.code, error.message, 'permission'));
    }
    if (gitTypes.has(config.action))
      return this.#git(claim, config as GitConfig, signal, projectId, authority);
    if (githubTypes.has(config.action))
      return this.#github(claim, config as GitHubConfig, signal, projectId, authority);
    let operation = effects.latest(claim.executionId, config.action);
    // A known outcome is final for the operation: a recovered attempt reports it, never repeats it.
    // An automatic retry after a safe failure starts a new operation.
    if (operation?.state === 'SUCCEEDED') {
      return this.#complete(claim, operation, (operation.result as { data: Json }).data);
    }
    if (operation?.state === 'FAILED') {
      const error = operation.error as unknown as ExecutionError;
      if (!(error.retryDisposition === 'safe' && operation.attemptId !== claim.attemptId))
        return fail(error);
      operation = null;
    }
    if (operation?.state === 'SUBMITTED' || operation?.state === 'UNKNOWN') {
      const settled = await this.#reconcile(claim, operation, config);
      if (!settled) return;
      operation = null;
    }
    if (operation?.state === 'ABANDONED') operation = null;
    try {
      operation = operation
        ? effects.adopt(claim, operation, config as unknown as Json)
        : effects.intend(claim, config.action, config as unknown as Json);
    } catch (error) {
      if (!(error instanceof EffectConflict)) throw error;
      repository.needsHuman(claim, {
        code: 'EFFECT_CONFLICT',
        explanation: `Operation ${error.operation.key} was recorded with different arguments than this step now has. Shift will not perform a changed action under the same identity.`,
        executionId: claim.executionId,
      });
      return;
    }
    let outcome: Outcome;
    try {
      outcome = await this.#perform(claim, operation, config, projectId, authority, signal);
    } catch (error) {
      if (error instanceof StaleClaim || error instanceof RunNotActive) throw error;
      // Failing before submission changed nothing; after it, the outcome is unknown.
      const current = effects.get(operation.id);
      if (current.state === 'INTENDED') {
        const known =
          error instanceof ShiftError
            ? actionError(error.code, error.message, error.status === 403 ? 'permission' : 'input')
            : actionError('INTERNAL_ERROR', 'The action failed unexpectedly.', 'internal');
        outcome = { kind: 'failed', error: known };
      } else {
        this.#options.logger.error(
          { runId: claim.runId, code: (error as { code?: string }).code },
          'An action failed after it was submitted.',
        );
        outcome = {
          kind: 'uncertain',
          explanation: 'Shift lost track of the action after it started.',
        };
      }
    }
    this.#settle(claim, operation, outcome);
  }

  // Git reads observe the workspace afresh on every attempt and record no operation. Mutations
  // are planned first: what they will change and what they expect to find becomes the
  // operation's arguments and evidence, so recovery decides from the repository and the remote
  // what an interrupted one did instead of guessing.
  async #git(
    claim: Claim,
    config: GitConfig,
    signal: AbortSignal,
    projectId: string | null,
    authority: Authority,
  ): Promise<void> {
    const { repository, runner } = this.#options;
    if (!this.#options.workspaces)
      throw new ShiftError('WORKSPACE_UNAVAILABLE', 'Run workspaces are not configured.', 503);
    let context: GitContext;
    try {
      const workspace = (await this.#options.workspaces.ensureReady(config.workspaceId)) as {
        path: string;
        baseCommit?: string;
      };
      context = {
        cwd: workspace.path,
        baseCommit: workspace.baseCommit ?? '',
        env: baseEnvironment(),
        transport: hostTransport,
        signal,
        ...(runner ? { runner } : {}),
      };
      if (config.action === 'git_push' && config.transport === 'github_app') {
        // The project's GitHub repository, with a token that can write only its contents.
        const target = await this.#githubContext(projectId, authority, 'git_push', signal);
        const repo = await resolveRepository(target);
        const { token } = await target.api.token(
          target.binding.keys,
          target.binding.installationId,
          { repositoryIds: [repo.id], permissions: target.binding.permissions },
        );
        context.transport = appTransport(token);
        context.remote = {
          name: `github:${repo.owner}/${repo.name}`,
          url: `${target.binding.keys.host}/${repo.owner}/${repo.name}.git`,
        };
      }
    } catch (error) {
      if (!(error instanceof ShiftError)) throw error;
      return repository.completeExecution(claim, {
        kind: 'failed',
        error: actionError(error.code, error.message, 'external'),
      });
    }
    const finish = (outcome: Outcome, operation?: Operation) => {
      if (operation) return this.#settle(claim, operation, outcome);
      if (outcome.kind === 'succeeded') return this.#complete(claim, null, outcome.data);
      if (outcome.kind === 'failed')
        return repository.completeExecution(claim, { kind: 'failed', error: outcome.error });
    };
    const guarded = async (work: () => Promise<Outcome>): Promise<Outcome> => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof StaleClaim || error instanceof RunNotActive) throw error;
        if (error instanceof ShiftError)
          return { kind: 'failed', error: actionError(error.code, error.message, 'external') };
        throw error;
      }
    };
    if (gitReads.has(config.action))
      return finish(
        await guarded(() =>
          config.action === 'git_status' ? gitStatus(config, context) : gitDiff(config, context),
        ),
      );
    const unitOf = (operation: Operation) =>
      config.action === 'git_push' && runner ? { unit: runner.unit(operation.id) } : {};
    return this.#mutate(claim, config.action, gitIdentity(config), guarded, finish, {
      plan: () => planGit(config, context),
      perform: (operation) =>
        performGit(config, context, operation.args as Record<string, Json>, operation.evidence),
      reconcile: async (operation) => {
        const unit = operation.evidence['unit'];
        if (typeof unit === 'string' && runner) await runner.kill(unit);
        return reconcileGit(
          config,
          context,
          operation.args as Record<string, Json>,
          operation.evidence,
        );
      },
      submitted: unitOf,
    });
  }

  // A mutation whose effect can be read back (Git, GitHub). It is planned first: what it will
  // change and what it expects to find become the operation's arguments and evidence, so recovery
  // decides from what the repository or the provider shows what an interrupted one did, instead of
  // guessing. `redo` from reconciliation proves it had no effect: it is performed again as recorded.
  async #mutate(
    claim: Claim,
    action: string,
    identity: Json,
    guarded: (work: () => Promise<Outcome>) => Promise<Outcome>,
    finish: (outcome: Outcome, operation?: Operation) => void,
    steps: {
      plan(): Promise<
        | { kind: 'ready'; args: Record<string, Json>; evidence: Record<string, Json> }
        | { kind: 'done'; outcome: Outcome }
      >;
      perform(operation: Operation): Promise<Outcome>;
      reconcile(operation: Operation): Promise<Outcome | { kind: 'redo' }>;
      submitted?(operation: Operation): Record<string, Json>;
    },
  ): Promise<void> {
    const { repository, effects } = this.#options;
    let operation = effects.latest(claim.executionId, action);
    if (operation?.state === 'SUCCEEDED')
      return this.#complete(claim, operation, (operation.result as { data: Json }).data);
    if (operation?.state === 'FAILED') {
      const error = operation.error as unknown as ExecutionError;
      if (!(error.retryDisposition === 'safe' && operation.attemptId !== claim.attemptId))
        return finish({ kind: 'failed', error });
      operation = null;
    }
    if (operation?.state === 'ABANDONED') operation = null;
    if (
      operation &&
      argumentHash((operation.args as Record<string, Json>)['config'] ?? null) !==
        argumentHash(identity)
    ) {
      repository.needsHuman(claim, {
        code: 'EFFECT_CONFLICT',
        explanation: `Operation ${operation.key} was recorded with different arguments than this step now has. Shift will not perform a changed action under the same identity.`,
        executionId: claim.executionId,
      });
      return;
    }
    if (operation?.state === 'SUBMITTED' || operation?.state === 'UNKNOWN') {
      const recorded = operation;
      const observed = await guarded(async () => {
        const result = await steps.reconcile(recorded);
        return result.kind === 'redo' ? ({ kind: 'stopped' } as Outcome) : (result as Outcome);
      });
      if (observed.kind !== 'stopped') return finish(observed, operation);
      operation = effects.adopt(claim, operation, operation.args);
    }
    if (!operation) {
      const plan = await guarded(async () => {
        const planned = await steps.plan();
        return planned.kind === 'done'
          ? planned.outcome
          : ({ kind: 'succeeded', data: planned as unknown as Json } as Outcome);
      });
      if (plan.kind !== 'succeeded') return finish(plan);
      const { args, evidence } = plan.data as unknown as {
        args: Record<string, Json>;
        evidence: Record<string, Json>;
      };
      operation = effects.intend(claim, action, { ...args, config: identity }, evidence);
    } else if (operation.state === 'INTENDED') {
      operation = effects.adopt(claim, operation, operation.args);
    }
    operation = effects.submit(claim, operation.id, {
      submittedAt: Date.now(),
      ...(steps.submitted?.(operation) ?? {}),
    });
    const submitted = operation;
    let outcome: Outcome;
    try {
      outcome = await steps.perform(submitted);
    } catch (error) {
      if (error instanceof StaleClaim || error instanceof RunNotActive) throw error;
      this.#options.logger.error(
        { runId: claim.runId, code: (error as { code?: string }).code },
        'A mutation failed after it was submitted.',
      );
      outcome = {
        kind: 'uncertain',
        explanation: `Shift lost track of the ${action} after it started.`,
      };
    }
    this.#settle(claim, operation, outcome);
  }

  async #githubContext(
    projectId: string | null,
    authority: Authority,
    type: string,
    signal: AbortSignal,
  ): Promise<GitHubContext> {
    const github = this.#options.github;
    if (!github || projectId === null)
      throw new ShiftError('GITHUB_NOT_CONFIGURED', 'This server has no GitHub integration.', 422);
    const binding = github.binding(
      projectId,
      authority.github?.connectionId ?? null,
      nodePermissions[type]!,
    );
    return { api: github.api, binding, signal };
  }

  // Pull request nodes. A read observes GitHub afresh on every attempt and records no operation;
  // a create or update is a reconciled mutation. Failures GitHub reports, such as a missing
  // permission or a protection rule, are ordinary structured errors.
  async #github(
    claim: Claim,
    config: GitHubConfig,
    signal: AbortSignal,
    projectId: string | null,
    authority: Authority,
  ): Promise<void> {
    const { repository } = this.#options;
    const finish = (outcome: Outcome, operation?: Operation) => {
      if (operation) return this.#settle(claim, operation, outcome);
      if (outcome.kind === 'succeeded') return this.#complete(claim, null, outcome.data);
      if (outcome.kind === 'failed')
        return repository.completeExecution(claim, { kind: 'failed', error: outcome.error });
    };
    const guarded = async (work: () => Promise<Outcome>): Promise<Outcome> => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof StaleClaim || error instanceof RunNotActive) throw error;
        if (error instanceof GitHubError) return githubFailure(error);
        if (error instanceof ShiftError)
          return {
            kind: 'failed',
            error: actionError(
              error.code,
              error.message,
              error.status === 403 ? 'permission' : 'input',
            ),
          };
        throw error;
      }
    };
    let context: GitHubContext | undefined;
    let repo: Repo | undefined;
    const prepared = await guarded(async () => {
      context = await this.#githubContext(projectId, authority, config.action, signal);
      repo = await resolveRepository(context);
      return { kind: 'succeeded', data: null };
    });
    if (prepared.kind !== 'succeeded') return finish(prepared);
    const target = context!;
    const resolved = repo!;
    if (config.action === 'github_get_pr')
      return finish(await guarded(() => getPr(config, target, resolved)));
    if (config.action === 'github_verify_checks')
      return finish(
        await guarded(async () => ({
          kind: 'succeeded',
          data: (await readChecks(
            target,
            resolved,
            config.commit!,
            config.checks,
          )) as unknown as Json,
        })),
      );
    if (config.action === 'github_wait_checks') return this.#poll(claim, config, target, resolved);
    const identity = githubIdentity(config);
    if (config.action === 'github_merge') {
      const merge = {
        number: config.number!,
        method: config.method ?? 'merge',
        ...(config.expectedCommit ? { expectedCommit: config.expectedCommit } : {}),
        ...(config.commitTitle !== undefined ? { title: config.commitTitle } : {}),
        ...(config.commitMessage !== undefined ? { message: config.commitMessage } : {}),
      } as const;
      return this.#mutate(claim, config.action, identity, guarded, finish, {
        plan: () => planMerge(merge, target, resolved),
        perform: (operation) =>
          performMerge(
            target,
            resolved,
            operation.args as Record<string, Json>,
            operation.evidence,
          ),
        reconcile: (operation) =>
          reconcileMerge(
            target,
            resolved,
            operation.args as Record<string, Json>,
            operation.evidence,
          ),
      });
    }
    return this.#mutate(claim, config.action, identity, guarded, finish, {
      plan: async () => planPr(config, resolved),
      perform: (operation) =>
        performPr(config, target, resolved, operation.args as Record<string, Json>, operation.id),
      reconcile: (operation) =>
        config.action === 'github_create_pr'
          ? reconcileCreate(target, resolved, operation.args as Record<string, Json>, operation.id)
          : reconcileUpdate(target, resolved, operation.args as Record<string, Json>),
    });
  }

  // One poll of Wait for Checks. Each is a fresh read stored as the next observation, never a
  // reused result: then the step succeeds, fails or times out, or waits for the next poll, in the
  // same transaction. A read GitHub refuses is the step's error; one that cannot reach GitHub is
  // tried again at the next poll until the deadline.
  async #poll(
    claim: Claim,
    config: GitHubConfig,
    target: GitHubContext,
    repo: Repo,
  ): Promise<void> {
    const { repository, db } = this.#options;
    const commit = config.commit!;
    const deadline = config.deadline!;
    let summary: CheckSummary | null = null;
    let unreachable: GitHubError | null = null;
    try {
      summary = await readChecks(target, repo, commit, config.checks);
    } catch (error) {
      if (error instanceof StaleClaim || error instanceof RunNotActive) throw error;
      if (!(error instanceof GitHubError)) throw error;
      if (error.providerStatus !== null && error.providerStatus < 500) {
        const failed = githubFailure(error);
        if (failed.kind === 'failed')
          repository.completeExecution(claim, { kind: 'failed', error: failed.error });
        return;
      }
      unreachable = error;
    }
    if (target.signal.aborted) return;
    const now = this.#now();
    const observed: Json = summary
      ? (summary as unknown as Json)
      : { commit, state: 'unreachable', message: unreachable!.message };
    try {
      db.transaction(() => {
        const ordinal = repository.observe(claim, commit, observed);
        const data = { ...(observed as Record<string, Json>), polls: ordinal, deadline };
        const { input } = repository.execution(claim.executionId);
        if (summary && (summary.state === 'success' || summary.state === 'failure'))
          return repository.completeExecution(claim, {
            kind: 'completed',
            output: envelope(data, input),
            port: summary.state,
          });
        if (now >= deadline)
          return repository.completeExecution(claim, {
            kind: 'completed',
            output: envelope(data, input),
            port: 'timeout',
          });
        repository.startPoll(claim, Math.min(now + (config.intervalMs ?? 30_000), deadline), {
          commit,
          ordinal,
          deadline,
          state: summary?.state ?? 'unreachable',
        });
      })();
    } catch (error) {
      if (error instanceof StaleClaim) return;
      throw error;
    }
  }

  // Settles an operation an earlier process or attempt left after submitting it. Its processes are
  // stopped first, so nothing it started still runs. Returns whether a new operation may start.
  async #reconcile(claim: Claim, operation: Operation, config: ActionConfig): Promise<boolean> {
    const { effects, repository, runner } = this.#options;
    const unit = operation.evidence['unit'];
    if (typeof unit === 'string') {
      try {
        if (!runner) throw new Error('No process runner.');
        await runner.kill(unit);
      } catch {
        effects.settle(claim, operation.id, {
          state: 'UNKNOWN',
          evidence: { stopUnconfirmed: true },
        });
        repository.needsHuman(claim, {
          code: 'ACTION_STOP_UNCONFIRMED',
          explanation: `Shift could not confirm that the processes of operation ${operation.key} stopped. Check them, then retry, complete or fail the step.`,
          executionId: claim.executionId,
        });
        return false;
      }
    }
    if (safeToRepeat(config)) {
      effects.settle(claim, operation.id, {
        state: 'ABANDONED',
        resolution: { by: 'shift', reason: 'safe_to_repeat' },
      });
      return true;
    }
    effects.settle(claim, operation.id, { state: 'UNKNOWN' });
    repository.needsHuman(claim, {
      code: 'EFFECT_UNCERTAIN',
      explanation: `The ${config.action} of operation ${operation.key} was submitted but Shift stopped before its outcome was recorded. Check what it did, then retry, complete or fail the step.`,
      executionId: claim.executionId,
    });
    return false;
  }

  #settle(claim: Claim, operation: Operation, outcome: Outcome): void {
    const { effects, repository, db } = this.#options;
    switch (outcome.kind) {
      case 'succeeded':
        db.transaction(() => {
          effects.settle(claim, operation.id, {
            state: 'SUCCEEDED',
            result: { data: outcome.data, ...outcome.record },
          });
          this.#complete(claim, operation, outcome.data);
        })();
        return;
      case 'failed':
        db.transaction(() => {
          effects.settle(claim, operation.id, {
            state: 'FAILED',
            error: outcome.error as unknown as Json,
            ...(outcome.record ? { result: outcome.record } : {}),
          });
          repository.completeExecution(claim, { kind: 'failed', error: outcome.error });
        })();
        return;
      case 'uncertain':
        db.transaction(() => {
          effects.settle(claim, operation.id, {
            state: 'UNKNOWN',
            ...(outcome.evidence ? { evidence: outcome.evidence } : {}),
          });
          repository.needsHuman(claim, {
            code: 'EFFECT_UNCERTAIN',
            explanation: `${outcome.explanation} Check what it did, then retry, complete or fail the step.`,
            executionId: claim.executionId,
          });
        })();
        return;
      case 'stopped': {
        // A cancellation accounts for the stop; a shutdown leaves the operation for recovery.
        const run = repository.runState(claim.runId);
        if (run === 'CANCEL_REQUESTED')
          effects.settle(claim, operation.id, {
            state: 'UNKNOWN',
            evidence: { stoppedBy: 'cancellation' },
          });
        else effects.observe(claim, operation.id, { stoppedBy: 'shutdown' });
        return;
      }
    }
  }

  #complete(claim: Claim, _operation: Operation | null, data: Json): void {
    const { input } = this.#options.repository.execution(claim.executionId);
    this.#options.repository.completeExecution(claim, {
      kind: 'completed',
      output: envelope(data, input),
      port: 'success',
    });
  }

  async #perform(
    claim: Claim,
    operation: Operation,
    config: ActionConfig,
    projectId: string | null,
    authority: Authority,
    signal: AbortSignal,
  ): Promise<Outcome> {
    const secret = (name: string) => {
      if (!this.#options.credentials || projectId === null)
        throw new ShiftError('CREDENTIAL_UNAVAILABLE', `Credential ${name} is not available.`, 403);
      return this.#options.credentials.value(projectId, authority, name);
    };
    const submit = (evidence: Record<string, Json> = {}) =>
      this.#options.effects.submit(claim, operation.id, {
        submittedAt: Date.now(),
        ...evidence,
      });
    if (config.action === 'http') {
      const headers: Record<string, string> = {};
      const raw: string[] = [];
      for (const [name, ref] of Object.entries(config.credentialHeaders)) {
        const credential = secret(ref.credential);
        raw.push(credential);
        const value = `${ref.prefix}${credential}`;
        if (/[\r\n\0]/.test(value))
          throw new ShiftError(
            'INVALID_ARGUMENT',
            `Credential header ${name} has a line break.`,
            422,
          );
        headers[name] = value;
      }
      return sendRequest(config, headers, raw, signal, () => submit(), this.#options.fetch);
    }
    const runner = this.#options.runner;
    if (!runner || !(await runner.available()))
      throw new ShiftError(
        'ACTION_CONTAINMENT_UNAVAILABLE',
        'Commands and scripts need a systemd user manager, so Shift can account for every process they start.',
        503,
      );
    const unit = runner.unit(operation.id);
    const started = (pid: number) => {
      try {
        this.#options.effects.observe(claim, operation.id, { pid });
      } catch {
        // The attempt lost its claim; the process is stopped by whoever holds it now.
      }
    };
    if (config.action === 'command') {
      const secrets: Record<string, string> = {};
      for (const [name, ref] of Object.entries(config.credentials)) secrets[name] = secret(ref);
      const cwd = await this.#directory(config);
      submit({ unit });
      const result = await runner.run({
        unit,
        command: config.executable,
        args: config.args,
        cwd,
        env: {
          ...baseEnvironment(),
          SHIFT_RUN_ID: claim.runId,
          SHIFT_EXECUTION_ID: claim.executionId,
          ...config.env,
          ...secrets,
        },
        timeoutMs: config.timeoutMs,
        maxOutputBytes: config.maxOutputBytes,
        signal,
        started,
      });
      return commandOutcome(config, result, Object.values(secrets));
    }
    if (config.action !== 'script')
      throw new ShiftError('UNSUPPORTED_NODE', `${config.action} has no executor.`, 422);
    submit({ unit });
    const result = await runner.run({
      unit,
      command: process.execPath,
      args: ['--permission', '--max-old-space-size=256', '-e', scriptRunner],
      cwd: tmpdir(),
      env: process.env['PATH'] === undefined ? {} : { PATH: process.env['PATH'] },
      timeoutMs: config.timeoutMs,
      maxOutputBytes: 64 * 1024,
      stdin: JSON.stringify({
        source: config.source,
        input: config.input,
        bindings: config.bindings,
      }),
      maxResultBytes: maxScriptResultBytes,
      signal,
      started,
    });
    return scriptOutcome(config, result);
  }

  // The command's directory, resolved inside its workspace even through symbolic links.
  async #directory(config: CommandConfig): Promise<string> {
    if (!this.#options.workspaces)
      throw new ShiftError('WORKSPACE_UNAVAILABLE', 'Run workspaces are not configured.', 503);
    const workspace = await this.#options.workspaces.ensureReady(config.workspaceId);
    const root = await realpath(workspace.path);
    let cwd: string;
    try {
      cwd = await realpath(resolve(root, config.cwd));
    } catch {
      throw new ShiftError('INVALID_DIRECTORY', `The directory ${config.cwd} does not exist.`, 422);
    }
    if (cwd !== root && !cwd.startsWith(root + sep))
      throw new ShiftError(
        'INVALID_DIRECTORY',
        `The directory ${config.cwd} leaves the workspace.`,
        422,
      );
    return cwd;
  }
}

function commandOutcome(
  config: CommandConfig,
  result: ProcessResult,
  secrets: readonly string[],
): Outcome {
  if (result.stopped) return { kind: 'stopped' };
  const data: Record<string, Json> = {
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: redact(result.stdout.text, secrets),
    stderr: redact(result.stderr.text, secrets),
    stdoutBytes: result.stdout.bytes,
    stderrBytes: result.stderr.bytes,
    stdoutTruncated: result.stdout.truncated,
    stderrTruncated: result.stderr.truncated,
    durationMs: result.durationMs,
  };
  if (result.timedOut)
    return {
      kind: 'failed',
      error: actionError(
        'COMMAND_TIMED_OUT',
        `The command ran longer than ${config.timeoutMs} ms and was stopped.`,
        'external',
        data,
      ),
    };
  if (result.exitCode !== 0)
    return {
      kind: 'failed',
      error: actionError(
        'COMMAND_FAILED',
        result.exitCode === null
          ? `The command was killed by ${result.signal ?? 'a signal'}.`
          : `The command exited with code ${result.exitCode}.`,
        'external',
        data,
      ),
    };
  if (config.parseJson) {
    if (result.stdout.truncated)
      return {
        kind: 'failed',
        error: actionError(
          'COMMAND_OUTPUT_INVALID',
          'The output is larger than maxOutputBytes, so it cannot be read as JSON.',
          'contract',
          data,
        ),
      };
    try {
      data['json'] = JSON.parse(data['stdout'] as string) as Json;
    } catch {
      return {
        kind: 'failed',
        error: actionError('COMMAND_OUTPUT_INVALID', 'The output is not JSON.', 'contract', data),
      };
    }
  }
  return { kind: 'succeeded', data };
}

function scriptOutcome(config: ScriptConfig, result: ProcessResult): Outcome {
  if (result.stopped) return { kind: 'stopped' };
  const logs: Record<string, Json> = {
    logs: result.stderr.text,
    logsTruncated: result.stderr.truncated,
    durationMs: result.durationMs,
  };
  const failed = (code: string, message: string, category: ExecutionError['category']) =>
    ({
      kind: 'failed',
      error: actionError(code, message, category, logs),
      record: logs,
    }) as const;
  if (result.timedOut)
    return failed(
      'SCRIPT_TIMED_OUT',
      `The script ran longer than ${config.timeoutMs} ms.`,
      'external',
    );
  if (result.resultTooLarge)
    return failed(
      'SCRIPT_RESULT_TOO_LARGE',
      `The script's result is larger than ${maxScriptResultBytes} bytes.`,
      'contract',
    );
  let reply: { ok: boolean; value?: Json; error?: string };
  try {
    reply = JSON.parse(result.result ?? '') as typeof reply;
  } catch {
    return failed(
      'SCRIPT_FAILED',
      result.exitCode === null
        ? `The script was killed by ${result.signal ?? 'a signal'}.`
        : 'The script ended without a result.',
      'external',
    );
  }
  if (!reply.ok) return failed('SCRIPT_FAILED', reply.error ?? 'The script failed.', 'input');
  if (config.resultSchema !== null) {
    const problem = checkValue(config.resultSchema, reply.value, 'result');
    if (problem)
      return failed(
        'SCRIPT_RESULT_INVALID',
        `The result does not match the result schema: ${problem}`,
        'contract',
      );
  }
  return { kind: 'succeeded', data: reply.value!, record: logs };
}
