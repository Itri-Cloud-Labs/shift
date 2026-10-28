// The HTTP exchange used by the connection runtime. `fetch` is injected, so client-core runs
// without Electron and tests drive it with a fake. Network failure and an invalid answer are
// different outcomes: after a network failure a command may or may not have been applied.

export interface FetchResponse {
  status: number;
  text(): Promise<string>;
  // Present on streaming answers such as the event stream.
  body?: ReadableStream<Uint8Array> | null;
}

export type Fetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    redirect: 'error';
  },
) => Promise<FetchResponse>;

export class TransportFailure extends Error {
  constructor(readonly kind: 'unreachable' | 'invalid') {
    super(
      kind === 'unreachable' ? 'The server could not be reached.' : 'The server answer is invalid.',
    );
  }
}

export interface Exchange {
  status: number;
  body: unknown;
}

// An opened event stream, or the JSON answer that refused it.
export type StreamOpening =
  { status: 200; body: ReadableStream<Uint8Array> } | { status: number; error: unknown };

export class ServerHttp {
  constructor(
    private readonly fetch: Fetch,
    private readonly options: { timeoutMs: number; maxBytes: number } = {
      timeoutMs: 15_000,
      maxBytes: 16 * 1024 * 1024,
    },
  ) {}

  async request(
    base: string,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    init: { bearer?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<Exchange> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let response: FetchResponse;
    let text: string;
    try {
      response = await this.fetch(`${base}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(init.bearer === undefined ? {} : { authorization: `Bearer ${init.bearer}` }),
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal,
        // A redirect could carry the bearer token to another origin.
        redirect: 'error',
      });
      text = await response.text();
    } catch {
      throw new TransportFailure('unreachable');
    }
    if (text.length > this.options.maxBytes) throw new TransportFailure('invalid');
    try {
      return { status: response.status, body: JSON.parse(text) as unknown };
    } catch {
      throw new TransportFailure('invalid');
    }
  }

  // Opens a long-lived SSE stream. It has no overall timeout: the caller watches keepalives and
  // aborts the signal to close it.
  async stream(
    base: string,
    path: string,
    init: { bearer: string; lastEventId: string; signal: AbortSignal },
  ): Promise<StreamOpening> {
    // The timeout covers only the wait for headers; aborting later would cut the stream.
    const opening = new AbortController();
    const timer = setTimeout(() => opening.abort(), this.options.timeoutMs);
    let response: FetchResponse;
    try {
      response = await this.fetch(`${base}${path}`, {
        method: 'GET',
        headers: {
          accept: 'text/event-stream',
          authorization: `Bearer ${init.bearer}`,
          'last-event-id': init.lastEventId,
        },
        signal: AbortSignal.any([init.signal, opening.signal]),
        redirect: 'error',
      });
    } catch {
      throw new TransportFailure('unreachable');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 200 && response.body) return { status: 200, body: response.body };
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new TransportFailure('unreachable');
    }
    try {
      return { status: response.status, error: JSON.parse(text) as unknown };
    } catch {
      throw new TransportFailure('invalid');
    }
  }
}
