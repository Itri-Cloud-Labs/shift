import { constants, createReadStream, type ReadStream } from 'node:fs';
import { lstat, open, opendir, readlink, realpath, type FileHandle } from 'node:fs/promises';
import { basename, isAbsolute, join, normalize, sep } from 'node:path';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import { gitDiff, gitStatus, hostTransport, type GitContext } from '../actions/git.js';
import type { Workspaces } from './workspaces.js';

// Read-only inspection of run workspaces (server specification 13.2, client 5.6). Every path is
// relative to a registered workspace and resolved there: one that leaves it, through `..` or a
// symbolic link, is refused, as is the worktree's `.git`. Nothing here writes to a workspace.

export const maxListing = 1000;
// Text shown inline; larger files are downloaded.
export const maxInline = 512 * 1024;
export const maxDownload = 100 * 1024 * 1024;
export const maxDiff = 1024 * 1024;

export interface Entry {
  name: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  size: number | null;
}

const refuse = (message: string) => new ShiftError('INVALID_PATH', message, 422, false, ['/path']);
const outside = () =>
  new ShiftError('PATH_OUTSIDE_WORKSPACE', 'The path leads outside the workspace.', 403);
const missing = () =>
  new ShiftError('NOT_FOUND', 'No such file or directory in the workspace.', 404);

// A relative path in the workspace, as written by the client: no absolute paths, no `..`, no NUL,
// and not the worktree's Git metadata.
export function cleanPath(path: string | undefined): string {
  const raw = path ?? '';
  if (raw.length > 4096 || raw.includes('\0')) throw refuse('The path is not valid.');
  if (isAbsolute(raw)) throw refuse('Paths are relative to the workspace.');
  const parts = raw.split(/[\\/]+/).filter((part) => part !== '' && part !== '.');
  if (parts.includes('..')) throw refuse('Paths stay inside the workspace.');
  if (parts[0] === '.git') throw refuse('The worktree’s Git metadata is not inspected.');
  return parts.join('/');
}

const within = (root: string, path: string) => path === root || path.startsWith(root + sep);

export class WorkspaceInspector {
  constructor(private readonly workspaces: Workspaces) {}

  // The workspace's real root, while it exists and is ready.
  async #root(id: string): Promise<{ root: string; baseCommit: string }> {
    const workspace = this.workspaces.get(id);
    if (workspace.state !== 'READY')
      throw new ShiftError(
        'WORKSPACE_UNAVAILABLE',
        workspace.state === 'RETIRED'
          ? 'The workspace was removed; its recorded artifacts remain on its run.'
          : 'The workspace is still being created.',
        409,
      );
    try {
      return { root: await realpath(workspace.path), baseCommit: workspace.baseCommit };
    } catch {
      throw new ShiftError('WORKSPACE_MISSING', 'The workspace directory is gone.', 409);
    }
  }

  async #resolve(root: string, path: string): Promise<string> {
    let real: string;
    try {
      real = await realpath(join(root, normalize(path || '.')));
    } catch {
      throw missing();
    }
    if (!within(root, real)) throw outside();
    if (real !== root && real.slice(root.length + 1).split(sep)[0] === '.git') throw outside();
    return real;
  }

  // Opens a regular file without following a final symbolic link, then confirms through the open
  // descriptor that the file it got is inside the workspace, so a link swapped in after the check
  // cannot redirect the read.
  async #openFile(root: string, path: string): Promise<{ handle: FileHandle; size: number }> {
    const real = await this.#resolve(root, path);
    let handle: FileHandle;
    try {
      handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch {
      throw missing();
    }
    try {
      const opened = await readlink(`/proc/self/fd/${handle.fd}`);
      if (!within(root, opened)) throw outside();
      const stat = await handle.stat();
      if (!stat.isFile())
        throw new ShiftError('NOT_A_FILE', 'Only regular files can be read.', 422);
      return { handle, size: stat.size };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async list(
    id: string,
    path?: string,
  ): Promise<{ path: string; entries: Entry[]; truncated: boolean }> {
    const { root } = await this.#root(id);
    const relative = cleanPath(path);
    const directory = await this.#resolve(root, relative);
    const entries: Entry[] = [];
    let truncated = false;
    let dir;
    try {
      dir = await opendir(directory);
    } catch {
      throw new ShiftError('NOT_A_DIRECTORY', 'The path is not a directory.', 422);
    }
    for await (const item of dir) {
      if (directory === root && item.name === '.git') continue;
      if (entries.length === maxListing) {
        truncated = true;
        break;
      }
      // Links are shown as links, never followed.
      const stat = await lstat(join(directory, item.name)).catch(() => null);
      entries.push({
        name: item.name,
        kind: stat?.isDirectory()
          ? 'directory'
          : stat?.isSymbolicLink()
            ? 'symlink'
            : stat?.isFile()
              ? 'file'
              : 'other',
        size: stat?.isFile() ? stat.size : null,
      });
    }
    entries.sort((a, b) =>
      a.kind === 'directory' && b.kind !== 'directory'
        ? -1
        : b.kind === 'directory' && a.kind !== 'directory'
          ? 1
          : a.name.localeCompare(b.name),
    );
    return { path: relative, entries, truncated };
  }

  // A file's first bytes as text, or a note that it is binary or too large to show.
  async file(
    id: string,
    path: string | undefined,
  ): Promise<{
    path: string;
    size: number;
    binary: boolean;
    truncated: boolean;
    text: string | null;
  }> {
    const { root } = await this.#root(id);
    const relative = cleanPath(path);
    if (relative === '') throw refuse('Name a file.');
    const { handle, size } = await this.#openFile(root, relative);
    try {
      const length = Math.min(size, maxInline);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      let text: string | null = null;
      let binary = bytes.subarray(0, 8192).includes(0);
      if (!binary) {
        try {
          // A multi-byte character cut by the limit is not a reason to call the file binary.
          text = new TextDecoder('utf-8', { fatal: true }).decode(
            size > length ? trimPartial(bytes) : bytes,
          );
        } catch {
          binary = true;
        }
      }
      return { path: relative, size, binary, truncated: size > length, text: binary ? null : text };
    } finally {
      await handle.close();
    }
  }

  // The file's bytes for a download, up to the limit.
  async download(
    id: string,
    path: string | undefined,
  ): Promise<{ name: string; size: number; stream: ReadStream }> {
    const { root } = await this.#root(id);
    const relative = cleanPath(path);
    if (relative === '') throw refuse('Name a file.');
    const { handle, size } = await this.#openFile(root, relative);
    if (size > maxDownload) {
      await handle.close();
      throw new ShiftError('FILE_TOO_LARGE', 'The file is larger than 100 MiB.', 413);
    }
    // The stream reads from the descriptor already checked, not the path again.
    const stream = createReadStream('', { fd: handle.fd, autoClose: false, end: size - 1 });
    stream.on('close', () => void handle.close());
    return { name: basename(relative), size, stream };
  }

  #context(root: string, baseCommit: string): GitContext {
    return {
      cwd: root,
      baseCommit,
      env: process.env['PATH'] === undefined ? {} : { PATH: process.env['PATH'] },
      transport: hostTransport,
      signal: AbortSignal.timeout(60_000),
    };
  }

  // HEAD, branch and changed paths, as live as the workspace is now.
  async status(id: string): Promise<Json> {
    const { root, baseCommit } = await this.#root(id);
    const outcome = await gitStatus(
      { action: 'git_status', workspaceId: id, maxEntries: maxListing, safeToRetry: false },
      this.#context(root, baseCommit),
    );
    if (outcome.kind !== 'succeeded')
      throw new ShiftError('GIT_FAILED', 'Git could not read the workspace.', 422);
    return outcome.data;
  }

  async diff(id: string, against: 'base' | 'head', path?: string): Promise<Json> {
    const { root, baseCommit } = await this.#root(id);
    const relative = cleanPath(path);
    const outcome = await gitDiff(
      {
        action: 'git_diff',
        safeToRetry: false,
        workspaceId: id,
        against,
        maxBytes: maxDiff,
        ...(relative ? { paths: [relative] } : {}),
      },
      this.#context(root, baseCommit),
    );
    if (outcome.kind !== 'succeeded')
      throw new ShiftError('GIT_FAILED', 'Git could not read the workspace.', 422);
    return outcome.data;
  }
}

// Drops a UTF-8 sequence the read limit cut in two.
function trimPartial(bytes: Buffer): Buffer {
  let lead = bytes.length - 1;
  while (lead >= 0 && bytes.length - lead <= 3 && (bytes[lead]! & 0xc0) === 0x80) lead--;
  if (lead < 0) return bytes;
  const byte = bytes[lead]!;
  const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
  return bytes.length - lead < needed ? bytes.subarray(0, lead) : bytes;
}
