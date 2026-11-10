import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, verify, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Clock } from '../src/domain/clock.js';

// A fake GitHub for tests: the App and installation endpoints, pull requests, checks and merges,
// and Git smart HTTP for its repositories. It checks what real GitHub checks that matters to
// Shift: App JWTs are verified against the App's public key, installation tokens expire on the
// test clock and grant only the repositories and permissions they were minted with, and Git over
// HTTP needs a live token. Every request is recorded for assertions.

export interface FakeRepository {
  id: number;
  owner: string;
  name: string;
  default_branch: string;
  private: boolean;
  // Bare repository served over smart HTTP, if any.
  path?: string;
}

export interface FakePull {
  id: number;
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  title: string;
  body: string | null;
  head: string;
  headSha: string;
  base: string;
  merge_commit_sha: string | null;
}

export interface FakeCheckRun {
  id: number;
  name: string;
  head_sha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  app?: { slug: string };
}

export interface FakeStatus {
  context: string;
  state: 'pending' | 'success' | 'failure' | 'error';
  sha: string;
}

interface TokenGrant {
  installationId: number;
  expiresAt: number;
  repositoryIds: number[] | null;
  permissions: Record<string, string>;
}

export interface Recorded {
  method: string;
  path: string;
  auth: 'jwt' | 'token' | 'basic' | 'none';
  body?: unknown;
}

const levels: Record<string, number> = { read: 1, write: 2, admin: 3 };

export class FakeGitHub {
  readonly appId = 4242;
  privateKey: string;
  #publicKey: KeyObject;
  installations = [
    {
      id: 501,
      account: { login: 'acme', type: 'Organization' },
      permissions: {
        metadata: 'read',
        contents: 'write',
        pull_requests: 'write',
        checks: 'read',
        statuses: 'read',
      } as Record<string, string>,
      repositoryIds: [9001],
      suspended_at: null as string | null,
    },
  ];
  repositories = new Map<number, FakeRepository>([
    [9001, { id: 9001, owner: 'acme', name: 'widgets', default_branch: 'main', private: true }],
    [9002, { id: 9002, owner: 'acme', name: 'secret', default_branch: 'main', private: true }],
  ]);
  pulls = new Map<number, FakePull[]>();
  checkRuns: FakeCheckRun[] = [];
  statuses: FakeStatus[] = [];
  readonly tokens = new Map<string, TokenGrant>();
  readonly requests: Recorded[] = [];
  // Test hooks: answer a route with an error, or perform it and then drop the connection.
  fail: Array<{ match: RegExp; status: number; message: string; times?: number }> = [];
  dropAfter: RegExp[] = [];
  // Perform the route, then answer with a server error, as GitHub sometimes does.
  failAfter: Array<{ match: RegExp; status: number }> = [];
  // Called before a merge is performed; may throw to refuse it as GitHub's protections would.
  mergeRule:
    | ((
        pull: FakePull,
        body: Record<string, unknown>,
      ) => { status: number; message: string } | null)
    | null = null;
  #server: Server | null = null;
  #nextPull = 1;
  origin = '';

  constructor(
    readonly clock: Clock,
    keys?: { privateKey: string; publicKey: KeyObject },
  ) {
    if (keys) {
      this.privateKey = keys.privateKey;
      this.#publicKey = keys.publicKey;
    } else {
      const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
      this.privateKey = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
      this.#publicKey = pair.publicKey;
    }
  }

  // A key the owner generated on GitHub: the old one stops working.
  useKey(keys: { privateKey: string; publicKey: KeyObject }): void {
    this.privateKey = keys.privateKey;
    this.#publicKey = keys.publicKey;
  }

  static keyPair(): { privateKey: string; publicKey: KeyObject } {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
      privateKey: pair.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string,
      publicKey: pair.publicKey,
    };
  }

  async start(): Promise<string> {
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch((error: unknown) => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: String(error) }));
      });
    });
    await new Promise<void>((done) => this.#server!.listen(0, '127.0.0.1', done));
    this.origin = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
    return this.origin;
  }

  async stop(): Promise<void> {
    this.#server?.closeAllConnections();
    await new Promise<void>((done) => this.#server?.close(() => done()) ?? done());
  }

  pullsOf(repositoryId: number): FakePull[] {
    let list = this.pulls.get(repositoryId);
    if (!list) this.pulls.set(repositoryId, (list = []));
    return list;
  }

  addPull(
    repositoryId: number,
    pull: Partial<FakePull> & { head: string; headSha: string },
  ): FakePull {
    const number = this.#nextPull++;
    const created: FakePull = {
      id: 100000 + number,
      number,
      state: 'open',
      merged: false,
      draft: false,
      title: `PR ${number}`,
      body: null,
      base: 'main',
      merge_commit_sha: null,
      ...pull,
    };
    this.pullsOf(repositoryId).push(created);
    return created;
  }

  #jwt(header: string | undefined): boolean {
    const token = /^bearer (.+)$/i.exec(header ?? '')?.[1];
    if (!token) return false;
    const [head, payload, signature] = token.split('.');
    if (!head || !payload || !signature) return false;
    const valid = verify(
      'RSA-SHA256',
      Buffer.from(`${head}.${payload}`),
      this.#publicKey,
      Buffer.from(signature, 'base64url'),
    );
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { iss: unknown };
    return valid && String(claims.iss) === String(this.appId);
  }

  #grant(header: string | undefined): TokenGrant | null {
    const token = /^token (.+)$/i.exec(header ?? '')?.[1];
    const grant = token ? this.tokens.get(token) : undefined;
    if (!grant || grant.expiresAt <= this.clock.now()) return null;
    return grant;
  }

  #allows(grant: TokenGrant, repositoryId: number, permission: string, level: string): boolean {
    const installation = this.installations.find((item) => item.id === grant.installationId);
    if (!installation?.repositoryIds.includes(repositoryId)) return false;
    if (grant.repositoryIds && !grant.repositoryIds.includes(repositoryId)) return false;
    return (levels[grant.permissions[permission] ?? ''] ?? 0) >= (levels[level] ?? 9);
  }

  #pull(repo: FakeRepository, pull: FakePull) {
    return {
      id: pull.id,
      number: pull.number,
      html_url: `${this.origin}/${repo.owner}/${repo.name}/pull/${pull.number}`,
      state: pull.state,
      merged: pull.merged,
      merged_at: pull.merged ? '2026-01-01T00:00:00Z' : null,
      draft: pull.draft,
      title: pull.title,
      body: pull.body,
      merge_commit_sha: pull.merge_commit_sha,
      mergeable: true,
      head: { ref: pull.head, sha: pull.headSha, repo: { id: repo.id } },
      base: { ref: pull.base, sha: 'b'.repeat(40), repo: { id: repo.id } },
    };
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.origin);
    const path = url.pathname;
    const authorization = req.headers['authorization'];
    const auth: Recorded['auth'] = !authorization
      ? 'none'
      : /^bearer /i.test(authorization)
        ? 'jwt'
        : /^token /i.test(authorization)
          ? 'token'
          : 'basic';
    if (!path.startsWith('/api/v3/')) {
      this.requests.push({ method: req.method ?? '', path, auth });
      return this.#git(req, res, url);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const route = `${req.method} ${path.slice('/api/v3'.length)}`;
    this.requests.push({ method: req.method ?? '', path: route, auth, ...(text ? { body } : {}) });
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    const failure = this.fail.find((item) => item.match.test(route));
    if (failure) {
      if (failure.times !== undefined && --failure.times <= 0)
        this.fail.splice(this.fail.indexOf(failure), 1);
      return send(failure.status, { message: failure.message });
    }
    const drop = this.dropAfter.findIndex((pattern) => pattern.test(route));
    const late = this.failAfter.findIndex((item) => item.match.test(route));
    const reply = (status: number, data: unknown) => {
      if (late >= 0) {
        const failed = this.failAfter.splice(late, 1)[0]!.status;
        return send(failed, { message: 'Server Error' });
      }
      if (drop >= 0) {
        // The request took effect; its response is lost on the way back.
        this.dropAfter.splice(drop, 1);
        req.socket.destroy();
        return;
      }
      send(status, data);
    };
    let match: RegExpExecArray | null;
    // ---- App endpoints, authenticated with the App's JWT. ----
    if (route.startsWith('GET /app') || route.startsWith('POST /app/')) {
      if (!this.#jwt(authorization))
        return send(401, { message: 'A JSON web token could not be decoded' });
      if (route === 'GET /app')
        return send(200, { id: this.appId, slug: 'shift-test', name: 'Shift Test' });
      if (route === 'GET /app/installations') {
        const page = Number(url.searchParams.get('page') ?? '1');
        const perPage = Number(url.searchParams.get('per_page') ?? '30');
        return send(
          200,
          this.installations.slice((page - 1) * perPage, page * perPage).map((item) => ({
            id: item.id,
            account: item.account,
            permissions: item.permissions,
            suspended_at: item.suspended_at,
          })),
        );
      }
      if ((match = /^POST \/app\/installations\/(\d+)\/access_tokens$/.exec(route))) {
        const installation = this.installations.find((item) => item.id === Number(match![1]));
        if (!installation) return send(404, { message: 'Not Found' });
        const requested =
          (body['permissions'] as Record<string, string> | undefined) ?? installation.permissions;
        for (const [name, level] of Object.entries(requested))
          if ((levels[installation.permissions[name] ?? ''] ?? 0) < (levels[level] ?? 9))
            return send(422, {
              message: `The permissions requested are not granted to this installation.`,
            });
        const repositoryIds = (body['repository_ids'] as number[] | undefined) ?? null;
        if (repositoryIds?.some((id) => !installation.repositoryIds.includes(id)))
          return send(422, {
            message:
              'There is at least one repository that does not exist or is not accessible to the parent installation.',
          });
        const token = `ghs_${randomBytes(18).toString('hex')}`;
        const expiresAt = this.clock.now() + 60 * 60 * 1000;
        this.tokens.set(token, {
          installationId: installation.id,
          expiresAt,
          repositoryIds,
          permissions: requested,
        });
        return send(201, {
          token,
          expires_at: new Date(expiresAt).toISOString(),
          permissions: requested,
          repository_selection: 'selected',
        });
      }
      return send(404, { message: 'Not Found' });
    }
    // ---- Installation endpoints, authenticated with an installation token. ----
    const grant = this.#grant(authorization);
    if (!grant) return send(401, { message: 'Bad credentials' });
    if (route.startsWith('GET /installation/repositories')) {
      const installation = this.installations.find((item) => item.id === grant.installationId)!;
      const ids = installation.repositoryIds.filter(
        (id) => !grant.repositoryIds || grant.repositoryIds.includes(id),
      );
      return send(200, {
        total_count: ids.length,
        repositories: ids.map((id) => this.#repository(this.repositories.get(id)!)),
      });
    }
    if ((match = /^GET \/repositories\/(\d+)$/.exec(route))) {
      const repo = this.repositories.get(Number(match[1]));
      if (!repo || !this.#allows(grant, repo.id, 'metadata', 'read'))
        return send(404, { message: 'Not Found' });
      return send(200, this.#repository(repo));
    }
    match = /^(GET|POST|PATCH|PUT) \/repos\/([^/]+)\/([^/]+)\/(.+)$/.exec(route);
    const repo = match
      ? [...this.repositories.values()].find(
          (item) => item.owner === match![2] && item.name === match![3],
        )
      : undefined;
    if (!match || !repo || !this.#allows(grant, repo.id, 'metadata', 'read'))
      return send(404, { message: 'Not Found' });
    const [, method, , , rest] = match;
    const need = (permission: string, level: string) =>
      this.#allows(grant, repo.id, permission, level);
    const forbidden = () => send(403, { message: 'Resource not accessible by integration' });
    const pulls = this.pullsOf(repo.id);
    if (method === 'GET' && rest === 'pulls') {
      if (!need('pull_requests', 'read')) return forbidden();
      const head = url.searchParams.get('head');
      const state = url.searchParams.get('state') ?? 'open';
      const page = Number(url.searchParams.get('page') ?? '1');
      const perPage = Number(url.searchParams.get('per_page') ?? '30');
      const found = pulls.filter(
        (pull) =>
          (!head || `${repo.owner}:${pull.head}` === head) &&
          (state === 'all' || pull.state === state),
      );
      return send(
        200,
        found.slice((page - 1) * perPage, page * perPage).map((pull) => this.#pull(repo, pull)),
      );
    }
    if (method === 'POST' && rest === 'pulls') {
      if (!need('pull_requests', 'write')) return forbidden();
      const head = String(body['head']);
      const base = String(body['base']);
      if (pulls.some((pull) => pull.state === 'open' && pull.head === head && pull.base === base))
        return send(422, {
          message: 'Validation Failed',
          errors: [{ message: `A pull request already exists for ${repo.owner}:${head}.` }],
        });
      const headSha = this.#branchSha(repo, head);
      if (headSha === null)
        return send(422, {
          message: 'Validation Failed',
          errors: [{ field: 'head', code: 'invalid' }],
        });
      const pull = this.addPull(repo.id, {
        head,
        headSha,
        base,
        title: String(body['title']),
        body: (body['body'] as string | undefined) ?? null,
        draft: body['draft'] === true,
      });
      return reply(201, this.#pull(repo, pull));
    }
    if ((match = /^pulls\/(\d+)$/.exec(rest!))) {
      const pull = pulls.find((item) => item.number === Number(match![1]));
      if (!pull) return send(404, { message: 'Not Found' });
      if (method === 'GET') {
        if (!need('pull_requests', 'read')) return forbidden();
        return send(200, this.#pull(repo, pull));
      }
      if (method === 'PATCH') {
        if (!need('pull_requests', 'write')) return forbidden();
        for (const field of ['title', 'body', 'base', 'state'] as const)
          if (body[field] !== undefined)
            (pull as unknown as Record<string, unknown>)[field] = body[field];
        return reply(200, this.#pull(repo, pull));
      }
    }
    if ((match = /^pulls\/(\d+)\/merge$/.exec(rest!)) && method === 'PUT') {
      if (!need('contents', 'write')) return forbidden();
      const pull = pulls.find((item) => item.number === Number(match![1]));
      if (!pull) return send(404, { message: 'Not Found' });
      if (pull.merged || pull.state !== 'open')
        return send(405, { message: 'Pull Request is not mergeable' });
      if (body['sha'] !== undefined && body['sha'] !== pull.headSha)
        return send(409, { message: 'Head branch was modified. Review and try the merge again.' });
      const refused = this.mergeRule?.(pull, body);
      if (refused) return send(refused.status, { message: refused.message });
      pull.merged = true;
      pull.state = 'closed';
      pull.merge_commit_sha = randomBytes(20).toString('hex');
      return reply(200, {
        sha: pull.merge_commit_sha,
        merged: true,
        message: 'Pull Request successfully merged',
      });
    }
    if ((match = /^commits\/([^/]+)\/check-runs$/.exec(rest!)) && method === 'GET') {
      if (!need('checks', 'read')) return forbidden();
      const runs = this.checkRuns.filter((item) => item.head_sha === match![1]);
      return send(200, { total_count: runs.length, check_runs: runs });
    }
    if ((match = /^commits\/([^/]+)\/status$/.exec(rest!)) && method === 'GET') {
      if (!need('statuses', 'read')) return forbidden();
      const statuses = this.statuses.filter((item) => item.sha === match![1]);
      return send(200, { sha: match[1], total_count: statuses.length, statuses });
    }
    return send(404, { message: 'Not Found' });
  }

  #repository(repo: FakeRepository) {
    return {
      id: repo.id,
      name: repo.name,
      full_name: `${repo.owner}/${repo.name}`,
      owner: { login: repo.owner },
      default_branch: repo.default_branch,
      private: repo.private,
    };
  }

  #branchSha(repo: FakeRepository, branch: string): string | null {
    if (!repo.path) return 'f'.repeat(40);
    try {
      return execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
        cwd: repo.path,
        encoding: 'utf8',
      }).trim();
    } catch {
      return null;
    }
  }

  // Git smart HTTP through `git http-backend`, behind HTTP Basic authentication with a token.
  async #git(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const match = /^\/([^/]+)\/([^/]+)\.git(\/.*)$/.exec(url.pathname);
    const repo = match
      ? [...this.repositories.values()].find(
          (item) => item.owner === match[1] && item.name === match[2],
        )
      : undefined;
    if (!match || !repo?.path) {
      res.writeHead(404).end();
      return;
    }
    const writing =
      url.searchParams.get('service') === 'git-receive-pack' || match[3] === '/git-receive-pack';
    const basic = /^basic (.+)$/i.exec(req.headers['authorization'] ?? '')?.[1];
    const password = basic
      ? Buffer.from(basic, 'base64').toString().split(':').slice(1).join(':')
      : '';
    const grant = this.#grant(`token ${password}`);
    if (!grant || !this.#allows(grant, repo.id, 'contents', writing ? 'write' : 'read')) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="GitHub"' }).end();
      return;
    }
    const root = repo.path.slice(0, -`/${repo.owner}/${repo.name}.git`.length);
    const child = spawn('git', ['http-backend'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: `/${repo.owner}/${repo.name}.git${match[3]}`,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method ?? 'GET',
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
        HTTP_GIT_PROTOCOL: (req.headers['git-protocol'] as string | undefined) ?? '',
        REMOTE_USER: 'x-access-token',
        REMOTE_ADDR: '127.0.0.1',
      },
    });
    req.pipe(child.stdin);
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    await new Promise((done) => child.on('close', done));
    const output = Buffer.concat(chunks);
    const split = output.indexOf('\r\n\r\n');
    const headerText = output.subarray(0, split).toString();
    let status = 200;
    const headers: Record<string, string> = {};
    for (const line of headerText.split('\r\n')) {
      const index = line.indexOf(':');
      const name = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0]);
      else headers[name] = value;
    }
    res.writeHead(status, headers);
    res.end(output.subarray(split + 4));
  }
}
