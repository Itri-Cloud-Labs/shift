-- Active execution time (server specification section 6.7): the time a run's attempts spent
-- running, checkpointed while they run. Waiting for a human, a timer or a retry costs nothing.
ALTER TABLE runs ADD COLUMN active_ms INTEGER NOT NULL DEFAULT 0 CHECK (active_ms >= 0);
--> statement-breakpoint
ALTER TABLE node_attempts ADD COLUMN checkpoint_at INTEGER;
