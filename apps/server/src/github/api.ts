import { createAppAuth } from '@octokit/auth-app';
import { request as octokitRequest } from '@octokit/request';
import { RequestError } from '@octokit/request-error';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';

// GitHub's REST API as the owner's App sees it (server specification section 12.3). The App
// authenticates with a JWT signed by its private key; repository work uses installation tokens,
// which expire after an hour. Tokens are requested for exactly the repository and permissions an
// action needs, kept only in this process's memory and refreshed before they expire. None of them
// is ever written to the database, a snapshot, an operation, an event or a log.

export type PermissionLevel = 'read' | 'write' | 'admin';
export type Permissions = Record<string, PermissionLevel>;

export interface AppKeys {
  // The App row's ID and revision: a rotated key never reuses a token minted with the old one.
  rowId: string;
  revision: number;
  appId: number;
  privateKey: string;
  host: string;
}

export interface Token {
  token: string;
  expiresAt: number;
  permissions: Permissions;
}

export interface GitHubApiOptions {
  clock: Clock;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

// Tokens with less than this left are replaced, so one never expires in the middle of an action.
const refreshMarginMs = 10 * 60 * 1000;

// The web origin GitHub is reached at: github.com, a GitHub Enterprise Server, or (for tests
// only) a loopback HTTP server.
export function normalizeHost(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ShiftError('INVALID_GITHUB_HOST', 'The GitHub host is not a URL.', 422);
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new ShiftError('INVALID_GITHUB_HOST', 'The GitHub host must use HTTPS.', 422);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new ShiftError('INVALID_GITHUB_HOST', 'The GitHub host is only an origin.', 422);
  return url.origin;
}

export function apiBase(host: string): string {
  return host === 'https://github.com' ? 'https://api.github.com' : `${host}/api/v3`;
}

export const levels: Record<PermissionLevel, number> = { read: 1, write: 2, admin: 3 };

// The permissions `required` asks for that `granted` lacks.
export function missingPermissions(granted: Permissions, required: Permissions): Permissions {
  const missing: Permissions = {};
  for (const [name, level] of Object.entries(required))
    if ((levels[granted[name] as PermissionLevel] ?? 0) < levels[level]) missing[name] = level;
  return missing;
}

// A GitHub API failure as a structured error. `sent` says whether GitHub may have acted on it:
// without a response, a write's outcome is unknown.
export class GitHubError extends ShiftError {
  constructor(
    code: string,
    message: string,
    status: number,
    readonly providerStatus: number | null,
    readonly sent: boolean,
    readonly details: Record<string, Json> = {},
  ) {
    super(code, message, status, providerStatus === null || providerStatus >= 500);
    this.name = 'GitHubError';
  }
}

const codes: Record<number, string> = {
  401: 'GITHUB_AUTH_FAILED',
  403: 'GITHUB_FORBIDDEN',
  404: 'GITHUB_NOT_FOUND',
  405: 'GITHUB_NOT_ALLOWED',
  409: 'GITHUB_CONFLICT',
  422: 'GITHUB_REJECTED',
};

export function toGitHubError(error: unknown, what: string): GitHubError {
  if (error instanceof GitHubError) return error;
  if (error instanceof RequestError && error.status > 0 && error.response) {
    const data = error.response.data as
      { message?: unknown; errors?: unknown; documentation_url?: unknown } | undefined;
    const provider = typeof data?.message === 'string' ? data.message.slice(0, 500) : '';
    const reasons = Array.isArray(data?.errors)
      ? data.errors
          .map((item) =>
            typeof item === 'string'
              ? item
              : typeof (item as { message?: unknown }).message === 'string'
                ? ((item as { message: string }).message as string)
                : '',
          )
          .filter(Boolean)
          .slice(0, 5)
          .map((item) => item.slice(0, 300))
      : [];
    const code =
      codes[error.status] ?? (error.status >= 500 ? 'GITHUB_UNAVAILABLE' : 'GITHUB_REQUEST_FAILED');
    const message = `${what} failed: GitHub answered ${error.status}${provider ? ` (${provider})` : ''}${reasons.length ? `: ${reasons.join('; ')}` : ''}.`;
    return new GitHubError(code, message, 502, error.status, true, {
      providerStatus: error.status,
      providerMessage: provider,
      ...(reasons.length ? { reasons } : {}),
    });
  }
  // No response: the request may or may not have reached GitHub.
  return new GitHubError(
    'GITHUB_UNREACHABLE',
    `${what} failed: GitHub could not be reached.`,
    502,
    null,
    true,
  );
}

type Request = typeof octokitRequest;

export class GitHubApi {
  readonly #options: GitHubApiOptions;
  readonly #tokens = new Map<string, Token>();
  readonly #pending = new Map<string, Promise<Token>>();

  constructor(options: GitHubApiOptions) {
    this.#options = options;
  }

  #request(host: string, signal?: AbortSignal): Request {
    const timeout = AbortSignal.timeout(this.#options.timeoutMs ?? 30_000);
    return octokitRequest.defaults({
      baseUrl: apiBase(host),
      headers: { 'user-agent': 'shift-server', 'x-github-api-version': '2022-11-28' },
      request: {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        ...(this.#options.fetch ? { fetch: this.#options.fetch } : {}),
      },
    });
  }

  #auth(keys: AppKeys, signal?: AbortSignal) {
    return createAppAuth({
      appId: keys.appId,
      privateKey: keys.privateKey,
      request: this.#request(keys.host, signal),
    });
  }

  // A request authenticated as the App itself, for App and installation metadata.
  async asApp<T>(
    keys: AppKeys,
    route: string,
    parameters: Record<string, unknown> = {},
    what = 'The GitHub request',
  ): Promise<T> {
    try {
      const { token } = await this.#auth(keys)({ type: 'app' });
      const response = await this.#request(keys.host)(route, {
        ...parameters,
        headers: { authorization: `bearer ${token}` },
      });
      return response.data as T;
    } catch (error) {
      throw toGitHubError(error, what);
    }
  }

  // An installation token for these repositories and permissions, minted when none is cached or
  // the cached one is close to expiring. Concurrent callers share one request.
  async token(
    keys: AppKeys,
    installationId: number,
    scope: { repositoryIds?: number[]; permissions?: Permissions } = {},
  ): Promise<Token> {
    const key = JSON.stringify([
      keys.rowId,
      keys.revision,
      installationId,
      [...(scope.repositoryIds ?? [])].sort((a, b) => a - b),
      Object.entries(scope.permissions ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    const cached = this.#tokens.get(key);
    if (cached && cached.expiresAt - this.#options.clock.now() > refreshMarginMs) return cached;
    const pending = this.#pending.get(key);
    if (pending) return pending;
    const minted = (async () => {
      try {
        const result = await this.#auth(keys)({
          type: 'installation',
          installationId,
          refresh: true,
          ...(scope.repositoryIds ? { repositoryIds: scope.repositoryIds } : {}),
          ...(scope.permissions ? { permissions: scope.permissions } : {}),
        });
        const token: Token = {
          token: result.token,
          expiresAt: Date.parse(result.expiresAt),
          permissions: result.permissions as Permissions,
        };
        this.#tokens.set(key, token);
        return token;
      } catch (error) {
        throw toGitHubError(error, 'Getting an installation token');
      } finally {
        this.#pending.delete(key);
      }
    })();
    this.#pending.set(key, minted);
    return minted;
  }

  // Forgets every token minted with an App's keys, after a rotation or removal.
  forget(rowId: string): void {
    for (const key of this.#tokens.keys())
      if ((JSON.parse(key) as unknown[])[0] === rowId) this.#tokens.delete(key);
  }

  // A request authenticated as an installation.
  async asInstallation<T>(
    keys: AppKeys,
    installationId: number,
    scope: { repositoryIds?: number[]; permissions?: Permissions },
    route: string,
    parameters: Record<string, unknown> = {},
    what = 'The GitHub request',
    signal?: AbortSignal,
  ): Promise<T> {
    const { token } = await this.token(keys, installationId, scope);
    try {
      const response = await this.#request(keys.host, signal)(route, {
        ...parameters,
        headers: { authorization: `token ${token}` },
      });
      return response.data as T;
    } catch (error) {
      throw toGitHubError(error, what);
    }
  }
}
