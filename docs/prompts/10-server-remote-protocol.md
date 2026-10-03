# 10. Expose pairing, commands, queries, and replayable SSE

Read [COMMON.md](COMMON.md).

Prerequisites: [09](09-human-timer-waits.md). Roadmap: server half of M05. Can run with 11 once wire schemas/fixtures are agreed, and with 15.

Read server sections 10-13, especially enrollment retry and snapshot/replay rules. Implement versioned runtime-validated HTTP resources for available projects, workflows/catalog, runs/history/controls, attention/responses, devices, events, and command receipts. Later feature families are added when implemented; unsupported capabilities are explicit. All adapters call the existing application services.

Implement cryptographically random expiring single-use pairing phrases, rate/attempt limits, device tokens stored as hashes, revocation, and authenticated encrypted server credentials with versioned external key material. Enrollment uses command/body identity and an encrypted temporary delivery copy until original expiry, enabling lost-response recovery without another device. Clear delivery copies on expiry and omit secrets from ordinary receipts/events.

Mutations hash operation/parameters/expected revision, commit receipts with state/events/jobs, and scope receipt lookup to the requesting actor. Asynchronous acknowledgements confirm admission, not external completion. Map validation/conflict/retired/auth errors as specified.

Implement consistent snapshot/high-water mark and ordered replay/tail from SQLite. Invalid/missing/foreign-epoch cursors return RESYNC_REQUIRED before stream opening. SSE includes validated payloads/IDs, bearer headers, keepalives, bounded buffers, slow-consumer closure, revocation, and proxy guidance. Inspect maintained HTTP/SSE helpers before custom parsing/delivery.

Acceptance:

- Pair/revoke works; lost enrollment response retrieves the same credential only during the original expiry window.
- Drop HTTP after approval commit, then receipt lookup/identical resend confirms one accepted decision. Different body or stale revision conflicts.
- Snapshot/replay/live races lose no event; duplicate deliveries, invalid cursors, slow clients, and revoked streams behave correctly.
- Proxy checks verify buffering/idle behavior. Stream closure and aborted client requests leave admitted runs active.
