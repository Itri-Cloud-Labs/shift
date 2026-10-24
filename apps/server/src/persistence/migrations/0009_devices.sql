-- Paired devices and pairing challenges (server specification sections 10 and 13.1). Only
-- hashes of phrases and bearer tokens are stored. A consumed challenge keeps an encrypted copy of
-- its enrollment response until the challenge's original expiry, so a lost response can be
-- retrieved once more; the copy is cleared at expiry.
CREATE TABLE pairing_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  phrase_hash TEXT NOT NULL UNIQUE,
  issued_by_kind TEXT NOT NULL,
  issued_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  device_id TEXT REFERENCES devices(id),
  command_id TEXT,
  request_hash TEXT,
  delivery_ciphertext TEXT,
  withdrawn_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE INDEX open_pairing_challenges ON pairing_challenges (expires_at) WHERE consumed_at IS NULL AND withdrawn_at IS NULL;
--> statement-breakpoint
CREATE TABLE devices (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  challenge_id TEXT NOT NULL REFERENCES pairing_challenges(id),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
) STRICT;
