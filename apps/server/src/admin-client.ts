import { request } from 'node:http';
import { realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ShiftError } from './domain/errors.js';
import { inspectOwnedFile } from './lifecycle/state-directory.js';

export async function administrativeRequest(
  stateDirectory: string,
  operation: 'info' | 'health' | 'ready' | 'stop',
): Promise<unknown> {
  const directory = await realpath(stateDirectory);
  const metadata = await stat(directory);
  if (metadata.uid !== process.getuid!() || (metadata.mode & 0o077) !== 0) {
    throw new ShiftError(
      'UNSAFE_STATE_DIRECTORY',
      'The administrative state directory must be private and owned by this account.',
    );
  }
  const socketPath = join(directory, 'admin.sock');
  if (
    !(await inspectOwnedFile(socketPath, 'socket')) ||
    ((await stat(socketPath)).mode & 0o777) !== 0o600
  ) {
    throw new ShiftError(
      'ADMIN_UNAVAILABLE',
      'The administrative socket is missing or does not have mode 0600.',
    );
  }
  return new Promise<unknown>((resolve, reject) => {
    const req = request(
      {
        socketPath,
        method: operation === 'stop' ? 'POST' : 'GET',
        path: operation === 'stop' ? '/api/v0/admin/shutdown' : `/api/v0/${operation}`,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let length = 0;
        res.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 64 * 1024)
            req.destroy(
              new ShiftError(
                'ADMIN_INVALID_RESPONSE',
                'Administrative response exceeded the size limit.',
              ),
            );
          else chunks.push(chunk);
        });
        res.on('error', () =>
          reject(new ShiftError('ADMIN_UNAVAILABLE', 'Administrative response was interrupted.')),
        );
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (
              res.statusCode !== 200 &&
              res.statusCode !== 202 &&
              !(operation === 'ready' && res.statusCode === 503)
            ) {
              reject(
                new ShiftError('ADMIN_REJECTED', 'The server rejected the administrative request.'),
              );
            } else resolve(payload);
          } catch {
            reject(
              new ShiftError(
                'ADMIN_INVALID_RESPONSE',
                'The server returned invalid administrative JSON.',
              ),
            );
          }
        });
      },
    );
    const timeout = setTimeout(
      () => req.destroy(new ShiftError('ADMIN_UNAVAILABLE', 'Administrative request timed out.')),
      3000,
    );
    req.on('error', (error) => {
      clearTimeout(timeout);
      reject(
        error instanceof ShiftError
          ? error
          : new ShiftError('ADMIN_UNAVAILABLE', 'Cannot connect to the administrative socket.'),
      );
    });
    req.end();
  });
}
