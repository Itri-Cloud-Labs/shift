import { ShiftError } from '../../domain/errors.js';

export interface OpenCodeResponse {
  status: number;
  body: unknown;
}

export interface OpenCodeEvent {
  id?: string;
  type: string;
  created?: number;
  data?: Record<string, unknown>;
}

const unavailable = () =>
  new ShiftError('HARNESS_UNAVAILABLE', 'The OpenCode runtime did not respond.', 503, true);

// Basic-auth client for one runtime generation. Every request has a deadline that also covers
// reading the body, so a stalled runtime cannot hold a caller indefinitely.
export class OpenCodeClient {
  readonly #authorization: string;

  constructor(
    readonly url: string,
    password: string,
  ) {
    this.#authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  }

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { body?: unknown; location?: string; timeoutMs?: number } = {},
  ): Promise<OpenCodeResponse> {
    const target = new URL(path, this.url);
    if (options.location !== undefined) {
      target.searchParams.set('location[directory]', options.location);
    }
    try {
      const response = await fetch(target, {
        method,
        headers: { authorization: this.#authorization, 'content-type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      return { status: response.status, body };
    } catch {
      throw unavailable();
    }
  }

  // Like `request`, but any status outside `expected` is an error.
  async expect(
    expected: readonly number[],
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { body?: unknown; location?: string; timeoutMs?: number } = {},
  ): Promise<OpenCodeResponse> {
    const response = await this.request(method, path, options);
    if (!expected.includes(response.status)) {
      throw new ShiftError(
        'HARNESS_REQUEST_FAILED',
        `OpenCode answered ${method} ${new URL(path, this.url).pathname} with HTTP ${response.status}.`,
        502,
      );
    }
    return response;
  }

  // Live events only: OpenCode v2 sends no SSE ids and does not replay after a reconnect.
  async *events(signal: AbortSignal): AsyncIterable<OpenCodeEvent> {
    let response: Response;
    try {
      response = await fetch(new URL('/api/event', this.url), {
        headers: { authorization: this.#authorization },
        signal,
      });
    } catch {
      if (signal.aborted) return;
      throw unavailable();
    }
    if (!response.ok || !response.body) throw unavailable();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const event = parseEventBlock(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          if (event) yield event;
        }
      }
    } catch {
      if (!signal.aborted) throw unavailable();
    }
  }
}

export function parseEventBlock(block: string): OpenCodeEvent | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const type = (parsed as { type?: unknown }).type;
    return typeof type === 'string' ? (parsed as OpenCodeEvent) : null;
  } catch {
    return null;
  }
}
