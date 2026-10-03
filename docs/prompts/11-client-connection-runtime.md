# 11. Build the client connection and credential runtime

Read [COMMON.md](COMMON.md).

Prerequisites: [02](02-client-foundation.md), [09](09-human-timer-waits.md), and agreed 10 wire schemas/fixtures. Roadmap: client half of M05. Can run with 10; real integration completes after 10 passes.

Read client sections 2-4 and 7-9; server section 13. Implement main-owned authenticated HTTP/SSE transport and one connection supervisor, using a maintained streaming/SSE parser where suitable. Keep client-core independent of Electron through injected adapters. Runtime-validate responses/events/IPC and classify acknowledgement_unknown separately from rejection.

Implement URL/TLS/identity checks, one active profile, pairing command recovery, OS-backed secure credential storage, and Linux session-only behavior when secure storage is unavailable. Tokens and pairing phrases stay outside renderer/logs/URLs. Clearing a profile affects only local data. Key cache by stable server ID, epoch, device, and resource; an address change requires server identity verification.

Track connection/query generations, protocol/capability range, receipt reconciliation, snapshot/high-water mark, applied cursor, and aggregate revisions. Save cursor only with its corresponding projection after applying events. Resnapshot resources whose cached projection was not retained. Unknown event versions trigger refetch/resnapshot. Prevent stale query responses from overwriting newer state.

Add capped backoff/jitter, keepalive timeout, bounded subscriptions, teardown, offline/revoked/incompatible states, and credential cleanup. Pending mutations retain one ID/body; reconnect does not replay a queue of writes.

Acceptance:

- Deterministic fake-transport tests cover loss after commit, duplicate/out-of-order events, epoch changes, stale queries, replaced connections, keepalive failure, revocation, and resync.
- Credential inspection proves renderer payloads omit secrets; insecure Linux storage remains session-only.
- After 10 completes, real pairing, reconnect, snapshot/SSE replay, and lost approval receipt recovery pass against the server.
