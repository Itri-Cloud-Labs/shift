-- Session strategies and ownership (server specification sections 4.3, 6.4 and 10). A session
-- belongs to one project and one workspace; a per-run binding names the session a node reuses on
-- later visits; claims give one execution at a time a session, and the workspace it lives in, and
-- the queue keeps waiting executions in the order they asked.
ALTER TABLE agent_sessions ADD COLUMN project_id TEXT REFERENCES projects(id);
--> statement-breakpoint
ALTER TABLE agent_sessions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
--> statement-breakpoint
ALTER TABLE agent_sessions ADD COLUMN node_id TEXT;
--> statement-breakpoint
CREATE INDEX project_sessions ON agent_sessions(project_id, created_at);
--> statement-breakpoint
CREATE TABLE run_session_bindings (
  run_id TEXT NOT NULL REFERENCES runs(id),
  node_id TEXT NOT NULL,
  agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, node_id)
) STRICT;
--> statement-breakpoint
CREATE TABLE resource_claims (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('session', 'workspace')),
  resource_id TEXT NOT NULL,
  execution_id TEXT NOT NULL REFERENCES node_executions(id),
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (resource_type, resource_id)
) STRICT;
--> statement-breakpoint
CREATE INDEX execution_claims ON resource_claims(execution_id);
--> statement-breakpoint
CREATE TABLE resource_queue (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL UNIQUE REFERENCES node_executions(id),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('session', 'workspace')),
  resource_id TEXT NOT NULL,
  requested_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX resource_waiters ON resource_queue(resource_type, resource_id, sequence);
