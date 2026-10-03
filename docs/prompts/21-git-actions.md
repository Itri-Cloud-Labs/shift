# 21. Add deterministic Git nodes and reconciliation

Read [COMMON.md](COMMON.md).

Prerequisites: [20](20-generic-actions.md). Roadmap: M10a. Client form integration also requires 14.

Read server sections 7-8, 11-12.3; client sections 5.3, 5.6, and 6.2. Implement Git Status, Diff, Create Branch, Commit, and Push within the claimed run workspace using maintained Git/process tools. Return structured repository/base/current commit/branch/output/evidence. Branch names, messages, and PR text come from configured inputs or Agent output rather than action-node intelligence.

Support creating a named branch after edits in a detached worktree. Record deterministic intent and action-specific evidence before mutations. Commit recovery uses recorded parent/tree/commit evidence; push reconciles configured destination/ref and remote observations. Ambiguous external/manual workspace changes require human resolution. Read-only queries get fresh observations, while mutation operation identity stays stable.

Use existing host Git credentials when selected. Prepare a replaceable credential adapter for later GitHub App HTTPS transport; neither logs nor stored remotes may embed tokens. Respect action permission revocation, preserve retained workspaces, and report repository conflicts as structured errors.

Add registry forms/reference pickers and recorded Git evidence to inspection. Keep live diff data distinct from immutable execution artifacts.

Acceptance:

- Temporary repos/remotes demonstrate status/diff, edits before named branch creation, commit, and push without touching the source worktree.
- Crash before/after commit or push reconciles verified effects or reports uncertainty without duplicate commits.
- Invalid refs/argument injection, branch collisions, changed parent/tree, and stale ownership fail clearly.
- Graph outputs can supply branch/message values through typed forms; live state never overwrites historical evidence.
