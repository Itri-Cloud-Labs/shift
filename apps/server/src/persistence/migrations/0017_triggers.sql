-- Triggers and admission (server specification sections 4.4, 10 and 12). Publishing a version
-- materializes a subscription for each of its trigger nodes; the row keeps its identity, and so its
-- endpoint and credentials, while later versions keep the node. An occurrence is one deduplicated
-- event or schedule instant with the version and input it captured and what admission decided.
CREATE TABLE triggers (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('github', 'schedule', 'webhook')),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  next_fire_at INTEGER,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  removed_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX active_trigger_per_node ON triggers(workflow_id, node_id) WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE INDEX next_trigger ON triggers(kind, next_fire_at) WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE TABLE trigger_occurrences (
  id TEXT PRIMARY KEY NOT NULL,
  ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal > 0),
  trigger_id TEXT NOT NULL REFERENCES triggers(id),
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id),
  dedup_key TEXT NOT NULL,
  request_hash TEXT,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  state TEXT NOT NULL CHECK (state IN ('ACCEPTED', 'ADMITTED', 'QUEUED', 'SKIPPED', 'REJECTED')),
  reason TEXT,
  run_id TEXT REFERENCES runs(id),
  decided_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX occurrence_identity ON trigger_occurrences(trigger_id, dedup_key);
--> statement-breakpoint
CREATE INDEX workflow_occurrences ON trigger_occurrences(workflow_id, state, ordinal);
--> statement-breakpoint
CREATE INDEX trigger_history ON trigger_occurrences(trigger_id, ordinal);
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN occurrence_id TEXT REFERENCES trigger_occurrences(id);
--> statement-breakpoint
CREATE UNIQUE INDEX run_occurrence ON runs(occurrence_id) WHERE occurrence_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX workflow_run_states ON runs(workflow_id, state);
--> statement-breakpoint
-- A webhook trigger's credentials. Several can be valid at once only during an explicit rotation
-- window; each is sealed to its row.
CREATE TABLE trigger_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  trigger_id TEXT NOT NULL REFERENCES triggers(id),
  secret_sealed TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE INDEX trigger_credential_list ON trigger_credentials(trigger_id);
--> statement-breakpoint
-- One verified GitHub delivery, as GitHub sent it, and the occurrences of the subscriptions it
-- matched when it arrived. A redelivery is answered from this row and never matches again.
CREATE TABLE github_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  github_app_id TEXT NOT NULL REFERENCES github_apps(id),
  delivery_id TEXT NOT NULL,
  event TEXT NOT NULL,
  action TEXT,
  installation_id INTEGER,
  repository_id INTEGER,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_sha256 TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0),
  occurrences_json TEXT NOT NULL CHECK (json_valid(occurrences_json)),
  received_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX github_delivery_identity ON github_deliveries(github_app_id, delivery_id);
--> statement-breakpoint
CREATE INDEX github_delivery_history ON github_deliveries(github_app_id, received_at);
--> statement-breakpoint
ALTER TABLE github_apps ADD COLUMN previous_webhook_secret_sealed TEXT;
--> statement-breakpoint
ALTER TABLE github_apps ADD COLUMN previous_webhook_secret_until INTEGER;
--> statement-breakpoint
-- The events the App's settings subscribe to, as GitHub last reported them.
ALTER TABLE github_apps ADD COLUMN events_json TEXT CHECK (events_json IS NULL OR json_valid(events_json));
