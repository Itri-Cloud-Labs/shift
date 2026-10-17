import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ResultHandler } from '../types.js';

export interface ResultEndpoint {
  url: string;
  token: string;
  close(): Promise<void>;
}

const maximumBodyBytes = 1024 * 1024;

function reply(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maximumBodyBytes) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';

// Loopback endpoint the Shift plugin calls from inside OpenCode. The bearer token is rotated per
// runtime generation and reaches OpenCode only through its private namespace config file.
export async function startResultEndpoint(handler: ResultHandler): Promise<ResultEndpoint> {
  const token = randomBytes(32).toString('base64url');
  const expected = Buffer.from(`Bearer ${token}`);
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/result') {
      return reply(response, 404, { accepted: false, reason: 'not found' });
    }
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply(response, 401, { accepted: false, reason: 'unauthorized' });
    }
    const text = await readBody(request);
    let call: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = text === null ? null : JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) call = parsed as Record<string, unknown>;
    } catch {
      call = null;
    }
    if (
      !call ||
      !isString(call['sessionID']) ||
      !isString(call['messageID']) ||
      !isString(call['callID'])
    ) {
      return reply(response, 400, { accepted: false, reason: 'malformed submission' });
    }
    try {
      const verdict = await handler({
        harnessSessionId: call['sessionID'],
        assistantMessageId: call['messageID'],
        toolCallId: call['callID'],
        input: call['input'],
      });
      reply(response, 200, verdict);
    } catch {
      // Not recorded, so not accepted; the plugin reports a retryable failure to the agent.
      reply(response, 500, { accepted: false, reason: 'result could not be recorded' });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/result`,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
