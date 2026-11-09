-- A session's normalized conversation (server specification sections 4.3 and 10): one row per
-- harness message or part, keyed by its stable harness identity. A changed part keeps its row and
-- takes the next revision, so a reader can tell a growing message from a new one.
CREATE TABLE session_entries (
  id TEXT PRIMARY KEY NOT NULL,
  agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  invocation_id TEXT REFERENCES agent_invocations(id),
  source_key TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  position INTEGER NOT NULL CHECK (position > 0),
  kind TEXT NOT NULL CHECK (kind IN ('user', 'assistant', 'tool', 'status')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (agent_session_id, source_key)
) STRICT;
--> statement-breakpoint
CREATE INDEX session_entry_order ON session_entries(agent_session_id, position);
