import {
  withinLimit,
  RESPONSE_LIMIT,
  type FoundationQuery,
  type Overview,
  type ResourceKind,
  type ShellState,
} from '../shared/contracts.js';
import { createShell } from './fixtures.js';
import {
  validateDeviceList,
  validateRunResponse,
  validateServerHealth,
  validateServerInfo,
  validateWorkflowResponse,
  validateWorkflowVersionResponse,
} from '../protocol/generated/validators.js';
import type { Interaction, ServerInfo, ServerHealth } from '../protocol/generated/types.js';
import { supportedProtocol, type ConnectionRuntime } from './connection.js';
import { TransportFailure, type ServerHttp } from './http.js';
import { MemorySyncStore, type SyncStore } from './projection.js';
import { MemoryPreferenceStore, PreferenceRuntime, type PreferenceStore } from './preferences.js';
import { SyncFailure, SyncRuntime, type CommandView } from './sync.js';

export class ClientFailure extends Error {
  constructor(readonly code: 'DISCONNECTED' | 'INVALID_RESPONSE' | 'NOT_FOUND') {
    super(
      code === 'DISCONNECTED'
        ? 'Connect to a server before querying it.'
        : code === 'NOT_FOUND'
          ? 'The resource was not found.'
          : 'The server response is invalid.',
    );
  }
}

export interface ResourceRead {
  value: unknown;
  stale: boolean;
  fetchedAt: number;
}

const validators: Record<ResourceKind, (value: unknown) => boolean> = {
  workflow: validateWorkflowResponse,
  version: validateWorkflowVersionResponse,
  run: validateRunResponse,
};

// The last copy of each resource read, shown read-only while the connection is not live.
const cacheLimit = 50;
export function validFoundationResponse(operation: FoundationQuery, value: unknown): boolean {
  if (!withinLimit(value, RESPONSE_LIMIT)) return false;
  if (operation === 'info') return validateServerInfo(value);
  return (operation === 'health' || operation === 'ready') && validateServerHealth(value);
}

// The shell and the server status queries. Queries go to the active connection's server with its
// device credential; an answer from another server or a replaced connection is refused.
export class ClientCore {
  #samples: boolean;
  readonly sync: SyncRuntime;
  readonly preferences: PreferenceRuntime;
  constructor(
    readonly connection: ConnectionRuntime,
    private readonly http: ServerHttp,
    samples = false,
    store: SyncStore = new MemorySyncStore(),
    preferences: PreferenceStore = new MemoryPreferenceStore(),
  ) {
    this.#samples = samples;
    this.sync = new SyncRuntime({ connection, http, store });
    this.preferences = new PreferenceRuntime(preferences);
  }
  readonly #cache = new Map<string, ResourceRead>();

  // The synchronized summaries the shell navigates by, live or cached.
  overview(): Overview {
    const projection = this.sync.projection;
    if (!projection) return { projects: [], workflows: [], runs: [], attention: 0 };
    const pending = projection.interactions.filter((item) => item.state === 'PENDING').length;
    const stuck = projection.runs.filter((run) => run.state === 'NEEDS_HUMAN').length;
    return {
      projects: projection.projects.map(({ id, name }) => ({ id, name })),
      workflows: projection.workflows,
      runs: projection.runs,
      attention: pending + stuck,
    };
  }

  // Pending human requests, and settled ones seen since the snapshot, live or cached. The
  // attention inbox is this projection, never local notification state.
  interactions(): Interaction[] {
    return this.sync.projection?.interactions ?? [];
  }

  // Reads a workflow, version or run from the live server, or its last copy while not live.
  async resource(kind: ResourceKind, path: string): Promise<ResourceRead> {
    const key = `${this.connection.state.profileId}:${path}`;
    let exchange;
    try {
      exchange = await this.sync.query(path);
    } catch (error) {
      const cached = this.#cache.get(key);
      if (cached) return { ...cached, stale: true };
      throw new ClientFailure(
        error instanceof TransportFailure && error.kind === 'invalid'
          ? 'INVALID_RESPONSE'
          : 'DISCONNECTED',
      );
    }
    if (exchange.status === 404) throw new ClientFailure('NOT_FOUND');
    if (exchange.status !== 200 || !validators[kind](exchange.body))
      throw new ClientFailure('INVALID_RESPONSE');
    const read = { value: exchange.body, stale: false, fetchedAt: Date.now() };
    this.#cache.delete(key);
    this.#cache.set(key, read);
    for (const old of [...this.#cache.keys()].slice(0, -cacheLimit)) this.#cache.delete(old);
    return read;
  }

  // The paired devices, always from the live server: they are not part of the projection.
  async devices(): Promise<unknown> {
    let exchange;
    try {
      exchange = await this.sync.query('/api/v0/devices');
    } catch (error) {
      throw new ClientFailure(
        error instanceof TransportFailure && error.kind === 'invalid'
          ? 'INVALID_RESPONSE'
          : 'DISCONNECTED',
      );
    }
    if (exchange.status !== 200 || !validateDeviceList(exchange.body))
      throw new ClientFailure('INVALID_RESPONSE');
    return exchange.body;
  }

  // Sends a command through the sync runtime, which confirms it if its answer is lost.
  async command(
    method: 'POST' | 'PUT',
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ command: CommandView; response: unknown }> {
    try {
      const command = await this.sync.send({ method, path, body });
      return { command, response: this.sync.response(command.commandId) };
    } catch (error) {
      if (error instanceof SyncFailure) throw new ClientFailure('DISCONNECTED');
      throw error;
    }
  }

  shell(): ShellState {
    return createShell(this.#samples);
  }
  setSamples(enabled: boolean): ShellState {
    this.#samples = enabled;
    return this.shell();
  }
  async query(operation: FoundationQuery): Promise<ServerInfo | ServerHealth> {
    const target = await this.connection.authenticated();
    const profileId = this.connection.state.profileId;
    if (!target) throw new ClientFailure('DISCONNECTED');
    let body: unknown;
    try {
      ({ body } = await this.http.request(target.url, 'GET', `/api/v0/${operation}`, {
        bearer: target.bearer,
        signal: target.signal,
      }));
    } catch (error) {
      throw new ClientFailure(
        error instanceof TransportFailure && error.kind === 'invalid'
          ? 'INVALID_RESPONSE'
          : 'DISCONNECTED',
      );
    }
    if (target.signal.aborted || this.connection.state.profileId !== profileId)
      throw new ClientFailure('DISCONNECTED');
    if (!validFoundationResponse(operation, body)) throw new ClientFailure('INVALID_RESPONSE');
    const response = body as ServerInfo | ServerHealth;
    const profiles = await this.connection.profiles();
    if (response.serverId !== profiles.find((profile) => profile.active)?.serverId)
      throw new ClientFailure('INVALID_RESPONSE');
    if (operation === 'info') {
      const info = response as ServerInfo;
      if (info.protocol.min > supportedProtocol || info.protocol.max < supportedProtocol)
        throw new ClientFailure('INVALID_RESPONSE');
    }
    return response;
  }
}
