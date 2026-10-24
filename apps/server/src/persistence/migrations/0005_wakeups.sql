-- Durable wake-ups (server specification sections 6.6, 8 and 10): a waiting execution resumes when
-- its row falls due. Only IDs and UTC deadlines are stored, never callbacks, so startup rebuilds
-- every timer from this table. Retry backoff uses it first; timer and deadline waits follow.
CREATE TABLE wakeups (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  execution_id TEXT NOT NULL REFERENCES node_executions(id),
  reason TEXT NOT NULL CHECK (reason IN ('retry', 'timer', 'deadline')),
  due_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'FIRED', 'CANCELLED')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at INTEGER NOT NULL,
  settled_at INTEGER
) STRICT;
--> statement-breakpoint
CREATE INDEX pending_wakeups ON wakeups (due_at) WHERE state = 'PENDING';
--> statement-breakpoint
CREATE UNIQUE INDEX one_pending_wakeup_per_execution ON wakeups (execution_id) WHERE state = 'PENDING';
