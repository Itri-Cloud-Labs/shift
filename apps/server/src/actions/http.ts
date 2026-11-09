import type { Json } from '../harness/types.js';
import { checkValue } from '../runs/envelope.js';
import type { ExecutionError } from '../runs/repository.js';
import { safeToRepeat, type HttpConfig } from './config.js';
import { redact, type Outcome } from './outcome.js';

// One HTTP request (specification section 8). The response body is read up to its limit, so a
// large or endless response cannot exhaust memory. A request that failed before it could reach the
// server is a known failure; one that may have reached it without a response is uncertain unless
// repeating it is safe.

// Errors that mean the request never left this machine.
const notSent = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_INVALID_URL',
  'UND_ERR_CONNECT_TIMEOUT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
]);

function causeCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function readCapped(
  response: Response,
  limit: number,
): Promise<{ bytes: Buffer; tooLarge: boolean }> {
  if (!response.body) return { bytes: Buffer.alloc(0), tooLarge: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return { bytes: Buffer.alloc(0), tooLarge: true };
    }
    chunks.push(Buffer.from(value));
  }
  return { bytes: Buffer.concat(chunks), tooLarge: false };
}

export async function sendRequest(
  config: HttpConfig,
  secrets: Record<string, string>,
  signal: AbortSignal,
  submit: () => void,
  fetchImpl: typeof fetch = fetch,
): Promise<Outcome> {
  const values = Object.values(secrets);
  const headers = new Headers();
  for (const [name, value] of Object.entries(config.headers)) headers.set(name, value);
  for (const [name, value] of Object.entries(secrets)) headers.set(name, value);
  let body: string | undefined;
  if (config.body?.kind === 'json') {
    body = JSON.stringify(config.body.value);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  } else if (config.body?.kind === 'text') {
    body = config.body.text;
    if (!headers.has('content-type')) headers.set('content-type', config.body.contentType);
  }
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  const safe = safeToRepeat(config);
  const failure = (
    code: string,
    message: string,
    category: ExecutionError['category'],
    retryDisposition: NonNullable<ExecutionError['retryDisposition']>,
    details?: Json,
  ): Outcome => ({
    kind: 'failed',
    error: {
      code,
      category,
      message: redact(message, values),
      retryDisposition,
      ...(details === undefined ? {} : { details }),
    },
  });
  submit();
  let response: Response;
  try {
    response = await fetchImpl(config.url, {
      method: config.method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: config.followRedirects ? 'follow' : 'manual',
      signal: combined,
    });
  } catch (error) {
    if (signal.aborted) return { kind: 'stopped' };
    const code = causeCode(error);
    if (code && notSent.has(code))
      return failure(
        'HTTP_UNREACHABLE',
        `The request could not be sent (${code}).`,
        'external',
        'safe',
        { code },
      );
    const reason = timeout.aborted ? 'timed out' : `failed${code ? ` (${code})` : ''}`;
    if (safe)
      return failure('HTTP_REQUEST_FAILED', `The request ${reason}.`, 'external', 'safe', {
        ...(code ? { code } : {}),
      });
    return {
      kind: 'uncertain',
      explanation: `The ${config.method} request ${reason} after it was sent, so whether the server acted on it is unknown.`,
      evidence: { ...(code ? { code } : {}), timedOut: timeout.aborted },
    };
  }
  let read: { bytes: Buffer; tooLarge: boolean };
  try {
    read = await readCapped(response, config.maxResponseBytes);
  } catch {
    if (signal.aborted) return { kind: 'stopped' };
    // The server answered, so its outcome is known even though the body was cut off.
    return failure(
      'HTTP_RESPONSE_INCOMPLETE',
      `The response (status ${response.status}) ended before its body was read.`,
      'external',
      safe ? 'safe' : 'never',
      { status: response.status },
    );
  }
  const responseHeaders: Record<string, string> = {};
  let count = 0;
  for (const [name, value] of response.headers) {
    if (count++ >= 100) break;
    responseHeaders[name] = redact(value.slice(0, 8192), values);
  }
  if (read.tooLarge)
    return failure(
      'HTTP_RESPONSE_TOO_LARGE',
      `The response body is larger than ${config.maxResponseBytes} bytes.`,
      'external',
      'never',
      { status: response.status, headers: responseHeaders },
    );
  const text = redact(read.bytes.toString('utf8'), values);
  const type = response.headers.get('content-type') ?? '';
  let parsed: Json = text;
  if (/^application\/([\w.+-]+\+)?json\b/i.test(type) && text.trim() !== '') {
    try {
      parsed = JSON.parse(text) as Json;
    } catch {
      return failure(
        'HTTP_RESPONSE_INVALID',
        'The response says it is JSON but does not parse.',
        'contract',
        'never',
        { status: response.status, headers: responseHeaders, body: text.slice(0, 64 * 1024) },
      );
    }
  }
  const data = {
    status: response.status,
    headers: responseHeaders,
    body: parsed,
    bodyBytes: read.bytes.length,
  };
  if (response.status < 200 || response.status >= 300) {
    const retryable = response.status === 429 || response.status >= 500;
    return failure(
      'HTTP_STATUS',
      `The server answered ${response.status}.`,
      'external',
      retryable && safe ? 'safe' : 'never',
      data,
    );
  }
  if (config.responseSchema !== null) {
    const problem = checkValue(config.responseSchema, parsed, 'response');
    if (problem)
      return failure(
        'HTTP_RESPONSE_INVALID',
        `The response body does not match the response schema: ${problem}`,
        'contract',
        'never',
        data,
      );
  }
  return { kind: 'succeeded', data };
}
