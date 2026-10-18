-- Owner control commands on runs (server specification sections 4.1 RunControl, 6.6 and 6.7):
-- each command is recorded with its actor and payload, so a manual decision is never mistaken for
-- an agent or executor result.
CREATE TABLE run_controls (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL CHECK (kind IN ('cancel', 'retry', 'fail', 'complete', 'extend')),
  execution_id TEXT REFERENCES node_executions(id),
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  command_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX run_controls_run ON run_controls (run_id, created_at);
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN cancel_requested_at INTEGER;
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN limits_json TEXT CHECK (limits_json IS NULL OR json_valid(limits_json));
