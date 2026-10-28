import { createParser, type ParseError } from 'eventsource-parser';
import type {
  Event,
  Interaction,
  Project,
  RunSummary,
  Snapshot,
  WorkflowSummary,
} from '../protocol/generated/types.js';
import {
  validateCommandReceiptResponse,
  validateEvent,
  validateEventPage,
  validateInteractionResponse,
  validateProjectList,
  validateProtocolError,
  validateRunResponse,
  validateSnapshot,
  validateWorkflowResponse,
} from '../protocol/generated/validators.js';
import type { AuthenticatedTarget, ConnectionRuntime, ConnectionState } from './connection.js';
import { TransportFailure, type Exchange, type ServerHttp } from './http.js';
import {
  cursorSequence,
  sameKey,
  type Projection,
  type ProjectionKey,
  type SavedCommand,
  type SyncStore,
} from './projection.js';

// The sync runtime (client specification 4.3). One supervisor follows the active connection:
// it confirms uncertain commands by their receipts, takes a snapshot or replays from the saved
// cursor, then applies the event stream. Events only name what changed, so each batch refetches
// the affected resources and saves them with the batch's cursor. Data is live only once all of
// that has finished; any failure drops back to the saved cursor and reconnects with backoff.

export type SyncStatus = 'stopped' | 'syncing' | 'live' | 'reconnecting';
export type SyncProblem =
  | 'UNREACHABLE'
  | 'INVALID_RESPONSE'
  | 'KEEPALIVE_TIMEOUT'
  | 'RESYNC_REQUIRED'
  | 'DEVICE_UNAUTHORIZED';

export interface SyncState {
  status: SyncStatus;
  profileId: string | null;
  problem: SyncProblem | null;
  // When the cached data last matched the server.
  updatedAt: number | null;
}

// `sending` and `unknown` are acknowledgement_unknown to the user: the command may or may not
// have been applied, and only its receipt can tell.
export type CommandState = 'sending' | 'unknown' | 'accepted' | 'rejected' | 'not_applied';

export interface CommandView {
  commandId: string;
  method: 'POST' | 'PUT';
  path: string;
  state: CommandState;
  // The error code of a rejected command.
  code: string | null;
  createdAt: number;
  // Whether the identical command can be sent again: its body is still in memory.
  resendable: boolean;
}

export interface CommandRequest {
  method: 'POST' | 'PUT';
  path: string;
  body: Record<string, unknown>;
}

export type Resource =
  { kind: 'projects' } | { kind: 'workflow' | 'run' | 'interaction'; id: string };

export class SyncFailure extends Error {
  constructor(readonly code: 'NOT_LIVE' | 'UNKNOWN_COMMAND') {
    super(
      code === 'NOT_LIVE' ? 'The server is not connected and synchronized.' : 'No such command.',
    );
  }
}

type EndReason = 'transport' | 'invalid' | 'resync' | 'auth' | 'keepalive' | 'stopped';
class SessionEnd extends Error {
  constructor(readonly reason: EndReason) {
    super(reason);
  }
}

export interface Timers {
  set(callback: () => void, ms: number): () => void;
}
const realTimers: Timers = {
  set(callback, ms) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};

export interface SyncOptions {
  connection: ConnectionRuntime;
  http: ServerHttp;
  store: SyncStore;
  now?: () => number;
  random?: () => number;
  randomId?: () => string;
  timers?: Timers;
  // The server sends a keepalive every 15 s; a quiet stream after this long is dead.
  keepaliveTimeoutMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  // The snapshot holds the 100 newest runs; the cache keeps as many.
  maxRuns?: number;
}

interface Command extends SavedCommand {
  live: 'sending' | null;
  body: Record<string, unknown> | null;
  response: unknown;
}

interface Fetched {
  resource: Resource;
  ticket: number;
  value: Project[] | WorkflowSummary | RunSummary | Interaction | null;
}

const maxListeners = 64;
const maxSettledInteractions = 100;
const maxCommands = 100;
const pageLimit = 500;
const fetchConcurrency = 8;
// Every event type the server emits. Any other type may change anything, so it resyncs.
const knownEvents = new Set([
  'project.created',
  'workflow.created',
  'workflow.draft_saved',
  'workflow.published',
  'run.created',
  'run.completed',
  'run.failed',
  'run.needs_human',
  'run.cancel_requested',
  'run.cancelled',
  'run.control',
  'run.active_time_charged',
  'execution.scheduled',
  'execution.started',
  'execution.completed',
  'execution.failed',
  'execution.waiting',
  'execution.retrying',
  'execution.retry_requested',
  'execution.retry_scheduled',
  'attempt.recovering',
  'invocation.created',
  'invocation.state',
  'result.submitted',
  'session.bound',
  'interaction.requested',
  'interaction.responded',
  'interaction.expired',
  'device.paired',
  'device.revoked',
  'pairing.issued',
  'pairing.withdrawn',
]);

function key(resource: Resource): string {
  return resource.kind === 'projects' ? 'projects' : `${resource.kind}:${resource.id}`;
}

function failureReason(error: unknown): EndReason {
  if (error instanceof SessionEnd) return error.reason;
  return error instanceof TransportFailure && error.kind === 'unreachable'
    ? 'transport'
    : 'invalid';
}

const problems: Record<EndReason, SyncProblem | null> = {
  transport: 'UNREACHABLE',
  invalid: 'INVALID_RESPONSE',
  resync: 'RESYNC_REQUIRED',
  auth: 'DEVICE_UNAUTHORIZED',
  keepalive: 'KEEPALIVE_TIMEOUT',
  stopped: null,
};

export class SyncRuntime {
  readonly #options: Required<Omit<SyncOptions, 'connection' | 'http' | 'store'>>;
  readonly #connection: ConnectionRuntime;
  readonly #http: ServerHttp;
  readonly #store: SyncStore;
  readonly #listeners = new Set<() => void>();
  #state: SyncState = { status: 'stopped', profileId: null, problem: null, updatedAt: null };
  #loop: { profileId: string; controller: AbortController } | undefined;
  #projection: Projection | null = null;
  #commands = new Map<string, Command>();
  // The profile the projection and commands above belong to.
  #cacheProfile: string | null = null;
  // The live session's target, for refreshes and commands.
  #target: AuthenticatedTarget | undefined;
  // Every fetch takes a ticket; a resource only accepts an answer newer than the one it holds,
  // so a slow, older query never overwrites a newer one. A snapshot invalidates older tickets.
  #ticket = 0;
  #floor = 0;
  #tickets = new Map<string, number>();
  #saving: Promise<void> = Promise.resolve();
  #unsubscribe: (() => void) | undefined;

  constructor(options: SyncOptions) {
    this.#connection = options.connection;
    this.#http = options.http;
    this.#store = options.store;
    this.#options = {
      now: options.now ?? (() => Date.now()),
      random: options.random ?? Math.random,
      randomId: options.randomId ?? (() => crypto.randomUUID()),
      timers: options.timers ?? realTimers,
      keepaliveTimeoutMs: options.keepaliveTimeoutMs ?? 45_000,
      initialBackoffMs: options.initialBackoffMs ?? 500,
      maxBackoffMs: options.maxBackoffMs ?? 30_000,
      maxRuns: options.maxRuns ?? 100,
    };
  }

  // Follows the connection from now on.
  start(): void {
    this.#unsubscribe ??= this.#connection.subscribe((state) => this.#follow(state));
    this.#follow(this.#connection.state);
  }

  // Stops following and closes the stream. Nothing on the server changes.
  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#stopLoop();
    this.#set({ status: 'stopped', problem: null });
  }

  get state(): SyncState {
    return { ...this.#state };
  }

  // The cached state. It is shown while offline, with `state.updatedAt`.
  get projection(): Projection | null {
    return this.#projection;
  }

  subscribe(listener: () => void): () => void {
    if (this.#listeners.size >= maxListeners) throw new Error('Too many sync subscriptions');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  #set(state: Partial<SyncState>): void {
    this.#state = { ...this.#state, ...state };
    this.#notify();
  }

  #follow(state: ConnectionState): void {
    const following =
      state.profileId !== null &&
      (state.status === 'online' || state.status === 'offline' || state.status === 'connecting');
    if (following) {
      this.#ensureLoop(state.profileId!);
      return;
    }
    const profileId = this.#loop?.profileId;
    this.#stopLoop();
    // A revoked device keeps nothing from that server.
    if (state.status === 'revoked' && profileId) void this.forget(profileId);
    this.#set({ status: 'stopped' });
  }

  #ensureLoop(profileId: string): void {
    if (this.#loop?.profileId === profileId) return;
    this.#stopLoop();
    const controller = new AbortController();
    this.#loop = { profileId, controller };
    this.#set({ status: 'syncing', profileId, problem: null });
    void this.#run(profileId, controller.signal).finally(() => {
      if (this.#loop?.controller === controller) this.#loop = undefined;
    });
  }

  #stopLoop(): void {
    this.#loop?.controller.abort();
    this.#loop = undefined;
    this.#target = undefined;
  }

  // Deletes the cached state and saved commands of a profile, for example after clearing it.
  async forget(profileId: string): Promise<void> {
    if (this.#loop?.profileId === profileId) this.#stopLoop();
    if (this.#cacheProfile === profileId) {
      this.#projection = null;
      this.#commands.clear();
      this.#cacheProfile = null;
    }
    if (this.#state.profileId === profileId)
      this.#set({ status: 'stopped', profileId: null, problem: null, updatedAt: null });
    await this.#queueSave(() => this.#store.remove(profileId));
  }

  #delay(failures: number): number {
    const { initialBackoffMs, maxBackoffMs, random } = this.#options;
    const ceiling = Math.min(maxBackoffMs, initialBackoffMs * 2 ** Math.min(failures - 1, 30));
    // Half fixed, half random, so many clients do not reconnect together.
    return Math.round(ceiling / 2 + (random() * ceiling) / 2);
  }

  #sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const cancel = this.#options.timers.set(done, ms);
      signal.addEventListener('abort', done, { once: true });
      function done() {
        cancel();
        signal.removeEventListener('abort', done);
        resolve();
      }
    });
  }

  #nextConnectionState(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const stop = this.#connection.subscribe(done);
      signal.addEventListener('abort', done, { once: true });
      function done() {
        stop();
        signal.removeEventListener('abort', done);
        resolve();
      }
    });
  }

  async #run(profileId: string, signal: AbortSignal): Promise<void> {
    await this.#loadCache(profileId);
    let failures = 0;
    let resyncs = 0;
    let recheck = false;
    while (!signal.aborted) {
      const state = this.#connection.state;
      if (state.profileId !== profileId) return;
      if (state.status === 'connecting') {
        await this.#nextConnectionState(signal);
        continue;
      }
      if (recheck || state.status === 'offline') {
        // Identity, epoch and revocation are checked again before every reconnect.
        if (failures > 0) {
          this.#set({ status: 'reconnecting' });
          await this.#sleep(this.#delay(failures), signal);
          if (signal.aborted) return;
        }
        const next = await this.#connection.connect(profileId);
        if (signal.aborted) return;
        if (next.status === 'offline') {
          failures++;
          recheck = true;
          this.#set({ status: 'reconnecting', problem: 'UNREACHABLE' });
          continue;
        }
        // Revoked, incompatible or gone: the connection listener stops this loop.
        if (next.status !== 'online') return;
        recheck = false;
      }
      const target = await this.#connection.authenticated();
      if (signal.aborted) return;
      if (!target || target.profileId !== profileId) {
        failures++;
        recheck = true;
        continue;
      }
      try {
        await this.#session(target, signal, () => {
          failures = 0;
          resyncs = 0;
        });
      } catch (error) {
        if (signal.aborted) return;
        const reason = failureReason(error);
        this.#target = undefined;
        this.#set({ status: 'reconnecting', problem: problems[reason] });
        recheck = true;
        // A resync starts over at once, unless it keeps happening.
        if (reason !== 'resync' || ++resyncs > 2) failures++;
      }
    }
  }

  // Shows the saved state of a profile while it connects.
  async #loadCache(profileId: string): Promise<void> {
    if (this.#cacheProfile === profileId) return;
    this.#projection = null;
    this.#commands = new Map();
    this.#cacheProfile = profileId;
    this.#floor = ++this.#ticket;
    this.#tickets.clear();
    const record = await this.#store.load(profileId);
    if (this.#cacheProfile !== profileId) return;
    this.#projection = record?.projection ?? null;
    this.#commands = new Map(
      (record?.commands ?? []).map((command) => [
        command.commandId,
        { ...command, live: null, body: null, response: null },
      ]),
    );
    this.#set({ updatedAt: this.#projection?.updatedAt ?? null });
  }

  async #session(
    target: AuthenticatedTarget,
    signal: AbortSignal,
    connected: () => void,
  ): Promise<void> {
    const session = AbortSignal.any([signal, target.signal]);
    const projectionKey: ProjectionKey = {
      serverId: target.serverId,
      deviceId: target.deviceId,
      epoch: target.eventEpoch,
    };
    this.#set({ status: 'syncing' });
    await this.#reconcile(target, session);
    if (!this.#projection || !sameKey(this.#projection.key, projectionKey)) {
      await this.#snapshot(target, projectionKey, session);
    } else {
      await this.#catchUp(target, session);
    }
    await this.#tail(target, session, connected);
  }

  // Asks the server about every command whose answer was lost. Nothing is sent again.
  async #reconcile(target: AuthenticatedTarget, signal: AbortSignal): Promise<void> {
    for (const command of this.#commands.values()) {
      if (command.state !== 'unknown' || command.live) continue;
      await this.#check(target, command, signal);
      await this.#saveCommands();
      this.#notify();
    }
  }

  // Settles an uncertain command from its receipt.
  async #check(
    target: AuthenticatedTarget,
    command: Command,
    signal: AbortSignal = target.signal,
  ): Promise<void> {
    const exchange = await this.#request(
      target,
      'GET',
      `/api/v0/commands/${encodeURIComponent(command.commandId)}`,
      signal,
    );
    if (exchange.status === 200 && validateCommandReceiptResponse(exchange.body)) {
      command.state = 'accepted';
      command.response = exchange.body.receipt.body;
    } else if (exchange.status === 404) {
      // A failed command stores nothing, and one that never arrived left nothing either.
      command.state = 'not_applied';
    } else {
      throw new SessionEnd('invalid');
    }
  }

  async #snapshot(
    target: AuthenticatedTarget,
    projectionKey: ProjectionKey,
    signal: AbortSignal,
  ): Promise<void> {
    const ticket = ++this.#ticket;
    const exchange = await this.#request(target, 'GET', '/api/v0/snapshot', signal);
    if (exchange.status !== 200 || !validateSnapshot(exchange.body))
      throw new SessionEnd('invalid');
    const snapshot: Snapshot = exchange.body;
    // The database was replaced after the identity check; check again.
    if (!snapshot.cursor.startsWith(`${projectionKey.epoch}:`)) throw new SessionEnd('resync');
    this.#floor = ticket;
    this.#tickets.clear();
    await this.#commit(signal, {
      key: projectionKey,
      cursor: snapshot.cursor,
      projects: snapshot.projects,
      workflows: snapshot.workflows,
      runs: this.#trimRuns(snapshot.runs, snapshot.interactions),
      interactions: snapshot.interactions,
      updatedAt: this.#options.now(),
    });
  }

  // Replays what happened since the saved cursor, page by page, before following live.
  async #catchUp(target: AuthenticatedTarget, signal: AbortSignal): Promise<void> {
    for (;;) {
      const cursor = this.#projection!.cursor;
      const exchange = await this.#request(
        target,
        'GET',
        `/api/v0/events?after=${encodeURIComponent(cursor)}&limit=${pageLimit}`,
        signal,
      );
      if (exchange.status === 409) await this.#resync(exchange.body, signal);
      if (exchange.status !== 200 || !validateEventPage(exchange.body))
        throw new SessionEnd('invalid');
      await this.#apply(target, exchange.body.events, signal);
      if (exchange.body.next === null) return;
    }
  }

  // A RESYNC_REQUIRED answer drops the projection, so the next session takes a new snapshot.
  async #resync(body: unknown, signal: AbortSignal): Promise<never> {
    if (validateProtocolError(body) && body.code === 'RESYNC_REQUIRED') {
      if (!signal.aborted) await this.#dropProjection();
      throw new SessionEnd('resync');
    }
    throw new SessionEnd('invalid');
  }

  async #dropProjection(): Promise<void> {
    this.#projection = null;
    await this.#saveRecord();
  }

  async #tail(
    target: AuthenticatedTarget,
    signal: AbortSignal,
    connected: () => void,
  ): Promise<void> {
    const stream = new AbortController();
    const streamSignal = AbortSignal.any([signal, stream.signal]);
    let opening;
    try {
      opening = await this.#http.stream(target.url, '/api/v0/events/stream', {
        bearer: target.bearer,
        lastEventId: this.#projection!.cursor,
        signal: streamSignal,
      });
    } catch (error) {
      throw new SessionEnd(signal.aborted ? 'stopped' : failureReason(error));
    }
    if (opening.status === 401) throw new SessionEnd('auth');
    if (opening.status === 409)
      await this.#resync('error' in opening ? opening.error : null, signal);
    if (opening.status !== 200 || !('body' in opening)) throw new SessionEnd('invalid');
    const reader = opening.body.getReader();
    const decoder = new TextDecoder();
    this.#target = target;
    this.#set({ status: 'live', problem: null, updatedAt: this.#options.now() });
    // Backoff resets only once the stream carries traffic, so a stream that opens and drops at
    // once keeps backing off.
    let healthy = false;
    let pending: string[] = [];
    let parseError: ParseError | undefined;
    const parser = createParser({
      // An event is far below this; anything larger is a broken stream.
      maxBufferSize: 4 * 1024 * 1024,
      onEvent(message) {
        if (message.event === 'shift') pending.push(message.data);
      },
      onError(error) {
        parseError = error;
      },
    });
    let quiet = false;
    try {
      for (;;) {
        // Any traffic, keepalive comments included, proves the stream alive.
        const cancel = this.#options.timers.set(() => {
          quiet = true;
          stream.abort();
        }, this.#options.keepaliveTimeoutMs);
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          throw new SessionEnd(quiet ? 'keepalive' : signal.aborted ? 'stopped' : 'transport');
        } finally {
          cancel();
        }
        if (chunk.done) throw new SessionEnd('transport');
        if (!healthy) {
          healthy = true;
          connected();
        }
        try {
          parser.feed(decoder.decode(chunk.value, { stream: true }));
        } catch {
          throw new SessionEnd('invalid');
        }
        if (parseError) throw new SessionEnd('invalid');
        if (pending.length === 0) continue;
        const batch = pending;
        pending = [];
        const events = batch.map((data) => {
          try {
            return JSON.parse(data) as unknown;
          } catch {
            throw new SessionEnd('invalid');
          }
        });
        await this.#apply(target, events, signal);
        this.#set({ updatedAt: this.#projection?.updatedAt ?? null });
      }
    } finally {
      this.#target = undefined;
      stream.abort();
      void reader.cancel().catch(() => undefined);
    }
  }

  // Applies a batch of events: refetches what they name, then saves the new state with the
  // batch's last cursor. Duplicates and events at or before the cursor are skipped.
  async #apply(target: AuthenticatedTarget, values: unknown[], signal: AbortSignal): Promise<void> {
    const projection = this.#projection;
    if (!projection) throw new SessionEnd('resync');
    const applied = cursorSequence(projection.cursor);
    const events = new Map<number, Event>();
    for (const value of values) {
      if (!validateEvent(value)) throw new SessionEnd('invalid');
      if (value.epoch !== projection.key.epoch) {
        await this.#dropProjection();
        throw new SessionEnd('resync');
      }
      if (value.sequence > applied) events.set(value.sequence, value);
    }
    if (events.size === 0) return;
    const ordered = [...events.values()].sort((a, b) => a.sequence - b.sequence);
    const resources = new Map<string, Resource>();
    const add = (resource: Resource) => resources.set(key(resource), resource);
    for (const event of ordered) {
      // An event this client does not understand may change anything: start over.
      if (event.schemaVersion !== 1 || !knownEvents.has(event.type)) {
        await this.#dropProjection();
        throw new SessionEnd('resync');
      }
      const payload = event.payload as Record<string, unknown>;
      const id = (field: string) => {
        const value = payload[field];
        if (typeof value === 'string') return value;
        throw new SessionEnd('invalid');
      };
      const family = event.type.slice(0, event.type.indexOf('.'));
      if (family === 'device' || family === 'pairing') continue;
      if (family === 'project') add({ kind: 'projects' });
      else if (family === 'workflow') add({ kind: 'workflow', id: id('workflowId') });
      else if (family === 'interaction') add({ kind: 'interaction', id: id('interactionId') });
      if (event.runId) {
        add({ kind: 'run', id: event.runId });
        // Cancelling a run retires its requests without an interaction event.
        for (const interaction of projection.interactions)
          if (interaction.runId === event.runId && interaction.state === 'PENDING')
            add({ kind: 'interaction', id: interaction.id });
      }
    }
    const fetched = await this.#fetchAll(target, [...resources.values()], signal);
    const last = ordered[ordered.length - 1]!;
    await this.#commit(signal, this.#merge(this.#projection!, fetched, last.cursor));
  }

  async #fetchAll(
    target: AuthenticatedTarget,
    resources: Resource[],
    signal: AbortSignal,
  ): Promise<Fetched[]> {
    const results: Fetched[] = [];
    let next = 0;
    const worker = async () => {
      while (next < resources.length) {
        const resource = resources[next++]!;
        results.push(await this.#fetch(target, resource, signal));
      }
    };
    await Promise.all(Array.from({ length: Math.min(fetchConcurrency, resources.length) }, worker));
    return results;
  }

  async #fetch(
    target: AuthenticatedTarget,
    resource: Resource,
    signal: AbortSignal,
  ): Promise<Fetched> {
    const ticket = ++this.#ticket;
    if (resource.kind === 'projects') {
      const exchange = await this.#request(target, 'GET', '/api/v0/projects', signal);
      if (exchange.status !== 200 || !validateProjectList(exchange.body))
        throw new SessionEnd('invalid');
      return { resource, ticket, value: exchange.body.projects };
    }
    const path = `/api/v0/${resource.kind}s/${encodeURIComponent(resource.id)}`;
    const exchange = await this.#request(target, 'GET', path, signal);
    if (exchange.status === 404) return { resource, ticket, value: null };
    if (exchange.status === 200) {
      const body = exchange.body;
      if (resource.kind === 'workflow' && validateWorkflowResponse(body)) {
        const { id, projectId, name, activeVersionId } = body.workflow;
        return { resource, ticket, value: { id, projectId, name, activeVersionId } };
      }
      if (resource.kind === 'run' && validateRunResponse(body)) {
        const { id, state, workflowId, createdAt, finishedAt } = body.run;
        return { resource, ticket, value: { id, state, workflowId, createdAt, finishedAt } };
      }
      if (resource.kind === 'interaction' && validateInteractionResponse(body))
        return { resource, ticket, value: body.interaction };
    }
    throw new SessionEnd('invalid');
  }

  // Folds fetched resources into a projection. A fetch older than the one a resource already
  // reflects is ignored.
  #merge(base: Projection, fetched: Fetched[], cursor: string): Projection {
    const projection: Projection = {
      ...base,
      cursor,
      projects: [...base.projects],
      workflows: [...base.workflows],
      runs: [...base.runs],
      interactions: [...base.interactions],
      updatedAt: this.#options.now(),
    };
    const upsert = <T extends { id: string }>(list: T[], id: string, value: T | null) => {
      const index = list.findIndex((item) => item.id === id);
      if (value === null) {
        if (index >= 0) list.splice(index, 1);
      } else if (index >= 0) list[index] = value;
      else list.push(value);
    };
    for (const { resource, ticket, value } of fetched) {
      const name = key(resource);
      if (ticket <= this.#floor || ticket <= (this.#tickets.get(name) ?? 0)) continue;
      this.#tickets.set(name, ticket);
      if (resource.kind === 'projects') projection.projects = value as Project[];
      else if (resource.kind === 'workflow')
        upsert(projection.workflows, resource.id, value as WorkflowSummary | null);
      else if (resource.kind === 'run')
        upsert(projection.runs, resource.id, value as RunSummary | null);
      else upsert(projection.interactions, resource.id, value as Interaction | null);
    }
    const settled = projection.interactions
      .filter((interaction) => interaction.state !== 'PENDING')
      .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
      .slice(maxSettledInteractions);
    projection.interactions = projection.interactions.filter((item) => !settled.includes(item));
    projection.runs = this.#trimRuns(projection.runs, projection.interactions);
    return projection;
  }

  // The newest runs, and any run a pending request belongs to.
  #trimRuns(runs: RunSummary[], interactions: Interaction[]): RunSummary[] {
    const needed = new Set(
      interactions.filter((item) => item.state === 'PENDING').map((item) => item.runId),
    );
    const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);
    return sorted.filter((run, index) => index < this.#options.maxRuns || needed.has(run.id));
  }

  // Makes a projection current and durable. The cursor is saved with the state it describes.
  async #commit(signal: AbortSignal, projection: Projection): Promise<void> {
    if (signal.aborted) throw new SessionEnd('stopped');
    this.#projection = projection;
    await this.#saveRecord();
    this.#notify();
  }

  // Refetches one resource now, for example when a view opens. A slow answer cannot overwrite
  // a newer one. Returns false when not live or when the fetch failed.
  async refresh(resource: Resource): Promise<boolean> {
    const target = this.#target;
    if (!target || this.#state.status !== 'live') return false;
    let fetched: Fetched;
    try {
      fetched = await this.#fetch(target, resource, target.signal);
    } catch {
      return false;
    }
    if (this.#target !== target || !this.#projection) return false;
    try {
      await this.#commit(
        target.signal,
        this.#merge(this.#projection, [fetched], this.#projection.cursor),
      );
    } catch {
      return false;
    }
    return true;
  }

  // Sends a command once, with a new command ID. If its answer is lost it becomes `unknown`
  // until its receipt is checked; it is never resent automatically.
  async send(request: CommandRequest): Promise<CommandView> {
    const target = this.#target;
    if (!target || this.#state.status !== 'live') throw new SyncFailure('NOT_LIVE');
    const command: Command = {
      commandId: this.#options.randomId(),
      method: request.method,
      path: request.path,
      // Saved as unknown: if the app stops before the answer, only the receipt can tell.
      state: 'unknown',
      code: null,
      createdAt: this.#options.now(),
      live: 'sending',
      body: structuredClone(request.body),
      response: null,
    };
    this.#commands.set(command.commandId, command);
    for (const old of [...this.#commands.values()].slice(0, -maxCommands))
      if (old.state !== 'unknown') this.#commands.delete(old.commandId);
    await this.#saveCommands();
    return this.#deliver(target, command);
  }

  // Sends an uncertain or unapplied command again: the same ID and body, so the server applies
  // it at most once.
  async resend(commandId: string): Promise<CommandView> {
    const command = this.#commands.get(commandId);
    if (!command || !command.body || command.live) throw new SyncFailure('UNKNOWN_COMMAND');
    if (command.state !== 'unknown' && command.state !== 'not_applied')
      throw new SyncFailure('UNKNOWN_COMMAND');
    const target = this.#target;
    if (!target || this.#state.status !== 'live') throw new SyncFailure('NOT_LIVE');
    command.live = 'sending';
    command.state = 'unknown';
    this.#notify();
    return this.#deliver(target, command);
  }

  // Forgets a settled command.
  async dismiss(commandId: string): Promise<void> {
    const command = this.#commands.get(commandId);
    if (!command || command.live || command.state === 'unknown') return;
    this.#commands.delete(commandId);
    await this.#saveCommands();
    this.#notify();
  }

  commands(): CommandView[] {
    return [...this.#commands.values()].map((command) => this.#view(command));
  }

  // The stored answer of an accepted command, while this session still holds it.
  response(commandId: string): unknown {
    return this.#commands.get(commandId)?.response ?? null;
  }

  #view(command: Command): CommandView {
    return {
      commandId: command.commandId,
      method: command.method,
      path: command.path,
      state: command.live ?? command.state,
      code: command.code,
      createdAt: command.createdAt,
      resendable:
        command.body !== null &&
        command.live === null &&
        (command.state === 'unknown' || command.state === 'not_applied'),
    };
  }

  async #deliver(target: AuthenticatedTarget, command: Command): Promise<CommandView> {
    let exchange: Exchange | undefined;
    try {
      exchange = await this.#http.request(target.url, command.method, command.path, {
        bearer: target.bearer,
        body: { ...command.body, commandId: command.commandId },
        signal: target.signal,
      });
    } catch {
      // Lost or unreadable: the server may have applied it.
      exchange = undefined;
    }
    command.live = null;
    if (!exchange) {
      command.state = 'unknown';
      // If the server is still reachable its receipt settles this at once; otherwise the
      // next reconnect asks.
      await this.#check(target, command).catch(() => undefined);
    } else if (exchange.status >= 200 && exchange.status < 300) {
      command.state = 'accepted';
      command.response = exchange.body;
    } else if (validateProtocolError(exchange.body)) {
      // Failed commands store nothing on the server; the same ID can be retried later.
      command.state = 'rejected';
      command.code = exchange.body.code;
    } else {
      command.state = 'unknown';
    }
    await this.#saveCommands();
    this.#notify();
    return this.#view(command);
  }

  async #request(
    target: AuthenticatedTarget,
    method: 'GET',
    path: string,
    signal: AbortSignal,
  ): Promise<Exchange> {
    let exchange: Exchange;
    try {
      exchange = await this.#http.request(target.url, method, path, {
        bearer: target.bearer,
        signal,
      });
    } catch (error) {
      throw new SessionEnd(signal.aborted ? 'stopped' : failureReason(error));
    }
    if (signal.aborted) throw new SessionEnd('stopped');
    if (exchange.status === 401) throw new SessionEnd('auth');
    return exchange;
  }

  #queueSave(write: () => Promise<void>): Promise<void> {
    // Writes run in order, so an older state never lands after a newer one.
    const next = this.#saving.then(write, write);
    this.#saving = next.catch(() => undefined);
    return next;
  }

  #saveRecord(): Promise<void> {
    const profileId = this.#cacheProfile;
    if (!profileId) return Promise.resolve();
    return this.#queueSave(() =>
      this.#store.save(profileId, {
        projection: this.#projection,
        commands: [...this.#commands.values()].map(
          ({ commandId, method, path, state, code, createdAt }) => ({
            commandId,
            method,
            path,
            state,
            code,
            createdAt,
          }),
        ),
      }),
    );
  }

  #saveCommands(): Promise<void> {
    return this.#saveRecord();
  }
}
