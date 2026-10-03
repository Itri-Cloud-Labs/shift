# 23. Verify checks, wait durably, and merge when reached

Read [COMMON.md](COMMON.md).

Prerequisites: [22](22-github-app-pr.md). Roadmap: M11a. Can run with 24 after agreeing GitHub service ownership. Client form integration also requires 14.

Read server sections 8, 11, and 12.3; client sections 5.3 and 6.2. Implement Verify GitHub Checks for an explicitly resolved commit, returning structured check conclusions for author-selected Condition/Switch routing. Implement Wait for Checks with frozen commit/config, durable poll ordinal/deadline, stored observations, timeout/error routes, and restart resumption.

Each read poll has a new observation identity; a cached completed EffectOperation must not masquerade as a fresh read. Verified GitHub events may wake the poll, but durable polling remains sufficient. Watched commit changes require another execution or explicit author path.

Implement GitHub Merge with configured method and optional explicitly configured expected commit. Invoke immediately when the graph reaches the node; the author controls checks/review/wait nodes. Respect provider protections and surface rejections as structured errors. Reconcile uncertain merge using PR state and recorded commit evidence before retry. Reading merge state for recovery does not add an implicit readiness gate.

Expose forms, explicit commit pickers, wait progress, and operation evidence.

Acceptance:

- Fake API changes from pending to completed checks, proving fresh reads and restart-safe waits.
- Timeout/cancel and duplicate wake-up races yield one known result/successor.
- A graph routes check results explicitly; a directly reached Merge makes the provider call without hidden checks/review policy.
- Crash after merge submission records verified merged state or NEEDS_HUMAN. Provider protection failures remain visible and do not trigger a bypass.
