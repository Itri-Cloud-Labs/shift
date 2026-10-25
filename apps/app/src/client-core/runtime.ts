import {
  withinLimit,
  RESPONSE_LIMIT,
  type FoundationQuery,
  type ShellState,
} from '../shared/contracts.js';
import { createShell } from './fixtures.js';
import { validateServerInfo, validateServerHealth } from '../protocol/generated/validators.js';
import type { ServerInfo, ServerHealth } from '../protocol/generated/types.js';
import { supportedProtocol, type ConnectionRuntime } from './connection.js';
import { TransportFailure, type ServerHttp } from './http.js';

export class ClientFailure extends Error {
  constructor(readonly code: 'DISCONNECTED' | 'INVALID_RESPONSE') {
    super(
      code === 'DISCONNECTED'
        ? 'Connect to a server before querying it.'
        : 'The server response is invalid.',
    );
  }
}
export function validFoundationResponse(operation: FoundationQuery, value: unknown): boolean {
  if (!withinLimit(value, RESPONSE_LIMIT)) return false;
  if (operation === 'info') return validateServerInfo(value);
  return (operation === 'health' || operation === 'ready') && validateServerHealth(value);
}

// The shell and the server status queries. Queries go to the active connection's server with its
// device credential; an answer from another server or a replaced connection is refused.
export class ClientCore {
  #samples: boolean;
  constructor(
    readonly connection: ConnectionRuntime,
    private readonly http: ServerHttp,
    samples = false,
  ) {
    this.#samples = samples;
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
