import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { StateDirectory } from './state-directory.js';
import { ShiftError } from '../domain/errors.js';

export async function acquireInstanceLock(state: StateDirectory): Promise<() => Promise<void>> {
  let file: FileHandle | undefined;
  try {
    file = await open(
      join(state.path, 'instance.lock'),
      constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600,
    );
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== process.getuid!() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o777) !== 0o600
    ) {
      throw new ShiftError(
        'INSTANCE_LOCK_FAILED',
        'The instance lock must be an owned regular file with mode 0600 and no hard links.',
      );
    }
    let native: typeof import('fs-native-extensions');
    try {
      native = await import('fs-native-extensions');
    } catch {
      throw new ShiftError(
        'INSTANCE_LOCK_FAILED',
        'Cannot load the Linux filesystem lock binding. Check Node/Linux native compatibility.',
      );
    }
    if (!native.tryLock(file.fd)) {
      throw new ShiftError('INSTANCE_ALREADY_RUNNING', 'Another server owns this state directory.');
    }
    const owner = file;
    // Keep the persistent inode. Closing this descriptor (including on SIGKILL) releases
    // the kernel's OFD lock; deleting/recreating the file could admit a second owner.
    return () => owner.close();
  } catch (error) {
    try {
      await file?.close();
    } catch {
      /* Preserve the sanitized acquisition failure. */
    }
    throw error instanceof ShiftError
      ? error
      : new ShiftError(
          'INSTANCE_LOCK_FAILED',
          'Cannot acquire the private Linux server-instance lock.',
        );
  }
}
