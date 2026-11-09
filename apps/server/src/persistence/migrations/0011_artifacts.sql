-- Immutable artifacts (server specification sections 4.3, 6.5 and 10). The bytes live in a
-- content-addressed blob store; a row is inserted only after its blob was flushed and renamed, so
-- a published reference never points at missing bytes.
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id),
  run_id TEXT REFERENCES runs(id),
  execution_id TEXT REFERENCES node_executions(id),
  attempt_id TEXT REFERENCES node_attempts(id),
  invocation_id TEXT REFERENCES agent_invocations(id),
  agent_session_id TEXT REFERENCES agent_sessions(id),
  role TEXT NOT NULL CHECK (role IN ('handoff', 'human_report')),
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  storage_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX one_report_per_invocation ON artifacts(invocation_id, role) WHERE invocation_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX run_artifacts ON artifacts(run_id, created_at);
--> statement-breakpoint
CREATE INDEX execution_artifacts ON artifacts(execution_id, created_at);
--> statement-breakpoint
CREATE INDEX session_artifacts ON artifacts(agent_session_id, created_at);
