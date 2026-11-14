import type Database from 'better-sqlite3';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import { checkValue } from '../runs/envelope.js';
import type { SecretBox } from '../secrets/secret-box.js';
import type { Actor, CommandReceipts, CommandResponse } from '../persistence/receipts.js';
import type { DefinitionRepository } from '../workflows/repository.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { OccurrenceView, TriggerService } from './service.js';

// The inline trigger output limit (specification 12.1); the 2 MiB body limit is the route's.
export const maxInputBytes = 1024 * 1024;
// A signed request older or newer than this is refused, so a captured one cannot be replayed
// later. Callers that retry should send a new timestamp and signature with the same event ID.
export const signatureToleranceMs = 5 * 60_000;

export interface CredentialView {
  id: string;
  createdAt: number;
  // Until when it still works after a rotation replaced it; null while it is the current one.
  expiresAt: number | null;
  revokedAt: number | null;
  active: boolean;
}

interface CredentialRow {
  id: string;
  trigger_id: string;
  secret_sealed: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
}

interface WebhookConfig {
  auth: 'bearer' | 'signature';
  inputSchema?: Json;
}

const ajv = new Ajv2020({ strict: true, coerceTypes: false });
const commandId = { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' };
const validateIssue = ajv.compile({
  type: 'object',
  additionalProperties: false,
  properties: {
    previousMinutes: { type: 'integer', minimum: 0, maximum: 7 * 24 * 60 },
    commandId,
  },
});
const validateRevoke = ajv.compile({
  type: 'object',
  additionalProperties: false,
  properties: { commandId },
});
const invalid = (errors: Array<{ instancePath: string }> | null | undefined) =>
  new ShiftError(
    'INVALID_REQUEST',
    'Invalid request.',
    422,
    false,
    (errors ?? []).map((error) => error.instancePath || '/'),
  );

const header = (headers: IncomingHttpHeaders, name: string): string | null => {
  const value = headers[name];
  return typeof value === 'string' ? value : null;
};

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest();

// Authenticated HTTP triggers (specification 12.1 and 13). Each webhook trigger has its own
// random credentials, issued and rotated explicitly; the secret is shown once, when issued, and
// is otherwise only ever sealed. A request is authenticated, deduplicated by the caller's event
// ID and captured with the version active now before the caller hears back.
export class HttpTriggers {
  readonly #db: Database.Database;
  readonly #clock: Clock;
  readonly #secrets: SecretBox;
  readonly #triggers: TriggerService;
  readonly #definitions: DefinitionRepository;
  readonly #receipts: CommandReceipts;

  constructor(options: {
    receipts: CommandReceipts;
    db: Database.Database;
    clock: Clock;
    secrets: SecretBox;
    triggers: TriggerService;
    definitions: DefinitionRepository;
  }) {
    this.#db = options.db;
    this.#clock = options.clock;
    this.#secrets = options.secrets;
    this.#triggers = options.triggers;
    this.#definitions = options.definitions;
    this.#receipts = options.receipts;
  }

  // The owner's command to issue or rotate. Its receipt keeps the credential but never the
  // secret, so a repeated command answers with `secret: null`; rotate again if that answer was lost.
  issueCommand(triggerId: string, input: unknown, actor: Actor): CommandResponse {
    if (!validateIssue(input)) throw invalid(validateIssue.errors);
    const body = input as { previousMinutes?: number; commandId?: string };
    let secret: string | null = null;
    const response = this.#receipts.execute(
      actor,
      body.commandId,
      { op: 'trigger.credential.issue', triggerId, previousMinutes: body.previousMinutes ?? 0 },
      () => {
        const issued = this.issue(triggerId, body.previousMinutes ?? 0);
        secret = issued.secret;
        return {
          status: 201,
          body: { credential: issued.credential as unknown as Json, secret: null },
        };
      },
    );
    return secret === null || response.replayed
      ? response
      : { ...response, body: { ...(response.body as Record<string, Json>), secret } };
  }

  revokeCommand(triggerId: string, input: unknown, actor: Actor): CommandResponse {
    if (!validateRevoke(input)) throw invalid(validateRevoke.errors);
    const body = input as { commandId?: string };
    return this.#receipts.execute(
      actor,
      body.commandId,
      { op: 'trigger.credential.revoke', triggerId },
      () => ({
        status: 200,
        body: { credentials: this.revoke(triggerId) as unknown as Json },
      }),
    );
  }

  #webhook(triggerId: string) {
    const trigger = this.#triggers.trigger(triggerId);
    if (trigger.kind !== 'webhook') throw new ShiftError('NOT_FOUND', 'Trigger not found.', 404);
    return trigger;
  }

  #active(triggerId: string): CredentialRow[] {
    return this.#db
      .prepare(
        'SELECT * FROM trigger_credentials WHERE trigger_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at',
      )
      .all(triggerId, this.#clock.now()) as CredentialRow[];
  }

  #view(row: CredentialRow): CredentialView {
    const now = this.#clock.now();
    return {
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      active: row.revoked_at === null && (row.expires_at === null || row.expires_at > now),
    };
  }

  credentials(triggerId: string): CredentialView[] {
    this.#webhook(triggerId);
    return (
      this.#db
        .prepare('SELECT * FROM trigger_credentials WHERE trigger_id = ? ORDER BY created_at DESC')
        .all(triggerId) as CredentialRow[]
    ).map((row) => this.#view(row));
  }

  #event(type: string, payload: Record<string, Json>): void {
    this.#db
      .prepare(
        'INSERT INTO events (type, schema_version, payload_json, created_at) VALUES (?, 1, ?, ?)',
      )
      .run(type, JSON.stringify(payload), this.#clock.now());
  }

  // Issues a new credential and returns its secret, the only time it is shown. Credentials it
  // replaces stop now, or after `previousMinutes` while senders change over. This is not
  // idempotent on purpose: a receipt would have to keep the secret to replay it.
  issue(triggerId: string, previousMinutes = 0): { credential: CredentialView; secret: string } {
    this.#webhook(triggerId);
    const secret = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const now = this.#clock.now();
    this.#db
      .transaction(() => {
        // The credentials in use stop now, or after the window the owner gave for senders to
        // change over; one already ending sooner keeps its earlier end.
        if (previousMinutes > 0)
          this.#db
            .prepare(
              'UPDATE trigger_credentials SET expires_at = MIN(COALESCE(expires_at, ?), ?) WHERE trigger_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)',
            )
            .run(now + previousMinutes * 60_000, now + previousMinutes * 60_000, triggerId, now);
        else
          this.#db
            .prepare(
              'UPDATE trigger_credentials SET revoked_at = ? WHERE trigger_id = ? AND revoked_at IS NULL',
            )
            .run(now, triggerId);
        this.#db
          .prepare(
            'INSERT INTO trigger_credentials (id, trigger_id, secret_sealed, created_at) VALUES (?, ?, ?, ?)',
          )
          .run(id, triggerId, this.#secrets.seal(secret, `trigger-credential:${id}`), now);
        this.#event('trigger.credential_issued', { triggerId, credentialId: id, previousMinutes });
      })
      .immediate();
    const row = this.#db
      .prepare('SELECT * FROM trigger_credentials WHERE id = ?')
      .get(id) as CredentialRow;
    return { credential: this.#view(row), secret };
  }

  // Stops every credential of the trigger at once.
  revoke(triggerId: string): CredentialView[] {
    this.#webhook(triggerId);
    const now = this.#clock.now();
    this.#db
      .transaction(() => {
        const changed = this.#db
          .prepare(
            'UPDATE trigger_credentials SET revoked_at = ? WHERE trigger_id = ? AND revoked_at IS NULL',
          )
          .run(now, triggerId).changes;
        this.#event('trigger.credentials_revoked', { triggerId, count: changed });
      })
      .immediate();
    return this.credentials(triggerId);
  }

  #authenticate(
    triggerId: string,
    config: WebhookConfig,
    headers: IncomingHttpHeaders,
    body: Buffer,
    eventId: string | null,
  ): void {
    const refuse = (message: string) => new ShiftError('TRIGGER_UNAUTHORIZED', message, 401);
    const secrets = this.#active(triggerId).map((row) =>
      this.#secrets.unseal(row.secret_sealed, `trigger-credential:${row.id}`),
    );
    if (secrets.length === 0) throw refuse('The trigger has no active credential.');
    let valid = false;
    if (config.auth === 'bearer') {
      const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header(headers, 'authorization') ?? '');
      if (!match) throw refuse('Send the trigger secret as Authorization: Bearer <secret>.');
      const given = digest(match[1]!);
      for (const secret of secrets) if (timingSafeEqual(digest(secret), given)) valid = true;
    } else {
      const timestamp = header(headers, 'x-shift-timestamp');
      const signature = header(headers, 'x-shift-signature');
      if (
        !timestamp ||
        !/^\d{1,13}$/.test(timestamp) ||
        !signature ||
        !/^sha256=[0-9a-f]{64}$/.test(signature)
      )
        throw refuse('Send X-Shift-Timestamp and X-Shift-Signature: sha256=<hex>.');
      // The event ID is signed and required, so a request captured within the tolerance can only
      // be replayed as itself, and a replay returns the first answer instead of another run.
      if (eventId === null)
        throw refuse('A signed request names its X-Shift-Event-Id, which the signature covers.');
      if (Math.abs(this.#clock.now() - Number(timestamp) * 1000) > signatureToleranceMs)
        throw refuse('The X-Shift-Timestamp is more than five minutes from the server clock.');
      const given = Buffer.from(signature.slice('sha256='.length), 'hex');
      for (const secret of secrets) {
        const expected = createHmac('sha256', secret)
          .update(`${timestamp}.${eventId}.`)
          .update(body)
          .digest();
        if (timingSafeEqual(expected, given)) valid = true;
      }
    }
    if (!valid) throw refuse('The trigger credential is not valid.');
  }

  // One authenticated request. With an event ID, a repeat of the same body returns the original
  // occurrence, and the same ID with another body is a conflict; without one, every request is
  // a new occurrence.
  async receive(
    triggerId: string,
    headers: IncomingHttpHeaders,
    body: Buffer,
  ): Promise<{ status: number; occurrence: OccurrenceView; duplicate: boolean }> {
    if (this.#triggers.stopping)
      throw new ShiftError('SERVER_STOPPING', 'The server is stopping.', 503, true);
    const trigger = this.#webhook(triggerId);
    const workflow = this.#definitions.workflow(trigger.workflowId) as {
      activeVersionId: string | null;
    };
    if (!workflow.activeVersionId) throw new ShiftError('NOT_FOUND', 'Trigger not found.', 404);
    const config = trigger.config as unknown as WebhookConfig;
    const eventId = header(headers, 'x-shift-event-id');
    if (eventId !== null && !/^[A-Za-z0-9._:-]{1,200}$/.test(eventId))
      throw new ShiftError(
        'INVALID_REQUEST',
        'X-Shift-Event-Id is 1 to 200 letters, digits, ., _, : or -.',
        400,
      );
    this.#authenticate(triggerId, config, headers, body, eventId);
    const contentType = header(headers, 'content-type') ?? '';
    if (!/^application\/json\b/i.test(contentType))
      throw new ShiftError('UNSUPPORTED_MEDIA_TYPE', 'Send the event as application/json.', 415);
    const requestHash = digest(body).toString('hex');
    let input: Json;
    try {
      input = JSON.parse(body.toString('utf8')) as Json;
    } catch {
      throw new ShiftError('INVALID_REQUEST', 'The request body is not valid JSON.', 400);
    }
    const result = this.#db
      .transaction(() => {
        if (eventId !== null) {
          const existing = this.#db
            .prepare(
              'SELECT id, request_hash FROM trigger_occurrences WHERE trigger_id = ? AND dedup_key = ?',
            )
            .get(triggerId, `event:${eventId}`) as { id: string; request_hash: string } | undefined;
          if (existing) {
            if (existing.request_hash !== requestHash)
              throw new ShiftError(
                'DUPLICATE_EVENT_CONFLICT',
                'This event ID was already received with a different body.',
                409,
              );
            return { id: existing.id, duplicate: true };
          }
        }
        // The input is checked against the version active now, the one the occurrence captures.
        const current = this.#triggers.trigger(triggerId);
        const version = this.#definitions.version(
          (this.#definitions.workflow(current.workflowId) as { activeVersionId: string })
            .activeVersionId,
        );
        const node = version.document.nodes.find((entry) => entry.id === current.nodeId);
        const schema = (node?.config as WebhookConfig | undefined)?.inputSchema;
        const invalid = schema === undefined ? null : checkValue(schema, input);
        if (invalid)
          throw new ShiftError('INVALID_INPUT', `Invalid trigger input: ${invalid}`, 422);
        if (Buffer.byteLength(JSON.stringify(input)) > maxInputBytes)
          throw new ShiftError(
            'REQUEST_TOO_LARGE',
            'The event exceeds the 1 MiB trigger input limit.',
            413,
          );
        const [occurrence] = this.#triggers.capture([
          {
            triggerId,
            dedupKey: eventId === null ? `request:${randomUUID()}` : `event:${eventId}`,
            requestHash,
            occurredAt: this.#clock.now(),
            input,
            details: eventId === null ? {} : { eventId },
          },
        ]);
        return { id: occurrence!.id, duplicate: false };
      })
      .immediate();
    if (!result.duplicate) await this.#triggers.admit();
    return {
      status: result.duplicate ? 200 : 202,
      occurrence: this.#triggers.occurrence(result.id),
      duplicate: result.duplicate,
    };
  }
}
