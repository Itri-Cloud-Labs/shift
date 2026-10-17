-- Project and workflow definitions with immutable versions, command receipts, and the execution
-- columns a general graph executor needs (server specification sections 4.1, 10 and 13).
CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  repository_path TEXT NOT NULL UNIQUE,
  base_ref TEXT NOT NULL,
  defaults_json TEXT NOT NULL CHECK (json_valid(defaults_json)),
  permissions_json TEXT NOT NULL CHECK (json_valid(permissions_json)),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  archived_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE TABLE workflows (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  draft_json TEXT NOT NULL CHECK (json_valid(draft_json)),
  draft_revision INTEGER NOT NULL CHECK (draft_revision >= 0),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  active_version_id TEXT REFERENCES workflow_versions(id),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  UNIQUE (project_id, name)
) STRICT;
--> statement-breakpoint
CREATE TABLE workflow_versions (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  document_json TEXT NOT NULL CHECK (json_valid(document_json)),
  document_hash TEXT NOT NULL,
  format_version INTEGER NOT NULL CHECK (format_version > 0),
  created_at INTEGER NOT NULL,
  UNIQUE (workflow_id, version_number)
) STRICT;
--> statement-breakpoint
-- Published versions are immutable; normal repository methods never update or delete them.
CREATE TRIGGER workflow_versions_immutable_update BEFORE UPDATE ON workflow_versions
BEGIN SELECT RAISE(ABORT, 'workflow versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_versions_immutable_delete BEFORE DELETE ON workflow_versions
BEGIN SELECT RAISE(ABORT, 'workflow versions are immutable'); END;
--> statement-breakpoint
CREATE TABLE command_receipts (
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor_kind, actor_id, command_id)
) STRICT;
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN project_id TEXT REFERENCES projects(id);
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN workflow_id TEXT REFERENCES workflows(id);
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN workflow_version_id TEXT REFERENCES workflow_versions(id);
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN trigger_input_json TEXT CHECK (trigger_input_json IS NULL OR json_valid(trigger_input_json));
--> statement-breakpoint
ALTER TABLE node_executions ADD COLUMN node_type TEXT;
--> statement-breakpoint
ALTER TABLE node_executions ADD COLUMN incoming_connection_id TEXT;
--> statement-breakpoint
ALTER TABLE node_executions ADD COLUMN config_json TEXT CHECK (config_json IS NULL OR json_valid(config_json));
--> statement-breakpoint
ALTER TABLE node_executions ADD COLUMN bindings_json TEXT CHECK (bindings_json IS NULL OR json_valid(bindings_json));
--> statement-breakpoint
ALTER TABLE node_executions ADD COLUMN selected_port TEXT;
--> statement-breakpoint
CREATE INDEX project_workflows ON workflows(project_id);
--> statement-breakpoint
CREATE INDEX workflow_runs ON runs(workflow_id, created_at);
