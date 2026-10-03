# 19. Reconcile interrupted harness work without duplicate prompts

Read [COMMON.md](COMMON.md).

Prerequisites: [18](18-agent-node-contract.md). Roadmap: M09b.

Read server sections 6.3-6.7, 9, 11 and client sections 4.3 and 5.5. Finish startup reconciliation for session creation, runtimes, invocations, reports, resource claims, and attempts. Acquire instance ownership and a new generation before admitting work. Reconnect only to verified managed runtimes; inspect durable messages/terminal results and recorded invocation directories after stream loss.

Probe crashes before intent, after intent, after submission before acknowledgement, after result before persistence, and after transition commit. Correlation IDs do not by themselves prove deduplication. Inspect durable evidence before resubmitting; ambiguous submission remains NEEDS_HUMAN while holding claims. Recover completed work without another goal and keep known-running work under observation.

For confirmed interrupted work, close the interrupted attempt, create a counted next attempt on the same input/session, and persist a continuation linked to its original invocation. Ask the agent to inspect partial state before proceeding. Missing conversation/runtime evidence must produce a blocker or explicit repair path. A user-confirmed session repair records override/provenance and updates subsequent binding without erasing original history. Cancellation intent survives reconciliation.

Provide evidence-based CLI/API controls for verified completion, confirmed-safe retry, abandon/cancel, and explicit session replacement where permitted. Agent result repair must meet schema/provenance requirements. Expose readiness/recovery summaries and uncertainty in client attention.

Acceptance:

- Kill Shift or OpenCode during each boundary; recover one known completion/running invocation, a counted continuation, or truthful uncertainty.
- Losing a stream neither loses terminal success nor resubmits a known accepted prompt.
- Stale runtime/attempt fences and late session aborts cannot affect a new owner.
- Missing sessions never silently fork. Disabled workflows still recover waits/held work, and cancelled work cannot restart through recovery.
