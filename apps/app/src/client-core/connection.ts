import type { DeviceList, PairResponse, ServerInfo } from '../protocol/generated/types.js';
import {
  validateDeviceList,
  validatePairResponse,
  validateProtocolError,
  validateServerInfo,
} from '../protocol/generated/validators.js';
import type { CredentialStore, ProfileStore, StoredProfile } from './credentials.js';
import { ServerHttp, TransportFailure, type Exchange } from './http.js';
import { normalizeServerUrl } from './url.js';

// The connection runtime (client specification 4). It owns pairing, the active profile and its
// credential, and checks the server's identity and protocol before any token is sent. Every step
// that waits re-checks its generation, so the answer of a replaced attempt never changes state.

export const supportedProtocol = 0;
// A phrase lives ten minutes on the server; a lost pairing response is retried until then.
const pairingWindowMs = 10 * 60 * 1000;

export type ConnectionStatus =
  'unconfigured' | 'connecting' | 'pairing' | 'online' | 'offline' | 'revoked' | 'incompatible';

export type ConnectionProblem =
  | 'INVALID_URL'
  | 'INSECURE_URL'
  | 'UNREACHABLE'
  | 'INVALID_RESPONSE'
  | 'PROTOCOL_UNSUPPORTED'
  | 'PAIRING_UNAVAILABLE'
  | 'PAIRING_REJECTED'
  | 'PAIRING_RATE_LIMITED'
  | 'PAIRING_UNCONFIRMED'
  | 'IDENTITY_MISMATCH'
  | 'CREDENTIAL_MISSING'
  | 'DEVICE_REVOKED';

export interface ConnectionState {
  status: ConnectionStatus;
  profileId: string | null;
  problem: ConnectionProblem | null;
  // A pairing whose response was lost and can be retried with the same command.
  pairingPending: boolean;
}

export interface PublicProfile {
  localId: string;
  url: string;
  serverId: string;
  deviceId: string;
  deviceName: string;
  pairedAt: number;
  active: boolean;
  credential: 'saved' | 'session' | 'missing';
}

export interface PairingForm {
  url: string;
  phrase: string;
  deviceName: string;
}

export interface AuthenticatedTarget {
  profileId: string;
  url: string;
  serverId: string;
  deviceId: string;
  eventEpoch: string;
  bearer: string;
  signal: AbortSignal;
}

interface PendingPairing {
  url: string;
  serverId: string;
  eventEpoch: string;
  phrase: string;
  deviceName: string;
  commandId: string;
  abandonAt: number;
}

export interface ConnectionOptions {
  http: ServerHttp;
  credentials: CredentialStore;
  profiles: ProfileStore;
  allowLoopbackHttp: boolean;
  randomId?: () => string;
  now?: () => number;
}

export class ConnectionRuntime {
  readonly #options: Required<ConnectionOptions>;
  readonly #listeners = new Set<(state: ConnectionState) => void>();
  #state: ConnectionState = {
    status: 'unconfigured',
    profileId: null,
    problem: null,
    pairingPending: false,
  };
  #pending: PendingPairing | undefined;
  #generation = 0;
  #abort = new AbortController();

  constructor(options: ConnectionOptions) {
    this.#options = {
      randomId: () => crypto.randomUUID(),
      now: () => Date.now(),
      ...options,
    };
  }

  get state(): ConnectionState {
    return { ...this.#state };
  }

  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(state: Partial<ConnectionState>): void {
    this.#state = { ...this.#state, ...state, pairingPending: this.#pending !== undefined };
    for (const listener of this.#listeners) listener(this.state);
  }

  // A new attempt replaces any running one.
  #begin(): { generation: number; signal: AbortSignal; current: () => boolean } {
    this.#abort.abort();
    this.#abort = new AbortController();
    const generation = ++this.#generation;
    const signal = this.#abort.signal;
    return { generation, signal, current: () => generation === this.#generation };
  }

  // Connects the saved active profile, if any.
  async start(): Promise<void> {
    const data = await this.#options.profiles.load();
    if (data.activeId) await this.connect(data.activeId);
  }

  async profiles(): Promise<PublicProfile[]> {
    const data = await this.#options.profiles.load();
    const { credentials } = this.#options;
    return Promise.all(
      data.profiles.map(async (profile) => ({
        localId: profile.localId,
        url: profile.url,
        serverId: profile.serverId,
        deviceId: profile.deviceId,
        deviceName: profile.deviceName,
        pairedAt: profile.pairedAt,
        active: data.activeId === profile.localId,
        credential:
          (await credentials.resolve(profile.credentialHandle)) === undefined
            ? 'missing'
            : credentials.persistent
              ? 'saved'
              : 'session',
      })),
    );
  }

  get credentialStorage(): 'persistent' | 'session' {
    return this.#options.credentials.persistent ? 'persistent' : 'session';
  }

  // Reads and checks server info. The token is never sent before this succeeds.
  async #info(
    url: string,
    signal: AbortSignal,
  ): Promise<ServerInfo | { problem: ConnectionProblem; status: ConnectionStatus }> {
    let exchange: Exchange;
    try {
      exchange = await this.#options.http.request(url, 'GET', '/api/v0/info', { signal });
    } catch (error) {
      return error instanceof TransportFailure && error.kind === 'invalid'
        ? { problem: 'INVALID_RESPONSE', status: 'incompatible' }
        : { problem: 'UNREACHABLE', status: 'offline' };
    }
    // The range is read before the full schema: a newer server's info may not match this
    // client's schema, and it should be reported as unsupported, not as broken.
    const range = (exchange.body as { protocol?: { min?: unknown; max?: unknown } } | null)
      ?.protocol;
    if (
      exchange.status === 200 &&
      typeof range?.min === 'number' &&
      typeof range.max === 'number' &&
      (range.min > supportedProtocol || range.max < supportedProtocol)
    ) {
      return { problem: 'PROTOCOL_UNSUPPORTED', status: 'incompatible' };
    }
    if (exchange.status !== 200 || !validateServerInfo(exchange.body)) {
      return { problem: 'INVALID_RESPONSE', status: 'incompatible' };
    }
    return exchange.body;
  }

  // Pairs with a phrase. If the response is lost, the same form retries the same command, which
  // returns the same device and token until the phrase's original expiry. The phrase is kept only
  // in memory for that pending pairing.
  async pair(form: PairingForm): Promise<ConnectionState> {
    const attempt = this.#begin();
    const normalized = normalizeServerUrl(form.url, {
      allowLoopbackHttp: this.#options.allowLoopbackHttp,
    });
    if ('problem' in normalized) {
      this.#set({ status: 'unconfigured', problem: normalized.problem });
      return this.state;
    }
    const phrase = form.phrase
      .trim()
      .toLowerCase()
      .split(/[\s-]+/)
      .join(' ');
    const deviceName = form.deviceName.trim();
    const now = this.#options.now();
    if (this.#pending && this.#pending.abandonAt <= now) this.#pending = undefined;
    const same =
      this.#pending?.url === normalized.url &&
      this.#pending.phrase === phrase &&
      this.#pending.deviceName === deviceName;
    if (!same) this.#pending = undefined;
    this.#set({ status: 'pairing', problem: null });
    const info = await this.#info(normalized.url, attempt.signal);
    if (!attempt.current()) return this.state;
    if ('problem' in info) {
      this.#set({
        status: info.status === 'offline' ? 'pairing' : info.status,
        problem: info.problem,
      });
      return this.state;
    }
    if (!info.capabilities.pairing) {
      this.#set({ status: 'incompatible', problem: 'PAIRING_UNAVAILABLE' });
      return this.state;
    }
    // A retry must reach the server that issued the pending pairing.
    if (this.#pending && this.#pending.serverId !== info.serverId) {
      this.#pending = undefined;
      this.#set({ status: 'pairing', problem: 'IDENTITY_MISMATCH' });
      return this.state;
    }
    this.#pending ??= {
      url: normalized.url,
      serverId: info.serverId,
      eventEpoch: info.eventEpoch,
      phrase,
      deviceName,
      commandId: this.#options.randomId(),
      abandonAt: now + pairingWindowMs,
    };
    const pending = this.#pending;
    let exchange: Exchange;
    try {
      exchange = await this.#options.http.request(pending.url, 'POST', '/api/v0/pair', {
        body: {
          phrase: pending.phrase,
          deviceName: pending.deviceName,
          commandId: pending.commandId,
        },
        signal: attempt.signal,
      });
    } catch (error) {
      if (!attempt.current()) return this.state;
      // The device may exist already; only the same command can tell.
      this.#set({
        status: 'pairing',
        problem:
          error instanceof TransportFailure && error.kind === 'invalid'
            ? 'INVALID_RESPONSE'
            : 'PAIRING_UNCONFIRMED',
      });
      return this.state;
    }
    if (!attempt.current()) return this.state;
    if (exchange.status === 201 && validatePairResponse(exchange.body)) {
      return this.#paired(pending, exchange.body);
    }
    const code = validateProtocolError(exchange.body) ? exchange.body.code : undefined;
    if (code === 'RATE_LIMITED') {
      this.#set({ status: 'pairing', problem: 'PAIRING_RATE_LIMITED' });
      return this.state;
    }
    this.#pending = undefined;
    this.#set({
      status: 'unconfigured',
      problem: code === 'PAIRING_REJECTED' ? 'PAIRING_REJECTED' : 'INVALID_RESPONSE',
    });
    return this.state;
  }

  // Forgets a pending pairing whose response was lost, for example to use another phrase.
  abandonPairing(): ConnectionState {
    this.#begin();
    this.#pending = undefined;
    this.#set({ status: 'unconfigured', problem: null });
    return this.state;
  }

  async #paired(pending: PendingPairing, response: PairResponse): Promise<ConnectionState> {
    const { credentials, profiles } = this.#options;
    const handle = this.#options.randomId();
    await credentials.save(handle, response.token);
    const profile: StoredProfile = {
      localId: this.#options.randomId(),
      url: pending.url,
      serverId: pending.serverId,
      eventEpoch: pending.eventEpoch,
      deviceId: response.device.id,
      deviceName: response.device.name,
      credentialHandle: handle,
      pairedAt: this.#options.now(),
    };
    const data = await profiles.load();
    await profiles.save({ activeId: profile.localId, profiles: [...data.profiles, profile] });
    this.#pending = undefined;
    return this.connect(profile.localId);
  }

  // Connects a saved profile: identity and protocol first, then the device credential.
  async connect(profileId: string): Promise<ConnectionState> {
    const attempt = this.#begin();
    const { credentials, profiles } = this.#options;
    const data = await profiles.load();
    const profile = data.profiles.find((candidate) => candidate.localId === profileId);
    if (!profile) {
      this.#set({ status: 'unconfigured', profileId: null, problem: null });
      return this.state;
    }
    if (data.activeId !== profileId) await profiles.save({ ...data, activeId: profileId });
    this.#set({ status: 'connecting', profileId, problem: null });
    const token = await credentials.resolve(profile.credentialHandle);
    if (!attempt.current()) return this.state;
    if (token === undefined) {
      this.#set({ status: 'unconfigured', problem: 'CREDENTIAL_MISSING' });
      return this.state;
    }
    const info = await this.#info(profile.url, attempt.signal);
    if (!attempt.current()) return this.state;
    if ('problem' in info) {
      this.#set({ status: info.status, problem: info.problem });
      return this.state;
    }
    if (info.serverId !== profile.serverId) {
      this.#set({ status: 'incompatible', problem: 'IDENTITY_MISMATCH' });
      return this.state;
    }
    if (info.eventEpoch !== profile.eventEpoch)
      await this.#update(profileId, { eventEpoch: info.eventEpoch });
    let exchange: Exchange;
    try {
      exchange = await this.#options.http.request(profile.url, 'GET', '/api/v0/devices', {
        bearer: token,
        signal: attempt.signal,
      });
    } catch {
      if (attempt.current()) this.#set({ status: 'offline', problem: 'UNREACHABLE' });
      return this.state;
    }
    if (!attempt.current()) return this.state;
    if (exchange.status === 401) {
      // The token is useless now; pairing again is the only way back.
      await credentials.remove(profile.credentialHandle);
      this.#set({ status: 'revoked', problem: 'DEVICE_REVOKED' });
      return this.state;
    }
    const devices: DeviceList | undefined =
      exchange.status === 200 && validateDeviceList(exchange.body) ? exchange.body : undefined;
    if (!devices || devices.currentDeviceId !== profile.deviceId) {
      this.#set({ status: 'incompatible', problem: 'INVALID_RESPONSE' });
      return this.state;
    }
    this.#set({ status: 'online', problem: null });
    return this.state;
  }

  // Moves a profile to another address only once the server there proves to be the same one.
  async changeAddress(profileId: string, url: string): Promise<ConnectionState> {
    const attempt = this.#begin();
    const normalized = normalizeServerUrl(url, {
      allowLoopbackHttp: this.#options.allowLoopbackHttp,
    });
    if ('problem' in normalized) {
      this.#set({ problem: normalized.problem });
      return this.state;
    }
    const data = await this.#options.profiles.load();
    const profile = data.profiles.find((candidate) => candidate.localId === profileId);
    if (!profile) return this.state;
    const info = await this.#info(normalized.url, attempt.signal);
    if (!attempt.current()) return this.state;
    if ('problem' in info) {
      this.#set({ problem: info.problem });
      return this.state;
    }
    if (info.serverId !== profile.serverId) {
      this.#set({ problem: 'IDENTITY_MISMATCH' });
      return this.state;
    }
    await this.#update(profileId, { url: normalized.url });
    return this.connect(profileId);
  }

  // Removes the profile and its credential on this computer only; the server and its runs are
  // untouched, and the device stays listed there until it is revoked.
  async clear(profileId: string): Promise<ConnectionState> {
    const { credentials, profiles } = this.#options;
    const data = await profiles.load();
    const profile = data.profiles.find((candidate) => candidate.localId === profileId);
    if (!profile) return this.state;
    await credentials.remove(profile.credentialHandle);
    const active = data.activeId === profileId;
    await profiles.save({
      activeId: active ? null : data.activeId,
      profiles: data.profiles.filter((candidate) => candidate.localId !== profileId),
    });
    if (active) {
      this.#begin();
      this.#set({ status: 'unconfigured', profileId: null, problem: null });
    }
    return this.state;
  }

  // The active profile's address, identities and token for an authenticated request, while
  // online. The signal aborts when this connection is replaced.
  async authenticated(): Promise<AuthenticatedTarget | undefined> {
    if (this.#state.status !== 'online' || !this.#state.profileId) return undefined;
    const signal = this.#abort.signal;
    const profileId = this.#state.profileId;
    const data = await this.#options.profiles.load();
    const profile = data.profiles.find((candidate) => candidate.localId === profileId);
    const bearer = profile && (await this.#options.credentials.resolve(profile.credentialHandle));
    if (!profile || !bearer || signal.aborted) return undefined;
    return {
      profileId,
      url: profile.url,
      serverId: profile.serverId,
      deviceId: profile.deviceId,
      eventEpoch: profile.eventEpoch,
      bearer,
      signal,
    };
  }

  // Stops using the connection, for example when the window closes. Nothing on the server changes.
  disconnect(): void {
    this.#begin();
    this.#set({ status: 'unconfigured', profileId: null, problem: null });
  }

  async #update(profileId: string, change: Partial<StoredProfile>): Promise<void> {
    const data = await this.#options.profiles.load();
    await this.#options.profiles.save({
      ...data,
      profiles: data.profiles.map((profile) =>
        profile.localId === profileId ? { ...profile, ...change } : profile,
      ),
    });
  }
}
