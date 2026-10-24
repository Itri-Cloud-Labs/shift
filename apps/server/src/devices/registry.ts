import type Database from 'better-sqlite3';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import type { Clock } from '../domain/clock.js';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import type { SecretBox } from '../secrets/secret-box.js';

// Device pairing and authentication (specification 13.1). An eight-word phrase from the 2048-word
// BIP39 list carries 88 random bits, lives ten minutes and can create one device. A device holds a
// random 256-bit bearer token; Shift stores only its SHA-256 hash.

export const pairingLifetimeMs = 10 * 60 * 1000;
const phraseWords = 8;
// Failed pairing attempts tolerated while phrases are open; past it, every open phrase is
// withdrawn and the owner issues a new one.
const failureCap = 20;
const perAddressPerMinute = 10;
const globalPerMinute = 60;

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

export interface Issuer {
  kind: 'cli' | 'device';
  id: string;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
// Spaces, hyphens and case are not part of a phrase.
const normalize = (phrase: string) =>
  phrase
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .join(' ');

const rejected = () =>
  new ShiftError('PAIRING_REJECTED', 'The pairing phrase is not valid or has expired.', 401);

interface DeviceRow {
  id: string;
  name: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

const view = (row: DeviceRow): Device => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  revokedAt: row.revoked_at,
});

export class DeviceRegistry {
  #failures = 0;
  readonly #attempts = new Map<string, number[]>();
  readonly #revokedListeners = new Set<(deviceId: string) => void>();

  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
    private readonly secrets: SecretBox,
  ) {}

  #event(type: string, payload: Json): void {
    this.db
      .prepare(
        'INSERT INTO events (type, schema_version, payload_json, created_at) VALUES (?, 1, ?, ?)',
      )
      .run(type, JSON.stringify(payload), this.clock.now());
  }

  // A new single-use phrase. Issuing is not idempotent: a lost phrase is replaced by issuing
  // another, so the phrase never enters a command receipt.
  issue(issuer: Issuer): { phrase: string; expiresAt: number } {
    const phrase = Array.from(
      { length: phraseWords },
      () => wordlist[randomInt(wordlist.length)]!,
    ).join(' ');
    const now = this.clock.now();
    const expiresAt = now + pairingLifetimeMs;
    this.db
      .transaction(() => {
        const id = randomUUID();
        this.db
          .prepare(
            'INSERT INTO pairing_challenges (id, phrase_hash, issued_by_kind, issued_by_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(id, sha256(phrase), issuer.kind, issuer.id, now, expiresAt);
        this.#event('pairing.issued', { challengeId: id, issuedBy: { ...issuer }, expiresAt });
      })
      .immediate();
    return { phrase, expiresAt };
  }

  // Consumes a phrase and creates a device in one transaction. Repeating the same command with the
  // same body before the phrase's original expiry returns the same device and token; it never
  // creates another device.
  pair(
    input: { phrase: string; deviceName: string; commandId: string },
    address: string,
  ): { device: Device; token: string } {
    this.#limit(address);
    this.sweep();
    const phraseHash = sha256(normalize(input.phrase));
    const requestHash = sha256(JSON.stringify({ op: 'pair', phraseHash, name: input.deviceName }));
    const result = this.db
      .transaction((): { device: Device; token: string } | 'rejected' => {
        const now = this.clock.now();
        const challenge = this.db
          .prepare('SELECT * FROM pairing_challenges WHERE phrase_hash = ?')
          .get(phraseHash) as
          | {
              id: string;
              expires_at: number;
              consumed_at: number | null;
              withdrawn_at: number | null;
              device_id: string | null;
              command_id: string | null;
              request_hash: string | null;
              delivery_ciphertext: string | null;
            }
          | undefined;
        // Counted after this transaction, which a rejection would otherwise roll back.
        if (!challenge || challenge.withdrawn_at !== null || challenge.expires_at <= now) {
          return 'rejected';
        }
        if (challenge.consumed_at !== null) {
          if (challenge.command_id !== input.commandId) throw rejected();
          if (challenge.request_hash !== requestHash) {
            throw new ShiftError(
              'COMMAND_CONFLICT',
              'This command ID was already used for a different request.',
              409,
            );
          }
          if (challenge.delivery_ciphertext === null) throw rejected();
          const delivered = JSON.parse(
            this.secrets.unseal(challenge.delivery_ciphertext, `pairing:${challenge.id}`),
          ) as { token: string };
          return { device: this.device(challenge.device_id!), token: delivered.token };
        }
        const deviceId = randomUUID();
        const token = randomBytes(32).toString('base64url');
        this.db
          .prepare(
            'INSERT INTO devices (id, name, token_hash, challenge_id, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(deviceId, input.deviceName, sha256(token), challenge.id, now);
        this.db
          .prepare(
            'UPDATE pairing_challenges SET consumed_at = ?, device_id = ?, command_id = ?, request_hash = ?, delivery_ciphertext = ? WHERE id = ?',
          )
          .run(
            now,
            deviceId,
            input.commandId,
            requestHash,
            this.secrets.seal(JSON.stringify({ token }), `pairing:${challenge.id}`),
            challenge.id,
          );
        this.#event('device.paired', { deviceId, name: input.deviceName });
        return { device: this.device(deviceId), token };
      })
      .immediate();
    if (result === 'rejected') {
      this.#failed();
      throw rejected();
    }
    return result;
  }

  // The active device a bearer token belongs to, or null. Last-seen is recorded at most once a
  // minute, so ordinary requests do not write.
  authenticate(token: string): Device | null {
    const row = this.db
      .prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL')
      .get(sha256(token)) as DeviceRow | undefined;
    if (!row) return null;
    const now = this.clock.now();
    if (row.last_seen_at === null || now - row.last_seen_at >= 60_000) {
      this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, row.id);
      row.last_seen_at = now;
    }
    return view(row);
  }

  device(id: string): Device {
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as
      DeviceRow | undefined;
    if (!row) throw new ShiftError('DEVICE_NOT_FOUND', 'No such device.', 404);
    return view(row);
  }

  list(): Device[] {
    return (
      this.db.prepare('SELECT * FROM devices ORDER BY created_at, rowid').all() as DeviceRow[]
    ).map(view);
  }

  // Stops all later requests of the device; `notifyRevoked` then closes its streams. Runs it
  // started keep running. Revoking a revoked device succeeds without change. Called inside the
  // caller's command transaction.
  revoke(id: string, actor: Issuer): Device {
    const device = this.device(id);
    if (device.revokedAt === null) {
      this.db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ?').run(this.clock.now(), id);
      this.#event('device.revoked', { deviceId: id, by: { ...actor } });
    }
    return this.device(id);
  }

  // Called once a revocation committed: the device's open streams close themselves.
  notifyRevoked(id: string): void {
    for (const listener of this.#revokedListeners) listener(id);
  }

  // Streams subscribe to close themselves when their device is revoked.
  onRevoked(listener: (deviceId: string) => void): () => void {
    this.#revokedListeners.add(listener);
    return () => this.#revokedListeners.delete(listener);
  }

  // Clears enrollment delivery copies once their phrase's original expiry has passed.
  sweep(): void {
    this.db
      .prepare(
        'UPDATE pairing_challenges SET delivery_ciphertext = NULL WHERE delivery_ciphertext IS NOT NULL AND expires_at <= ?',
      )
      .run(this.clock.now());
  }

  #failed(): void {
    if (++this.#failures < failureCap) return;
    this.#failures = 0;
    this.db
      .prepare(
        'UPDATE pairing_challenges SET withdrawn_at = ? WHERE consumed_at IS NULL AND withdrawn_at IS NULL AND expires_at > ?',
      )
      .run(this.clock.now(), this.clock.now());
    this.#event('pairing.withdrawn', { reason: 'too many failed attempts' });
  }

  #limit(address: string): void {
    const now = this.clock.now();
    const recent = (key: string) =>
      (this.#attempts.get(key) ?? []).filter((time) => now - time < 60_000);
    const mine = recent(address);
    const all = recent('*');
    if (mine.length >= perAddressPerMinute || all.length >= globalPerMinute) {
      throw new ShiftError(
        'RATE_LIMITED',
        'Too many pairing attempts. Try again in a minute.',
        429,
        true,
      );
    }
    // Addresses with no recent attempt are forgotten, so the table stays small.
    if (this.#attempts.size > 1000) {
      for (const key of [...this.#attempts.keys()])
        if (recent(key).length === 0) this.#attempts.delete(key);
    }
    this.#attempts.set(address, [...mine, now]);
    this.#attempts.set('*', [...all, now]);
  }
}
