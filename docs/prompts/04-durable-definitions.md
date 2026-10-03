# 04. Persist projects, workflow drafts, and published versions

Read [COMMON.md](COMMON.md).

Prerequisites: [01](01-server-foundation.md). Roadmap: M02. Can run with 02 and 03.

Read server sections 4-5, 8-10, and 12.1. Implement incremental migrations and repository/application services for project registration, profiles/defaults/permissions, workflows, draft revisions, immutable versions, and versioned node catalog descriptions. Canonicalize and validate existing host Git repositories. Credentials use references/status rather than returned secret values.

Define runtime schemas for the graph and public models. Implement save/publish validation for node/edge IDs, type versions, config/result schemas, ports, trigger entries, limits, binding shapes, and membership. Allow backward edges and incoming convergence; reject output fan-out. Produce node/field/edge diagnostics and appropriate warnings. Reject unsupported schema dialect/features, remote refs, oversized inline values, and excessive depth explicitly.

Publishing atomically writes the authoritative document/hash, query projections, active version pointer, events, and applicable trigger subscriptions. Preserve prior versions and required type versions. Use CAS revisions and enforce same-project/workflow/version membership through repository methods and database constraints. Archive without destroying history.

Expose CLI create/get/save/validate/publish/list operations and pure protocol/catalog fixtures for the client. Stage feature migrations as needed instead of populating unused modules with placeholders.

Acceptance:

- CLI registers a temporary repo, creates and publishes a tiny graph, and inspects an immutable version after restart.
- A stale draft save conflicts; editing defaults/drafts does not change published versions.
- Duplicate selected-port edges and cross-workflow version pointers fail; valid loops and convergence publish.
- Migration, JSON/enum/FK/membership constraints, projection hash consistency, schema limits, and runtime protocol validation have meaningful checks.
