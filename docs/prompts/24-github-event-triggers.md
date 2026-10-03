# 24. Admit verified GitHub deliveries exactly once per subscription

Read [COMMON.md](COMMON.md).

Prerequisites: [22](22-github-app-pr.md). Roadmap: M11b. Can run with 23. Client forms also require 14.

Read server sections 4.4, 10-12.3 and client sections 5.1 and 6.2. Implement App-scoped webhook ingress with raw-body signature validation, current/explicit rotation-window secrets, body limits, and registered installation/repository identity checks. Deduplicate verified delivery IDs before matching/fan-out.

Persist the original delivery and captured matching trigger/version set with occurrences in one transaction. Every matched trigger gets delivery/trigger dedup identity and immutable captured input/version. A redelivery returns its original admission result even after publication/subscription changes; it cannot create new matches. Acknowledge only durable receipts and reject oversized body/output explicitly.

Materialize future subscriptions on publication and implement workflow-scoped skip/queue/allow admission using the common start service. Paused workflows record skipped automatic events; captured queued occurrences wait until admission is enabled. Already admitted runs remain eligible. Waits/holds/needs-human count as unfinished for overlap policy. Manual override stays explicit.

Expose trigger matching config, required App permissions/events, delivery/occurrence history, and status. Coordinate event wake-up interfaces with 23 without duplicating check-wait state.

Acceptance:

- Invalid signatures/identity/oversized payloads reject without runs; valid receipts survive restart.
- Repeated delivery and publication races create exactly the originally captured per-trigger occurrences.
- One App serving several projects keeps a single endpoint/key and separates repository bindings correctly.
- Skip/queue/allow and Pause/unpause preserve captured versions and do not duplicate admitted runs.
