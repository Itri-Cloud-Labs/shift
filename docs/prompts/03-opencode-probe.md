# 03. Probe OpenCode before committing adapter assumptions

Read [COMMON.md](COMMON.md).

Prerequisites: [01](01-server-foundation.md). Roadmap: early evidence for M08a-M09b. Can run with 02 and 04.

Read server sections 6.4-6.5, 9, 11.2, and 17. Inspect current official OpenCode APIs/source and the installed version. Create a small reproducible probe under the server's development tooling, isolated from production execution. Use a temporary repository, isolated harness storage, and a fake provider where possible. Real provider calls require the owner's existing authorization and credentials; document that dependency if unavailable.

Probe create/inspect/resume session, idle runtime shutdown, structured completion/blocker/failure envelopes, supported JSON Schema subset, supplied message/correlation IDs, durable message inspection, streamed activity, cancellation, permission/question handling, tool-policy enforcement, and process restart. Interrupt submission before and after acknowledgement and inspect whether durable evidence distinguishes accepted, active, completed, interrupted, and unknown work. Do not infer prompt deduplication from a supplied ID.

Record exact versions, commands, sanitized observed responses, and limitations in `docs/opencode-capabilities.md`. Translate observed evidence into the proposed HarnessCapabilities and list concrete changes needed in adapter implementation. Keep fixed Shift semantics intact; unsupported behavior should become a capability failure or truthful uncertainty.

Acceptance:

- The probe is rerunnable and cleans up only its own verified processes/temp resources.
- Findings distinguish official API guarantees, observed behavior, and unresolved assumptions.
- Resume, correlation, terminal result, cancellation, and tool-policy limitations each have evidence or an explicit unverified prerequisite.
- Any unsupported essential capability blocks only the dependent real-adapter work. A documentation-only result with missing real-call evidence is not recorded as verified integration.
