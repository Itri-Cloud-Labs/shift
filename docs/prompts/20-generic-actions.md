# 20. Execute Command, HTTP, and Advanced Script nodes

Read [COMMON.md](COMMON.md).

Prerequisites: [08](08-failure-retry-controls.md), [10](10-server-remote-protocol.md), [15](15-workspace-allocation.md). Roadmap: M10. Can proceed independently of 17-19. Client form integration also requires 14.

Read server sections 8-11 and 13; client sections 6.2-6.3. Inspect process, HTTP, and bounded-script libraries. Implement durable EffectService operation intent, fixed argument hashes/keys, evidence, and action-specific reconciliation. Persist intent before I/O and result before advancing. Reject argument changes under the same operation identity.

Command uses executable/argument arrays or explicit shell mode, scoped workspace cwd, selected credential injection, timeout, bounded logs, exit code, verified process ownership, and accounted stop. HTTP supports configured method/URL/headers/body, timeout/capped response, selected credential refs, and result schemas. Advanced Script uses an explicitly bounded child process returning validated JSON, with no integration secrets or engine objects. Document that Script/commands are owner-authorized code, not adversarial sandboxes.

Reads can retry safely when established. Generic writes, scripts, and commands require evidence after uncertain submission; never turn unknown outcomes into ordinary automatic retry/error routing while work might remain active. Honor current permission revocations as well as run authority snapshots.

Add catalog-driven normal Command/HTTP fields and explicit Advanced Script editor after 14. Show structured output/errors/evidence and keep secrets write-only.

Acceptance:

- Temporary subprocesses/endpoints verify stdout/stderr caps, argument handling, timeout/stop, HTTP schemas, selected credentials, and bounded Script behavior.
- Crash after mutation submission enters reconciliation unless evidence establishes completion or safe retry.
- Changed hashes, unauthorized credential refs, and stale fences reject before new effects.
- Forms author ordinary requests without JSON; Script requires explicit Advanced mode and survives config round-trip.
