# Prompts for building Shift

This pack contains 33 prompts for implementing the server and Electron client, including a dependency review and an early OpenCode probe. It follows the 29 milestones in the [server roadmap](../shift-server-v0.md#18-ordered-implementation-roadmap), splitting foundation and transport work where parallel ownership helps. The [client roadmap](../shift-client-v0.md#11-implementation-roadmap-and-server-coordination) describes the same product sequence.

The specifications remain proposed. This documentation task does not approve them or start implementation. When ready, instruct an agent to execute a selected prompt under the scope you authorize. The pack prepares local implementation and release evidence; publishing, deployment, and real external credentials remain separate instructions/prerequisites.

## Give an agent one task

Use this invocation, replacing the filename:

```text
Read docs/prompts/COMMON.md and docs/prompts/04-durable-definitions.md.
Implement that prompt's scope, verify its prerequisites and acceptance cases,
and record the result in docs/implementation-progress.md.
Read the cited specification sections and preserve unrelated work.
```

Start with 00. Running numbered prompts in order is the simple sequential route, with one exception: if the real OpenCode probe lacks credentials, continue independent fake-engine/client work and leave 17-19 incomplete until its evidence is available. A prior prompt is complete only when its required checks pass. Re-read current code and progress rather than assuming an earlier agent finished.

Every task reads [COMMON.md](COMMON.md), which defines library evaluation, module boundaries, authorization, durability, verification, and handoff. Each numbered file supplies its own scope and acceptance cases. Specifications remain the source of product semantics; this pack supplies task boundaries and a few explicit preparation steps.

## Task index

Dependencies are required completed behavior unless a row explicitly requires only an agreed contract. "Both" means one task coordinates server and client integration; it does not require simultaneous agents. Server-only work may proceed without optional UI integration, which must be completed before dependent end-to-end checks.

| Prompt | Work | Prerequisites | Roadmap |
| --- | --- | --- | --- |
| [00. Review dependencies and contracts](00-preflight.md) | Planning | None | Before M01 |
| [01. Linux server foundation](01-server-foundation.md) | Server | 00 | M01 |
| [02. Electron foundation](02-client-foundation.md) | Client | 00 | M01 |
| [03. OpenCode capability probe](03-opencode-probe.md) | Server experiment | 01 | Early M09 evidence |
| [04. Durable definitions](04-durable-definitions.md) | Server | 01 | M02 |
| [05. Linear execution](05-linear-execution.md) | Server | 04 | M03 |
| [06. Routing and references](06-routing-references.md) | Server | 05 | M04 |
| [07. Run variables](07-run-variables.md) | Server | 06 | M04a |
| [08. Failure and retry controls](08-failure-retry-controls.md) | Server | 07 | M04b |
| [09. Human and timer waits](09-human-timer-waits.md) | Server | 08 | M04c |
| [10. Server remote protocol](10-server-remote-protocol.md) | Server | 09 | M05 |
| [11. Client connection runtime](11-client-connection-runtime.md) | Client | 02, 09, agreed 10 contract; live checks need 10 | M05 |
| [12. Connected views](12-connected-client.md) | Client | 10, 11 | M06 |
| [13. Visual editor](13-visual-workflow-editor.md) | Client | 12 | M07 |
| [14. Rich forms and draft recovery](14-rich-node-forms.md) | Client | 13 | M07a |
| [15. Workspace allocation](15-workspace-allocation.md) | Server | 09 | M08 |
| [16. Sessions and artifacts](16-session-identity-artifacts.md) | Both | 15; UI needs 14 | M08a |
| [17. OpenCode supervision](17-opencode-supervision.md) | Both | 03, 16; UI needs 12 | M09 |
| [18. Agent contract](18-agent-node-contract.md) | Both | 17; UI needs 14 | M09a |
| [19. Harness recovery](19-harness-recovery.md) | Both | 18 | M09b |
| [20. Generic actions](20-generic-actions.md) | Both | 08, 10, 15; UI needs 14 | M10 |
| [21. Git actions](21-git-actions.md) | Both | 20; UI needs 14 | M10a |
| [22. GitHub App and PR](22-github-app-pr.md) | Both | 21; UI needs 12, 14 | M11 |
| [23. Checks and merge](23-checks-merge.md) | Both | 22; UI needs 14 | M11a |
| [24. GitHub event triggers](24-github-event-triggers.md) | Both | 22; UI needs 14 | M11b |
| [25. Cron and admission](25-cron-admission.md) | Both | 09, 10; UI needs 14 | M12 |
| [26. Generic webhooks](26-generic-webhooks.md) | Both | 25; UI needs 14 | M12a |
| [27. Intervention and inspection](27-intervention-inspection.md) | Both | 12, 14, 19, 21 | M13 |
| [28. Linux operation](28-linux-operation.md) | Server | 23, 24, 26, 27 | M14 |
| [29. Backup and restore](29-backup-restore.md) | Both | 28 | M14a |
| [30. Optional hostname](30-optional-hostname.md) | Both | 28 | M14b |
| [31. Desktop distribution](31-desktop-distribution.md) | Client | 27, 28 | M14c |
| [32. Fault and release acceptance](32-fault-release-acceptance.md) | Both | 23, 24, 26, 29, 30, 31; all required acceptance cases | M15 |

## Parallel execution

Develop the durable server backbone first while the client works against agreed schemas and fixtures. This exposes execution/recovery mistakes before they become editor assumptions. Real adapters and integration tests replace fixtures at their specified gates.

- After 00, run 01 and 02 together. Assign one owner for root configuration, lockfile, and CI edits.
- After 01, run 03 alongside 04-09. Probe findings must inform 17 before its real adapter is implemented. Missing real-provider access need not stop the fake engine.
- After 09, run 10 and 11 together once schemas/fixtures are agreed. The client runtime's live acceptance waits for 10. Run 15 alongside that transport work if server-module ownership is separate.
- Once the connection is integrated, run client 12-14 alongside server 15-19. Use fixtures for later catalog capabilities and label them unavailable for live execution. Finish the session/workspace UI integration from 16-18 after 14.
- Run 20-22 independently of real-agent recovery once their prerequisites pass. Extend client forms after 14. Run 23 and 24 together after 22 only with separate GitHub module ownership.
- Run 25-26 alongside agent/action work after their prerequisites pass. Assign one owner for shared trigger admission, schema migrations, and protocol changes; 24 and 25 must share the same service.
- After 28, run 29, 30, and 31 together. Include any new status/settings in packaged builds before 32 performs final acceptance.

For each concurrent batch, agree on file ownership and schema changes first. One owner handles shared migrations, generated protocol outputs, root lockfile, and progress entries. Separate branches/worktrees help review; do not let concurrent agents overwrite the same shared files. Merge a prerequisite before a dependent task needs its implementation, or provide a tested agreed contract and fixtures for the explicitly allowed server/client overlap. Run integration checks after merging each batch.

## Checkpoints

- After 09, CLI demonstrates a graph that branches, loops, waits for a human, survives restart, and resumes using deterministic executors.
- After 14, a paired client authors that graph through forms/pickers and resolves attention without JSON configuration.
- After 19, real agents preserve sessions/artifacts and recover interrupted work or expose truthful uncertainty.
- After 26, general actions, GitHub, schedules, and authenticated events drive arbitrary workflows.
- After 32, release evidence covers Linux operation, packaged desktop clients, recovery, and both general and maintenance graphs. Missing required external checks keep the release incomplete.
