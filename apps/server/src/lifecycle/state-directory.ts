import { mkdir, realpath, stat, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { ShiftError } from '../domain/errors.js';

export interface StateDirectory {
  path: string;
  device: bigint;
  inode: bigint;
  adminSocket: string;
}

export async function prepareStateDirectory(path: string): Promise<StateDirectory> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const canonicalPath = await realpath(path);
  const metadata = await stat(canonicalPath, { bigint: true });
  if (
    !metadata.isDirectory() ||
    metadata.uid !== BigInt(process.getuid!()) ||
    (metadata.mode & 0o077n) !== 0n
  ) {
    throw new ShiftError(
      'UNSAFE_STATE_DIRECTORY',
      'The state directory must be owned by this account with mode 0700.',
    );
  }
  const adminSocket = join(canonicalPath, 'admin.sock');
  if (Buffer.byteLength(adminSocket) > 103) {
    throw new ShiftError(
      'INVALID_CONFIGURATION',
      'The state directory path is too long for the administrative Unix socket.',
      422,
    );
  }
  return { path: canonicalPath, device: metadata.dev, inode: metadata.ino, adminSocket };
}

export async function inspectOwnedFile(path: string, kind: 'file' | 'socket'): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    if (
      metadata.uid !== process.getuid!() ||
      (kind === 'file' ? !metadata.isFile() || metadata.nlink !== 1 : !metadata.isSocket())
    ) {
      throw new ShiftError('UNSAFE_STATE_FILE', 'A state path has an unexpected type or owner.');
    }
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
