import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, type ReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

// Content-addressed bytes for artifacts (server specification 11.1). A file is copied to a
// temporary blob while it is hashed, flushed, then renamed to its hash. Only after that does a
// transaction publish a row naming it, so a crash leaves at most an unreferenced blob.

export type Ingested =
  | { kind: 'stored'; sha256: string; sizeBytes: number; storageKey: string }
  | { kind: 'missing' }
  | { kind: 'refused'; reason: string };

const hashPattern = /^[0-9a-f]{64}$/;

// Writes part of `chunk` and says how much; tests replace it to prove short writes are finished.
export type ChunkWriter = (handle: FileHandle, chunk: Buffer) => Promise<number>;

const writeChunk: ChunkWriter = async (handle, chunk) => (await handle.write(chunk)).bytesWritten;

export class BlobStore {
  readonly #root: string;
  readonly #write: ChunkWriter;

  constructor(root: string, options: { write?: ChunkWriter } = {}) {
    this.#root = resolve(root);
    this.#write = options.write ?? writeChunk;
  }

  // Copies `name` from `directory`, which must sit inside `container`, and must be a regular file
  // of at most `maxBytes`. The agent owns that directory and can swap it while Shift reads, so the
  // directory is opened once and checked as opened, and the file is opened through that
  // descriptor (Linux /proc/self/fd), never by a path that could be replaced in between.
  async ingest(
    container: string,
    directory: string,
    name: string,
    maxBytes: number,
  ): Promise<Ingested> {
    if (name.includes('/') || name.includes('\0') || name === '.' || name === '..')
      return { kind: 'refused', reason: 'The file name is not a plain name.' };
    let folder: FileHandle;
    try {
      folder = await open(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { kind: 'missing' };
      if (code === 'ELOOP' || code === 'ENOTDIR')
        return { kind: 'refused', reason: 'The report directory is not where Shift created it.' };
      throw error;
    }
    let handle: FileHandle;
    try {
      const opened = await readlink(`/proc/self/fd/${folder.fd}`);
      // Where the directory must be once the container's own path is resolved.
      const base = await realpath(container);
      const expected = join(base, relative(resolve(container), resolve(directory)));
      if (opened !== expected || !opened.startsWith(base + sep))
        return { kind: 'refused', reason: 'The report directory is not where Shift created it.' };
      try {
        // Nonblocking, so a named pipe without a writer cannot hold the open.
        handle = await open(
          `/proc/self/fd/${folder.fd}/${name}`,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return { kind: 'missing' };
        if (code === 'ELOOP') return { kind: 'refused', reason: `${name} is a symbolic link.` };
        throw error;
      }
    } finally {
      await folder.close();
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
          // A write can take less than it was given; the rest follows until the chunk is whole.
          for (let written = 0; written < chunk.length;)
            written += await this.#write(output, chunk.subarray(written));
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
      // The rename and any directory created for it survive a machine crash only once every
      // directory on the way has been flushed, before a transaction may name the blob.
      for (const path of [
        dirname(target),
        dirname(dirname(target)),
        this.#root,
        dirname(this.#root),
      ])
        await this.#syncDirectory(path);
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
