import { statSync, openSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';

const state = statSync(process.argv[2], { bigint: true });
const predictable = createHash('sha256').update(`${state.dev}:${state.ino}`).digest('hex');
const server = createServer((socket) => socket.destroy());
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen({ path: `\0shift-server-${predictable}` }, resolve);
});
try {
  openSync(join(process.argv[2], 'instance.lock'), 'a+');
  throw new Error('An unrelated account opened the private lock file.');
} catch (error) {
  if (error.code !== 'EACCES') throw error;
}
process.stdout.write('PRECLAIMED\n');
process.stdin.resume();
process.stdin.once('end', () => server.close());
