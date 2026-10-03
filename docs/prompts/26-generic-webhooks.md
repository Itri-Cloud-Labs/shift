# 26. Add authenticated HTTP workflow triggers

Read [COMMON.md](COMMON.md).

Prerequisites: [25](25-cron-admission.md). Roadmap: M12a. Client setup also requires 14.

Read server sections 4.4, 10, 12.1, and 13; client sections 5.1 and 6.2. Implement per-trigger revocable random credentials, header signature and bearer modes, explicit rotation, dedup/receipt identity, body/result size limits, validated trigger input, and durable admission acknowledgement. Use the common version-capturing trigger service from 24/25 where present; avoid another start mechanism.

Define and document dedup semantics when callers supply an event ID and the behavior without one. Acknowledge only after receipt/occurrence/admission state commits. Never acknowledge oversized or malformed input as silently discarded. Preserve the captured version/input across duplicate requests, queuing, restart, and later publication. Signature verification uses the raw payload where required; secret comparisons must use established crypto primitives.

Expose status/endpoint/setup/rotation through scoped APIs and typed forms. Secret forms remain write-only except explicitly authorized initial issuance delivery. Explain sender authentication and required headers through usable instructions, with a local fake sender/demo. Respect workflow Pause and overlap policies.

Acceptance:

- A local fixture sends an authenticated event that starts a general graph and survives restart.
- Invalid/revoked signatures/tokens, input schema failures, and oversized bodies/results reject clearly.
- Duplicate identified events return original receipts/admission, including when acknowledgement was lost.
- Queue/Pause/publication races preserve captured inputs/versions, and trigger credentials never enter ordinary events/snapshots/logs.
