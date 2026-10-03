# 01. Build the Linux server foundation

Read [COMMON.md](COMMON.md).

Prerequisites: [00](00-preflight.md). Roadmap: server half of M01. Can run with 02 after agreeing root-file ownership.

Read server sections 3, 9-11, 13, and 15. Build the strict TypeScript server workspace with a composition root, internal domain/protocol modules, configuration, logging/redaction, an injected clock, and graceful lifecycle. Use the dependency decisions from 00. Add health/info endpoints advertising stable server identity, protocol range, event epoch, and readiness. Keep public/management exposure explicit and loopback-safe.

Create the local CLI entry and mode-0600 administrative Unix socket contract. Establish a singleton server-instance lock that fails safely on a second process and releases after shutdown/crash. Separate liveness from readiness. Initialize the SQLite/migration infrastructure with verified runtime version and durability pragmas; leave feature tables to later prompts. Store server metadata durably so identity survives restart. Keep asynchronous I/O outside transactions.

Provide actual development/build/typecheck/test commands and Linux x64/arm64 build checks. Share the root toolchain/CI changes through one owner when 02 runs concurrently. Add test helpers for temporary state directories, real SQLite, subprocess startup/shutdown, and a fake clock without creating an alternate engine.

Acceptance:

- A documented CLI command starts the headless server and returns validated health/info data; no desktop is needed.
- Identity survives restart, a second server cannot own the same state, and the administrative socket has the required permissions.
- Invalid configuration/native SQLite compatibility fails clearly; startup verifies WAL, FULL synchronization, foreign keys, and busy timeout.
- Build/typecheck and startup/shutdown smoke checks pass. No feature executor is needed to keep the server healthy.
