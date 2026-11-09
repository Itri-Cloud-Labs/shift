import type { ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from 'pino';
import { ShiftError } from '../../domain/errors.js';
import type { SystemdScopes } from '../containment.js';
import type { ResultHandler } from '../types.js';
import { OpenCodeClient } from './client.js';
import {
  hostEnvironment,
  hostStorageNamespace,
  namespaceEnvironment,
  namespaceId,
  namespaceLayout,
  prepareNamespace,
  type HarnessEnvironment,
  type NamespaceLayout,
} from './namespace.js';
import { startResultEndpoint, type ResultEndpoint } from './result-endpoint.js';

export interface ProviderCredential {
  integrationID: string;
  key: string;
}

export interface OpenCodeRuntimeOptions {
  stateDirectory: string;
  scopes: SystemdScopes;
  resultHandler: ResultHandler;
  logger: Logger;
  executable?: string;
  // Defaults to `host`. Credentials are provisioned only into an isolated namespace.
  environment?: HarnessEnvironment;
  credentials?: readonly ProviderCredential[];
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  // Stops the runtime after this long without use while OpenCode reports no active session. The
  // next use starts it again; conversations live in OpenCode's store and survive. Unset keeps it.
  idleStopMs?: number;
}

// The OpenCode releases this adapter was probed against (docs/opencode-capabilities.md): v2 from
// the probed 2.0.26. Another major version can change the experimental HTTP API, so it is refused.
export function supportedVersion(version: unknown): boolean {
  const match = typeof version === 'string' ? /^2\.(\d+)\.(\d+)$/.exec(version) : null;
  if (!match) return false;
  const [minor, patch] = [Number(match[1]), Number(match[2])];
  return minor > 0 || patch >= 26;
}

export interface RuntimeGeneration {
  generation: number;
  unit: string;
  pid: number;
  version: string;
  client: OpenCodeClient;
}

interface Running extends RuntimeGeneration {
  // Kept for the supervisor's own questions, which must not count as use.
  password: string;
  child: ChildProcess;
  endpoint: ResultEndpoint;
  exited: Promise<void>;
  stopping: boolean;
  ended: boolean;
}

const credentialLabel = 'shift';

// Resolves with `undefined` on timeout, and never leaves a timer holding the process open.
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  const controller = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(timeoutMs, undefined, { signal: controller.signal }).catch(() => undefined),
    ]);
  } finally {
    controller.abort();
  }
}

// Supervises the namespace's single `opencode serve` runtime. It is the only OpenCode command
// Shift runs: other subcommands start a persistent background service.
export class OpenCodeRuntime {
  readonly layout: NamespaceLayout;
  readonly environment: HarnessEnvironment;
  readonly #options: OpenCodeRuntimeOptions;
  readonly #unitPrefix: string;
  #generation = 0;
  #current: Running | null = null;
  #starting: Promise<Running> | null = null;
  #cleanup: Promise<void> = Promise.resolve();
  #closed = false;
  // The scope of a generation that has been spawned but not yet published.
  #startingUnit: string | null = null;
  readonly #lostListeners: Array<(generation: number) => void> = [];
  #lastUsed = Date.now();
  // Requests to the runtime still waiting for their answer.
  #inFlight = 0;
  readonly #activity = {
    started: () => {
      this.#inFlight++;
      this.#lastUsed = Date.now();
    },
    ended: () => {
      this.#inFlight--;
      this.#lastUsed = Date.now();
    },
  };
  #idleTimer: NodeJS.Timeout | null = null;

  constructor(options: OpenCodeRuntimeOptions) {
    this.#options = options;
    this.layout = namespaceLayout(options.stateDirectory);
    this.environment = options.environment ?? 'host';
    if (this.environment === 'host' && (options.credentials?.length ?? 0) > 0) {
      throw new ShiftError(
        'INVALID_CONFIGURATION',
        'Provider keys apply only to an isolated OpenCode environment.',
        422,
      );
    }
    this.#unitPrefix = `shift-opencode-${namespaceId(this.layout)}-`;
  }

  // The session store that harness session IDs belong to.
  get storageNamespace(): string {
    return this.environment === 'host' ? hostStorageNamespace() : this.layout.root;
  }

  get current(): RuntimeGeneration | null {
    return this.#current;
  }

  onLost(listener: (generation: number) => void): void {
    this.#lostListeners.push(listener);
  }

  async ensure(): Promise<RuntimeGeneration> {
    // After stop(), a task still finishing its cancellation must not start a new runtime.
    if (this.#closed) {
      throw new ShiftError('HARNESS_STOPPED', 'The OpenCode runtime has been stopped.', 503);
    }
    this.#lastUsed = Date.now();
    if (this.#current) return this.#current;
    this.#starting ??= this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  // Processes in the runtime scope that OpenCode started for one session's tools.
  async sessionProcesses(harnessSessionId: string): Promise<number[]> {
    const running = this.#current;
    if (!running) return [];
    const marker = `OPENCODE_SESSION_ID=${harnessSessionId}`;
    const found: number[] = [];
    for (const pid of await this.#options.scopes.members(running.unit)) {
      try {
        const environ = await readFile(`/proc/${pid}/environ`, 'utf8');
        if (environ.split('\0').includes(marker)) found.push(pid);
      } catch {
        // The process exited while being inspected.
      }
    }
    return found;
  }

  // Kills scopes of this namespace left by an earlier Shift process. Does nothing without systemd;
  // a later start reports that containment is unavailable.
  async reapStale(): Promise<void> {
    if (this.#current || this.#starting) return;
    if (await this.#options.scopes.available()) await this.#reap();
  }

  // With no current runtime, every scope of this namespace is stale: left by a lost generation
  // whose cleanup failed, or by a Shift process that died. The instance lock guarantees that no
  // other live Shift process owns the namespace. A failed kill blocks the start.
  async #reap(): Promise<void> {
    for (const unit of await this.#options.scopes.list(this.#unitPrefix)) {
      this.#options.logger.warn({ unit }, 'Killing a stale OpenCode runtime scope.');
      await this.#options.scopes.kill(unit);
    }
  }

  // Permanent: the runtime cannot be started again by this supervisor. `timeoutMs` bounds waiting
  // for a pending start and for a graceful exit; killing the scope is the fallback either way.
  async stop(timeoutMs = this.#options.stopTimeoutMs ?? 5_000): Promise<void> {
    this.#closed = true;
    if (this.#idleTimer) clearInterval(this.#idleTimer);
    const deadline = Date.now() + timeoutMs;
    if (this.#starting) {
      await withTimeout(
        this.#starting.catch(() => undefined),
        timeoutMs,
      );
      // A start still pending at the deadline is killed now; its startup then fails on the exit.
      if (this.#startingUnit) await this.#options.scopes.kill(this.#startingUnit);
    }
    const running = this.#current;
    if (running) await this.#stopGeneration(running, deadline);
    await this.#cleanup;
  }

  async #stopGeneration(running: Running, deadline: number): Promise<void> {
    running.stopping = true;
    if (this.#current === running) this.#current = null;
    running.child.kill('SIGTERM');
    await withTimeout(running.exited, Math.max(0, deadline - Date.now()));
    try {
      // Tool processes leave the server's process group, so only the scope accounts for them.
      await this.#options.scopes.kill(running.unit);
    } finally {
      await running.endpoint.close();
    }
  }

  // Stops an unused runtime, but only while OpenCode itself reports no active session: a turn
  // nobody polls, such as one whose outcome waits for the owner, keeps its tools running.
  async #stopIfIdle(): Promise<void> {
    const idleMs = this.#options.idleStopMs;
    const running = this.#current;
    if (idleMs === undefined || !running || this.#starting || this.#closed) return;
    if (this.#inFlight > 0 || Date.now() - this.#lastUsed < idleMs) return;
    const used = this.#lastUsed;
    try {
      // Asked without counting as use, so the question itself never keeps the runtime alive.
      const response = await new OpenCodeClient(running.client.url, running.password).expect(
        [200],
        'GET',
        '/api/session/active',
      );
      const active = (response.body as { data?: unknown[] } | null)?.data ?? [];
      if (active.length > 0) return;
    } catch {
      return;
    }
    // Used again while asking, or replaced meanwhile: not idle.
    if (this.#inFlight > 0 || this.#lastUsed !== used || this.#current !== running) return;
    this.#options.logger.info(
      { generation: running.generation, unit: running.unit },
      'Stopping the idle OpenCode runtime; it starts again when next needed.',
    );
    await this.#stopGeneration(running, Date.now() + (this.#options.stopTimeoutMs ?? 5_000));
  }

  async #start(): Promise<Running> {
    await this.#cleanup;
    const { scopes, logger } = this.#options;
    if (!(await scopes.available())) {
      throw new ShiftError(
        'HARNESS_CONTAINMENT_UNAVAILABLE',
        `OpenCode needs a systemd ${scopes.manager} manager for process containment.`,
        503,
      );
    }
    await this.#reap();
    const endpoint = await startResultEndpoint(this.#options.resultHandler);
    try {
      const access = { url: endpoint.url, token: endpoint.token };
      await prepareNamespace(this.layout, access, this.environment);
      // The last await before spawning: a stop() that arrived during preparation aborts here, and
      // one arriving later finds `#startingUnit`, which is set in the same synchronous step.
      if (this.#closed) {
        throw new ShiftError('HARNESS_STOPPED', 'The OpenCode runtime has been stopped.', 503);
      }
      const generation = ++this.#generation;
      const unit = `${this.#unitPrefix}${Date.now().toString(36)}-${generation}`;
      this.#startingUnit = unit;
      const child = scopes.spawn(
        unit,
        this.#options.executable ?? 'opencode',
        ['serve', '--hostname', '127.0.0.1', '--port', '0'],
        {
          cwd: this.layout.root,
          env:
            this.environment === 'host'
              ? hostEnvironment(this.layout, access)
              : namespaceEnvironment(this.layout),
        },
      );
      // A failed spawn emits `error` instead of `exit`; either ends this generation.
      const exited = new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.once('error', () => resolve());
      });
      let running: Running | undefined;
      try {
        const { url, password } = await this.#readStartup(child, exited);
        const client = new OpenCodeClient(url, password, this.#activity);
        const info = (await client.expect([200], 'GET', '/api/info')).body as {
          version?: unknown;
          pid?: unknown;
        } | null;
        // The process answering must be the one Shift started, inside its own scope, and speak
        // the API Shift was built against. Either mismatch fails before anything uses it.
        if (!supportedVersion(info?.version)) {
          throw new ShiftError(
            'HARNESS_VERSION_UNSUPPORTED',
            `OpenCode ${String(info?.version)} is not supported; Shift needs OpenCode 2.x from 2.0.26.`,
            503,
          );
        }
        if (typeof info?.pid !== 'number' || !(await scopes.members(unit)).includes(info.pid)) {
          throw new ShiftError(
            'HARNESS_IDENTITY_MISMATCH',
            'The OpenCode endpoint is not served by the runtime Shift started.',
            503,
          );
        }
        running = {
          generation,
          unit,
          pid: child.pid!,
          version: info.version as string,
          client,
          password,
          child,
          endpoint,
          exited,
          stopping: false,
          ended: false,
        };
        void exited.then(() => this.#exited(running!));
        await this.#provisionCredentials(client);
        // The runtime can die after answering its last startup request; never publish it then.
        if (running.ended) {
          throw new ShiftError(
            'HARNESS_START_FAILED',
            'The OpenCode runtime exited during startup.',
          );
        }
        if (this.#closed) {
          throw new ShiftError('HARNESS_STOPPED', 'The OpenCode runtime has been stopped.', 503);
        }
      } catch (error) {
        if (running) running.stopping = true;
        child.kill('SIGKILL');
        await scopes.kill(unit);
        throw error;
      }
      this.#current = running;
      this.#lastUsed = Date.now();
      const idleMs = this.#options.idleStopMs;
      if (idleMs !== undefined && !this.#idleTimer) {
        this.#idleTimer = setInterval(
          () => void this.#stopIfIdle().catch(() => undefined),
          Math.max(50, Math.min(idleMs / 4, 30_000)),
        );
        this.#idleTimer.unref();
      }
      logger.info({ generation, unit, version: running.version }, 'OpenCode runtime started.');
      return running;
    } catch (error) {
      await endpoint.close();
      throw error;
    } finally {
      this.#startingUnit = null;
    }
  }

  // `opencode serve` prints its address and a generated password. Shift never supplies the
  // password through the environment, because OpenCode passes its environment to tool shells.
  async #readStartup(
    child: ChildProcess,
    exited: Promise<void>,
  ): Promise<{ url: string; password: string }> {
    let output = '';
    let resolveStartup!: (value: { url: string; password: string }) => void;
    const startup = new Promise<{ url: string; password: string }>((resolve) => {
      resolveStartup = resolve;
    });
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const url = /server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
      const password = /server password (\S+)/.exec(output)?.[1];
      if (url && password) resolveStartup({ url, password });
    };
    child.stdout!.on('data', onData);
    // Keep draining output so a full pipe can never block the runtime.
    child.stderr!.resume();
    const timeoutMs = this.#options.startTimeoutMs ?? 30_000;
    const result = await withTimeout(
      Promise.race([startup, exited.then(() => 'exited' as const)]),
      timeoutMs,
    );
    child.stdout!.off('data', onData);
    child.stdout!.resume();
    output = '';
    if (result === 'exited') {
      throw new ShiftError('HARNESS_START_FAILED', 'The OpenCode runtime exited during startup.');
    }
    if (result === undefined) {
      throw new ShiftError('HARNESS_START_FAILED', 'The OpenCode runtime did not start in time.');
    }
    return result;
  }

  // Provider keys persist in the namespace; v2 ignores auth.json. OpenCode cannot change a stored
  // key, so a replaced key is added first and the outdated entries are removed afterwards.
  async #provisionCredentials(client: OpenCodeClient): Promise<void> {
    const credentials = this.#options.credentials ?? [];
    if (credentials.length === 0) return;
    const listed = await client.expect([200], 'GET', '/api/credential');
    const existing = ((listed.body as { data?: unknown[] })?.data ?? []) as Array<{
      id: string;
      integrationID?: string;
      label?: string;
      value?: { type?: string; key?: string };
    }>;
    for (const credential of credentials) {
      const owned = existing.filter(
        (entry) =>
          entry.integrationID === credential.integrationID && entry.label === credentialLabel,
      );
      const current = owned.find(
        (entry) => entry.value?.type === 'key' && entry.value.key === credential.key,
      );
      if (!current) {
        await client.expect([200], 'POST', '/api/credential', {
          body: {
            integrationID: credential.integrationID,
            label: credentialLabel,
            value: { type: 'key', key: credential.key },
            activate: true,
          },
        });
      }
      for (const outdated of owned.filter((entry) => entry !== current)) {
        await client.expect([200, 204, 404], 'DELETE', `/api/credential/${outdated.id}`);
      }
    }
  }

  #exited(running: Running): void {
    running.ended = true;
    if (running.stopping) return;
    const wasCurrent = this.#current === running;
    if (wasCurrent) this.#current = null;
    this.#options.logger.warn(
      { generation: running.generation, unit: running.unit },
      'OpenCode runtime exited unexpectedly; killing its scope.',
    );
    // A restart waits for this and then reaps any scope it failed to empty.
    this.#cleanup = this.#cleanup
      .then(() => this.#options.scopes.kill(running.unit))
      .finally(() => running.endpoint.close())
      .catch(() => {
        this.#options.logger.error(
          { unit: running.unit },
          'The lost OpenCode runtime scope could not be emptied.',
        );
      });
    // A runtime that died during startup was never handed out, so only its scope needs cleaning.
    if (wasCurrent) for (const listener of this.#lostListeners) listener(running.generation);
  }
}
