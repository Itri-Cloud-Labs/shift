-- Binding provenance (server specification sections 6.3 and 10): which execution produced each
-- frozen binding value, recorded with the values when an execution is prepared.
ALTER TABLE node_executions ADD COLUMN binding_sources_json TEXT CHECK (binding_sources_json IS NULL OR json_valid(binding_sources_json));
