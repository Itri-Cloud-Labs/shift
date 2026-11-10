import type Database from 'better-sqlite3';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createPrivateKey, randomUUID } from 'node:crypto';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import type { Actor, CommandReceipts, CommandResponse } from '../persistence/receipts.js';
import type { SecretBox } from '../secrets/secret-box.js';
import {
  GitHubError,
  missingPermissions,
  normalizeHost,
  type AppKeys,
  type GitHubApi,
  type Permissions,
} from './api.js';
import { nodePermissions } from './permissions.js';

// The owner's GitHub App, its installations and project bindings (server specification sections
// 4.4 and 12.3). The App is registered once on this server and can serve several projects; each
// project binds one repository by its numeric ID through one of the App's installations. Secret
// inputs answer with configured or missing, never with what was stored.

export interface Repository {
  id: number;
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
}

export interface InstallationView {
  id: string;
  installationId: number;
  account: string;
  accountType: string;
  state: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  permissions: Permissions;
  repositories: Repository[];
  verifiedAt: number;
}

export interface AppView {
  id: string;
  appId: number;
  host: string;
  slug: string | null;
  name: string | null;
  privateKey: 'configured';
  webhookSecret: 'configured' | 'missing';
  // App-scoped: every project bound through this App shares it.
  webhookPath: string;
  verifiedAt: number | null;
  revision: number;
  installations: InstallationView[];
}

export interface ConnectionView {
  id: string;
  projectId: string;
  appId: string;
  installationId: string;
  repository: { id: number; owner: string; name: string; defaultBranch: string };
  verifiedAt: number | null;
  revision: number;
  // What each GitHub node needs that the installation does not grant.
  diagnostics: Array<{ node: string; missing: Permissions }>;
}

// What an action needs to act on a project's repository.
export interface Binding {
  connectionId: string;
  keys: AppKeys;
  installationId: number;
  repositoryId: number;
  owner: string;
  name: string;
  permissions: Permissions;
}

const commandId = { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' };
const ajv = new Ajv2020({ strict: true, coerceTypes: false });
const privateKey = { type: 'string', minLength: 100, maxLength: 16384 };
const webhookSecret = { type: 'string', minLength: 16, maxLength: 256 };
const validateRegister = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['appId', 'privateKey'],
  properties: {
    appId: { type: 'integer', minimum: 1 },
    host: { type: 'string', minLength: 1, maxLength: 200 },
    privateKey,
    webhookSecret,
    commandId,
  },
});
const validateRotate = ajv.compile({
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: { privateKey, webhookSecret, commandId },
});
const validateConnect = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['installationId', 'repositoryId'],
  properties: {
    installationId: { type: 'string', minLength: 1, maxLength: 100 },
    repositoryId: { type: 'integer', minimum: 1 },
    commandId,
  },
});
const validateCommand = ajv.compile({
  type: 'object',
  additionalProperties: false,
  properties: { commandId },
});

const invalid = (errors: { instancePath: string }[] | null | undefined, message: string) =>
  new ShiftError(
    'INVALID_REQUEST',
    message,
    422,
    false,
    (errors ?? []).map((error) => error.instancePath || '/'),
  );

interface AppRow {
  id: string;
  app_id: number;
  github_host: string;
  slug: string | null;
  name: string | null;
  private_key_sealed: string;
  webhook_secret_sealed: string | null;
  verified_at: number | null;
  revision: number;
}

interface InstallationRow {
  id: string;
  github_app_id: string;
  installation_id: number;
  account_login: string;
  account_type: string;
  repositories_json: string;
  permissions_json: string;
  state: InstallationView['state'];
  verified_at: number;
}

interface ConnectionRow {
  id: string;
  project_id: string;
  installation_id: string;
  repository_id: number;
  repository_owner: string;
  repository_name: string;
  default_branch: string;
  verified_at: number | null;
  revision: number;
  removed_at: number | null;
}

function checkPrivateKey(pem: string): string {
  const trimmed = pem.trim();
  try {
    const key = createPrivateKey(trimmed);
    if (key.asymmetricKeyType !== 'rsa') throw new Error('not RSA');
  } catch {
    throw new ShiftError(
      'INVALID_PRIVATE_KEY',
      "The private key is not the App's PEM-encoded RSA key.",
      422,
      false,
      ['/privateKey'],
    );
  }
  return `${trimmed}\n`;
}

interface ApiApp {
  id: number;
  slug?: string;
  name?: string;
}
interface ApiInstallation {
  id: number;
  account: { login: string; type: string } | null;
  permissions: Permissions;
  suspended_at?: string | null;
}
interface ApiRepository {
  id: number;
  name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
}

const toRepository = (repository: ApiRepository): Repository => ({
  id: repository.id,
  owner: repository.owner.login,
  name: repository.name,
  defaultBranch: repository.default_branch,
  private: repository.private,
});

export class GitHubIntegration {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
    private readonly secrets: SecretBox,
    private readonly receipts: CommandReceipts,
    readonly api: GitHubApi,
  ) {}

  #event(type: string, payload: Record<string, Json>): void {
    this.db
      .prepare(
        'INSERT INTO events (type, schema_version, payload_json, created_at) VALUES (?, 1, ?, ?)',
      )
      .run(type, JSON.stringify(payload), this.clock.now());
  }

  #app(id: string): AppRow {
    const row = this.db.prepare('SELECT * FROM github_apps WHERE id = ?').get(id) as
      AppRow | undefined;
    if (!row) throw new ShiftError('NOT_FOUND', 'GitHub App not found.', 404);
    return row;
  }

  #keys(row: AppRow): AppKeys {
    return {
      rowId: row.id,
      revision: row.revision,
      appId: row.app_id,
      host: row.github_host,
      privateKey: this.secrets.unseal(row.private_key_sealed, `github-app-key:${row.id}`),
    };
  }

  #installations(appRowId: string): InstallationView[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM github_installations WHERE github_app_id = ? ORDER BY account_login, installation_id',
        )
        .all(appRowId) as InstallationRow[]
    ).map((row) => ({
      id: row.id,
      installationId: row.installation_id,
      account: row.account_login,
      accountType: row.account_type,
      state: row.state,
      permissions: JSON.parse(row.permissions_json) as Permissions,
      repositories: JSON.parse(row.repositories_json) as Repository[],
      verifiedAt: row.verified_at,
    }));
  }

  #view(row: AppRow): AppView {
    return {
      id: row.id,
      appId: row.app_id,
      host: row.github_host,
      slug: row.slug,
      name: row.name,
      privateKey: 'configured',
      webhookSecret: row.webhook_secret_sealed ? 'configured' : 'missing',
      webhookPath: `/api/v0/github/apps/${row.id}/webhook`,
      verifiedAt: row.verified_at,
      revision: row.revision,
      installations: this.#installations(row.id),
    };
  }

  apps(): AppView[] {
    return (this.db.prepare('SELECT * FROM github_apps ORDER BY created_at').all() as AppRow[]).map(
      (row) => this.#view(row),
    );
  }

  // The App's identity as GitHub reports it for these keys.
  async #verifyKeys(keys: AppKeys): Promise<ApiApp> {
    const app = await this.api.asApp<ApiApp>(keys, 'GET /app', {}, 'Verifying the App');
    if (app.id !== keys.appId)
      throw new ShiftError(
        'GITHUB_APP_MISMATCH',
        `The private key belongs to App ${app.id}, not App ${keys.appId}.`,
        422,
        false,
        ['/privateKey'],
      );
    return app;
  }

  // Reads the App's installations and the repositories each can reach.
  async #observeInstallations(
    keys: AppKeys,
  ): Promise<Array<{ installation: ApiInstallation; repositories: Repository[] }>> {
    const installations: ApiInstallation[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.api.asApp<ApiInstallation[]>(
        keys,
        'GET /app/installations',
        { per_page: 100, page },
        'Listing installations',
      );
      installations.push(...batch);
      if (batch.length < 100) break;
    }
    const observed = [];
    for (const installation of installations) {
      if (installation.suspended_at) {
        observed.push({ installation, repositories: [] });
        continue;
      }
      const repositories: Repository[] = [];
      for (let page = 1; page <= 10; page++) {
        const batch = await this.api.asInstallation<{ repositories: ApiRepository[] }>(
          keys,
          installation.id,
          { permissions: { metadata: 'read' } },
          'GET /installation/repositories',
          { per_page: 100, page },
          'Listing repositories',
        );
        repositories.push(...batch.repositories.map(toRepository));
        if (batch.repositories.length < 100) break;
      }
      observed.push({ installation, repositories });
    }
    return observed;
  }

  #storeInstallations(
    appRowId: string,
    observed: Array<{ installation: ApiInstallation; repositories: Repository[] }>,
  ): void {
    const now = this.clock.now();
    const seen = new Set<number>();
    for (const { installation, repositories } of observed) {
      seen.add(installation.id);
      const state = installation.suspended_at ? 'SUSPENDED' : 'ACTIVE';
      const existing = this.db
        .prepare(
          'SELECT id FROM github_installations WHERE github_app_id = ? AND installation_id = ?',
        )
        .get(appRowId, installation.id) as { id: string } | undefined;
      if (existing)
        this.db
          .prepare(
            'UPDATE github_installations SET account_login = ?, account_type = ?, repositories_json = ?, permissions_json = ?, state = ?, verified_at = ? WHERE id = ?',
          )
          .run(
            installation.account?.login ?? '',
            installation.account?.type ?? '',
            JSON.stringify(repositories),
            JSON.stringify(installation.permissions ?? {}),
            state,
            now,
            existing.id,
          );
      else
        this.db
          .prepare(
            'INSERT INTO github_installations (id, github_app_id, installation_id, account_login, account_type, repositories_json, permissions_json, state, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            randomUUID(),
            appRowId,
            installation.id,
            installation.account?.login ?? '',
            installation.account?.type ?? '',
            JSON.stringify(repositories),
            JSON.stringify(installation.permissions ?? {}),
            state,
            now,
          );
    }
    for (const row of this.db
      .prepare('SELECT id, installation_id FROM github_installations WHERE github_app_id = ?')
      .all(appRowId) as Array<{ id: string; installation_id: number }>)
      if (!seen.has(row.installation_id))
        this.db
          .prepare(
            "UPDATE github_installations SET state = 'REMOVED', repositories_json = '[]', verified_at = ? WHERE id = ?",
          )
          .run(now, row.id);
  }

  // Registers the owner's App after GitHub confirms its keys, with its installations.
  async register(input: unknown, actor: Actor): Promise<CommandResponse> {
    if (!validateRegister(input)) throw invalid(validateRegister.errors, 'Invalid GitHub App.');
    const body = input as {
      appId: number;
      host?: string;
      privateKey: string;
      webhookSecret?: string;
      commandId?: string;
    };
    const host = normalizeHost(body.host ?? 'https://github.com');
    const request = {
      op: 'github.app.register',
      appId: body.appId,
      host,
      privateKey: this.secrets.digest(body.privateKey, `github-request:${host}:${body.appId}`),
      webhookSecret:
        body.webhookSecret === undefined
          ? null
          : this.secrets.digest(body.webhookSecret, `github-request:${host}:${body.appId}`),
    };
    const stored = body.commandId ? this.receipts.lookup(actor, body.commandId, request) : null;
    if (stored) return stored;
    const pem = checkPrivateKey(body.privateKey);
    if (
      this.db
        .prepare('SELECT 1 FROM github_apps WHERE github_host = ? AND app_id = ?')
        .get(host, body.appId)
    )
      throw new ShiftError(
        'GITHUB_APP_EXISTS',
        'This App is already registered. Rotate its keys instead.',
        409,
      );
    const id = randomUUID();
    const keys: AppKeys = { rowId: id, revision: 0, appId: body.appId, host, privateKey: pem };
    const app = await this.#verifyKeys(keys);
    const observed = await this.#observeInstallations(keys);
    this.api.forget(id);
    return this.receipts.execute(actor, body.commandId, request, () => {
      if (
        this.db
          .prepare('SELECT 1 FROM github_apps WHERE github_host = ? AND app_id = ?')
          .get(host, body.appId)
      )
        throw new ShiftError('GITHUB_APP_EXISTS', 'This App is already registered.', 409);
      const now = this.clock.now();
      this.db
        .prepare(
          'INSERT INTO github_apps (id, app_id, github_host, slug, name, private_key_sealed, webhook_secret_sealed, verified_at, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
        )
        .run(
          id,
          body.appId,
          host,
          app.slug ?? null,
          app.name ?? null,
          this.secrets.seal(pem, `github-app-key:${id}`),
          body.webhookSecret === undefined
            ? null
            : this.secrets.seal(body.webhookSecret, `github-webhook:${id}`),
          now,
          now,
          now,
        );
      this.#storeInstallations(id, observed);
      this.#event('github.app.registered', { appId: id });
      return { status: 201, body: { app: this.#view(this.#app(id)) as unknown as Json } };
    });
  }

  // Replaces the private key or webhook secret. A new key is checked with GitHub before it is
  // stored; bindings and graphs keep working without edits.
  async rotate(appRowId: string, input: unknown, actor: Actor): Promise<CommandResponse> {
    if (!validateRotate(input)) throw invalid(validateRotate.errors, 'Invalid rotation.');
    const body = input as { privateKey?: string; webhookSecret?: string; commandId?: string };
    const request = {
      op: 'github.app.rotate',
      appRowId,
      privateKey:
        body.privateKey === undefined
          ? null
          : this.secrets.digest(body.privateKey, `github-request:${appRowId}`),
      webhookSecret:
        body.webhookSecret === undefined
          ? null
          : this.secrets.digest(body.webhookSecret, `github-request:${appRowId}`),
    };
    const stored = body.commandId ? this.receipts.lookup(actor, body.commandId, request) : null;
    if (stored) return stored;
    const row = this.#app(appRowId);
    let pem: string | undefined;
    if (body.privateKey !== undefined) {
      pem = checkPrivateKey(body.privateKey);
      await this.#verifyKeys({ ...this.#keys(row), revision: -1, privateKey: pem });
    }
    return this.receipts.execute(actor, body.commandId, request, () => {
      const current = this.#app(appRowId);
      if (current.revision !== row.revision)
        throw new ShiftError('REVISION_CONFLICT', 'The App changed during the rotation.', 409);
      const now = this.clock.now();
      this.db
        .prepare(
          'UPDATE github_apps SET private_key_sealed = ?, webhook_secret_sealed = ?, verified_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
        )
        .run(
          pem === undefined
            ? current.private_key_sealed
            : this.secrets.seal(pem, `github-app-key:${appRowId}`),
          body.webhookSecret === undefined
            ? current.webhook_secret_sealed
            : this.secrets.seal(body.webhookSecret, `github-webhook:${appRowId}`),
          pem === undefined ? current.verified_at : now,
          now,
          appRowId,
        );
      this.api.forget(appRowId);
      this.#event('github.app.rotated', {
        appId: appRowId,
        privateKey: pem !== undefined,
        webhookSecret: body.webhookSecret !== undefined,
      });
      return { status: 200, body: { app: this.#view(this.#app(appRowId)) as unknown as Json } };
    });
  }

  // Checks the App's keys again and refreshes its installations and their repositories.
  async refresh(appRowId: string): Promise<AppView> {
    const row = this.#app(appRowId);
    const keys = this.#keys(row);
    try {
      await this.#verifyKeys(keys);
    } catch (error) {
      if (error instanceof GitHubError && error.providerStatus === 401)
        this.db.prepare('UPDATE github_apps SET verified_at = NULL WHERE id = ?').run(appRowId);
      throw error;
    }
    const observed = await this.#observeInstallations(keys);
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE github_apps SET verified_at = ? WHERE id = ?')
        .run(this.clock.now(), appRowId);
      this.#storeInstallations(appRowId, observed);
    })();
    return this.#view(this.#app(appRowId));
  }

  // The webhook secret, for verifying deliveries (prompt 24).
  webhookSecret(appRowId: string): string | null {
    const row = this.#app(appRowId);
    return row.webhook_secret_sealed
      ? this.secrets.unseal(row.webhook_secret_sealed, `github-webhook:${appRowId}`)
      : null;
  }

  #connectionRow(projectId: string): ConnectionRow | undefined {
    return this.db
      .prepare('SELECT * FROM github_connections WHERE project_id = ? AND removed_at IS NULL')
      .get(projectId) as ConnectionRow | undefined;
  }

  #installationRow(id: string): InstallationRow {
    const row = this.db.prepare('SELECT * FROM github_installations WHERE id = ?').get(id) as
      InstallationRow | undefined;
    if (!row) throw new ShiftError('NOT_FOUND', 'GitHub installation not found.', 404);
    return row;
  }

  #connectionView(row: ConnectionRow): ConnectionView {
    const installation = this.#installationRow(row.installation_id);
    const granted = JSON.parse(installation.permissions_json) as Permissions;
    const diagnostics = Object.entries(nodePermissions)
      .map(([node, required]) => ({ node, missing: missingPermissions(granted, required) }))
      .filter((item) => Object.keys(item.missing).length > 0);
    return {
      id: row.id,
      projectId: row.project_id,
      appId: installation.github_app_id,
      installationId: row.installation_id,
      repository: {
        id: row.repository_id,
        owner: row.repository_owner,
        name: row.repository_name,
        defaultBranch: row.default_branch,
      },
      verifiedAt: installation.state === 'ACTIVE' ? row.verified_at : null,
      revision: row.revision,
      diagnostics,
    };
  }

  connection(projectId: string): ConnectionView | null {
    this.#project(projectId);
    const row = this.#connectionRow(projectId);
    return row ? this.#connectionView(row) : null;
  }

  #project(projectId: string): void {
    if (
      !this.db.prepare('SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL').get(projectId)
    )
      throw new ShiftError('NOT_FOUND', 'Project not found.', 404);
  }

  // Reads the repository through the installation, proving the installation can reach it now.
  async #observeRepository(
    installation: InstallationRow,
    repositoryId: number,
  ): Promise<Repository> {
    if (installation.state !== 'ACTIVE')
      throw new ShiftError(
        'GITHUB_INSTALLATION_INACTIVE',
        `The installation on ${installation.account_login} is ${installation.state.toLowerCase()}.`,
        422,
      );
    const keys = this.#keys(this.#app(installation.github_app_id));
    try {
      return toRepository(
        await this.api.asInstallation<ApiRepository>(
          keys,
          installation.installation_id,
          { repositoryIds: [repositoryId], permissions: { metadata: 'read' } },
          'GET /repositories/{repository_id}',
          { repository_id: repositoryId },
          'Reading the repository',
        ),
      );
    } catch (error) {
      if (error instanceof GitHubError && [403, 404, 422].includes(error.providerStatus ?? 0))
        throw new ShiftError(
          'GITHUB_REPOSITORY_UNAVAILABLE',
          `The installation on ${installation.account_login} cannot reach repository ${repositoryId}.`,
          422,
          false,
          ['/repositoryId'],
        );
      throw error;
    }
  }

  // Binds the project to a repository its App installation can reach, replacing any earlier one.
  async connect(projectId: string, input: unknown, actor: Actor): Promise<CommandResponse> {
    if (!validateConnect(input)) throw invalid(validateConnect.errors, 'Invalid connection.');
    const body = input as { installationId: string; repositoryId: number; commandId?: string };
    const request = {
      op: 'github.connect',
      projectId,
      installationId: body.installationId,
      repositoryId: body.repositoryId,
    };
    const stored = body.commandId ? this.receipts.lookup(actor, body.commandId, request) : null;
    if (stored) return stored;
    this.#project(projectId);
    const installation = this.#installationRow(body.installationId);
    const repository = await this.#observeRepository(installation, body.repositoryId);
    return this.receipts.execute(actor, body.commandId, request, () => {
      const now = this.clock.now();
      const existing = this.#connectionRow(projectId);
      if (existing)
        this.db
          .prepare(
            'UPDATE github_connections SET removed_at = ?, revision = revision + 1 WHERE id = ?',
          )
          .run(now, existing.id);
      const id = randomUUID();
      this.db
        .prepare(
          'INSERT INTO github_connections (id, project_id, installation_id, repository_id, repository_owner, repository_name, default_branch, verified_at, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
        )
        .run(
          id,
          projectId,
          installation.id,
          repository.id,
          repository.owner,
          repository.name,
          repository.defaultBranch,
          now,
          now,
        );
      this.#event('github.connected', { projectId, connectionId: id, repositoryId: repository.id });
      const view = this.#connectionView(this.#connectionRow(projectId)!);
      return { status: 201, body: { connection: view as unknown as Json } };
    });
  }

  disconnect(projectId: string, input: unknown, actor: Actor): CommandResponse {
    if (!validateCommand(input)) throw invalid(validateCommand.errors, 'Invalid request.');
    const { commandId: id } = input as { commandId?: string };
    return this.receipts.execute(actor, id, { op: 'github.disconnect', projectId }, () => {
      this.#project(projectId);
      const existing = this.#connectionRow(projectId);
      if (existing) {
        this.db
          .prepare(
            'UPDATE github_connections SET removed_at = ?, revision = revision + 1 WHERE id = ?',
          )
          .run(this.clock.now(), existing.id);
        this.#event('github.disconnected', { projectId, connectionId: existing.id });
      }
      return { status: 200, body: { connection: null } };
    });
  }

  // Checks the binding against GitHub now: the App's keys, the installation, the repository.
  async verify(projectId: string): Promise<ConnectionView> {
    this.#project(projectId);
    const row = this.#connectionRow(projectId);
    if (!row)
      throw new ShiftError('GITHUB_NOT_CONNECTED', 'The project has no GitHub repository.', 422);
    const installation = this.#installationRow(row.installation_id);
    await this.refresh(installation.github_app_id);
    let repository: Repository;
    try {
      repository = await this.#observeRepository(
        this.#installationRow(row.installation_id),
        row.repository_id,
      );
    } catch (error) {
      if (error instanceof ShiftError && error.status === 422)
        this.db
          .prepare('UPDATE github_connections SET verified_at = NULL WHERE id = ?')
          .run(row.id);
      throw error;
    }
    this.db
      .prepare(
        'UPDATE github_connections SET repository_owner = ?, repository_name = ?, default_branch = ?, verified_at = ? WHERE id = ?',
      )
      .run(repository.owner, repository.name, repository.defaultBranch, this.clock.now(), row.id);
    return this.#connectionView(this.#connectionRow(projectId)!);
  }

  // The verified connection a run was given, with what its action needs. Fails clearly when it is
  // missing, removed, unverified or lacks the permissions the action requires.
  binding(projectId: string, connectionId: string | null, required: Permissions): Binding {
    const row = connectionId
      ? (this.db
          .prepare('SELECT * FROM github_connections WHERE id = ? AND project_id = ?')
          .get(connectionId, projectId) as ConnectionRow | undefined)
      : undefined;
    if (!row || row.removed_at !== null)
      throw new ShiftError(
        'GITHUB_NOT_CONNECTED',
        connectionId
          ? 'The GitHub repository this run was started with is no longer connected to the project.'
          : 'The project had no GitHub repository connected when this run started.',
        422,
      );
    const installation = this.#installationRow(row.installation_id);
    const app = this.#app(installation.github_app_id);
    if (row.verified_at === null || installation.state !== 'ACTIVE' || app.verified_at === null)
      throw new ShiftError(
        'GITHUB_NOT_VERIFIED',
        `The GitHub connection to ${row.repository_owner}/${row.repository_name} is not verified. Verify it in Settings.`,
        422,
      );
    const granted = JSON.parse(installation.permissions_json) as Permissions;
    const missing = missingPermissions(granted, required);
    if (Object.keys(missing).length > 0)
      throw new ShiftError(
        'GITHUB_PERMISSION_MISSING',
        `The App's installation lacks ${Object.entries(missing)
          .map(([name, level]) => `${name}: ${level}`)
          .join(', ')}.`,
        403,
      );
    return {
      connectionId: row.id,
      keys: this.#keys(app),
      installationId: installation.installation_id,
      repositoryId: row.repository_id,
      owner: row.repository_owner,
      name: row.repository_name,
      permissions: required,
    };
  }

  // The connection a run admitted now is given, if there is one.
  current(projectId: string): string | null {
    return this.#connectionRow(projectId)?.id ?? null;
  }
}
