import { safeStorage } from 'electron';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MemoryCredentialStore,
  type CredentialStore,
  type ProfileData,
  type ProfileStore,
} from '../client-core/credentials.js';

// Electron storage adapters (client specification 4.2). Device tokens are encrypted with
// safeStorage, which uses the OS keychain, and kept apart from the nonsecret profile file. When
// only an insecure backend exists, as on Linux without a secret service, tokens stay in memory
// for this session and are never written to disk in plain text.

const handlePattern = /^[0-9a-f-]{36}$/;

// Whether safeStorage protects secrets with an OS-backed key.
export function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform !== 'linux') return true;
  const backend = safeStorage.getSelectedStorageBackend();
  return backend !== 'basic_text' && backend !== 'unknown';
}

export class SafeStorageCredentialStore implements CredentialStore {
  readonly persistent = true;
  constructor(private readonly directory: string) {}

  #path(handle: string): string {
    if (!handlePattern.test(handle)) throw new Error('Invalid credential handle');
    return join(this.directory, `${handle}.bin`);
  }

  async save(handle: string, secret: string): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.#path(handle);
    await writeFile(`${path}.tmp`, safeStorage.encryptString(secret), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }

  async resolve(handle: string): Promise<string | undefined> {
    try {
      return safeStorage.decryptString(await readFile(this.#path(handle)));
    } catch {
      return undefined;
    }
  }

  async remove(handle: string): Promise<void> {
    await rm(this.#path(handle), { force: true });
  }
}

export function credentialStore(directory: string): CredentialStore {
  return secureStorageAvailable()
    ? new SafeStorageCredentialStore(directory)
    : new MemoryCredentialStore();
}

// Profiles hold the server address and identities, never secrets.
export class FileProfileStore implements ProfileStore {
  constructor(private readonly path: string) {}

  async load(): Promise<ProfileData> {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8')) as ProfileData;
      if (Array.isArray(data.profiles)) return data;
    } catch {
      // Missing or unreadable: start without profiles.
    }
    return { activeId: null, profiles: [] };
  }

  async save(data: ProfileData): Promise<void> {
    await writeFile(`${this.path}.tmp`, `${JSON.stringify(data)}\n`, { mode: 0o600 });
    await rename(`${this.path}.tmp`, this.path);
    await chmod(this.path, 0o600);
  }
}
