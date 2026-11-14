import type Database from 'better-sqlite3';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import {
  checkedCommit,
  deliveryMatches,
  payloadField,
  type GitHubTriggerConfig,
} from '../triggers/github-events.js';
import type { Capture, TriggerService } from '../triggers/service.js';
import type { GitHubIntegration } from './integration.js';

// Inline trigger output limit (specification 12.1): a delivery whose run input would exceed it is
// refused rather than acknowledged and dropped. The 2 MiB body limit is the route's.
export const maxTriggerInputBytes = 1024 * 1024;

export interface DeliveryView {
  id: string;
  deliveryId: string;
  event: string;
  action: string | null;
  repositoryId: number | null;
  receivedAt: number;
  occurrences: Array<{
    id: string;
    triggerId: string;
    workflowId: string;
    state: string;
    reason: string | null;
    runId: string | null;
  }>;
}

type Payload = Record<string, unknown>;

interface DeliveryRow {
  id: string;
  delivery_id: string;
  event: string;
  action: string | null;
  repository_id: number | null;
  occurrences_json: string;
  received_at: number;
}

const header = (headers: IncomingHttpHeaders, name: string): string | null => {
  const value = headers[name];
  return typeof value === 'string' ? value : null;
};

// Constant-time comparison of the delivery's signature with each secret that may have signed it.
function signedBy(secrets: string[], body: Buffer, signature: string | null): boolean {
  if (signature === null || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const given = Buffer.from(signature.slice('sha256='.length), 'hex');
  let valid = false;
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(body).digest();
    if (timingSafeEqual(expected, given)) valid = true;
  }
  return valid;
}

// The App-scoped webhook endpoint (specification 12.1 and 12.3). A delivery is verified against
// the raw body, checked against the installations and repository bindings Shift registered, and
// deduplicated by its delivery ID before it is matched. The delivery, the subscriptions it matched
// and their occurrences commit together before GitHub hears back, so a redelivery is answered from
// that record and never matches subscriptions published since.
export class GitHubWebhooks {
  readonly #db: Database.Database;
  readonly #clock: Clock;
  readonly #github: GitHubIntegration;
  readonly #triggers: TriggerService;
  readonly #wake: () => void;

  constructor(options: {
    db: Database.Database;
    clock: Clock;
    github: GitHubIntegration;
    triggers: TriggerService;
    wake: () => void;
  }) {
    this.#db = options.db;
    this.#clock = options.clock;
    this.#github = options.github;
    this.#triggers = options.triggers;
    this.#wake = options.wake;
  }

  // A delivery with the occurrences it captured on arrival, as they stand now: a queued one may
  // since have been admitted, but the set never changes.
  #view(row: DeliveryRow): DeliveryView {
    const ids = JSON.parse(row.occurrences_json) as string[];
    return {
      id: row.id,
      deliveryId: row.delivery_id,
      event: row.event,
      action: row.action,
      repositoryId: row.repository_id,
      receivedAt: row.received_at,
      occurrences: ids.map((id) => {
        const occurrence = this.#triggers.occurrence(id);
        return {
          id,
          triggerId: occurrence.triggerId,
          workflowId: occurrence.workflowId,
          state: occurrence.state,
          reason: occurrence.reason,
          runId: occurrence.runId,
        };
      }),
    };
  }

  #stored(appRowId: string, deliveryId: string): DeliveryView | null {
    const row = this.#db
      .prepare('SELECT * FROM github_deliveries WHERE github_app_id = ? AND delivery_id = ?')
      .get(appRowId, deliveryId) as DeliveryRow | undefined;
    return row ? this.#view(row) : null;
  }

  // The projects whose binding is this repository through this installation. A repository bound
  // through another installation, even of the same account, is not this delivery's.
  #projects(installationRowId: string, repositoryId: number): string[] {
    return (
      this.#db
        .prepare(
          'SELECT project_id FROM github_connections WHERE installation_id = ? AND repository_id = ? AND removed_at IS NULL',
        )
        .all(installationRowId, repositoryId) as Array<{ project_id: string }>
    ).map((row) => row.project_id);
  }

  #matches(projectIds: string[], event: string, payload: Payload) {
    if (projectIds.length === 0) return [];
    return this.#triggers
      .active('github', projectIds)
      .filter((trigger) =>
        deliveryMatches(trigger.config as unknown as GitHubTriggerConfig, event, payload),
      );
  }

  async receive(
    appRowId: string,
    headers: IncomingHttpHeaders,
    body: Buffer,
  ): Promise<{ status: number; delivery: DeliveryView; duplicate: boolean }> {
    if (this.#triggers.stopping)
      throw new ShiftError('SERVER_STOPPING', 'The server is stopping.', 503, true);
    const secrets = this.#github.webhookSecrets(appRowId);
    if (secrets.length === 0)
      throw new ShiftError(
        'GITHUB_WEBHOOK_SECRET_MISSING',
        'Set the App webhook secret in Shift before GitHub sends deliveries.',
        409,
      );
    if (!signedBy(secrets, body, header(headers, 'x-hub-signature-256')))
      throw new ShiftError('GITHUB_SIGNATURE_INVALID', 'The delivery signature is not valid.', 401);
    const deliveryId = header(headers, 'x-github-delivery');
    const event = header(headers, 'x-github-event');
    if (deliveryId === null || !/^[A-Za-z0-9-]{1,100}$/.test(deliveryId))
      throw new ShiftError('INVALID_REQUEST', 'The delivery has no valid X-GitHub-Delivery.', 400);
    if (event === null || !/^[a-z_]{1,64}$/.test(event))
      throw new ShiftError('INVALID_REQUEST', 'The delivery has no valid X-GitHub-Event.', 400);
    const seen = this.#stored(appRowId, deliveryId);
    if (seen) return { status: 200, delivery: seen, duplicate: true };
    let payload: Payload;
    try {
      const parsed = JSON.parse(body.toString('utf8')) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      payload = parsed as Payload;
    } catch {
      throw new ShiftError('INVALID_REQUEST', 'The delivery body is not a JSON object.', 400);
    }
    const action = typeof payload['action'] === 'string' ? payload['action'].slice(0, 64) : null;
    const installationId = payloadField(payload, 'installation', 'id');
    const repositoryId = payloadField(payload, 'repository', 'id');
    const identity = (value: unknown): value is number =>
      typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    const invalidIdentity = (message: string) =>
      new ShiftError('GITHUB_INVALID_IDENTITY', message, 422);
    // Every App delivery but a ping names its installation, and one about a repository names it
    // by ID; a delivery that does not, or names them badly, is refused rather than recorded.
    if (event !== 'ping' && !identity(installationId))
      throw invalidIdentity('The delivery has no valid installation ID.');
    if (payload['repository'] !== undefined && !identity(repositoryId))
      throw invalidIdentity('The delivery has no valid repository ID.');
    const repository = identity(repositoryId) ? repositoryId : null;
    let installationRowId: string | null = null;
    if (identity(installationId)) {
      const row = this.#db
        .prepare(
          "SELECT id FROM github_installations WHERE github_app_id = ? AND installation_id = ? AND state != 'REMOVED'",
        )
        .get(appRowId, installationId) as { id: string } | undefined;
      // An installation Shift has not seen yet only announces itself; anything else from it is
      // refused until the owner refreshes the App.
      if (!row && event !== 'installation' && event !== 'installation_repositories')
        throw new ShiftError(
          'GITHUB_UNKNOWN_INSTALLATION',
          'The delivery comes from an installation Shift has not registered; refresh the App.',
          422,
        );
      installationRowId = row?.id ?? null;
    }
    const input: Json = {
      event,
      action,
      deliveryId,
      installationId: identity(installationId) ? installationId : null,
      repository: repository
        ? {
            id: repository,
            owner: (payloadField(payload, 'repository', 'owner', 'login') as string) ?? null,
            name: (payloadField(payload, 'repository', 'name') as string) ?? null,
          }
        : null,
      sender: (payloadField(payload, 'sender', 'login') as string | undefined) ?? null,
      payload: payload as Json,
    };
    const inputBytes = Buffer.byteLength(JSON.stringify(input));
    // Matching, the captured versions and the admission decisions are fixed in this one
    // transaction, with no I/O before it that a publication or Pause could race; runs are
    // created from the accepted occurrences after it commits.
    const result = this.#db
      .transaction(() => {
        const repeat = this.#stored(appRowId, deliveryId);
        if (repeat) return { status: 200, delivery: repeat, duplicate: true };
        const projects =
          installationRowId && repository ? this.#projects(installationRowId, repository) : [];
        const matched = this.#matches(projects, event, payload);
        if (matched.length > 0 && inputBytes > maxTriggerInputBytes)
          throw new ShiftError(
            'REQUEST_TOO_LARGE',
            'The delivery exceeds the 1 MiB trigger input limit.',
            413,
          );
        const now = this.#clock.now();
        const captures: Capture[] = matched.map((trigger) => ({
          triggerId: trigger.id,
          dedupKey: deliveryId,
          occurredAt: now,
          input,
          details: { deliveryId, event, ...(action ? { action } : {}) },
        }));
        const occurrences = this.#triggers.capture(captures);
        const id = randomUUID();
        this.#db
          .prepare(
            'INSERT INTO github_deliveries (id, github_app_id, delivery_id, event, action, installation_id, repository_id, payload_json, payload_sha256, payload_bytes, occurrences_json, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            appRowId,
            deliveryId,
            event,
            action,
            identity(installationId) ? installationId : null,
            repository,
            body.toString('utf8'),
            createHash('sha256').update(body).digest('hex'),
            body.length,
            JSON.stringify(occurrences.map((occurrence) => occurrence.id)),
            now,
          );
        this.#db
          .prepare(
            'INSERT INTO events (type, schema_version, payload_json, created_at) VALUES (?, 1, ?, ?)',
          )
          .run(
            'github.delivery',
            JSON.stringify({
              appId: appRowId,
              deliveryId,
              event,
              action,
              occurrences: occurrences.length,
            }),
            now,
          );
        return { status: 202, delivery: null, duplicate: false };
      })
      .immediate();
    if (result.duplicate)
      return result as { status: number; delivery: DeliveryView; duplicate: boolean };
    // A checks or status event brings forward the next read of Wait for Checks steps that watch
    // its commit in this repository; the wait itself stays the poll's (prompt 23).
    const commit = checkedCommit(event, payload);
    if (commit && repository) this.#expedite(commit, repository);
    await this.#triggers.admit();
    this.#wake();
    return { status: 202, delivery: this.#stored(appRowId, deliveryId)!, duplicate: false };
  }

  #expedite(commit: string, repositoryId: number): void {
    this.#db
      .prepare(
        "UPDATE wakeups SET due_at = MIN(due_at, ?) WHERE reason = 'poll' AND state = 'PENDING' AND json_extract(payload_json, '$.commit') = ? AND run_id IN (SELECT r.id FROM runs r JOIN github_connections c ON c.id = json_extract(r.snapshot_json, '$.authority.github.connectionId') WHERE c.repository_id = ?)",
      )
      .run(this.#clock.now(), commit, repositoryId);
  }

  // Newest first.
  deliveries(
    appRowId: string,
    page: { before?: number; limit?: number },
  ): { deliveries: DeliveryView[]; nextBefore: number | null } {
    this.#github.webhookSecrets(appRowId);
    const limit = Math.min(Math.max(page.limit ?? 50, 1), 200);
    const rows = this.#db
      .prepare(
        'SELECT rowid AS cursor, * FROM github_deliveries WHERE github_app_id = ? AND (? IS NULL OR rowid < ?) ORDER BY rowid DESC LIMIT ?',
      )
      .all(appRowId, page.before ?? null, page.before ?? null, limit + 1) as Array<
      DeliveryRow & { cursor: number }
    >;
    const shown = rows.slice(0, limit);
    return {
      deliveries: shown.map((row) => this.#view(row)),
      nextBefore: rows.length > limit ? shown.at(-1)!.cursor : null,
    };
  }
}
