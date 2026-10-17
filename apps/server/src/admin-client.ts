import { request } from 'node:http';
import { realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ShiftError } from './domain/errors.js';
import { inspectOwnedFile } from './lifecycle/state-directory.js';

export async function administrativeRequest(
  stateDirectory: string,
  operation: 'info' | 'health' | 'ready' | 'stop',
): Promise<unknown> {
  const { status, payload } = await administrativeCall(stateDirectory, {
    method: operation === 'stop' ? 'POST' : 'GET',
    path: operation === 'stop' ? '/api/v0/admin/shutdown' : `/api/v0/${operation}`,
  });
  if (status !== 200 && status !== 202 && !(operation === 'ready' && status === 503)) {
    throw new ShiftError('ADMIN_REJECTED', 'The server rejected the administrative request.');
  }
  return payload;
}

// One request over the private administrative socket. Any JSON response is returned with its
// status, so callers can report the server's own protocol error.
export async function administrativeCall(
  stateDirectory: string,
  call: { method: 'GET' | 'POST' | 'PUT'; path: string; body?: unknown },
): Promise<{ status: number; payload: unknown }> {
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
  return new Promise<{ status: number; payload: unknown }>((resolve, reject) => {
    const body = call.body === undefined ? undefined : JSON.stringify(call.body);
    const req = request(
      {
        socketPath,
        method: call.method,
        path: call.path,
        agent: false,
        ...(body === undefined
          ? {}
          : {
              headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
              },
            }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let length = 0;
        res.on('data', (chunk: Buffer) => {
          length += chunk.length;
          // A run view repeats its result (outcome, agent output, end output); results are <= 1 MiB.
          if (length > 16 * 1024 * 1024)
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
            resolve({ status: res.statusCode ?? 0, payload });
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
    req.end(body);
  });
}
