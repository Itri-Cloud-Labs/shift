import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import type { StateDirectory } from './state-directory.js';
import { ShiftError } from '../domain/errors.js';

export async function acquireInstanceLock(state: StateDirectory): Promise<() => Promise<void>> {
  const identity = createHash('sha256').update(`${state.device}:${state.inode}`).digest('hex');
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(
        new ShiftError(
          error.code === 'EADDRINUSE' ? 'INSTANCE_ALREADY_RUNNING' : 'INSTANCE_LOCK_FAILED',
          error.code === 'EADDRINUSE'
            ? 'Another server owns this state directory.'
            : 'Cannot acquire the Linux server-instance lock.',
        ),
      );
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ path: `\0shift-server-${identity}` });
  });
  return () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
}
