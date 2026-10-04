import {
  withinLimit,
  RESPONSE_LIMIT,
  type FoundationQuery,
  type ShellState,
} from '../shared/contracts.js';
import { createShell } from './fixtures.js';
import { validateServerInfo, validateServerHealth } from '../protocol/generated/validators.js';
import type { ServerInfo, ServerHealth } from '../protocol/generated/types.js';

export interface CredentialStore {
  resolve(handle: string): Promise<string | undefined>;
}
export interface ClientTransport {
  query(
    operation: FoundationQuery,
    context: { bearer: string; signal: AbortSignal },
  ): Promise<unknown>;
}
export interface PrivateProfile {
  serverId: string;
  credentialHandle: string;
}
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
export class ClientCore {
  #samples: boolean;
  #generation = 0;
  #abort = new AbortController();
  constructor(
    private readonly transport: ClientTransport,
    private readonly credentials: CredentialStore,
    private profile: PrivateProfile | undefined,
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
  disconnect(): void {
    this.#generation++;
    this.#abort.abort();
    this.#abort = new AbortController();
    this.profile = undefined;
  }
  async query(operation: FoundationQuery): Promise<ServerInfo | ServerHealth> {
    const generation = this.#generation;
    const signal = this.#abort.signal;
    const profile = this.profile;
    if (!profile) throw new ClientFailure('DISCONNECTED');
    let bearer: string | undefined;
    try {
      bearer = await this.credentials.resolve(profile.credentialHandle);
    } catch {
      throw new ClientFailure('DISCONNECTED');
    }
    if (!bearer || signal.aborted || generation !== this.#generation)
      throw new ClientFailure('DISCONNECTED');
    let value: unknown;
    try {
      value = await this.transport.query(operation, { bearer, signal });
    } catch {
      throw new ClientFailure('DISCONNECTED');
    }
    if (signal.aborted || generation !== this.#generation) throw new ClientFailure('DISCONNECTED');
    if (!validFoundationResponse(operation, value)) throw new ClientFailure('INVALID_RESPONSE');
    const response = value as ServerInfo | ServerHealth;
    if (response.serverId !== profile.serverId) throw new ClientFailure('INVALID_RESPONSE');
    if (operation === 'info') {
      const info = response as ServerInfo;
      if (info.protocol.min > 0 || info.protocol.max < 0)
        throw new ClientFailure('INVALID_RESPONSE');
    }
    return response;
  }
}
