-- Retained run workspaces: detached Git worktrees at a recorded base commit (server specification
-- section 7). v0 has one workspace per run, owned by the run that created it.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  created_by_run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
  path TEXT NOT NULL UNIQUE,
  repository_path TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CREATING', 'READY', 'RETIRED')),
  created_at INTEGER NOT NULL,
  ready_at INTEGER,
  retired_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE INDEX workspaces_project_created ON workspaces (project_id, created_at);
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN primary_workspace_id TEXT REFERENCES workspaces(id);
