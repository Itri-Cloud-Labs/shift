import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ShiftError } from '../domain/errors.js';

// Server secrets (specification 13.1) are sealed with AES-256-GCM under a versioned master key
// kept outside SQLite, in a mode-0600 file only the service account can read. This protects
// database-only copies such as backups; it does not hide secrets from code running as the same
// account. Each sealed value is bound to a context string, so it cannot be moved to another row.

interface KeyFile {
  formatVersion: 1;
  current: number;
  keys: Record<string, string>;
}

const unsafe = () =>
  new ShiftError(
    'UNSAFE_STATE_FILE',
    'The master key file must be a regular file owned by the server account with mode 0600.',
  );

export class SecretBox {
  private constructor(
    private readonly keys: ReadonlyMap<number, Buffer>,
    private readonly current: number,
  ) {}

  // Reads `<state>/secrets/master.key`, creating it with a new key on first start.
  static async open(stateDirectory: string): Promise<SecretBox> {
    const directory = join(stateDirectory, 'secrets');
    const path = join(directory, 'master.key');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const dirInfo = await lstat(directory);
    if (!dirInfo.isDirectory() || dirInfo.uid !== process.getuid!() || (dirInfo.mode & 0o077) !== 0)
      throw unsafe();
    let text: string;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid!()) throw unsafe();
      if ((info.mode & 0o077) !== 0) throw unsafe();
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const created: KeyFile = {
        formatVersion: 1,
        current: 1,
        keys: { '1': randomBytes(32).toString('base64') },
      };
      text = `${JSON.stringify(created)}\n`;
      // `wx` refuses to follow or replace anything another process put there first.
      await writeFile(path, text, { mode: 0o600, flag: 'wx' });
    }
    let file: KeyFile;
    try {
      file = JSON.parse(text) as KeyFile;
    } catch {
      throw new ShiftError('INVALID_MASTER_KEY', 'The master key file is not valid JSON.');
    }
    const keys = new Map<number, Buffer>();
    for (const [version, encoded] of Object.entries(file.keys ?? {})) {
      const key = Buffer.from(encoded, 'base64');
      if (!/^[1-9]\d*$/.test(version) || key.length !== 32) {
        throw new ShiftError('INVALID_MASTER_KEY', 'The master key file holds an invalid key.');
      }
      keys.set(Number(version), key);
    }
    if (file.formatVersion !== 1 || !keys.has(file.current)) {
      throw new ShiftError('INVALID_MASTER_KEY', 'The master key file has no current key.');
    }
    return new SecretBox(keys, file.current);
  }

  // `k<version>.<iv>.<tag>.<ciphertext>`, base64url, sealed under the current key.
  seal(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.current)!, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      `k${this.current}`,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  unseal(sealed: string, context: string): string {
    const [version, iv, tag, ciphertext] = sealed.split('.');
    const key = this.keys.get(Number(version?.slice(1)));
    if (!key || !iv || !tag || ciphertext === undefined) {
      throw new ShiftError('SECRET_UNAVAILABLE', 'A sealed secret uses an unknown key.');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ShiftError('SECRET_UNAVAILABLE', 'A sealed secret could not be opened.');
    }
  }
}
