# 08. Add retries, failure routes, limits, and cancellation

Read [COMMON.md](COMMON.md).

Prerequisites: [07](07-run-variables.md). Roadmap: M04b.

Read server sections 6.2-6.3, 6.6-6.7, 8-11. Implement structured executor errors, optional error edges, safe retry classification, durable bounded backoff, explicit retry of failed work, execution/attempt budgets, active-time accounting, and recorded limit extension. Retry preserves input/session binding and allocates another attempt; loops remain separate executions.

Unhandled known failures stop the run. Handled failures remain failed in history while routing an error envelope with preserved context. Reconciliation-first errors cannot retry while an effect may still be active. Implement the control/effect interfaces and fake evidence needed to hold unknown work in NEEDS_HUMAN, leaving real reconciliation to later adapters.

Workflow Pause changes future admission. Cancellation persists intent, suppresses future activations, closes pending work as appropriate, and accounts for active work before terminal CANCELLED. A stale completion must not ignore cancellation/hold/fence. Maintain separate run/execution/attempt states and wait reasons. Waiting/backoff does not consume active time; checkpoint running time durably and explain conservative recovery charges.

Acceptance:

- CLI demonstrates safely retryable failure, unhandled failure, error routing, explicit retry, and limit extension with fake long-running work.
- Retries retain input/provenance, exhaust finite attempts, and survive restart during backoff.
- Limits stop another activation; completed/cancelled runs cannot silently reopen.
- Pause permits existing work to finish. Cancellation remains requested or needs human while stop/effect evidence is uncertain and becomes cancelled only after accounting.
