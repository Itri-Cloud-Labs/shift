# 07. Add explicit run variables

Read [COMMON.md](COMMON.md).

Prerequisites: [06](06-routing-references.md). Roadmap: M04a.

Read server sections 4.2, 5, 6.3, 8-11. Implement Set Variable, Get Variable, variable ValueSources, current values, and immutable revision history. Only registry entries advertising variable-write capability can return writes. Validate value size, key, expected revision, and run/execution membership.

Commit writes and revision records with the producing execution's successful output, event, and successor. Failed/interrupted attempts leave no partial variable changes. Resolve variables once during execution preparation and save value/revision/producer provenance in stored bindings. Retries and waits reuse that snapshot.

Use the declarative Transform contract for bounded arithmetic, array length/index access, and object construction. Inspect maintained expression/mapping tools first; keep the supported language explicit and avoid arbitrary JavaScript in ordinary Transform. Create a finite collection-processing example using a run-local index, backward edge, and Condition. The array itself never causes implicit per-item activations.

Expose CLI/history/protocol fixtures for variable values and producing revisions.

Acceptance:

- A finite collection loop visits each selected element through explicit graph execution and ends deterministically.
- Crash/failure before commit leaves both output and write absent; commit makes both visible.
- Two runs cannot share variable state, and stale expected revisions conflict.
- A resumed/retried execution retains its frozen variable binding even after another explicit write.
