# 06. Add routing, backward edges, and historical references

Read [COMMON.md](COMMON.md).

Prerequisites: [05](05-linear-execution.md). Roadmap: M04.

Read server sections 5, 6.2-6.3, 8-10; client sections 3 and 6.2 for diagnostics/fixtures. Implement typed Condition comparisons and AND/OR groups, plus ordered Switch cases/default. Control nodes pass the incoming envelope through and select one declared port. Several incoming edges never imply a join.

Implement literal/current-input/trigger/frozen-project/earlier-node ValueSource resolution and provenance. JSON paths are token arrays. Support latest successful, first, sequence, and execution-ID selection only from earlier executions on this run's predecessor chain. A prior loop pass remains eligible even if that producer was skipped on the newest pass. Failed results stay inspectable without replacing successful data references.

Freeze resolved bindings before executor invocation. Required missing values fail before effects; optional missing values require explicit fallbacks. Malformed values and permission errors never become fallback successes. A reference never runs its producer. Persist every loop pass as a new execution/sequence and expose paginated history with exact producing identities.

Acceptance:

- Branches converge through the chosen predecessor only; Switch chooses its first matching case.
- A bounded fake-output loop records independent executions and preserves provenance across restart.
- Latest/first/explicit selectors work across skipped loop passes, while future/cross-run/failed selectors are rejected for normal data flow.
- Missing bindings stop before executor effects. Retry/resume can load stored bindings without resolving changed project defaults.
