import type Database from 'better-sqlite3';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import type { Actor, CommandReceipts, CommandResponse } from '../persistence/receipts.js';
import type { SecretBox } from '../secrets/secret-box.js';

// Project credentials and action permissions (server specification sections 4.4, 8 and 13.1).
// A credential is a sealed secret a project owns. Workflows name it; its value is written once by
// the owner, read only by the action that injects it, and never returned, logged or stored in a
// snapshot, operation or receipt. Rotating it keeps its name and ID, so graphs need no edit.

export const actionPermissions = ['command', 'http', 'script', 'git', 'git_push'] as const;
export type ActionPermission = (typeof actionPermissions)[number];

// What a run may do, frozen at admission. Current revocations still restrict it (specification 8).
export interface Authority {
  denied: ActionPermission[];
  // Credential names to IDs, as they were when the run started.
  credentials: Record<string, string>;
}

export interface CredentialView {
  id: string;
  projectId: string;
  name: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export const credentialName = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const maxValueBytes = 16 * 1024;
const commandId = { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' };
const ajv = new Ajv2020({ strict: true, coerceTypes: false });
const validatePut = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['name', 'value'],
  properties: {
    name: { type: 'string', pattern: credentialName.source },
    value: { type: 'string', minLength: 1 },
    commandId,
  },
});
const validateRevoke = ajv.compile({
  type: 'object',
  additionalProperties: false,
  properties: { commandId },
});
const permission = { enum: [...actionPermissions] };
const validatePermissions = ajv.compile({
  type: 'object',
  additionalProperties: false,
  properties: {
    allow: { type: 'array', uniqueItems: true, items: permission },
    deny: { type: 'array', uniqueItems: true, items: permission },
    commandId,
  },
});

const invalid = (errors: { instancePath: string }[] | null | undefined, message: string) =>
  new ShiftError(
    'INVALID_REQUEST',
    message,
    422,
    false,
    (errors ?? []).map((error) => error.instancePath || '/'),
  );

interface Row {
  id: string;
  project_id: string;
  name: string;
  sealed: string;
  revision: number;
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
}

const view = (row: Row): CredentialView => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class Credentials {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
    private readonly secrets: SecretBox,
    private readonly receipts: CommandReceipts,
  ) {}

  #event(type: string, projectId: string, payload: Json): void {
    this.db
      .prepare(
        'INSERT INTO events (type, schema_version, payload_json, created_at) VALUES (?, 1, ?, ?)',
      )
      .run(type, JSON.stringify({ projectId, ...(payload as object) }), this.clock.now());
  }

  #project(projectId: string): { permissions_json: string } {
    const row = this.db
      .prepare('SELECT permissions_json FROM projects WHERE id = ? AND archived_at IS NULL')
      .get(projectId) as { permissions_json: string } | undefined;
    if (!row) throw new ShiftError('NOT_FOUND', 'Project not found.', 404);
    return row;
  }

  list(projectId: string): CredentialView[] {
    this.#project(projectId);
    return (
      this.db
        .prepare(
          'SELECT * FROM credentials WHERE project_id = ? AND revoked_at IS NULL ORDER BY name',
        )
        .all(projectId) as Row[]
    ).map(view);
  }

  // Creates the named credential or replaces its value. The receipt holds a keyed digest of the
  // value, never the value, so a repeated command is still told apart from a changed one.
  put(projectId: string, input: unknown, actor: Actor): CommandResponse {
    if (!validatePut(input)) throw invalid(validatePut.errors, 'Invalid credential.');
    const {
      name,
      value,
      commandId: id,
    } = input as {
      name: string;
      value: string;
      commandId?: string;
    };
    if (Buffer.byteLength(value) > maxValueBytes || value.includes('\0'))
      throw new ShiftError(
        'INVALID_REQUEST',
        `A credential value is at most ${maxValueBytes} bytes of text.`,
        422,
        false,
        ['/value'],
      );
    const request = {
      op: 'credential.put',
      projectId,
      name,
      digest: this.secrets.digest(value, `credential-request:${projectId}:${name}`),
    };
    return this.receipts.execute(actor, id, request, () => {
      this.#project(projectId);
      const now = this.clock.now();
      const existing = this.db
        .prepare(
          'SELECT * FROM credentials WHERE project_id = ? AND name = ? AND revoked_at IS NULL',
        )
        .get(projectId, name) as Row | undefined;
      const credentialId = existing?.id ?? randomUUID();
      const sealed = this.secrets.seal(value, `credential:${credentialId}`);
      if (existing) {
        this.db
          .prepare(
            'UPDATE credentials SET sealed = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
          )
          .run(sealed, now, credentialId);
      } else {
        this.db
          .prepare(
            'INSERT INTO credentials (id, project_id, name, sealed, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
          )
          .run(credentialId, projectId, name, sealed, now, now);
      }
      this.#event(existing ? 'credential.rotated' : 'credential.created', projectId, {
        credentialId,
        name,
      });
      return {
        status: existing ? 200 : 201,
        body: { credential: this.#get(credentialId) as unknown as Json },
      };
    });
  }

  revoke(projectId: string, credentialId: string, input: unknown, actor: Actor): CommandResponse {
    if (!validateRevoke(input)) throw invalid(validateRevoke.errors, 'Invalid request.');
    const { commandId: id } = input as { commandId?: string };
    return this.receipts.execute(
      actor,
      id,
      { op: 'credential.revoke', projectId, credentialId },
      () => {
        const row = this.db
          .prepare('SELECT * FROM credentials WHERE id = ? AND project_id = ?')
          .get(credentialId, projectId) as Row | undefined;
        if (!row) throw new ShiftError('NOT_FOUND', 'Credential not found.', 404);
        if (row.revoked_at === null) {
          const now = this.clock.now();
          // The sealed value goes with the revocation; nothing can use it again.
          this.db
            .prepare(
              "UPDATE credentials SET revoked_at = ?, sealed = '', revision = revision + 1, updated_at = ? WHERE id = ?",
            )
            .run(now, now, credentialId);
          this.#event('credential.revoked', projectId, { credentialId, name: row.name });
        }
        return { status: 200, body: { credential: this.#get(credentialId) as unknown as Json } };
      },
    );
  }

  #get(id: string): CredentialView {
    return view(this.db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as Row);
  }

  // The project's denied actions. Everything else is allowed: the owner authors the workflows.
  denied(projectId: string): ActionPermission[] {
    const parsed = JSON.parse(this.#project(projectId).permissions_json) as { denied?: unknown };
    return Array.isArray(parsed.denied)
      ? (parsed.denied.filter((item) =>
          (actionPermissions as readonly unknown[]).includes(item),
        ) as ActionPermission[])
      : [];
  }

  setPermissions(projectId: string, input: unknown, actor: Actor): CommandResponse {
    if (!validatePermissions(input)) throw invalid(validatePermissions.errors, 'Invalid request.');
    const {
      allow = [],
      deny = [],
      commandId: id,
    } = input as {
      allow?: ActionPermission[];
      deny?: ActionPermission[];
      commandId?: string;
    };
    if (allow.some((item) => deny.includes(item)))
      throw new ShiftError('INVALID_REQUEST', 'An action cannot be allowed and denied.', 422);
    return this.receipts.execute(
      actor,
      id,
      { op: 'project.permissions', projectId, allow, deny },
      () => {
        const denied = new Set(this.denied(projectId));
        for (const item of allow) denied.delete(item);
        for (const item of deny) denied.add(item);
        const next = actionPermissions.filter((item) => denied.has(item));
        this.db
          .prepare('UPDATE projects SET permissions_json = ?, revision = revision + 1 WHERE id = ?')
          .run(JSON.stringify({ denied: next }), projectId);
        this.#event('project.permissions_changed', projectId, { denied: next });
        return { status: 200, body: { permissions: { projectId, denied: next } } };
      },
    );
  }

  // The authority a run admitted now is given.
  authority(projectId: string): Authority {
    const credentials: Record<string, string> = {};
    for (const credential of this.list(projectId)) credentials[credential.name] = credential.id;
    return { denied: this.denied(projectId), credentials };
  }

  // Checks an action against the run's frozen authority and the project's current permissions.
  allowed(projectId: string, authority: Authority, action: ActionPermission): void {
    if (authority.denied.includes(action) || this.denied(projectId).includes(action))
      throw new ShiftError(
        'ACTION_NOT_PERMITTED',
        `This project does not permit ${action} actions.`,
        403,
      );
  }

  // The value of a credential the run was given, if it is still the project's and not revoked.
  value(projectId: string, authority: Authority, name: string): string {
    const id = authority.credentials[name];
    const row =
      id === undefined
        ? undefined
        : (this.db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as Row | undefined);
    if (!row || row.project_id !== projectId || row.revoked_at !== null)
      throw new ShiftError(
        'CREDENTIAL_UNAVAILABLE',
        `Credential ${name} is not available to this run. Add it to the project before the run starts.`,
        403,
      );
    return this.secrets.unseal(row.sealed, `credential:${row.id}`);
  }
}
