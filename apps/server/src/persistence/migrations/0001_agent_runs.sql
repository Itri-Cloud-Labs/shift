-- First execution tables: a fixed manual -> agent -> end run (server specification section 10).
-- State CHECKs carry the full specified enums so later milestones need no table rebuild.
CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'RUNNING', 'WAITING', 'HELD', 'NEEDS_HUMAN', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED')),
  attention_json TEXT CHECK (attention_json IS NULL OR json_valid(attention_json)),
  outcome_json TEXT CHECK (outcome_json IS NULL OR json_valid(outcome_json)),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  created_by_run_id TEXT REFERENCES runs(id),
  harness_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  lifetime TEXT NOT NULL CHECK (lifetime IN ('persistent', 'ephemeral')),
  state TEXT NOT NULL CHECK (state IN ('CREATING', 'IDLE', 'BUSY', 'BLOCKED', 'UNAVAILABLE', 'ARCHIVED')),
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE harness_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  agent_session_id TEXT NOT NULL UNIQUE REFERENCES agent_sessions(id),
  adapter_version TEXT NOT NULL,
  harness_session_id TEXT,
  storage_namespace TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CREATING', 'READY')),
  verified_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE TABLE node_executions (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  node_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  predecessor_execution_id TEXT REFERENCES node_executions(id),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  agent_session_id TEXT REFERENCES agent_sessions(id),
  started_at INTEGER,
  finished_at INTEGER,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  UNIQUE (run_id, sequence)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX one_active_execution_per_run ON node_executions(run_id) WHERE state IN ('PENDING', 'RUNNING', 'WAITING');
--> statement-breakpoint
CREATE INDEX run_execution_history ON node_executions(run_id, node_id, sequence);
--> statement-breakpoint
CREATE TABLE node_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  execution_id TEXT NOT NULL REFERENCES node_executions(id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED')),
  worker_generation TEXT,
  fence INTEGER NOT NULL CHECK (fence >= 0),
  started_at INTEGER,
  finished_at INTEGER,
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  UNIQUE (execution_id, attempt_number)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX one_active_attempt_per_execution ON node_attempts(execution_id) WHERE state IN ('PENDING', 'RUNNING', 'WAITING');
--> statement-breakpoint
CREATE TABLE agent_invocations (
  id TEXT PRIMARY KEY NOT NULL,
  agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  execution_id TEXT REFERENCES node_executions(id),
  attempt_id TEXT REFERENCES node_attempts(id),
  previous_invocation_id TEXT REFERENCES agent_invocations(id),
  kind TEXT NOT NULL CHECK (kind IN ('goal', 'correction', 'continuation')),
  correlation_id TEXT NOT NULL UNIQUE,
  prompt_json TEXT NOT NULL CHECK (json_valid(prompt_json)),
  state TEXT NOT NULL CHECK (state IN ('PREPARING', 'SUBMITTING', 'RUNNING', 'UNCERTAIN', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'UNKNOWN')),
  submitted_at INTEGER,
  finished_at INTEGER,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  runtime_generation INTEGER,
  created_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX one_active_invocation_per_session ON agent_invocations(agent_session_id) WHERE state IN ('PREPARING', 'SUBMITTING', 'RUNNING', 'UNCERTAIN');
--> statement-breakpoint
CREATE INDEX attempt_invocations ON agent_invocations(attempt_id, created_at);
--> statement-breakpoint
CREATE TABLE agent_result_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  invocation_id TEXT NOT NULL REFERENCES agent_invocations(id),
  tool_call_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
  reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (invocation_id, tool_call_id)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX one_accepted_result_per_invocation ON agent_result_submissions(invocation_id) WHERE accepted = 1;
--> statement-breakpoint
CREATE TABLE events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  run_id TEXT REFERENCES runs(id),
  execution_id TEXT REFERENCES node_executions(id),
  session_id TEXT REFERENCES agent_sessions(id),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX run_events ON events(run_id, sequence);
--> statement-breakpoint
CREATE INDEX session_events ON events(session_id, sequence);
