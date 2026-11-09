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
  type CommandConfig,
  type ScriptConfig,
} from './config.js';
import type { Authority, Credentials } from './credentials.js';
import { EffectConflict, RunNotActive, type EffectStore, type Operation } from './effects.js';
import { sendRequest } from './http.js';
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

  #complete(claim: Claim, _operation: Operation, data: Json): void {
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
      for (const [name, ref] of Object.entries(config.credentialHeaders)) {
        const value = `${ref.prefix}${secret(ref.credential)}`;
        if (/[\r\n\0]/.test(value))
          throw new ShiftError(
            'INVALID_ARGUMENT',
            `Credential header ${name} has a line break.`,
            422,
          );
        headers[name] = value;
      }
      return sendRequest(config, headers, signal, () => submit(), this.#options.fetch);
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
