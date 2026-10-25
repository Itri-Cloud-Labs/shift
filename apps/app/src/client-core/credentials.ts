// Credential and profile storage (client specification 4.2). Tokens live only behind a
// CredentialStore handle in the main process; profiles hold nothing secret.

export interface CredentialStore {
  // False when secrets cannot be kept safely across restarts, such as Linux without a secret
  // service: credentials then last only for this session.
  readonly persistent: boolean;
  save(handle: string, secret: string): Promise<void>;
  resolve(handle: string): Promise<string | undefined>;
  remove(handle: string): Promise<void>;
}

export class MemoryCredentialStore implements CredentialStore {
  readonly persistent = false;
  readonly #secrets = new Map<string, string>();
  async save(handle: string, secret: string): Promise<void> {
    this.#secrets.set(handle, secret);
  }
  async resolve(handle: string): Promise<string | undefined> {
    return this.#secrets.get(handle);
  }
  async remove(handle: string): Promise<void> {
    this.#secrets.delete(handle);
  }
}

export interface StoredProfile {
  localId: string;
  url: string;
  serverId: string;
  eventEpoch: string;
  deviceId: string;
  deviceName: string;
  credentialHandle: string;
  pairedAt: number;
}

export interface ProfileData {
  activeId: string | null;
  profiles: StoredProfile[];
}

export interface ProfileStore {
  load(): Promise<ProfileData>;
  save(data: ProfileData): Promise<void>;
}

export class MemoryProfileStore implements ProfileStore {
  #data: ProfileData = { activeId: null, profiles: [] };
  async load(): Promise<ProfileData> {
    return structuredClone(this.#data);
  }
  async save(data: ProfileData): Promise<void> {
    this.#data = structuredClone(data);
  }
}
