-- Run variables (server specification sections 6.3 and 10): explicit run-local JSON values. The
-- current value and every revision are written in the transaction that completes the producing
-- execution, so a failed or interrupted attempt leaves no partial write.
CREATE TABLE run_variables (
  run_id TEXT NOT NULL REFERENCES runs(id),
  key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  execution_id TEXT NOT NULL REFERENCES node_executions(id),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, key)
);
--> statement-breakpoint
CREATE TABLE run_variable_revisions (
  run_id TEXT NOT NULL REFERENCES runs(id),
  key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  execution_id TEXT NOT NULL REFERENCES node_executions(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, key, revision)
);
