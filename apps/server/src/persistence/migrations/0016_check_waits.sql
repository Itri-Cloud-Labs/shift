-- Waiting for GitHub checks (server specification sections 8, 11 and 12.3). A poll wake-up resumes
-- the same waiting attempt. Each poll is a fresh read stored as its own observation with an
-- ordinal, so a restart continues the count and never mistakes an old read for a new one.
CREATE TABLE wakeups_next (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  execution_id TEXT NOT NULL REFERENCES node_executions(id),
  reason TEXT NOT NULL CHECK (reason IN ('retry', 'timer', 'deadline', 'poll')),
  due_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'FIRED', 'CANCELLED')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at INTEGER NOT NULL,
  settled_at INTEGER
) STRICT;
--> statement-breakpoint
INSERT INTO wakeups_next SELECT id, run_id, execution_id, reason, due_at, state, payload_json, created_at, settled_at FROM wakeups;
--> statement-breakpoint
DROP TABLE wakeups;
--> statement-breakpoint
ALTER TABLE wakeups_next RENAME TO wakeups;
--> statement-breakpoint
CREATE INDEX pending_wakeups ON wakeups (due_at) WHERE state = 'PENDING';
--> statement-breakpoint
CREATE UNIQUE INDEX one_pending_wakeup_per_execution ON wakeups (execution_id) WHERE state = 'PENDING';
--> statement-breakpoint
CREATE INDEX execution_wakeups ON wakeups (execution_id);
--> statement-breakpoint
CREATE INDEX run_wakeups ON wakeups (run_id);
--> statement-breakpoint
CREATE TABLE check_observations (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  execution_id TEXT NOT NULL REFERENCES node_executions(id),
  attempt_id TEXT NOT NULL REFERENCES node_attempts(id),
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  commit_sha TEXT NOT NULL CHECK (length(commit_sha) = 40),
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  observed_at INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX execution_observations ON check_observations (execution_id, ordinal);
