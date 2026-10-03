# 17. Run real OpenCode sessions under server supervision

Read [COMMON.md](COMMON.md).

Prerequisites: [03](03-opencode-probe.md), [16](16-session-identity-artifacts.md). Roadmap: M09. Real-call evidence from 03 is required for dependent capabilities.

Read server sections 6.4-6.5, 9, 11.2, and 17; client sections 5.3 and 5.5. Pin/test the actual OpenCode API from the probe. Implement the replaceable HarnessAdapter with managed local server per Shift session, isolated recorded storage namespace, authenticated endpoint, verified process identity, logs, health/version checks, and bounded shutdown.

Use maintained process/API libraries where suitable. Process identity includes start identity/generation/endpoint/workspace evidence, not PID alone. Normalize/redact durable message/part observations with stable keys and revisions. Streaming activity is an observation; session/message inspection supplies reconciliation. Submission accepted is distinct from terminal completion. Capability claims must match observed schema/resume/inspection/cancellation/tool-policy support.

Expose a CLI/manual session goal through the application service under resource ownership, plus session/invocation history APIs. Persist exact goal/context/correlation and operation intent before submission. Unsupported permission enforcement blocks before invocation; invisible permission/question events become accounted structured blockers. Keep recovery uncertainty truthful while 19 adds exhaustive continuation.

Connect real session views/live activity after 12/16 UI work is complete. Idle runtime shutdown must preserve the conversation and Shift reference.

Acceptance:

- An authorized manual goal executes in a temporary host workspace, with normalized transcript and stable session identity.
- Shut down an idle managed process, restart it, and inspect the same conversation.
- A client disconnect has no effect on invocation lifetime. Idle/HTTP acknowledgement alone cannot mark node success.
- Unsupported capability, permission/question blocker, wrong process identity, and API-version mismatch fail clearly before unsafe reuse.
