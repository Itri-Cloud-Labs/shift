-- Human interactions (server specification sections 4.4, 6.6 and 10): a waiting execution's
-- frozen form and presentation, its optional deadline, and the single accepted response. Responses
-- keep their actor and command ID, so an owner's answer is never mistaken for anything else.
CREATE TABLE human_interactions (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  execution_id TEXT NOT NULL REFERENCES node_executions(id),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES node_attempts(id),
  kind TEXT NOT NULL CHECK (kind IN ('input', 'approval')),
  form_json TEXT NOT NULL CHECK (json_valid(form_json)),
  presentation_json TEXT NOT NULL CHECK (json_valid(presentation_json)),
  outcomes_json TEXT CHECK (outcomes_json IS NULL OR json_valid(outcomes_json)),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'RESPONDED', 'EXPIRED', 'CANCELLED')),
  expires_at INTEGER,
  accepted_response_id TEXT REFERENCES human_responses(id),
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX one_pending_interaction_per_execution ON human_interactions (execution_id) WHERE state = 'PENDING';
--> statement-breakpoint
CREATE INDEX waiting_interactions ON human_interactions (state, expires_at);
--> statement-breakpoint
CREATE INDEX run_interactions ON human_interactions (run_id, created_at);
--> statement-breakpoint
CREATE TABLE human_responses (
  id TEXT PRIMARY KEY NOT NULL,
  interaction_id TEXT NOT NULL UNIQUE REFERENCES human_interactions(id),
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  command_id TEXT,
  decision TEXT,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at INTEGER NOT NULL
) STRICT;
