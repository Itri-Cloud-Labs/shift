-- Generic actions (server specification sections 4.4, 8, 10 and 11). A credential is a project's
-- sealed secret, referenced by name from workflows and never stored in snapshots, operations or
-- events. An effect operation is the durable intent of one external action: its arguments are
-- fixed by hash before anything is submitted, and its evidence decides what recovery may do.
CREATE TABLE credentials (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  sealed TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX project_credential_names ON credentials(project_id, name) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TABLE effect_operations (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  execution_id TEXT NOT NULL REFERENCES node_executions(id),
  attempt_id TEXT NOT NULL REFERENCES node_attempts(id),
  operation_key TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL,
  args_json TEXT NOT NULL CHECK (json_valid(args_json)),
  args_hash TEXT NOT NULL CHECK (length(args_hash) = 64),
  state TEXT NOT NULL CHECK (state IN ('INTENDED', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'ABANDONED')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  resolution_json TEXT CHECK (resolution_json IS NULL OR json_valid(resolution_json)),
  fence INTEGER NOT NULL CHECK (fence > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX execution_operations ON effect_operations(execution_id, created_at);
--> statement-breakpoint
CREATE INDEX open_operations ON effect_operations(state) WHERE state IN ('INTENDED', 'SUBMITTED', 'UNKNOWN');
