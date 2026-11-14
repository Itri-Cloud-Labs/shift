-- Manual intervention (server specification sections 4.2 RunControl and 6.6). A hold is a durable
-- flag on the run, set before any manual message: it stops new activations while it lasts, and it
-- outlives every client. Holds, aborts of active work, manual messages and resumes are owner
-- controls, recorded like the others.
ALTER TABLE runs ADD COLUMN hold_json TEXT CHECK (hold_json IS NULL OR json_valid(hold_json));
--> statement-breakpoint
CREATE TABLE run_controls_next (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL CHECK (kind IN ('cancel', 'retry', 'fail', 'complete', 'extend', 'hold', 'abort', 'message', 'resume')),
  execution_id TEXT REFERENCES node_executions(id),
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  command_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
INSERT INTO run_controls_next SELECT id, run_id, kind, execution_id, actor_kind, actor_id, command_id, payload_json, created_at FROM run_controls;
--> statement-breakpoint
DROP TABLE run_controls;
--> statement-breakpoint
ALTER TABLE run_controls_next RENAME TO run_controls;
--> statement-breakpoint
CREATE INDEX run_controls_run ON run_controls (run_id, created_at);
