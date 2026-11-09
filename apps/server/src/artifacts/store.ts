import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, type ReadStream } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

// Content-addressed bytes for artifacts (server specification 11.1). A file is copied to a
// temporary blob while it is hashed, flushed, then renamed to its hash. Only after that does a
// transaction publish a row naming it, so a crash leaves at most an unreferenced blob.

export type Ingested =
  | { kind: 'stored'; sha256: string; sizeBytes: number; storageKey: string }
  | { kind: 'missing' }
  | { kind: 'refused'; reason: string };

const hashPattern = /^[0-9a-f]{64}$/;

export class BlobStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  // Copies `name` from `directory`, which must sit inside `container` without a symbolic link on
  // the way, and must be a regular file of at most `maxBytes`.
  async ingest(
    container: string,
    directory: string,
    name: string,
    maxBytes: number,
  ): Promise<Ingested> {
    if (name.includes('/') || name.includes('\0') || name === '.' || name === '..')
      return { kind: 'refused', reason: 'The file name is not a plain name.' };
    let real: string;
    try {
      real = await realpath(directory);
    } catch {
      return { kind: 'missing' };
    }
    const base = await realpath(container);
    if (real !== resolve(directory) || !real.startsWith(base + sep))
      return { kind: 'refused', reason: 'The report directory is not where Shift created it.' };
    let handle;
    try {
      handle = await open(join(real, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { kind: 'missing' };
      if (code === 'ELOOP') return { kind: 'refused', reason: `${name} is a symbolic link.` };
      throw error;
    }
    const temporary = join(this.#root, 'tmp', randomUUID());
    try {
      const info = await handle.stat();
      if (!info.isFile()) return { kind: 'refused', reason: `${name} is not a regular file.` };
      if (info.size > maxBytes)
        return { kind: 'refused', reason: `${name} is larger than ${maxBytes} bytes.` };
      const hash = createHash('sha256');
      await mkdir(join(this.#root, 'tmp'), { recursive: true, mode: 0o700 });
      const output = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
      let size = 0;
      try {
        const buffer = Buffer.alloc(64 * 1024);
        for (;;) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (bytesRead === 0) break;
          size += bytesRead;
          // The file can grow while it is read.
          if (size > maxBytes)
            return { kind: 'refused', reason: `${name} is larger than ${maxBytes} bytes.` };
          const chunk = buffer.subarray(0, bytesRead);
          hash.update(chunk);
          await output.write(chunk);
        }
        await output.sync();
      } finally {
        await output.close();
      }
      const sha256 = hash.digest('hex');
      const storageKey = `sha256/${sha256.slice(0, 2)}/${sha256}`;
      const target = join(this.#root, storageKey);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      // Equal bytes have one blob; renaming over it replaces it with the same content.
      await rename(temporary, target);
      await this.#syncDirectory(dirname(target));
      return { kind: 'stored', sha256, sizeBytes: size, storageKey };
    } finally {
      await handle.close();
      await rm(temporary, { force: true });
    }
  }

  // The stored bytes, or null when the blob is missing.
  async read(storageKey: string): Promise<ReadStream | null> {
    const path = this.#path(storageKey);
    try {
      const info = await lstat(path);
      if (!info.isFile()) return null;
    } catch {
      return null;
    }
    return createReadStream(path);
  }

  // Whether the blob is present with the recorded size.
  async present(storageKey: string, sizeBytes: number): Promise<boolean> {
    try {
      const info = await stat(this.#path(storageKey));
      return info.isFile() && info.size === sizeBytes;
    } catch {
      return false;
    }
  }

  #path(storageKey: string): string {
    const [scheme, prefix, hash, ...rest] = storageKey.split('/');
    if (scheme !== 'sha256' || rest.length || !hash || !hashPattern.test(hash))
      throw new Error('Invalid storage key.');
    if (prefix !== hash.slice(0, 2)) throw new Error('Invalid storage key.');
    return join(this.#root, storageKey);
  }

  async #syncDirectory(path: string): Promise<void> {
    const directory = await open(path, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
